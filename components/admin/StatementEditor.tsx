"use client";

import { useDeferredValue, useState } from "react";
import { Markdown } from "@/components/Markdown";

type Props = { name: string; label: string; hint?: string; defaultValue: string; rows?: number };

/** A Markdown text box with a live preview of what students will see. */
export function StatementEditor({ name, label, hint, defaultValue, rows = 18 }: Props) {
  const [value, setValue] = useState(defaultValue);
  const preview = useDeferredValue(value);
  return (
    <div className="columns">
      <div>
        <label htmlFor={name}>
          {label} {hint && <span className="muted">{hint}</span>}
        </label>
        <textarea id={name} name={name} rows={rows} value={value} onChange={(e) => setValue(e.target.value)} spellCheck />
      </div>
      <div>
        <label>Preview</label>
        <div className="preview">{preview.trim() ? <Markdown>{preview}</Markdown> : <span className="muted">Nothing yet.</span>}</div>
      </div>
    </div>
  );
}
