import { saveContest } from "@/lib/actions/admin-contests";
import type { LeaderboardType } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { ContestFields } from "./ContestFields";

export type ContestFormValues = {
  id?: number;
  name: string;
  description: string;
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
};

function timezones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "UTC"];
  }
}

/** The settings form shared by "New contest" and the contest's admin page. */
export function ContestForm({ values }: { values: ContestFormValues }) {
  const isNew = values.id === undefined;
  return (
    <ActionForm action={saveContest}>
      {!isNew && <input type="hidden" name="id" value={values.id} />}
      <div className="columns">
        <div>
          <label htmlFor="name">Name</label>
          <input id="name" name="name" type="text" required maxLength={200} defaultValue={values.name} />

          <label htmlFor="description">
            Description <span className="muted">(optional, Markdown, shown on the contest page)</span>
          </label>
          <textarea id="description" name="description" rows={4} defaultValue={values.description} />

          <ContestFields
            values={{
              timezone: values.timezone,
              start_local: values.start_local,
              end_local: values.end_local,
              leaderboard_type: values.leaderboard_type,
              penalty_per_wrong: values.penalty_per_wrong,
              decay_per_minute: values.decay_per_minute,
              wrong_penalty_pts: values.wrong_penalty_pts,
            }}
            timezones={timezones()}
          />
        </div>
        <div>
          <h2 style={{ marginTop: "1rem" }}>Who can see it</h2>
          <p className="help" style={{ fontSize: "0.9375rem" }}>
            {isNew
              ? "A new contest starts hidden: only organizers can see it. Add the problems and tests, then press Publish on the next page."
              : values.visible
                ? "This contest is published. Use the Hide button at the top of this page to take it offline."
                : "This contest is hidden: only organizers can see it. Use the Publish button at the top of this page when it is ready."}{" "}
            Even when published, the problems stay closed until the start time.
          </p>

          <h2>After the contest</h2>
          <label className="check">
            <input type="checkbox" name="show_code_after" defaultChecked={values.show_code_after} /> Everyone can read
            everyone&apos;s code
          </label>
          <label className="check">
            <input type="checkbox" name="show_editorial" defaultChecked={values.show_editorial} /> Show the editorials
            and reference solutions
          </label>
          <p className="help">
            During a contest nobody can see another contestant&apos;s code, only verdicts and standings.
          </p>
        </div>
      </div>
      <div className="form-actions">
        <button className="btn primary">{isNew ? "Create contest" : "Save contest"}</button>
        {isNew && <span className="help">You add the problems on the next page.</span>}
      </div>
    </ActionForm>
  );
}
