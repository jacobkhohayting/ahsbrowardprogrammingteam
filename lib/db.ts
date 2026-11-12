import "server-only";
import { Pool, types, type PoolClient, type QueryResultRow } from "pg";
import { MIGRATIONS } from "./schema";

// count(*) and friends come back as 64-bit integers; plain numbers are easier to use.
types.setTypeParser(20, (value) => Number(value));

/** Thrown when the site cannot reach its database because it is not set up yet. */
export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupError";
  }
}

/** The connection string Vercel's Postgres integrations (Neon, Supabase, ...) add to the project. */
export function databaseUrl(): string | null {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    null
  );
}

type Globals = { __ahsPool?: Pool; __ahsReady?: Promise<void> | null };
const globals = globalThis as unknown as Globals;

function createPool(): Pool {
  const raw = databaseUrl();
  if (!raw) {
    throw new SetupError(
      "No database is connected. Add a Postgres database to this project in Vercel (Storage tab), then redeploy.",
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SetupError("DATABASE_URL is not a valid Postgres connection string.");
  }

  const host = url.hostname;
  const sslmode = url.searchParams.get("sslmode");
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  // We configure TLS ourselves, so remove the hint from the URL.
  url.searchParams.delete("sslmode");

  let ssl: false | { rejectUnauthorized: boolean };
  if (sslmode === "disable" || (isLocal && !sslmode)) {
    ssl = false;
  } else {
    // Supabase's pooler presents a certificate from its own authority, which Node does not know.
    const relaxed =
      sslmode === "no-verify" ||
      process.env.DATABASE_SSL_NO_VERIFY === "1" ||
      /\.supabase\.(co|com)$/.test(host);
    ssl = { rejectUnauthorized: !relaxed };
  }

  const pool = new Pool({
    connectionString: url.toString(),
    ssl,
    max: 6,
    idleTimeoutMillis: 15_000,
    connectionTimeoutMillis: 10_000,
  });
  // Idle connections can be closed by the database (for example when it goes to sleep).
  // Without a listener that would crash the process.
  pool.on("error", () => {});
  return pool;
}

function pool(): Pool {
  if (!globals.__ahsPool) globals.__ahsPool = createPool();
  return globals.__ahsPool;
}

const RETRYABLE =
  /Connection terminated|ECONNRESET|EPIPE|ETIMEDOUT|timeout exceeded when trying to connect|terminating connection|Client has encountered a connection error/i;

function isRetryable(error: unknown): boolean {
  return error instanceof Error && RETRYABLE.test(error.message);
}

/** Creates or upgrades the tables. Runs once per server instance; cheap when nothing is pending. */
async function migrate(): Promise<void> {
  const p = pool();
  let current = 0;
  try {
    const result = await p.query("select value from app_meta where key = 'schema_version'");
    current = Number(result.rows[0]?.value ?? 0);
  } catch (error) {
    // 42P01 = the table does not exist yet (brand-new database).
    if ((error as { code?: string }).code !== "42P01") throw error;
  }
  if (current >= MIGRATIONS.length) return;

  const client = await p.connect();
  try {
    await client.query("begin");
    // Only one server instance upgrades at a time; the others wait here.
    await client.query("select pg_advisory_xact_lock(726200100)");
    await client.query(
      "create table if not exists app_meta (key text primary key, value text not null)",
    );
    const result = await client.query("select value from app_meta where key = 'schema_version'");
    current = Number(result.rows[0]?.value ?? 0);
    for (let i = current; i < MIGRATIONS.length; i++) {
      await client.query(MIGRATIONS[i]);
    }
    await client.query(
      `insert into app_meta (key, value) values ('schema_version', $1)
       on conflict (key) do update set value = excluded.value`,
      [String(MIGRATIONS.length)],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Resolves once the database is reachable and its tables exist. */
export function ready(): Promise<void> {
  if (!globals.__ahsReady) {
    globals.__ahsReady = migrate().catch((error) => {
      globals.__ahsReady = null; // try again on the next request
      throw error;
    });
  }
  return globals.__ahsReady;
}

/** Runs a query and returns its rows. */
export async function q<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  await ready();
  try {
    return (await pool().query<T>(text, params)).rows;
  } catch (error) {
    if (!isRetryable(error)) throw error;
    return (await pool().query<T>(text, params)).rows;
  }
}

/** Runs a query and returns the first row, or null. */
export async function q1<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  return (await q<T>(text, params))[0] ?? null;
}

export type Tx = {
  q<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
  q1<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T | null>;
};

/** Runs several queries as one all-or-nothing transaction. */
export async function tx<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
  await ready();
  let client: PoolClient;
  try {
    client = await pool().connect();
  } catch (error) {
    if (!isRetryable(error)) throw error;
    client = await pool().connect();
  }
  const t: Tx = {
    async q<R extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<R[]> {
      return (await client.query<R>(text, params)).rows;
    },
    async q1<R extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<R | null> {
      const rows: R[] = (await client.query<R>(text, params)).rows;
      return rows.length > 0 ? rows[0] : null;
    },
  };
  try {
    await client.query("begin");
    const result = await fn(t);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** True for "duplicate key" errors, optionally for one specific unique index. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = error as { code?: string; constraint?: string };
  return e?.code === "23505" && (!constraint || e.constraint === constraint);
}
