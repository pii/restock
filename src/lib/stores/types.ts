import type { StockStatus } from "../status";

export type Availability = {
  status: StockStatus;
  available: boolean;
  /** The store's own wording, e.g. "ΔΙΑΘΕΣΙΜΟ". */
  label: string | null;
  /** Units the store reports, when it exposes a count. */
  stock: number | null;
};

export type SearchResult = Availability & {
  productId: string;
  name: string;
  url: string;
  imageUrl: string | null;
  price: number | null;
  /** How many colour/bundle options the product has (0 or 1 means none to pick). */
  variantCount: number;
  /**
   * Optional group heading. Results that share a section are listed together
   * under it, in the order given (e.g. "Available" then "Out of stock").
   */
  section?: string;
};

/** One purchasable item (a colour, size or bundle) — the unit that gets tracked. */
export type ProductVariant = Availability & {
  productId: string;
  /**
   * Store-specific key for fetching this item again, saved with the tracker
   * (Germanos: the parent product ID; Kotsovolos: the product page path).
   */
  lookupId: string;
  name: string;
  /** Short option label such as a colour; null when the product has no options. */
  variant: string | null;
  url: string;
  imageUrl: string | null;
  price: number | null;
};

export type ProductPreview = {
  /** Pass to getProduct/checkProduct to fetch this product again. */
  lookupId: string;
  name: string;
  url: string;
  imageUrl: string | null;
  /** The variant the link or ID pointed at. */
  selectedProductId: string;
  variants: ProductVariant[];
};

/** What the store returned for a product, for the "View API response" popup. */
export type RawResponse = {
  /** The address the data came from. */
  url: string;
  /** Where in the data the stock status is read from. */
  note: string;
  data: unknown;
};

export interface StoreAdapter {
  id: string;
  name: string;
  homepage: string;
  /** Square logo served from /public, e.g. "/stores/germanos.png". */
  logo: string;
  /** Whether products can be found by name; otherwise only by link or code. */
  searchable: boolean;
  /** Placeholder for the search box. */
  searchPlaceholder: string;
  /**
   * Returns the store's product ID when the input is a product link or ID,
   * or null when it should be treated as a search query.
   */
  parseProductRef(input: string): string | null;
  search(query: string): Promise<SearchResult[]>;
  /** Accepts a product ID or the ID of any of its variants. */
  getProduct(productId: string): Promise<ProductPreview>;
  /**
   * Current availability of a single tracked variant. `lookupId` is the
   * value saved from the last check, so the store can skip re-resolving it.
   */
  checkProduct(productId: string, lookupId?: string | null): Promise<ProductVariant>;
  /** Fetches the store's current response for a tracked item, unparsed. */
  rawResponse(productId: string, lookupId?: string | null): Promise<RawResponse>;
}

/** An error whose message is safe and useful to show in the UI. */
export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}
