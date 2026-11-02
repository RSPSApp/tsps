# Chat Notifications

A port of RuneLite 1.13.5's Chat Notifications. Turn it on in the plugin list; it is off on
fresh installs.

- **Highlight own name**: your name is underlined in the highlight colour wherever it appears in
  chat.
- **Highlight words** (comma separated) and **Highlight regex** (one per line) are coloured in
  the highlight colour; words match whole words, case-insensitively.

The colours are RuneLite's defaults: in public, friends and clan chat the highlight is black on
the opaque chatbox and white on the transparent one; in private chat it is dark blue (white when
transparent); in game messages it is red. After a highlight the line returns to its own colour:
the in-game chat colour setting when you have set one, else the game's default.
- Notifications, each off by default: when someone mentions your name, when a highlight
  matches, when you are traded or challenged to a duel, on broadcasts, and on private messages.

Your own public, clan and friends chat lines are not highlighted or notified on.

## Differences from RuneLite

- RuneLite's own chat colour settings (the Chat Color config) don't exist here, so its defaults
  are used, as listed above.
- The plugin rewrites a line as the chat history stores it, which is what the chatbox reads, so
  only lines that arrive after it is turned on are highlighted.
- Notifications are on/off switches, and a game message plus a browser notification instead of
  a tray notification.
