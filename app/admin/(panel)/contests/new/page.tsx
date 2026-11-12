import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { ContestForm } from "@/components/admin/ContestForm";

export const metadata: Metadata = { title: "New contest" };

export default async function NewContestPage() {
  await requireAdmin();
  return (
    <main>
      <p className="crumb">
        <Link href="/admin/contests">Contests</Link>
      </p>
      <div className="head">
        <h1>New contest</h1>
      </div>
      <ContestForm
        values={{
          name: "",
          description: "",
          timezone: "America/New_York",
          start_local: "",
          end_local: "",
          visible: false,
          leaderboard_type: "short",
          penalty_per_wrong: 10,
          decay_per_minute: 1,
          wrong_penalty_pts: 0,
          show_code_after: false,
          show_editorial: true,
        }}
      />
    </main>
  );
}
