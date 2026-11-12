import Link from "next/link";
import type { ReactNode } from "react";
import type { ContestSummary } from "@/lib/contests";
import { contestPhase, formatDuration, formatInZone } from "@/lib/format";
import { ContestClock } from "./ContestClock";

function plural(n: number, one: string, many = one + "s") {
  return `${n} ${n === 1 ? one : many}`;
}

/** One contest in a list: name, when, how long, and a countdown or links on the right. */
export function ContestRow({ contest, side }: { contest: ContestSummary; side?: ReactNode }) {
  const phase = contestPhase(contest.start_at, contest.end_at);
  const minutes = (contest.end_at.getTime() - contest.start_at.getTime()) / 60000;
  return (
    <li className={`contest-row ${phase === "running" ? "is-live" : ""}`}>
      <div>
        <Link className="name" href={`/contests/${contest.id}`}>
          {contest.name}
        </Link>{" "}
        {phase === "running" && <span className="pill running">Running</span>}{" "}
        {!contest.visible && <span className="pill hidden">Hidden</span>}
        <p className="meta">
          {formatInZone(contest.start_at, contest.timezone)}, {formatDuration(minutes)}
          {phase !== "upcoming" && `, ${plural(contest.participant_count, "person", "people")} entered`}
          {`, ${plural(contest.problem_count, "problem")}`}
        </p>
      </div>
      <div className="side">
        {side ??
          (phase !== "ended" && (
            <ContestClock
              startAt={contest.start_at.toISOString()}
              endAt={contest.end_at.toISOString()}
              serverNow={Date.now()}
            />
          ))}
      </div>
    </li>
  );
}
