import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { q, q1 } from "./db";

const USER_COOKIE = "ahs_session";
const ADMIN_COOKIE = "ahs_admin";
const USER_SESSION_DAYS = 30;
const ADMIN_SESSION_HOURS = 12;

export type User = {
  id: number;
  username: string;
  full_name: string;
  email: string;
  pl_number: string;
  created_at: Date;
};

export type Viewer = { user: User | null; isAdmin: boolean };

// ---------------------------------------------------------------------------
// Passwords (scrypt, built into Node)
// ---------------------------------------------------------------------------
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

function scryptAsync(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: n, r, p, maxmem: 256 * n * r }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || n > 1 << 20) return false;
  try {
    const expected = Buffer.from(parts[5], "base64");
    const actual = await scryptAsync(password, Buffer.from(parts[4], "base64"), n, r, p);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Admin password (the ADMIN_PASSWORD environment variable)
// ---------------------------------------------------------------------------
export function adminPassword(): string {
  return (process.env.ADMIN_PASSWORD || "").trim();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Changing ADMIN_PASSWORD signs every organizer out, because this stamp no longer matches. */
function adminStamp(): string {
  return sha256("admin-stamp:" + adminPassword()).slice(0, 32);
}

export function checkAdminPassword(candidate: string): boolean {
  const real = adminPassword();
  if (!real) return false;
  // Compare hashes so the comparison takes the same time whatever was typed.
  return timingSafeEqual(Buffer.from(sha256(candidate)), Buffer.from(sha256(real)));
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
async function cookieOptions(maxAgeSeconds: number) {
  const proto = (await headers()).get("x-forwarded-proto");
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.VERCEL === "1" || proto === "https",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

async function openSession(kind: "user" | "admin", userId: number | null, seconds: number) {
  const token = randomBytes(32).toString("base64url");
  await q(
    `insert into sessions (token_hash, kind, user_id, stamp, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
    [sha256(token), kind, userId, kind === "admin" ? adminStamp() : null, seconds],
  );
  const jar = await cookies();
  jar.set(kind === "admin" ? ADMIN_COOKIE : USER_COOKIE, token, await cookieOptions(seconds));
  if (Math.random() < 0.05) {
    await q("delete from sessions where expires_at < now()").catch(() => {});
  }
}

export async function signInUser(userId: number) {
  await openSession("user", userId, USER_SESSION_DAYS * 86400);
}

export async function signInAdmin() {
  await openSession("admin", null, ADMIN_SESSION_HOURS * 3600);
}

async function closeSession(cookieName: string) {
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;
  if (token) await q("delete from sessions where token_hash = $1", [sha256(token)]).catch(() => {});
  jar.delete(cookieName);
}

export async function signOutUser() {
  await closeSession(USER_COOKIE);
}

export async function signOutAdmin() {
  await closeSession(ADMIN_COOKIE);
}

/** Signs a user out everywhere (used after a password change or reset). */
export async function endAllSessionsFor(userId: number) {
  await q("delete from sessions where user_id = $1", [userId]);
}

/** Who is making this request. Looked up once per request. */
export const getViewer = cache(async (): Promise<Viewer> => {
  const jar = await cookies();
  const userToken = jar.get(USER_COOKIE)?.value;
  const adminToken = jar.get(ADMIN_COOKIE)?.value;
  if (!userToken && !adminToken) return { user: null, isAdmin: false };

  const hashes = [userToken, adminToken].filter((t): t is string => !!t).map(sha256);
  const rows = await q<{
    kind: string;
    stamp: string | null;
    id: number | null;
    username: string | null;
    full_name: string | null;
    email: string | null;
    pl_number: string | null;
    created_at: Date | null;
  }>(
    `select s.kind, s.stamp, u.id, u.username, u.full_name, u.email, u.pl_number, u.created_at
     from sessions s left join users u on u.id = s.user_id
     where s.token_hash = any($1::text[]) and s.expires_at > now()`,
    [hashes],
  );

  let user: User | null = null;
  let isAdmin = false;
  for (const row of rows) {
    if (row.kind === "user" && row.id !== null) {
      user = {
        id: row.id,
        username: row.username!,
        full_name: row.full_name!,
        email: row.email!,
        pl_number: row.pl_number!,
        created_at: row.created_at!,
      };
    }
    if (row.kind === "admin" && adminPassword() && row.stamp === adminStamp()) isAdmin = true;
  }
  return { user, isAdmin };
});

/** Like getViewer, but never fails: used by the page frame so it renders even before setup is finished. */
export async function getViewerSafe(): Promise<Viewer> {
  try {
    return await getViewer();
  } catch {
    return { user: null, isAdmin: false };
  }
}

/** For pages that need a logged-in student. Sends everyone else to the login page. */
export async function requireUser(returnTo: string): Promise<User> {
  const { user } = await getViewer();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return user;
}

/** For admin pages and actions. Sends everyone else to the admin password page. */
export async function requireAdmin(): Promise<void> {
  const { isAdmin } = await getViewer();
  if (!isAdmin) redirect("/admin/login");
}

/** Only allow redirects back into this site: "/something", never "//other-site.com". */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}
