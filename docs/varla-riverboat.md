# Achilka's riverboat (River Varla)

Issue [#1699](https://github.com/RSPSApp/tsps/issues/1699). Achilka's free rides between Kastori, Tal Teklan
and the Gloomthorn Trail ([Wiki: Achilka](https://oldschool.runescape.wiki/w/Achilka)) are Ferries routes
(`server/plugins/world/Ferries.plugin.js`, members-only like the whole plugin). They are pure data in
`server/plugins/world/data/ferries.json`:

- `routes` `varla-kastori`, `varla-tal-teklan`, `varla-gloomthorn`: fade style with the captured timings.
- `ops`: Achilka's options, picked by the base npc gameval she stands as.
- `steps`: the transcript's travel steps `JHL4rr`, `Fj-emV`, `WjyUrt`.
- `here`: the transcript's "If not already at X:" conditions, each mapped to the gameval standing at X.

`server/tests/ferries.test.cjs` replays a ride tick by tick.

## Stops

Each stop has its own Achilka. Her right-click options (op3/op4) are the other two stops, as the cache
names them:

| Stop | Achilka (gameval, id) | Options | Landing |
| --- | --- | --- | --- |
| Kastori | `tlati_riverboat_owner_south`, 14727 | Tal Teklan, Gloomthorn Trail | 1390, 3074 (captured) |
| Tal Teklan | `tlati_riverboat_owner_west`, 14728 | Kastori, Gloomthorn Trail | 1257, 3126 (unverified) |
| Gloomthorn Trail | `tlati_riverboat_owner_north`, 14729 | Tal Teklan, Kastori | 1400, 3246 (unverified) |

Talk-to plays her Wiki transcript ("Achilka" in `npc-dialogues.json`). Ferries answers its
"If not already at X:" conditions from `here` and starts the ride on its "Let's get underway then!"
travel steps.

## Ride

From rsprox captures 1098, 1104, 1149 (Leagues worlds, rev 237; [rsprox.net/database](https://rsprox.net/database)),
all Tal Teklan to Kastori. Tick 0 is the player reaching Achilka:

| Tick | Live |
| --- | --- |
| 0 | `fade_overlay` (174) opened, script 948 `[0, 255, 0, 0, 50]` |
| +1 | `minimap_state` 2, `busy` 1 |
| +3 | teleport to 1390, 3074, 0; spam message "Achilka takes you along the river to Kastori." |
| +5 | script 948 `[0, 0, 0, 255, 50]`, `minimap_state` 0, `busy` 0 |
| +7 | fade overlay closed |

## Unverified

- The Tal Teklan and Gloomthorn Trail landings come from the agent transport table, not a capture.
- Their messages ("...to Tal Teklan.", "...to the Gloomthorn Trail.") follow the Kastori wording.
