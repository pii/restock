import { NextResponse } from "next/server";
import { jsonError, rejectUnauthenticated, storeErrorResponse } from "@/lib/api";
import type { RawResponseBody } from "@/lib/lookup-types";
import { getStore } from "@/lib/stores";
import { getTracker } from "@/lib/trackers";

/** The store's current, unparsed response for a tracked product. */
export async function GET(_request: Request, ctx: RouteContext<"/api/trackers/[id]/raw">) {
  const denied = await rejectUnauthenticated();
  if (denied) return denied;

  const id = Number((await ctx.params).id);
  const tracker = Number.isInteger(id) ? getTracker(id) : null;
  if (!tracker) return jsonError("This product is no longer tracked.", 404);

  const store = getStore(tracker.storeId);
  if (!store) return jsonError(`Store "${tracker.storeId}" is not supported by this version.`, 404);

  try {
    const raw = await store.rawResponse(tracker.productId, tracker.lookupId);
    const body: RawResponseBody = { store: store.name, fetchedAt: Date.now(), ...raw };
    return NextResponse.json(body);
  } catch (err) {
    return storeErrorResponse(err);
  }
}
