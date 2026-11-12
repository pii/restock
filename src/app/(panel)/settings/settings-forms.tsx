"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { MoreHorizontalIcon, PlusIcon, SendIcon, Trash2Icon, WebhookIcon } from "lucide-react";
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
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { timeAgo } from "@/lib/format";
import {
  addWebhookAction,
  changePasswordAction,
  deleteWebhookAction,
  saveIntervalAction,
  setNotificationRuleAction,
  setWebhookEnabledAction,
  setWebhookMentionEveryoneAction,
  testWebhookAction,
  type ActionResult,
} from "../actions";

// ---- Check interval ---------------------------------------------------------

export function IntervalCard({ value, min, max }: { value: number; min: number; max: number }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, formData) => {
    const r = await saveIntervalAction(prev, formData);
    if (r?.ok) toast.success(r.message);
    return r;
  }, null);
  const error = state && !state.ok ? state.message : null;

  return (
    <Card id="checking" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>Check interval</CardTitle>
        <CardDescription>How often every tracked product is re-checked in the background.</CardDescription>
      </CardHeader>
      <form action={action} className="flex flex-col gap-6">
        <CardContent>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="checkIntervalMinutes">Check every</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                id="checkIntervalMinutes"
                name="checkIntervalMinutes"
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                step={1}
                defaultValue={value}
                required
                aria-invalid={!!error}
                className="w-28 tabular-nums"
              />
              <span className="text-sm text-muted-foreground">minutes</span>
            </div>
            <FieldDescription>
              Shorter intervals catch restocks sooner but send more requests to the stores.
            </FieldDescription>
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            Save
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

// ---- Notification rules -----------------------------------------------------

function RuleSwitch({
  rule,
  initial,
  label,
  description,
}: {
  rule: "notifyOnAvailable" | "notifyOnUnavailable";
  initial: boolean;
  label: string;
  description: string;
}) {
  const [checked, setChecked] = useState(initial);
  const [pending, start] = useTransition();
  const id = `rule-${rule}`;
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      <Switch
        id={id}
        checked={checked}
        disabled={pending}
        onCheckedChange={(next) => {
          setChecked(next);
          start(async () => {
            try {
              await setNotificationRuleAction(rule, next);
              toast.success(next ? `On: ${label.toLowerCase()}` : `Off: ${label.toLowerCase()}`);
            } catch {
              setChecked(!next);
              toast.error("Couldn't save that setting");
            }
          });
        }}
      />
    </Field>
  );
}

export function NotificationRulesCard({
  notifyOnAvailable,
  notifyOnUnavailable,
}: {
  notifyOnAvailable: boolean;
  notifyOnUnavailable: boolean;
}) {
  return (
    <Card id="notifications" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>Which stock changes send a message to your Discord webhooks.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <RuleSwitch
            rule="notifyOnAvailable"
            initial={notifyOnAvailable}
            label="Product comes back in stock"
            description="In stock or last pieces. Pre-orders and backorders don't count."
          />
          <RuleSwitch
            rule="notifyOnUnavailable"
            initial={notifyOnUnavailable}
            label="Product sells out"
            description="Including when it moves to backorder or pre-order."
          />
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

// ---- Discord webhooks -------------------------------------------------------

export type WebhookView = {
  id: number;
  name: string;
  maskedUrl: string;
  enabled: boolean;
  mentionEveryone: boolean;
  lastSentAt: number | null;
  lastError: string | null;
};

function AddWebhookDialog() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, formData) => {
    const r = await addWebhookAction(prev, formData);
    if (r?.ok) {
      toast.success(r.message);
      setOpen(false);
    }
    return r;
  }, null);
  const error = state && !state.ok ? state.message : null;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <PlusIcon />
        Add webhook
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Discord webhook</DialogTitle>
            <DialogDescription>
              In Discord, open the channel settings, then Integrations, Webhooks, New Webhook, and copy its URL.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="flex flex-col gap-6">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="webhook-name">Name</FieldLabel>
                <Input id="webhook-name" name="name" placeholder="Deals channel" maxLength={60} />
              </Field>
              <Field data-invalid={!!error}>
                <FieldLabel htmlFor="webhook-url">Webhook URL</FieldLabel>
                <Input
                  id="webhook-url"
                  name="url"
                  type="url"
                  placeholder="https://discord.com/api/webhooks/…"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  aria-invalid={!!error}
                />
                {error ? <FieldError>{error}</FieldError> : null}
              </Field>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="webhook-everyone">Mention @everyone</FieldLabel>
                  <FieldDescription>
                    Back-in-stock alerts ping everyone in the channel. Sell-out alerts never do.
                  </FieldDescription>
                </FieldContent>
                <Switch id="webhook-everyone" name="mentionEveryone" />
              </Field>
            </FieldGroup>
            <DialogFooter className="mx-0 mb-0 rounded-none border-0 bg-transparent p-0">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                Add webhook
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function WebhookRow({ hook, now }: { hook: WebhookView; now: number }) {
  const [enabled, setEnabled] = useState(hook.enabled);
  const [everyone, setEveryone] = useState(hook.mentionEveryone);
  const [pending, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <TableRow>
      <TableCell className="pl-4 font-medium">{hook.name}</TableCell>
      <TableCell className="max-w-56 truncate font-mono text-xs text-muted-foreground">{hook.maskedUrl}</TableCell>
      <TableCell>
        {hook.lastError ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="border-status-bad/25 bg-status-bad-bg text-status-bad">
                Failed
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">{hook.lastError}</TooltipContent>
          </Tooltip>
        ) : hook.lastSentAt ? (
          <span className="text-sm text-muted-foreground">{timeAgo(hook.lastSentAt, now)}</span>
        ) : (
          <span className="text-sm text-muted-foreground">Never</span>
        )}
      </TableCell>
      <TableCell>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* The wrapper keeps the tooltip working while the switch is disabled. */}
            <span className="inline-flex">
              <Switch
                checked={everyone}
                disabled={pending}
                aria-label={`Mention @everyone in back-in-stock alerts to ${hook.name}`}
                onCheckedChange={(next) => {
                  setEveryone(next);
                  start(async () => {
                    await setWebhookMentionEveryoneAction(hook.id, next);
                    toast(next ? `“${hook.name}” will ping @everyone` : `“${hook.name}” won't ping @everyone`, {
                      description: next ? "Only back-in-stock alerts and test messages ping." : undefined,
                    });
                  });
                }}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>Ping @everyone when a product comes back in stock</TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell>
        <Switch
          checked={enabled}
          disabled={pending}
          aria-label={`Send alerts to ${hook.name}`}
          onCheckedChange={(next) => {
            setEnabled(next);
            start(async () => {
              await setWebhookEnabledAction(hook.id, next);
              toast(`${next ? "Turned on" : "Turned off"} “${hook.name}”`);
            });
          }}
        />
      </TableCell>
      <TableCell className="pr-4 text-right">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" disabled={pending} aria-label={`Options for ${hook.name}`}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              onSelect={() =>
                start(async () => {
                  const r = await testWebhookAction(hook.id);
                  if (r?.ok) toast.success("Test sent", { description: "Check your Discord channel." });
                  else toast.error("Test failed", { description: r?.message });
                })
              }
            >
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
              <AlertDialogTitle>Remove this webhook?</AlertDialogTitle>
              <AlertDialogDescription>
                “{hook.name}” will stop getting stock alerts. The webhook itself stays in Discord.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() =>
                  start(async () => {
                    await deleteWebhookAction(hook.id);
                    toast(`Removed “${hook.name}”`);
                  })
                }
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  );
}

export function WebhooksCard({ webhooks, now }: { webhooks: WebhookView[]; now: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Discord webhooks</CardTitle>
        <CardDescription>Channels that get the notifications above.</CardDescription>
        <CardAction>
          <AddWebhookDialog />
        </CardAction>
      </CardHeader>
      <CardContent>
        {webhooks.length === 0 ? (
          <Empty className="border border-dashed py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <WebhookIcon />
              </EmptyMedia>
              <EmptyTitle>No webhooks yet</EmptyTitle>
              <EmptyDescription>Add one to get stock alerts in a Discord channel.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-4">Name</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Last delivery</TableHead>
                  <TableHead>@everyone</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="pr-4">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.map((h) => (
                  <WebhookRow key={h.id} hook={h} now={now} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Account ----------------------------------------------------------------

export function PasswordCard({ username }: { username: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, formData) => {
    const r = await changePasswordAction(prev, formData);
    if (r?.ok) {
      toast.success(r.message);
      formRef.current?.reset();
    }
    return r;
  }, null);
  const error = state && !state.ok ? state.message : null;

  return (
    <Card id="account" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          Signed in as <span className="font-medium text-foreground">{username}</span>.
        </CardDescription>
      </CardHeader>
      <form ref={formRef} action={action} className="flex flex-col gap-6">
        <CardContent>
          <FieldGroup className="max-w-sm">
            <Field>
              <FieldLabel htmlFor="currentPassword">Current password</FieldLabel>
              <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="newPassword">New password</FieldLabel>
              <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={8} required />
              <FieldDescription>At least 8 characters.</FieldDescription>
            </Field>
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor="confirmPassword">Confirm new password</FieldLabel>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                aria-invalid={!!error}
              />
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            Change password
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
