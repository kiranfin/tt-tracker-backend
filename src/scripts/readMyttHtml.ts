import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readMyttHtml } from "../myttHtmlReader.js";

function slugify(value: string): string {
    return value
        .replaceAll(/[^a-zA-Z0-9]+/g, "-")
        .replaceAll(/^-+|-+$/g, "")
        .slice(0, 80);
}

const path = process.argv[2];

if (!path) {
    console.error("Usage: npm run read:html -- \"/pfad/der/mytischtennis-seite\"");
    process.exit(1);
}

const result = await readMyttHtml({
    path,
    ttlMs: 0
});

const fixturesDir = join(process.cwd(), "fixtures", "mytt-html");
await mkdir(fixturesDir, { recursive: true });

const filename = `${new Date()
    .toISOString()
    .replaceAll(/[:.]/g, "-")}-${slugify(path)}.html`;

const filePath = join(fixturesDir, filename);

await writeFile(filePath, result.html, "utf8");

console.log(
    JSON.stringify(
        {
            ok: true,
            filePath,
            bytes: Buffer.byteLength(result.html, "utf8"),
            meta: result.meta
        },
        null,
        2
    )
);