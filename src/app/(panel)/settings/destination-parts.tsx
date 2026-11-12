"use client";

import { useState, type ReactNode } from "react";
import { MoreHorizontalIcon, SendIcon, Trash2Icon } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { timeAgo } from "@/lib/format";

// Pieces shared by the Discord webhook and Telegram chat lists in Settings.

/** When the last alert went out, or a "Failed" badge with the error on hover. */
export function LastDelivery({ at, error, now }: { at: number | null; error: string | null; now: number }) {
  if (error) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="border-status-bad/25 bg-status-bad-bg text-status-bad">
            Failed
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-72">{error}</TooltipContent>
      </Tooltip>
    );
  }
  return <span className="text-sm text-muted-foreground">{at ? timeAgo(at, now) : "Never"}</span>;
}

/** The ⋯ menu of a row: send a test, or remove it after a confirmation. */
export function DestinationMenu({
  name,
  disabled,
  onTest,
  removeTitle,
  removeDescription,
  onRemove,
}: {
  name: string;
  disabled: boolean;
  onTest: () => void;
  removeTitle: string;
  removeDescription: ReactNode;
  onRemove: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={`Options for ${name}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={onTest}>
            <SendIcon />
            Send test
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
            <Trash2Icon />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{removeTitle}</AlertDialogTitle>
            <AlertDialogDescription>{removeDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={onRemove}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
