import Link from "next/link";
import { contestContext, getProblems } from "@/lib/contests";
import { q } from "@/lib/db";
import { formatPoints, LEADERBOARD_HELP } from "@/lib/format";
import { pointsAt } from "@/lib/standings";
import { enterContest } from "@/lib/actions/contest";
import { ActionForm } from "@/components/ActionForm";
import { Balloon } from "@/components/Balloon";
import { Markdown } from "@/components/Markdown";

export default async function ContestPage({ params }: { params: Promise<{ id: string }> }) {
  const { contest, viewer, phase, access } = await contestContext((await params).id);
  const base = `/contests/${contest.id}`;

  const rules = (
    <p className="muted small" style={{ maxWidth: "72ch" }}>
      Scoring: {LEADERBOARD_HELP[contest.leaderboard_type]}
      {contest.leaderboard_type === "long" && ` Each rejected attempt adds ${contest.penalty_per_wrong}.`}
      {contest.leaderboard_type === "adaptive" &&
        ` Problems lose ${formatPoints(contest.decay_per_minute)} points per minute` +
          (contest.wrong_penalty_pts > 0
            ? ` and ${formatPoints(contest.wrong_penalty_pts)} per rejected attempt.`
            : ".")}{" "}
      Compilation errors never count against you.
    </p>
  );

  if (access !== "ok") {
    return (
      <main>
        {contest.description && <Markdown>{contest.description}</Markdown>}
        {access === "upcoming" && (
          <p className="msg note">The problems appear here the moment the contest starts. This page updates by itself.</p>
        )}
        {access === "login" && (
          <>
            <p className="msg note">This contest is running. Log in to enter it and see the problems.</p>
            <div className="actions">
              <Link className="btn primary" href={`/login?next=${encodeURIComponent(base)}`}>
                Log in
              </Link>
              <Link className="btn" href={`/register?next=${encodeURIComponent(base)}`}>
                Create account
              </Link>
            </div>
          </>
        )}
        {access === "enter" && (
          <ActionForm action={enterContest}>
            <input type="hidden" name="contest_id" value={contest.id} />
            <p style={{ maxWidth: "72ch" }}>
              Entering puts you on the leaderboard and opens the problems. You can enter at any time, but the contest
              ends at the same moment for everyone.
            </p>
            <button className="btn primary">Enter contest</button>
          </ActionForm>
        )}
        <div style={{ marginTop: "1.5rem" }}>{rules}</div>
      </main>
    );
  }

  const problems = await getProblems(contest.id);
  const [solvers, mine] = await Promise.all([
    q<{ problem_id: number; n: number }>(
      `select problem_id, count(distinct user_id) as n from submissions
       where contest_id = $1 and verdict = 'AC' and not invalidated and not admin_test
       group by problem_id`,
      [contest.id],
    ),
    viewer.user
      ? q<{ problem_id: number; solved: boolean; wrong: number }>(
          `select problem_id, bool_or(verdict = 'AC') as solved,
                  count(*) filter (where status = 'done' and verdict not in ('AC', 'CE', 'JE')) as wrong
           from submissions
           where contest_id = $1 and user_id = $2 and not invalidated and not admin_test
           group by problem_id`,
          [contest.id, viewer.user.id],
        )
      : Promise.resolve([]),
  ]);
  const solvedBy = new Map(solvers.map((row) => [row.problem_id, row.n]));
  const myState = new Map(mine.map((row) => [row.problem_id, row]));
  const adaptive = contest.leaderboard_type === "adaptive";
  const elapsed = phase === "running" ? Date.now() - contest.start_at.getTime() : 0;

  return (
    <main>
      {contest.description && <Markdown>{contest.description}</Markdown>}
      {problems.length === 0 ? (
        <p className="empty">This contest has no problems yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: "3rem" }}>
                  <span className="sr-only">Letter</span>
                </th>
                <th>Problem</th>
                {adaptive && <th className="num">{phase === "running" ? "Worth now" : "Points"}</th>}
                <th className="num">Solved by</th>
                {viewer.user && <th>You</th>}
              </tr>
            </thead>
            <tbody>
              {problems.map((problem, index) => {
                const state = myState.get(problem.id);
                return (
                  <tr key={problem.id}>
                    <td>
                      <Balloon index={index} label={problem.label} href={`${base}/problems/${problem.label}`} />
                    </td>
                    <td>
                      <Link href={`${base}/problems/${problem.label}`}>
                        <strong>{problem.title}</strong>
                      </Link>
                      <span className="sub">
                        {problem.time_limit_ms / 1000} s, {problem.memory_limit_mb} MB
                      </span>
                    </td>
                    {adaptive && (
                      <td className="num">
                        {phase === "running"
                          ? formatPoints(
                              pointsAt(problem.points, contest.decay_per_minute, contest.wrong_penalty_pts, elapsed),
                            )
                          : formatPoints(problem.points)}
                        {phase === "running" && <span className="sub">of {formatPoints(problem.points)}</span>}
                      </td>
                    )}
                    <td className="num">{solvedBy.get(problem.id) ?? 0}</td>
                    {viewer.user && (
                      <td>
                        {state?.solved ? (
                          <span className="verdict v-AC">Solved</span>
                        ) : state && state.wrong > 0 ? (
                          <span className="verdict v-WA">
                            {state.wrong} wrong {state.wrong === 1 ? "try" : "tries"}
                          </span>
                        ) : (
                          <span className="muted">Not tried</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rules}
    </main>
  );
}
