"use client";

import { useRouter } from "next/navigation";
import { createContext, use, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { ArrowLeftIcon, ExternalLinkIcon, PlusIcon, SearchIcon, TriangleAlertIcon } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatPrice } from "@/lib/format";
import type { LookupResponse, ProductWithTracking, SearchResult } from "@/lib/lookup-types";
import type { StoreInfo } from "@/lib/stores";
import { cn } from "@/lib/utils";
import { trackProductsAction } from "./actions";

const OpenAddProduct = createContext<(() => void) | null>(null);

/**
 * Holds the one "Add product" dialog for the page. It sits at a stable spot in
 * the tree, so it stays open while the page behind it re-renders (for example
 * when the first product is added and the empty state becomes the product list).
 */
export function AddProductProvider({ stores, children }: { stores: StoreInfo[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <OpenAddProduct value={() => setOpen(true)}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle>Add product</DialogTitle>
            <DialogDescription>Choose a store, then search by name or paste a product link.</DialogDescription>
          </DialogHeader>
          {/* Content is unmounted on close, so each opening starts fresh. */}
          <AddProduct stores={stores} />
        </DialogContent>
      </Dialog>
    </OpenAddProduct>
  );
}

/** Opens the page's "Add product" dialog. Must be inside AddProductProvider. */
export function AddProductButton() {
  const open = use(OpenAddProduct);
  return (
    <Button aria-haspopup="dialog" onClick={() => open?.()}>
      <PlusIcon />
      Add product
    </Button>
  );
}

class SessionEndedError extends Error {
  constructor() {
    super("Your session ended. Sign in again.");
  }
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (res.status === 401) throw new SessionEndedError();
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (HTTP ${res.status}).`);
  return body as T;
}

function preselect(product: ProductWithTracking): Set<string> {
  const tracked = new Set(product.trackedIds);
  const pick = product.variants.length === 1 ? product.variants[0].productId : product.selectedProductId;
  return tracked.has(pick) ? new Set() : new Set([pick]);
}

/** Consecutive results that share a section, in the order the store gave them. */
function groupBySection(items: SearchResult[]): { section?: string; items: SearchResult[] }[] {
  const groups: { section?: string; items: SearchResult[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
  }
  return groups;
}

function Thumb({ src, className }: { src: string | null; className?: string }) {
  return (
    <div className={cn("shrink-0 overflow-hidden rounded-md border bg-white p-1", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote store images, any host
        <img src={src} alt="" loading="lazy" className="size-full object-contain" />
      ) : null}
    </div>
  );
}

function AddProduct({ stores }: { stores: StoreInfo[] }) {
  const router = useRouter();
  const [storeId, setStoreId] = useState<string | null>(null);
  const store = stores.find((s) => s.id === storeId) ?? null;

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState<"search" | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ query: string; items: SearchResult[] } | null>(null);
  const [product, setProduct] = useState<ProductWithTracking | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tracking, startTracking] = useTransition();
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  function begin(kind: "search" | string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(kind);
    setError(null);
    return controller.signal;
  }

  function fail(err: unknown, signal: AbortSignal) {
    if (signal.aborted) return;
    if (err instanceof SessionEndedError) router.push("/login");
    setError((err as Error).message);
  }

  function showProduct(p: ProductWithTracking) {
    setProduct(p);
    setSelected(preselect(p));
    bodyRef.current?.scrollTo({ top: 0 });
  }

  function chooseStore(id: string) {
    if (!id) return;
    setStoreId(id);
    setResults(null);
    setProduct(null);
    setError(null);
    // The search box appears on the next render; move into it.
    requestAnimationFrame(() => document.getElementById("lookup")?.focus());
  }

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || !store) return;
    const signal = begin("search");
    try {
      const data = await getJson<LookupResponse>(`/api/stores/${store.id}/lookup?q=${encodeURIComponent(q)}`, signal);
      if (data.type === "product") {
        showProduct(data.product);
      } else {
        setProduct(null);
        setResults({ query: data.query, items: data.results });
        bodyRef.current?.scrollTo({ top: 0 });
      }
    } catch (err) {
      fail(err, signal);
    } finally {
      if (!signal.aborted) setLoading(null);
    }
  }

  async function onChoose(productId: string) {
    if (!store) return;
    const signal = begin(productId);
    try {
      showProduct(
        await getJson<ProductWithTracking>(`/api/stores/${store.id}/products/${encodeURIComponent(productId)}`, signal),
      );
    } catch (err) {
      fail(err, signal);
    } finally {
      if (!signal.aborted) setLoading(null);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onTrack() {
    if (!product || !store || selected.size === 0) return;
    const ids = [...selected];
    startTracking(async () => {
      const r = await trackProductsAction(store.id, product.lookupId, ids);
      if (r.added > 0) {
        toast.success(`Now tracking ${r.added} product${r.added === 1 ? "" : "s"}`, {
          description: r.alreadyTracked ? `${r.alreadyTracked} already tracked.` : product.name,
        });
      } else if (r.alreadyTracked > 0) {
        toast("Already tracked", { description: product.name });
      }
      for (const e of r.errors) toast.error("Couldn't add a product", { description: e });
      setProduct((p) => (p ? { ...p, trackedIds: [...new Set([...p.trackedIds, ...ids])] } : p));
      setSelected(new Set());
    });
  }

  if (stores.length === 0) return <p className="px-6 pb-6 text-sm text-muted-foreground">No stores are configured.</p>;

  const allTracked = product?.variants.every((v) => product.trackedIds.includes(v.productId)) ?? false;
  const searching = loading === "search";

  return (
    <>
      <div className="flex flex-col gap-4 px-6 pb-5">
        <Field>
          <FieldLabel>Store</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            value={storeId ?? ""}
            onValueChange={chooseStore}
            aria-label="Store"
            className="flex-wrap"
          >
            {stores.map((s) => (
              <ToggleGroupItem
                key={s.id}
                value={s.id}
                className="h-9 gap-2 px-3 data-[state=on]:border-primary data-[state=on]:bg-accent"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- small static logo */}
                <img src={s.logo} alt="" width={18} height={18} className="size-[18px] rounded-[4px]" />
                {s.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>

        {store && !store.searchable ? (
          <Alert className="border-status-warn/30 bg-status-warn-bg text-status-warn">
            <TriangleAlertIcon />
            <AlertDescription className="text-status-warn">
              Searching by name isn&apos;t available for {store.name}. Open the product on its site and paste the link.
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Search only appears once a store is chosen. */}
        {store ? (
          <form onSubmit={onSearch} role="search" className="flex gap-2">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="lookup"
                type="text"
                inputMode="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={store.searchPlaceholder}
                aria-label="Product name or link"
                autoComplete="off"
                className="h-10 pl-9"
              />
            </div>
            <Button type="submit" className="h-10" disabled={searching || !query.trim()}>
              {searching ? <Spinner /> : null}
              {store.searchable ? "Search" : "Look up"}
            </Button>
          </form>
        ) : null}
      </div>

      {error || product || results ? (
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto border-t bg-muted/40 px-6 py-4">
          {error ? (
            <Alert variant="destructive" className="mb-4">
              <TriangleAlertIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {product ? (
            <section aria-labelledby="product-name" className="flex flex-col gap-4">
              {results ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 self-start text-muted-foreground"
                  onClick={() => setProduct(null)}
                >
                  <ArrowLeftIcon />
                  Results for “{results.query}”
                </Button>
              ) : null}
              <div className="flex gap-4">
                <Thumb src={product.imageUrl} className="size-20" />
                <div className="flex min-w-0 flex-col justify-center gap-1">
                  <h3 id="product-name" className="font-semibold leading-snug break-words">
                    {product.name}
                  </h3>
                  <a
                    href={product.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Open on {store?.name}
                    <ExternalLinkIcon className="size-3.5" />
                  </a>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {product.variants.length > 1 ? "Choose what to track" : "Availability right now"}
                </p>
                <ul className="divide-y overflow-hidden rounded-lg border bg-background">
                  {product.variants.map((v) => {
                    const tracked = product.trackedIds.includes(v.productId);
                    const price = formatPrice(v.price);
                    return (
                      <li key={v.productId}>
                        <label
                          className={cn(
                            "flex items-center gap-3 px-3 py-2.5",
                            tracked ? "cursor-default opacity-70" : "cursor-pointer hover:bg-accent/50",
                          )}
                        >
                          <Checkbox
                            checked={selected.has(v.productId)}
                            disabled={tracked}
                            onCheckedChange={() => toggle(v.productId)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{v.variant ?? v.name}</span>
                            {v.variant ? (
                              <span className="block truncate text-xs text-muted-foreground">{v.name}</span>
                            ) : null}
                          </span>
                          <span className="flex shrink-0 items-center gap-3">
                            {tracked ? <Badge variant="secondary">Tracked</Badge> : null}
                            <StatusBadge status={v.status} label={v.label} />
                            {v.stock !== null && v.available ? (
                              <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
                                {v.stock} units
                              </span>
                            ) : null}
                            {price ? <span className="w-20 text-right text-sm font-medium tabular-nums">{price}</span> : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          ) : results ? (
            <section aria-label="Search results" className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                {results.items.length === 0
                  ? `${store?.name} has nothing matching “${results.query}”. Try fewer words, or paste the product link.`
                  : `${results.items.length} result${results.items.length === 1 ? "" : "s"} for “${results.query}”`}
              </p>
              {groupBySection(results.items).map((group, gi, groups) => (
                <div key={group.section ?? gi} className="flex flex-col gap-2">
                  {groups.length > 1 && group.section ? (
                    <h4 className="flex items-baseline gap-2 text-sm font-medium">
                      {group.section}
                      <span className="text-xs font-normal text-muted-foreground tabular-nums">{group.items.length}</span>
                    </h4>
                  ) : null}
                  <ul className="divide-y overflow-hidden rounded-lg border bg-background">
                    {group.items.map((r) => {
                      const price = formatPrice(r.price);
                      return (
                        <li key={r.productId} className="flex items-center gap-3 px-3 py-2.5">
                          <Thumb src={r.imageUrl} className="size-12" />
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="text-sm leading-snug font-medium break-words">{r.name}</span>
                            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <StatusBadge status={r.status} label={r.label} />
                              {price ? <span className="text-sm tabular-nums">{price}</span> : null}
                              {r.variantCount > 1 ? (
                                <span className="text-xs text-muted-foreground">{r.variantCount} options</span>
                              ) : null}
                            </span>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onChoose(r.productId)}
                            disabled={loading === r.productId}
                          >
                            {loading === r.productId ? <Spinner /> : null}
                            Select
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>
          ) : null}
        </div>
      ) : null}

      {product ? (
        <DialogFooter className="mx-0 mb-0 items-center rounded-none border-t bg-background px-6 py-4 sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {allTracked
              ? "Everything here is already tracked."
              : selected.size === 0
                ? "Select at least one option."
                : `${selected.size} selected`}
          </p>
          <Button onClick={onTrack} disabled={tracking || selected.size === 0}>
            {tracking ? <Spinner /> : null}
            {selected.size <= 1 ? "Track product" : `Track ${selected.size} products`}
          </Button>
        </DialogFooter>
      ) : null}
    </>
  );
}
