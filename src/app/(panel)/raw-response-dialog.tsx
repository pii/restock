"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { CheckIcon, CopyIcon, DownloadIcon, ExternalLinkIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { RawResponseBody } from "@/lib/lookup-types";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; body: RawResponseBody; text: string };

/** Popup showing the store's current response for a tracked product, as formatted JSON. */
export function RawResponseDialog({
  open,
  onOpenChange,
  trackerId,
  name,
  storeName,
  fileName,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trackerId: number;
  name: string;
  storeName: string;
  fileName: string;
  /** Element to focus on close (the menu item that opened the popup is gone by then). */
  returnFocusTo?: RefObject<HTMLElement | null>;
}) {
  // Bumping this remounts the view, which fetches again.
  const [attempt, setAttempt] = useState(0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[calc(100dvh-2rem)] max-h-[60rem] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
        onCloseAutoFocus={(e) => {
          if (!returnFocusTo?.current) return;
          e.preventDefault();
          returnFocusTo.current.focus();
        }}
      >
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>API response</DialogTitle>
          <DialogDescription className="truncate">
            {storeName}: {name}
          </DialogDescription>
        </DialogHeader>
        <RawResponseView
          key={attempt}
          trackerId={trackerId}
          storeName={storeName}
          fileName={fileName}
          onRefetch={() => setAttempt((n) => n + 1)}
        />
      </DialogContent>
    </Dialog>
  );
}

function RawResponseView({
  trackerId,
  storeName,
  fileName,
  onRefetch,
}: {
  trackerId: number;
  storeName: string;
  fileName: string;
  onRefetch: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/trackers/${trackerId}/raw`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        const body = await res.json().catch(() => null);
        if (res.status === 401) throw new Error("Your session ended. Sign in again.");
        if (!res.ok) throw new Error(body?.error ?? `Request failed (HTTP ${res.status}).`);
        const data = body as RawResponseBody;
        setState({ kind: "ready", body: data, text: JSON.stringify(data.data, null, 2) });
      } catch (err) {
        if (!controller.signal.aborted) setState({ kind: "error", message: (err as Error).message });
      }
    })();
    return () => controller.abort();
  }, [trackerId]);

  async function copy(text: string) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Plain-http LAN access has no clipboard API; fall back to a selected textarea.
        // It goes inside the dialog so the dialog's focus trap doesn't fight it.
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        (rootRef.current ?? document.body).appendChild(area);
        area.select();
        const ok = document.execCommand("copy");
        area.remove();
        if (!ok) throw new Error("copy failed");
      }
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied(null), 2000);
  }

  function download(text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (state.kind === "loading") {
    return (
      <div className="flex flex-1 flex-col gap-3 border-t bg-muted/40 px-6 py-5" role="status" aria-label={`Fetching from ${storeName}`}>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="mt-2 h-full w-full" />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex flex-1 flex-col items-start gap-3 border-t bg-muted/40 px-6 py-5">
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
        <Button size="sm" variant="outline" onClick={onRefetch}>
          <RefreshCwIcon />
          Try again
        </Button>
      </div>
    );
  }

  const { body, text } = state;
  const sizeKb = Math.max(1, Math.round(new Blob([text]).size / 1024));

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col border-t">
      <div className="flex flex-col gap-3 px-6 py-4">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Badge variant="secondary" className="shrink-0 font-mono">
            GET
          </Badge>
          <a
            href={body.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
            title={body.url}
          >
            <span className="truncate">{body.url}</span>
            <ExternalLinkIcon className="size-3.5 shrink-0" />
          </a>
        </div>
        <p className="text-sm text-muted-foreground">{body.note}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => copy(text)}>
            {copied === "ok" ? <CheckIcon /> : <CopyIcon />}
            {copied === "ok" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy JSON"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => download(text)}>
            <DownloadIcon />
            Download
          </Button>
          <Button size="sm" variant="ghost" onClick={onRefetch}>
            <RefreshCwIcon />
            Fetch again
          </Button>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {sizeKb} KB, fetched at {new Date(body.fetchedAt).toLocaleTimeString("el-GR")}
          </span>
        </div>
      </div>
      <pre
        tabIndex={0}
        aria-label={`JSON response from ${body.store}`}
        className="min-h-0 flex-1 overflow-auto border-t bg-muted/40 px-6 py-4 font-mono text-xs leading-relaxed whitespace-pre"
      >
        {text}
      </pre>
    </div>
  );
}
