# Restock: developer guide

Technical notes for running, changing and extending Restock. For installing
and using the app, see the [README](README.md).

Restock is a Next.js 16 app (App Router, TypeScript) with SQLite through
`better-sqlite3`, Tailwind CSS v4 and shadcn/ui.

```bash
npm run dev     # development server on http://localhost:3000
npm run build   # production build
npm start       # run the production build
npx tsc --noEmit && npm run lint   # typecheck and lint
```

## Configuration and data

Everything is stored in SQLite at `./data/availability.db` (created on first
start). Back up or delete that folder to keep or reset the app.

| Environment variable | Default  | Purpose                                                     |
| -------------------- | -------- | ----------------------------------------------------------- |
| `DATA_DIR`           | `./data` | Folder for the SQLite database                              |
| `DISABLE_SCHEDULER`  | unset    | Set to `1` to stop background checks (UI and manual checks still work) |
| `PORT`               | `3000`   | Port for `npm start` / `npm run dev`                        |

The session cookie is marked `Secure` only when the request arrives over HTTPS
(directly or via `X-Forwarded-Proto` from a reverse proxy), so plain-HTTP access
on a home network works.

## How it works

- `src/instrumentation.ts` starts the background checker when the server
  starts. Every 15 seconds it looks for products whose last check is older than
  the interval and checks them one by one, 1.5 s apart, to go easy on the
  store.
- `src/lib/stores/germanos.ts` uses the same JSON endpoints the germanos.gr
  site uses in the browser:
  - `/api/search/general?q=…` for search (it only accepts page sizes 12 or 24),
  - `/api/product/{id}/details`, where
    `deliveryAvailability.stockBySkuId[sku].availabilityStatus` holds the real
    stock status (`ΔΙΑΘΕΣΙΜΟ`, `ΧΑΜΗΛΗ ΔΙΑΘΕΣΙΜΟΤΗΤΑ`, `ΜΗ ΔΙΑΘΕΣΙΜΟ`,
    `ΕΞΑΝΤΛΗΜΕΝΟ`, `ΠΡΟΠΑΡΑΓΓΕΛΙΑ`, `ΠΡΟΣΕΧΩΣ`, `BACKORDER`).
  The server-rendered product page always says "in stock", so it isn't used.
  The details endpoint only answers for a product's main ID, not for a colour's
  SKU. A pasted link to a colour is resolved to its parent through search, and
  each tracker stores that parent ID (`lookup_id`).
- `src/lib/stores/kotsovolos.ts` (product codes are six digits, e.g. `341593`):
  - Search uses the site's own `/api/search/constructorSearch` for the matching
    codes, then `/api/ext/getProductDetailsByPartNumbers` (max 50 per call) for
    names, prices and links. That data comes from the search index, which can
    lag, so the status shown in search comes from `/wcs/shop/ProductDataView`
    instead: the live data the site's own product lists use (`callToAction`,
    the delivery code and text, `lastPieces`; ~1.5 KB per product, 30 per call).
    It agrees with the product page that checks read.
  - Kotsovolos ranks everything that can be ordered first and out-of-stock
    products after it (for "nintendo switch 2", from about page 9 of 27), and
    its sort options can't change that. So search also binary-searches the
    pages for where out-of-stock products start and adds the 12 most relevant
    ones. Results come in groups: "Available" (in stock only), "On order"
    (can be ordered, ships later) and "Out of stock". A broad search takes
    about 3 seconds this way.
  - Checks read the live product page's `__NEXT_DATA__` →
    `pageProps.availabilityData`, the same data that drives the buy button:
    `ctaNameTextKey` (`BUY_BTN`, `PREORDER_BTN`, `NOT_AVAILABLE`,
    `CHECK_OUT_THE_STORES`) says whether it can be ordered online, and
    `availableStatusKey` adds the detail (`IMMEDIATELY_AVAILABLE`,
    `LAST_PIECES`, `ON_ORDER`, `SPECIAL_ORDER`, `EXPECTED_SOON`, …). A buy
    button with `EXPECTED_SOON` or `ON_ORDER` means it can be ordered but ships
    later, so it counts as backorder, not in stock. Kotsovolos doesn't expose
    unit counts.
  - Product pages are cached by Akamai, so each check adds a throwaway `_=`
    query parameter to get a fresh copy. Each tracker stores the product page
    path (`lookup_id`) to skip the `ProductDisplay?partNumber=` redirect.
  - Colours are separate products at Kotsovolos, so there are no options to
    pick. "Check the stores" (not orderable online) counts as out of stock.
- `src/lib/stores/public.ts` (product codes are seven digits and may start
  with 0, e.g. `2164264`, `0681288`):
  - No search by name. public.gr's search runs on a third-party service
    (Constructor.io) from the browser, and there's no search on public.gr
    itself, so products are added by pasting their link or code.
  - Checks call `/public/v1/mm/stockRules?skuId=…`, which isn't cached.
    `rules[0].deliveryRule.allowPurchases` says whether it can be ordered
    online; `uponOrder`, `preOrder`, `inStock` and `displayText` add the detail
    ("Άμεσα Διαθέσιμο", "Διαθέσιμο με παραγγελία", "Κατόπιν Παραγγελίας",
    "Αγορά μόνο από κατάστημα", "Προσωρινά Εξαντλημένο"). Units come from
    `totalAtp`. "Buy in store only" counts as out of stock.
  - Name, link and picture come from `/public/v2/sku/{code}`. It's cached at
    the CDN, so its own `availability` text isn't used.
- `src/lib/stores/plaisio.ts` (product codes are seven digits, e.g. `5520428`):
  - Checks call `/api/availability/product/{code}`, which lists each way to
    get the product (`Delivery`, `PickupFromLocker`, `PickupInStore`,
    `BuyInStore`) with `isAvailable` and a code. Delivery/locker codes map to
    the site's own texts: `D01` Μη διαθέσιμο, `D02` Εξαντλήθηκε, `D03`
    Τελευταία Τεμάχια, `D04` Διαθέσιμο, `D05/06` Προπαραγγελία, `D07/08`
    Κατόπιν Παραγγελίας, `D09/10` Αναμένεται, `D11–14` Διαθέσιμο εντός N
    ημερών. "Order online, pick up in store" counts as in stock; "buy in
    store" alone counts as out of stock. Plaisio doesn't expose unit counts.
  - That endpoint is cached at Vercel's edge for up to 2 minutes, and a
    cache-busting parameter doesn't get around it, so a restock can show up
    to 2 minutes late.
  - The page's JSON-LD always says `InStock` and the search data's
    `sortByAvailability` doesn't track stock, so neither is used.
  - Name, price and link come from `/api/referenced-product/{code}`.
  - Search reads the result list that plaisio.gr's own search page sends in
    its Next.js data stream (`/search?query=…` with the `RSC: 1` header), then
    asks the availability endpoint for each result. Like the site, it falls
    back to similar products when nothing matches the words.
  - Colours are separate products at Plaisio, so there are no options to
    pick. The logo is Plaisio's red-circle brand mark, redrawn as an SVG.
- Status changes are written in an immediate SQLite transaction, so a
  scheduled check and a "Check now" on the same product can't both send the
  same notification.

## Notifications

`notifyAvailabilityChange()` in `src/lib/notifications.ts` sends each stock
change to Discord and Telegram at once. Each records its own last delivery and
error per destination (shown in Settings), so one failing never stops the
other.

- **Discord** (`src/lib/notifications.ts`): webhook posts with an embed. Only
  back-in-stock alerts may ping `@everyone`, and only for webhooks with that
  switch on.
- **Telegram messages** (`src/lib/telegram.ts`): the user's own bot, through
  the Bot API's `sendMessage` with HTML formatting, the product picture as a
  small link preview (`link_preview_options`) and an "Open on <store>" button.
  Sold-out alerts are sent with `disable_notification`. The bot token stays on
  the server; Settings only gets the chat ID.
  - **Find** in the Add chat dialog calls `getMe` and `getUpdates` to list the
    chats that pressed Start or added the bot in the last 24 hours. Reading
    updates without an `offset` doesn't use them up. It must not pass
    `allowed_updates`, which would change the bot's settings. A bot with a
    webhook set answers `getUpdates` with 409, and the user types the ID.
  - When a group is upgraded to a supergroup, Telegram answers with
    `migrate_to_chat_id`; the new ID is saved and the message resent.
  - A 429 is retried once after `retry_after` (at most 10 s).

## Adding a store

1. Create `src/lib/stores/<store>.ts` exporting an object that implements
   `StoreAdapter` from `src/lib/stores/types.ts`:
   - `id`, `name`, `homepage`, `logo`, `searchPlaceholder`, and `searchable`
     (set it to `false` if the store can only be searched by link or code;
     the Add product dialog then shows a warning).
   - `parseProductRef(input)`: the product code from a pasted link or code,
     `null` for a search query, or throw `StoreError` for a link to something
     that isn't a product.
   - `search(query)`: results with a status each. They can set `section` to
     group results (see Kotsovolos).
   - `getProduct(code)`: the product and its options (colours, bundles).
   - `checkProduct(code, lookupId)`: the current state of one tracked option.
     `lookupId` is whatever the adapter returned last time, saved with the
     tracker (e.g. a parent product ID or page path).
   - `rawResponse(code, lookupId)`: the store's unparsed data, for the *View
     API response* popup.

   Map the store's wording to the shared `StockStatus` values in
   `src/lib/status.ts`. Use `isOrderableStatus()` when you need "can be
   ordered", and set `available` with `isAvailableStatus()` (in stock or low
   stock only). Throw `StoreError` with a message the user can act on; it is
   shown in the UI as is. `fetchStoreJson` and `fetchStorePage` in
   `src/lib/stores/http.ts` handle timeouts, bot-check pages and HTTP errors.
2. Put a square logo (PNG or SVG, at least 64×64) in `public/stores/` and set
   the adapter's `logo` to its path, e.g. `/stores/<store>.png`.
3. Add it to the `STORES` list in `src/lib/stores/index.ts`.

It then appears in the sidebar and in the store picker of the Add product
dialog.

## UI components

The interface is built from [shadcn/ui](https://ui.shadcn.com) components
(Radix base) in `src/components/ui/`: Sidebar, Card, Table, Tabs, Select,
Dialog, AlertDialog, DropdownMenu, Field, Switch, Badge, Empty, Sonner toasts
and so on. Add more with `npx shadcn@latest add <name>`; to avoid the CLI
overwriting `button.tsx` and `dropdown-menu.tsx` (they add a pointer cursor),
answer "no" when it asks.

The theme in `src/app/globals.css` is shadcn's neutral palette, light and
dark following the system setting, plus `status-*` colours for stock badges.
The font is Inter, with JetBrains Mono for the JSON viewer; both include Greek.
