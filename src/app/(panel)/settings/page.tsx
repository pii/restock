import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { listWebhooks, maskWebhookUrl } from "@/lib/notifications";
import { CHECK_INTERVAL_LIMITS, getSettings } from "@/lib/settings";
import { listTelegramChats } from "@/lib/telegram";
import {
  IntervalCard,
  NotificationRulesCard,
  PasswordCard,
  WebhooksCard,
  type WebhookView,
} from "./settings-forms";
import { TelegramChatsCard, type TelegramChatView } from "./telegram-forms";

export const metadata: Metadata = { title: "Settings" };

function loadSettings() {
  return {
    now: Date.now(),
    settings: getSettings(),
    // The full webhook URL contains its secret token, so only a masked form reaches the browser.
    webhooks: listWebhooks().map(
      (h): WebhookView => ({
        id: h.id,
        name: h.name,
        maskedUrl: maskWebhookUrl(h.url),
        enabled: h.enabled,
        mentionEveryone: h.mentionEveryone,
        lastSentAt: h.lastSentAt,
        lastError: h.lastError,
      }),
    ),
    // Same for Telegram: the bot token stays on the server.
    telegramChats: listTelegramChats().map(
      (c): TelegramChatView => ({
        id: c.id,
        name: c.name,
        chatId: c.chatId,
        enabled: c.enabled,
        lastSentAt: c.lastSentAt,
        lastError: c.lastError,
      }),
    ),
  };
}

export default async function SettingsPage() {
  const user = await requireUser();
  const { now, settings, webhooks, telegramChats } = loadSettings();

  return (
    <>
      <PageHeader title="Settings" description="Background checks, notifications and your account." />
      <div className="grid max-w-3xl gap-6">
        <IntervalCard
          value={settings.checkIntervalMinutes}
          min={CHECK_INTERVAL_LIMITS.min}
          max={CHECK_INTERVAL_LIMITS.max}
        />
        <NotificationRulesCard
          notifyOnAvailable={settings.notifyOnAvailable}
          notifyOnUnavailable={settings.notifyOnUnavailable}
        />
        <WebhooksCard webhooks={webhooks} now={now} />
        <TelegramChatsCard chats={telegramChats} now={now} />
        <PasswordCard username={user.username} />
      </div>
    </>
  );
}
