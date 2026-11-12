"use client";

import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckIcon, PlusIcon, SearchIcon, SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  addTelegramChatAction,
  deleteTelegramChatAction,
  findTelegramChatsAction,
  setTelegramChatEnabledAction,
  testTelegramChatAction,
  type ActionResult,
  type FindChatsResult,
} from "../actions";
import { DestinationMenu, LastDelivery } from "./destination-parts";

const linkClass = "font-medium text-foreground underline underline-offset-4";

function TelegramLink({ username }: { username: string }) {
  return (
    <a href={`https://t.me/${username}`} target="_blank" rel="noreferrer" className={linkClass}>
      @{username}
    </a>
  );
}

// ---- Telegram chats ---------------------------------------------------------

export type TelegramChatView = {
  id: number;
  name: string;
  chatId: string;
  enabled: boolean;
  lastSentAt: number | null;
  lastError: string | null;
};

/** Mounted only while the dialog is open, so every opening starts empty. */
function AddTelegramChatForm({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [name, setName] = useState("");
  const [found, setFound] = useState<FindChatsResult | null>(null);
  const [finding, startFinding] = useTransition();
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, formData) => {
    const r = await addTelegramChatAction(prev, formData);
    if (r?.ok) {
      toast.success(r.message);
      onDone();
    }
    return r;
  }, null);
  const error = state && !state.ok ? state.message : null;

  function pick(chat: { id: string; title: string }) {
    setChatId(chat.id);
    setName((current) => current.trim() || chat.title.slice(0, 60));
  }

  function find() {
    startFinding(async () => {
      const r = await findTelegramChatsAction(token);
      setFound(r);
      if (r.ok && r.chats.length === 1) pick(r.chats[0]);
    });
  }

  return (
    <form action={action} className="flex flex-col gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="telegram-token">Bot token</FieldLabel>
          <Input
            id="telegram-token"
            name="botToken"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setFound(null);
            }}
            placeholder="123456789:AAH…"
            autoComplete="off"
            spellCheck={false}
            required
            className="font-mono text-xs"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="telegram-chat">Chat</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="telegram-chat"
              name="chatId"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="Chat ID"
              autoComplete="off"
              spellCheck={false}
              required
              className="font-mono text-xs"
            />
            <Button type="button" variant="outline" onClick={find} disabled={finding || !token.trim()}>
              {finding ? <Spinner /> : <SearchIcon />}
              Find
            </Button>
          </div>
          <FieldDescription>
            In Telegram, open your bot and press Start, or add the bot to a group. Then click Find.
          </FieldDescription>
          {found && !found.ok ? <FieldError>{found.message}</FieldError> : null}
          {found?.ok && found.chats.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No chats yet. Open <TelegramLink username={found.botUsername} /> in Telegram and press Start, or add
              it to your group and send a message there. Then click Find again.
            </p>
          ) : null}
          {found?.ok && found.chats.length > 0 ? (
            <div className="flex flex-col gap-1" role="group" aria-label="Chats that messaged the bot">
              {found.chats.map((chat) => (
                <Button
                  key={chat.id}
                  type="button"
                  variant={chat.id === chatId ? "secondary" : "ghost"}
                  className="h-auto justify-start py-1.5 text-left"
                  aria-pressed={chat.id === chatId}
                  onClick={() => pick(chat)}
                >
                  {chat.id === chatId ? <CheckIcon /> : <SendIcon className="text-muted-foreground" />}
                  <span className="truncate">{chat.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{chat.type === "private" ? "you" : chat.type}</span>
                </Button>
              ))}
            </div>
          ) : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="telegram-name">Name</FieldLabel>
          <Input
            id="telegram-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My alerts"
            maxLength={60}
          />
        </Field>
        {error ? <FieldError>{error}</FieldError> : null}
      </FieldGroup>
      <DialogFooter className="mx-0 mb-0 rounded-none border-0 bg-transparent p-0">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          Add chat
        </Button>
      </DialogFooter>
    </form>
  );
}

function AddTelegramChatDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <PlusIcon />
        Add chat
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Telegram chat</DialogTitle>
            <DialogDescription>
              Alerts come from your own Telegram bot. To make one, message <TelegramLink username="BotFather" />,
              send /newbot and paste the token it gives you.
            </DialogDescription>
          </DialogHeader>
          <AddTelegramChatForm onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function TelegramChatRow({ chat, now }: { chat: TelegramChatView; now: number }) {
  const [enabled, setEnabled] = useState(chat.enabled);
  const [pending, start] = useTransition();

  return (
    <TableRow>
      <TableCell className="pl-4 font-medium">{chat.name}</TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">{chat.chatId}</TableCell>
      <TableCell>
        <LastDelivery at={chat.lastSentAt} error={chat.lastError} now={now} />
      </TableCell>
      <TableCell>
        <Switch
          checked={enabled}
          disabled={pending}
          aria-label={`Send alerts to ${chat.name}`}
          onCheckedChange={(next) => {
            setEnabled(next);
            start(async () => {
              await setTelegramChatEnabledAction(chat.id, next);
              toast(`${next ? "Turned on" : "Turned off"} “${chat.name}”`);
            });
          }}
        />
      </TableCell>
      <TableCell className="pr-4 text-right">
        <DestinationMenu
          name={chat.name}
          disabled={pending}
          onTest={() =>
            start(async () => {
              const r = await testTelegramChatAction(chat.id);
              if (r?.ok) toast.success("Test sent", { description: "Check the Telegram chat." });
              else toast.error("Test failed", { description: r?.message });
            })
          }
          removeTitle="Remove this chat?"
          removeDescription={<>“{chat.name}” will stop getting stock alerts. Your bot stays in Telegram.</>}
          onRemove={() =>
            start(async () => {
              await deleteTelegramChatAction(chat.id);
              toast(`Removed “${chat.name}”`);
            })
          }
        />
      </TableCell>
    </TableRow>
  );
}

export function TelegramChatsCard({ chats, now }: { chats: TelegramChatView[]; now: number }) {
  return (
    <Card id="telegram" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>Telegram chats</CardTitle>
        <CardDescription>Chats where your Telegram bot posts the notifications above.</CardDescription>
        <CardAction>
          <AddTelegramChatDialog />
        </CardAction>
      </CardHeader>
      <CardContent>
        {chats.length === 0 ? (
          <Empty className="border border-dashed py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SendIcon />
              </EmptyMedia>
              <EmptyTitle>No Telegram chats yet</EmptyTitle>
              <EmptyDescription>Add one to get stock alerts from your own Telegram bot.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-4">Name</TableHead>
                  <TableHead>Chat ID</TableHead>
                  <TableHead>Last delivery</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="pr-4">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chats.map((c) => (
                  <TelegramChatRow key={c.id} chat={c} now={now} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
