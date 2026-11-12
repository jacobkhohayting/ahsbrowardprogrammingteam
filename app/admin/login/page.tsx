import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { adminPassword, getViewerSafe } from "@/lib/auth";
import { adminLogin } from "@/lib/actions/auth";
import { ActionForm } from "@/components/ActionForm";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminLoginPage() {
  const { isAdmin } = await getViewerSafe();
  if (isAdmin) redirect("/admin");
  const configured = adminPassword() !== "";

  return (
    <main>
      <div className="narrow">
        <h1>Admin area</h1>
        {configured ? (
          <ActionForm action={adminLogin}>
            <label htmlFor="password">Admin password</label>
            <input id="password" name="password" type="password" required autoFocus autoComplete="current-password" />
            <div className="form-actions">
              <button className="btn primary">Enter</button>
            </div>
          </ActionForm>
        ) : (
          <p className="msg warn">
            The admin area is switched off because no admin password is set. In Vercel, open this project, go to
            Settings, then Environment Variables, add <code>ADMIN_PASSWORD</code> with a password of your choice, and
            redeploy. <a href="/setup">See the setup check</a>
          </p>
        )}
        <p className="help" style={{ marginTop: "1.5rem" }}>
          For club officers. The password is the one set as <code>ADMIN_PASSWORD</code> in Vercel. You stay signed in
          for 12 hours.
        </p>
      </div>
    </main>
  );
}
