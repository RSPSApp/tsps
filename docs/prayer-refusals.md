# Prayer refusals

What the prayer book answers when a prayer can't be switched on because of a level or an unlock.
All of these are chatbox messageboxes (`messagebox`, "Click here to continue"), whose text also
goes to the chat as a mesbox line, not plain game messages.

## Sources

rsprox captures (rsprox.net and the user's own recordings, cited by id):

| Case | Text | Recordings |
|---|---|---|
| Rigour not learnt | You need a `<col=000080>Prayer</col>` level of 74, a `<col=000080>Defence</col>` level of 70, and to have learnt the prayer in order to use `<col=000080>Rigour</col>`. | 227/1000311, 227/1000340, 237/01107 (Prayer 72, Defence 60) |
| Augury not learnt | ... level of 77, a ... Defence ... level of 70, and to have learnt the prayer in order to use ... Augury ... | local 1001226 ticks 4308-4318 (Prayer 93) |
| Preserve not learnt | You need a `<col=000080>Prayer</col>` level of 55 and to have learnt the prayer in order to use `<col=000080>Preserve</col>`. | local 1001221 (rev 230); 227/1000262, 227/1000273, 228/02246 and 228/02270 read "level of 55, and" |
| Learnt, below the Prayer level | You need a `<col=000080>Prayer</col>` level of 74 to use `<col=000080>Rigour</col>`. (77 / Augury the same) | 228/02246 (Prayer 70) |
| Chivalry / Piety locked | see [knight-waves.md](knight-waves.md) | |

The captures' `<br>`s differ between recordings of the same line (none, one, two), so they are
the box's wrapping and are left out of our text.

An unlearnt prayer gets the full requirement line even below its Prayer level (01107: Rigour at
Prayer 72), so the unlock check runs before the level check.

## What the server does

- `skills/PrayerUnlocks.plugin.js` answers `onPrayerDisabled` for an unlearnt Rigour, Augury or
  Preserve with the recorded line as a messagebox (`scrollPrayerLocked`).
- `PrayerHandler.canUse` refuses a prayer below its Prayer level with `levelRefusal`, as a
  messagebox. The Deadeye / Mystic Vigour upgrades use the same line with their own name and level.

## Not covered

- The level line is captured for Rigour and Augury only; every other prayer uses the same template.
- Ours: a learnt Rigour/Augury with enough Prayer but under 70 Defence keeps the old chat line
  ("You need a Defence level of at least 70 to use that prayer."); no capture has that case.
