"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  BellIcon,
  BellOffIcon,
  BracesIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  checkAllAction,
  checkTrackerAction,
  deleteTrackerAction,
  setTrackerEnabledAction,
  setTrackerNotifyAction,
} from "./actions";
import { RawResponseDialog } from "./raw-response-dialog";

export type TrackerRef = {
  id: number;
  name: string;
  enabled: boolean;
  notify: boolean;
  productUrl: string;
  storeId: string;
  storeName: string;
  productId: string;
};

function useCheck(t: Pick<TrackerRef, "id" | "name">) {
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const r = await checkTrackerAction(t.id);
      if (r?.ok) toast.success(`Checked “${t.name}”`, { description: r.message });
      else toast.error(`Couldn't check “${t.name}”`, { description: r?.message });
    });
  return { pending, run };
}

/** Icon button that checks one product now (or resumes a paused one). */
export function CheckNowButton({ tracker, className }: { tracker: TrackerRef; className?: string }) {
  const { pending, run } = useCheck(tracker);
  const [resuming, startResume] = useTransition();

  if (!tracker.enabled) {
    return (
      <Button
        variant="outline"
        size="sm"
        className={className}
        disabled={resuming}
        onClick={() =>
          startResume(async () => {
            await setTrackerEnabledAction(tracker.id, true);
            toast(`Resumed checking “${tracker.name}”`);
          })
        }
      >
        <PlayIcon />
        Resume
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className={className}
          disabled={pending}
          onClick={run}
          aria-label={`Check “${tracker.name}” now`}
        >
          <RefreshCwIcon className={cn(pending && "animate-spin")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Check now</TooltipContent>
    </Tooltip>
  );
}

/** Bell button that turns stock alerts for one product on or off. */
export function AlertsToggle({ tracker, className }: { tracker: TrackerRef; className?: string }) {
  // Flips right away; falls back to the saved value if saving fails.
  const [notify, setNotify] = useOptimistic(tracker.notify);
  const [, start] = useTransition();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className={className}
          aria-pressed={notify}
          aria-label={`Alerts for “${tracker.name}”`}
          onClick={() =>
            start(async () => {
              const next = !notify;
              setNotify(next);
              try {
                await setTrackerNotifyAction(tracker.id, next);
                toast(next ? `Alerts on for “${tracker.name}”` : `Alerts off for “${tracker.name}”`, {
                  description: next ? undefined : "It's still checked, but no messages are sent about it.",
                });
              } catch {
                toast.error("Couldn't save that setting");
              }
            })
          }
        >
          {notify ? <BellIcon className="text-muted-foreground" /> : <BellOffIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{notify ? "Alerts on. Click to turn them off." : "Alerts off. Click to turn them on."}</TooltipContent>
    </Tooltip>
  );
}

/** The ⋯ menu for a product, with its confirm and API-response dialogs. */
export function ProductMenu({ tracker, className }: { tracker: TrackerRef; className?: string }) {
  const [busy, startBusy] = useTransition();
  const { pending: checking, run: check } = useCheck(tracker);
  const [rawOpen, setRawOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      {/* Non-modal so closing the menu doesn't fight the dialogs it opens over focus. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon-sm"
            className={className}
            disabled={busy}
            aria-label={`Options for ${tracker.name}`}
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem asChild>
            <a href={tracker.productUrl} target="_blank" rel="noreferrer">
              <ExternalLinkIcon />
              Open on {tracker.storeName}
            </a>
          </DropdownMenuItem>
          {tracker.enabled ? (
            <DropdownMenuItem disabled={checking} onSelect={check}>
              <RefreshCwIcon />
              Check now
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onSelect={() =>
              startBusy(async () => {
                await setTrackerEnabledAction(tracker.id, !tracker.enabled);
                toast(`${tracker.enabled ? "Paused" : "Resumed"} checking “${tracker.name}”`);
              })
            }
          >
            {tracker.enabled ? <PauseIcon /> : <PlayIcon />}
            {tracker.enabled ? "Pause checking" : "Resume checking"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setRawOpen(true)}>
            <BracesIcon />
            View API response
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
            <Trash2Icon />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RawResponseDialog
        open={rawOpen}
        onOpenChange={setRawOpen}
        trackerId={tracker.id}
        name={tracker.name}
        storeName={tracker.storeName}
        fileName={`${tracker.storeId}-${tracker.productId}.json`}
        returnFocusTo={triggerRef}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop tracking this product?</AlertDialogTitle>
            <AlertDialogDescription>
              “{tracker.name}” will be removed and you won&apos;t get alerts for it. You can add it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() =>
                startBusy(async () => {
                  await deleteTrackerAction(tracker.id);
                  toast(`Removed “${tracker.name}”`);
                })
              }
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function CheckAllButton({ count }: { count: number }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending || count === 0}
      onClick={() =>
        start(async () => {
          const r = await checkAllAction();
          if (r?.ok) toast.success(r.message);
          else toast.error("Some checks failed", { description: r?.message });
        })
      }
    >
      <RefreshCwIcon className={cn(pending && "animate-spin")} />
      {pending ? `Checking ${count}…` : "Check all"}
    </Button>
  );
}
