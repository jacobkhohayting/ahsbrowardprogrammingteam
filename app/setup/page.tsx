import type { Metadata } from "next";
import Link from "next/link";
import { getViewerSafe } from "@/lib/auth";
import { checkHealth, type Check } from "@/lib/health";

export const metadata: Metadata = { title: "Setup check" };

const LABEL = { good: "Ready", bad: "Missing", wait: "Check" } as const;

function Row({ check }: { check: Check }) {
  return (
    <li>
      <span className={`state ${check.state}`}>{LABEL[check.state]}</span>
      <div>
        <strong>{check.title}</strong>
        <p>{check.detail}</p>
        {check.fix && (
          <p>
            <strong>To fix:</strong> {check.fix}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * Tells whoever is setting the site up exactly what is missing.
 * Once everything works, only organizers see the details.
 */
export default async function SetupPage() {
  const [health, viewer] = await Promise.all([checkHealth(), getViewerSafe()]);

  if (health.ready && !viewer.isAdmin) {
    return (
      <main>
        <h1>The site is set up</h1>
        <p style={{ marginTop: "1rem" }}>
          Everything it needs is in place. Organizers can see the details after signing in to the{" "}
          <Link href="/admin">admin area</Link>.
        </p>
      </main>
    );
  }

  return (
    <main>
      <div className="head">
        <div>
          <h1>Setup check</h1>
          <p className="muted">
            {health.ready
              ? "The site is running. This is the current state of each part."
              : "The site needs the items marked Missing before it can be used."}
          </p>
        </div>
      </div>
      <ul className="checklist">
        <Row check={health.database} />
        <Row check={health.admin} />
        <Row check={health.judge} />
      </ul>
      {!health.ready && (
        <p className="msg note">
          Environment variables and databases only reach the site after a new deployment. In Vercel, open
          Deployments, pick the newest one, and choose Redeploy.
        </p>
      )}
      {health.ready && (
        <p>
          <Link href="/admin">Go to the admin area</Link>
        </p>
      )}
    </main>
  );
}
