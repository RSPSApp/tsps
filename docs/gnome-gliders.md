# Gnome gliders

Gnome gliders are handled by `server/plugins/world/GnomeGliders.plugin.js`. Each destination's index, map button, arrival tile and pilot is listed in `server/data/definitions/gnome-gliders.json`. `server/tests/gnome-gliders.test.cjs` replays the captured flights tick by tick.

## Destinations

The indices, buttons and arrival tiles come from an rsprox capture of a flight to every destination. The requirements come from the [Wiki](https://oldschool.runescape.wiki/w/Gnome_glider).

| Index | Destination | Area | Map button (138:) | Arrival tile | Pilot | Needs |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Ta Quir Priw | Gnome Stronghold, on top of the Grand Tree | 4 | 2465, 3500, 3 | Captain Errdo | — |
| 1 | Gandius | Karamja | 16 | 2971, 2968, 0 | Captain Klemfoodle | — |
| 2 | Kar-Hewo | Al Kharid | 13 | 3284, 3210, 0 | Captain Dalbur | — |
| 3 | Lemanto Andra | Digsite | 10 | 3320, 3430, 0 | — (arrival only) | — |
| 4 | Sindarpos | White Wolf Mountain | 7 | 2850, 3498, 0 | Captain Bleemadge | — |
| 5 | Lemantolly Undri | Feldip Hills | 21 | 2549, 2972, 0 | Gnormadium Avlafrim | One Small Favour |
| 6 | Ookookolly Undri | Ape Atoll | 25 | 2711, 2802, 0 | Captain Shoracks | Monkey Madness II |

**The Grand Tree** is needed for every flight.

**Lemanto Andra is one-way.** Its glider crashes, so Captain Errdo there has only Talk-to. As captured, he says: "Ah, how embarrassing." / "What happened?" / "A bit of a technical hitch with the landing gear. I won't be able to fly you anywhere, sorry."

**The Lemanto Andra landing tile varies.** The full flight landed on 3320, 3430, and a quick glide landed on 3320, 3429. The plugin uses 3320, 3430.

## How the cache drives it

- **The map draws the flight itself.** The glider map's scripts (1286, 1288 and 1290) read `pilot_journey` (varp 153) as a packed pair, `from << 14 | to`. For example, 32772 is Al Kharid (2) to White Wolf Mountain (4).
- **The map hides two buttons by itself.** Script 1288 hides Feldip Hills unless varp 416 ≥ 200, and Ape Atoll unless varbit 5027 ≥ 195. Those are the quests' own varps.
- **The pilots change with the last destination.** Each pilot is a multi-NPC switched by `pilot_previous_destination` (varbit 9584). Option 1 is "Glider"; option 4 is "Glider-to \<last destination\>", and it is missing when the last destination is the pilot's own glider.
- **The Feldip Hills and Ape Atoll pilots read another varbit:** `pilot_multinpc_var` (9567, i.e. `pilot_multinpc_visible` 9576 × 16 + `pilot_multinpc_dest` 9575). Below 16, Gnormadium Avlafrim has only Talk-to and Captain Shoracks is hidden. The capture set 9576 = 1 and 9575 = the destination when landing at either of them.

## From the capture

**Talking to a pilot (option 1, "Glider")** opens the glider map (138) as the main modal; a tick later, `busy` (varbit 12393) is set to 1.

**Choosing a destination**, counting from the button click (tick T):

| Tick | What the server sends |
| --- | --- |
| T | `pilot_journey` = from << 14 \| to, and a fade-out on interface 174 (script 948, colour 1512708, 20 cycles) |
| T + 1 | the teleport to the arrival tile |
| T + 3 | `pilot_previous_destination` = to, and the fade-in |
| T + 4 | `pilot_journey` = -1, `busy` = 0 and, landing at Feldip Hills or Ape Atoll, 9576 = 1 and 9575 = to; then both the fade overlay and the map close |

**The quick option (option 4, "Glider-to …")** skips choosing. On the click tick, the server sets `pilot_journey`, opens the map and starts the fade-out. A tick later come `busy` = 1 and the teleport, and the rest follows as above.

## Not modelled

- **The Feldip Hills and Ape Atoll gliders** stay locked until One Small Favour and Monkey Madness II exist here. The quests' own varps will then show the map buttons and the pilots' Glider option.
- **The `hpbar_hud` hiding** sent with each fade in the capture is left out.
- **The message without The Grand Tree** ("You need to have completed The Grand Tree to use the gnome gliders.") is not from a capture.
- **Captain Errdo's Digsite lines** come from the capture, but Talk-to is still answered by the Wiki transcripts.
- **The Monkey Madness I military glider** is quest content.
