// Client-safe response shapes for the store lookup API.
import type { ProductPreview, RawResponse, SearchResult } from "./stores/types";

/** Body of GET /api/trackers/[id]/raw. */
export type RawResponseBody = RawResponse & { store: string; fetchedAt: number };

export type ProductWithTracking = ProductPreview & { trackedIds: string[] };

export type LookupResponse =
  | { type: "product"; product: ProductWithTracking }
  | { type: "search"; query: string; results: SearchResult[] };

export type { ProductPreview, ProductVariant, SearchResult } from "./stores/types";
