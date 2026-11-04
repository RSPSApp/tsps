# Chat Timestamps

A port of RuneLite 1.13.5's Chat Timestamps (`timestamp`). It is off by default, as in RuneLite.

Every chat line, in the chatbox and split private chat, starts with the time the message arrived,
in the device's time zone: `[14:05] Welcome to Old School RuneScape.` by default. It replaces the
game's own "Chat timestamps" setting while it is on.

RuneLite's patched chatbox scripts (`rs/cs2/runelite/chatScripts.ts`, see below) ask for the
timestamp with the `chatMessageBuilding` callback as they build each line.

## Settings

As RuneLite, config group `timestamp`:

- **Timestamps (opaque)** and **Timestamps (transparent)**: the timestamp's colour on each chatbox
  background. Unset (the default), it takes the line's colour.
- **Timestamp format**: a Java SimpleDateFormat pattern, `[HH:mm]` by default. `yyyy` year, `MM`
  month, `dd` day, `HH` 24-hour and `hh` 12-hour hour, `mm` minute, `ss` second, `a` AM/PM, and
  `'quoted'` text. An invalid pattern falls back to `[HH:mm]`.

## The chat scripts

`rs/cs2/runelite/chatScripts.ts` holds RuneLite's ChatBuilder (84), ChatSplitBuilder (89) and
ChatTimestamp (4742), unchanged from RuneLite 1.13.5. Like Bank Tags' scripts, each replaces the
cache's only when the cache's bytes have the SHA-256 RuneLite's patch was made from (this cache's
three do), and with no plugin listening every callback leaves the line as the game builds it.
Chat Filter uses their `chatFilterCheck` callback.

## Differences from RuneLite

- The format is this client's SimpleDateFormat (`simpleDateFormat.ts`): the fields above plus
  weekdays (`E`), `k`/`K` hours and milliseconds (`S`). Java's other letters are valid but print
  as text.
- The format's description is one paragraph: the settings panel shows plain text.
