# Player saves

How and when players are saved, the save history, and rolling players back.

## Backing up

Back up `data/saves/accounts.json` with the saves database and restore them together. It records which characters each account owns, lets alts log in with their primary's password, and keeps deleted character names reserved. See [character slots](./character-slots.md#back-it-up-with-the-saves).

## When a player is saved

Every save records why it happened (`PlayerPersistence.save(player, reason)`):

| Reason | When |
| --- | --- |
| `autosave` | Every 5–10 minutes while online (below) |
| `logout` | Logging out (`Player.onLogout`) |
| `disconnect` | A closed connection, including x-logs; a later logout saves the final state again after combat |
| `shutdown` | A graceful stop or restart: SIGINT (Ctrl+C), SIGTERM, SIGHUP (closing the terminal), SIGUSR2 (nodemon), `::gameUpdate` |
| `tick-error` | Everyone, after a game tick throws |
| `trade` | Both players, after a completed trade |
| `grand-exchange` | A Grand Exchange offer changing |
| `doom`, `colosseum`, `gauntlet` | Starting (and for the Gauntlet, ending) a run, so the fee and items are on disk |
| `saveall`, `save` | `::saveall`, `::save` and other plugin saves |
| `quest-completion`, `diary-tier-completion`, `diary-tier-reward` | Final quest rewards, diary tiers and diary reward claims |
| `death`, `respawn`, `hardcore-death` | Item loss, respawn state and Hardcore downgrade (or, on a [Hardcore World](hardcore-worlds.md), the death that ends the life), after the death operation finishes |
| `hardcore-transfer` | A Hardcore World character transferring: its save copied into the account's main profile (`PlayerPersistence.copyProfile`) |
| `duel-settlement` | Both duelists after stakes, inventory and respawn changes |
| `character-delete` | The history copy taken just before a character is deleted ([character slots](./character-slots.md)) |
| `reward-shop`, `slayer-points` | Non-coin shop purchases and Slayer points spent or earned |
| `bond-redemption`, `bond-conversion`, `bond-transfer` | Bond redemption/conversion and both accounts in a donation |
| `construction`, `wilderness-entry` | Changes to house rooms/furniture, and entering the Wilderness |
| `valuable-item-discard`, `rare-drop` | A stack worth at least 10m coins or a collection-log item; discarded untradeable/restricted items always qualify |
| `collection-log-unlock`, `mystery-box` | A new collection-log item and opening a mystery box |
| `grave-storage`, `death-retrieval`, `death-coffer`, `pet-insurance`, `pet-retrieval` | Death storage, retrieval fees and pet ownership/reclaim |
| `password-change`, `clan-roster`, `staff-punishment` | Password changes, social roster/permissions and account punishment changes |
| `container-reorder`, `bank-tab-collapse`, `bank-placeholder-clear`, `inventory-clear`, `bank-copy` | Container reordering, bank tab/placeholder cleanup and administrative container replacement |
| `achievement-tier-reward` | Claiming Combat Achievement tier rewards |
| `offline-purchase` | An external store using `PlayerPersistence.updateOffline` |

Content requests a save with `api.emitCustomEvent("persistence:save", { player, reason })`.
`SaveEvents` forwards that request to the backend's `requestSave`. Requests in the same operation
share one snapshot, taken after the operation completes, including its item, currency and attribute
changes. The snapshot is captured on the game thread; disk writes remain asynchronous. Shutdown
drains pending requests and waits for player and punishment writes. A failed snapshot or disk write
cancels shutdown and logs an error; the operator must fix the failure and retry. Save reasons are combined when
several events share a snapshot. An ordinary coin purchase or cheap tradeable discard adds no write.

An unfinished trade's snapshot includes the player's offered items, preserving their metadata;
the live trade is unchanged. A disconnect cancels the trade before saving. Completed trades clear
their offers before snapshotting, so received items cannot be counted twice.

`await persistence.updateOffline(username, update, reason)` loads and updates a stored account,
queues the write through the same backend, and waits for completion. `update` is a synchronous
mutation callback. Online accounts are refused: stores must deliver to their live player instead.
No web-store receiver, high-value gambling/dicing system, bank PIN system, generic reward-casket
opener, jail system or collection reward-tier claim system exists in this checkout. When those
features are added, request saving after their successful mutation; use a 10m threshold for gambling.

A hard kill (`kill -9`, a power cut, `wsl --shutdown`) saves nothing; the autosave limits what it loses.

A shutdown save stores players where they stand, without the logout steps, so nobody leaves their area or instance. Content inside an instance must put a player right at their next login.

## The writer thread

The SQLite backend writes on its own thread (`plugins/persistence/SaveWorker.SqlitePlayerPersistence.js`), so the game tick never waits on the disk. A WAL checkpoint's disk flush can take milliseconds on fast disks and much longer on a slow VPS, and it lands in whichever commit triggers it.

- **On the tick,** `save()` only builds the save as compact JSON (about 0.05 ms) and posts it to the writer.
- **On the writer thread:** validation, the hash, gzip, the transaction with the history copy, and pruning. It has the only connection that writes. Rollbacks go through it too, so the game thread never waits for a lock.
- **Saves not yet written** are kept on the game thread; `load()` and `exists()` read them first, so a quick re-login can't load an older save.
- **`flush()`** waits for the writer; shutdown awaits it. It reports a save the writer refused (failed validation) until that player's next save succeeds; the refused save writes nothing, so their previous save stays.
- **If the writer dies,** a new one is started and gets every unanswered save again. After three consecutive startup failures, `flush()` reports failure and queued snapshots stay in memory. The next save retries the worker. Disk writes never fall back to the game thread.
- **A hard kill** loses only what's still queued for the writer: a few milliseconds of saves.
- **Saves are stored without indentation** (loading doesn't care), about half the size.

## The autosave

`plugins/persistence/Autosave.plugin.js` gives each player an interval between 500 and 1000 ticks
(5–10 minutes), distributed deterministically by username. This is the server's save policy.

- **Staggered:** the first autosave is due after 5–10 minutes, with subsequent saves following that player's interval, so a mass login doesn't save everyone on one tick.
- **A budget:** at most 10 autosaves a tick; the rest follow on the next ticks.
- **Bots** are autosaved too, except those marked `bot-skip-persistence` (which no save writes).
- **For testing,** `AUTOSAVE_INTERVAL_TICKS=20 yarn start` shortens the interval.

## The save history

The SQLite backend (`plugins/persistence/SqlitePlayerPersistence.plugin.js`, the default) also keeps a copy of each save in `player_save_history`, in `data/saves/players.sqlite`:

| Column | |
| --- | --- |
| `username` | As in `player_saves` |
| `saved_at` | ISO time (UTC) |
| `reason` | The save's reason, or `pre-rollback` / `rollback` / `character-delete` |
| `save_hash` | SHA-1 of the save JSON |
| `save_gz` | The save JSON, gzipped (about 1.5 KB against 5–6 KB) |

- **Not every save adds a copy:** a save identical to the player's newest copy adds none, and bots' saves add none.
- **Retention**, thinned after each new copy (`SaveHistory.SqlitePlayerPersistence.js`):
  - every copy from the last 24 hours;
  - from 24 hours to 7 days, the newest of each hour;
  - from 7 to 30 days, the newest of each day;
  - nothing older.
- **Deleting a character** ([character slots](./character-slots.md)) first adds a copy with the reason `character-delete`, then re-keys all of that name's history rows to `deleted:<ms>:<name>` in the same transaction, so `::snapshots` and `::rollback` don't show the old character under its name. The name itself is never reused (`accounts.json` keeps it as a tombstone). The rows stay in the database and nothing in game restores them.
- **The JSON and browser (IndexedDB) backends** keep no history; the commands say so.

## Rolling a player back

Owner commands (`plugins/commands/SaveHistory.plugin.js`):

- **`::snapshots <name>`:** their 15 newest copies: `#42  2026-10-07 13:05:12 UTC  autosave`.
- **`::rollback <name> <#id | 30m | 2h | 1d>`:** puts back that copy, or the newest one at least that old.
- A name means the character this world logs in: on a league world the account's league character (`server/docs/leagues.md`), elsewhere the main one.

What a rollback does:
- **Offline player:** their current save goes in the history as `pre-rollback`, then the copy is written (and recorded as `rollback`).
- **Online player:** they're logged out. Their own state goes in the history as `pre-rollback`, and their logout save writes the copy instead. Until they log back in, every save of theirs writes the copy, so a save in between can't undo it.
- **Undoing a rollback:** roll back to the `pre-rollback` copy.

## Rolling everyone back

`yarn saves:rollback` (`scripts/rollback-saves.mjs`), with the server stopped:

```sh
yarn saves:rollback --before 2026-10-07T12:00:00Z            # a dry run: who would change
yarn saves:rollback --before 2026-10-07T12:00:00Z --apply    # do it
yarn saves:rollback --before ... --player "Some name"        # one player
```

- **Each player** gets their newest copy at or before the time. Players without one are left alone and listed.
- **`--apply`** first copies the database to `data/saves/players-before-rollback-<time>.sqlite`, then restores everyone in one transaction, each current save recorded as `pre-rollback`.
- **It refuses to run under a running server:** the SQLite backend writes `players.sqlite.pid` while it has the database open, and the script checks that process. A file left by a crash is ignored.
- **`--database <path>`** (or `PLAYER_SAVE_DATABASE_PATH`) points it at another database.

## What a rollback doesn't cover

- **World files:** `doom-scoreboard.json`, `gauntlet-scoreboard.json`, `accounts.json`, `display-names.json`, `hardcore-world.json` (Hardcore World reset counts), the ban and mute lists.
- **The other side of a trade:** rolling back one player of a trade leaves the other as they are, so items can be duplicated or lost. A whole-server rollback to one time doesn't have this problem.

## Testing

`tests/player-saves.test.cjs`: copies and their reasons, identical saves and bots, retention, offline and online restores, the commands, the autosave's interval, staggering and budget, the script (dry run, refusal under a running server, `--apply`), and the writer thread (a re-login before a write lands, a refused save, a writer that dies).
