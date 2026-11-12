"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireAdmin } from "../auth";
import { q, q1, tx } from "../db";
import { UserError } from "../errors";
import { checkbox, formAction, id, number, oneOf, text } from "../form";
import { isValidTimeZone, LEADERBOARD_TYPES } from "../format";
import { requeue, scheduleDrain } from "../judge/queue";

const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

function localTime(form: FormData, key: string, name: string): string {
  const value = text(form, key, { name, min: 1, max: 30 });
  if (!LOCAL_TIME.test(value)) throw new UserError(`${name} is not a valid date and time.`);
  return value.replace("T", " ");
}

/** Creates a contest, or saves changes to one. Times are typed in the contest's own time zone. */
export const saveContest = formAction(async (form) => {
  await requireAdmin();
  const contestId = form.get("id") ? id(form, "id", "contest") : null;

  const name = text(form, "name", { name: "Contest name", min: 1, max: 200 });
  const description = text(form, "description", { name: "Description", max: 20000, trim: false });
  const timezone = text(form, "timezone", { name: "Time zone", min: 1, max: 100 });
  if (!isValidTimeZone(timezone)) {
    throw new UserError(`"${timezone}" is not a time zone. Use a name such as America/New_York.`);
  }
  const startLocal = localTime(form, "start_local", "Start time");
  const endLocal = localTime(form, "end_local", "End time");
  const type = oneOf(form, "leaderboard_type", LEADERBOARD_TYPES, "leaderboard type");
  const penaltyPerWrong = number(form, "penalty_per_wrong", {
    name: "Penalty per rejected attempt",
    min: 0,
    max: 100000,
    integer: true,
    fallback: 10,
  });
  const decayPerMinute = number(form, "decay_per_minute", { name: "Points lost per minute", min: 0, max: 1e6, fallback: 1 });
  const wrongPenaltyPoints = number(form, "wrong_penalty_pts", {
    name: "Points lost per rejected attempt",
    min: 0,
    max: 1e6,
    fallback: 0,
  });
  const showCodeAfter = checkbox(form, "show_code_after");
  const showEditorial = checkbox(form, "show_editorial");

  // The database knows every time zone's rules (including daylight saving), so let it convert.
  let times: { start_at: Date; end_at: Date } | null;
  try {
    times = await q1<{ start_at: Date; end_at: Date }>(
      "select ($1::timestamp at time zone $3) as start_at, ($2::timestamp at time zone $3) as end_at",
      [startLocal, endLocal, timezone],
    );
  } catch {
    throw new UserError(`The time zone "${timezone}" or one of the times could not be understood.`);
  }
  if (!times || times.end_at.getTime() <= times.start_at.getTime()) {
    throw new UserError("The end time must be after the start time.");
  }
  if (times.end_at.getTime() - times.start_at.getTime() > 400 * 86400_000) {
    throw new UserError("A contest can last at most 400 days.");
  }

  const values = [
    name,
    description,
    times.start_at,
    times.end_at,
    timezone,
    type,
    penaltyPerWrong,
    decayPerMinute,
    wrongPenaltyPoints,
    showCodeAfter,
    showEditorial,
  ];
  // Whether students can see the contest is changed only with the Publish / Hide button,
  // so saving these settings can never publish or hide a contest by accident.
  if (contestId === null) {
    const row = await q1<{ id: number }>(
      `insert into contests (name, description, start_at, end_at, timezone, visible, leaderboard_type,
                             penalty_per_wrong, decay_per_minute, wrong_penalty_pts, show_code_after, show_editorial)
       values ($1, $2, $3, $4, $5, false, $6, $7, $8, $9, $10, $11) returning id`,
      values,
    );
    redirect(`/admin/contests/${row!.id}`);
  }
  const updated = await q(
    `update contests set name = $1, description = $2, start_at = $3, end_at = $4, timezone = $5,
            leaderboard_type = $6, penalty_per_wrong = $7, decay_per_minute = $8, wrong_penalty_pts = $9,
            show_code_after = $10, show_editorial = $11
     where id = $12 returning id`,
    [...values, contestId],
  );
  if (updated.length === 0) throw new UserError("This contest no longer exists.");
  refresh();
  return { ok: "Contest saved." };
});

/** Publish (students can see it) or hide (only organizers can). */
export const setContestVisible = formAction(async (form) => {
  await requireAdmin();
  const contestId = id(form, "id", "contest");
  const visible = form.get("visible") === "1";
  await q("update contests set visible = $2 where id = $1", [contestId, visible]);
  refresh();
  if (!visible) return { ok: "Hidden. Only organizers can see this contest now." };
  const untested = await q<{ title: string }>(
    `select p.title from problems p
     where p.contest_id = $1 and not exists (select 1 from tests t where t.problem_id = p.id)`,
    [contestId],
  );
  return {
    ok:
      untested.length > 0
        ? `Published. Careful: ${untested.map((p) => `"${p.title}"`).join(", ")} ${untested.length === 1 ? "has" : "have"} no tests yet.`
        : "Published. Students can see this contest now.",
  };
});

/** Copies a contest with all its problems and tests. The copy starts hidden and has no submissions. */
export const duplicateContest = formAction(async (form) => {
  await requireAdmin();
  const contestId = id(form, "id", "contest");
  const copyId = await tx(async (t) => {
    const copy = await t.q1<{ id: number }>(
      `insert into contests (name, description, start_at, end_at, timezone, visible, leaderboard_type,
                             penalty_per_wrong, decay_per_minute, wrong_penalty_pts, show_code_after, show_editorial)
       select name || ' (copy)', description, start_at, end_at, timezone, false, leaderboard_type,
              penalty_per_wrong, decay_per_minute, wrong_penalty_pts, show_code_after, show_editorial
       from contests where id = $1 returning id`,
      [contestId],
    );
    if (!copy) throw new UserError("This contest no longer exists.");
    const problems = await t.q<{ id: number }>("select id from problems where contest_id = $1 order by ord, id", [
      contestId,
    ]);
    for (const problem of problems) {
      const created = await t.q1<{ id: number }>(
        `insert into problems (contest_id, ord, title, statement, editorial, solution_code, solution_language,
                               time_limit_ms, memory_limit_mb, checker, points)
         select $2, ord, title, statement, editorial, solution_code, solution_language,
                time_limit_ms, memory_limit_mb, checker, points
         from problems where id = $1 returning id`,
        [problem.id, copy.id],
      );
      await t.q(
        `insert into tests (problem_id, ord, input, expected_output, is_example)
         select $2, ord, input, expected_output, is_example from tests where problem_id = $1 order by ord, id`,
        [problem.id, created!.id],
      );
    }
    return copy.id;
  });
  redirect(`/admin/contests/${copyId}`);
});

/** Deletes a contest for good, with its problems, tests, entries and submissions. */
export const deleteContest = formAction(async (form) => {
  await requireAdmin();
  const contestId = id(form, "id", "contest");
  await q("delete from contests where id = $1", [contestId]);
  redirect("/admin/contests");
});

export const rejudgeContest = formAction(async (form) => {
  await requireAdmin();
  const contestId = id(form, "id", "contest");
  const count = await requeue("contest_id = $1", [contestId]);
  if (count > 0) await scheduleDrain();
  refresh();
  return {
    ok:
      count === 0
        ? "There is nothing to rejudge."
        : `${count} submission${count === 1 ? "" : "s"} queued. Keep the Submissions page open while they are judged.`,
  };
});
