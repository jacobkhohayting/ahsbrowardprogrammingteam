"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getViewer, requireAdmin } from "../auth";
import { q, q1, tx, type Tx } from "../db";
import { UserError } from "../errors";
import { checkbox, formAction, id, number, oneOf, text } from "../form";
import { CHECKERS, LANGUAGE_KEYS, STATEMENT_TEMPLATE, type Checker } from "../format";
import { requeue, scheduleDrain } from "../judge/queue";

const MAX_TESTS = 200;
const MAX_TEST_BYTES = 3_500_000; // one test (input + output); requests to Vercel are capped at 4.5 MB
const MAX_PROBLEM_BYTES = 16 * 1024 * 1024; // all tests of one problem together

export const addProblem = formAction(async (form) => {
  await requireAdmin();
  const contestId = id(form, "contest_id", "contest");
  const title = text(form, "title", { name: "Problem title", min: 1, max: 200 });
  const row = await q1<{ id: number }>(
    `insert into problems (contest_id, ord, title, statement)
     select c.id, coalesce((select max(ord) + 1 from problems where contest_id = c.id), 0), $2, $3
     from contests c where c.id = $1
     returning id`,
    [contestId, title, STATEMENT_TEMPLATE],
  );
  if (!row) throw new UserError("This contest no longer exists.");
  redirect(`/admin/problems/${row.id}`);
});

export const saveProblem = formAction(async (form) => {
  await requireAdmin();
  const problemId = id(form, "id", "problem");
  const values = [
    problemId,
    text(form, "title", { name: "Title", min: 1, max: 200 }),
    text(form, "statement", { name: "Statement", max: 200_000, trim: false }),
    text(form, "editorial", { name: "Editorial", max: 200_000, trim: false }),
    text(form, "solution_code", { name: "Reference solution", max: 200_000, trim: false }),
    oneOf(form, "solution_language", LANGUAGE_KEYS, "language"),
    number(form, "time_limit_ms", { name: "Time limit", min: 100, max: 15000, integer: true }),
    number(form, "memory_limit_mb", { name: "Memory limit", min: 16, max: 1024, integer: true }),
    oneOf(form, "checker", Object.keys(CHECKERS) as Checker[], "way to compare output"),
    number(form, "points", { name: "Maximum points", min: 0, max: 1e9, fallback: 100 }),
  ];
  const updated = await q(
    `update problems set title = $2, statement = $3, editorial = $4, solution_code = $5, solution_language = $6,
            time_limit_ms = $7, memory_limit_mb = $8, checker = $9, points = $10
     where id = $1 returning id`,
    values,
  );
  if (updated.length === 0) throw new UserError("This problem no longer exists.");
  refresh();
  return { ok: "Problem saved." };
});

/** Deletes a problem with its tests and every submission made to it. */
export const deleteProblem = formAction(async (form) => {
  await requireAdmin();
  const problemId = id(form, "id", "problem");
  const row = await q1<{ contest_id: number }>("delete from problems where id = $1 returning contest_id", [problemId]);
  redirect(row ? `/admin/contests/${row.contest_id}` : "/admin/contests");
});

/** Renumbers rows 0..n-1 in their current order, then swaps one with its neighbor. */
async function move(t: Tx, table: "problems" | "tests", parent: string, rowId: number, direction: number) {
  const row = await t.q1<{ parent: number }>(`select ${parent} as parent from ${table} where id = $1`, [rowId]);
  if (!row) throw new UserError("That item no longer exists.");
  // Tests are always listed (and judged) with the examples first.
  const order = table === "tests" ? "is_example desc, ord, id" : "ord, id";
  const ids = (
    await t.q<{ id: number }>(`select id from ${table} where ${parent} = $1 order by ${order}`, [row.parent])
  ).map((r) => r.id);
  const from = ids.indexOf(rowId);
  const to = from + direction;
  if (to >= 0 && to < ids.length) [ids[from], ids[to]] = [ids[to], ids[from]];
  await t.q(
    `update ${table} set ord = position.ord - 1
     from unnest($1::int[]) with ordinality as position(id, ord)
     where ${table}.id = position.id`,
    [ids],
  );
  return row.parent;
}

export const moveProblem = formAction(async (form) => {
  await requireAdmin();
  const problemId = id(form, "id", "problem");
  const direction = form.get("direction") === "up" ? -1 : 1;
  await tx((t) => move(t, "problems", "contest_id", problemId, direction));
  refresh();
  return null;
});

export const rejudgeProblem = formAction(async (form) => {
  await requireAdmin();
  const problemId = id(form, "id", "problem");
  const count = await requeue("problem_id = $1", [problemId]);
  if (count > 0) await scheduleDrain();
  refresh();
  return { ok: count === 0 ? "There is nothing to rejudge." : `${count} submission${count === 1 ? "" : "s"} queued.` };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
const bytes = (value: string) => Buffer.byteLength(value, "utf8");

function tidyInput(input: string): string {
  const unix = input.replace(/\r\n?/g, "\n");
  // Programs reading line by line expect the last line to end with a newline.
  return unix.length > 0 && !unix.endsWith("\n") ? unix + "\n" : unix;
}

async function insertTest(problemId: number, rawInput: string, rawOutput: string, isExample: boolean) {
  const input = tidyInput(rawInput);
  const output = rawOutput.replace(/\r\n?/g, "\n");
  const size = bytes(input) + bytes(output);
  if (size > MAX_TEST_BYTES) {
    throw new UserError("This test is larger than 3.5 MB (input and output together). Use a smaller test.");
  }
  await tx(async (t) => {
    const usage = await t.q1<{ n: number; total: number }>(
      `select count(*) as n, coalesce(sum(octet_length(input) + octet_length(expected_output)), 0) as total
       from tests where problem_id = $1`,
      [problemId],
    );
    if ((usage?.n ?? 0) >= MAX_TESTS) throw new UserError(`A problem can have at most ${MAX_TESTS} tests.`);
    if ((usage?.total ?? 0) + size > MAX_PROBLEM_BYTES) {
      throw new UserError("All tests of one problem together can take at most 16 MB.");
    }
    const row = await t.q1(
      `insert into tests (problem_id, ord, input, expected_output, is_example)
       select p.id, coalesce((select max(ord) + 1 from tests where problem_id = p.id), 0), $2, $3, $4
       from problems p where p.id = $1 returning id`,
      [problemId, input, output, isExample],
    );
    if (!row) throw new UserError("This problem no longer exists.");
    await t.q("update problems set tests_version = tests_version + 1 where id = $1", [problemId]);
  });
}

export const addTest = formAction(async (form) => {
  await requireAdmin();
  const problemId = id(form, "problem_id", "problem");
  const input = text(form, "input", { name: "Input", max: MAX_TEST_BYTES, trim: false });
  const output = text(form, "expected_output", { name: "Expected output", max: MAX_TEST_BYTES, trim: false });
  if (!input.trim() && !output.trim()) throw new UserError("Type an input, an expected output, or both.");
  await insertTest(problemId, input, output, checkbox(form, "is_example"));
  refresh();
  return { ok: "Test added." };
});

/**
 * Adds one test from the file uploader. Called once per test so that each
 * request stays small. Returns an error message instead of throwing.
 */
export async function uploadTest(problemId: number, input: string, output: string): Promise<{ error?: string }> {
  const { isAdmin } = await getViewer();
  if (!isAdmin) return { error: "Your admin session has ended. Sign in again." };
  if (!Number.isInteger(problemId) || typeof input !== "string" || typeof output !== "string") {
    return { error: "The upload could not be read." };
  }
  try {
    await insertTest(problemId, input, output, false);
    return {};
  } catch (error) {
    if (error instanceof UserError) return { error: error.message };
    console.error("uploadTest failed:", error);
    return { error: "This test could not be saved." };
  }
}

async function touchTest(testId: number, change: (t: Tx, problemId: number) => Promise<void>) {
  await tx(async (t) => {
    const row = await t.q1<{ problem_id: number }>("select problem_id from tests where id = $1", [testId]);
    if (!row) throw new UserError("This test no longer exists.");
    await change(t, row.problem_id);
    await t.q("update problems set tests_version = tests_version + 1 where id = $1", [row.problem_id]);
  });
}

export const saveTest = formAction(async (form) => {
  await requireAdmin();
  const testId = id(form, "id", "test");
  const input = tidyInput(text(form, "input", { name: "Input", max: MAX_TEST_BYTES, trim: false }));
  const output = text(form, "expected_output", { name: "Expected output", max: MAX_TEST_BYTES, trim: false });
  if (bytes(input) + bytes(output) > MAX_TEST_BYTES) throw new UserError("This test is larger than 3.5 MB.");
  await touchTest(testId, async (t) => {
    await t.q("update tests set input = $2, expected_output = $3, is_example = $4 where id = $1", [
      testId,
      input,
      output,
      checkbox(form, "is_example"),
    ]);
  });
  refresh();
  return { ok: "Test saved." };
});

export const toggleExample = formAction(async (form) => {
  await requireAdmin();
  const testId = id(form, "id", "test");
  await touchTest(testId, async (t) => {
    await t.q("update tests set is_example = not is_example where id = $1", [testId]);
  });
  refresh();
  return null;
});

export const deleteTest = formAction(async (form) => {
  await requireAdmin();
  const testId = id(form, "id", "test");
  let problemId = 0;
  await touchTest(testId, async (t, parent) => {
    problemId = parent;
    await t.q("delete from tests where id = $1", [testId]);
  });
  if (form.get("then") === "back") redirect(`/admin/problems/${problemId}`);
  refresh();
  return null;
});

export const deleteAllTests = formAction(async (form) => {
  await requireAdmin();
  const problemId = id(form, "problem_id", "problem");
  await q("delete from tests where problem_id = $1", [problemId]);
  await q("update problems set tests_version = tests_version + 1 where id = $1", [problemId]);
  refresh();
  return { ok: "All tests deleted." };
});

export const moveTest = formAction(async (form) => {
  await requireAdmin();
  const testId = id(form, "id", "test");
  const direction = form.get("direction") === "up" ? -1 : 1;
  await tx(async (t) => {
    const problemId = await move(t, "tests", "problem_id", testId, direction);
    await t.q("update problems set tests_version = tests_version + 1 where id = $1", [problemId]);
  });
  refresh();
  return null;
});
