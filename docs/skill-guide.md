# Skill guide

`server/plugins/interface/SkillGuide.plugin.js` opens the skill guide (`skill_guide_v2`, interface 860) from the Skills tab. The cache's own clientscripts draw the guide and switch its tabs; the server only opens, re-opens and closes it.

The behaviour comes from rsprox captures: 76+ "View guide" clicks on stats across revisions 224–237, for example recordings 1039, 3946 and 3947 (Thieving) and 907/908 (Sailing). Ids are checked against the rev 241 cache.

## Opening it

The stats' second option is "View <skill> guide" (cache script 393 sets it; the first option, "Toggle <skill> XP", only exists on some world types). On that click, all on the same tick:

1. `if_opensub`: `skill_guide_v2` as an **overlay** in the game frame's floater (161:18).
2. `if_setevents`: the list (860:21) with no events, and the tabs (860:7, slots 0–200) with option 1.
3. `script skill_guide_v2_init` (1902) with `[skill, 0, 0, 0]`.

`skill` is the guide's own number for the skill, the fourth argument each Skills tab component gives script 393:

| Guide number | Skill | Stats component |
| --- | --- | --- |
| 1 | Attack | 1 |
| 2 | Strength | 2 |
| 3 | Ranged | 4 |
| 4 | Magic | 6 |
| 5 | Defence | 3 |
| 6 | Hitpoints | 9 |
| 7 | Prayer | 5 |
| 8 | Agility | 10 |
| 9 | Herblore | 11 |
| 10 | Thieving | 12 |
| 11 | Crafting | 13 |
| 12 | Runecraft | 7 |
| 13 | Mining | 17 |
| 14 | Smithing | 18 |
| 15 | Fishing | 19 |
| 16 | Cooking | 20 |
| 17 | Firemaking | 21 |
| 18 | Woodcutting | 22 |
| 19 | Fletching | 14 |
| 20 | Slayer | 15 |
| 21 | Farming | 23 |
| 22 | Construction | 8 |
| 23 | Hunter | 16 |
| 24 | Sailing | 24 |

The captures agree: Attack 1, Strength 2, Thieving 10, Farming 21, Sailing 24.

## Inside the guide

- **Tabs** (860:7): no server response in any capture. The guide's scripts switch them.
- **Close** (860:4): `if_closesub` on the floater.
- **A link to another skill's guide** (860:18, sent by cache script 9190 with `if_triggeroplocal` and one int, the skill's number): the guide opens again on that skill, the same three steps as above.

## PvP worlds

Before opening, the click is offered to other plugins as `skills:stat-clicked` (`{ player, childId, handled }`). `SetSkillLevel` claims it while presets are enabled (PvP worlds) and opens its "Set level" prompt, as before: for combat skills, and for every skill for developers. On every other world, and for other skills, the guide opens.

## Not done yet

- **The quest link** (860:17, cache script 9189, one int): live OSRS closes the guide, sets varp `latest_quest_journal` and opens that quest's journal. tsps quests are defined by name, so the int still needs mapping to a tsps quest.
- **Clicking a list entry**: in the captures only Sailing entries answer, with a game message listing that entry's materials (for example "Adamant keel (skiff): # x Adamant keel parts, # x Lead bar").
- **The `IF_SCRIPT_TRIGGER` event** that live OSRS sets on the two link components is not sent: the tsps client doesn't check it before sending a script trigger.
