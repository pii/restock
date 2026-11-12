import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { hashPassword } from "./password";

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "availability.db");

// Each schema step runs once, in order. Append new steps; never edit old ones.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    is_default_password INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_sent_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE trackers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    lookup_id TEXT,
    product_url TEXT NOT NULL,
    name TEXT NOT NULL,
    variant TEXT,
    image_url TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'unknown',
    status_label TEXT,
    available INTEGER,
    price REAL,
    stock INTEGER,
    last_checked_at INTEGER,
    last_changed_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (store_id, product_id)
  );
  `,
  // "Available" now means in stock (or low stock) only; pre-order and
  // backorder no longer count. Recompute the saved flag from the saved status
  // so the next check doesn't see a change (and send an alert) that didn't happen.
  `
  UPDATE trackers SET available = CASE
    WHEN status IN ('in_stock', 'low_stock') THEN 1
    WHEN status IN ('preorder', 'backorder', 'coming_soon', 'out_of_stock') THEN 0
    ELSE available
  END;
  `,
  // Per-webhook choice to ping @everyone in back-in-stock alerts.
  `
  ALTER TABLE webhooks ADD COLUMN mention_everyone INTEGER NOT NULL DEFAULT 0;
  `,
  // Telegram chats that get alert messages from your own bot.
  `
  CREATE TABLE telegram_chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    bot_token TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_sent_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL
  );
  `,
];

function migrate(db: Database.Database) {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

function seed(db: Database.Database) {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM users").get() as {
    n: number;
  };
  if (n === 0) {
    db.prepare(
      "INSERT INTO users (username, password_hash, is_default_password, created_at) VALUES (?, ?, 1, ?)",
    ).run("admin", hashPassword("admin"), Date.now());
  }
}

function open(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seed(db);
  return db;
}

// Route handlers, server actions and the background checker can each get their
// own module instance (especially in dev), so keep one connection per process.
const globalForDb = globalThis as unknown as { __availabilityDb?: Database.Database };

export function getDb(): Database.Database {
  if (!globalForDb.__availabilityDb) {
    globalForDb.__availabilityDb = open();
  }
  return globalForDb.__availabilityDb;
}
