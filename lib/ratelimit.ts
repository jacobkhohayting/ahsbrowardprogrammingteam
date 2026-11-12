import "server-only";
import { headers } from "next/headers";
import { q, q1 } from "./db";

/** The visitor's IP address as reported by Vercel (or "local" in development). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return (forwarded ? forwarded.split(",")[0].trim() : h.get("x-real-ip")) || "local";
}

/** How many events were recorded for this bucket in the last `windowSeconds`. */
export async function recentCount(bucket: string, windowSeconds: number): Promise<number> {
  const row = await q1<{ n: number }>(
    "select count(*) as n from rate_events where bucket = $1 and at > now() - make_interval(secs => $2)",
    [bucket, windowSeconds],
  );
  return row?.n ?? 0;
}

/** Records one event for this bucket. */
export async function record(bucket: string): Promise<void> {
  await q("insert into rate_events (bucket) values ($1)", [bucket]);
  // Occasionally clear out old rows so the table stays tiny.
  if (Math.random() < 0.02) {
    await q("delete from rate_events where at < now() - interval '1 day'").catch(() => {});
  }
}

/**
 * Counts this event and reports whether it is still within the limit.
 * Returns false (and records nothing) once `limit` events happened in the window.
 */
export async function allow(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  const row = await q1(
    `with recent as (
       select count(*) as n from rate_events
       where bucket = $1 and at > now() - make_interval(secs => $3)
     )
     insert into rate_events (bucket)
     select $1 from recent where recent.n < $2
     returning 1 as ok`,
    [bucket, limit, windowSeconds],
  );
  if (Math.random() < 0.02) {
    await q("delete from rate_events where at < now() - interval '1 day'").catch(() => {});
  }
  return row !== null;
}
