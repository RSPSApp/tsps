# Character slots

One login can own several characters on a server. The characters belong to that server only; another server knows nothing about them.

## What players see

- After the password, the browser client shows the account's characters. The player picks one and presses Play, or makes a new one in the empty slot.
- Logging out returns to the login screen. To switch characters: log out, log in, pick.
- Typing a character's name at the login screen works too. The password is the account's, and that character is preselected.
- Only one character of an account can be online at a time.
- A login left on the picker for 5 minutes is disconnected, which frees its characters for another login.
- Each character is an ordinary player with its own name, save, friends and bank. Characters do not share items or coins.

## Configuring the number of slots

Set `characters:maxPerAccount` in `world.local.json` under `pluginConfig`:

```json
"pluginConfig": { "characters:maxPerAccount": 3 }
```

- The default is 3. Values are rounded down and kept between 1 and 6, the most rows the picker can show. A value that is not a number falls back to 3.
- 1 turns creation off. The picker still shows the one character with Play.
- The in-browser host (IndexedDB saves) keeps no account file between reloads, so it always has 1.

## Where accounts live

Accounts are in `data/saves/accounts.json`. Set `TSPS_ACCOUNTS_FILE` to use another path. The file lists each account's characters in slot order, with when each was created and last played. A player who already has a save gets an account the first time they log in; a new name gets one when it first enters the world, so a login that never enters claims nothing. There is nothing to migrate.

Run one server process per data directory, as for the saves themselves.

## The primary character

The first character has the account's login name. It is the primary character.

- It holds the account's password and remember-me logins.
- It cannot be deleted. The picker greys out Delete for it.
- A second character can only be made after the primary has entered the world once.

## Deleting a character

- Delete asks the player to type the character's name. A different name cancels it.
- A character that is online cannot be deleted.
- The save is removed for every profile and the name is free to take again.
- Before that, the server keeps a copy of the save in the save history with the reason `character-delete`. On SQLite the history rows are re-keyed to `deleted:<time>:<name>`, so `::snapshots` and `::rollback` on a reused name never show the old character. An admin with database access can still read them; there is no in-game restore. See [Player saves](./player-saves.md#the-save-history).

## Native RuneLite, bots and the agent MCP

These clients have no picker. They enter the character that played last, or the primary if none has. If the login name typed is a non-primary character's, they enter that character instead.

## Command

`::characters <name>` (developer rank) lists the characters of the account that owns `<name>`, primary first, with when each last played. It prints `No account owns that name.` for an unknown name.

## More

The design, including the protocol and the limits of this version, is in the [character slots design](./superpowers/specs/2026-11-05-character-slots-design.md).
