import "server-only";
import { getDb } from "./db";
import { parseStatus, type StockStatus } from "./status";
import type { ProductVariant } from "./stores/types";

export type Tracker = {
  id: number;
  storeId: string;
  productId: string;
  lookupId: string | null;
  productUrl: string;
  name: string;
  variant: string | null;
  imageUrl: string | null;
  enabled: boolean;
  status: StockStatus;
  statusLabel: string | null;
  available: boolean | null;
  price: number | null;
  stock: number | null;
  lastCheckedAt: number | null;
  lastChangedAt: number | null;
  lastError: string | null;
  createdAt: number;
};

type TrackerRow = {
  id: number;
  store_id: string;
  product_id: string;
  lookup_id: string | null;
  product_url: string;
  name: string;
  variant: string | null;
  image_url: string | null;
  enabled: number;
  status: string;
  status_label: string | null;
  available: number | null;
  price: number | null;
  stock: number | null;
  last_checked_at: number | null;
  last_changed_at: number | null;
  last_error: string | null;
  created_at: number;
};

function toTracker(r: TrackerRow): Tracker {
  return {
    id: r.id,
    storeId: r.store_id,
    productId: r.product_id,
    lookupId: r.lookup_id,
    productUrl: r.product_url,
    name: r.name,
    variant: r.variant,
    imageUrl: r.image_url,
    enabled: r.enabled === 1,
    status: parseStatus(r.status),
    statusLabel: r.status_label,
    available: r.available === null ? null : r.available === 1,
    price: r.price,
    stock: r.stock,
    lastCheckedAt: r.last_checked_at,
    lastChangedAt: r.last_changed_at,
    lastError: r.last_error,
    createdAt: r.created_at,
  };
}

export function listTrackers(): Tracker[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM trackers
       ORDER BY enabled DESC, COALESCE(available, -1) DESC, created_at DESC`,
    )
    .all() as TrackerRow[];
  return rows.map(toTracker);
}

export function getTracker(id: number): Tracker | null {
  const row = getDb().prepare("SELECT * FROM trackers WHERE id = ?").get(id) as
    | TrackerRow
    | undefined;
  return row ? toTracker(row) : null;
}

export function trackedProductIds(storeId: string): string[] {
  const rows = getDb()
    .prepare("SELECT product_id FROM trackers WHERE store_id = ?")
    .all(storeId) as { product_id: string }[];
  return rows.map((r) => r.product_id);
}

/** Starts tracking a variant with its current state. Returns false if it was already tracked. */
export function addTracker(storeId: string, v: ProductVariant): boolean {
  const now = Date.now();
  const result = getDb()
    .prepare(
      `INSERT INTO trackers (store_id, product_id, lookup_id, product_url, name, variant, image_url,
         status, status_label, available, price, stock, last_checked_at, last_changed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (store_id, product_id) DO NOTHING`,
    )
    .run(
      storeId,
      v.productId,
      v.lookupId,
      v.url,
      v.name,
      v.variant,
      v.imageUrl,
      v.status,
      v.label,
      v.available ? 1 : 0,
      v.price,
      v.stock,
      now,
      now,
      now,
    );
  return result.changes > 0;
}

export function setTrackerEnabled(id: number, enabled: boolean): void {
  getDb().prepare("UPDATE trackers SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}

export function deleteTracker(id: number): void {
  getDb().prepare("DELETE FROM trackers WHERE id = ?").run(id);
}

export type CheckTransition = {
  previousStatus: StockStatus;
  previousAvailable: boolean | null;
  tracker: Tracker;
};

/**
 * Saves a successful check and returns the state it replaced. Runs as an
 * IMMEDIATE transaction so two overlapping checks of the same product (a
 * scheduled one and a "Check now") can't both see the same old state and send
 * the same notification twice.
 */
export function recordCheckResult(id: number, v: ProductVariant): CheckTransition | null {
  const db = getDb();
  const run = db.transaction((): CheckTransition | null => {
    const before = db
      .prepare("SELECT status, available FROM trackers WHERE id = ?")
      .get(id) as Pick<TrackerRow, "status" | "available"> | undefined;
    if (!before) return null;

    const now = Date.now();
    const changed = before.status !== v.status;
    db.prepare(
      `UPDATE trackers SET status = ?, status_label = ?, available = ?, price = ?, stock = ?,
         lookup_id = ?, product_url = ?, image_url = COALESCE(image_url, ?),
         last_checked_at = ?, last_changed_at = CASE WHEN ? THEN ? ELSE last_changed_at END,
         last_error = NULL
       WHERE id = ?`,
    ).run(
      v.status,
      v.label,
      v.available ? 1 : 0,
      v.price,
      v.stock,
      v.lookupId,
      v.url,
      v.imageUrl,
      now,
      changed ? 1 : 0,
      now,
      id,
    );

    const after = db.prepare("SELECT * FROM trackers WHERE id = ?").get(id) as TrackerRow;
    return {
      previousStatus: parseStatus(before.status),
      previousAvailable: before.available === null ? null : before.available === 1,
      tracker: toTracker(after),
    };
  });
  return run.immediate();
}

/** Keeps the last known status so a temporary error doesn't look like a stock change. */
export function recordCheckError(id: number, message: string): void {
  getDb()
    .prepare("UPDATE trackers SET last_checked_at = ?, last_error = ? WHERE id = ?")
    .run(Date.now(), message.slice(0, 500), id);
}

export function dueTrackerIds(checkedBefore: number): number[] {
  const rows = getDb()
    .prepare(
      `SELECT id FROM trackers
       WHERE enabled = 1 AND (last_checked_at IS NULL OR last_checked_at <= ?)
       ORDER BY last_checked_at IS NOT NULL, last_checked_at`,
    )
    .all(checkedBefore) as { id: number }[];
  return rows.map((r) => r.id);
}

export function enabledTrackerIds(): number[] {
  const rows = getDb().prepare("SELECT id FROM trackers WHERE enabled = 1").all() as { id: number }[];
  return rows.map((r) => r.id);
}

/** Oldest check among enabled trackers, used to show when the next check is due. */
export function oldestCheckAt(): number | null {
  const row = getDb()
    .prepare("SELECT MIN(COALESCE(last_checked_at, 0)) AS t, COUNT(*) AS n FROM trackers WHERE enabled = 1")
    .get() as { t: number | null; n: number };
  return row.n > 0 ? row.t : null;
}
