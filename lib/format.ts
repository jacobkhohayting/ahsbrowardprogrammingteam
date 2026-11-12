// Small helpers shared by server and browser code. No imports, no secrets.

export type Language = "cpp" | "python" | "java";
export const LANGUAGE_KEYS: readonly Language[] = ["cpp", "python", "java"];

/** Names used when the judge has not reported its real compiler versions yet. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  cpp: "C++20 (GCC)",
  python: "Python 3",
  java: "Java",
};

export const LANGUAGE_EXTENSIONS: Record<Language, string> = { cpp: "cpp", python: "py", java: "java" };

export function isLanguage(value: unknown): value is Language {
  return value === "cpp" || value === "python" || value === "java";
}

export type Verdict = "AC" | "WA" | "CE" | "RE" | "TLE" | "MLE" | "JE";

export const VERDICT_NAMES: Record<Verdict, string> = {
  AC: "Accepted",
  WA: "Wrong answer",
  CE: "Compilation error",
  RE: "Runtime error",
  TLE: "Time limit exceeded",
  MLE: "Memory limit exceeded",
  JE: "Judge error",
};

export const CHECKERS = {
  tokens: "Standard: ignore extra spaces and blank lines",
  tokens_ci: "Standard, and also ignore upper/lower case (YES = yes)",
  float: "Numbers may differ by up to 0.000001",
} as const;
export type Checker = keyof typeof CHECKERS;

export const LEADERBOARD_TYPES = ["short", "long", "adaptive"] as const;
export type LeaderboardType = (typeof LEADERBOARD_TYPES)[number];

export const LEADERBOARD_HELP: Record<LeaderboardType, string> = {
  short: "Most problems solved wins. Ties go to whoever got their last accepted solution earliest.",
  long: "Most problems solved wins, then the lowest penalty. Penalty = minutes from the start to each accepted solution, plus a fixed amount for every rejected attempt on a problem that was later solved.",
  adaptive:
    "Every problem starts at its maximum points and loses a fixed amount each minute of the contest (never below zero). Highest total wins; ties go to the earlier last accepted solution.",
};

export type Phase = "upcoming" | "running" | "ended";

export function contestPhase(startAt: Date | string, endAt: Date | string, now: number = Date.now()): Phase {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (now < start) return "upcoming";
  if (now < end) return "running";
  return "ended";
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function problemLabel(index: number): string {
  let label = "";
  let i = index;
  do {
    label = String.fromCharCode(65 + (i % 26)) + label;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return label;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 3725 -> "1:02:05". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(s % 60)}` : `${pad(minutes)}:${pad(s % 60)}`;
}

/** 150 -> "2 h 30 min". */
export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  if (hours < 48) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} days${hours % 24 ? ` ${hours % 24} h` : ""}`;
}

export function formatMemory(kb: number | null | undefined): string {
  if (kb == null) return "";
  return `${Math.max(1, Math.round(kb / 1024))} MB`;
}

export function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(2).replace(/\.?0+$/, "");
}

/** "Nov 14, 2026, 3:30 PM EST" in the given time zone. */
export function formatInZone(date: Date | string, timeZone: string, withYear = true): string {
  const d = new Date(date);
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: withYear ? "numeric" : undefined,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const STARTER_CODE: Record<Language, string> = {
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    return 0;
}
`,
  python: `import sys
input = sys.stdin.readline

`,
  java: `import java.util.*;
import java.io.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));

    }
}
`,
};

export const STATEMENT_TEMPLATE = `Describe the problem here. You can use **Markdown** and math like $1 \\le n \\le 10^5$.

## Input

What the program reads.

## Output

What the program should print.

## Constraints

- $1 \\le n \\le 100$
`;
