import "server-only";
import { isAvailableStatus, isOrderableStatus, type StockStatus } from "../status";
import { fetchStoreJson } from "./http";
import {
  StoreError,
  type Availability,
  type ProductPreview,
  type ProductVariant,
  type SearchResult,
  type StoreAdapter,
} from "./types";

const BASE = "https://www.germanos.gr";
const NAME = "Germanos";

// ---- Shapes of the germanos.gr JSON API (only the fields we read) ----------

type GermanosStock = {
  skuId?: string;
  warehouseStock?: number | null;
  availabilityStatus?: string | null;
  availabilityMessage?: string | null;
  stockLevel?: string | null;
};

type GermanosSku = {
  id: string;
  name?: string | null;
  isComingSoon?: boolean | null;
  finalPrice?: number | null;
  discountedPrice?: number | null;
  rawPrice?: number | null;
  thumbnailImage?: string | null;
  skuColor?: { name?: string | null; description?: string | null } | null;
  bundle?: {
    availabilityStatus?: string | null;
    availabilityMessage?: string | null;
    available?: boolean | null;
  } | null;
};

type GermanosDetails = {
  id: string;
  displayName?: string | null;
  title?: string | null;
  canonicalPath?: string | null;
  primarySkuId?: string | null;
  discountedPrice?: number | null;
  rawPrice?: number | null;
  media?: { largeMediaList?: { url?: string }[] | null } | null;
  skus?: GermanosSku[] | null;
  deliveryAvailability?: {
    isAvailable?: boolean | null;
    stockBySkuId?: Record<string, GermanosStock> | null;
  } | null;
};

type GermanosSearchProduct = {
  id: string;
  displayName?: string | null;
  name?: string | null;
  canonicalPath?: string | null;
  thumbnailImage?: { url?: string | null } | string | null;
  finalPrice?: number | null;
  discountedPrice?: number | null;
  rawPrice?: number | null;
  availabilityStatus?: string | null;
  childSKUs?: unknown[] | null;
};

type GermanosSearchResponse = { products?: GermanosSearchProduct[] | null };

// ---- Status mapping ---------------------------------------------------------

// Values seen in `availabilityStatus` (Greek, upper case) and bundle statuses.
const STATUS_MAP: Record<string, StockStatus> = {
  "ΔΙΑΘΕΣΙΜΟ": "in_stock",
  "ΧΑΜΗΛΗ ΔΙΑΘΕΣΙΜΟΤΗΤΑ": "low_stock",
  "ΜΗ ΔΙΑΘΕΣΙΜΟ": "out_of_stock",
  "ΕΞΑΝΤΛΗΜΕΝΟ": "out_of_stock",
  "ΠΡΟΠΑΡΑΓΓΕΛΙΑ": "preorder",
  "ΠΡΟΣΕΧΩΣ": "coming_soon",
  BACKORDER: "backorder",
  AVAILABLE: "in_stock",
  PREORDER: "preorder",
  EXPIRED: "out_of_stock",
  UNAVAILABLE: "out_of_stock",
};

const STOCK_LEVEL_MAP: Record<string, StockStatus> = {
  instock: "in_stock",
  lowstock: "low_stock",
  outstock: "out_of_stock",
  outofstock: "out_of_stock",
};

/** Upper-cases and strips Greek accents so "Διαθέσιμο" matches "ΔΙΑΘΕΣΙΜΟ". */
function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().trim();
}

function mapStatus(value: string | null | undefined): StockStatus | null {
  if (!value) return null;
  return STATUS_MAP[normalize(value)] ?? null;
}

function mapStockLevel(value: string | null | undefined): StockStatus | null {
  if (!value) return null;
  return STOCK_LEVEL_MAP[value.toLowerCase()] ?? null;
}

function availability(status: StockStatus, label: string | null, stock: number | null): Availability {
  return { status, available: isAvailableStatus(status), label, stock };
}

function skuAvailability(
  sku: GermanosSku,
  stock: GermanosStock | undefined,
  fallbackAvailable: boolean | null,
): Availability {
  let status: StockStatus =
    mapStatus(stock?.availabilityStatus) ?? mapStockLevel(stock?.stockLevel) ?? "unknown";
  let label = stock?.availabilityMessage ?? stock?.availabilityStatus ?? null;

  // Bundles carry their own offer status; an expired offer can't be bought even
  // if the items in it are in the warehouse.
  if (sku.bundle) {
    const bundleStatus =
      mapStatus(sku.bundle.availabilityStatus) ??
      (sku.bundle.available === true ? "in_stock" : sku.bundle.available === false ? "out_of_stock" : null);
    if (bundleStatus && (status === "unknown" || !isOrderableStatus(bundleStatus))) {
      status = bundleStatus;
      label = sku.bundle.availabilityMessage ?? label;
    }
  }

  if (status === "unknown" && sku.isComingSoon) status = "coming_soon";
  if (status === "unknown" && fallbackAvailable !== null) {
    status = fallbackAvailable ? "in_stock" : "out_of_stock";
  }

  const units = stock?.warehouseStock;
  const count = typeof units === "number" && units >= 0 && units < 100_000 ? units : null;
  return availability(status, label, count);
}

// ---- Helpers ----------------------------------------------------------------

const PRODUCT_ID = /^(sku)?\d{6,}$/i;

function absolute(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url, BASE).toString();
  } catch {
    return null;
  }
}

/** Germanos serves each image in several sizes; "medium" is plenty for thumbnails. */
function thumbnail(url: string | null | undefined): string | null {
  const abs = absolute(url);
  return abs ? abs.replace(/_large_(\d+)\.(png|jpe?g|webp)$/i, "_medium_$1.$2") : null;
}

function price(...values: (number | null | undefined)[]): number | null {
  for (const v of values) if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return null;
}

function variantUrl(details: GermanosDetails, skuId: string): string {
  if (/^sku/i.test(skuId)) return `${BASE}/skubundle/${encodeURIComponent(skuId)}`;
  const path = details.canonicalPath && !details.canonicalPath.startsWith("/skubundle")
    ? details.canonicalPath
    : "/product/item/";
  const url = new URL(path, BASE);
  url.searchParams.set("productId", skuId);
  return url.toString();
}

function assertProductId(productId: string): void {
  if (!PRODUCT_ID.test(productId)) {
    throw new StoreError(`"${productId}" is not a valid ${NAME} product ID.`);
  }
}

/**
 * The details endpoint only answers for a product's own ID; a colour variant's
 * SKU returns `{}`. Returns null in that case.
 */
async function fetchDetails(productId: string): Promise<GermanosDetails | null> {
  assertProductId(productId);
  const details = await fetchStoreJson<GermanosDetails>(
    NAME,
    `${BASE}/api/product/${encodeURIComponent(productId)}/details`,
  );
  return details && typeof details === "object" && details.id ? details : null;
}

async function searchProducts(query: string): Promise<GermanosSearchProduct[]> {
  // The API only accepts its own page sizes (12, 24, ...).
  const data = await fetchStoreJson<GermanosSearchResponse>(
    NAME,
    `${BASE}/api/search/general?page=0&size=24&q=${encodeURIComponent(query)}`,
  );
  return data.products ?? [];
}

/** Finds the product a variant SKU belongs to. Searching by SKU returns its parent. */
async function findParentId(skuId: string): Promise<string | null> {
  const products = await searchProducts(skuId);
  const parent = products.find(
    (p) =>
      p.id === skuId ||
      p.childSKUs?.some((c) => typeof c === "object" && c !== null && (c as { id?: unknown }).id === skuId),
  );
  return parent?.id ?? null;
}

/** Details for a product, given its own ID or the ID of one of its variants. */
async function resolveDetails(productId: string, lookupId?: string | null): Promise<GermanosDetails> {
  const first = await fetchDetails(lookupId || productId);
  if (first && (first.skus?.length ? first.skus.some((s) => s.id === productId) : first.id === productId)) {
    return first;
  }

  const parentId = await findParentId(productId);
  if (parentId && parentId !== first?.id) {
    const parent = await fetchDetails(parentId);
    if (parent) return parent;
  }
  if (first) return first;
  throw new StoreError(`${NAME} has no product with ID ${productId}.`);
}

function toPreview(details: GermanosDetails, requestedId: string): ProductPreview {
  const stockBySku = details.deliveryAvailability?.stockBySkuId ?? {};
  const skus = details.skus?.length ? details.skus : [{ id: details.id }];
  const singleSku = skus.length === 1;
  const productImage = thumbnail(details.media?.largeMediaList?.[0]?.url);
  const productName = details.displayName || details.title || `${NAME} product ${details.id}`;

  const variants: ProductVariant[] = skus.map((sku) => {
    const isBundle = Boolean(sku.bundle) || /^sku/i.test(sku.id);
    return {
      productId: sku.id,
      lookupId: details.id,
      name: sku.name || productName,
      variant: isBundle ? "Bundle" : (sku.skuColor?.name || sku.skuColor?.description || null),
      url: variantUrl(details, sku.id),
      imageUrl: thumbnail(sku.thumbnailImage) ?? productImage,
      price: price(sku.finalPrice, sku.discountedPrice, sku.rawPrice),
      ...skuAvailability(
        sku,
        stockBySku[sku.id],
        singleSku ? (details.deliveryAvailability?.isAvailable ?? null) : null,
      ),
    };
  });

  // Products without colour options shouldn't show a meaningless option label.
  if (variants.filter((v) => v.variant !== "Bundle").length <= 1) {
    for (const v of variants) if (v.variant !== "Bundle") v.variant = null;
  }

  const selected =
    variants.find((v) => v.productId === requestedId) ??
    variants.find((v) => v.productId === details.primarySkuId) ??
    variants[0];

  return {
    lookupId: details.id,
    name: productName,
    url: selected.url,
    imageUrl: selected.imageUrl ?? productImage,
    selectedProductId: selected.productId,
    variants,
  };
}

// ---- Adapter ----------------------------------------------------------------

export const germanos: StoreAdapter = {
  id: "germanos",
  name: NAME,
  homepage: BASE,
  logo: "/stores/germanos.png",
  searchable: true,
  searchPlaceholder: "Search Germanos, or paste a germanos.gr product link",

  parseProductRef(input) {
    const value = input.trim();
    if (PRODUCT_ID.test(value)) return value;

    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    } catch {
      return null;
    }
    if (!/(^|\.)germanos\.gr$/i.test(url.hostname)) return null;

    const productId = url.searchParams.get("productId");
    if (productId && PRODUCT_ID.test(productId)) return productId;
    const bundle = url.pathname.match(/\/skubundle\/(sku\d+)/i);
    if (bundle) return bundle[1];

    throw new StoreError(
      "That germanos.gr link doesn't point to a product. Open the product page and copy its address.",
    );
  },

  async search(query) {
    const q = query.trim();
    if (!q) return [];
    return (await searchProducts(q)).map((p): SearchResult => {
      const status = mapStatus(p.availabilityStatus) ?? "unknown";
      const thumb = typeof p.thumbnailImage === "string" ? p.thumbnailImage : p.thumbnailImage?.url;
      return {
        productId: p.id,
        name: p.displayName || p.name || p.id,
        url: absolute(p.canonicalPath) ?? `${BASE}/product/item/?productId=${encodeURIComponent(p.id)}`,
        imageUrl: thumbnail(thumb),
        price: price(p.finalPrice, p.discountedPrice, p.rawPrice),
        variantCount: p.childSKUs?.length ?? 0,
        ...availability(status, p.availabilityStatus ?? null, null),
      };
    });
  },

  async getProduct(productId) {
    return toPreview(await resolveDetails(productId), productId);
  },

  async rawResponse(productId, lookupId) {
    const details = await resolveDetails(productId, lookupId);
    return {
      url: `${BASE}/api/product/${encodeURIComponent(details.id)}/details`,
      note: `Stock status is read from deliveryAvailability.stockBySkuId["${productId}"].availabilityStatus.`,
      data: details,
    };
  },

  async checkProduct(productId, lookupId) {
    const preview = toPreview(await resolveDetails(productId, lookupId), productId);
    const variant = preview.variants.find((v) => v.productId === productId);
    if (!variant) {
      throw new StoreError(`${NAME} no longer lists this item (ID ${productId}).`);
    }
    return variant;
  },
};
