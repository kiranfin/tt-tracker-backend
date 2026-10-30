import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// Feste Richtung: routes -> services -> cache | (mytt -> upstream). Nichts kürzt ab.

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

function listFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);

        return statSync(path).isDirectory() ? listFiles(path) : path.endsWith(".ts") ? [path] : [];
    });
}

type Import = { file: string; target: string };

/** Alle relativen Imports einer Datei als Pfad relativ zu src (mit Slash), ohne Endung. */
function readImports(file: string): Import[] {
    const source = readFileSync(file, "utf8");
    const pattern = /(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;
    const imports: Import[] = [];

    for (const match of source.matchAll(pattern)) {
        const target = relative(SRC, resolve(dirname(file), match[1]!))
            .split(sep)
            .join("/")
            .replace(/\.js$/, "");

        imports.push({ file: relative(SRC, file).split(sep).join("/"), target });
    }

    return imports;
}

const allImports = listFiles(SRC).flatMap(readImports);

function violations(fromDir: string, forbidden: string[]) {
    return allImports.filter(
        (entry) =>
            entry.file.startsWith(`${fromDir}/`) &&
            forbidden.some((dir) => entry.target === dir || entry.target.startsWith(`${dir}/`))
    );
}

describe("architecture", () => {
    it("scans the source tree", () => {
        assert.ok(allImports.length > 50);
    });

    it("routes talk to services only (no mytt, upstream, cache, buildMeta)", () => {
        const found = violations("routes", ["mytt", "upstream", "cache", "utils/responseMeta"]);

        assert.deepEqual(found, []);
    });

    it("the source layer has no cache", () => {
        assert.deepEqual(violations("mytt", ["cache", "services", "routes"]), []);
    });

    it("lower layers never import upwards", () => {
        assert.deepEqual(violations("upstream", ["mytt", "services", "routes", "cache"]), []);
        assert.deepEqual(violations("cache", ["mytt", "services", "routes", "upstream"]), []);
        assert.deepEqual(violations("services", ["routes"]), []);
    });
});
