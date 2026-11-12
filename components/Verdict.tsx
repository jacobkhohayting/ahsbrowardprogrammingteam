import { VERDICT_NAMES, type Verdict as VerdictCode } from "@/lib/format";

type Props = {
  status: "queued" | "judging" | "done";
  verdict: VerdictCode | null;
  failedTest?: number | null;
  invalidated?: boolean;
};

/** "Accepted", "Wrong answer on test 3", "In queue", ... in the verdict's color. */
export function Verdict({ status, verdict, failedTest, invalidated }: Props) {
  if (status === "queued") return <span className="verdict v-wait">In queue</span>;
  if (status === "judging") return <span className="verdict v-wait">Judging</span>;
  const name = verdict ? VERDICT_NAMES[verdict] : "Unknown";
  const where =
    verdict && failedTest && verdict !== "AC" && verdict !== "CE" && verdict !== "JE" ? ` on test ${failedTest}` : "";
  if (invalidated) {
    return (
      <span className="verdict v-void" title="Removed from the standings by an organizer">
        {name}
        {where}
      </span>
    );
  }
  return (
    <span className={`verdict v-${verdict ?? "JE"}`}>
      {name}
      {where}
    </span>
  );
}
