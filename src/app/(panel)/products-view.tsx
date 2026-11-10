"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGridIcon, ListIcon, SearchIcon, SearchXIcon, TriangleAlertIcon } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatPrice, timeAgo } from "@/lib/format";
import type { StoreInfo } from "@/lib/stores";
import type { Tracker } from "@/lib/trackers";
import { cn } from "@/lib/utils";
import { CheckNowButton, ProductMenu, type TrackerRef } from "./tracker-actions";

type StatusFilter = "all" | "available" | "unavailable" | "paused";
const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "available", label: "Available" },
  { value: "unavailable", label: "Unavailable" },
  { value: "paused", label: "Paused" },
];

function matchesStatus(t: Tracker, status: StatusFilter): boolean {
  if (status === "paused") return !t.enabled;
  if (status === "available") return t.enabled && t.available === true;
  if (status === "unavailable") return t.enabled && t.available !== true;
  return true;
}

/** Lower-cases and strips accents so "διαθεσιμο" finds "Διαθέσιμο". */
function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function ProductsView({ trackers, stores, now }: { trackers: Tracker[]; stores: StoreInfo[]; now: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState("");

  const statusParam = params.get("status");
  const status: StatusFilter = STATUS_FILTERS.some((f) => f.value === statusParam) ? (statusParam as StatusFilter) : "all";
  const storeId = stores.some((s) => s.id === params.get("store")) ? params.get("store") : null;
  const view = params.get("view") === "table" ? "table" : "grid";
  const storesById = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Store and text filters apply first, so the status counts describe what you'd see.
  const scoped = useMemo(() => {
    const q = fold(query.trim());
    return trackers.filter(
      (t) =>
        (!storeId || t.storeId === storeId) &&
        (!q || fold(`${t.name} ${t.variant ?? ""} ${storesById.get(t.storeId)?.name ?? ""}`).includes(q)),
    );
  }, [trackers, storeId, query, storesById]);
  const visible = scoped.filter((t) => matchesStatus(t, status));
  const filtered = status !== "all" || storeId !== null || query.trim() !== "";

  const refFor = (t: Tracker): TrackerRef => ({
    id: t.id,
    name: t.name,
    enabled: t.enabled,
    productUrl: t.productUrl,
    storeId: t.storeId,
    storeName: storesById.get(t.storeId)?.name ?? t.storeId,
    productId: t.productId,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={status} onValueChange={(v) => setParam("status", v === "all" ? null : v)}>
          <TabsList>
            {STATUS_FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value} className="gap-1.5">
                {f.label}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {scoped.filter((t) => matchesStatus(t, f.value)).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter products…"
              aria-label="Filter products by name"
              className="h-9 w-56 pl-8"
            />
          </div>
          <Select value={storeId ?? "all"} onValueChange={(v) => setParam("store", v === "all" ? null : v)}>
            <SelectTrigger className="h-9 w-40" aria-label="Store">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stores</SelectItem>
              {stores.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- small static logo */}
                  <img src={s.logo} alt="" width={16} height={16} className="size-4 rounded-[3px]" />
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={view}
            onValueChange={(v) => v && setParam("view", v === "grid" ? null : v)}
            aria-label="View"
          >
            <ToggleGroupItem value="grid" aria-label="Grid view" className="h-9 px-2.5">
              <LayoutGridIcon />
            </ToggleGroupItem>
            <ToggleGroupItem value="table" aria-label="Table view" className="h-9 px-2.5">
              <ListIcon />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {visible.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>No products match</EmptyTitle>
            <EmptyDescription>Try another status, store or name.</EmptyDescription>
          </EmptyHeader>
          {filtered ? (
            <EmptyContent>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery("");
                  router.replace(pathname, { scroll: false });
                }}
              >
                Clear filters
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : view === "grid" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] gap-4">
          {visible.map((t) => (
            <ProductCard key={t.id} tracker={t} store={storesById.get(t.storeId)} refFor={refFor(t)} now={now} />
          ))}
        </div>
      ) : (
        <ProductTable trackers={visible} storesById={storesById} refFor={refFor} now={now} />
      )}
    </div>
  );
}

function ProductImage({ src, className }: { src: string | null; className?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- remote store images, any host
    <img src={src} alt="" loading="lazy" className={cn("object-contain", className)} />
  ) : null;
}

function StoreLabel({ store, fallback, variant }: { store?: StoreInfo; fallback: string; variant?: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {store ? (
        // eslint-disable-next-line @next/next/no-img-element -- small static logo
        <img src={store.logo} alt="" width={14} height={14} className="size-3.5 shrink-0 rounded-[3px]" />
      ) : null}
      <span className="shrink-0">{store?.name ?? fallback}</span>
      {variant ? <span className="truncate">/ {variant}</span> : null}
    </span>
  );
}

function ErrorHint({ message }: { message: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 text-xs text-destructive">
          <TriangleAlertIcon className="size-3.5" />
          Check failed
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{message} Showing the last known status.</TooltipContent>
    </Tooltip>
  );
}

function ProductCard({
  tracker: t,
  store,
  refFor,
  now,
}: {
  tracker: Tracker;
  store?: StoreInfo;
  refFor: TrackerRef;
  now: number;
}) {
  const price = formatPrice(t.price);
  return (
    <Card className="flex aspect-square flex-col gap-0 overflow-hidden py-0">
      <div className="relative min-h-0 flex-1 border-b bg-white">
        <a href={t.productUrl} target="_blank" rel="noreferrer" tabIndex={-1} aria-hidden className="absolute inset-0 p-4">
          <ProductImage src={t.imageUrl} className={cn("size-full", !t.enabled && "opacity-50 grayscale")} />
        </a>
        <div className="absolute top-3 left-3">
          <StatusBadge status={t.status} label={t.statusLabel} paused={!t.enabled} className="bg-background shadow-xs" />
        </div>
        <ProductMenu tracker={refFor} className="absolute top-2 right-2 bg-background/90 shadow-xs hover:bg-background" />
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="min-w-0 space-y-1">
          <a
            href={t.productUrl}
            target="_blank"
            rel="noreferrer"
            title={t.name}
            className="line-clamp-2 text-sm leading-snug font-medium hover:underline"
          >
            {t.name}
          </a>
          <StoreLabel store={store} fallback={t.storeId} variant={t.variant} />
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="font-semibold tabular-nums">{price ?? "—"}</span>
              {t.stock !== null && t.available ? (
                <span className="text-xs text-muted-foreground tabular-nums">{t.stock} units</span>
              ) : null}
            </div>
            {t.lastError ? (
              <ErrorHint message={t.lastError} />
            ) : (
              <span className="text-xs text-muted-foreground">Checked {timeAgo(t.lastCheckedAt, now)}</span>
            )}
          </div>
          <CheckNowButton tracker={refFor} />
        </div>
      </div>
    </Card>
  );
}

function ProductTable({
  trackers,
  storesById,
  refFor,
  now,
}: {
  trackers: Tracker[];
  storesById: Map<string, StoreInfo>;
  refFor: (t: Tracker) => TrackerRef;
  now: number;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="w-[45%] pl-4">Product</TableHead>
            <TableHead>Store</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead>Last check</TableHead>
            <TableHead className="w-24 pr-4">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trackers.map((t) => {
            const store = storesById.get(t.storeId);
            const ref = refFor(t);
            return (
              <TableRow key={t.id}>
                <TableCell className="pl-4">
                  <div className="flex items-center gap-3">
                    <div className="size-10 shrink-0 overflow-hidden rounded-md border bg-white p-1">
                      <ProductImage src={t.imageUrl} className={cn("size-full", !t.enabled && "opacity-50 grayscale")} />
                    </div>
                    <div className="min-w-0">
                      <a
                        href={t.productUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={t.name}
                        className="block max-w-md truncate font-medium hover:underline"
                      >
                        {t.name}
                      </a>
                      {t.variant ? <span className="text-xs text-muted-foreground">{t.variant}</span> : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <StoreLabel store={store} fallback={t.storeId} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={t.status} label={t.statusLabel} paused={!t.enabled} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <div className="font-medium">{formatPrice(t.price) ?? "—"}</div>
                  {t.stock !== null && t.available ? (
                    <div className="text-xs text-muted-foreground">{t.stock} units</div>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {t.lastError ? <ErrorHint message={t.lastError} /> : timeAgo(t.lastCheckedAt, now)}
                </TableCell>
                <TableCell className="pr-4">
                  <div className="flex items-center justify-end gap-1">
                    <CheckNowButton tracker={ref} />
                    <ProductMenu tracker={ref} />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
