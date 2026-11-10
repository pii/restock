import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser } from "./auth";
import { StoreError } from "./stores";

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Returns a 401 response when the request has no valid session, otherwise null. */
export async function rejectUnauthenticated() {
  return (await getCurrentUser()) ? null : jsonError("Sign in again to continue.", 401);
}

export function storeErrorResponse(err: unknown) {
  if (err instanceof StoreError) return jsonError(err.message, 502);
  console.error(err);
  return jsonError("Something went wrong while contacting the store.", 500);
}
