import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer, safeNext } from "@/lib/auth";
import { login } from "@/lib/actions/auth";
import { ActionForm } from "@/components/ActionForm";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, "/");
  const { user } = await getViewer();
  if (user) redirect(next);

  return (
    <main>
      <div className="narrow">
        <h1>Log in</h1>
        <ActionForm action={login}>
          <input type="hidden" name="next" value={next} />
          <label htmlFor="login">Username or email</label>
          <input id="login" name="login" type="text" required maxLength={200} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" />
          <div className="form-actions">
            <button className="btn primary">Log in</button>
          </div>
        </ActionForm>
        <p className="help" style={{ marginTop: "1.5rem" }}>
          New here? <Link href={`/register?next=${encodeURIComponent(next)}`}>Create an account</Link>
        </p>
        <p className="help">Forgot your password? A club officer can set a new one for you.</p>
      </div>
    </main>
  );
}
