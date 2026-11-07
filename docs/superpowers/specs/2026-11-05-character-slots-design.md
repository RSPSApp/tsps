# Per-server character slots — design


**Implementation update:** Characters is now a disabled-by-default server plugin using generic login-extension hooks. Enable `plugins.Characters`; its character limit defaults to 6 and is capped at 6. Configuration alone never enables it. See [current behavior and setup](../../character-slots.md).
Date: 2026-11-05. Status: draft for approval. Target repo: RSPSApp/tsps.

## Intent

A player on one tsps server makes a character and gears it up. Later they want a second
character. Today that means a second login name and a second password. This design lets one
login own several characters on that server: after the password, the player sees their
characters and picks one, or makes a new one. Logging out returns to the login screen, so
switching is log out, log in, pick.

Everything is per server. Another server knows nothing about these characters. This has no
relation to RuneLite remembered login (PR #2693) or the OSRS account import tool (PR #2683),
except that both keep working: #2683 fills any one character by name, and #2693's login
ticket could later carry a chosen character name.

## Goals

- One login (the name and password typed at the login screen) owns up to N characters on the
  server, N set by the host.
- After a successful login the browser client shows a character screen: the characters, one
  empty slot labelled New character, Play as the primary button, and Delete.
- Existing players see no change to what they own. Their one character is the first slot and
  keeps its name, save, friends, clan, bans and display name.
- Every other client (native RuneLite through the gateway, headless bots, the agent MCP) keeps
  working with no change: it enters the character whose name was typed, the primary included.
- The feature is content a host can turn down to one slot.

## Non-goals

- Cross-server anything. No shared accounts between servers.
- A character picker for the native RuneLite client. Native enters the typed character;
  choosing on native is future work on the gateway (see "Later").
- Sharing a bank, coins or items between an account's characters.
- Renaming a character (the existing `::displayname` covers display names).
- A separate sign-up flow. The first login with an unused name still creates the account.
- Moving credentials out of saves into an account table. See "Credentials" for the v1 rule.

## Anti-goals (a failure even if it works)

- Any existing player logging in and landing in a different character than before.
- A save becoming unreachable, or deleted without a history snapshot where the backend has one.
- Two characters of one account online at the same time.
- A name claimable twice (two accounts, or a character and a login name, sharing a name).
- Any change to what old browser clients, the gateway or bots see on the wire unless they ask
  for it.

## Constraints (from the code as it is on main at a45597729)

- The username is the identity everywhere: SQLite primary key `player_saves.username`, save
  history, friends and ignores (base-37 of the name), clans (`accountOf`), `World.getPlayerByName`
  (about 50 callers), punishments (`Bans.txt`, `Mutes.txt`), display names, ground-item ownership,
  raid and minigame state, admin commands. None of this changes. See "Identity".
- Credentials (password hash) and remembered-login tokens live inside a character's save. The
  existing rule is "the main profile's save holds the account credential".
- Login is already two packets. `login` (204) authenticates and stores `pending`; `handshake`
  (202) runs `enterWorld` and builds the Player. Nothing exists yet between them.
- `LOGIN_RESPONSE` (3) is a variable-byte packet capped at 255 payload bytes. A character list
  does not fit in it.
- The gateway sends login `flags = 0` and sends `handshake` the moment it sees login OK. The
  native client is told Ok only after the handshake. Plugin messages are dropped before a Player
  exists.
- The browser login screen is a Canvas2D state machine (`client/game/login/`), with
  `LoginIndex` stages, draw functions per stage, click handlers in `mouseHandlers.ts`, keys in
  `keyboard.ts`, duplicated input loops for WebGL and WebGPU, and two redraw hashes that must
  include any new state.
- `PlayerProfile = "main" | "league"` already gives each name a second save keyed `league:<name>`.
  The world picks the profile; the player does not.
- `isNewAccount` (= no save at handshake) drives Makeover, Tutorial Island, the welcome screen,
  league setup and one quest.
- Server rules (`server/AGENTS.md`): foundations in core (networking, lifecycle, packets),
  gameplay in plugins, plugins reach core through `api.core`, persisted attributes declared once
  and kebab-cased, ids from cache dumps, no new smoke scripts.

## Decisions

### Identity

An **account** is the name typed at the login screen, normalised the way login names are today
(`account key`). A **character** is an ordinary player with its own unique name and its own save,
exactly as every player is today. The account's first character has the account's name; it is the
**primary** character.

Consequence: `Player.getUsername()`, `getLongUsername()`, `getDisplayName()`, the save key, the
profile key, friends, clans, bans, display names and every name-keyed system see a normal player
with the character's name. Nothing there changes. The account name exists only in `login()` and
in the new account record.

Names share one namespace. A name is taken if any of these hold: a save exists for it in any
profile; it is a character of any account (entered or not); `DisplayNames.ownerOf` returns another
account, or it is held; it is a pending login or online. `DisplayNames.loginNameInUse` and
`DisplayNames.refusal` are the one place that answers this today (login, `::displayname`, the AI
bot roster all go through them); they gain the account-record check, so a created-but-never-entered
character cannot be taken as a display name or a bot name. Offline bot names are not reserved
against logins today and that stays as it is.

Logging in by typing a non-primary character's name resolves to its account: the password is the
account's, and the picker opens with that character preselected. This keeps "I typed my character
name" working for anyone who thinks of characters as logins.

### Account record

A new core module `Accounts` (`server/src/main/typescript/elvarg/game/entity/impl/player/Accounts.ts`)
modelled on `DisplayNames`: an in-memory map backed by one JSON file, `data/saves/accounts.json`
(env `TSPS_ACCOUNTS_FILE`), written atomically.

```
{ "accounts": { "<account key>": {
    "createdAt": <ms>,
    "characters": [ { "name": "<as first typed>", "createdAt": <ms>, "lastPlayedAt": <ms> } ]
} },
  "deleted": { "<name key>": { "name": "<as the account had it>", "account": "<account key>", "deletedAt": <ms> } } }
```

`deleted` holds a tombstone for every deleted character. A file without it (written before
tombstones) loads with none.

Order of `characters` is slot order; index 0 is the primary. A reverse index (character key to
account key) is rebuilt on load. The record is created lazily: the first time an existing login
name authenticates after this ships, an account with that one character is written. A brand-new
name (no save) is written only when it first enters the world (`enterWorld`); until then its one
character exists in memory, so a login that never enters claims no name. There is no migration
step and nothing to run for hosts.

`lastPlayedAt` updates in memory on `enterWorld`. So that a world entry doesn't rewrite the
whole file on the game thread, it is written at most once every 30 s (an unref'd timer), with the
next structural write (ensure, add, remove), or by `Accounts.flush()` in the graceful shutdown,
whichever comes first; a crash can lose up to 30 s of last-played times and nothing else. Exposed to plugins as `api.core.Accounts` (read-only
queries: `accountOf(name)`, `charactersOf(accountKey)`).

Durability, my call: the file lives next to `display-names.json` and has the same assumptions,
one server process per data directory (the SQLite pid file already assumes this) and a durable
disk. The original in-browser host (IndexedDb backend) did not persist account ownership
across reloads and was limited to one character. Follow-up: browser hosts that checkpoint
`data/saves/accounts.json` (or `TSPS_ACCOUNTS_FILE`), character saves and profile deletions
together may advertise `BROWSER_HOST_ACCOUNT_PERSISTENCE=1` and use the configured limit
(up to six). Hosts without that capability remain limited to one. See
[the current host requirements](../../character-slots.md#enabling-characters).

Hosts must back up and restore the file together with the saves database: it is the only record
of ownership, the alts' credentials resolve through it to the primary, and it holds the
tombstones. An unreadable file refuses every login and logs an operator message naming it; a
missing one starts empty.

### Credentials

Unchanged location, new wording: the **primary character's** saves hold the account's
credentials exactly where one character's saves hold them today. The password hash comes from the
primary's main-profile save, with the existing league-save fallback when no main save exists.
Remembered-login tokens stay on the primary's save for the **world's profile** (the league save on
a league world), so tokens issued before this ships keep working. `login()` loads the primary's
saves for credentials where it loads `main`/`save` today; token issue, rotation and `login_forget`
work on those saves. `changePassword` writes the live character's save and then every other save
of every character of the account (both profiles) offline through `updateOffline`, each with the
new hash and its remembered logins cleared. The account's other characters are offline (one
online at a time). An alt's save keeps a copy of the hash on purpose: if `accounts.json` were
lost, an alt with an empty hash would open with any password (an empty stored hash reads as a new
account), so the copy is kept and never left stale.

**Creation requires the primary to have a save.** A brand-new account has no save until its first
handshake; until then `CHARACTER_CREATE` is refused (code 9, "Enter the world once with your first
character") and the client greys the New slot with that text. This guarantees the credential save
exists before any other character can, and that a remember-me token issued on a first login lands
on the primary.

Because the primary save is the credential, **the primary character cannot be deleted**. The
picker shows Delete greyed for slot 0 with the reason. This is my call for v1 to avoid moving
credentials; revisit if it bites.

### Online rule

One account online at a time. `login()` refuses with code 5 (already logged in) when any character
of the account is online, in the add queue, or when the account key is pending. `pendingNames`
reserves the account key; the chosen character's key is reserved too once selected, so a second
connection cannot select the same character.

### Protocol

Clients opt in. New login flag `LOGIN_FLAG_CHARACTER_SELECT = 4` in the existing flags byte. The
gateway (flags 0), old browser clients and headless logins never set it and see no character-list/result packets.
An enabled Characters plugin (cap above 1) first announces support with a `characters:slots` plugin
message (opcode 6, `{ maxPerAccount }`) before the welcome; the client sets flag 4 only after that
announcement on the current connection, so a disabled or older server never sees it.

Server to client (only when the flag was set):

- `CHARACTER_LIST` (new id, variable-short): `u8 maxCharacters`, `u8 defaultIndex`, `u8 count`,
  then per character `string name`, `u8 combatLevel`, `u16 totalLevel`, `i64 lastPlayedAtMs`,
  `u8 flags` (bit 0 primary, bit 1 has a save on this world's profile). Sent right after a
  successful `LOGIN_RESPONSE`, and again after every create or delete. `defaultIndex` is the
  typed character if the player typed a non-primary name, else the last played, else 0, never a
  banned character.
- `CHARACTER_RESULT` (new id, variable-byte): `u8 ok`, `u8 code`, `string message`. Codes: 1 name
  taken, 2 invalid name, 3 slot limit reached, 4 unknown character, 5 primary cannot be deleted,
  6 confirmation did not match, 7 character online, 8 storage error, 9 primary has not entered
  the world yet, 10 character banned (a `CHARACTER_SELECT` of a banned character, or a
  `CHARACTER_CREATE` on an account whose primary is banned), 11 too many deleted characters (a
  `CHARACTER_DELETE` when the account already holds `MAX_TOMBSTONES_PER_ACCOUNT` deleted names).
  The client shows the server's message for every code, so a new code needs no client change.

Client to server, accepted only between login OK and handshake (added to `IMMEDIATE_PACKETS`,
refused with `CHARACTER_RESULT` code 4 otherwise):

- `CHARACTER_SELECT`: `string name`. Sets `pending.character` and loads that save for the world's
  profile.
- `CHARACTER_CREATE`: `string name`. Validates (same rules as a login name: 1–12 chars,
  `Misc.isValidName`, base-37 safe), checks the shared namespace and the cap, appends to the
  account, replies `CHARACTER_RESULT` then `CHARACTER_LIST`. Creation writes no save; the first
  handshake as that character is a normal new-player entry.
- `CHARACTER_DELETE`: `string name`, `string confirmName`. Refused for the primary, for an online
  character, or when `confirmName` differs from `name` case-insensitively. Otherwise: a history
  snapshot with reason `character-delete` where the backend supports history, then the save is
  removed for every profile, and the character is removed from the account and its name
  tombstoned in the same write. The tombstone records the deleting account. The name is not
  claimable by anyone else: display names, clan ranks and punishments are keyed by it and are not
  released, so the tombstone keeps them unreachable. Login (a brand-new name), another account's
  `CHARACTER_CREATE` and `DisplayNames.loginNameInUse` (display-name changes) all refuse a
  tombstoned name. The deleting account may `CHARACTER_CREATE` it again (its own identity
  returns to it), which removes the tombstone in the same write. To bound reservation, an
  account holds at most `MAX_TOMBSTONES_PER_ACCOUNT = 6` tombstones; a delete beyond that is
  refused with code 11 before any save is touched. Staff free a name with `::releasename`
  (`Accounts.releaseDeleted`). Tombstones written before the account was recorded load with an
  empty account and are claimable by nobody until released.
  Replies `CHARACTER_RESULT` then `CHARACTER_LIST`.

`handshake` with no prior select enters the default character. With the flag that is the
`defaultIndex` rule. Without it (the gateway, bots, the agent MCP and old clients) it is the
typed character, the primary included, so those clients always reach every character by typing
its name, and an existing player keeps landing on the character they typed. `enterWorld` sets username, long
username and display name from the chosen character and applies that character's save.

Reconnect: the browser client remembers the character it entered and, on automatic re-login,
sends `CHARACTER_SELECT` for it before `handshake`.

### Persistence

New abstract `PlayerPersistence.delete(username, profile): Promise<void>` implemented by the
SQLite (row delete, worker thread, history snapshot first), JSON (file unlink), IndexedDb and Null
backends. Save keys are unchanged.

`PlayerSaveSnapshot` reasons gain `character-delete`. The SQLite delete also re-keys that character's history rows from `<key>` to
`deleted:<ms>:<key>` in the same worker transaction, so `::snapshots`/`::rollback` on the name
never show or restore the deleted character. The rows stay for an admin with
database access; there is no in-game restore of a deleted character.

### Configuration

`pluginConfig["characters:maxPerAccount"]`, integer, default **6** when the Characters plugin is enabled, read
through `PluginManager.getPluginConfig`, rounded down and clamped to 1..6 (the picker draws six legible
rows); a non-numeric value falls back to 6. The plugin must be enabled with `plugins: { "Characters": true }`; this limit alone cannot enable it. A value of 1 disables creation and skips the picker: the
typed character enters, as on the gateway and native clients, so an alt left from a higher cap never
hides the primary. Documented in `docs/character-slots.md`.

### New character entry

Creation adds the name to the account and nothing else. The first `handshake` as that character
finds no save, so `isNewAccount` is true and Makeover, Tutorial Island (where enabled), league
setup and the welcome-screen skip all behave as for a brand-new login today. The event field keeps
its name; its doc comment says "no save existed for this character".

### Punishments

`Bans.txt` stays per name. `login()` checks the ban list for the typed name as today, and
`CHARACTER_SELECT` (and the default pick at handshake) checks the chosen character's name; either
hit refuses with the existing code 4 path. The default character is never a banned one.

A banned primary bans the whole account (my call, the conservative reading): once `login()` has
resolved the primary, it refuses with code 4 ("Your account has been disabled.") when the primary
is banned, whichever character's name was typed, and `CHARACTER_CREATE` refuses with code 10 when
the primary is banned (a ban that lands while the account sits on the picker). Banning an alt
bans only that alt. Mutes stay per character. Banning every character of an account from `::ban`
is a follow-up; not in this PR.

### League worlds

The picker lists the account's characters on a league world too. Selecting one loads its
`league:` save; a character with no league save is a new league character, as today. Credentials
still come from the primary's main save, with the existing fallback when no main save exists.

### Browser client

New `LoginIndex.CHARACTER_SELECT` stage, drawn inside the 360x200 titlebox in classic 765x503
content space, following the remembered-login Play screen pattern (new `LoginAction` types,
`LoginActions` constants, a draw function and geometry constants, a click handler, a router case,
a `processLoginAction` case, `LoginState` fields, the title redraw hash `computeTitleStateHash`,
`keyboard.ts`).

Layout, my call, tweakable: title "Choose your character" at the title line; up to N rows of
24 px (N = `maxCharacters`, so 3 rows at the default) plus one New character row, each row a flat
card like the server-list overlay rows: name on the left, "Cmb 85 · Total 1203" and "Played 2d ago"
on the right, the selected row highlighted; below the rows a `titlebutton_large` Play with the
selected name under it; small `titlebutton`s Delete and Sign out at the bottom line. Hover is
added for rows the way the server list has it.

New character: clicking the empty row turns it into a name field (reusing the login-form field
drawing and the same key handling: letters, digits, space, Backspace, Enter sends
`CHARACTER_CREATE`, Escape is not available so a Cancel button is drawn). Errors from
`CHARACTER_RESULT` show in the response line. Delete: Delete turns the selected row into a
"type the name to confirm" field with Confirm and Cancel.

Flow: login success keeps `gameState` CONNECTING, shows the stage, and holds the handshake until
Play (or Enter). Play sends `CHARACTER_SELECT`, waits for `CHARACTER_RESULT` ok, then
`sendHandshake` as today. The remembered-login Play screen leads here too, so a returning player
is one Enter from the world. Sign out returns to the login form and drops the connection.

Mobile: the hidden DOM input is extended to the two text fields of this stage.

### Native, bots, MCP, tools

No behaviour change. The gateway's `TspsLoginResult.decode` already ignores trailing fields and
never sets the flag, so it never receives the new packets. One mechanical edit is required: the
gateway's `TspsServerPacket` table mirrors `ServerPackets.ts` and `TspsServerPacketTest` fails on
drift, so the two new server packet ids are added there. `connectHeadlessClient` and the MCP
`login` tool enter the typed character. The import tool from #2683 targets a character by name
and is unaffected.

### Admin

`::characters <name>` (developer rank) prints the account's characters with last played times,
through `api.core.Accounts`. Read-only. `::releasename <name>` (administrator rank) removes a
tombstone through `Accounts.releaseDeleted`, so the name can be taken again (with whatever is
still keyed by it).

### Tests

Server (`server/tests`, extend the login harness in `login-tokens.test.cjs` or a sibling
`character-slots.test.cjs`): account created lazily on first login; list sent only with the flag;
select, default pick, typed non-primary name resolves to the account; create with cap, invalid
name, every taken-name case, creation refused before the primary has a save; delete rules
(primary, online, mismatch), that the save is gone, the name tombstoned (reclaimable by its own account, at most 6 per account, released by `::releasename`) and history re-keyed; one-account-online across two characters; token rotation and `login_forget`
stay on the primary; `changePassword` from the primary or an alt rewrites every character's saves; handshake
without the flag enters the typed character (primary included); the default skips banned characters. Persistence: `delete` per backend in `player-saves.test.cjs`.

Client (`client/tests`): packet encode and decode round trips for the three new client packets
and two server packets; `LoginState` transitions into and out of the stage; hit tests for Play,
rows, New, Delete, Sign out with the fake host pattern from `remembered-sign-out.test.ts`.

Live, in the worktree's own server (PvP and Tutorial Island off in `world.local.json`): create a
second character in the browser pane, enter it, log out, see two cards, delete it, confirm the save
row and account entry; one gateway or headless login confirming the default pick.

## Left to the builder

- Exact new packet ids, the `LoginIndex` value, geometry constants and sprite reuse.
- Whether `CHARACTER_LIST` summary fields (combat and total level) are computed from the save at
  login or cached in the account record; either is fine, loading up to N saves at login is cheap.
- Row hover colours and the exact wording of result messages.
- Where `docs/character-slots.md` cross-links (`docs/player-saves.md`, `server/docs/leagues.md`).
- Ordering of the plan: server first with tests, then client, then live check.

## Later (not this PR)

- Native picker through #2693's login ticket carrying a character name.
- Account-wide bans and mutes.
- Moving credentials into the account record and lifting the primary-delete restriction.
- Account records for the in-browser host: addressed by the capability-gated follow-up described above; older hosts remain limited to one.
- Per-slot cosmetics (slot order, favourite).

## Review note

Under the project's review loop this is new architecture (account record, protocol additions,
a new login-screen stage) and will be held for the maintainer's explicit approval regardless of
quality. The PR description should say so and link this document.
