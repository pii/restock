import "server-only";
import { isAvailableStatus, isOrderableStatus, type StockStatus } from "../status";
import { fetchStoreJson, fetchStorePage } from "./http";
import { readJsonAt } from "./json-scan";
import {
  StoreError,
  type Availability,
  type ProductPreview,
  type ProductVariant,
  type SearchResult,
  type StoreAdapter,
} from "./types";

const BASE = "https://www.plaisio.gr";
const IMAGES = "https://res.plaisio.gr";
const NAME = "Plaisio";

/** Plaisio product codes are seven digits, e.g. 5520428. */
const PRODUCT_ID = /^\d{7}$/;

// ---- Shapes of the plaisio.gr data (only the fields we read) --------------

/** One way to get the product: Delivery, PickupFromLocker, PickupInStore, BuyInStore, ... */
type PlaisioChannel = {
  type?: string;
  isAvailable?: boolean;
  code?: string;
  isPreOrder?: boolean;
  customMessage?: string | null;
  range?: string | number | null;
};

type PlaisioAvailability = {
  availabilities?: PlaisioChannel[];
  available?: boolean;
};

type PlaisioProduct = {
  key?: string;
  name?: string;
  slug?: string;
  primaryCategoryPath?: string;
  hidePrice?: boolean;
  masterVariant?: { sku?: string; name?: string; price?: { currentPrice?: number | null } | null };
};

type PlaisioSearchHit = {
  data?: {
    id?: string;
    name?: string;
    productName?: string;
    slug?: string;
    primaryCategoryPath?: string;
    price?: number | null;
  };
};

// ---- Status mapping ---------------------------------------------------------

// The site's texts for the delivery (D..) and BOX NOW locker (L..) codes;
// both use the same numbers.
const SHIPPING_TEXT: Record<string, string> = {
  "01": "Μη διαθέσιμο",
  "02": "Εξαντλήθηκε",
  "03": "Τελευταία Τεμάχια",
  "04": "Διαθέσιμο",
  "05": "Προπαραγγελία",
  "06": "Προπαραγγελία",
  "07": "Κατόπιν Παραγγελίας",
  "08": "Κατόπιν Παραγγελίας",
  "09": "Αναμένεται",
  "10": "Αναμένεται",
  "11": "Διαθέσιμο εντός 3 ημερών",
  "12": "Διαθέσιμο εντός {range} ημερών",
  "13": "Διαθέσιμο εντός 3 ημερών",
  "14": "Διαθέσιμο εντός {range} ημερών",
};

function shippingNumber(code: string | undefined): string | null {
  return code?.match(/^[DL](\d{2})$/)?.[1] ?? null;
}

function shippingStatus(n: string, available: boolean): StockStatus | null {
  switch (n) {
    case "01":
    case "02":
      return "out_of_stock";
    case "03":
      return "low_stock";
    case "04":
      return "in_stock";
    case "05":
    case "06":
      return "preorder";
    case "07":
    case "08":
    case "11":
    case "12":
    case "13":
    case "14":
      return "backorder";
    case "09":
    case "10":
      return available ? "backorder" : "coming_soon";
    default:
      return null;
  }
}

function channelText(c: PlaisioChannel): string | null {
  if (c.customMessage?.trim()) return c.customMessage.trim();
  const n = shippingNumber(c.code);
  const text = n ? SHIPPING_TEXT[n] : null;
  return text ? text.replace("{range}", String(c.range ?? "").trim() || "λίγων") : null;
}

function availability(status: StockStatus, label: string | null): Availability {
  return { status, available: isAvailableStatus(status), label, stock: null };
}

/**
 * Online ordering decides availability: home delivery or a BOX NOW locker,
 * then "order online, pick up in store". "Buy in store" alone means it can't
 * be ordered online, so it counts as out of stock (as for the other stores).
 */
function channelsAvailability(res: PlaisioAvailability): Availability {
  const channels = res.availabilities ?? [];
  if (channels.length === 0) return availability("unknown", null);
  const byType = (type: string) => channels.find((c) => c.type === type);
  const delivery = byType("Delivery");

  for (const c of [delivery, byType("PickupFromLocker")]) {
    if (!c?.isAvailable) continue;
    const n = shippingNumber(c.code);
    const status = c.isPreOrder ? "preorder" : (n && shippingStatus(n, true)) || "in_stock";
    if (isOrderableStatus(status)) return availability(status, channelText(c));
  }
  if (byType("PickupInStore")?.isAvailable) {
    return availability("in_stock", "Παραλαβή από κατάστημα");
  }
  // Digital products: delivery by e-mail, download, ...
  const digital = channels.find(
    (c) => c.isAvailable && !["Delivery", "PickupFromLocker", "PickupInStore", "BuyInStore", "Stockhouse"].includes(c.type ?? ""),
  );
  if (digital) return availability("in_stock", channelText(digital) ?? "Διαθέσιμο");

  if (byType("BuyInStore")?.isAvailable) {
    return availability("out_of_stock", "Μόνο για αγορά στο κατάστημα");
  }
  const n = shippingNumber(delivery?.code);
  if (n === "09" || n === "10") return availability("coming_soon", delivery ? channelText(delivery) : null);
  return availability("out_of_stock", (delivery && channelText(delivery)) || "Μη διαθέσιμο");
}

// ---- Fetching ---------------------------------------------------------------

function assertProductId(id: string): void {
  if (!PRODUCT_ID.test(id)) throw new StoreError(`"${id}" is not a valid ${NAME} product code.`);
}

function availabilityUrl(id: string): string {
  // Cached at the edge for up to 2 minutes; a cache-busting parameter doesn't help.
  return `${BASE}/api/availability/product/${id}`;
}

function productUrl(categoryPath: string | undefined, slug: string | undefined, id: string): string {
  return categoryPath && slug ? `${BASE}/product${categoryPath}/${slug}` : `${BASE}/product/${id}`;
}

function imageUrl(id: string): string {
  return `${IMAGES}/c_limit,f_auto,w_400,q_75/d_Shared:NotFound:product-notfound.jpg/Shared/Product/Images/${id}.jpg`;
}

async function fetchAvailability(id: string): Promise<PlaisioAvailability> {
  return fetchStoreJson<PlaisioAvailability>(NAME, availabilityUrl(id));
}

async function fetchProduct(id: string) {
  assertProductId(id);
  const [availabilityData, product] = await Promise.all([
    fetchAvailability(id),
    fetchStoreJson<PlaisioProduct>(NAME, `${BASE}/api/referenced-product/${id}`),
  ]);
  if (!product?.key) throw new StoreError(`${NAME} has no product with code ${id}.`);
  return { availabilityData, product };
}

async function productVariant(id: string): Promise<ProductVariant> {
  const { availabilityData, product } = await fetchProduct(id);
  const price = product.masterVariant?.price?.currentPrice;
  return {
    productId: id,
    lookupId: id,
    name: product.name || product.masterVariant?.name || `${NAME} product ${id}`,
    // Colours are separate products at Plaisio, so there is nothing to pick.
    variant: null,
    url: productUrl(product.primaryCategoryPath, product.slug, id),
    imageUrl: imageUrl(id),
    price: !product.hidePrice && typeof price === "number" && price > 0 ? price : null,
    ...channelsAvailability(availabilityData),
  };
}

/** Runs `fn` over `items` with at most `limit` running at once, keeping order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// ---- Adapter ----------------------------------------------------------------

export const plaisio: StoreAdapter = {
  id: "plaisio",
  name: NAME,
  homepage: BASE,
  logo: "/stores/plaisio.svg",
  searchable: true,
  searchPlaceholder: "Search Plaisio, or paste a plaisio.gr product link",

  parseProductRef(input) {
    const value = input.trim();
    if (PRODUCT_ID.test(value)) return value;

    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    } catch {
      return null;
    }
    if (!/(^|\.)plaisio\.gr$/i.test(url.hostname)) return null;

    // Product pages end in "<slug>_<code>": /product/gaming-zone/.../sony_5520428
    const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
    const match = last.match(/(?:^|_)(\d{7})$/);
    if (url.pathname.startsWith("/product/") && match) return match[1];

    throw new StoreError("That plaisio.gr link doesn't point to a product. Open the product page and copy its address.");
  },

  async search(query) {
    const q = query.trim();
    if (!q) return [];
    // The search page is rendered on plaisio.gr's server; its data stream
    // (RSC) carries the result list as JSON.
    const { html: stream } = await fetchStorePage(NAME, `${BASE}/search?query=${encodeURIComponent(q)}`, {
      headers: { RSC: "1" },
    });
    const start = stream.indexOf('{"result_sources":');
    const response = start >= 0 ? readJsonAt<{ results?: PlaisioSearchHit[] }>(stream, start) : null;
    if (!response) throw new StoreError(`${NAME} returned a search page this app can't read.`);

    const seen = new Set<string>();
    const hits = (response.results ?? []).filter((h) => {
      const id = h.data?.id;
      if (!id || !PRODUCT_ID.test(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    }).slice(0, 24);

    // Search data has no reliable stock field, so ask the availability API for each (small, cached).
    const statuses = await mapLimit(hits, 6, (h) =>
      fetchAvailability(h.data!.id!)
        .then(channelsAvailability)
        .catch(() => availability("unknown", null)),
    );

    return hits.map((h, i): SearchResult => {
      const d = h.data!;
      const id = d.id!;
      return {
        productId: id,
        name: d.productName || d.name || id,
        url: productUrl(d.primaryCategoryPath, d.slug, id),
        imageUrl: imageUrl(id),
        price: typeof d.price === "number" && d.price > 0 ? d.price : null,
        variantCount: 0,
        ...statuses[i],
      };
    });
  },

  async getProduct(id): Promise<ProductPreview> {
    const variant = await productVariant(id);
    return {
      lookupId: id,
      name: variant.name,
      url: variant.url,
      imageUrl: variant.imageUrl,
      selectedProductId: id,
      variants: [variant],
    };
  },

  async checkProduct(id) {
    return productVariant(id);
  },

  async rawResponse(id) {
    const { availabilityData, product } = await fetchProduct(id);
    return {
      url: availabilityUrl(id),
      note: "Two responses: availability (status from availabilities[]: type, isAvailable and code, e.g. D04 = Διαθέσιμο, D02 = Εξαντλήθηκε; cached up to 2 minutes) and referenced-product (name, price, link).",
      data: { availability: availabilityData, product },
    };
  },
};
