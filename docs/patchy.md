# Patchy

`server/plugins/npcs/Patchy.plugin.js` runs Patchy's sewing interface on Mos Le'Harmless
(NPC 5870, "Patchy"; options Talk-to and Sew). He sews costume pieces together for 500 coins.

The rules come from rsprox captures (rsprox.net recording 1039, revision 235, ticks 302-1384),
the cache and the OSRS Wiki (Patchy, Transcript:Patchy).

## Opening

Sew opens it at once. Talk-to's "Let me see what you can do." ends in the transcript's
`open_interface "Patchy"`, and the interface opens the tick after the conversation closes.

What the server sends on opening:
1. varp `if1` (261) = -1: nothing picked;
2. script `toplevel_mainmodal_open` (2524) with -1, -1;
3. the `patchy` interface (946) as the main modal;
4. `if_setevents patchy:list` from -1 to -1 with `IF_SCRIPT_TRIGGER`;
5. varbit `busy` (12393) = 1 (live sends it the tick after). Closing the interface sets it back to 0.

## The list

The client draws the list itself (script 8944) from the cache's `patchy_data` table (208):
`id`, `combined` and two `ingredients`. There are 13 rows, from the big hat eyepatch to dark
flippers. Clicking a row runs script 9140, which sends a script trigger on `patchy:list` with the
row's `id`, or -1 when the row is cleared. The server sets `if1` to it.

## Confirm (`patchy:confirm`, op 1)

- **Without every ingredient:** the game message
  `Patchy needs the following items: <col=ef1020>Right eye patch</col> & <col=ef1020>Pirate's hat</col>`.
  It lists both ingredients by their cache names, even one you carry. The interface stays open.
- **With them:**
  1. the two ingredients and 500 coins are taken;
  2. the costume piece arrives (in the capture, in a freed ingredient slot);
  3. sounds 2592, then 2114 with delay 10, play;
  4. a mesbox chat line with the box's text, its breaks as spaces;
  5. the interface closes for an objectbox with the piece and
     `<name>:<br><br>Patchy takes 500 coins and sews your items together.`

  Continue opens the interface again, with `if1` back at -1.

## Ours

- Confirm with nothing picked does nothing.
- Carrying the ingredients without 500 coins gives
  `Patchy needs <col=ef1020>500 coins</col> to sew those together.`

There is no capture or Wiki line for either.

- **Busy during the objectbox:** live keeps `busy` at 1 through the sew's objectbox. Here it drops when the modal closes and comes back on the reopen. An objectbox the player walks away from reports no close, so keeping it would leave the flag set.

## Not covered

- **Separating a piece again (600 coins):** using it on Patchy. Rev 231 recordings have
  Patchy's lines ("You want me te separate these two for ye?" ...), but not the whole flow.
- **The dark flippers warning:** the Wiki transcript says Patchy gives one but doesn't quote it.
  The Wiki also says the dark claw isn't given back when dark flippers are separated.
