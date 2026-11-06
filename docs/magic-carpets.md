# Magic carpets

Magic carpets are handled by `server/plugins/world/MagicCarpets.plugin.js`. Each station and each route is listed in `server/plugins/world/data/magic-carpets.json`. `server/tests/magic-carpets.test.cjs` checks the data and replays a ride tick by tick.

The Rug Merchants' conversations are the Wiki transcript in `server/data/definitions/npc-dialogues.json` ("Rug Merchant"), played by `NpcDialogues`. The plugin answers the transcript's conditions and starts a ride once the player's travel line is continued.

## Stations

The stations and their requirements come from the [Wiki](https://oldschool.runescape.wiki/w/Magic_carpet). Take-off tiles, menus and routes come from rsprox captures ([rsprox.net/database](https://rsprox.net/database) recordings 328, 549, 821, 1203, 1788, 1858 and 3170).

| Station | Rug Merchant (NPC) | Take-off tile | Flies to | Needs |
| --- | --- | --- | --- | --- |
| Shantay Pass (hub) | 17 | 3308, 3110 | Uzer, Bedabin camp, Pollnivneach (north) | — |
| Pollnivneach north | 20 | 3349, 3003 | Shantay Pass | — |
| Bedabin camp | 18 | 3180, 3044 | Shantay Pass | — |
| Uzer | 21, shows as 20 | 3469, 3113 | Shantay Pass | The Golem |
| Pollnivneach south (hub) | 19 | 3351, 2942 | Sophanem, Menaphos, Nardah | — |
| Nardah | 22 | 3401, 2916 | Pollnivneach (south) | — |
| Sophanem | 1321, shows as 22 | 3285, 2813 | Pollnivneach (south) | Icthlarin's Little Helper |
| Menaphos | 1322, shows as 22 | 3245, 2813 | Pollnivneach (south) | Icthlarin's Little Helper |

**Quest-locked merchants are multi-NPCs.** Uzer's merchant (21) shows only when `golem_a` (varbit 346) is 10, which is The Golem complete. Sophanem's and Menaphos's merchants (1321, 1322) and their monkey (24) show while `ics_little_var` (varbit 418) is 2 to 26. Icthlarin's Little Helper completes at 26.

**Hubs hide the destinations a player can't reach.** A capture without The Golem shows Shantay's menu as "Bedabin camp | Pollnivneach | Cancel". The plugin hides Uzer the same way, and hides Sophanem and Menaphos until Icthlarin's Little Helper is complete. The Talk-to options carry the same conditions.

## Travel

"Travel" (op3) opens the destination menu with no dialogue. As captured, it is titled "Carpet rides are free!" and lists the destinations in this order:

- Shantay Pass: "Uzer | Bedabin camp | Pollnivneach | Cancel"
- Pollnivneach south: "Sophanem | Menaphos | Nardah | Cancel"
- Menaphos: "Pollnivneach | Cancel"

Talk-to's travel options list destinations in a different order (Nardah, Menaphos, Sophanem at Pollnivneach south).

**Fares are from the Wiki, unverified.** Every captured ride was free (hard Desert Diary done). The Wiki gives 200 coins, 100 with a Ring of Charos(a) worn, and free after the hard Desert Diary. No capture or transcript shows the paid flow, so this server's wording is:

- the menu title "Carpet rides cost 200 coins." (or 100)
- the refusal "You need 200 coins to travel on a magic carpet."

Rogue Trader's reward (Wiki) lowers them to 100, or 75 with the ring: the fare follows varbit 914, which Ali's finishing talk (rsprox 549) or "So what's in this for me?" (3169) sets; see `plugins/npcs/RogueTrader.plugin.js`.

## Talk-to

The captures fix several lines of the Wiki transcript:

- "Greetings, desert **traveler**."
- "I'll try help you as much as I can."
- "**Aww** come on, the joke wasn't that bad."
- "...people **will** become familiar with it."
- Uzer's travel answer is "That sounds good, take me there."
- Shantay's option is "I want to travel to the Bedabin **camp**."

**Topics end in a follow-up menu.** After a topic, live shows "I want to travel by magic carpet. | Tell me about Ali Morrisane. | Tell me about this magic carpet fleet. | I have some questions. | Thanks, I'm done here.", without the topic just asked:

- After Ali Morrisane, the Ali option is left out.
- After the fleet, the fleet option is left out.
- After any "I have some questions" topic, all five options show.

"I want to travel by magic carpet." plays the station's travel lines, the same as "Yes please.". "Thanks, I'm done here." and "No thanks." get only "Come back anytime.", with no player line.

## A ride

Ticks count from sitting down (0). Every route captured since revision 230 follows this order:

| Tick | What live sends |
| --- | --- |
| click + 1 | Chatbox closes; camera `moveto`/`lookat` on the take-off tile; the rider walks to the take-off tile |
| arrival | Song 147, then jingle 132 (length 45,909 ms) |
| 0 (arrival + 2) | `carpet_sit_down` (2266), facing the first step; combat, stats, journal, inventory, worn, prayer, magic, settings and emote tabs close; `toplevel_sidebutton_switch` (915) [9] |
| 1 | `magic_carpet_hidecarpets` (varbit 1773) = 1; `carpet_raise` (2262); appearance update; sound 1196; on most routes a second camera shot |
| 1–9 | `cam_reset` |
| from 1–4 | The path: one exact move a tick, 3 tiles on straight legs, 2 (a run step) on diagonals, with gaps where the rider hovers |
| land − 8 to land − 2 | Camera `moveto`/`lookat` on the landing tile |
| land | `carpet_land` (2263), sound 1195 |
| land + 1 | Varbit 1773 = 0; sequence −1; appearance update; the rider walks one tile east; tabs come back; 915 [1]; `cam_reset` |
| land + 2 | Desert diary task message (Shantay Pass → Pollnivneach is an easy task, → Uzer a medium one) |

**The carpet is in the appearance, not the equipment.** `carpet_raise`, `carpet_land`, the bank turns and `carpet_flying` (6936) all hold obj 5614 "Magic carpet" (right-hand item 6126 = 5614 + 512), and `carpet_sit_down` empties both hands (0). The client only draws an action sequence's hand items, though, not a movement sequence's. So once `carpet_raise` ends, the carpet must come from the appearance: live sends appearance updates at take-off + 1 and at land + 1, and re-sends the worn weapon slot.

The plugin shows 5614 in the weapon slot and an empty shield for the flight (`Player.setDisplayedEquipment`), without changing what is worn, and flies with `carpet_flying` as every stand, walk and run sequence. It sends live's diagonal run steps as exact moves too, on the same tiles and ticks.

**Route timings, captured (ticks from sitting down to `carpet_land`):**

| Route | Land | Recording |
| --- | --- | --- |
| Shantay Pass → Bedabin camp | 72 | 1203 |
| Bedabin camp → Shantay Pass | 67 | 328 |
| Shantay Pass → Pollnivneach | 57 | 1788 |
| Pollnivneach → Shantay Pass | 51 | 328 |
| Shantay Pass → Uzer | 61 | 328 |
| Uzer → Shantay Pass | 57 | 328 |
| Pollnivneach → Nardah | 29 | 328 |
| Nardah → Pollnivneach | 30 | 328 |
| Pollnivneach → Sophanem | 64 | 3170 |
| Sophanem → Pollnivneach | 66 | 328 |
| Menaphos → Pollnivneach | 79 | 328 |
| Pollnivneach → Menaphos | 79 | none: the reverse of Menaphos → Pollnivneach |

Pollnivneach → Menaphos has no capture. Its path is the captured Menaphos flight reversed, with Sophanem's take-off camera and a landing shot like Sophanem's. Only one capture exists of Shantay Pass → Pollnivneach (revision 227), and it uses `cam_target`; its `moveto`/`lookat` shots are kept.

**A logout mid-flight lands the rider** on the destination's walk-off tile, and the diary task still counts. Teleports are refused while flying.
