# Boosts Information

A port of RuneLite 1.13.5's Boosts Information. It is on by default, as in RuneLite.

Boosted and drained stats show as infoboxes: the skill icon with the current level (or the
relative boost) in green above the boost threshold, yellow at or below it, and red when drained.
After them come the timers to the next stat restore: the debuff one (stats coming back up) and
the buff one (boosts wearing off), counting 60 seconds, or 90 with Preserve.

**Display panel** adds RuneLite's panel ("Next + restore in", then "Strength 89/70" per skill);
**Compact display** adds the small icon list. Each is a movable overlay: Alt-drag moves it, and
right-click offers **Configure Boosts overlay**.

**Notify on boost threshold** sends "<Skill> level is getting low!" when a boost drains to the
threshold.

## Settings

As RuneLite, config group `boosts` with RuneLite's keys. Which skills (combat, non-combat, both,
none), relative boosts, infoboxes, panel, compact display, when to show the restore timers, the
boost threshold and the notification.

## Differences from RuneLite

- RuneLite's infoboxes sit in the shared infobox bar. There is none here, so they are one
  movable row of their own (top left by default).
- The buff and debuff icons are drawn arrows instead of RuneLite's images.
- The notification is an on/off switch, and a game message plus a browser notification instead
  of a tray notification.
