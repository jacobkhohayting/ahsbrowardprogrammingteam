"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { uploadTest } from "@/lib/actions/admin-problems";

type Pair = { key: string; input: File; output: File };

/**
 * Pairs files by name: 1.in + 1.out, 3.in + 3.ans, input2.txt + output2.txt,
 * sample.in + sample.out, test_07.in + test_07.out ...
 */
export function pairFiles(files: File[]): { pairs: Pair[]; unmatched: string[] } {
  const inputs = new Map<string, File>();
  const outputs = new Map<string, File>();
  const unmatched: string[] = [];
  for (const file of files) {
    const name = file.name.toLowerCase();
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    if ([".in", ".inp", ".input"].includes(extension)) inputs.set(base, file);
    else if ([".out", ".ans", ".a", ".output", ".sol", ".expected"].includes(extension)) outputs.set(base, file);
    else if (/input|^in\d/.test(base)) inputs.set(base.replace(/input|^in(?=\d)/g, "#"), file);
    else if (/output|answer|^out\d/.test(base)) outputs.set(base.replace(/output|answer|^out(?=\d)/g, "#"), file);
    else unmatched.push(file.name);
  }
  const keys = [...inputs.keys()].filter((key) => outputs.has(key));
  keys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const key of inputs.keys()) if (!outputs.has(key)) unmatched.push(inputs.get(key)!.name);
  for (const key of outputs.keys()) if (!inputs.has(key)) unmatched.push(outputs.get(key)!.name);
  return { pairs: keys.map((key) => ({ key, input: inputs.get(key)!, output: outputs.get(key)! })), unmatched };
}

/** Upload many tests at once from pairs of files. Each test is sent on its own, so big sets work too. */
export function TestUploader({ problemId }: { problemId: number }) {
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [problems, setProblems] = useState<string[]>([]);

  async function upload(list: FileList | null) {
    if (!list || list.length === 0) return;
    const { pairs, unmatched } = pairFiles([...list]);
    const notes = unmatched.map((name) => `${name}: no matching input/output file, skipped.`);
    if (pairs.length === 0) {
      setProblems(["No input/output pairs found. Name them like 1.in and 1.out.", ...notes]);
      return;
    }
    setBusy(true);
    setProblems(notes);
    let added = 0;
    for (const [index, pair] of pairs.entries()) {
      setProgress(`Uploading test ${index + 1} of ${pairs.length}…`);
      if (pair.input.size + pair.output.size > 3_500_000) {
        notes.push(`${pair.input.name}: larger than 3.5 MB, skipped.`);
        continue;
      }
      try {
        const result = await uploadTest(problemId, await pair.input.text(), await pair.output.text());
        if (result.error) {
          notes.push(`${pair.input.name}: ${result.error}`);
          if (/at most|no longer|session/.test(result.error)) break; // no point in continuing
        } else {
          added++;
        }
      } catch {
        notes.push(`${pair.input.name}: the upload failed. Check your connection and try again.`);
        break;
      }
    }
    setProblems([...notes]);
    setProgress(`${added} test${added === 1 ? "" : "s"} added.`);
    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          void upload(event.target.files);
          event.target.value = "";
        }}
      />
      <button type="button" className="btn" disabled={busy} onClick={() => picker.current?.click()}>
        {busy ? "Uploading…" : "Upload test files"}
      </button>
      <p className="help">
        Select all the files at once. They are paired by name: <code>1.in</code> with <code>1.out</code> (or{" "}
        <code>.ans</code>), <code>input3.txt</code> with <code>output3.txt</code>. Uploaded tests start hidden; tick the
        ones students should see as examples.
      </p>
      {progress && (
        <p className="msg note" role="status">
          {progress}
        </p>
      )}
      {problems.length > 0 && (
        <ul className="msg warn" style={{ paddingLeft: "1.75rem" }}>
          {problems.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
