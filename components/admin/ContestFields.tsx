"use client";

import { useState } from "react";
import { formatDuration, LEADERBOARD_HELP, LEADERBOARD_TYPES, type LeaderboardType } from "@/lib/format";

type Values = {
  timezone: string;
  start_local: string;
  end_local: string;
  leaderboard_type: LeaderboardType;
  penalty_per_wrong: number;
  decay_per_minute: number;
  wrong_penalty_pts: number;
};

const TYPE_NAMES: Record<LeaderboardType, string> = {
  short: "Short (solves, then time of last accepted)",
  long: "Long (solves, then penalty)",
  adaptive: "Adaptive (points that shrink over time)",
};

/** The parts of the contest form that react while you type: contest length and leaderboard options. */
export function ContestFields({ values, timezones }: { values: Values; timezones: string[] }) {
  const [start, setStart] = useState(values.start_local);
  const [end, setEnd] = useState(values.end_local);
  const [type, setType] = useState<LeaderboardType>(values.leaderboard_type);

  let length = "";
  if (start && end) {
    const minutes = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
    length = Number.isNaN(minutes)
      ? ""
      : minutes > 0
        ? `The contest lasts ${formatDuration(minutes)}.`
        : "The end must be after the start.";
  }

  return (
    <>
      <label htmlFor="timezone">Time zone</label>
      <input id="timezone" name="timezone" type="text" list="timezones" required defaultValue={values.timezone} autoComplete="off" />
      <datalist id="timezones">
        {timezones.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      <p className="help">
        The start and end below are typed in this time zone. Students elsewhere also see them in their own time.
      </p>

      <div className="form-row">
        <div>
          <label htmlFor="start_local">Start</label>
          <input id="start_local" name="start_local" type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label htmlFor="end_local">End</label>
          <input id="end_local" name="end_local" type="datetime-local" required value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      {length && <p className="help">{length}</p>}

      <h2>Leaderboard</h2>
      <label htmlFor="leaderboard_type">Type</label>
      <select id="leaderboard_type" name="leaderboard_type" value={type} onChange={(e) => setType(e.target.value as LeaderboardType)}>
        {LEADERBOARD_TYPES.map((key) => (
          <option key={key} value={key}>
            {TYPE_NAMES[key]}
          </option>
        ))}
      </select>
      <p className="help">{LEADERBOARD_HELP[type]}</p>

      <fieldset hidden={type !== "long"}>
        <label htmlFor="penalty_per_wrong">Penalty added per rejected attempt</label>
        <input id="penalty_per_wrong" name="penalty_per_wrong" type="number" min={0} step={1} defaultValue={values.penalty_per_wrong} />
        <p className="help">
          Counted in minutes, and only on problems that were solved in the end. Compilation errors are never counted.
        </p>
      </fieldset>

      <fieldset hidden={type !== "adaptive"}>
        <div className="form-row">
          <div>
            <label htmlFor="decay_per_minute">Points lost per minute</label>
            <input id="decay_per_minute" name="decay_per_minute" type="number" min={0} step="any" defaultValue={values.decay_per_minute} />
          </div>
          <div>
            <label htmlFor="wrong_penalty_pts">
              Points lost per rejected attempt <span className="muted">(0 for none)</span>
            </label>
            <input id="wrong_penalty_pts" name="wrong_penalty_pts" type="number" min={0} step="any" defaultValue={values.wrong_penalty_pts} />
          </div>
        </div>
        <p className="help">
          Every problem starts at its own maximum (set on the problem) and drops by this much each minute, never below
          zero.
        </p>
      </fieldset>
    </>
  );
}
