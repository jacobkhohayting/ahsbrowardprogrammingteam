import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { updateProfile } from "@/lib/actions/auth";
import { ActionForm } from "@/components/ActionForm";
import { ProfileFields } from "@/components/ProfileFields";

export const metadata: Metadata = { title: "Your profile" };

export default async function ProfilePage() {
  const user = await requireUser("/profile");
  return (
    <main>
      <div className="narrow">
        <h1>Your profile</h1>
        <ActionForm action={updateProfile}>
          <ProfileFields values={user} />
          <h2>Change password</h2>
          <p className="help">Leave both empty to keep your current password.</p>
          <label htmlFor="current_password">Current password</label>
          <input id="current_password" name="current_password" type="password" autoComplete="current-password" />
          <label htmlFor="new_password">New password</label>
          <input id="new_password" name="new_password" type="password" minLength={8} maxLength={200} autoComplete="new-password" />
          <div className="form-actions">
            <button className="btn primary">Save profile</button>
          </div>
        </ActionForm>
      </div>
    </main>
  );
}
