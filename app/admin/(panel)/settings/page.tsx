import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { saveSettings } from "@/lib/actions/admin-people";
import { ActionForm } from "@/components/ActionForm";

export const metadata: Metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  await requireAdmin();
  const settings = await getSettings();

  return (
    <main>
      <div className="head">
        <h1>Settings</h1>
      </div>
      <ActionForm action={saveSettings} className="medium">
        <label htmlFor="site_name">Site name</label>
        <input id="site_name" name="site_name" type="text" required maxLength={80} defaultValue={settings.siteName} />
        <p className="help">Shown in the top bar and in the browser tab.</p>

        <h2>Accounts</h2>
        <label className="check">
          <input type="checkbox" name="registration_open" defaultChecked={settings.registrationOpen} /> Anyone can
          create an account
        </label>
        <p className="help">Switch this off to stop new sign-ups. Existing accounts keep working.</p>

        <label htmlFor="email_domains">
          Only allow emails ending in <span className="muted">(optional)</span>
        </label>
        <input id="email_domains" name="email_domains" type="text" maxLength={500} placeholder="ahschool.com" defaultValue={settings.emailDomains} />
        <p className="help">
          Leave empty to allow any email address. Separate several endings with commas. The site does not send
          emails, so addresses are not verified.
        </p>

        <label htmlFor="names_visibility">Who sees students&apos; full names</label>
        <select id="names_visibility" name="names_visibility" defaultValue={settings.namesVisibility}>
          <option value="members">Logged-in users and organizers</option>
          <option value="everyone">Everyone, including visitors without an account</option>
          <option value="organizers">Only organizers</option>
        </select>
        <p className="help">
          Usernames are always public on leaderboards. Emails and PL numbers are only ever visible to organizers.
        </p>

        <h2>Judge</h2>
        <label className="check">
          <input type="checkbox" name="allow_run" defaultChecked={settings.allowRun} /> Students can use &ldquo;Run
          examples&rdquo;
        </label>
        <p className="help">
          Lets students try their code on the example tests before submitting. Each click starts a sandbox, so
          switching it off saves judge quota.
        </p>
        <div className="form-row">
          <div>
            <label htmlFor="time_factor_python">Time limit multiplier for Python</label>
            <input id="time_factor_python" name="time_factor_python" type="number" min={1} max={10} step={0.5} defaultValue={settings.timeFactorPython} />
          </div>
          <div>
            <label htmlFor="time_factor_java">Time limit multiplier for Java</label>
            <input id="time_factor_java" name="time_factor_java" type="number" min={1} max={10} step={0.5} defaultValue={settings.timeFactorJava} />
          </div>
        </div>
        <p className="help">
          1 means the same time limit as C++. Use 2 to give a slower language twice the time on every problem.
        </p>

        <div className="form-actions">
          <button className="btn primary">Save settings</button>
        </div>
      </ActionForm>

      <h2>Admin password</h2>
      <p style={{ maxWidth: "72ch" }}>
        The admin password is the <code>ADMIN_PASSWORD</code> environment variable in Vercel (Project, Settings,
        Environment Variables). To change it, edit that value and redeploy. Everyone signed in to the admin area is
        signed out when it changes. The judge is managed on the <Link href="/admin">Overview</Link> page.
      </p>
    </main>
  );
}
