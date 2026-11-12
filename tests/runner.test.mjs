// Tests for the judge runner (judge/runner.py). They compile and run real programs,
// so they need g++ and python3 (and javac/java for the Java tests) on this computer.
//
//   npm test
//
// When run as root on Linux they also check that a submission cannot read the hidden tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, chmodSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(here, "..", "judge", "runner.py");
const isRoot = process.platform === "linux" && process.getuid?.() === 0;
const has = (tool) => spawnSync("which", [tool]).status === 0;
const hasCpp = has("g++");
const hasJava = has("javac") && has("java");
const JUDGE_UID = 61234;

let counter = 0;

/** A temporary folder the unprivileged judge user is allowed to walk through. */
function tempDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  chmodSync(dir, 0o711);
  return dir;
}

/** Runs one job through the runner and returns its result. */
function run(options) {
  const dir = tempDir("ahs-runner-test-");
  const work = options.work ?? path.join(dir, "work");
  try {
    const id = ++counter;
    const sourcePath = path.join(dir, `source-${id}`);
    const testsPath = path.join(dir, `tests-${id}.json.gz`);
    writeFileSync(sourcePath, options.source ?? "");
    if (options.tests) writeFileSync(testsPath, gzipSync(JSON.stringify(options.tests)));
    const job = {
      language: options.language,
      source_path: sourcePath,
      tests_path: options.tests ? testsPath : null,
      tests_key: options.key ?? `t${id}`,
      time_limit_ms: options.timeLimit ?? 2000,
      memory_limit_mb: options.memory ?? 256,
      checker: options.checker ?? "tokens",
      mode: options.mode ?? "judge",
      budget_ms: options.budget ?? 120000,
      uid: isRoot ? JUDGE_UID : null,
      work_dir: work,
      selftest: options.selftest ?? false,
    };
    const jobPath = path.join(dir, `job-${id}.json`);
    writeFileSync(jobPath, JSON.stringify(job));
    const child = spawnSync("python3", [RUNNER, jobPath], { encoding: "utf8", timeout: 180000 });
    const line = child.stdout.split("\n").find((l) => l.startsWith("@@RESULT@@"));
    assert.ok(line, `runner printed no result. stdout: ${child.stdout}\nstderr: ${child.stderr}`);
    return JSON.parse(line.slice("@@RESULT@@".length));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SUM_TESTS = [
  ["1 2\n", "3\n"],
  ["10 20\n", "30\n"],
  ["-5 5\n", "0\n"],
];

const SUM = {
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\nint main(){long long a,b;cin>>a>>b;cout<<a+b<<"\\n";}\n',
  python: "a, b = map(int, input().split())\nprint(a + b)\n",
  java: "import java.util.*;\npublic class Main { public static void main(String[] x) { Scanner s = new Scanner(System.in); System.out.println(s.nextLong() + s.nextLong()); } }\n",
};

for (const language of ["cpp", "python", "java"]) {
  const skip = (language === "cpp" && !hasCpp) || (language === "java" && !hasJava);

  test(`${language}: a correct solution is Accepted`, { skip }, () => {
    const r = run({ language, source: SUM[language], tests: SUM_TESTS });
    assert.equal(r.ok, true);
    assert.equal(r.verdict, "AC", JSON.stringify(r));
    assert.equal(r.passed, 3);
    assert.equal(r.total, 3);
    assert.equal(r.failed_test, null);
    assert.ok(r.memory_kb > 0);
  });
}

test("wrong answer stops at the first failing test", () => {
  const r = run({
    language: "python",
    source: "a, b = map(int, input().split())\nprint(a + b if a != 10 else 0)\n",
    tests: SUM_TESTS,
  });
  assert.equal(r.verdict, "WA");
  assert.equal(r.failed_test, 2);
  assert.equal(r.passed, 1);
  assert.equal(r.tests.length, 2);
});

test("'full' mode runs every test even after a failure", () => {
  const r = run({
    language: "python",
    source: "a, b = map(int, input().split())\nprint(a + b if a != 10 else 0)\n",
    tests: SUM_TESTS,
    mode: "full",
  });
  assert.equal(r.verdict, "WA");
  assert.equal(r.failed_test, 2);
  assert.equal(r.passed, 2);
  assert.equal(r.tests.length, 3);
});

test("extra whitespace and trailing newlines are ignored", () => {
  const r = run({
    language: "python",
    source: "print('  1   2  ')\nprint()\nprint('3   ')\nprint()\nprint()\n",
    tests: [["", "1 2\n3\n"]],
  });
  assert.equal(r.verdict, "AC", JSON.stringify(r));
});

test("letter case matters by default but not with the case-insensitive checker", () => {
  const source = "print('Yes')\n";
  assert.equal(run({ language: "python", source, tests: [["", "YES\n"]] }).verdict, "WA");
  assert.equal(run({ language: "python", source, tests: [["", "YES\n"]], checker: "tokens_ci" }).verdict, "AC");
});

test("the decimal checker accepts tiny differences only", () => {
  const source = "print('0.3333333 2')\n";
  assert.equal(run({ language: "python", source, tests: [["", "0.33333333 2\n"]], checker: "float" }).verdict, "AC");
  assert.equal(run({ language: "python", source, tests: [["", "0.34 2\n"]], checker: "float" }).verdict, "WA");
  assert.equal(run({ language: "python", source, tests: [["", "0.33333333 2\n"]] }).verdict, "WA");
});

test("compilation errors are reported with the compiler's message", { skip: !hasCpp }, () => {
  const r = run({ language: "cpp", source: "int main() { this is not c++ }\n", tests: SUM_TESTS });
  assert.equal(r.verdict, "CE");
  assert.match(r.compile_output, /error/);
  assert.equal(r.tests.length, 0);
});

test("a Python syntax error is a compilation error", () => {
  const r = run({ language: "python", source: "def broken(:\n  pass\n", tests: SUM_TESTS });
  assert.equal(r.verdict, "CE");
  assert.match(r.compile_output, /SyntaxError/);
});

test("a Java syntax error is a compilation error", { skip: !hasJava }, () => {
  const r = run({ language: "java", source: "public class Main { void x( { } }\n", tests: SUM_TESTS });
  assert.equal(r.verdict, "CE");
});

test("runtime errors: crash, non-zero exit and exceptions", { skip: !hasCpp }, () => {
  const crash = run({ language: "cpp", source: "int main(){ int *p = nullptr; *p = 1; return 0; }\n", tests: SUM_TESTS });
  assert.equal(crash.verdict, "RE");
  assert.equal(crash.failed_test, 1);
  const exit = run({ language: "cpp", source: "int main(){ return 3; }\n", tests: SUM_TESTS });
  assert.equal(exit.verdict, "RE");
  const py = run({ language: "python", source: "print(1 // 0)\n", tests: SUM_TESTS });
  assert.equal(py.verdict, "RE");
});

test("a Java exception is a runtime error", { skip: !hasJava }, () => {
  const r = run({
    language: "java",
    source: "public class Main { public static void main(String[] a) { int[] x = new int[1]; System.out.println(x[5]); } }\n",
    tests: SUM_TESTS,
  });
  assert.equal(r.verdict, "RE");
});

test("an endless loop is Time limit exceeded", { skip: !hasCpp }, () => {
  const r = run({
    language: "cpp",
    source: "int main(){ volatile unsigned long long x = 0; for(;;) x++; }\n",
    tests: SUM_TESTS,
    timeLimit: 500,
  });
  assert.equal(r.verdict, "TLE");
  assert.equal(r.failed_test, 1);
  assert.equal(r.time_ms, 500);
});

test("sleeping forever is also Time limit exceeded", () => {
  const r = run({ language: "python", source: "import time\ntime.sleep(60)\n", tests: SUM_TESTS, timeLimit: 500 });
  assert.equal(r.verdict, "TLE");
});

test("using too much memory is Memory limit exceeded", { skip: !hasCpp }, () => {
  const cpp = run({
    language: "cpp",
    source:
      "#include <bits/stdc++.h>\nint main(){ std::vector<std::vector<int>> v; for(int i=0;i<4000;i++){ v.emplace_back(1<<20, i); } std::cout<<v.size(); }\n",
    tests: SUM_TESTS,
    memory: 64,
  });
  assert.equal(cpp.verdict, "MLE", JSON.stringify(cpp));
  const py = run({ language: "python", source: "x = [0] * (10 ** 9)\nprint(len(x))\n", tests: SUM_TESTS, memory: 64 });
  assert.equal(py.verdict, "MLE", JSON.stringify(py));
});

test("Java running out of heap is Memory limit exceeded", { skip: !hasJava }, () => {
  const r = run({
    language: "java",
    source:
      "import java.util.*;\npublic class Main { public static void main(String[] a) { List<long[]> l = new ArrayList<>(); while (true) l.add(new long[1 << 20]); } }\n",
    tests: SUM_TESTS,
    memory: 64,
    timeLimit: 5000,
  });
  assert.equal(r.verdict, "MLE", JSON.stringify(r));
});

test("Java: the class does not have to be called Main, and packages work", { skip: !hasJava }, () => {
  const named = run({
    language: "java",
    source:
      "import java.util.*;\npublic class Solution { public static void main(String[] x) { Scanner s = new Scanner(System.in); System.out.println(s.nextLong() + s.nextLong()); } }\n",
    tests: SUM_TESTS,
  });
  assert.equal(named.verdict, "AC", JSON.stringify(named));
  const packaged = run({
    language: "java",
    source:
      "package team.demo;\nimport java.util.*;\npublic class Main { public static void main(String[] x) { Scanner s = new Scanner(System.in); System.out.println(s.nextLong() + s.nextLong()); } }\n",
    tests: SUM_TESTS,
  });
  assert.equal(packaged.verdict, "AC", JSON.stringify(packaged));
  const notPublic = run({
    language: "java",
    source:
      "import java.util.*;\nclass Helper {}\nclass Main { public static void main(String[] x) { Scanner s = new Scanner(System.in); System.out.println(s.nextLong() + s.nextLong()); } }\n",
    tests: SUM_TESTS,
  });
  assert.equal(notPublic.verdict, "AC", JSON.stringify(notPublic));
});

test("printing far too much output is rejected", () => {
  const r = run({
    language: "python",
    source: "import sys\nchunk = 'x' * (1 << 20)\nfor _ in range(200):\n    sys.stdout.write(chunk)\n",
    tests: [["", "x\n"]],
    timeLimit: 5000,
  });
  assert.ok(["RE", "WA"].includes(r.verdict), JSON.stringify(r));
});

test("'examples' mode returns the program's output for every test", () => {
  const r = run({
    language: "python",
    source: "import sys\na, b = map(int, input().split())\nprint(a + b)\nprint('debug', file=sys.stderr)\n",
    tests: SUM_TESTS,
    mode: "examples",
  });
  assert.equal(r.verdict, "AC");
  assert.equal(r.tests.length, 3);
  assert.equal(r.tests[0].stdout.trim(), "3");
  assert.match(r.tests[0].stderr, /debug/);
});

test("ordinary judging never returns program output", () => {
  const r = run({ language: "python", source: SUM.python, tests: SUM_TESTS });
  assert.equal(r.tests[0].stdout, undefined);
});

test("the test data is cached between jobs and requested when missing", () => {
  const dir = tempDir("ahs-runner-cache-");
  const work = path.join(dir, "work");
  try {
    const first = run({ language: "python", source: SUM.python, tests: SUM_TESTS, key: "p1-v1", work });
    assert.equal(first.verdict, "AC");
    const second = run({ language: "python", source: SUM.python, key: "p1-v1", work });
    assert.equal(second.verdict, "AC", "second job should reuse the cached tests");
    const missing = run({ language: "python", source: SUM.python, key: "p1-v2", work });
    assert.equal(missing.ok, false);
    assert.equal(missing.need_tests, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("processes left running in the background are cleaned up", () => {
  const r = run({
    language: "python",
    source:
      "import os, sys, time\nif os.fork() == 0:\n    os.setsid()\n    time.sleep(300)\n    sys.exit(0)\na, b = map(int, input().split())\nprint(a + b)\n",
    tests: SUM_TESTS,
  });
  assert.equal(r.verdict, "AC", JSON.stringify(r));
  if (isRoot) {
    const left = spawnSync("pgrep", ["-u", String(JUDGE_UID)], { encoding: "utf8" });
    assert.equal(left.stdout.trim(), "", "no judge-user processes should survive");
  }
});

test("a fork bomb cannot take the judge down", { skip: !isRoot }, () => {
  const r = run({
    language: "python",
    source: "import os\nwhile True:\n    try:\n        os.fork()\n    except OSError:\n        pass\n",
    tests: SUM_TESTS,
    timeLimit: 1000,
  });
  assert.ok(["TLE", "RE", "MLE"].includes(r.verdict), JSON.stringify(r));
  const left = spawnSync("pgrep", ["-u", String(JUDGE_UID)], { encoding: "utf8" });
  assert.equal(left.stdout.trim(), "");
});

test("a submission cannot read the hidden tests", { skip: !isRoot }, () => {
  const dir = tempDir("ahs-runner-secret-");
  const work = path.join(dir, "work");
  try {
    // The program tries to open the judge's private files, list its folders, read the
    // judge process's memory and environment, and use any file handles it inherited.
    const secretDir = path.join(work, "secret");
    const source = `
import os, sys
parent = os.getppid()
opened = []
for target in [
    ${JSON.stringify(secretDir)} + "/tests-secret-test.json.gz",
    ${JSON.stringify(secretDir)} + "/input.txt",
    ${JSON.stringify(secretDir)} + "/stdout.txt",
    "/proc/%d/environ" % parent,
    "/proc/%d/mem" % parent,
]:
    try:
        with open(target, "rb") as handle:
            handle.read(16)
        opened.append(target)
    except Exception:
        pass
for folder in [${JSON.stringify(work)}, ${JSON.stringify(secretDir)}, "/proc/%d/fd" % parent]:
    try:
        os.listdir(folder)
        opened.append("listed " + folder)
    except Exception:
        pass
for fd in range(3, 64):
    try:
        os.fstat(fd)
        opened.append("inherited fd %d" % fd)
    except OSError:
        pass
try:
    os.setuid(0)
    opened.append("became root")
except Exception:
    pass
print("LEAK" if opened else "safe")
print(opened, file=sys.stderr)
`;
    const r = run({
      language: "python",
      source,
      tests: [["question\n", "SECRET-EXPECTED-OUTPUT-12345\n"]],
      mode: "examples",
      work,
      key: "secret-test",
    });
    assert.equal(r.tests[0].stdout.trim(), "safe", "the submission reached private data: " + r.tests[0].stderr);
    assert.equal(r.verdict, "WA");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the compiler cannot be used to leak the hidden tests", { skip: !isRoot || !hasCpp }, () => {
  const dir = tempDir("ahs-runner-include-");
  const work = path.join(dir, "work");
  try {
    // Put the tests in the cache first, then submit code that #includes the cached file.
    run({ language: "python", source: SUM.python, tests: [["1 2\n", "LEAKME-777\n"]], key: "inc", work });
    const cached = path.join(work, "secret", "tests-inc.json.gz");
    assert.ok(existsSync(cached), "the cache file should exist");
    const r = run({
      language: "cpp",
      source: `#include "${cached}"\nint main(){}\n`,
      key: "inc",
      work,
    });
    assert.equal(r.verdict, "CE");
    assert.doesNotMatch(r.compile_output, /LEAKME/);
    assert.match(r.compile_output, /Permission denied|No such file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the built-in self-test passes for every installed language", () => {
  const r = run({ language: "python", selftest: true });
  assert.equal(r.ok, true);
  assert.equal(r.languages.python.ok, true, r.languages.python.message);
  if (hasCpp) assert.equal(r.languages.cpp.ok, true, r.languages.cpp.message);
  if (hasJava) assert.equal(r.languages.java.ok, true, r.languages.java.message);
  if (isRoot) {
    assert.equal(r.isolated, true);
    assert.equal(r.secret_safe, true);
  }
});
