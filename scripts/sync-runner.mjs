// Copies judge/runner.py into lib/judge/runner-source.ts so the website can send it
// to the sandbox. Run `npm run sync-runner` after every change to runner.py.
// (`npm test` fails if the two are out of sync.)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function generate() {
  const source = readFileSync(path.join(root, "judge", "runner.py"), "utf8");
  const version = createHash("sha256").update(source).digest("hex").slice(0, 12);
  return (
    "// GENERATED FILE - do not edit. Edit judge/runner.py and run `npm run sync-runner`.\n" +
    `export const RUNNER_VERSION = ${JSON.stringify(version)};\n` +
    `export const RUNNER_SOURCE = ${JSON.stringify(source)};\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(path.join(root, "lib", "judge", "runner-source.ts"), generate());
  console.log("lib/judge/runner-source.ts updated.");
}
