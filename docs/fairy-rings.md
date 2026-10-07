# Fairy rings

`server/plugins/world/FairyRings.plugin.js`, built from two live OSRS captures (rsprox) of a player using a fairy ring: Configure, turning the dials, Confirm (once refused at a warning, twice teleporting from beside the ring), "Last-destination" to the ring they stood on, and "Zanaris". The OSRS Wiki ("Fairy ring") covers the requirements.

## The cache

All 64 dial combinations are rows of **db table 89**:

| Column | Holds |
| --- | --- |
| 0 | the destination id the server sends in varp 817 (`fairyring_destination1`): AJR 32, AJQ 33 |
| 1 | the combination's index, sent in varbit 5374 (`fairyring_lastloc`): AJR 14, AJQ 15 |
| 2 | the destination, a packed coordinate; combinations with no destination have a placeholder |
| 3 | the code, spaced ("A J R") |
| 4, 5 | the travel log's text and "Add Favourite" star components (interface 381) |
| 7 | the name ("Fairy ring (AJR)") |
| 8 | the travel log text ("<br>Fremennik Province: Fremennik Slayer Cave") |

The dials are varbits 3985/3986/3987 and count **anticlockwise**: by value 0-3 the letters are A D C B, I L K J and P S R Q, so the index is `dial1 * 16 + dial2 * 4 + dial3` (AJR is 0 3 2 = 14). The common ring (`fairyring_minorhub`, 29495) is a multiloc on varbit 5374; each variant's third option reads "Last-destination (XYZ)".

## What OSRS sends

- **No staff wielded:** "The fairy ring only works for those who wield fairy magic." (A staff in the inventory isn't enough.)
- **Configure:** the dials reset to 0; the travel log's text is set for every code (blank for codes not used yet), the Fairy Queen's Hideout line ("<col=ffffff>AIR</col> DLR DJQ AJS<br><col=ff981f>Fairy Queen's Hideout</col>") and the 10 favourite slots; script 917 (`toplevel_mainmodal_background`) with `[4212288, 50]` dims the whole game view; then the dials (398) open on the main modal and the travel log (381) on the side modal. Varbit `busy` (12393) = 1 follows a tick later.
- **A rotate button** (398:19-24, clockwise and counter-clockwise per dial) turns its dial one step.
- **Confirm** (398:26), tick 0: varp 817, varbit 5374, varbit 20251 (`fairyring_lastloc_opvis`) = 64 + the index; the player, configuring from beside the ring, walks onto the ring's own tile (facing reset); both interfaces close and `meslayer_close` (script 101) runs with `[28]`, closing the travel log's search box if it is open. Then:

| Tick | Sent |
| --- | --- |
| 1 | graphic 569 (`fairy_flower_ring`), animation 3265 (`human_fairy_vanish`) with delay 30, sound 1098 |
| 4 | the teleport; animation 3266 (`human_fairy_appear`) |
| 5 | `busy` = 0; animation reset |

- **"Last-destination (XYZ)"** (op 3) and **"Zanaris"** (op 1, code BKS) skip the dials. Both were captured from the ring's tile: `busy` and the flowers at once, the teleport 3 ticks later, `busy` 0 a tick after. To the ring the player stands on, the animation plays without moving them.
- **Close** (398:27) is client script 29 (`if_close`); the server only clears `busy`.
- **AJQ** (Dorgesh-Kaan cave), for a player without a light source: at Confirm, varbit 3865 (`cws_warning_15`) = 1, `meslayer_close [28]` and `toplevel_mainmodal_open` (2524) `[-1, -1]` run, and the warning (578) opens: "This fairy ring code leads to a dark area. Are you sure you want to go there without a light source?" with "Yes I am sure." (578:17) and "No, I am not properly equipped." (578:18). No closed it and cleared `busy`.

## Implementation

- A player not on the ring's tile steps onto it first, for every option, and the flowers follow a tick later: the capture shows that for Confirm, so Last-destination and Zanaris from beside the ring do the same. The ring is solid in the cache (clip type 1), so the step bypasses collision, as agility's forced walks do.
- Closing the dials by any route runs `meslayer_close [28]`, so Close and Escape close the search box too.

- The table is read at startup; the Wiki-based `fairy-rings.json` it replaces is gone.
- Saved per player: the last code (its varp and varbits are sent again on login), the codes used (the travel log shows those) and up to 10 favourites. "Use code" in the log sets the dials; "Add Favourite" and "Remove Favourite" edit the list. The capture shows the favourite slots only empty, so their text (the code's log text and its code) is ours.
- The warning's "Don't ask me this again" (578:20) toggles varbit 3865 between 1 and 2, and 2 skips it; the capture doesn't show the toggle. Light sources are matched by item name: lit candles, torches and lanterns, bullseye lanterns, Kandarin headgear 2-4, the Firemaking and max capes.
- Not shown in the capture, so not sent: a sound heard while dialling (synth 2871, not on every click).
- The dial letters are 12 models (16237, 16243-16283) that script 398 rotates with `if_setmodelangle`; the selected letter sits at the bottom, behind a window in the wooden bar (component 18, model 16236). The window's faces are translucent (alpha 192). OSRS draws widget models straight into the frame, so the letter shows through. The client draws each widget model into its own texture, so `client/ui/model/Model2DRenderer.ts` now keeps each pixel's coverage, and a translucent face stays translucent instead of blending with black (`client/tests/widget-model-translucency.test.ts`).
- `server/tests/fairy-rings.test.cjs` checks the table, the dial order, the staff rule, Configure, the dials, the Confirm teleport tick by tick, AJQ's warning, Last-destination and the favourites.
