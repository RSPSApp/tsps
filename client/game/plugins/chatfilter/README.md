# Chat Filter

A port of RuneLite 1.13.5's Chat Filter (`chatfilter`). It is off by default, as in RuneLite.

Censors words, regular expressions or whole players in chat:

- **Censor words** (the default) replaces each match with asterisks, **Censor message** swaps the
  line for "Hey, everyone, I just tried to say something very silly!" and **Remove message**
  hides it.
- Player chat (public, private, friends chat, clan) is filtered; your own lines, and those of
  friends, friends chat and clan members, only when asked. Game chat only with "Filter game chat".
- Overhead chat is filtered the same way (a removed line shows blank).
- **Collapse game chat** / **Collapse player chat** show repeats once, with their count:
  "Nothing interesting happens. (3)". **Repeat filter** hides public chat repeated more times.

RuneLite's patched chatbox scripts (see the Chat Timestamps README) ask about every line with the
`chatFilterCheck` callback, so a settings change applies to the lines already in the chatbox.
Overhead chat goes through the client's `overheadChatText` plugin hook (RuneLite's
OverheadTextChanged).

## Settings

As RuneLite, config group `chatfilter` with RuneLite's keys: the three filter lists (in a closed
section), the filter type, who is filtered, game chat, collapsing, the repeat filter and "Strip
accents".

## Differences from RuneLite

- Strip accents maps a character at a time with Unicode decomposition (plus Ł and Ø), where
  RuneLite uses Commons Lang; the common accented Latin letters come out the same.
- Regular expressions are JavaScript's, not Java's: most patterns read the same, but Java-only
  syntax (possessive quantifiers, `\p{javaLowerCase}`...) doesn't compile and is skipped, as
  RuneLite skips a pattern that doesn't compile.
