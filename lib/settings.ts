import "server-only";
import { cache } from "react";
import { q, q1 } from "./db";

/** Site-wide options an organizer can change on the admin Settings page. */
export type SiteSettings = {
  siteName: string;
  registrationOpen: boolean;
  /** Comma-separated list such as "ahschool.com". Empty = any email address may register. */
  emailDomains: string;
  /** Who sees students' full names next to their usernames. */
  namesVisibility: "everyone" | "members" | "organizers";
  /** Whether students get the "Run examples" button (it uses judge quota). */
  allowRun: boolean;
  /** Extra time for slower languages: time limit x factor. */
  timeFactorPython: number;
  timeFactorJava: number;
};

export const DEFAULT_SETTINGS: SiteSettings = {
  siteName: "AHS Programming Team",
  registrationOpen: true,
  emailDomains: "",
  namesVisibility: "members",
  allowRun: true,
  timeFactorPython: 1,
  timeFactorJava: 1,
};

export async function readSetting<T>(key: string): Promise<T | null> {
  const row = await q1<{ value: T }>("select value from settings where key = $1", [key]);
  return row ? row.value : null;
}

export async function writeSetting(key: string, value: unknown): Promise<void> {
  await q(
    `insert into settings (key, value) values ($1, $2::jsonb)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

/** Site settings, read once per request. */
export const getSettings = cache(async (): Promise<SiteSettings> => {
  const stored = await readSetting<Partial<SiteSettings>>("site");
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
});

/** Like getSettings, but falls back to the defaults if the database is not reachable yet. */
export async function getSettingsSafe(): Promise<SiteSettings> {
  try {
    return await getSettings();
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Adds to this month's usage counters (shown on the admin dashboard). */
export async function countUsage(field: "sandboxes" | "submissions" | "runs", amount = 1): Promise<void> {
  const key = "usage:" + new Date().toISOString().slice(0, 7);
  await q(
    `insert into settings (key, value) values ($1, jsonb_build_object($2::text, $3::int))
     on conflict (key) do update
       set value = settings.value || jsonb_build_object($2::text, coalesce((settings.value ->> $2)::int, 0) + $3::int),
           updated_at = now()`,
    [key, field, amount],
  ).catch(() => {});
}

export async function usageThisMonth(): Promise<{ sandboxes: number; submissions: number; runs: number }> {
  const key = "usage:" + new Date().toISOString().slice(0, 7);
  const value = (await readSetting<Record<string, number>>(key)) ?? {};
  return { sandboxes: value.sandboxes ?? 0, submissions: value.submissions ?? 0, runs: value.runs ?? 0 };
}
