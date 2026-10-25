import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests sollen nicht in logs/requests.jsonl des laufenden Backends schreiben.
process.env.TTTRACKER_LOG_FILE = join(tmpdir(), "tttracker-test-requests.jsonl");
