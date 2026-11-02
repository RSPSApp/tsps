# Display names

`::displayname <new name>` changes the name other players see. The login name doesn't change:
players still log in with it, and it stays the account's key for its save, friends lists, clans
and punishments. In OSRS the name is changed on the website; there is no website here, so it is a
command. Any player can use it.

`::displayname` on its own shows the current name and when it can next be changed.

## Rules

From the OSRS Wiki's [Account Management](https://oldschool.runescape.wiki/w/Account_Management#Display_name)
page, adapted where this server differs:

- **At most 12 characters:** letters, numbers and spaces. Underscores are read as spaces and extra
  spaces are dropped, as the login screen does. OSRS also allows hyphens, but names here travel
  as the same base-37 longs as login names (friends lists), which can't hold a hyphen.
- **No "mod"** anywhere in the name, spaces ignored, unless the player is staff.
- **Unique.** Case, underscores and spaces don't make a name different. A name is taken if it is
  another account's login name (saved, online, or logging in right now), another account's
  display name, or a name another account has given up and still holds.
- **Once every 28 days.** The player is asked to confirm first; the name is checked again at the
  confirmation, in case someone else took it meanwhile.
- **The old name is held for 35 days**, the login name too after a first change. Nobody else can
  take it, and its owner can take it back (once the 28 days are up). A player can always go back
  to their login name.

Both periods are world settings ([World configuration](world-configuration.md#display-names)).

A new account can't be created with a name another account shows or holds: the login screen
says "That name is not available."

## Where it shows

The name above the player's head and in right-click menus, public chat, private messages,
friends and ignore lists (renamed friends also show their previous name while it is held),
chat-channels, trade, and the game messages that name another player.

A friend, ignore, private message, chat-channel join or kick can be typed with a player's
display name or a name they still hold. A login name only finds its account while that account
shows it or still holds it: 35 days after a player picks a display name, others can't look them
up by their login name any more.

Staff commands (`::kick`, `::ban`, ...) and the server's logs still use login names.

## Storage

`server/data/saves/display-names.json` (or `TSPS_DISPLAY_NAMES_FILE`), written whole on every
change: each account's current name, when it last changed, and the names it holds and until when.
It isn't part of the save, so rolling a save back doesn't change the name. Delete an account's
entry to reset it to its login name.
