import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { q } from "@/lib/db";
import { contestPhase, formatDuration, formatInZone, type LeaderboardType } from "@/lib/format";
import { duplicateContest, setContestVisible } from "@/lib/actions/admin-contests";
import { ActionForm } from "@/components/ActionForm";

export const metadata: Metadata = { title: "Contests" };

type Row = {
  id: number;
  name: string;
  start_at: Date;
  end_at: Date;
  timezone: string;
  visible: boolean;
  leaderboard_type: LeaderboardType;
  problems: number;
  entrants: number;
  submissions: number;
};

const PHASE_LABEL = { running: "Running", upcoming: "Upcoming", ended: "Finished" } as const;

export default async function AdminContestsPage() {
  await requireAdmin();
  const contests = await q<Row>(
    `select c.id, c.name, c.start_at, c.end_at, c.timezone, c.visible, c.leaderboard_type,
            (select count(*) from problems p where p.contest_id = c.id) as problems,
            (select count(*) from contest_entries e where e.contest_id = c.id) as entrants,
            (select count(*) from submissions s where s.contest_id = c.id and not s.admin_test) as submissions
     from contests c order by c.start_at desc, c.id desc`,
  );

  return (
    <main>
      <div className="head">
        <h1>Contests</h1>
        <Link className="btn primary" href="/admin/contests/new">
          New contest
        </Link>
      </div>
      {contests.length === 0 ? (
        <p className="empty">No contests yet. Create one, add problems and tests, then publish it.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contest</th>
                <th>Status</th>
                <th>Starts</th>
                <th className="num">Length</th>
                <th>Leaderboard</th>
                <th className="num">Problems</th>
                <th className="num">Entered</th>
                <th className="num">Submissions</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {contests.map((contest) => {
                const phase = contestPhase(contest.start_at, contest.end_at);
                return (
                  <tr key={contest.id}>
                    <td>
                      <Link href={`/admin/contests/${contest.id}`}>
                        <strong>{contest.name}</strong>
                      </Link>
                    </td>
                    <td className="nowrap">
                      <span className={`pill ${phase}`}>{PHASE_LABEL[phase]}</span>{" "}
                      {!contest.visible && <span className="pill hidden">Hidden</span>}
                    </td>
                    <td className="nowrap small">{formatInZone(contest.start_at, contest.timezone)}</td>
                    <td className="num nowrap">
                      {formatDuration((contest.end_at.getTime() - contest.start_at.getTime()) / 60000)}
                    </td>
                    <td>{contest.leaderboard_type}</td>
                    <td className="num">{contest.problems}</td>
                    <td className="num">{contest.entrants}</td>
                    <td className="num">
                      <Link href={`/admin/submissions?contest=${contest.id}`}>{contest.submissions}</Link>
                    </td>
                    <td className="nowrap">
                      <div className="actions" style={{ flexWrap: "nowrap" }}>
                        <ActionForm action={setContestVisible} className="inline" messages="errors">
                          <input type="hidden" name="id" value={contest.id} />
                          <input type="hidden" name="visible" value={contest.visible ? "0" : "1"} />
                          <button className="btn small">{contest.visible ? "Hide" : "Publish"}</button>
                        </ActionForm>
                        <ActionForm action={duplicateContest} className="inline" messages="errors">
                          <input type="hidden" name="id" value={contest.id} />
                          <button className="btn small">Duplicate</button>
                        </ActionForm>
                        <Link className="btn small" href={`/contests/${contest.id}`}>
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
