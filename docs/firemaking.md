# Firemaking: Forester's Campfires and lighting logs

## Confirmed behaviour

The [Forester's Campfire Wiki page](https://oldschool.runescape.wiki/w/Forester%27s_Campfire)
and [Fire Wiki page](https://oldschool.runescape.wiki/w/Fire) establish the gameplay rules:

- The first log added to a normal fire sets the campfire duration. The original fire's
  remaining lifetime does not contribute. Regular logs give 102 ticks; oak gives 109.
  The duration is measured from the campfire appearing to disappearing.
- Later logs extend the timer by the log's published increment, capped at 300 ticks.
- Ordinary permanent fires can be converted. When the campfire expires, the permanent
  fire returns and ashes appear. Fires with a Cook option are excluded.
- Coloured fires retain their colour when converted.
- Tending consumes one log every nine ticks and grants the full normal Firemaking XP.
  A single carried log type starts directly; multiple types offer a type and quantity
  choice. Completing the selected quantity or exhausting logs ends the animation.

Rsprox recording **1723** (revision 227, Leagues V) supplies presentation evidence:

- The selection title is “What would you like to burn?” and its skillmulti mode is 27.
- Willow tending uses `forestry_campfire_burning_willow_logs`; each consumed log plays
  `forestry_campfire_burning_spotanim` at the fire. No tending-attempt or log-added chat
  messages accompany that recorded loop.
- Check displays the remaining-time description in a message box with Continue.

That recording predates the normal-game timing change: its four-tick interval is **not**
used. The Wiki records the May 2025 change to nine ticks and full XP. Cache revision 241
confirms the fire/campfire colour pairs, log-specific sequences and graphic. Sequence
selection for other log types follows the corresponding cache names; only willow's
sequence was observed in the recording.

## Changes and verification

Previously, the handler accepted `roving_fire` rather than ordinary `fire`, preventing
conversion of permanent fires such as Prifddinas and Edgeville Dungeon. A converted
player-made fire also inherited the larger of its old lifetime and the added log's
lifetime. Permanent-fire expiry restored the object without ashes. Mixed inventories
silently selected a log, and tending used a cooking animation and extra chat messages.

The plugin now selects valid fire variants, preserves colour, sets the first-log timer,
restores permanent fires with ashes, offers the carried-log selection and respects its
quantity. Check uses the existing message-box dialogue. The plugin delegates to a named unit, with core access through the plugin API and named hooks.

Automated regressions cover the first-log lifetime, all six fire/campfire
pairs, restored objects and ashes, selection/quantity, nine-tick reward boundary, XP,
willow animation/graphic, message box, exhausted logs and rejection of Cook fires and
insufficient levels. The regressions fail against the previous implementation.

Live action checks confirmed conversion of the Prifddinas permanent fire, log consumption,
XP, the mixed-log menu, its selected reward, expiry, permanent-fire restoration and ashes.

## Evidence limits

The indexed tending recording is an older special-world recording. Current gameplay rules
come from the Wiki; there is no current main-game tending recording in the inspected index.
The exact ambient smoke cadence and current looping versus non-looping sequence choice
need newer capture evidence. No visual equivalence is claimed.

The existing interpolated campfire durations for jatoba, camphor, ironwood and rosewood
remain unchanged: the inspected Wiki does not publish their durations. These values need
additional evidence before changing them.

## Lighting logs

From rsprox captures: recording **1035** (main game, rev 235) for the lines and the log on
the ground, and leagues recordings 1098, 1108, 1718, 1788, 1843 and 1846 for the timing only
(their relics change the success chance, not the order of events).

- **The click:** anim 733 (`human_createfire`), "You attempt to light the logs." on the
  spam channel, and the log leaves the inventory and lands underfoot on the same tick.
  Lighting a log already on the ground ("Light", or a tinderbox on it) goes the same way.
- **Rolls:** the first is 3 ticks after the click, then every 4 ticks. A miss restarts
  the animation. On a hit, the animation stops and the player steps one tile off the log
  (west first, at walk speed) on that same tick. The fire replaces the ground log on the
  next tick (tick 4, 8, 12 ...), behind the player.
- **The fire:** synth 2596, "The fire catches and the logs begin to burn." on the spam
  channel, the XP, and the player turns back to face the fire, all on the fire's tick. All
  nine lightings in recordings 1035, 1098 and 1108 have this order. Issue 2010: the step
  used to come with the fire, so the player stood idle on the log for a tick first.
- **Blocked tile:** "You can't light a fire here." (game message), seen in recording 1035
  and once on each of the yew, willow, maple and magic log sheets.
- Not done: an Ironman lighting another player's dropped log gets "You're an Ironman, so
  you can't take items that other players have dropped." in one recording (1613, rev 225);
  tsps lights it.
