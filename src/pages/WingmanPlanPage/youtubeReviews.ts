/**
 * Live YouTube Data API client for the product reviews panel's
 * "Videos" tab.
 *
 * Given a product query (e.g. "DJI Osmo Action 5 Pro review") this
 * fetches the top matching videos via the YouTube Data API v3 `search`
 * endpoint and returns a compact, render-ready shape.
 *
 * The API key is read from `import.meta.env.VITE_YOUTUBE_API_KEY`.
 * Same tradeoff as the existing `VITE_OPENAI_API_KEY` path — the key
 * ships in the browser bundle, so it should be HTTP-referrer
 * restricted in the Google Cloud console. When the key is missing we
 * throw a typed `YouTubeConfigError` so the panel can fall back to a
 * plain "search on YouTube" link instead of rendering a broken player.
 *
 * Results are memoised per query for the session so reopening the same
 * product doesn't burn extra quota.
 */

export type YouTubeReview = {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
};

/** Thrown when no API key is configured — lets the UI degrade to a
 * search link rather than surfacing a generic fetch failure. */
export class YouTubeConfigError extends Error {
  constructor() {
    super("VITE_YOUTUBE_API_KEY is not configured");
    this.name = "YouTubeConfigError";
  }
}

const SEARCH_ENDPOINT = "https://www.googleapis.com/youtube/v3/search";
const MAX_RESULTS = 8;

/* Session cache keyed by the exact query string. */
const cache = new Map<string, YouTubeReview[]>();

type YouTubeSearchItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: {
      medium?: { url?: string };
      high?: { url?: string };
      default?: { url?: string };
    };
  };
};

function mapItem(item: YouTubeSearchItem): YouTubeReview | null {
  const videoId = item.id?.videoId;
  if (!videoId) return null;
  const snippet = item.snippet ?? {};
  const thumb =
    snippet.thumbnails?.medium?.url ??
    snippet.thumbnails?.high?.url ??
    snippet.thumbnails?.default?.url ??
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  return {
    videoId,
    title: snippet.title ?? "Untitled video",
    channelTitle: snippet.channelTitle ?? "YouTube",
    publishedAt: snippet.publishedAt ?? "",
    thumbnailUrl: thumb,
  };
}

/**
 * Fetch up to {@link MAX_RESULTS} review videos for `query`. Throws
 * `YouTubeConfigError` when the key is missing and a generic `Error`
 * on a non-2xx response.
 */
export async function fetchYouTubeReviews(
  query: string,
  signal?: AbortSignal,
): Promise<YouTubeReview[]> {
  const cached = cache.get(query);
  if (cached) return cached;

  const key = import.meta.env.VITE_YOUTUBE_API_KEY;
  if (!key) throw new YouTubeConfigError();

  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", String(MAX_RESULTS));
  url.searchParams.set("q", query);
  url.searchParams.set("key", key);

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) {
    throw new Error(
      `YouTube search failed (${response.status} ${response.statusText})`,
    );
  }
  const data: { items?: YouTubeSearchItem[] } = await response.json();
  const reviews = (data.items ?? [])
    .map(mapItem)
    .filter((r): r is YouTubeReview => r !== null);

  cache.set(query, reviews);
  return reviews;
}

/** Build a plain YouTube search URL — the fallback when the API key is
 * absent or the request fails, so the shopper can still find reviews. */
export function youtubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}
