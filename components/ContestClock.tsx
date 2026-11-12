"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { contestPhase, formatClock } from "@/lib/format";

type Props = {
  startAt: string;
  endAt: string;
  /** The server's clock when the page was made, so a wrong clock on the student's computer does not matter. */
  serverNow: number;
};

function describe(startAt: string, endAt: string, now: number) {
  const phase = contestPhase(startAt, endAt, now);
  if (phase === "ended") return { phase, text: "Finished", label: "" };
  const target = new Date(phase === "upcoming" ? startAt : endAt).getTime();
  const seconds = Math.max(0, Math.ceil((target - now) / 1000));
  const days = Math.floor(seconds / 86400);
  const text = days >= 2 ? `${days} days` : formatClock(seconds);
  return { phase, text, label: phase === "upcoming" ? "until it starts" : "remaining" };
}

/** The big countdown. Reloads the page's data when the contest starts or ends. */
export function ContestClock({ startAt, endAt, serverNow }: Props) {
  const router = useRouter();
  const offset = useRef(0);
  const [now, setNow] = useState(serverNow);
  const lastPhase = useRef(contestPhase(startAt, endAt, serverNow));

  useEffect(() => {
    offset.current = serverNow - Date.now();
    const tick = () => setNow(Date.now() + offset.current);
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [serverNow]);

  const { phase, text, label } = describe(startAt, endAt, now);

  useEffect(() => {
    if (phase !== lastPhase.current) {
      lastPhase.current = phase;
      router.refresh();
    }
  }, [phase, router]);

  return (
    <div className={`clock ${phase === "running" ? "is-running" : phase === "ended" ? "is-over" : ""}`} role="timer">
      {text}
      {label && <small>{label}</small>}
    </div>
  );
}
