"use client";

import { useEffect } from "react";

/** Shown when a page fails to load (most often: the database is not connected or is unreachable). */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main>
      <h1>This page could not load</h1>
      <p style={{ marginTop: "1rem", maxWidth: "60ch" }}>
        The site could not get its data. This usually passes in a moment, so try again first.
      </p>
      <div className="actions">
        <button type="button" className="btn primary" onClick={() => reset()}>
          Try again
        </button>
        <a className="btn" href="/">
          Go to the contests
        </a>
      </div>
      <p className="help" style={{ marginTop: "2rem" }}>
        Run this site? <a href="/setup">Open the setup check</a> to see what is missing.
        {error.digest ? ` Error reference for the Vercel logs: ${error.digest}` : ""}
      </p>
    </main>
  );
}
