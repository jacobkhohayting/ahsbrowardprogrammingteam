import type { ReactNode } from "react";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { adminLogout } from "@/lib/actions/auth";
import { ActionForm } from "@/components/ActionForm";
import { NavLinks } from "@/components/Chrome";

export const metadata: Metadata = { title: { default: "Admin", template: "%s | Admin" } };

const LINKS = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/contests", label: "Contests", also: ["/admin/problems", "/admin/tests"] },
  { href: "/admin/submissions", label: "Submissions" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/settings", label: "Settings" },
];

/** Everything under /admin (except the password page) requires the admin password. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <>
      <div className="subnav">
        <div className="subnav-inner">
          <span className="tag">Admin</span>
          <NavLinks className="subnav-links" items={LINKS} />
          <span className="push">
            <ActionForm action={adminLogout} className="inline" messages="none">
              <button className="plain">Leave admin</button>
            </ActionForm>
          </span>
        </div>
      </div>
      {children}
    </>
  );
}
