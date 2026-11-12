import "server-only";
import { cache } from "react";
import { LANGUAGE_KEYS, LANGUAGE_NAMES, type Language } from "../format";
import { judgeMode } from "./credentials";
import { getRuntime, languageDisplayNames } from "./runtime";

export type LanguageOption = { key: Language; name: string; available: boolean; reason: string };

/**
 * The languages students can pick, with the real compiler versions once the judge has
 * been prepared. A language that failed the judge's self-test is listed as unavailable.
 */
export const languageOptions = cache(async (): Promise<LanguageOption[]> => {
  if (judgeMode() === "local") {
    return LANGUAGE_KEYS.map((key) => ({ key, name: LANGUAGE_NAMES[key], available: true, reason: "" }));
  }
  const runtime = await getRuntime();
  const names = languageDisplayNames(runtime);
  return LANGUAGE_KEYS.map((key) => {
    const status = runtime?.languages[key];
    return {
      key,
      name: names[key],
      available: status ? status.ok : true, // unknown until the judge is prepared: assume yes
      reason: status && !status.ok ? status.message : "",
    };
  });
});

export async function languageName(key: Language): Promise<string> {
  return (await languageOptions()).find((option) => option.key === key)?.name ?? LANGUAGE_NAMES[key];
}
