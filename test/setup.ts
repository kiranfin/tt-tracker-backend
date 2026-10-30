import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests sollen nicht in logs/requests.jsonl des laufenden Backends schreiben.
process.env.TTTRACKER_LOG_FILE = join(tmpdir(), "tttracker-test-requests.jsonl");

// Die Ablage läuft im Arbeitsspeicher, damit Tests nichts auf die Platte schreiben.
process.env.STORE_FILE = ":memory:";
