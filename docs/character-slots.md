# Character slots

One login can own several characters on a server. The characters belong to that server only; another server knows nothing about them.

## What players see

- With multiple slots enabled, the browser client shows the account's characters after the password. The first login enters the primary automatically. The player picks one and presses Play, or makes a new one in the empty slot.
- Logging out returns to the login screen. To switch characters: log out, log in, pick.
- Typing a character's name at the login screen works too. The password is the account's, and that character is preselected.
- Only one character of an account can be online at a time.
- A login left on the picker for 5 minutes is disconnected, which frees its characters for another login.
- Each character is an ordinary player with its own name, save, friends and bank. Characters do not share items or coins.

## Enabling Characters

The `Characters` plugin is disabled by default. Enable it in `server/data/definitions/world.local.json`
(or `world.json`) and restart the server:

```json
{
  "plugins": { "Characters": true },
  "pluginConfig": { "characters:maxPerAccount": 6 }
}
```

- `pluginConfig` alone cannot enable the plugin. With `Characters` absent or false, the original login exchange runs: no capability announcement, character packets, selection flag or fallback delay, and no new character-account records.
- When enabled, the limit defaults to 6, is rounded down and clamped to 1–6, and falls back to 6 for non-numeric values. Setting it to 1 skips the picker and additional-character behavior.
- The in-browser host always uses 1 because it cannot persist account ownership.
- Disabling the plugin later preserves existing ownership, account passwords, bans and deleted-name reservations. Players enter the character whose name they typed, without a picker. Back up the account file with saves even while the plugin is disabled.

## How the client detects support

Only the registered Characters login extension sends a `characters:slots` message over the existing plugin-message channel,
before its unchanged welcome packet. The client waits for that welcome and sets the character-select
login flag only when support was advertised on the current connection. This is repeated on reconnect;
a server with slots disabled (or an older server) follows the original login/handshake immediately.

## Plugin and core responsibilities

Characters registers a generic per-connection login extension. The plugin owns capability announcements,
post-authentication character selection, create/delete requests, picker packets and account creation/last-played
updates. Core owns credential verification, packet framing, pending-name reservations, timeouts and socket
cleanup. Persisted ownership and deletion reservations remain core identity protections even when the plugin is off.
Extension failures abort login rather than silently falling through to entering a player.

## Where accounts live

Accounts are in `data/saves/accounts.json`. Set `TSPS_ACCOUNTS_FILE` to use another path. The file lists each account's characters in slot order, with when each was created and last played. With the Characters plugin enabled and a cap above 1, a player who already has a save gets an account the first time they log in; a new name gets one when it first enters the world, so a login that never enters claims nothing. There is nothing to migrate. The file also keeps every deleted character's name (see [Deleting a character](#deleting-a-character)).

Last-played times are written at most every 30 seconds, and on a normal shutdown; a crash can lose the latest ones, which only changes which character the picker preselects.

Run one server process per data directory, as for the saves themselves.

### Back it up with the saves

Back up `accounts.json` together with the saves database (`players.sqlite`, or the JSON save folder), and restore them together. The saves alone are not enough:

- **Ownership:** it is the only record of which characters each account owns. Without it, each character with a save becomes an account of its own, and characters that never entered become free names.
- **Alt passwords:** an alt has no password of its own; it logs in with its primary's. Each alt's save also keeps a copy of the account's password hash, and `::changepassword` (from any character) rewrites it on every character's saves and signs out their remembered logins. Without the file, each alt with a save opens on its own with the account's current password.
- **Deleted names:** without the tombstones, a deleted character's name can be taken again, together with its display names, clan rank, bans and mutes.

If the file exists but can't be read (for example, damaged or hand-edited JSON), every login is refused. Players see "The login server is busy."; the server log names the file and says to repair it or restore it from the backup. A missing file is not an error: the server starts a new one, so restoring the backup must come before the server is started again.

A character whose own save can't be read refuses its login the same way ("The login server is busy."); it does not fall back to the primary.

## The primary character

The first character has the account's login name. It is the primary character.

- It holds the account's password and remember-me logins.
- It cannot be deleted. The picker greys out Delete for it.
- A second character can only be made after the primary has entered the world once.

## Bans

Bans in `Bans.txt` are per character name, with one rule for the account:

- **A banned primary bans the whole account.** Logging in with any of its characters' names is refused with "Your account has been disabled.", and no new character can be made.
- A banned alt only stops that character. The account can still log in and play its other characters; the picker refuses to select the banned one and never preselects it.

## Deleting a character

- Delete asks the player to type the character's name. A different name cancels it.
- A character that is online cannot be deleted.
- The save is removed for every profile, and the character leaves the account.
- The name stays reserved. `accounts.json` keeps it under `deleted` (a tombstone) with the account that deleted it. A login with that name, a new character with it from any other account, and a display-name change to it are all refused: "That name belonged to a deleted character and can't be used again." (a display-name change says "That name is not available.").
- The account that deleted it can make a character with that name again, which undoes a mistaken delete's hold on the name (the save stays gone). That removes the tombstone.
- An account can hold at most 6 deleted names. A delete beyond that is refused before anything is removed: "You have deleted too many characters. Ask a member of staff to free a name." Re-creating one of its own deleted names, or staff releasing one, makes room.
- Nothing else keyed by the name is released or rewritten: its display name and held names in `display-names.json`, its clan membership and rank in `clans.json`, and its entries in `Bans.txt` and `Mutes.txt` stay. The tombstone makes them unreachable, so no other player can inherit them. A display name the deleted character showed stays reserved too.
- Before that, the server keeps a copy of the save in the save history with the reason `character-delete`. On SQLite the history rows are re-keyed to `deleted:<time>:<name>`, so `::snapshots` and `::rollback` never show the old character under its name. An admin with database access can still read them; there is no in-game restore. See [Player saves](./player-saves.md#the-save-history).

## Native RuneLite, bots and the agent MCP

These clients have no picker. They enter the character whose name was typed at login, the primary included, so a player who types their login name always lands on their first character.

In the browser, the picker preselects the typed character if it isn't the primary, else the one played last. A banned character is never preselected; the next one played last is.

## Commands

`::characters <name>` (developer rank) lists the characters of the account that owns `<name>`, primary first, with when each last played. It prints `No account owns that name.` for an unknown name.

`::releasename <name>` (administrator rank) frees a deleted character's name: anyone can then log in with it or create it. It replies `Released <name> (deleted by <account>). The name can be used again.`, or `No deleted character had that name.` Whatever stayed keyed by the name (its display names, clan rank, bans and mutes) goes to whoever takes it next, so clear those first if they matter.

## More

The design, including the protocol and the limits of this version, is in the [character slots design](./superpowers/specs/2026-11-05-character-slots-design.md).
