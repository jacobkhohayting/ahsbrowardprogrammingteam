"use client";

import { useEffect, useState } from "react";
import { formatInZone } from "@/lib/format";

/**
 * Times are printed in the contest's own time zone. If the visitor's computer is in a
 * different zone, this adds the same moment in their local time.
 */
export function LocalTime({ iso, timeZone }: { iso: string; timeZone: string }) {
  const [local, setLocal] = useState<string | null>(null);

  useEffect(() => {
    try {
      const mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!mine || mine === timeZone) return;
      const theirs = formatInZone(iso, timeZone);
      const ours = formatInZone(iso, mine);
      if (theirs !== ours) setLocal(ours);
    } catch {
      // Keep the contest's own time only.
    }
  }, [iso, timeZone]);

  if (!local) return null;
  return <span className="muted"> ({local} your time)</span>;
}

/** A date and time shown in the visitor's own time zone (used for submission times). */
export function When({ iso }: { iso: string }) {
  const [text, setText] = useState<string>(() => iso.slice(0, 16).replace("T", " ") + " UTC");
  useEffect(() => {
    const date = new Date(iso);
    const sameDay = date.toDateString() === new Date().toDateString();
    setText(
      new Intl.DateTimeFormat("en-US", {
        month: sameDay ? undefined : "short",
        day: sameDay ? undefined : "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: sameDay ? "2-digit" : undefined,
      }).format(date),
    );
  }, [iso]);
  return (
    <time dateTime={iso} title={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
