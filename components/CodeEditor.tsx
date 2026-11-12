"use client";

import { useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import type { Compartment } from "@codemirror/state";
import type { Language } from "@/lib/format";

type Props = {
  value: string;
  onChange: (value: string) => void;
  language: Language;
  label?: string;
};

type Loaded = { view: EditorView; languageSlot: Compartment; languages: Record<Language, () => unknown> };

/**
 * The code editor (CodeMirror). It is loaded after the page appears; until then, and if
 * loading fails, a plain text box does the same job.
 */
export function CodeEditor({ value, onChange, language, label = "Your code" }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const loaded = useRef<Loaded | null>(null);
  const latest = useRef({ value, onChange, language });
  latest.current = { value, onChange, language };
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cm, state, view, commands, lang, highlight, cpp, python, java] = await Promise.all([
          import("codemirror"),
          import("@codemirror/state"),
          import("@codemirror/view"),
          import("@codemirror/commands"),
          import("@codemirror/language"),
          import("@lezer/highlight"),
          import("@codemirror/lang-cpp"),
          import("@codemirror/lang-python"),
          import("@codemirror/lang-java"),
        ]);
        if (cancelled || !holder.current) return;

        const t = highlight.tags;
        // Colors come from CSS variables, so the editor follows light and dark mode by itself.
        const style = lang.HighlightStyle.define([
          { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: "var(--syn-keyword)" },
          { tag: [t.string, t.character, t.special(t.string)], color: "var(--syn-string)" },
          { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syn-number)" },
          { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--syn-comment)", fontStyle: "italic" },
          { tag: [t.typeName, t.className, t.namespace], color: "var(--syn-type)" },
          { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--syn-function)" },
          { tag: [t.processingInstruction, t.meta, t.macroName], color: "var(--syn-meta)" },
        ]);

        const languages: Record<Language, () => unknown> = {
          cpp: () => cpp.cpp(),
          python: () => python.python(),
          java: () => java.java(),
        };
        const languageSlot = new state.Compartment();
        const editor = new cm.EditorView({
          parent: holder.current,
          state: state.EditorState.create({
            doc: latest.current.value,
            extensions: [
              cm.basicSetup,
              view.keymap.of([commands.indentWithTab]),
              lang.indentUnit.of("    "),
              state.EditorState.tabSize.of(4),
              lang.syntaxHighlighting(style),
              languageSlot.of(languages[latest.current.language]() as never),
              view.EditorView.contentAttributes.of({ "aria-label": label }),
              view.EditorView.updateListener.of((update) => {
                if (update.docChanged) latest.current.onChange(update.state.doc.toString());
              }),
            ],
          }),
        });
        loaded.current = { view: editor, languageSlot, languages };
        setReady(true);
        // The web font can arrive after the editor measured its lines; measure again so the
        // line numbers stay aligned with the code.
        void document.fonts?.ready.then(() => {
          if (!cancelled) editor.requestMeasure();
        });
      } catch (error) {
        console.error("The code editor could not load; using a plain text box.", error);
      }
    })();
    return () => {
      cancelled = true;
      loaded.current?.view.destroy();
      loaded.current = null;
    };
    // Loaded once; later changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Text changed from outside (another language's draft, a loaded file).
  useEffect(() => {
    const editor = loaded.current?.view;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current !== value) editor.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value, ready]);

  useEffect(() => {
    const l = loaded.current;
    if (l) l.view.dispatch({ effects: l.languageSlot.reconfigure(l.languages[language]() as never) });
  }, [language, ready]);

  return (
    <div className="editor">
      <div ref={holder} />
      {!ready && (
        <textarea
          className="code"
          aria-label={label}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Tab") {
              event.preventDefault();
              const area = event.currentTarget;
              const { selectionStart: start, selectionEnd: end } = area;
              onChange(value.slice(0, start) + "    " + value.slice(end));
              requestAnimationFrame(() => area.setSelectionRange(start + 4, start + 4));
            }
          }}
        />
      )}
    </div>
  );
}
