"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getViewer } from "../auth";
import { getContest, recordEntry } from "../contests";
import { UserError } from "../errors";
import { formAction, id } from "../form";
import { contestPhase } from "../format";

/** "Enter contest": puts the student on the contest's leaderboard and opens the problems. */
export const enterContest = formAction(async (form) => {
  const contestId = id(form, "contest_id", "contest");
  const { user } = await getViewer();
  if (!user) redirect(`/login?next=/contests/${contestId}`);
  const contest = await getContest(contestId);
  if (!contest || !contest.visible) throw new UserError("Contest not found.");
  const phase = contestPhase(contest.start_at, contest.end_at);
  if (phase === "upcoming") throw new UserError("This contest has not started yet.");
  if (phase === "ended") throw new UserError("This contest is already over.");
  await recordEntry(contest.id, user.id);
  refresh();
  return { ok: "You are in. Good luck!" };
});
