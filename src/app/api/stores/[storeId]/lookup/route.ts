import { NextResponse } from "next/server";
import { jsonError, rejectUnauthenticated, storeErrorResponse } from "@/lib/api";
import type { LookupResponse } from "@/lib/lookup-types";
import { getStore } from "@/lib/stores";
import { trackedProductIds } from "@/lib/trackers";

/** Search a store, or open a product directly when the query is a product link or ID. */
export async function GET(request: Request, ctx: RouteContext<"/api/stores/[storeId]/lookup">) {
  const denied = await rejectUnauthenticated();
  if (denied) return denied;

  const { storeId } = await ctx.params;
  const store = getStore(storeId);
  if (!store) return jsonError("Unknown store.", 404);

  const query = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 300);
  if (!query) return jsonError("Type a product name or paste a link.", 400);

  try {
    const productId = store.parseProductRef(query);
    let body: LookupResponse;
    if (productId) {
      const product = await store.getProduct(productId);
      body = { type: "product", product: { ...product, trackedIds: trackedProductIds(store.id) } };
    } else {
      body = { type: "search", query, results: await store.search(query) };
    }
    return NextResponse.json(body);
  } catch (err) {
    return storeErrorResponse(err);
  }
}
