# Deadeye and Mystic Vigour

The two prayers learnt from the Royal Titans' prayer scrolls. They are not extra prayers: once
learnt they take Eagle Eye's and Mystic Might's place in the book, so the slot's own prayer id
stays in use and `PrayerHandler` applies the upgrade
(`server/src/main/typescript/elvarg/game/content/PrayerHandler.ts`, `deadeyeActive` /
`mysticVigourActive`). Unlocking is in `server/plugins/skills/PrayerUnlocks.plugin.js`.
Tests: `server/tests/prayer-deadeye-mystic-vigour.test.cjs`.

## Sources

- **The OSRS Wiki, [Deadeye](https://oldschool.runescape.wiki/w/Deadeye) and
  [Mystic Vigour](https://oldschool.runescape.wiki/w/Mystic_Vigour):** 62 / 63 Prayer. Deadeye:
  +18% Ranged attack and strength, +5% Defence (Eagle Eye 15%, 15%, 0%). Mystic Vigour: +18% Magic
  attack and Magic defence, +3% Magic damage, +5% non-Magic Defence (Mystic Might 15%, 2%, 0%).
  Both drain 1 point per 3 seconds, as the prayers they replace. They are the only Defence boosts
  that can be used alongside Thick Skin, Rock Skin or Steel Skin, and Defence boosts from several
  prayers add up.
- **The OSRS Wiki, [Deadeye prayer scroll](https://oldschool.runescape.wiki/w/Deadeye_prayer_scroll):**
  Read offers "Learn Deadeye" / "Cancel"; learning consumes the scroll with "You study the scroll
  and learn a new prayer: Deadeye".
- **rsprox captures** ([rsprox.net database](https://rsprox.net/database)):
  - Recording 3398 (rev 235): reading either scroll opens the same objectbox text as the other
    prayer scrolls ("... Would you like to absorb its power?").
  - Recordings 3273, 3276 (rev 234) and 4068 (rev 237): with Mystic Vigour learnt, the Mystic
    Might button sets Mystic Might's `prayer_allactive` bit, `prayer_mysticmight` and then
    `prayer_mysticvigour` (16091), with Mystic Might's sound (2669); switching it off clears both.
  - Recording 3279 (rev 234, from tick 438): the Eagle Eye button with Deadeye learnt sets
    allactive 4194304, `prayer_eagleeye` and then `prayer_deadeye` (16090), with Eagle Eye's
    sound (2665), and clears both on off; recordings 3276, 3277 and 3280 show it too.
  - These are event and Leagues worlds; no main-world capture of either prayer exists yet.

## What the server does

- Reading a scroll sets `prayer:deadeye-unlocked` / `prayer:mystic-vigour-unlocked` (saved) and
  the cache's `prayer_deadeye_unlocked` (16097) / `prayer_mystic_vigour_unlocked` (16098), which
  the client uses to draw the upgraded prayer in the slot. They are re-sent at login.
- Eagle Eye and Mystic Might stay usable without the scrolls. With one learnt, the slot sends
  `prayer_deadeye` (16090) / `prayer_mysticvigour` (16091) after the slot's own varbit, and clears
  it when the prayer goes off.
- Where the upgrade shows, it needs its own Prayer level (62 / 63). Below that level the scroll
  isn't read (the Wiki's "Reading it requires level 62 Prayer"), so the player keeps Eagle Eye /
  Mystic Might. Ours: the refusal "You need a Prayer level of at least 62 to learn Deadeye."
- Combat: 118% Ranged attack and strength for Deadeye; 118% Magic attack and Magic defence level,
  +3% Magic damage for Mystic Vigour; both add 5 percentage points to the Defence prayer
  multiplier, on top of a skin prayer (Steel Skin + Deadeye = 120%).

## Not covered

- Ours: an upgrade is only ever the earned scroll. A minigame's unlock bypass (Last Man Standing,
  PvP-mode presets) does not show or apply Deadeye or Mystic Vigour.
- The refusal for reading below 62 / 63 Prayer is our own wording; no capture or Wiki text has it.
