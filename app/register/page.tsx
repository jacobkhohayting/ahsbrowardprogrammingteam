import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer, safeNext } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { register } from "@/lib/actions/auth";
import { ActionForm } from "@/components/ActionForm";
import { ProfileFields } from "@/components/ProfileFields";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, "/");
  const [{ user }, settings] = await Promise.all([getViewer(), getSettings()]);
  if (user) redirect(next);

  const domains = settings.emailDomains
    .split(",")
    .map((d) => d.trim().replace(/^@/, ""))
    .filter(Boolean);

  return (
    <main>
      <div className="narrow">
        <h1>Create your account</h1>
        {settings.registrationOpen ? (
          <ActionForm action={register}>
            <input type="hidden" name="next" value={next} />
            <ProfileFields emailHint={domains.length ? `Must end in @${domains.join(" or @")}.` : undefined} />
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required minLength={8} maxLength={200} autoComplete="new-password" />
            <p className="help">At least 8 characters.</p>
            <div className="form-actions">
              <button className="btn primary">Create account</button>
            </div>
          </ActionForm>
        ) : (
          <p className="msg note">New accounts are closed right now. Ask a club officer if you need one.</p>
        )}
        <p className="help" style={{ marginTop: "1.5rem" }}>
          Already have an account? <Link href={`/login?next=${encodeURIComponent(next)}`}>Log in</Link>
        </p>
      </div>
    </main>
  );
}
