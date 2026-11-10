import "server-only";
import { germanos } from "./germanos";
import { kotsovolos } from "./kotsovolos";
import { plaisio } from "./plaisio";
import { publicStore } from "./public";
import type { StoreAdapter } from "./types";

// Add new stores here. Each one implements StoreAdapter (see ./types.ts).
const STORES: StoreAdapter[] = [germanos, kotsovolos, publicStore, plaisio];

const byId = new Map(STORES.map((s) => [s.id, s]));

export function listStores(): StoreAdapter[] {
  return STORES;
}

export function getStore(id: string): StoreAdapter | undefined {
  return byId.get(id);
}

/** Plain data for client components. */
export type StoreInfo = {
  id: string;
  name: string;
  homepage: string;
  logo: string;
  searchable: boolean;
  searchPlaceholder: string;
};

export function storeInfo(store: StoreAdapter): StoreInfo {
  return {
    id: store.id,
    name: store.name,
    homepage: store.homepage,
    logo: store.logo,
    searchable: store.searchable,
    searchPlaceholder: store.searchPlaceholder,
  };
}

export { StoreError } from "./types";
export type { StoreAdapter, ProductPreview, ProductVariant, RawResponse, SearchResult } from "./types";
