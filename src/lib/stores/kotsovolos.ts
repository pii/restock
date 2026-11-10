import "server-only";
import { isAvailableStatus, isOrderableStatus, type StockStatus } from "../status";
import { fetchStoreJson, fetchStorePage, withCacheBuster } from "./http";
import {
  StoreError,
  type Availability,
  type ProductPreview,
  type ProductVariant,
  type SearchResult,
  type StoreAdapter,
} from "./types";

const BASE = "https://www.kotsovolos.gr";
const ASSETS = "https://assets.kotsovolos.gr/product";
const STORE_ID = "10151";
const NAME = "Kotsovolos";

/** Kotsovolos part numbers are six digits, e.g. 341593. */
const PART_NUMBER = /^\d{6}$/;

// ---- Shapes of the kotsovolos.gr data (only the fields we read) ----------

type KotsovolosPrice = { usage?: string; value?: string | number };

type KotsovolosEntry = {
  partNumber?: string;
  name?: string;
  price?: KotsovolosPrice[];
  price_EUR?: string | number;
  UserData?: { seo_url?: string; x_availability_hd?: string }[];
};

/** `pageProps.availabilityData` on a product page: the live status the buy button uses. */
type KotsovolosAvailability = {
  availableStatusKey?: string;
  ctaNameTextKey?: string;
  /** Home delivery: 1 ships now, 3 ships later (on order / expected soon), 4 not available. */
  homeDeliveryCase?: number;
  callStatus?: boolean;
};

type ProductPageProps = {
  canonicalUrl?: string;
  pdpPartNumber?: string;
  productDetails?: { catalogEntryView?: KotsovolosEntry[] };
  availabilityData?: KotsovolosAvailability;
};

// ---- Status mapping ---------------------------------------------------------

// `availableStatusKey` values used by the site.
const STATUS_KEYS: Record<string, { status: StockStatus; label: string }> = {
  IMMEDIATELY_AVAILABLE: { status: "in_stock", label: "Immediately available" },
  LAST_PIECES: { status: "low_stock", label: "Last pieces" },
  ON_ORDER: { status: "backorder", label: "On order" },
  SPECIAL_ORDER: { status: "backorder", label: "Special order" },
  PREORDERABLE: { status: "preorder", label: "Pre-orderable" },
  EXPECTED_SOON: { status: "coming_soon", label: "Expected soon" },
  NOT_AVAILABLE: { status: "out_of_stock", label: "Not available" },
  EXHAUSTED: { status: "out_of_stock", label: "Exhausted" },
  LAST_PIECES_EXHAUSTED: { status: "out_of_stock", label: "Last pieces exhausted" },
};

// `x_availability_hd` (home delivery) codes from the search index. Only a
// fallback: the index can lag behind the live product page.
const INDEX_CODES: Record<string, StockStatus> = {
  "1": "in_stock",
  "3": "backorder",
  "4": "out_of_stock",
};

function availability(status: StockStatus, label: string | null): Availability {
  return { status, available: isAvailableStatus(status), label, stock: null };
}

function indexAvailability(entry: KotsovolosEntry | undefined): Availability {
  const code = entry?.UserData?.[0]?.x_availability_hd;
  return availability((code && INDEX_CODES[code]) || "unknown", null);
}

/**
 * The buy button (`ctaNameTextKey`) says whether the product can be ordered
 * online; `availableStatusKey` adds the detail (last pieces, on order, ...).
 * This mirrors how kotsovolos.gr itself renders the product page.
 */
function liveAvailability(a: KotsovolosAvailability | undefined, entry: KotsovolosEntry): Availability {
  if (!a || a.callStatus === false) return indexAvailability(entry);

  const cta = (a.ctaNameTextKey ?? "").toUpperCase();
  const key = (a.availableStatusKey ?? "").toUpperCase();
  const known = STATUS_KEYS[key];

  if (cta === "PREORDER_BTN" || key === "PREORDERABLE") {
    return availability("preorder", STATUS_KEYS.PREORDERABLE.label);
  }
  if (cta === "BUY_BTN") {
    // Can be ordered now. "Expected soon" with a buy button means it ships
    // when stock arrives, like "on order".
    if (key === "EXPECTED_SOON") return availability("backorder", STATUS_KEYS.EXPECTED_SOON.label);
    if (known && isOrderableStatus(known.status)) return availability(known.status, known.label);
    // Blank or unknown key (the site hides a stale "not available" when the
    // button says buy): the home-delivery case says whether it ships now.
    return a.homeDeliveryCase === 3 ? availability("backorder", null) : availability("in_stock", null);
  }
  if (cta === "CHECK_OUT_THE_STORES") {
    return availability("out_of_stock", "Not orderable online, check the stores");
  }
  if (cta === "NOT_AVAILABLE") {
    return key === "EXPECTED_SOON"
      ? availability("coming_soon", STATUS_KEYS.EXPECTED_SOON.label)
      : availability("out_of_stock", known?.label ?? STATUS_KEYS.NOT_AVAILABLE.label);
  }
  return known ? availability(known.status, known.label) : indexAvailability(entry);
}

// ---- Helpers ----------------------------------------------------------------

function offerPrice(entry: KotsovolosEntry): number | null {
  const offer = entry.price?.find((p) => p.usage === "Offer") ?? entry.price?.find((p) => p.usage === "Display");
  for (const raw of [offer?.value, entry.price_EUR]) {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function imageUrl(partNumber: string): string {
  return `${ASSETS}/${partNumber}-b.jpg`;
}

function productUrl(entry: KotsovolosEntry, partNumber: string): string {
  const seo = entry.UserData?.[0]?.seo_url;
  return seo ? `${BASE}/${seo.replace(/^\/+/, "")}` : `${BASE}/ProductDisplay?partNumber=${partNumber}`;
}

/** Path of a kotsovolos.gr URL without the leading slash, used to fetch the page again. */
function pagePath(url: string): string | null {
  try {
    const u = new URL(url);
    return /(^|\.)kotsovolos\.gr$/i.test(u.hostname) ? u.pathname.replace(/^\/+/, "") || null : null;
  } catch {
    return null;
  }
}

function assertPartNumber(partNumber: string): void {
  if (!PART_NUMBER.test(partNumber)) {
    throw new StoreError(`"${partNumber}" is not a valid ${NAME} product code.`);
  }
}

function readPageProps(html: string): ProductPageProps | null {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return (JSON.parse(m[1]) as { props?: { pageProps?: ProductPageProps } }).props?.pageProps ?? null;
  } catch {
    return null;
  }
}

/**
 * Loads the live product page. `path` is the saved page path (fast, no
 * redirect); without it, or if it has moved, the part number is resolved
 * through the store's ProductDisplay redirect.
 */
async function loadProductPage(partNumber: string, path?: string | null) {
  assertPartNumber(partNumber);
  const attempts = [
    ...(path ? [`${BASE}/${path}`] : []),
    `${BASE}/ProductDisplay?partNumber=${partNumber}`,
  ];

  let lastError: unknown = null;
  for (const url of attempts) {
    try {
      // Product pages are cached at the CDN; the extra parameter forces a fresh copy.
      const { html, finalUrl } = await fetchStorePage(NAME, withCacheBuster(url));
      const props = readPageProps(html);
      const entry = props?.productDetails?.catalogEntryView?.[0];
      if (!props || !entry) {
        throw new StoreError(`${NAME} returned a page without product data. It may be showing a bot check.`);
      }
      if (String(entry.partNumber ?? props.pdpPartNumber) !== partNumber) {
        throw new StoreError(`${NAME} has no product with code ${partNumber}.`);
      }
      const canonical = props.canonicalUrl || finalUrl;
      return { props, entry, path: pagePath(canonical), url: canonical.split("?")[0] };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof StoreError ? lastError : new StoreError(`Could not load ${NAME} product ${partNumber}.`);
}

/** lookupId is the saved page path; ignore it if it is not one (e.g. an old value). */
function savedPath(lookupId?: string | null): string | null {
  return lookupId && !lookupId.startsWith("ProductDisplay") ? lookupId : null;
}

async function productVariant(partNumber: string, path?: string | null): Promise<ProductVariant> {
  const { props, entry, path: freshPath, url } = await loadProductPage(partNumber, path);
  return {
    productId: partNumber,
    lookupId: freshPath ?? `ProductDisplay?partNumber=${partNumber}`,
    name: entry.name || `${NAME} product ${partNumber}`,
    // Colours and sizes are separate products at Kotsovolos, so there is nothing to pick.
    variant: null,
    url,
    imageUrl: imageUrl(partNumber),
    price: offerPrice(entry),
    ...liveAvailability(props.availabilityData, entry),
  };
}

// ---- Adapter ----------------------------------------------------------------

type SearchResponse = {
  productIds?: (number | string)[];
  /** Total number of matches. */
  recordSet?: number;
  /** Results per page. */
  recordSetCount?: number;
};
type DetailsResponse = { catalogEntryView?: KotsovolosEntry[] };

/** One product in /wcs/shop/ProductDataView, the data the site's own product lists use. */
type ListingEntry = {
  partNumber?: string;
  UserData?: { x_availability_hd?: number | string }[];
  /** A list of one-key objects: callToAction, availabilityHome, lastPieces, ... */
  AvailabilityData?: Record<string, unknown>[];
};

/** Upper-cases and strips Greek accents so "Αναμένεται" matches "ΑΝΑΜΕΝΕΤΑΙ". */
function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
}

/**
 * Live availability from the listing data. It agrees with the product page
 * (the search index can lag behind both) and costs ~1.5 KB per product.
 */
function listingAvailability(entry: ListingEntry): Availability {
  const data: Record<string, unknown> = Object.assign({}, ...(entry.AvailabilityData ?? []));
  const cta = String(data.callToAction ?? "").toUpperCase();
  const code = String(entry.UserData?.[0]?.x_availability_hd ?? "");
  const home = typeof data.availabilityHome === "string" ? data.availabilityHome.trim() || null : null;
  const lastPieces = typeof data.lastPieces === "number" ? data.lastPieces : null;

  if (cta === "PREORDER_BTN") return availability("preorder", home);
  if (cta === "BUY_BTN") {
    if (code === "3") return availability("backorder", home);
    // lastPieces is 100 normally and the remaining count when only a few are left.
    if (lastPieces !== null && lastPieces > 0 && lastPieces < 100) return availability("low_stock", home);
    return availability("in_stock", home);
  }
  if (cta === "CHECK_OUT_THE_STORES") return availability("out_of_stock", home ?? "Not orderable online, check the stores");
  if (cta === "NOT_AVAILABLE") {
    return availability(home && fold(home).includes("ΑΝΑΜΕΝΕΤΑΙ") ? "coming_soon" : "out_of_stock", home);
  }
  return availability(INDEX_CODES[code] ?? "unknown", home);
}

/** Live availability for products, 30 per request. Missing products are left out. */
async function liveListing(ids: string[]): Promise<Map<string, Availability>> {
  const out = new Map<string, Availability>();
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const r = await fetchStoreJson<{ catalogEntryView?: ListingEntry[] }[]>(
      NAME,
      `${BASE}/wcs/shop/ProductDataView?storeId=${STORE_ID}&partNumbers=${chunk.map(encodeURIComponent).join(",")}`,
    );
    for (const group of Array.isArray(r) ? r : []) {
      for (const e of group.catalogEntryView ?? []) {
        if (e.partNumber) out.set(String(e.partNumber), listingAvailability(e));
      }
    }
  }
  return out;
}

/** Index codes (x_availability_hd) for products that can be ordered: in stock, on order. */
const ORDERABLE_CODES = new Set(["1", "3"]);
const OUT_OF_STOCK_CODE = "4";
const MAX_OUT_OF_STOCK_RESULTS = 12;

/** Search result groups, in display order. "Available" is in stock only. */
const SECTIONS = ["Available", "On order", "Out of stock", "Other results"] as const;

function sectionFor(status: StockStatus): (typeof SECTIONS)[number] {
  switch (status) {
    case "in_stock":
    case "low_stock":
      return "Available";
    case "backorder":
    case "preorder":
      return "On order";
    case "out_of_stock":
    case "coming_soon":
      return "Out of stock";
    default:
      return "Other results";
  }
}
const MAX_PAGE_PROBES = 7;

function indexCode(entry: KotsovolosEntry | undefined): string {
  return entry?.UserData?.[0]?.x_availability_hd ?? "";
}

async function searchPage(query: string, page: number): Promise<{ ids: string[]; total: number; pageSize: number }> {
  const r = await fetchStoreJson<SearchResponse>(
    NAME,
    `${BASE}/api/search/constructorSearch?searchQuery=${encodeURIComponent(query)}&page=${page}`,
  );
  const ids = (r.productIds ?? []).map(String).filter((id) => PART_NUMBER.test(id));
  return { ids, total: r.recordSet ?? ids.length, pageSize: r.recordSetCount || ids.length || 15 };
}

/** Names, prices, links and index status for products, 50 per request. */
async function productDetails(ids: string[]): Promise<Map<string, KotsovolosEntry>> {
  const out = new Map<string, KotsovolosEntry>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const r = await fetchStoreJson<DetailsResponse>(
      NAME,
      `${BASE}/api/ext/getProductDetailsByPartNumbers?storeId=${STORE_ID}&partNumbers=${encodeURIComponent(JSON.stringify(chunk))}`,
    );
    for (const e of r.catalogEntryView ?? []) out.set(String(e.partNumber), e);
  }
  return out;
}

/**
 * Kotsovolos lists every product that can be ordered first and out-of-stock
 * products after them (still by relevance), so for broad searches they start
 * many pages in. This finds the first page that reaches them with a binary
 * search over pages, checking each probed page's last product.
 */
async function firstPageAfterOrderable(query: string, lastPage: number): Promise<number | null> {
  let lo = 2;
  let hi = lastPage;
  let found: number | null = null;
  for (let probes = 0; lo <= hi && probes < MAX_PAGE_PROBES; probes++) {
    const mid = Math.floor((lo + hi) / 2);
    const { ids } = await searchPage(query, mid);
    const last = ids.at(-1);
    if (!last) {
      hi = mid - 1;
      continue;
    }
    const entry = (await productDetails([last])).get(last);
    if (ORDERABLE_CODES.has(indexCode(entry))) {
      lo = mid + 1;
    } else {
      found = mid;
      hi = mid - 1;
    }
  }
  return found;
}

export const kotsovolos: StoreAdapter = {
  id: "kotsovolos",
  name: NAME,
  homepage: BASE,
  logo: "/stores/kotsovolos.png",
  searchable: true,
  searchPlaceholder: "Search Kotsovolos, or paste a kotsovolos.gr product link",

  parseProductRef(input) {
    const value = input.trim();
    if (PART_NUMBER.test(value)) return value;

    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    } catch {
      return null;
    }
    if (!/(^|\.)kotsovolos\.gr$/i.test(url.hostname)) return null;

    const param = url.searchParams.get("partNumber");
    if (param && PART_NUMBER.test(param)) return param;
    // Product pages end in "<part number>-<slug>", e.g. /.../341593-console-nintendo-sw2-...
    const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
    const match = last.match(/^(\d{6})(?:-|$)/);
    if (match) return match[1];

    throw new StoreError(
      "That kotsovolos.gr link doesn't point to a product. Open the product page and copy its address.",
    );
  },

  async search(query) {
    const q = query.trim();
    if (!q) return [];

    const first = await searchPage(q, 1);
    if (first.ids.length === 0) return [];
    const details = await productDetails(first.ids);

    // Out-of-stock products are what a restock tracker is for, but Kotsovolos
    // ranks them after everything orderable. Fetch the most relevant ones too.
    const lastPage = Math.max(1, Math.ceil(first.total / first.pageSize));
    let outOfStock = first.ids.filter((id) => indexCode(details.get(id)) === OUT_OF_STOCK_CODE);
    if (outOfStock.length < MAX_OUT_OF_STOCK_RESULTS && lastPage > 1) {
      const pageOneAllOrderable = first.ids.every((id) => ORDERABLE_CODES.has(indexCode(details.get(id))));
      let page = pageOneAllOrderable ? await firstPageAfterOrderable(q, lastPage) : 2;
      for (let n = 0; page !== null && page <= lastPage && n < 2 && outOfStock.length < MAX_OUT_OF_STOCK_RESULTS; n++, page++) {
        const { ids } = await searchPage(q, page);
        const more = await productDetails(ids.filter((id) => !details.has(id)));
        for (const [id, e] of more) details.set(id, e);
        outOfStock = [...outOfStock, ...ids.filter((id) => indexCode(details.get(id)) === OUT_OF_STOCK_CODE)];
      }
    }

    // Candidates: the first page, then the most relevant out-of-stock ones (by the index).
    const seen = new Set<string>();
    const candidates = [...first.ids, ...outOfStock.slice(0, MAX_OUT_OF_STOCK_RESULTS)].filter((id) =>
      details.has(id) && !seen.has(id) ? (seen.add(id), true) : false,
    );

    // The index can lag, so statuses (and the groups below) come from the live listing data.
    let live = new Map<string, Availability>();
    try {
      live = await liveListing(candidates);
    } catch {
      // Fall back to the index statuses if the listing data is unavailable.
    }

    const results = candidates.map((id): SearchResult => {
      const entry = details.get(id)!;
      const status = live.get(id) ?? indexAvailability(entry);
      return {
        productId: id,
        name: entry.name || id,
        url: productUrl(entry, id),
        imageUrl: imageUrl(id),
        price: offerPrice(entry),
        variantCount: 0,
        section: sectionFor(status.status),
        ...status,
      };
    });
    // Group by section, keeping Kotsovolos's order inside each group.
    return SECTIONS.flatMap((section) => results.filter((r) => r.section === section));
  },

  async getProduct(partNumber): Promise<ProductPreview> {
    const variant = await productVariant(partNumber);
    return {
      lookupId: partNumber,
      name: variant.name,
      url: variant.url,
      imageUrl: variant.imageUrl,
      selectedProductId: partNumber,
      variants: [variant],
    };
  },

  async checkProduct(partNumber, lookupId) {
    return productVariant(partNumber, savedPath(lookupId));
  },

  async rawResponse(partNumber, lookupId) {
    const { props, url } = await loadProductPage(partNumber, savedPath(lookupId));
    return {
      url,
      note: "Product page data (__NEXT_DATA__ → props.pageProps). Stock status is read from availabilityData: ctaNameTextKey and availableStatusKey.",
      data: props,
    };
  },
};
