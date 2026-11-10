// Client-safe: shared by the store adapters, the checker and the UI.

export type StockStatus =
  | "in_stock"
  | "low_stock"
  | "preorder"
  | "backorder"
  | "coming_soon"
  | "out_of_stock"
  | "unknown";

/**
 * In stock right now (including the last few units). This is what "available"
 * means everywhere in the app: filters, counts and alerts.
 */
export const AVAILABLE_STATUSES: ReadonlySet<StockStatus> = new Set<StockStatus>(["in_stock", "low_stock"]);

export function isAvailableStatus(status: StockStatus): boolean {
  return AVAILABLE_STATUSES.has(status);
}

/**
 * Can be ordered online now, even if it ships later. Store adapters use this
 * when reading store data (e.g. "is this delivery option usable?"); it is not
 * what the app calls available.
 */
const ORDERABLE_STATUSES: ReadonlySet<StockStatus> = new Set<StockStatus>([
  "in_stock",
  "low_stock",
  "preorder",
  "backorder",
]);

export function isOrderableStatus(status: StockStatus): boolean {
  return ORDERABLE_STATUSES.has(status);
}

export const STATUS_TEXT: Record<StockStatus, string> = {
  in_stock: "In stock",
  low_stock: "Low stock",
  preorder: "Pre-order",
  backorder: "Backorder",
  coming_soon: "Coming soon",
  out_of_stock: "Out of stock",
  unknown: "Not checked",
};

/** Visual tone used for badges and notification colours. */
export type StatusTone = "good" | "warn" | "wait" | "bad" | "none";

export const STATUS_TONE: Record<StockStatus, StatusTone> = {
  in_stock: "good",
  low_stock: "warn",
  preorder: "wait",
  backorder: "wait",
  coming_soon: "wait",
  out_of_stock: "bad",
  unknown: "none",
};

export function parseStatus(value: string | null | undefined): StockStatus {
  return value && value in STATUS_TEXT ? (value as StockStatus) : "unknown";
}
