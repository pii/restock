import "server-only";
import { isAvailableStatus, type StockStatus } from "../status";
import { fetchStoreJson, withCacheBuster } from "./http";
import { StoreError, type Availability, type ProductPreview, type ProductVariant, type StoreAdapter } from "./types";

const BASE = "https://www.public.gr";
const NAME = "Public";

/** Public product codes are seven digits and may start with 0, e.g. 2164264 or 0681288. */
const PRODUCT_ID = /^\d{7}$/;

// ---- Shapes of the public.gr API (only the fields we read) ----------------

type PublicDeliveryRule = {
  inStock?: boolean;
  allowPurchases?: boolean;
  uponOrder?: boolean;
  preOrder?: boolean;
  displayText?: string;
  pdpDisplayText?: string;
  pricesResponseDto?: { prices?: { salePrice?: number; listPrice?: number }[] };
};

type PublicStockRule = {
  skuId?: string;
  /** Units available to promise. */
  totalAtp?: number;
  deliveryRule?: PublicDeliveryRule;
};

type PublicStockRules = { rules?: PublicStockRule[] };

type PublicSku = {
  code?: string;
  sku?: {
    id?: string;
    displayName?: string;
    url?: string;
    media?: { heroImage?: { url1?: string; url2?: string } };
    priceInfoDto?: { salePrice?: number; listPrice?: number };
  };
};

// ---- Status mapping ---------------------------------------------------------

/** Upper-cases and strips Greek accents so "Άμεσα" matches "ΑΜΕΣΑ". */
function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
}

/**
 * `deliveryRule.allowPurchases` says whether it can be ordered online;
 * the flags and the display text add the detail. Texts seen:
 * "Άμεσα Διαθέσιμο", "Διαθέσιμο με παραγγελία", "Κατόπιν Παραγγελίας",
 * "Αγορά μόνο από κατάστημα", "Προσωρινά Εξαντλημένο".
 */
function ruleAvailability(rule: PublicStockRule): Availability {
  const d = rule.deliveryRule;
  const label = (d?.displayText || d?.pdpDisplayText || "").trim() || null;
  const text = normalize(label ?? "");

  let status: StockStatus;
  if (!d) status = "unknown";
  else if (d.preOrder) status = d.allowPurchases === false ? "coming_soon" : "preorder";
  // Includes "buy in store only": it can't be ordered online.
  else if (d.allowPurchases === false) status = "out_of_stock";
  else if (d.uponOrder || text.includes("ΜΕ ΠΑΡΑΓΓΕΛΙΑ") || text.includes("ΚΑΤΟΠΙΝ")) status = "backorder";
  else if (text.includes("ΠΕΡΙΟΡΙΣΜΕΝ")) status = "low_stock";
  else if (d.inStock === false || text.includes("ΕΞΑΝΤΛ")) status = "out_of_stock";
  else status = "in_stock";

  const atp = rule.totalAtp;
  const stock =
    (status === "in_stock" || status === "low_stock") && typeof atp === "number" && atp > 0 ? atp : null;
  return { status, available: isAvailableStatus(status), label, stock };
}

// ---- Fetching ---------------------------------------------------------------

function assertProductId(id: string): void {
  if (!PRODUCT_ID.test(id)) throw new StoreError(`"${id}" is not a valid ${NAME} product code.`);
}

function stockRulesUrl(id: string): string {
  return `${BASE}/public/v1/mm/stockRules?skuId=${id}&locale=el`;
}

function skuUrl(id: string): string {
  return `${BASE}/public/v2/sku/${id}?locale=el`;
}

async function fetchProduct(id: string) {
  assertProductId(id);
  // Stock comes from stockRules (uncached); name, link and picture from the product details.
  const [rules, details] = await Promise.all([
    fetchStoreJson<PublicStockRules>(NAME, withCacheBuster(stockRulesUrl(id))),
    fetchStoreJson<PublicSku>(NAME, skuUrl(id)),
  ]);
  const sku = details.sku;
  if (details.code !== "000" || !sku) throw new StoreError(`${NAME} has no product with code ${id}.`);
  const rule = rules.rules?.find((r) => r.skuId === id) ?? rules.rules?.[0];
  if (!rule) throw new StoreError(`${NAME} returned no stock information for product ${id}.`);
  return { rules, details, sku, rule };
}

function price(rule: PublicStockRule, sku: NonNullable<PublicSku["sku"]>): number | null {
  const fresh = rule.deliveryRule?.pricesResponseDto?.prices?.[0];
  for (const v of [fresh?.salePrice, fresh?.listPrice, sku.priceInfoDto?.salePrice, sku.priceInfoDto?.listPrice]) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

async function productVariant(id: string): Promise<ProductVariant> {
  const { sku, rule } = await fetchProduct(id);
  const image = sku.media?.heroImage?.url2 || sku.media?.heroImage?.url1 || null;
  return {
    productId: id,
    lookupId: id,
    name: sku.displayName || `${NAME} product ${id}`,
    // Colours are separate products at Public, so there is nothing to pick.
    variant: null,
    url: sku.url ? new URL(sku.url, BASE).toString() : `${BASE}/product/${id}`,
    imageUrl: image,
    price: price(rule, sku),
    ...ruleAvailability(rule),
  };
}

// ---- Adapter ----------------------------------------------------------------

export const publicStore: StoreAdapter = {
  id: "public",
  name: NAME,
  homepage: BASE,
  logo: "/stores/public.png",
  // Public's product search runs on a third-party service (Constructor.io) from
  // the browser; there is no search on public.gr itself to call.
  searchable: false,
  searchPlaceholder: "Paste a public.gr product link or its 7-digit code",

  parseProductRef(input) {
    const value = input.trim();
    if (PRODUCT_ID.test(value)) return value;

    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    } catch {
      return null;
    }
    if (!/(^|\.)public\.gr$/i.test(url.hostname)) return null;

    // Product pages end in the code: /product/<category path>/<slug>/2164264
    const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
    if (url.pathname.startsWith("/product/") && PRODUCT_ID.test(last)) return last;

    throw new StoreError("That public.gr link doesn't point to a product. Open the product page and copy its address.");
  },

  async search() {
    throw new StoreError(
      "Searching by name isn't available for Public. Open the product on public.gr and paste its link, or type its 7-digit code.",
    );
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
    const { rules, details } = await fetchProduct(id);
    return {
      url: stockRulesUrl(id),
      note: "Two responses: stockRules (status from rules[0].deliveryRule: allowPurchases, inStock, uponOrder, preOrder, displayText; units from totalAtp) and the v2/sku product details.",
      data: { stockRules: rules, productDetails: details },
    };
  },
};
