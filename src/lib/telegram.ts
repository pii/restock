import "server-only";
import { getDb } from "./db";
import { formatPrice } from "./format";
import { STATUS_TEXT, STATUS_TONE, type StatusTone } from "./status";
import type { Tracker } from "./trackers";

// ---- Chat storage -----------------------------------------------------------

export type TelegramChat = {
  id: number;
  name: string;
  botToken: string;
  /** Numeric chat ID (negative for groups) or a public channel's @username. */
  chatId: string;
  enabled: boolean;
  lastSentAt: number | null;
  lastError: string | null;
};

type TelegramChatRow = {
  id: number;
  name: string;
  bot_token: string;
  chat_id: string;
  enabled: number;
  last_sent_at: number | null;
  last_error: string | null;
};

function toChat(r: TelegramChatRow): TelegramChat {
  return {
    id: r.id,
    name: r.name,
    botToken: r.bot_token,
    chatId: r.chat_id,
    enabled: r.enabled === 1,
    lastSentAt: r.last_sent_at,
    lastError: r.last_error,
  };
}

export function listTelegramChats(): TelegramChat[] {
  return (
    getDb().prepare("SELECT * FROM telegram_chats ORDER BY created_at").all() as TelegramChatRow[]
  ).map(toChat);
}

export function getTelegramChat(id: number): TelegramChat | null {
  const row = getDb().prepare("SELECT * FROM telegram_chats WHERE id = ?").get(id) as
    | TelegramChatRow
    | undefined;
  return row ? toChat(row) : null;
}

export function addTelegramChat(name: string, botToken: string, chatId: string): void {
  getDb()
    .prepare("INSERT INTO telegram_chats (name, bot_token, chat_id, enabled, created_at) VALUES (?, ?, ?, 1, ?)")
    .run(name, botToken, chatId, Date.now());
}

export function setTelegramChatEnabled(id: number, enabled: boolean): void {
  getDb().prepare("UPDATE telegram_chats SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}

export function deleteTelegramChat(id: number): void {
  getDb().prepare("DELETE FROM telegram_chats WHERE id = ?").run(id);
}

function recordDelivery(id: number, error: string | null): void {
  if (error) {
    getDb().prepare("UPDATE telegram_chats SET last_error = ? WHERE id = ?").run(error.slice(0, 300), id);
  } else {
    getDb()
      .prepare("UPDATE telegram_chats SET last_sent_at = ?, last_error = NULL WHERE id = ?")
      .run(Date.now(), id);
  }
}

// ---- Input checks -----------------------------------------------------------

// The token goes into the API URL path, so only allow the characters Telegram uses.
const BOT_TOKEN = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;
const NUMERIC_CHAT_ID = /^-?\d{1,20}$/;
const CHANNEL_USERNAME = /^@[A-Za-z][A-Za-z0-9_]{4,31}$/;

export function isTelegramBotToken(token: string): boolean {
  return BOT_TOKEN.test(token);
}

export function isTelegramChatId(chatId: string): boolean {
  return NUMERIC_CHAT_ID.test(chatId) || CHANNEL_USERNAME.test(chatId);
}

// ---- Bot API ----------------------------------------------------------------

type ApiResponse<T> = {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
};

class TelegramError extends Error {
  constructor(
    message: string,
    /** Set when a group was upgraded to a supergroup and has a new chat ID. */
    readonly migrateToChatId?: string,
  ) {
    super(message);
  }
}

/** Turns Telegram's error codes into messages the user can act on. */
function explainError(code: number | undefined, description: string): string {
  const detail = description.replace(/^(Bad Request|Forbidden|Unauthorized|Conflict): /, "");
  if (code === 401 || code === 404) {
    return "Telegram rejected the bot token. Copy it again from @BotFather.";
  }
  if (code === 400 && /chat not found/i.test(description)) {
    return "Telegram can't find that chat. Open your bot in Telegram and press Start (or add it to the group), then check the chat ID.";
  }
  if (code === 403) {
    return `The bot can't post in that chat: ${detail}. Unblock it or add it back to the chat, then send a test.`;
  }
  if (code === 409) {
    return "This bot is connected to another service with a webhook, so Restock can't look up its chats. Type the chat ID instead.";
  }
  return `Telegram returned an error: ${detail || `HTTP ${code ?? "?"}`}`;
}

async function callApi<T>(token: string, method: string, body: object, retry = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    // Never include the request URL here: it contains the bot token.
    const name = (err as Error).name;
    throw new TelegramError(
      name === "TimeoutError" || name === "AbortError"
        ? "Telegram did not respond within 15 seconds."
        : `Could not reach Telegram: ${(err as Error).message}`,
    );
  }

  const data = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (data?.ok) return data.result as T;

  const code = data?.error_code ?? res.status;
  if (code === 429 && retry) {
    const waitMs = Math.min(10_000, Math.ceil((data?.parameters?.retry_after ?? 1) * 1000));
    await new Promise((r) => setTimeout(r, waitMs));
    return callApi(token, method, body, false);
  }
  const migrateTo = data?.parameters?.migrate_to_chat_id;
  throw new TelegramError(
    explainError(code, data?.description ?? ""),
    migrateTo !== undefined ? String(migrateTo) : undefined,
  );
}

export type TelegramMessage = {
  /** HTML-formatted text (https://core.telegram.org/bots/api#html-style). */
  text: string;
  /** Shown as a small preview next to the text. */
  imageUrl?: string | null;
  button?: { text: string; url: string };
  /** Deliver without a sound or vibration. */
  silent?: boolean;
};

async function sendMessage(chat: TelegramChat, message: TelegramMessage, chatId = chat.chatId): Promise<void> {
  try {
    await callApi(chat.botToken, "sendMessage", {
      chat_id: chatId,
      text: message.text,
      parse_mode: "HTML",
      link_preview_options: message.imageUrl
        ? { url: message.imageUrl, prefer_small_media: true }
        : { is_disabled: true },
      reply_markup: message.button ? { inline_keyboard: [[message.button]] } : undefined,
      disable_notification: message.silent ?? false,
    });
  } catch (err) {
    // A group that became a supergroup gets a new ID: save it and send again.
    if (err instanceof TelegramError && err.migrateToChatId && chatId === chat.chatId) {
      getDb().prepare("UPDATE telegram_chats SET chat_id = ? WHERE id = ?").run(err.migrateToChatId, chat.id);
      return sendMessage(chat, message, err.migrateToChatId);
    }
    throw err;
  }
}

async function deliver(chat: TelegramChat, message: TelegramMessage): Promise<string | null> {
  try {
    await sendMessage(chat, message);
    recordDelivery(chat.id, null);
    return null;
  } catch (err) {
    const error = (err as Error).message;
    recordDelivery(chat.id, error);
    return error;
  }
}

// ---- Finding the chat ID ----------------------------------------------------

export type FoundChat = { id: string; title: string; type: string };

type Chat = {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type Update = Partial<
  Record<
    "message" | "edited_message" | "channel_post" | "edited_channel_post" | "my_chat_member" | "chat_member" | "chat_join_request",
    { chat: Chat }
  >
> & { callback_query?: { message?: { chat: Chat } } };

function chatTitle(chat: Chat): string {
  if (chat.title) return chat.title;
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ");
  return name || (chat.username ? `@${chat.username}` : String(chat.id));
}

/**
 * Lists the chats that recently talked to the bot: private chats where someone
 * pressed Start, and groups or channels the bot was added to. Telegram keeps
 * these for 24 hours, and reading them here doesn't use them up.
 */
export async function findTelegramChats(token: string): Promise<{ botUsername: string; chats: FoundChat[] }> {
  const bot = await callApi<{ username: string }>(token, "getMe", {});
  const updates = await callApi<Update[]>(token, "getUpdates", { limit: 100, timeout: 0 });

  const chats = new Map<number, FoundChat>();
  for (const update of updates.reverse()) {
    const chat =
      update.message?.chat ??
      update.edited_message?.chat ??
      update.channel_post?.chat ??
      update.edited_channel_post?.chat ??
      update.my_chat_member?.chat ??
      update.chat_member?.chat ??
      update.chat_join_request?.chat ??
      update.callback_query?.message?.chat;
    if (chat && !chats.has(chat.id)) {
      chats.set(chat.id, { id: String(chat.id), title: chatTitle(chat), type: chat.type });
    }
  }
  return { botUsername: bot.username, chats: [...chats.values()] };
}

// ---- Alerts -----------------------------------------------------------------

const TONE_EMOJI: Record<StatusTone, string> = {
  good: "🟢",
  warn: "🟡",
  wait: "🔵",
  bad: "🔴",
  none: "⚪",
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function sendTelegramTest(chat: TelegramChat): Promise<{ ok: true } | { ok: false; error: string }> {
  const error = await deliver(chat, {
    text: `✅ <b>Test notification</b>\nThis chat will get stock alerts from Restock (“${escapeHtml(chat.name)}”).`,
  });
  return error ? { ok: false, error } : { ok: true };
}

export async function notifyTelegram(tracker: Tracker, storeName: string): Promise<void> {
  const chats = listTelegramChats().filter((c) => c.enabled);
  if (chats.length === 0) return;

  const nowAvailable = tracker.available === true;
  const statusText = STATUS_TEXT[tracker.status];
  const headline = nowAvailable ? `${statusText} at ${storeName}` : `No longer in stock at ${storeName}`;

  const lines = [
    `${TONE_EMOJI[STATUS_TONE[tracker.status]]} <b>${escapeHtml(headline)}</b>`,
    `<a href="${escapeHtml(tracker.productUrl)}">${escapeHtml(tracker.name.slice(0, 500))}</a>`,
    "",
  ];
  if (tracker.variant) lines.push(`Option: ${escapeHtml(tracker.variant)}`);
  if (tracker.statusLabel) lines.push(`Status: ${escapeHtml(`${statusText} (${tracker.statusLabel})`)}`);
  const price = formatPrice(tracker.price);
  if (price) lines.push(`Price: ${escapeHtml(price)}`);
  if (tracker.stock !== null && nowAvailable) lines.push(`Units: ${tracker.stock}`);
  if (!nowAvailable) lines.push("It was in stock until this check.");

  const message: TelegramMessage = {
    text: lines.join("\n").trim(),
    imageUrl: tracker.imageUrl,
    button: { text: `Open on ${storeName}`, url: tracker.productUrl },
    // Like Discord's @everyone, only back-in-stock alerts make a sound.
    silent: !nowAvailable,
  };

  await Promise.all(
    chats.map(async (chat) => {
      const error = await deliver(chat, message);
      if (error) console.error(`[notify] Telegram chat "${chat.name}" failed: ${error}`);
    }),
  );
}
