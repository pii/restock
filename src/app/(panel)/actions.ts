"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { changePassword, destroySession, requireUser } from "@/lib/auth";
import { checkTracker, checkTrackers } from "@/lib/checker";
import {
  addWebhook,
  deleteWebhook,
  getWebhook,
  isDiscordWebhookUrl,
  sendTestMessage,
  setWebhookEnabled,
  setWebhookMentionEveryone,
} from "@/lib/notifications";
import { CHECK_INTERVAL_LIMITS, updateSettings } from "@/lib/settings";
import { STATUS_TEXT } from "@/lib/status";
import { getStore, StoreError } from "@/lib/stores";
import {
  addTelegramChat,
  deleteTelegramChat,
  findTelegramChats,
  getTelegramChat,
  isTelegramBotToken,
  isTelegramChatId,
  sendTelegramTest,
  setTelegramChatEnabled,
  type FoundChat,
} from "@/lib/telegram";
import {
  addTracker,
  deleteTracker,
  enabledTrackerIds,
  setTrackerEnabled,
} from "@/lib/trackers";

export type ActionResult = { ok: boolean; message: string } | null;

// ---- Session ----------------------------------------------------------------

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

// ---- Tracked products -------------------------------------------------------

export async function checkTrackerAction(id: number): Promise<ActionResult> {
  await requireUser();
  const outcome = await checkTracker(id);
  revalidatePath("/");
  return outcome.ok
    ? { ok: true, message: STATUS_TEXT[outcome.tracker.status] }
    : { ok: false, message: outcome.error };
}

export async function checkAllAction(): Promise<ActionResult> {
  await requireUser();
  const ids = enabledTrackerIds();
  if (ids.length === 0) return { ok: false, message: "No active products to check." };
  const { checked, failed } = await checkTrackers(ids);
  revalidatePath("/");
  return failed === 0
    ? { ok: true, message: `Checked ${checked} product${checked === 1 ? "" : "s"}.` }
    : { ok: false, message: `Checked ${checked}; ${failed} failed. The failed products show the error.` };
}

export async function setTrackerEnabledAction(id: number, enabled: boolean): Promise<void> {
  await requireUser();
  setTrackerEnabled(id, enabled);
  revalidatePath("/");
}

export async function deleteTrackerAction(id: number): Promise<void> {
  await requireUser();
  deleteTracker(id);
  revalidatePath("/");
}

export type TrackResult = {
  added: number;
  alreadyTracked: number;
  errors: string[];
};

/** Tracks the chosen options of one product (identified by its lookup ID). */
export async function trackProductsAction(
  storeId: string,
  lookupId: string,
  productIds: string[],
): Promise<TrackResult> {
  await requireUser();
  const store = getStore(storeId);
  if (!store) return { added: 0, alreadyTracked: 0, errors: ["Unknown store."] };

  // Re-read the product from the store rather than trusting what the browser sent.
  let variants;
  try {
    variants = (await store.getProduct(lookupId)).variants;
  } catch (err) {
    const message = err instanceof StoreError ? err.message : "Could not load the product from the store.";
    return { added: 0, alreadyTracked: 0, errors: [message] };
  }

  const result: TrackResult = { added: 0, alreadyTracked: 0, errors: [] };
  for (const productId of new Set(productIds)) {
    const variant = variants.find((v) => v.productId === productId);
    if (!variant) {
      result.errors.push(`${store.name} no longer lists option ${productId}.`);
    } else if (addTracker(store.id, variant)) {
      result.added++;
    } else {
      result.alreadyTracked++;
    }
  }
  revalidatePath("/");
  return result;
}

// ---- Settings ---------------------------------------------------------------

export async function saveIntervalAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();
  const minutes = Number(formData.get("checkIntervalMinutes"));
  const { min, max } = CHECK_INTERVAL_LIMITS;
  if (!Number.isInteger(minutes) || minutes < min || minutes > max) {
    return { ok: false, message: `Enter a whole number of minutes from ${min} to ${max}.` };
  }
  updateSettings({ checkIntervalMinutes: minutes });
  revalidatePath("/", "layout");
  return { ok: true, message: "Check interval saved." };
}

/** Saves one notification rule right away (used by the switches in Settings). */
export async function setNotificationRuleAction(
  rule: "notifyOnAvailable" | "notifyOnUnavailable",
  value: boolean,
): Promise<void> {
  await requireUser();
  updateSettings({ [rule]: value });
  revalidatePath("/settings");
}

export async function addWebhookAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim() || "Discord";
  const url = String(formData.get("url") ?? "").trim();
  if (!isDiscordWebhookUrl(url)) {
    return {
      ok: false,
      message: "That isn't a Discord webhook URL. It should start with https://discord.com/api/webhooks/",
    };
  }
  addWebhook(name.slice(0, 60), url, formData.get("mentionEveryone") === "on");
  revalidatePath("/settings");
  return { ok: true, message: `Added “${name}”. Send a test to confirm it works.` };
}

export async function setWebhookEnabledAction(id: number, enabled: boolean): Promise<void> {
  await requireUser();
  setWebhookEnabled(id, enabled);
  revalidatePath("/settings");
}

export async function setWebhookMentionEveryoneAction(id: number, mentionEveryone: boolean): Promise<void> {
  await requireUser();
  setWebhookMentionEveryone(id, mentionEveryone);
  revalidatePath("/settings");
}

export async function deleteWebhookAction(id: number): Promise<void> {
  await requireUser();
  deleteWebhook(id);
  revalidatePath("/settings");
}

export async function testWebhookAction(id: number): Promise<ActionResult> {
  await requireUser();
  const hook = getWebhook(id);
  if (!hook) return { ok: false, message: "That webhook no longer exists." };
  const result = await sendTestMessage(hook);
  revalidatePath("/settings");
  return result.ok
    ? { ok: true, message: "Test sent. Check your Discord channel." }
    : { ok: false, message: result.error };
}

// ---- Telegram chats ---------------------------------------------------------

const BOT_TOKEN_HINT = "That doesn't look like a bot token. It looks like 123456789:AAH… and comes from @BotFather.";

export type FindChatsResult =
  | { ok: true; botUsername: string; chats: FoundChat[] }
  | { ok: false; message: string };

/** Lists the chats that recently messaged the bot, so the user can pick one instead of typing its ID. */
export async function findTelegramChatsAction(botToken: string): Promise<FindChatsResult> {
  await requireUser();
  const token = botToken.trim();
  if (!isTelegramBotToken(token)) return { ok: false, message: BOT_TOKEN_HINT };
  try {
    return { ok: true, ...(await findTelegramChats(token)) };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function addTelegramChatAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim() || "Telegram";
  const token = String(formData.get("botToken") ?? "").trim();
  const chatId = String(formData.get("chatId") ?? "").trim();
  if (!isTelegramBotToken(token)) return { ok: false, message: BOT_TOKEN_HINT };
  if (!isTelegramChatId(chatId)) {
    return {
      ok: false,
      message: "Enter the chat ID (a number such as 123456789 or -1001234567890) or a public channel's @name. Find fills it in for you.",
    };
  }
  addTelegramChat(name.slice(0, 60), token, chatId);
  revalidatePath("/settings");
  return { ok: true, message: `Added “${name}”. Send a test to confirm it works.` };
}

export async function setTelegramChatEnabledAction(id: number, enabled: boolean): Promise<void> {
  await requireUser();
  setTelegramChatEnabled(id, enabled);
  revalidatePath("/settings");
}

export async function deleteTelegramChatAction(id: number): Promise<void> {
  await requireUser();
  deleteTelegramChat(id);
  revalidatePath("/settings");
}

export async function testTelegramChatAction(id: number): Promise<ActionResult> {
  await requireUser();
  const chat = getTelegramChat(id);
  if (!chat) return { ok: false, message: "That chat no longer exists." };
  const result = await sendTelegramTest(chat);
  revalidatePath("/settings");
  return result.ok
    ? { ok: true, message: "Test sent. Check the Telegram chat." }
    : { ok: false, message: result.error };
}

export async function changePasswordAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  if (next !== confirm) return { ok: false, message: "The new passwords don't match." };
  const result = changePassword(user.id, current, next);
  if (!result.ok) return { ok: false, message: result.error };
  revalidatePath("/", "layout");
  return { ok: true, message: "Password changed." };
}
