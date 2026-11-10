"use server";

import { redirect } from "next/navigation";
import { authenticate, createSession } from "@/lib/auth";

export type LoginState = { error: string; username: string } | null;

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  // Only same-site paths; "//host" would be an open redirect.
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username || !password) {
    return { error: "Enter your username and password.", username };
  }

  const user = authenticate(username, password);
  if (!user) {
    // Slow down guessing a little.
    await new Promise((r) => setTimeout(r, 600));
    return { error: "That username and password don't match.", username };
  }

  await createSession(user.id);
  redirect(safeNext(formData.get("next")));
}
