import "server-only";
import { adminPassword } from "./auth";
import { databaseUrl, q1, SetupError } from "./db";
import { judgeMode, sandboxCredentials } from "./judge/credentials";
import { getBuildState, getRuntime, type BuildState, type JudgeRuntime } from "./judge/runtime";

export type Check = { state: "good" | "bad" | "wait"; title: string; detail: string; fix?: string };

export type Health = {
  database: Check;
  admin: Check;
  judge: Check;
  /** The two things the site cannot work without. */
  ready: boolean;
  runtime: JudgeRuntime | null;
  build: BuildState | null;
  mode: "sandbox" | "local";
};

/** Describes a database error without ever including the connection string or password. */
function describeDbError(error: unknown): string {
  const e = error as { code?: string; message?: string };
  const message = (e?.message ?? String(error)).replace(/postgres(ql)?:\/\/\S+/gi, "[connection string]");
  if (e?.code === "28P01" || /password authentication failed/i.test(message)) {
    return "The database refused the password in the connection string.";
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return "The database address in the connection string could not be found.";
  if (/ECONNREFUSED|ETIMEDOUT|timeout/i.test(message)) {
    return "The database did not answer. If it was paused or deleted, restore it in the Vercel Storage tab.";
  }
  if (/certificate|SSL|TLS/i.test(message)) return "The secure connection to the database failed: " + message;
  return message.slice(0, 300);
}

/** Checks everything the site needs. Used by /setup and the admin dashboard. */
export async function checkHealth(): Promise<Health> {
  const mode = judgeMode();
  let database: Check;
  let dbOk = false;
  if (!databaseUrl()) {
    database = {
      state: "bad",
      title: "No database is connected",
      detail: "The site stores accounts, contests and submissions in a Postgres database.",
      fix: "In Vercel, open this project, go to the Storage tab, create a Neon (Postgres) database on the free plan and connect it to this project. Then redeploy.",
    };
  } else {
    try {
      await q1("select 1 as ok");
      dbOk = true;
      database = { state: "good", title: "Database connected", detail: "Tables are created and up to date." };
    } catch (error) {
      database = {
        state: "bad",
        title: "The database is connected but not working",
        detail: error instanceof SetupError ? error.message : describeDbError(error),
        fix: "Check the database in the Vercel Storage tab. After changing anything, redeploy.",
      };
    }
  }

  const password = adminPassword();
  const admin: Check = !password
    ? {
        state: "bad",
        title: "No admin password is set",
        detail: "Without it nobody can open the admin area.",
        fix: "In Vercel, open Settings, then Environment Variables. Add ADMIN_PASSWORD with a password of your choice, then redeploy.",
      }
    : password.length < 10
      ? {
          state: "wait",
          title: "The admin password is short",
          detail: "It works, but a longer one (10 or more characters) is much harder to guess.",
        }
      : { state: "good", title: "Admin password set", detail: "The admin area is at /admin." };

  let runtime: JudgeRuntime | null = null;
  let build: BuildState | null = null;
  let judge: Check;
  if (mode === "local") {
    judge = {
      state: "good",
      title: "Judge: running on this computer",
      detail: "Development mode. Submissions are compiled and run locally (needs g++, python3 and a JDK).",
    };
  } else {
    let credentialsError = "";
    try {
      await sandboxCredentials();
    } catch (error) {
      credentialsError = error instanceof Error ? error.message : String(error);
    }
    if (dbOk) {
      runtime = await getRuntime().catch(() => null);
      build = await getBuildState().catch(() => null);
    }
    if (credentialsError) {
      judge = { state: "bad", title: "The judge cannot start sandboxes", detail: credentialsError };
    } else if (build?.running) {
      judge = { state: "wait", title: "The judge is being prepared", detail: `${build.step}… This takes about two minutes.` };
    } else if (!runtime) {
      judge = {
        state: "wait",
        title: "The judge is not prepared yet",
        detail:
          "The compilers get installed the first time they are needed (about two minutes). An organizer can do it now from the admin dashboard." +
          (build?.error ? ` Last attempt failed: ${build.error}` : ""),
      };
    } else {
      const failed = Object.entries(runtime.languages).filter(([, status]) => !status.ok);
      judge =
        failed.length === 0
          ? { state: "good", title: "Judge ready", detail: "C++, Python and Java all passed the self-test." }
          : {
              state: "wait",
              title: "The judge works, but not for every language",
              detail: failed.map(([name, status]) => `${name}: ${status.message}`).join(" "),
              fix: "Rebuild the judge from the admin dashboard.",
            };
    }
  }

  return { database, admin, judge, ready: dbOk && !!password, runtime, build, mode };
}
