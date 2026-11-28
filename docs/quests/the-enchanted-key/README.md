---
quest: The Enchanted Key
key: the_enchanted_key
status: in-progress
tested: 2026-11-28
tester: agent
model: claude-opus-5-5
commit: 7b4080869
cache: osrs-242_2026-11-03
start: checkpoint
travel: travel_to
---

# The Enchanted Key

Aligned with the user's RSProx capture of the whole miniquest (local 1002311, revision 243.1: the
key from the bank, Destroy and buying it back, all eleven treasures, the journal before, part-way and
after) and rsprox.net 1702 (revision 226, another account, nine treasures and a part-way journal).
The treasure route itself is from PR #5302 ([docs/enchanted-key.md](../../enchanted-key.md)). Ticks
below are 1002311's unless another recording is named.

## Findings

- **fixed** The quest list row opened nothing. It is now its own miniquest (quest row 41, list id 98): the journal opens as live sends it, and it counts as a completed miniquest. #5656
- **fixed** Feel used the Wiki's eight-band table. Both recordings send six readings with other cuts (below). 48 of the 74 recorded Feels came out wrong; all 74 now match, each with its own synth.
- **fixed** "It's very hot" had no synth: it is history_key_hot (1200).
- **fixed** Destroy showed the default note. It is live's "Hopefully Erin has a copy!".
- **fixed** After Making History the silver merchant skipped his opener and menu, so his silver stall could not be opened. osrsreboxed-db correction: the opener and "Yes please." / "Ask about the outpost." / "No thank you." (t492-495).

## Capture facts

- **Miniquest state:** enchantedkey (13717) is 1 from Making History's end, and 2 with the last treasure's dig (t2111). makinghistory_locstatus (1391) gains each site's bit with its dig (0 -> 2047, t769-2111).
- **Completion (t2111-2115):** the dig sends "You found some treasure.", 1391 = 2047 and 13717 = 2, then the objectbox with the key (6754, zoom 400): "You find some items, but the key dissolves in your hand." On its continue, miniquests_completed_count goes 5 -> 6. No scroll, jingle or chat line.
  - Not implemented: last_quest_id and the last_completed_quest* varbits (16741, 16767-16773), which live also moves then. No quest in tsps sends them.
- **Journal (119), list child 98, latest_quest_journal 41:**
  - Five struck-out story lines (t343, t481).
  - Then a struck-out "I found some treasure <place>." for each site found, in locstatus bit order, not the order found (1702 t3112 with nine; t2140 with all eleven).
  - Then the navy "I should see what else I can find with the help of the key.". Once all eleven are found it is instead "The key doesn't seem to do anything anymore.", a blank line and the red "MINIQUEST COMPLETE!".
  - With the key destroyed the journal is unchanged (t481).
- **Feel:** a game message and one synth, from the tile the click was sent on (a running player's next step doesn't count, t939). Chebyshev distance to the next site:

  | Reading | Recorded (local 1002311 + 1702) | tsps | Synth |
  |---|---|---|---|
  | The key is steaming. It must be right below your feet. | 1-4 | 0-4 | 1201 history_key_steaming |
  | Ouch! It's burning hot | 5-16 | 5-30 | 1197 history_key_burning |
  | It's very hot | 43-57 | 31-58 | 1200 history_key_hot |
  | It's warm | 59-117 | 59-120 | 1202 history_key_warm |
  | It's cold | 125-450 | 121-500 | 1198 history_key_cold |
  | It's freezing | 505-1297 | 501+ | 1199 history_key_freezing |

  - Past 4 squares a reading after an earlier one adds " and warmer than last time", " but colder than last time" or " and the same temperature as last time".
  - The comparison starts over after a treasure is found (t777), but not when the key is destroyed and bought back (t512).
  - A double-click in one tick is answered one per tick (t1942-1943), engine pacing that isn't part of this miniquest.
- **Dig:** human_dig (830) and digspade (1470) on every dig. Every find was within 4 squares, diagonals included (several at exactly 4). Digging again on a found site: "Nothing interesting happens." (t772).
- **Destroy (t471-474):** confirmdestroy_init with "Are you sure you want to destroy this item?" / "Hopefully Erin has a copy!"; Yes removes the key with synth 2381.
- **Silver merchant, key lost (t492-510):**
  - "Silver! Silver! Best prices for buying and selling in all Kandarin!" (chatneu2), then the menu "Yes please." / "Ask about the outpost." / "No thank you.".
  - "Ask about the outpost." isn't said back: "Hello again." ... "What I came to ask was: I lost that key you gave me." / "Oh dear, luckily I found it, but it'll cost you 500gp as I know it's valuable." (chatneu2), then "Yes please." / "No thanks.".
  - "Yes please." takes the 500 coins and gives the key on "Thank you, enjoy!". The route is unchanged.

## Recorded differences and Ours

- **Feel bands follow the recordings, not the Wiki** (user decision, 2026-11-28). The Wiki's table (hot 61-100, warm 101-400, cold 401-700, very cold 701-1000, freezing over 1000) disagrees with every recorded Feel past 58 squares, in both revisions; neither recording ever sends "It's hot" or "It's very cold".
- Ours: the cuts between recorded samples. Burning keeps the Wiki's 30 (inside 16-43), and 58, 120 and 500 sit in the gaps 57-59, 117-125 and 450-505.
- Not captured, from the Wiki: the merchant's "You don't have enough money, sorry." and full-inventory answers; "No thanks."; and his talk once the key has dissolved.
- Not captured: the merchant's "Yes please." and "No thank you." after Making History; they keep the before-the-quest answers. The quest list row before Making History opens nothing (live's overview text for it isn't recorded).

## To record

- Feel at 17-42, 58, 118-124 and 451-504 squares from the current site, to fix the cuts.
- The silver merchant after the key has dissolved, and "No thank you." / "Yes please." on his first menu after Making History.
- The quest list row before Making History is complete (the overview's start text).

## Runs
