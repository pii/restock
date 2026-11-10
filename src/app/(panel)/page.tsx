import type { Metadata } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { BellOffIcon, CircleCheckIcon, CircleOffIcon, ClockIcon, PackageIcon, PackageSearchIcon } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { requireUser } from "@/lib/auth";
import { formatInterval, timeAgo } from "@/lib/format";
import { listWebhooks } from "@/lib/notifications";
import { getSettings } from "@/lib/settings";
import { listStores, storeInfo } from "@/lib/stores";
import { listTrackers, oldestCheckAt } from "@/lib/trackers";
import { AddProductButton, AddProductProvider } from "./add-product-dialog";
import { ProductsView } from "./products-view";
import { CheckAllButton } from "./tracker-actions";

export const metadata: Metadata = { title: "Products" };

/** Everything the page shows, read once per request. */
function loadDashboard() {
  const trackers = listTrackers();
  const settings = getSettings();
  const now = Date.now();
  const active = trackers.filter((t) => t.enabled);
  const available = active.filter((t) => t.available).length;
  const lastCheck = active.reduce<number | null>((max, t) => Math.max(max ?? 0, t.lastCheckedAt ?? 0) || null, null);
  const oldest = oldestCheckAt();
  const nextInMinutes = oldest === null ? null : Math.ceil((oldest + settings.checkIntervalMinutes * 60_000 - now) / 60_000);

  return {
    now,
    trackers,
    stores: listStores().map(storeInfo),
    hasWebhook: listWebhooks().some((h) => h.enabled),
    stats: {
      total: trackers.length,
      active: active.length,
      paused: trackers.length - active.length,
      available,
      unavailable: active.length - available,
      lastCheck,
      interval: formatInterval(settings.checkIntervalMinutes),
      nextInMinutes,
    },
  };
}

function StatCard({ label, value, icon: Icon, footer }: { label: string; value: string; icon: LucideIcon; footer: string }) {
  return (
    <Card className="gap-2 py-5">
      <CardHeader className="px-5">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
        <CardAction>
          <Icon className="size-4 text-muted-foreground" />
        </CardAction>
      </CardHeader>
      <CardFooter className="px-5 text-xs text-muted-foreground">{footer}</CardFooter>
    </Card>
  );
}

export default async function ProductsPage() {
  await requireUser();
  const { now, trackers, stores, hasWebhook, stats } = loadDashboard();

  const nextCheck =
    stats.nextInMinutes === null
      ? "No active products"
      : stats.nextInMinutes <= 0
        ? "Next check is starting"
        : `Next in about ${stats.nextInMinutes} min`;

  return (
    <AddProductProvider stores={stores}>
      <AutoRefresh />
      <PageHeader
        title="Products"
        description={`Stock across ${stores.map((s) => s.name).join(", ")}.`}
        actions={
          <>
            {trackers.length > 0 ? <CheckAllButton count={stats.active} /> : null}
            <AddProductButton />
          </>
        }
      />

      {trackers.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageSearchIcon />
            </EmptyMedia>
            <EmptyTitle>No products yet</EmptyTitle>
            <EmptyDescription>
              Add a product from {stores.map((s) => s.name).join(", ")} to start tracking its stock. You get a Discord
              message when it changes.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <AddProductButton />
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
            <StatCard
              label="Tracked products"
              value={String(stats.total)}
              icon={PackageIcon}
              footer={`${stats.active} active, ${stats.paused} paused`}
            />
            <StatCard
              label="Available now"
              value={String(stats.available)}
              icon={CircleCheckIcon}
              footer={
                stats.active > 0
                  ? `${Math.round((stats.available / stats.active) * 100)}% of active products`
                  : "No active products"
              }
            />
            <StatCard
              label="Unavailable"
              value={String(stats.unavailable)}
              icon={CircleOffIcon}
              footer="Out of stock, pre-order or backorder"
            />
            <StatCard
              label="Last check"
              value={stats.lastCheck ? timeAgo(stats.lastCheck, now) : "Never"}
              icon={ClockIcon}
              footer={`Every ${stats.interval}. ${nextCheck}.`}
            />
          </div>

          {!hasWebhook ? (
            <Alert>
              <BellOffIcon />
              <AlertTitle>Notifications are off</AlertTitle>
              <AlertDescription>Add a Discord webhook to get a message when a product comes back in stock.</AlertDescription>
              <AlertAction>
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings#notifications">Set up</Link>
                </Button>
              </AlertAction>
            </Alert>
          ) : null}

          <ProductsView trackers={trackers} stores={stores} now={now} />
        </>
      )}
    </AddProductProvider>
  );
}
