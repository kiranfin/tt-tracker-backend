import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const LOG_FILE = resolve(process.env.TTTRACKER_LOG_FILE ?? "logs/requests.jsonl");

// Größe, ab der die Datei weitergereicht wird (requests.jsonl.1, .2, ...), und wie viele alte Dateien bleiben.
const MAX_BYTES = Number(process.env.TTTRACKER_LOG_MAX_BYTES) > 0 ? Number(process.env.TTTRACKER_LOG_MAX_BYTES) : 20 * 1024 * 1024;
const KEEP_FILES = Number(process.env.TTTRACKER_LOG_KEEP_FILES) > 0 ? Math.floor(Number(process.env.TTTRACKER_LOG_KEEP_FILES)) : 3;

let directoryReady = false;
let currentBytes: number | null = null;
// Schreibvorgänge nacheinander, damit eine Rotation nie mitten in einem Anhängen passiert.
let queue: Promise<void> = Promise.resolve();

async function ensureLogDirectory() {
    if (directoryReady) return;

    await mkdir(dirname(LOG_FILE), {
        recursive: true
    });

    directoryReady = true;
}

/**
 * Schiebt die Dateien weiter: file.(n-1) wird file.n, die aktuelle Datei wird file.1, die älteste fällt weg.
 * Danach beginnt eine neue, leere Datei.
 */
export async function rotateLogFiles(file: string, keep: number) {
    await rm(`${file}.${keep}`, { force: true });

    for (let index = keep - 1; index >= 1; index -= 1) {
        await rename(`${file}.${index}`, `${file}.${index + 1}`).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
        });
    }

    await rename(file, `${file}.1`).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
    });
}

async function append(line: string) {
    await ensureLogDirectory();

    if (currentBytes === null) {
        currentBytes = await stat(LOG_FILE)
            .then((info) => info.size)
            .catch(() => 0);
    }

    const bytes = Buffer.byteLength(line, "utf8");

    if (currentBytes > 0 && currentBytes + bytes > MAX_BYTES) {
        await rotateLogFiles(LOG_FILE, KEEP_FILES);
        currentBytes = 0;
    }

    await appendFile(LOG_FILE, line, "utf8");
    currentBytes += bytes;
}

export async function writeJsonLog(
    type: string,
    data: Record<string, unknown>
) {
    const line =
        JSON.stringify({
            timestamp: new Date().toISOString(),
            type,
            ...data
        }) + "\n";

    queue = queue.then(() => append(line)).catch((error) => {
        console.error("Could not write log file", error);
    });

    await queue;
}
