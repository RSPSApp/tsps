# Idle Notifier

A port of RuneLite 1.13.5's Idle Notifier. Turn it on in the plugin list; it is off on fresh
installs.

It sends a notification (a red game message, plus a browser notification while the tab is in
the background, once the browser allows them) when:

- you stop a skilling animation (woodcutting, mining, fishing, cooking, fletching, smithing and
  the rest of RuneLite's list) and stay idle for the delay;
- you leave combat with an attackable NPC, or stop fishing at a fishing spot;
- you stop moving (off by default);
- hitpoints or prayer drop to a threshold, run energy drops to or recovers to a threshold,
  oxygen runs low, or special attack energy regenerates to a threshold.

Clicking or typing resets the idle timers, as RuneLite does.

## Settings

As RuneLite, config group `idlenotifier` with RuneLite's keys. Each notification is an on/off
switch rather than RuneLite's notification options.

## Differences from RuneLite

- This client has no AnimationChanged or InteractingChanged events, so the local player's
  animation and interaction target are read every game tick.
- The idle logout and six hour logout warnings are left out: this server logs nobody out for
  either.
- Not ported: the failed-spell splash keeping you in combat (no GraphicChanged event), the Lunar
  Bake Pie spotanim check, and the group gathering buff (Tempoross-style) reset.
- RuneLite's forestry campfire `*_NOLOOP` animations are newer than this cache and are not in
  the list.
