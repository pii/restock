import "server-only";
import { notifyAvailabilityChange } from "./notifications";
import { getSettings } from "./settings";
import { getStore, StoreError } from "./stores";
import {
  dueTrackerIds,
  getTracker,
  recordCheckError,
  recordCheckResult,
  type Tracker,
} from "./trackers";

/** Pause between requests to the same store, to stay polite and avoid rate limits. */
const REQUEST_GAP_MS = 1_500;
/** How often the scheduler looks for products that are due a check. */
const TICK_MS = 15_000;

export type CheckOutcome =
  | { ok: true; tracker: Tracker; changed: boolean }
  | { ok: false; error: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function checkTracker(id: number): Promise<CheckOutcome> {
  const tracker = getTracker(id);
  if (!tracker) return { ok: false, error: "This product is no longer tracked." };

  const store = getStore(tracker.storeId);
  if (!store) {
    const error = `Store "${tracker.storeId}" is not supported by this version.`;
    recordCheckError(id, error);
    return { ok: false, error };
  }

  let result;
  try {
    result = await store.checkProduct(tracker.productId, tracker.lookupId);
  } catch (err) {
    const error =
      err instanceof StoreError ? err.message : `Unexpected error: ${(err as Error).message}`;
    recordCheckError(id, error);
    console.warn(`[checker] ${store.name} ${tracker.productId}: ${error}`);
    return { ok: false, error };
  }

  const transition = recordCheckResult(id, result);
  if (!transition) return { ok: false, error: "This product is no longer tracked." };

  const { previousAvailable, previousStatus, tracker: updated } = transition;
  const availabilityChanged =
    previousAvailable !== null && updated.available !== null && previousAvailable !== updated.available;

  if (availabilityChanged) {
    const settings = getSettings();
    const wanted =
      updated.notify && (updated.available ? settings.notifyOnAvailable : settings.notifyOnUnavailable);
    const note = wanted ? " (notifying)" : updated.notify ? "" : " (alerts off for this product)";
    console.info(`[checker] ${store.name} "${updated.name}": ${previousStatus} -> ${updated.status}${note}`);
    if (wanted) await notifyAvailabilityChange(updated, store.name);
  }

  return { ok: true, tracker: updated, changed: previousStatus !== updated.status };
}

/** Checks trackers one after another with a pause between store requests. */
export async function checkTrackers(ids: number[]): Promise<{ checked: number; failed: number }> {
  let failed = 0;
  for (let i = 0; i < ids.length; i++) {
    if (i > 0) await sleep(REQUEST_GAP_MS);
    const outcome = await checkTracker(ids[i]);
    if (!outcome.ok) failed++;
  }
  return { checked: ids.length, failed };
}

// ---- Background scheduler ---------------------------------------------------

type SchedulerState = { timer?: NodeJS.Timeout; running: boolean };

// Shared across module instances in the same process (dev reloads, route bundles).
const g = globalThis as unknown as { __availabilityScheduler?: SchedulerState };

async function tick(): Promise<void> {
  const state = g.__availabilityScheduler;
  if (!state || state.running) return;
  state.running = true;
  try {
    const { checkIntervalMinutes } = getSettings();
    const due = dueTrackerIds(Date.now() - checkIntervalMinutes * 60_000);
    if (due.length > 0) await checkTrackers(due);
  } catch (err) {
    console.error("[checker] scheduled run failed:", err);
  } finally {
    state.running = false;
  }
}

export function startScheduler(): void {
  if (g.__availabilityScheduler?.timer) return;
  const state: SchedulerState = { running: false };
  g.__availabilityScheduler = state;
  state.timer = setInterval(tick, TICK_MS);
  setTimeout(tick, 3_000);
  console.info(`[checker] background checks started (looking for due products every ${TICK_MS / 1000}s)`);
}
