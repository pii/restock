import { NextResponse } from "next/server";
import { jsonError, rejectUnauthenticated, storeErrorResponse } from "@/lib/api";
import type { ProductWithTracking } from "@/lib/lookup-types";
import { getStore } from "@/lib/stores";
import { trackedProductIds } from "@/lib/trackers";

/** A product with all of its options and their live availability. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/stores/[storeId]/products/[productId]">,
) {
  const denied = await rejectUnauthenticated();
  if (denied) return denied;

  const { storeId, productId } = await ctx.params;
  const store = getStore(storeId);
  if (!store) return jsonError("Unknown store.", 404);

  try {
    const product = await store.getProduct(productId);
    const body: ProductWithTracking = { ...product, trackedIds: trackedProductIds(store.id) };
    return NextResponse.json(body);
  } catch (err) {
    return storeErrorResponse(err);
  }
}
