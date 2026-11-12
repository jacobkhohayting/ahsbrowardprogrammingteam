import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { contestPhase, formatPoints, problemLabel, type LeaderboardType } from "@/lib/format";
import {
  deleteContest,
  duplicateContest,
  rejudgeContest,
  setContestVisible,
} from "@/lib/actions/admin-contests";
import { addProblem, deleteProblem, moveProblem } from "@/lib/actions/admin-problems";
import { ActionForm } from "@/components/ActionForm";
import { Balloon } from "@/components/Balloon";
import { ContestForm } from "@/components/admin/ContestForm";

export const metadata: Metadata = { title: "Contest" };

type ContestRow = {
  id: number;
  name: string;
  description: string;
  start_at: Date;
  end_at: Date;
  timezone: string;
  start_local: string;
  end_local: string;
  visible: boolean;
  leaderboard_type: LeaderboardType;
  penalty_per_wrong: number;
  decay_per_minute: number;
  wrong_penalty_pts: number;
  show_code_after: boolean;
  show_editorial: boolean;
  submissions: number;
};

type ProblemRow = {
  id: number;
  title: string;
  time_limit_ms: number;
  memory_limit_mb: number;
  points: number;
  tests: number;
  examples: number;
  submissions: number;
  solvers: number;
};

const PHASE_LABEL = { running: "Running", upcoming: "Upcoming", ended: "Finished" } as const;

export default async function AdminContestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();

  const contest = await q1<ContestRow>(
    `select c.*,
            to_char(c.start_at at time zone c.timezone, 'YYYY-MM-DD"T"HH24:MI') as start_local,
            to_char(c.end_at at time zone c.timezone, 'YYYY-MM-DD"T"HH24:MI') as end_local,
            (select count(*) from submissions s where s.contest_id = c.id and not s.admin_test) as submissions
     from contests c where c.id = $1`,
    [id],
  );
  if (!contest) notFound();

  const problems = await q<ProblemRow>(
    `select p.id, p.title, p.time_limit_ms, p.memory_limit_mb, p.points,
            (select count(*) from tests t where t.problem_id = p.id) as tests,
            (select count(*) from tests t where t.problem_id = p.id and t.is_example) as examples,
            (select count(*) from submissions s where s.problem_id = p.id and not s.admin_test) as submissions,
            (select count(distinct s.user_id) from submissions s
              where s.problem_id = p.id and s.verdict = 'AC' and not s.admin_test and not s.invalidated) as solvers
     from problems p where p.contest_id = $1 order by p.ord, p.id`,
    [id],
  );
  const phase = contestPhase(contest.start_at, contest.end_at);
  const adaptive = contest.leaderboard_type === "adaptive";

  return (
    <main>
      <p className="crumb">
        <Link href="/admin/contests">Contests</Link>
      </p>
      <div className="head">
        <h1>
          {contest.name} <span className={`pill ${phase}`}>{PHASE_LABEL[phase]}</span>{" "}
          {!contest.visible && <span className="pill hidden">Hidden</span>}
        </h1>
      </div>
      <div className="actions" style={{ marginBottom: "2rem" }}>
        <ActionForm action={setContestVisible} className="inline" messages="bottom">
          <input type="hidden" name="id" value={contest.id} />
          <input type="hidden" name="visible" value={contest.visible ? "0" : "1"} />
          <button className={`btn ${contest.visible ? "" : "primary"}`}>
            {contest.visible ? "Hide from students" : "Publish"}
          </button>
        </ActionForm>
        <Link className="btn" href={`/contests/${contest.id}`}>
          Student view
        </Link>
        <Link className="btn" href={`/contests/${contest.id}/standings`}>
          Standings
        </Link>
        <Link className="btn" href={`/admin/submissions?contest=${contest.id}`}>
          Submissions ({contest.submissions})
        </Link>
        <ActionForm action={duplicateContest} className="inline" messages="errors">
          <input type="hidden" name="id" value={contest.id} />
          <button className="btn">Duplicate</button>
        </ActionForm>
        <ActionForm
          action={rejudgeContest}
          className="inline"
          messages="bottom"
          confirm={`Judge all ${contest.submissions} submissions in this contest again?`}
        >
          <input type="hidden" name="id" value={contest.id} />
          <button className="btn">Rejudge everything</button>
        </ActionForm>
        <ActionForm
          action={deleteContest}
          className="inline"
          messages="errors"
          confirm={`Delete "${contest.name}" with all its problems, tests and ${contest.submissions} submissions? This cannot be undone.`}
        >
          <input type="hidden" name="id" value={contest.id} />
          <button className="btn danger">Delete contest</button>
        </ActionForm>
      </div>

      <h2 style={{ marginTop: 0 }}>Problems</h2>
      {problems.length === 0 ? (
        <p className="empty">No problems yet. Add the first one below, then write its statement and tests.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: "3rem" }}>
                  <span className="sr-only">Letter</span>
                </th>
                <th>Problem</th>
                <th>Limits</th>
                {adaptive && <th className="num">Max points</th>}
                <th className="num">Tests</th>
                <th className="num">Examples</th>
                <th className="num">Submissions</th>
                <th className="num">Solved by</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {problems.map((problem, index) => (
                <tr key={problem.id}>
                  <td>
                    <Balloon index={index} label={problemLabel(index)} href={`/admin/problems/${problem.id}`} />
                  </td>
                  <td>
                    <Link href={`/admin/problems/${problem.id}`}>
                      <strong>{problem.title}</strong>
                    </Link>
                    {problem.tests === 0 && <span className="sub verdict v-WA">No tests yet</span>}
                    {problem.tests > 0 && problem.examples === 0 && (
                      <span className="sub verdict v-TLE">No example marked</span>
                    )}
                  </td>
                  <td className="nowrap small muted">
                    {problem.time_limit_ms / 1000} s, {problem.memory_limit_mb} MB
                  </td>
                  {adaptive && <td className="num">{formatPoints(problem.points)}</td>}
                  <td className="num">{problem.tests}</td>
                  <td className="num">{problem.examples}</td>
                  <td className="num">{problem.submissions}</td>
                  <td className="num">{problem.solvers}</td>
                  <td>
                    <div className="actions" style={{ flexWrap: "nowrap" }}>
                      <ActionForm action={moveProblem} className="inline" messages="none">
                        <input type="hidden" name="id" value={problem.id} />
                        <input type="hidden" name="direction" value="up" />
                        <button className="btn small" disabled={index === 0} aria-label={`Move ${problem.title} up`}>
                          Up
                        </button>
                      </ActionForm>
                      <ActionForm action={moveProblem} className="inline" messages="none">
                        <input type="hidden" name="id" value={problem.id} />
                        <input type="hidden" name="direction" value="down" />
                        <button
                          className="btn small"
                          disabled={index === problems.length - 1}
                          aria-label={`Move ${problem.title} down`}
                        >
                          Down
                        </button>
                      </ActionForm>
                      <ActionForm
                        action={deleteProblem}
                        className="inline"
                        messages="errors"
                        confirm={`Remove "${problem.title}" with its tests and ${problem.submissions} submissions?`}
                      >
                        <input type="hidden" name="id" value={problem.id} />
                        <button className="btn small danger">Remove</button>
                      </ActionForm>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ActionForm action={addProblem} className="filters">
        <input type="hidden" name="contest_id" value={contest.id} />
        <div style={{ flex: "1 1 18rem" }}>
          <label htmlFor="title">Add a problem</label>
          <input id="title" name="title" type="text" required maxLength={200} placeholder="Problem title" />
        </div>
        <button className="btn primary">Add problem</button>
      </ActionForm>

      <h2>Settings</h2>
      <ContestForm values={contest} />
    </main>
  );
}
