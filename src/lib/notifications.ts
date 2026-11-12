import "server-only";
import { getDb } from "./db";
import { formatPrice } from "./format";
import { STATUS_TEXT, STATUS_TONE, type StatusTone } from "./status";
import type { Tracker } from "./trackers";

// ---- Webhook storage --------------------------------------------------------

export type Webhook = {
  id: number;
  name: string;
  url: string;
  enabled: boolean;
  /** Ping @everyone in back-in-stock alerts (and test messages). */
  mentionEveryone: boolean;
  lastSentAt: number | null;
  lastError: string | null;
};

type WebhookRow = {
  id: number;
  name: string;
  url: string;
  enabled: number;
  mention_everyone: number;
  last_sent_at: number | null;
  last_error: string | null;
};

function toWebhook(r: WebhookRow): Webhook {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    enabled: r.enabled === 1,
    mentionEveryone: r.mention_everyone === 1,
    lastSentAt: r.last_sent_at,
    lastError: r.last_error,
  };
}

export function listWebhooks(): Webhook[] {
  return (getDb().prepare("SELECT * FROM webhooks ORDER BY created_at").all() as WebhookRow[]).map(
    toWebhook,
  );
}

export function getWebhook(id: number): Webhook | null {
  const row = getDb().prepare("SELECT * FROM webhooks WHERE id = ?").get(id) as WebhookRow | undefined;
  return row ? toWebhook(row) : null;
}

export function addWebhook(name: string, url: string, mentionEveryone = false): void {
  getDb()
    .prepare("INSERT INTO webhooks (name, url, enabled, mention_everyone, created_at) VALUES (?, ?, 1, ?, ?)")
    .run(name, url, mentionEveryone ? 1 : 0, Date.now());
}

export function setWebhookMentionEveryone(id: number, mentionEveryone: boolean): void {
  getDb().prepare("UPDATE webhooks SET mention_everyone = ? WHERE id = ?").run(mentionEveryone ? 1 : 0, id);
}

export function setWebhookEnabled(id: number, enabled: boolean): void {
  getDb().prepare("UPDATE webhooks SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}

export function deleteWebhook(id: number): void {
  getDb().prepare("DELETE FROM webhooks WHERE id = ?").run(id);
}

function recordDelivery(id: number, error: string | null): void {
  if (error) {
    getDb().prepare("UPDATE webhooks SET last_error = ? WHERE id = ?").run(error.slice(0, 300), id);
  } else {
    getDb()
      .prepare("UPDATE webhooks SET last_sent_at = ?, last_error = NULL WHERE id = ?")
      .run(Date.now(), id);
  }
}

// ---- Discord ----------------------------------------------------------------

const DISCORD_WEBHOOK =
  /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+\/?$/;

export function isDiscordWebhookUrl(url: string): boolean {
  return DISCORD_WEBHOOK.test(url);
}

/** Shows enough of the URL to recognise it without exposing the secret token. */
export function maskWebhookUrl(url: string): string {
  const match = url.match(/\/webhooks\/(\d+)\//);
  return match ? `discord.com/api/webhooks/${match[1]}/•••••` : "discord.com/api/webhooks/•••••";
}

type DiscordEmbed = {
  title: string;
  url?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  thumbnail?: { url: string };
  footer?: { text: string };
  timestamp?: string;
};

type DiscordPayload = {
  content?: string;
  username?: string;
  embeds?: DiscordEmbed[];
  allowed_mentions?: { parse: string[] };
};

const TONE_COLOR: Record<StatusTone, number> = {
  good: 0x1f8a5b,
  warn: 0xc58a12,
  wait: 0x2f6fb5,
  bad: 0xc2413b,
  none: 0x6b7a8c,
};

async function postToDiscord(url: string, payload: DiscordPayload, retry = true): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Restock",
        allowed_mentions: { parse: [] },
        ...payload,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new Error(`Could not reach Discord: ${(err as Error).message}`);
  }

  if (res.status === 429 && retry) {
    const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
    const waitMs = Math.min(10_000, Math.ceil((body.retry_after ?? 1) * 1000));
    await new Promise((r) => setTimeout(r, waitMs));
    return postToDiscord(url, payload, false);
  }
  if (res.status === 401 || res.status === 404) {
    throw new Error("Discord rejected the webhook. It may have been deleted; create a new one.");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord returned HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
}

/**
 * Adds an @everyone ping in front of the message text. Discord only pings when
 * allowed_mentions permits it; by default every message here allows none.
 */
function withEveryonePing(payload: DiscordPayload): DiscordPayload {
  return {
    ...payload,
    content: `@everyone ${payload.content ?? ""}`.trim().slice(0, 2000),
    allowed_mentions: { parse: ["everyone"] },
  };
}

/** Sends to every enabled webhook. `ping` lets webhooks with @everyone turned on mention it. */
async function broadcast(payload: DiscordPayload, { ping }: { ping: boolean }): Promise<void> {
  const hooks = listWebhooks().filter((h) => h.enabled);
  await Promise.all(
    hooks.map(async (hook) => {
      try {
        await postToDiscord(hook.url, ping && hook.mentionEveryone ? withEveryonePing(payload) : payload);
        recordDelivery(hook.id, null);
      } catch (err) {
        const message = (err as Error).message;
        recordDelivery(hook.id, message);
        console.error(`[notify] webhook "${hook.name}" failed: ${message}`);
      }
    }),
  );
}

export async function sendTestMessage(hook: Webhook): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const test: DiscordPayload = {
      embeds: [
        {
          title: "Test notification",
          description: hook.mentionEveryone
            ? `This channel will get stock alerts from Restock (webhook "${hook.name}"). Back-in-stock alerts mention @everyone.`
            : `This channel will get stock alerts from Restock (webhook "${hook.name}").`,
          color: TONE_COLOR.wait,
          timestamp: new Date().toISOString(),
        },
      ],
    };
    // Ping in the test too, so you can check that @everyone works in this channel.
    await postToDiscord(hook.url, hook.mentionEveryone ? withEveryonePing({ ...test, content: "Test notification" }) : test);
    recordDelivery(hook.id, null);
    return { ok: true };
  } catch (err) {
    const message = (err as Error).message;
    recordDelivery(hook.id, message);
    return { ok: false, error: message };
  }
}

export async function notifyAvailabilityChange(tracker: Tracker, storeName: string): Promise<void> {
  const nowAvailable = tracker.available === true;
  const statusText = STATUS_TEXT[tracker.status];
  const headline = nowAvailable
    ? `${statusText} at ${storeName}`
    : `No longer in stock at ${storeName}`;

  const fields: DiscordEmbed["fields"] = [
    {
      name: "Status",
      value: tracker.statusLabel ? `${statusText} (${tracker.statusLabel})` : statusText,
      inline: true,
    },
  ];
  const price = formatPrice(tracker.price);
  if (price) fields.push({ name: "Price", value: price, inline: true });
  if (tracker.stock !== null && nowAvailable) {
    fields.push({ name: "Units", value: String(tracker.stock), inline: true });
  }
  if (tracker.variant) fields.push({ name: "Option", value: tracker.variant, inline: true });

  // @everyone pings only for back-in-stock alerts, never for "sold out".
  await broadcast({
    content: `${headline}: ${tracker.name}`.slice(0, 2000),
    embeds: [
      {
        title: tracker.name.slice(0, 256),
        url: tracker.productUrl,
        description: nowAvailable
          ? `You can order it now. [Open on ${storeName}](${tracker.productUrl})`
          : `It was in stock until this check.`,
        color: TONE_COLOR[STATUS_TONE[tracker.status]],
        fields,
        thumbnail: tracker.imageUrl ? { url: tracker.imageUrl } : undefined,
        footer: { text: storeName },
        timestamp: new Date().toISOString(),
      },
    ],
  }, { ping: nowAvailable });
}
