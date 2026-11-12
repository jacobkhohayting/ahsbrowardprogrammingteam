#!/usr/bin/env python3
"""
The judge runner. It compiles one submission and runs it against test cases.

    python3 runner.py job.json          ->  prints one line of JSON (the result)

It is started as root inside a throw-away Vercel Sandbox (or as a normal user on
a developer's own computer). Everything that touches the submitted code - the
compiler and the program itself - runs:

  * as an unprivileged user that cannot read the test data or become root,
  * in its own session, so every process it starts can be killed afterwards,
  * with CPU-time, memory, process-count, file-size and open-file limits.

The test inputs and expected outputs are kept in a directory only root can
read. A submission receives its input on standard input and nothing else.

Only the Python standard library is used, and nothing newer than Python 3.9.
"""
import gzip
import json
import os
import re
import resource
import shutil
import signal
import stat
import sys
import time

MB = 1024 * 1024
OOM_PATTERNS = re.compile(
    rb"bad_alloc|MemoryError|OutOfMemoryError|Cannot allocate memory|out of memory", re.I
)
SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
MAX_OUTPUT_BYTES = 64 * MB
COMPILE_OUTPUT_LIMIT = 12000

SELF_TEST_SOURCES = {
    "cpp": '#include <bits/stdc++.h>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}\n',
    "python": "a, b = map(int, input().split())\nprint(a + b)\n",
    "java": (
        "import java.util.*;\npublic class Main {\n  public static void main(String[] args) {\n"
        "    Scanner s = new Scanner(System.in);\n    System.out.println(s.nextLong() + s.nextLong());\n  }\n}\n"
    ),
}


class JudgeFailure(Exception):
    """Something went wrong with the judge itself (not the submission)."""


# ---------------------------------------------------------------------------
# Running one process with limits
# ---------------------------------------------------------------------------
def processes_of(uid):
    """PIDs of every process owned by `uid` (Linux only)."""
    found = []
    try:
        names = os.listdir("/proc")
    except OSError:
        return found
    for name in names:
        if not name.isdigit():
            continue
        try:
            if os.stat("/proc/" + name).st_uid == uid:
                found.append(int(name))
        except OSError:
            pass
    return found


def kill_user_processes(uid):
    """Kill everything owned by the dedicated judge user, however it tried to hide."""
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        remaining = processes_of(uid)
        if not remaining:
            return
        for other in remaining:
            try:
                os.kill(other, signal.SIGKILL)
            except OSError:
                pass
        time.sleep(0.01)


def kill_everything(pid, uid):
    """Kill a process group and, when running as a dedicated user, everything that user owns."""
    for target in (lambda: os.killpg(pid, signal.SIGKILL), lambda: os.kill(pid, signal.SIGKILL)):
        try:
            target()
        except OSError:
            pass
    if uid is not None:
        kill_user_processes(uid)


def set_limit(kind, value):
    try:
        resource.setrlimit(kind, (value, value))
    except (ValueError, OSError):
        pass  # not supported on this system (for example macOS during development)


def run_limited(cmd, cwd, env, stdin_path, stdout_path, stderr_path, uid,
                cpu_seconds, wall_seconds, memory_bytes=None, stack_bytes=None,
                max_processes=64, max_file_bytes=MAX_OUTPUT_BYTES, max_open_files=64):
    """Run `cmd` to completion under limits. Returns a dict describing how it ended."""
    stdin_fd = os.open(stdin_path or os.devnull, os.O_RDONLY)
    stdout_fd = os.open(stdout_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    stderr_fd = os.open(stderr_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)

    started = time.monotonic()
    pid = os.fork()
    if pid == 0:
        # ---- child: becomes the submitted program ----
        try:
            os.setsid()
            os.dup2(stdin_fd, 0)
            os.dup2(stdout_fd, 1)
            os.dup2(stderr_fd, 2)
            os.closerange(3, 1024)
            os.chdir(cwd)
            set_limit(resource.RLIMIT_CORE, 0)
            set_limit(resource.RLIMIT_CPU, cpu_seconds)
            set_limit(resource.RLIMIT_FSIZE, max_file_bytes)
            set_limit(resource.RLIMIT_NOFILE, max_open_files)
            if stack_bytes:
                set_limit(resource.RLIMIT_STACK, stack_bytes)
            if memory_bytes:
                set_limit(resource.RLIMIT_AS, memory_bytes)
            if uid is not None:
                set_limit(resource.RLIMIT_NPROC, max_processes)
                os.setgroups([])
                os.setgid(uid)
                os.setuid(uid)
            os.execvpe(cmd[0], cmd, env)
        except BaseException as error:  # noqa: B902 - we must never return into the parent's code
            try:
                os.write(2, ("[judge] could not start the program: %s\n" % error).encode())
            except OSError:
                pass
        finally:
            os._exit(125)

    # ---- parent ----
    for fd in (stdin_fd, stdout_fd, stderr_fd):
        os.close(fd)

    state = {"timed_out": False}

    def on_alarm(_signum, _frame):
        state["timed_out"] = True
        kill_everything(pid, uid)

    previous = signal.signal(signal.SIGALRM, on_alarm)
    signal.setitimer(signal.ITIMER_REAL, max(0.05, wall_seconds))
    try:
        _, status, usage = os.wait4(pid, 0)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
    wall_ms = int((time.monotonic() - started) * 1000)
    kill_everything(pid, uid)  # anything it left running in the background

    max_rss_kb = int(usage.ru_maxrss)
    if sys.platform == "darwin":
        max_rss_kb //= 1024  # macOS reports bytes
    result = {
        "exit_code": None,
        "signal": None,
        "timed_out": state["timed_out"],
        "cpu_ms": int((usage.ru_utime + usage.ru_stime) * 1000),
        "wall_ms": wall_ms,
        "max_rss_kb": max_rss_kb,
    }
    if os.WIFSIGNALED(status):
        result["signal"] = os.WTERMSIG(status)
    else:
        result["exit_code"] = os.WEXITSTATUS(status)
    return result


def read_capped(path, cap):
    try:
        with open(path, "rb") as handle:
            return handle.read(cap)
    except OSError:
        return b""


# ---------------------------------------------------------------------------
# Languages
# ---------------------------------------------------------------------------
def java_names(source):
    """(file name without .java, class to run). Follows the public class, like javac requires."""
    without_comments = re.sub(r"//[^\n]*|/\*.*?\*/", " ", source, flags=re.S)
    package = re.search(r"^\s*package\s+([A-Za-z_][\w.]*)\s*;", without_comments, re.M)
    public = re.search(
        r"\bpublic\s+(?:(?:final|abstract|strictfp)\s+)*class\s+([A-Za-z_$][\w$]*)", without_comments
    )
    first = re.search(r"\bclass\s+([A-Za-z_$][\w$]*)", without_comments)
    name = public.group(1) if public else "Main"
    main_class = public.group(1) if public else (first.group(1) if first else "Main")
    if not public and re.search(r"\bclass\s+Main\b", without_comments):
        main_class = "Main"
    if package:
        main_class = package.group(1) + "." + main_class
    return name, main_class


class Language:
    def __init__(self, job, source):
        self.kind = job["language"]
        self.tools = job.get("tools") or {}
        self.memory_mb = int(job.get("memory_limit_mb") or 256)
        if self.kind == "cpp":
            self.source_name = "main.cpp"
        elif self.kind == "python":
            self.source_name = "main.py"
        elif self.kind == "java":
            self.file_stem, self.main_class = java_names(source)
            self.source_name = self.file_stem + ".java"
        else:
            raise JudgeFailure("Unknown language: %s" % self.kind)

    def tool(self, name, default):
        return self.tools.get(name) or default

    def compile_command(self):
        if self.kind == "cpp":
            command = [self.tool("cxx", "g++"), "-std=gnu++20", "-O2", "-pipe", "-DONLINE_JUDGE"]
            # An optional folder holding a precompiled <bits/stdc++.h>, which makes compiling much faster.
            precompiled = self.tools.get("cxx_pch_dir")
            if precompiled and os.path.isdir(precompiled):
                command += ["-I", precompiled]
            return command + ["-o", "prog", "main.cpp"]
        if self.kind == "python":
            return [self.tool("python", "python3"), "-m", "py_compile", "main.py"]
        return [self.tool("javac", "javac"), "-encoding", "UTF-8", "-d", ".", self.source_name]

    def compile_limits(self):
        if self.kind == "java":
            return dict(cpu_seconds=40, wall_seconds=60, memory_bytes=None, max_processes=256,
                        max_file_bytes=256 * MB, max_open_files=512)
        return dict(cpu_seconds=40, wall_seconds=60, memory_bytes=1536 * MB, max_processes=64,
                    max_file_bytes=256 * MB, max_open_files=256)

    def run_command(self):
        if self.kind == "cpp":
            return ["./prog"]
        if self.kind == "python":
            return [self.tool("python", "python3"), "main.py"]
        return [self.tool("java", "java"), "-Xmx%dm" % self.memory_mb, "-Xss64m", "-XX:+UseSerialGC",
                "-XX:-UsePerfData", "-Dfile.encoding=UTF-8", "-cp", ".", self.main_class]

    def run_limits(self, time_limit_ms):
        cpu_seconds = time_limit_ms // 1000 + 2
        wall_seconds = max(time_limit_ms * 2, time_limit_ms + 1500) / 1000.0
        if self.kind == "java":
            # The JVM reserves huge virtual ranges, so its memory is capped with -Xmx instead.
            return dict(cpu_seconds=cpu_seconds, wall_seconds=wall_seconds, memory_bytes=None,
                        stack_bytes=None, max_processes=256, max_open_files=256)
        headroom = 64 if self.kind == "cpp" else 160
        return dict(cpu_seconds=cpu_seconds, wall_seconds=wall_seconds,
                    memory_bytes=(self.memory_mb + headroom) * MB,
                    stack_bytes=min(self.memory_mb, 1024) * MB,
                    max_processes=64, max_open_files=64)


# ---------------------------------------------------------------------------
# Comparing output
# ---------------------------------------------------------------------------
def outputs_match(expected, actual, checker):
    a = expected.split()
    b = actual.split()
    if len(a) != len(b):
        return False
    if checker == "tokens_ci":
        return [t.lower() for t in a] == [t.lower() for t in b]
    if checker == "float":
        for x, y in zip(a, b):
            if x == y:
                continue
            try:
                fx, fy = float(x), float(y)
            except ValueError:
                return False
            if fx != fx or fy != fy:  # NaN never matches
                return False
            if abs(fx - fy) > 1e-6 * max(1.0, abs(fx)):
                return False
        return True
    return a == b


# ---------------------------------------------------------------------------
# The workspace: a private area for the judge and a box for the submission
# ---------------------------------------------------------------------------
class Workspace:
    def __init__(self, root, uid):
        self.root = root
        self.uid = uid
        self.secret = os.path.join(root, "secret")
        self.box = os.path.join(root, "box")
        os.makedirs(self.root, exist_ok=True)
        os.chmod(self.root, 0o711)
        os.makedirs(self.secret, exist_ok=True)
        os.chmod(self.secret, 0o700)

    def reset_box(self):
        self.clean()
        os.makedirs(self.box)
        os.chmod(self.box, 0o700)

    def give_box_to_program(self):
        if self.uid is None:
            return
        for directory, _dirs, files in os.walk(self.box):
            os.chown(directory, self.uid, self.uid)
            for name in files:
                os.chown(os.path.join(directory, name), self.uid, self.uid)

    def clean(self):
        """Remove everything the submission may have left behind."""
        if self.uid is not None:
            kill_user_processes(self.uid)
        shutil.rmtree(self.box, ignore_errors=True)
        if self.uid is not None:
            for shared in ("/tmp", "/var/tmp", "/dev/shm"):
                self._remove_owned(shared)

    def _remove_owned(self, top):
        try:
            entries = os.listdir(top)
        except OSError:
            return
        for name in entries:
            path = os.path.join(top, name)
            try:
                info = os.lstat(path)
            except OSError:
                continue
            if info.st_uid != self.uid:
                continue
            if stat.S_ISDIR(info.st_mode):
                shutil.rmtree(path, ignore_errors=True)
            else:
                try:
                    os.unlink(path)
                except OSError:
                    pass

    def program_env(self):
        return {
            "PATH": SAFE_PATH,
            "HOME": self.box,
            "TMPDIR": self.box,
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "PYTHONIOENCODING": "utf-8",
        }


def compile_submission(ws, lang, source):
    """Returns (ok, compiler_output, is_judge_problem)."""
    ws.reset_box()
    with open(os.path.join(ws.box, lang.source_name), "w", encoding="utf-8", newline="\n") as handle:
        handle.write(source)
    ws.give_box_to_program()
    out_path = os.path.join(ws.secret, "compile.out")
    err_path = os.path.join(ws.secret, "compile.err")
    try:
        result = run_limited(lang.compile_command(), ws.box, ws.program_env(), None, out_path, err_path,
                             ws.uid, **lang.compile_limits())
    except OSError as error:
        return False, "The compiler could not be started: %s" % error, True
    output = (read_capped(out_path, COMPILE_OUTPUT_LIMIT) + read_capped(err_path, COMPILE_OUTPUT_LIMIT))
    text = output.decode("utf-8", errors="replace").strip()
    if result["exit_code"] == 125 and "[judge] could not start" in text:
        return False, text, True
    if result["timed_out"] or result["signal"] == signal.SIGXCPU:
        return False, ("Compilation took too long.\n" + text).strip(), False
    if result["signal"] is not None:
        return False, ("The compiler was stopped (signal %d). It may have run out of memory.\n" % result["signal"]
                       + text).strip(), False
    if result["exit_code"] != 0:
        return False, text or "The compiler exited with code %d." % result["exit_code"], False
    return True, text, False


def run_test(ws, lang, test_input, expected, time_limit_ms, checker, keep_output):
    in_path = os.path.join(ws.secret, "input.txt")
    out_path = os.path.join(ws.secret, "stdout.txt")
    err_path = os.path.join(ws.secret, "stderr.txt")
    with open(in_path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(test_input)

    result = run_limited(lang.run_command(), ws.box, ws.program_env(), in_path, out_path, err_path,
                         ws.uid, **lang.run_limits(time_limit_ms))

    memory_limit_kb = lang.memory_mb * 1024
    stderr = read_capped(err_path, 8192)
    crashed = result["signal"] is not None or result["exit_code"] != 0
    out = {
        "verdict": "JE",
        "time_ms": min(result["cpu_ms"], time_limit_ms) if result["timed_out"] else result["cpu_ms"],
        "memory_kb": result["max_rss_kb"],
        "detail": "",
    }
    java_slack_kb = 320 * 1024 if lang.kind == "java" else 0

    if result["exit_code"] == 125 and b"[judge] could not start" in stderr:
        out["detail"] = stderr.decode("utf-8", errors="replace")[:500]
    elif result["timed_out"] or result["cpu_ms"] > time_limit_ms or result["signal"] == signal.SIGXCPU:
        out["verdict"] = "TLE"
        out["time_ms"] = time_limit_ms
    elif result["max_rss_kb"] > memory_limit_kb + java_slack_kb:
        out["verdict"] = "MLE"
    elif crashed and OOM_PATTERNS.search(stderr):
        out["verdict"] = "MLE"
    elif result["signal"] == signal.SIGKILL:
        out["verdict"] = "MLE"  # killed without a timeout: the system ran out of memory
    elif result["signal"] == signal.SIGXFSZ:
        out["verdict"] = "RE"
        out["detail"] = "Output limit exceeded"
    elif result["signal"] is not None:
        out["verdict"] = "RE"
        out["detail"] = "Killed by signal %d" % result["signal"]
    elif result["exit_code"] != 0:
        out["verdict"] = "RE"
        out["detail"] = "Exit code %d" % result["exit_code"]
    else:
        actual = read_capped(out_path, MAX_OUTPUT_BYTES + 1)
        if len(actual) > MAX_OUTPUT_BYTES:
            out["verdict"] = "RE"
            out["detail"] = "Output limit exceeded"
        else:
            ok = outputs_match(expected.encode("utf-8"), actual, checker)
            out["verdict"] = "AC" if ok else "WA"

    if keep_output:
        out["stdout"] = read_capped(out_path, 6000).decode("utf-8", errors="replace")
        out["stdout_truncated"] = os.path.getsize(out_path) > 6000 if os.path.exists(out_path) else False
        out["stderr"] = stderr[:3000].decode("utf-8", errors="replace")
    return out


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------
def load_tests(ws, job):
    """Tests are cached in the private directory, keyed by problem and version."""
    key = re.sub(r"[^A-Za-z0-9_.-]", "_", str(job.get("tests_key") or "tests"))
    cached = os.path.join(ws.secret, "tests-%s.json.gz" % key)
    incoming = job.get("tests_path")
    if incoming:
        shutil.copyfile(incoming, cached)
        os.chmod(cached, 0o600)
        try:
            os.unlink(incoming)
        except OSError:
            pass
    if not os.path.exists(cached):
        return None
    with gzip.open(cached, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def judge(job):
    uid = job.get("uid")
    if uid is not None and os.geteuid() != 0:
        uid = None  # cannot switch users without root (development on a laptop)
    ws = Workspace(job["work_dir"], uid)

    with open(job["source_path"], "r", encoding="utf-8", errors="replace") as handle:
        source = handle.read()
    try:
        os.unlink(job["source_path"])
    except OSError:
        pass

    tests = load_tests(ws, job)
    if tests is None:
        return {"ok": False, "need_tests": True, "error": "The test data is not in this sandbox yet."}

    mode = job.get("mode") or "judge"
    time_limit_ms = int(job["time_limit_ms"])
    checker = job.get("checker") or "tokens"
    budget_seconds = float(job.get("budget_ms") or 150000) / 1000.0
    started = time.monotonic()

    lang = Language(job, source)
    result = {"ok": True, "verdict": "JE", "failed_test": None, "passed": 0, "total": len(tests),
              "time_ms": 0, "memory_kb": 0, "compile_output": "", "tests": [], "message": "",
              "isolated": uid is not None}
    try:
        compiled, output, judge_problem = compile_submission(ws, lang, source)
        result["compile_output"] = output[:COMPILE_OUTPUT_LIMIT]
        if not compiled:
            result["verdict"] = "JE" if judge_problem else "CE"
            if judge_problem:
                result["message"] = output[:500]
            return result
        if not tests:
            result["message"] = "This problem has no tests."
            return result

        verdict = "AC"
        wall_per_test = lang.run_limits(time_limit_ms)["wall_seconds"]
        for index, test in enumerate(tests, start=1):
            if time.monotonic() - started + wall_per_test > budget_seconds:
                result["message"] = ("The judge ran out of time after %d of %d tests. Use fewer tests or a "
                                     "shorter time limit for this problem." % (index - 1, len(tests)))
                if verdict == "AC":
                    verdict = "JE"
                break
            one = run_test(ws, lang, test[0], test[1], time_limit_ms, checker, mode == "examples")
            one["test"] = index
            result["tests"].append(one)
            result["time_ms"] = max(result["time_ms"], one["time_ms"])
            result["memory_kb"] = max(result["memory_kb"], one["memory_kb"])
            if one["verdict"] == "AC":
                result["passed"] += 1
                continue
            if one["verdict"] == "JE":
                result["message"] = one["detail"]
            if verdict == "AC":
                verdict = one["verdict"]
                result["failed_test"] = index
            if mode == "judge" or one["verdict"] == "JE":
                break
        result["verdict"] = verdict
        return result
    finally:
        ws.clean()


def tool_version(command):
    """First line a tool prints for --version (or -version for Java)."""
    for flag in ("--version", "-version"):
        try:
            read_end, write_end = os.pipe()
            pid = os.fork()
            if pid == 0:
                try:
                    os.dup2(write_end, 1)
                    os.dup2(write_end, 2)
                    os.closerange(3, 256)
                    os.execvpe(command, [command, flag], {"PATH": SAFE_PATH, "LANG": "C.UTF-8"})
                finally:
                    os._exit(127)
            os.close(write_end)
            with os.fdopen(read_end, "rb") as handle:
                text = handle.read(4000).decode("utf-8", errors="replace")
            _, status = os.waitpid(pid, 0)
            if os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0 and text.strip():
                return text.strip().splitlines()[0]
        except OSError:
            pass
    return ""


def self_test(job):
    """Compile and run a tiny program in every language, and check the isolation."""
    uid = job.get("uid")
    if uid is not None and os.geteuid() != 0:
        uid = None
    ws = Workspace(job["work_dir"], uid)
    tools = job.get("tools") or {}
    report = {"ok": True, "selftest": True, "isolated": uid is not None, "languages": {}, "secret_safe": None}
    version_tools = {"cpp": tools.get("cxx") or "g++", "python": tools.get("python") or "python3",
                     "java": tools.get("java") or "java"}
    try:
        for kind, source in SELF_TEST_SOURCES.items():
            entry = {"ok": False, "message": "", "version": tool_version(version_tools[kind])}
            report["languages"][kind] = entry
            try:
                lang = Language({"language": kind, "tools": tools, "memory_limit_mb": 256}, source)
                compiled, output, _ = compile_submission(ws, lang, source)
                if not compiled:
                    entry["message"] = "Could not compile: " + output[:400]
                    continue
                one = run_test(ws, lang, "2 3\n", "5\n", 4000, "tokens", True)
                if one["verdict"] == "AC":
                    entry["ok"] = True
                    entry["message"] = "OK (%d ms, %d MB)" % (one["time_ms"], max(1, one["memory_kb"] // 1024))
                else:
                    entry["message"] = ("Test program got %s. %s %s" % (
                        one["verdict"], one.get("detail", ""), one.get("stderr", "")[:300])).strip()
            except Exception as error:  # noqa: BLE001 - report, do not crash the self-test
                entry["message"] = "Error: %s" % error

        # A submission must not be able to read the judge's private files.
        if uid is not None and report["languages"].get("python", {}).get("ok"):
            marker = os.path.join(ws.secret, "marker.txt")
            with open(marker, "w") as handle:
                handle.write("top-secret-marker")
            probe = (
                "import sys\n"
                "try:\n    print(open(%r).read())\n"
                "except Exception as e:\n    print('blocked')\n" % marker
            )
            lang = Language({"language": "python", "tools": tools, "memory_limit_mb": 256}, probe)
            compiled, _, _ = compile_submission(ws, lang, probe)
            if compiled:
                one = run_test(ws, lang, "", "blocked\n", 4000, "tokens", True)
                report["secret_safe"] = one["verdict"] == "AC"
            os.unlink(marker)
        return report
    finally:
        ws.clean()


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"ok": False, "error": "usage: runner.py job.json"}))
        return
    try:
        with open(sys.argv[1], "r", encoding="utf-8") as handle:
            job = json.load(handle)
        result = self_test(job) if job.get("selftest") else judge(job)
    except JudgeFailure as error:
        result = {"ok": False, "error": str(error)}
    except Exception as error:  # noqa: BLE001 - always answer with JSON
        result = {"ok": False, "error": "%s: %s" % (type(error).__name__, error)}
    sys.stdout.write("\n@@RESULT@@" + json.dumps(result) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
