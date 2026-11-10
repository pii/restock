import "server-only";
import { StoreError } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const TIMEOUT_MS = 20_000;

async function fetchStore(
  storeName: string,
  url: string,
  accept: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: accept,
        "Accept-Language": "el-GR,el;q=0.9,en;q=0.8",
        ...headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new StoreError(`${storeName} did not respond within ${TIMEOUT_MS / 1000} seconds.`);
    }
    throw new StoreError(`Could not reach ${storeName}: ${(err as Error).message}`);
  }

  if (res.status === 404) {
    throw new StoreError(`${storeName} has no product at that address.`);
  }
  if (res.status === 403 || res.status === 429) {
    throw new StoreError(
      `${storeName} refused the request (HTTP ${res.status}). It may be rate-limiting this server; try a longer check interval.`,
    );
  }
  if (!res.ok) {
    throw new StoreError(`${storeName} returned HTTP ${res.status}.`);
  }
  return res;
}

export async function fetchStoreJson<T>(
  storeName: string,
  url: string,
  init: { headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await fetchStore(storeName, url, "application/json", init.headers);
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    // Bot-protection challenges come back as HTML with a 200.
    throw new StoreError(
      `${storeName} returned a web page instead of product data. It may be showing a bot check to this server.`,
    );
  }
  return (await res.json()) as T;
}

/**
 * Fetches a page as text. Returns the final URL too, since stores redirect to
 * canonical addresses. Extra headers can ask for other formats, e.g. `RSC: 1`
 * for a Next.js page's data stream.
 */
export async function fetchStorePage(
  storeName: string,
  url: string,
  init: { headers?: Record<string, string> } = {},
): Promise<{ html: string; finalUrl: string }> {
  const res = await fetchStore(storeName, url, "text/html,application/xhtml+xml", init.headers);
  return { html: await res.text(), finalUrl: res.url || url };
}

/** Appends a throwaway query parameter so CDN caches return a fresh copy. */
export function withCacheBuster(url: string): string {
  const u = new URL(url);
  u.searchParams.set("_", String(Date.now()));
  return u.toString();
}
