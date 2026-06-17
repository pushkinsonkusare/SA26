import OpenAI from "openai";

/* =============================================================
 * LLM upgrade for the WingmanPlanPage hero headline.
 *
 * One-shot OpenAI call that converts a free-text shopper query
 * (e.g. "i am going camping, what do you suggest") into a punchy
 * 2-5 word hero headline (e.g. "equipment for camping"). The page
 * keeps showing the synchronous heuristic from `shortenQuery()`
 * while this resolves; on success the caller cross-fades to the
 * LLM result. On any failure the heuristic remains visible so the
 * shopper never sees an error.
 *
 * Design notes (mirrors `assistantSuggestionsLLM.ts`):
 *   - Reads `VITE_OPENAI_API_KEY` from env. Returns `null` when
 *     unset so the caller silently keeps the heuristic.
 *   - Per-query in-memory cache. A repeated query inside the
 *     same session never re-fires the network request.
 *   - Cancellable via AbortSignal — caller passes a signal that
 *     gets aborted on query change or unmount, so a stale
 *     response can't overwrite fresh state.
 *   - On any error (network, parse, schema, abort) returns
 *     `null`; never throws into the caller's render path.
 *   - Output is validated: non-empty, <= 6 words, no quote chars,
 *     no trailing punctuation. Anything else returns `null`.
 * ============================================================= */

const API_KEY = (import.meta.env.VITE_OPENAI_API_KEY ?? "").trim();
const MODEL = (import.meta.env.VITE_OPENAI_MODEL ?? "").trim() || "gpt-4o-mini";

/** In-memory cache scoped to the page session. Key is the lower-
 *  cased trimmed query so casing variations share a result. */
const cache = new Map<string, string>();

/** Lazily instantiated singleton — avoids creating a client when the
 *  API key is missing. */
let clientSingleton: OpenAI | null = null;
function getClient(): OpenAI | null {
  if (!API_KEY) return null;
  if (clientSingleton == null) {
    clientSingleton = new OpenAI({
      apiKey: API_KEY,
      dangerouslyAllowBrowser: true,
    });
  }
  return clientSingleton;
}

const SYSTEM_PROMPT = [
  "You convert a shopper's free-text query into a short hero headline for a gear shopping page.",
  'Format: "{modifier} {thing} for {activity}" — 2 to 5 words total.',
  "- Use generic shopping nouns for {thing}: equipment, gear, kit, tech.",
  "- If the shopper mentions skill level (beginner, pro, intermediate, advanced), use it as the {modifier}; otherwise omit the modifier.",
  '- Drop polite/conversational phrasing ("what do you suggest", "i want", "help me", "can you", "i am going").',
  "- Lowercase except proper nouns and product names.",
  "- Output ONLY the headline. No quotes, no surrounding punctuation, no preamble, no markdown.",
  "",
  "Examples:",
  "shopper: i am going camping, what do you suggest",
  "headline: equipment for camping",
  "",
  "shopper: i am a beginner camera tech enthusiast going camping",
  "headline: beginner tech for camping",
  "",
  "shopper: what's the best drone for travel vlogging",
  "headline: kit for travel vlogging",
  "",
  "shopper: help me start drone photography",
  "headline: gear for drone photography",
  "",
  "shopper: i need a pro setup for wedding videography",
  "headline: pro kit for wedding videography",
].join("\n");

/** Strict-but-tolerant validation on the model's response. We bias
 *  toward returning `null` (and letting the heuristic stand) rather
 *  than rendering something weird. */
function sanitize(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let text = raw.trim();
  if (!text) return null;

  // Strip a leading "headline:" label if the model echoes the example
  // format. Cheap to do; saves a re-prompt.
  text = text.replace(/^headline\s*:\s*/i, "").trim();

  // Drop wrapping quotes / backticks / asterisks if present.
  text = text.replace(/^[`"'*_]+/, "").replace(/[`"'*_]+$/, "").trim();

  // Reject any internal quote characters — implies the model went off
  // script and we'd render something janky.
  if (/["'`]/.test(text)) return null;

  // Strip trailing terminal punctuation that the prompt forbids but
  // models occasionally append anyway.
  text = text.replace(/[.!?,;:]+$/g, "").trim();

  if (!text) return null;

  // Word-count bound. Six is generous for the "{modifier} {thing}
  // for {activity}" template.
  const wordCount = text.split(/\s+/).length;
  if (wordCount === 0 || wordCount > 6) return null;

  // Hard length cap as a second line of defense against runaway output.
  if (text.length > 64) return null;

  return text;
}

/**
 * Fetch an LLM-generated hero headline for the given shopper query.
 *
 * @returns Lower-cased headline phrase on success (caller is expected
 *          to capitalize the first letter for display), or `null`
 *          when no API key is configured / the request was aborted /
 *          the response failed validation. Caller should keep the
 *          heuristic fallback visible in the null case.
 */
export async function generateHeadline(
  query: string,
  signal: AbortSignal,
): Promise<string | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const client = getClient();
  if (!client) return null;

  const cacheKey = trimmed.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  if (signal.aborted) return null;

  try {
    const response = await client.chat.completions.create(
      {
        model: MODEL,
        // Low temperature — we want consistent, on-template phrasing.
        temperature: 0.2,
        // Headlines are tiny; cap the budget so a runaway response
        // can't burn tokens.
        max_tokens: 24,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `shopper: ${trimmed}\nheadline:` },
        ],
      },
      { signal },
    );

    if (signal.aborted) return null;

    const headline = sanitize(response.choices[0]?.message?.content);
    if (!headline) return null;

    cache.set(cacheKey, headline);
    return headline;
  } catch (error) {
    // Abort errors are expected on every query change — don't pollute
    // the console. Log other failures once for debug parity with the
    // existing OpenAI integrations.
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      (error as { name?: string }).name === "AbortError"
    ) {
      return null;
    }
    // eslint-disable-next-line no-console
    console.warn("[headlineLLM] fetch failed", error);
    return null;
  }
}

/** Whether an API key is configured — caller can short-circuit the
 *  effect entirely when this is false. */
export function isHeadlineLlmAvailable(): boolean {
  return Boolean(API_KEY);
}
