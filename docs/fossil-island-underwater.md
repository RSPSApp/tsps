# Fossil Island underwater

The sea floor north of Fossil Island: Ceto and drift net fishing, Mernia's seaweed patches. Behaviour comes from the [OSRS Wiki](https://oldschool.runescape.wiki/w/Underwater) and the [rsprox capture database](https://rsprox.net/database) (recordings 312, 712, 715, 716).

- **Plugin:** `server/plugins/areas/FossilIslandUnderwater.plugin.js`, data in `server/plugins/areas/data/fossil-island-underwater.json`.
- **Drift nets:** `server/plugins/skills/hunter/DriftNets.Hunter.js` (Hunter README).

## Rowboats

| Boat | Options (captured) |
| --- | --- |
| Museum Camp | Row to the north of the island. / Row out to sea, north of the island. (once found) / Cancel. |
| North of the island | Row to the camp. / Row out to sea. / Cancel. |
| Small island | Row to the north of the island. / Row to the camp. / Dive into the sea. / Cancel. |

- Messages: "You row to the expedition camp...", "You row to the north of the island...", "You row out to sea...". The first trip out to sea adds "Now you have discovered this area, you'll be able to row here directly from the camp!".
- Destinations: camp 3724,3808; north 3733,3893; small island 3765,3899. The captures show 3769,3898 for rowing out to sea, but live OSRS lands on 3765,3899 (checked in-game).
- The screen fades out and the player moves 2 ticks later.
- **Left out:** the barge options ("Row to the barge.", "Row to the barge and travel to the Digsite."). The barge isn't in this map (see `BoneVoyage.Quest.js`).

## Diving

- **Dive** (or "Dive into the sea."): the fade (`fade_overlay`), then a move to 3732,10281 on plane 1. `fossil_underwater` (609) opens on the atmosphere overlay, with `underwater_shallow` (169) in its `water_overlay`, and `fossil_underwater_oxygen` (varbit 5811) is set to 1000.
- **Without diving gear,** the player says "Hmm, it would be easier if I had some method of breathing under water." first. Then comes "Dive without diving gear?" with:
  - "Yes, dive anyway."
  - "Yes, dive anyway, and don't ask this again.", which adds "Speak to Mairin if you ever want to re-enable the warning."
  - "No." This option wasn't captured.
- **Swimming:** while underwater the player's stance and movement are `human_real_swimming_ready` (3418) and `human_real_swimming` (3415).
- **Anchor rope:** Climb plays `100_pirate_bubbles_spotanim` and moves the player to 3769,3898 after 2 ticks, with no fade.

## Oxygen (Wiki)

- **Drain:** 1% every 3 ticks.
- **Kept full by:** a fishbowl helmet with a diving apparatus, or the Medallion of the Deep.
- **At 0%:** the player drowns, taking no damage. They lose 10-20 of the mermaid's tears they carry and wake on the small island. The drowning message is ours; nothing captured it.
- **Pufferfish:** Puff, underwater, uses one up: `human_inhale_pufferfish` (7701), "You depuff the pufferfish, restoring some of your puff." and 15% oxygen (rsprox 234/03299 t18111: 480 to 630). Live also lets the depuffed fish (NPC 7781) swim off from the player's tile; that isn't done. Out of the water it does nothing here (no capture).
- **Not done yet:** air bubbles refilling oxygen, catching pufferfish on the sea floor and charging the merfolk trident with them, and the "Your hands are full." swim prompt.

## Underwater Agility and Thieving

`plugins/areas/fossilislandunderwater/Tears.FossilIslandUnderwater.js` and `Training.FossilIslandUnderwater.js`, data in the same JSON (`tears`, `training`). From the rsprox captures 231/00712-00715 (the main game, Thieving 99) and 234/03273 and 03299 (Grid Master event worlds, whose searches all succeed, so only their timings are used), and the [Wiki](https://oldschool.runescape.wiki/w/Underwater_Agility_and_Thieving).

- **The open chest or clam:** one of the 54 sea-floor chests and clams (the cache's closed locs 30972 and 30970, `tears.spots`) is open at a time, for the diving player alone: the open loc (30971, 30969) is the player's own object over the cache's. It stays open 100 ticks; about 3 ticks after it closes another opens, chosen at random (the captures open the same one twice in a row too, and show gaps of 1 to 3 ticks: 231/00715 t307-308, 231/00714 t98-101; 3 is used). Nobody else is seen in the area in any capture, so each player has their own. Which one opens first on a dive, and when, isn't captured: one opens as the player arrives.
- **The hint arrow** stands on the open loc's west side (height 128), sent again every 3 ticks with `current_hint_arrow` (varbit 14192) going to 0 and back to 6, as captured.
- **Found:** the first search on a dive gives no tears. It answers "You have successfully found an open chest; the mermaids will reward you from now on." (or clam) and Mairin's "Thanks, you should be able to get some tears from the next chest!" (all six captures), and that opening then only gives "You'll have to wait for the next chest or clam to open." (231/00715 t155-165; the Wiki's "the very first clam or chest will not reward any tears").
- **A chest or clam shuts** (`fossil_loc_clam_shut`, 7673) the tick before it closes (231/00713 t81-82, 231/00714 t97-98). The open animation (7674) isn't played: at each new opening live plays it on 4 to 12 other chests and clams nearby (231/00713 t83-84, 231/00714 t99-100, 231/00715 t102, 205, 308).
- **Search:** `human_swim_steal` (7707) at once, the outcome a tick later; each click is one search. A success is `human_swim_steal_success` (7709), sound 73, a glistening tear and a mermaid's tear, and 4.5 Agility and Thieving XP. The first search of each opening always succeeds (7 of 7 captured); later ones roll the Wiki's chart, 12.1% at Thieving 1 to 16.0% at 99 (low 30, high 40; captured 23 of 115 at 99). A success can be followed by another search the next tick. A miss is `human_swim_steal_fail` (7708) a tick after the steal, then `human_swim_steal_fail_end` (7710) and the nibble, "You jerk back as something nibbles your hand." (spam), a tick later, the next search no sooner than the tick after (231/00715 t292-297). 37 of the 92 captured were "...and lose some breath.", 2% oxygen. On anything not open: "You'll have to wait for the next chest or clam to open." Without room, "You don't have enough inventory space." is ours (no full-inventory search was captured).
- **Mairin's Training** (her fourth op; the rows answer only while 287 is open): if1-if4 (varps 261-264) get the whole XP a tear gives, then `fossil_underwater_training` (287) opens. Its rows (287:3 Agility, 287:5 Thieving, 287:7 both) take Exchange-1, -5, -X ("How many glistening tears do you wish to exchange? (N)") and -All. A tear gives level squared times 0.027 Agility or 0.099 Thieving XP, or 0.018 and 0.066 for both, cut to a tenth, and the exchange pays the tears times that, rounded down: every captured exchange fits (234/03299: 251 tears at Agility 83 for 46,686; 220 at 85 for 42,900; 458 at 87 for 93,569; 310 at 90 for 67,797; 231/00715: one at 99 for 264 Agility or 970 Thieving, 3 split for 529 and 1,940; 234/03273: 83 split at 62/80 for 5,735 and 35,059). The varps are sent again after an exchange.
- **Wiki, not captured:** at most 700 tears go in one exchange, and Mairin confiscates the rest of an Exchange-All ("Mairin confiscared a further N tears; she did not approve of how many you had.").
- **Not done yet:** the numulites and unidentified fossils a search can find (Wiki; the captures' rates are boosted event worlds'), and Mairin's talk that sets the activity up.

## Drift net area

- **Ceto** plays her [Wiki transcript](https://oldschool.runescape.wiki/w/Transcript:Ceto) from `npc-dialogues.json`. That covers Talk-to, her Pay option, and the tunnel's Enter and Pay, each its own section. `Ceto.Hunter.js` answers the transcript's conditions (levels, access, numulites) and runs its actions: 200 numulites for the day, 20,000 on "Thanks - no more entry fees for you!", and entering the instance.
- **The tunnel** is a multiloc (30958) on `fossil_driftnet_unlimitedaccess` (varbit 242). Its Pay option goes once access is permanent.
- **Annette** (`Annette.Hunter.js`) plays her transcript and opens "Annette's Nets" (`fossil_driftnet_store` 309 with `fossil_driftnet_sidestore` 307). The cache scripts draw the stored count from varbit 243 and set the ops: Withdraw-1/5/X/All and Banknote-All, Store-1/5/X/All. She holds up to 2,000 nets, noted or not.
- **Not done yet:** the harvest interface `fossil_driftnet` (607). Its Take all, Bank all and Discard all buttons and confirmations are client-side, but no capture shows how the fish are sent to it, so harvesting still uses a chat menu.
- Each player gets their own instance, as the Wiki describes. The player lands inside by the plant door (3737,10299), and the plant door leads back out beside the tunnel (3729,10294). Neither tile is captured.
