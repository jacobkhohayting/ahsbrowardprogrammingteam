import type { Metadata } from "next";
import Link from "next/link";
import { contestContext, namesVisible } from "@/lib/contests";
import { formatClock, formatPoints, LEADERBOARD_HELP } from "@/lib/format";
import { loadStandings } from "@/lib/standings-data";
import type { StandingsCell } from "@/lib/standings";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Balloon } from "@/components/Balloon";

export const metadata: Metadata = { title: "Standings" };

function Cell({ cell, adaptive }: { cell: StandingsCell | undefined; adaptive: boolean }) {
  if (!cell) return <td className="cell" />;
  if (cell.solved) {
    return (
      <td className="cell solved" title={`Solved after ${formatClock(cell.time_s ?? 0)}, ${cell.attempts} rejected first`}>
        {adaptive ? formatPoints(cell.points) : cell.attempts ? `+${cell.attempts}` : "+"}
        <span className="t">{formatClock(cell.time_s ?? 0)}</span>
      </td>
    );
  }
  if (cell.attempts > 0) {
    return (
      <td className="cell failed" title={`${cell.attempts} rejected, not solved`}>
        −{cell.attempts}
        {cell.pending > 0 && <span className="t">judging</span>}
      </td>
    );
  }
  if (cell.pending > 0) {
    return (
      <td className="cell pending" title="Being judged">
        ?
      </td>
    );
  }
  return <td className="cell" />;
}

export default async function StandingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { contest, viewer, phase, access } = await contestContext((await params).id);
  const base = `/contests/${contest.id}`;
  if (phase === "upcoming" && !viewer.isAdmin) {
    return (
      <main>
        <p className="msg note">The standings appear when the contest starts.</p>
      </main>
    );
  }

  const [standings, showNames] = await Promise.all([loadStandings(contest), namesVisible()]);
  const type = standings.type;
  const canOpenProblems = access === "ok";

  return (
    <main>
      {phase === "running" && <AutoRefresh seconds={20} />}
      <div className="head">
        <p className="muted small" style={{ maxWidth: "72ch", margin: 0 }}>
          {LEADERBOARD_HELP[type]}
          {phase === "running" && " Updates every 20 seconds."}
        </p>
        <a className="btn small" href={`${base}/standings/csv`}>
          Download as a spreadsheet
        </a>
      </div>

      {standings.rows.length === 0 ? (
        <p className="empty">Nobody has entered this contest yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="standings">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Who</th>
                {type === "adaptive" && <th className="num">Points</th>}
                <th className="num">Solved</th>
                {type === "long" && <th className="num">Penalty</th>}
                {type === "short" && <th className="num">Last accepted</th>}
                {standings.problems.map((problem, index) => (
                  <th key={problem.id} className="problem">
                    <Balloon
                      index={index}
                      label={problem.label}
                      href={canOpenProblems ? `${base}/problems/${problem.label}` : undefined}
                      title={canOpenProblems ? `${problem.label}. ${problem.title}` : `Problem ${problem.label}`}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {standings.rows.map((row) => (
                <tr key={row.user_id} className={viewer.user?.id === row.user_id ? "is-me" : undefined}>
                  <td className="rank">{row.rank}</td>
                  <td>
                    {row.username}
                    {showNames && <span className="sub">{row.full_name}</span>}
                  </td>
                  {type === "adaptive" && <td className="score">{formatPoints(row.points)}</td>}
                  <td className={type === "adaptive" ? "num" : "score"}>{row.solves}</td>
                  {type === "long" && <td className="num">{row.penalty}</td>}
                  {type === "short" && (
                    <td className="num">{row.last_ac === null ? "" : formatClock(row.last_ac)}</td>
                  )}
                  {standings.problems.map((problem) => (
                    <Cell key={problem.id} cell={row.cells[problem.id]} adaptive={type === "adaptive"} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">
        In each cell: <strong className="v-AC">+</strong> solved first try, <strong className="v-AC">+2</strong> solved
        after 2 rejected attempts{type === "adaptive" ? " (adaptive contests show the points earned instead)" : ""},{" "}
        <strong className="v-WA">−3</strong> three rejected attempts and not solved. The time under it is how far into
        the contest it was solved. <Link href={`${base}/status`}>See every submission</Link>
      </p>
    </main>
  );
}
