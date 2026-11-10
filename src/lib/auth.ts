import "server-only";
import crypto from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import { hashPassword, verifyPassword } from "./password";
import { SESSION_COOKIE } from "./constants";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type User = {
  id: number;
  username: string;
  isDefaultPassword: boolean;
};

type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  is_default_password: number;
};

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function toUser(row: Pick<UserRow, "id" | "username" | "is_default_password">): User {
  return {
    id: row.id,
    username: row.username,
    isDefaultPassword: row.is_default_password === 1,
  };
}

// Used to keep failed logins for unknown usernames as slow as wrong passwords.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));

export function authenticate(username: string, password: string): User | null {
  const row = getDb()
    .prepare("SELECT id, username, password_hash, is_default_password FROM users WHERE username = ?")
    .get(username) as UserRow | undefined;
  if (!row) {
    verifyPassword(password, DUMMY_HASH);
    return null;
  }
  return verifyPassword(password, row.password_hash) ? toUser(row) : null;
}

async function isHttpsRequest(): Promise<boolean> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return proto === "https";
}

export async function createSession(userId: number): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = now + SESSION_TTL_MS;

  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
  ).run(hashToken(token), userId, expiresAt, now);

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Self-hosted installs are often reached over plain http on a LAN, where a
    // Secure cookie would never be sent back. Only mark it Secure over https.
    secure: await isHttpsRequest(),
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  }
  store.delete(SESSION_COOKIE);
}

/** The signed-in user, or null. Deduplicated per request. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT u.id, u.username, u.is_default_password, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(hashToken(token)) as
    | (Pick<UserRow, "id" | "username" | "is_default_password"> & { expires_at: number })
    | undefined;
  if (!row || row.expires_at < Date.now()) return null;
  return toUser(row);
});

/** For pages, layouts and server actions: sends signed-out visitors to /login. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export type PasswordChangeResult = { ok: true } | { ok: false; error: string };

export function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
): PasswordChangeResult {
  const db = getDb();
  const row = db
    .prepare("SELECT password_hash FROM users WHERE id = ?")
    .get(userId) as Pick<UserRow, "password_hash"> | undefined;
  if (!row || !verifyPassword(currentPassword, row.password_hash)) {
    return { ok: false, error: "Current password is incorrect." };
  }
  if (newPassword.length < 8) {
    return { ok: false, error: "New password must be at least 8 characters." };
  }
  db.prepare("UPDATE users SET password_hash = ?, is_default_password = 0 WHERE id = ?").run(
    hashPassword(newPassword),
    userId,
  );
  return { ok: true };
}
