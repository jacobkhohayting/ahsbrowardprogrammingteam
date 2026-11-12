// The website sends a copy of judge/runner.py to the sandbox. This makes sure the copy is current.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "../scripts/sync-runner.mjs";

test("lib/judge/runner-source.ts matches judge/runner.py (run `npm run sync-runner` if this fails)", () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "judge", "runner-source.ts");
  assert.equal(readFileSync(file, "utf8"), generate());
});
