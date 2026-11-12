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

The dials are varbits 3985/3986/3987 and count **anticlockwise**: by value 0-3 the letters are A D C B, I L K J and P S R Q, so the index is `dial1 * 16 + dial2 * 4 + dial3` (AJR is 0 3 2 = 14). The rings (`fairyring_minorhub` 29495, Zanaris' 29560, the POH ring 29228) are not multilocs: op 3 is a plain "Last-destination" for every code. Varbit 20251 (`fairyring_lastloc_opvis`, 64 + the index) is sent with it; our client does not use it, so the option shows (as "Last-destination", without the code) before a first use too.

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

- **"Last-destination"** (op 3) and **"Zanaris"** (op 1, code BKS) skip the dials. Both were captured from the ring's tile: `busy` and the flowers at once, the teleport 3 ticks later, `busy` 0 a tick after. To the ring the player stands on, the animation plays without moving them.
- **Close** (398:27) is client script 29 (`if_close`); the server only clears `busy`.
- **AJQ** (Dorgesh-Kaan cave), for a player without a light source: at Confirm, varbit 3865 (`cws_warning_15`) = 1, `meslayer_close [28]` and `toplevel_mainmodal_open` (2524) `[-1, -1]` run, and the warning (578) opens: "This fairy ring code leads to a dark area. Are you sure you want to go there without a light source?" with "Yes I am sure." (578:17) and "No, I am not properly equipped." (578:18). No closed it and cleared `busy`.

## The travel log and favourites (rsprox captures 3997 and 3998, rev 237; 236/3951 and 230/312 for Use code)

- **Use code** on a used code, a favourite or the Fairy Queen's Hideout: synth sound 2871 and the dial varbits, on the click's tick. The rotate buttons play no sound.
- **Add Favourite** (a code's star, or op 2 on its row) puts the code in the first empty slot of 10, with the game message "Added A K R to your favourites." (the code spaced). On the same tick: `fairyring_fave_<slot>` (varbits 20240-20249, 7 bits: 64 + the code's index, so its three dial letters and a set flag) and `fairyrings_favourite_opvis` (20239, one bit per filled slot); then the whole log's text again, the dials and the log opened again over the same backdrop (script 917 `[4212288, 50]`) and `meslayer_close [28]`.
- **Remove Favourite** (the slot's star, or op 2 on it): the slot's varbit and bit back to 0 and the same refresh, with no message. The other favourites keep their slots; the next one added fills the gap.
- In the log, a favourite's code is blank in the list of used codes (it shows only in its slot). A slot shows the code's log text (`fave_<n>`) and the code spaced ("A K R", `fave_code_<n>`).
- At login the favourite varbits and `fairyrings_favourite_opvis` are sent with the last destination's.
- The ring's op 4 "Favourites" takes a favourite from a sub-menu (a sub-op) and plays the usual fairy teleport there. Chosen without one, it sends "You will need to select a favourite from the sub-menu." Our client and server have no sub-ops for locs, so only that line is implemented; no client script reads the favourite varbits (they drive the sub-menu).

## Implementation

- A player not on the ring's tile steps onto it first, for every option, and the flowers follow a tick later: the capture shows that for Confirm, so Last-destination and Zanaris from beside the ring do the same. The ring is solid in the cache (clip type 1), so the step bypasses collision, as agility's forced walks do.
- Closing the dials by any route runs `meslayer_close [28]`, so Close and Escape close the search box too.

- The table is read at startup; the Wiki-based `fairy-rings.json` it replaces is gone.
- Saved per player: the last code (its varp and varbits are sent again on login), the codes used (the travel log shows those) and 10 favourite slots (as a comma list, empty slots blank).
- The warning's "Don't ask me this again" (578:20) toggles varbit 3865 between 1 and 2, and 2 skips it; the capture doesn't show the toggle. Light sources are matched by item name: lit candles, torches and lanterns, bullseye lanterns, Kandarin headgear 2-4, the Firemaking and max capes.
- The dial letters are 12 models (16237, 16243-16283) that script 398 rotates with `if_setmodelangle`; the selected letter sits at the bottom, behind a window in the wooden bar (component 18, model 16236). The window's faces are translucent (alpha 192). OSRS draws widget models straight into the frame, so the letter shows through. The client draws each widget model into its own texture, so `client/ui/model/Model2DRenderer.ts` now keeps each pixel's coverage, and a translucent face stays translucent instead of blending with black (`client/tests/widget-model-translucency.test.ts`).
- The Confirm button's destination name ("Slayer cave" for AJR) is not OSRS: the cache's text is "Teleport to this location" and the capture sends nothing for it. It is RuneLite's Fairy Rings plugin, ported as a client plugin (`client/game/plugins/fairyring`) with RuneLite's names; it renames the button after each run of script 398, the dials' varbit listener (`client/tests/fairy-ring-plugin.test.ts`).
- `server/tests/fairy-rings.test.cjs` checks the table, the dial order, the staff rule, Configure, the dials, the Confirm teleport tick by tick, AJQ's warning, Last-destination and the favourites.
