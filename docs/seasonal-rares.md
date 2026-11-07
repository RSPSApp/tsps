# Seasonal rares

A **server feature**, not OSRS behaviour. Live OSRS no longer hands out the discontinued rares
(partyhats, halloween masks, Santa hat and so on). This world can give them out during its own
event windows, and what it gives is set by data, not code.

Plugin: `server/plugins/events/SeasonalRares.plugin.js`. Data: `server/plugins/events/data/seasonal-rares.json`.

## What players see

While a rare's event window is open, `::rares` opens a chat menu of the rares that player can still
claim, e.g. "Santa hat (1 left for you)", with Cancel on every page and "More..." when they need
more than one. Picking one puts it in the inventory. Logging in during a window, or being online when one opens, gives a one-line notice.
Outside every window `::rares` says nothing is being given out.

Claims are refused on a league character ("Seasonal rares can only be claimed on your main
character.") and while the player is in an area (minigames such as LMS and the Gauntlet replace the
inventory on exit), busy or in combat ("You can't claim a seasonal rare right now.").

## Shops no longer sell the event rares

No shop stocks a configured rare, so the event window is the only source. The `::shops` Rares Shop
(`custom-shops.json` id 23) no longer lists them; it keeps the rares that have no row here (black and
rainbow partyhat, black h'ween mask, disk of returning), and its panel icon is now the black partyhat.
Adding a rare to the list means taking it out of any shop that stocks it, in the shop data itself.

## Configuring a rare

One row per rare:

```json
{
  "key": "christmas-santa-hat",
  "event": "christmas-2025",
  "item": "santa_hat",
  "id": 1050,
  "enabled": true,
  "perAccount": 1,
  "stock": null,
  "source": "Wiki Santa hat: current source is completing the Christmas holiday events."
}
```

| Field | Meaning |
| --- | --- |
| `key` | Unique lowercase name. Claims are counted against it. |
| `event` | An EventScheduler key from `server/plugins/world/data/events.json`. The rare is offered only while that event is active. |
| `item`, `id` | The cache obj symbol and its id. At startup the row is skipped (and logged) unless `CacheDefinitions.getObjId(item) === id` and the item is tradeable. |
| `enabled` | `false` turns the row off without touching the calendar. |
| `perAccount` | How many one account may claim, over every window of that event. |
| `stock` | World-wide cap for the row, or `null` for none. |
| `source` | Where the event association comes from (Wiki "current source" line). |

There is no price or drop rate: rares are claimed, not bought, and quantities are config values.
The shipped quantities (`perAccount: 1`, `stock: null`) are this server's policy, not historical
figures; the Wiki states no distribution numbers.

Shipped rows: the six partyhats, Christmas cracker and Santa hat on `christmas-2025`; the green, blue and
red halloween masks and the pumpkin on `halloween-2025`; the Easter egg on `easter-2026`; the half full
wine jug on `anniversary-2026` (a birthday reward since 2020). Not shipped: the disk of returning (a
Midsummer reward, and there is no Midsummer window) and the untradeable black h'ween mask and
black/rainbow partyhats.

## Turning windows on and off

All of this is data or a command; none needs a code change.

- Calendar: edit the event's `windows` (or `enabled`) in `events.json`, then restart.
- Testing: `::forceevent <key> on|off|auto` (owner), `::forceevent reset` restores the calendar.
- One rare: set its row's `enabled` to `false`, then restart.

The window is asked of the scheduler (`events:status`) when the menu opens and again when a rare is
picked, so a menu left open across a close grants nothing.

## Claims and persistence

- Claims are keyed by row, so an event's later windows (Christmas 2025 then 2026) share one
  allowance. To give a rare again in a new year, add a new row with a new `key`.
- Two records, and the larger count wins: the account's `seasonal-rares:claims` attribute (saved with
  the player, a save is requested on each claim) and the world file `server/data/saves/seasonal-rares.json`
  (`{ key: { claimed, by: { username: count } } }`, written atomically, gitignored). The world file
  enforces `stock` and stops a re-claim after a player-save rollback.
- The world file is written first. If that write fails (disk full, permissions, a locked file), the
  player gets "That rare can't be claimed right now. Please try again later." and nothing is given or
  recorded. A crash after the write but before the player save lands can lose a claimed rare, but
  never duplicate one.
- The world file is read at startup and written whole; two server processes must not share one
  `data/saves` directory.
- A full inventory refuses with "You don't have enough inventory space to take that." and records nothing.
- The plugin spawns no NPCs, objects or shop stock, so a window closing or a shutdown leaves nothing to clean up.

## Relation to the holiday reward helper

PR #2628 adds `events:grant-reward`, a once-per-account helper for the holiday events, which keeps
completion keys in the player's `events:completions` attribute. It has no counts or stock caps, so
this plugin keeps its own records. If #2628 merges and single-claim rows move onto it, existing
claims carry over like this:

1. **Import on login.** For every row the account has already claimed (`claimedBy` of 1 or more,
   from either record), emit `events:record-completion` with
   `{ player, completion: "seasonal-rares-<row key>" }`. That event is idempotent and ignores the
   window, so it can run on every login. Nothing is given.
2. **Keep the world file.** `events:completions` is saved with the player, so it rolls back with the
   player save. The world file stays the rollback guard and the `stock` counter, and is still
   written before anything is given.
3. **Claim through the helper only for `perAccount: 1` rows with no `stock`.** Write the world
   record first, then call `events:grant-reward` with the same completion key and the row's item.
   If it returns `granted: false` (`no-space`, `already-complete`, `inactive`), restore the previous
   world record. Rows with `perAccount` above 1 or a `stock` cap stay on this plugin's own records,
   because the helper cannot count.
4. **Leave the old records.** `seasonal-rares:claims` and the world file are still read (the larger
   count wins), so an account whose login import has not run yet still cannot claim again.

Tests: `server/tests/seasonal-rares.test.cjs`.
