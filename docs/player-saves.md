# Player saves

How and when players are saved, the save history, and rolling players back.

## When a player is saved

Every save records why it happened (`PlayerPersistence.save(player, reason)`):

| Reason | When |
| --- | --- |
| `autosave` | Every 15 minutes while online (below) |
| `logout` | Logging out (`Player.onLogout`) |
| `shutdown` | A graceful stop or restart: SIGINT (Ctrl+C), SIGTERM, SIGHUP (closing the terminal), SIGUSR2 (nodemon), `::gameUpdate` |
| `tick-error` | Everyone, after a game tick throws |
| `trade` | Both players, after a completed trade |
| `grand-exchange` | A Grand Exchange offer changing |
| `doom`, `colosseum`, `gauntlet` | Starting (and for the Gauntlet, ending) a run, so the fee and items are on disk |
| `saveall`, `save` | `::saveall`, `::save` and other plugin saves |

A hard kill (`kill -9`, a power cut, `wsl --shutdown`) saves nothing; the autosave limits what it loses.

A shutdown save stores players where they stand, without the logout steps, so nobody leaves their area or instance. Content inside an instance must put a player right at their next login.

## The writer thread

The SQLite backend writes on its own thread (`plugins/persistence/SqliteSaveWorker.js`), so the game tick never waits on the disk. A WAL checkpoint's disk flush can take milliseconds on fast disks and much longer on a slow VPS, and it lands in whichever commit triggers it.

- **On the tick,** `save()` only builds the save as compact JSON (about 0.05 ms) and posts it to the writer.
- **On the writer thread:** validation, the hash, gzip, the transaction with the history copy, and pruning. It has the only connection that writes. Rollbacks go through it too, so the game thread never waits for a lock.
- **Saves not yet written** are kept on the game thread; `load()` and `exists()` read them first, so a quick re-login can't load an older save.
- **`flush()`** waits for the writer; shutdown awaits it. It reports a save the writer refused (failed validation) until that player's next save succeeds; the refused save writes nothing, so their previous save stays.
- **If the writer dies,** a new one is started and gets every unanswered save again. If it dies three times in a row before it's ready, saves are written on the game thread instead, as before this change.
- **A hard kill** loses only what's still queued for the writer: a few milliseconds of saves.
- **Saves are stored without indentation** (loading doesn't care), about half the size.

## The autosave

`plugins/persistence/Autosave.plugin.js` saves each online player every 15 minutes (1500 ticks). OSRS does the same: a crashed world puts players back to their save from up to 15 minutes before ([Server crash glitch](https://oldschool.runescape.wiki/w/Server_crash_glitch)).

- **Staggered:** a player's first autosave falls somewhere in their first 15 minutes, spread by their name, so a mass login after a restart doesn't save everyone on one tick.
- **A budget:** at most 10 autosaves a tick; the rest follow on the next ticks.
- **Bots** are autosaved too, except those marked `bot-skip-persistence` (which no save writes).
- **For testing,** `AUTOSAVE_INTERVAL_TICKS=20 yarn start` shortens the interval.

## The save history

The SQLite backend (`plugins/persistence/SqlitePlayerPersistence.plugin.js`, the default) also keeps a copy of each save in `player_save_history`, in `data/saves/players.sqlite`:

| Column | |
| --- | --- |
| `username` | As in `player_saves` |
| `saved_at` | ISO time (UTC) |
| `reason` | The save's reason, or `pre-rollback` / `rollback` |
| `save_hash` | SHA-1 of the save JSON |
| `save_gz` | The save JSON, gzipped (about 1.5 KB against 5–6 KB) |

- **Not every save adds a copy:** a save identical to the player's newest copy adds none, and bots' saves add none.
- **Retention**, thinned after each new copy (`SqliteSaveHistory.js`):
  - every copy from the last 24 hours;
  - from 24 hours to 7 days, the newest of each hour;
  - from 7 to 30 days, the newest of each day;
  - nothing older.
- **The JSON and browser (IndexedDB) backends** keep no history; the commands say so.

## Rolling a player back

Owner commands (`plugins/commands/SaveHistory.plugin.js`):

- **`::snapshots <name>`:** their 15 newest copies: `#42  2026-10-07 13:05:12 UTC  autosave`.
- **`::rollback <name> <#id | 30m | 2h | 1d>`:** puts back that copy, or the newest one at least that old.

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

- **World files:** `doom-scoreboard.json`, `gauntlet-scoreboard.json`, the ban and mute lists.
- **The other side of a trade:** rolling back one player of a trade leaves the other as they are, so items can be duplicated or lost. A whole-server rollback to one time doesn't have this problem.

## Testing

`tests/player-saves.test.cjs`: copies and their reasons, identical saves and bots, retention, offline and online restores, the commands, the autosave's interval, staggering and budget, the script (dry run, refusal under a running server, `--apply`), and the writer thread (a re-login before a write lands, a refused save, a writer that dies).
