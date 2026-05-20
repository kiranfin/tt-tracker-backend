import { mkdir, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const LOG_FILE = resolve(process.env.TTTRACKER_LOG_FILE ?? "logs/requests.jsonl");

let directoryReady = false;

async function ensureLogDirectory() {
    if (directoryReady) return;

    await mkdir(dirname(LOG_FILE), {
        recursive: true
    });

    directoryReady = true;
}

export async function writeJsonLog(
    type: string,
    data: Record<string, unknown>
) {
    try {
        await ensureLogDirectory();

        const line =
            JSON.stringify({
                timestamp: new Date().toISOString(),
                type,
                ...data
            }) + "\n";

        await appendFile(LOG_FILE, line, "utf8");
    } catch (error) {
        console.error("Could not write log file", error);
    }
}