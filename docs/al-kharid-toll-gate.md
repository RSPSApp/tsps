# Al Kharid toll gate

`server/plugins/objects/AlKharidGate.plugin.js`, tests in `server/tests/wooden-gate.test.cjs`.

The gate between Lumbridge and Al Kharid is two cache locs, 44598/44599
(`kharidmetalgateclosedl`/`r`), that resolve per player from Prince Ali Rescue's varp 273:
44052/44053 (Open, Pay-toll(10gp)) before the prince is rescued and 44050/44051 (Open only)
after.

## Sources

- OSRS Wiki, [Toll gate](https://oldschool.runescape.wiki/w/Toll_gate): players who have not
  completed Prince Ali Rescue pay 10 coins, and "Completing the majority of the quest will allow
  players to pass the gates for free". Since 27 April 2022, after the quest "the Open option will
  directly open the gate instead of initiating a dialogue with the guards".
- rsprox captures of Open: recordings 321, 326, 1050, 1051 (south leaf) and 1054, 1626, 1693,
  1702 (north leaf). Every recorded Open swung the gate with no dialogue, so these players were
  past the rescue. The toll path has no capture.

## Behaviour

| Case | What happens |
| --- | --- |
| Open, before the rescue (stage < 100) | Border Guard dialogue; "Yes, ok." with 10 coins pays and crosses |
| Pay-toll(10gp) | Pays and crosses; "You don't have enough coins." without 10 coins |
| Open, after the rescue (stage 100+) | No dialogue: the gate swings and the player walks through |

Open goes straight through from stage 100 (the rescue), which already grants free passage. The
cache agrees: 44598/44599 resolve to the Open-only variants once varp 273 is 100 or more, and to
the Pay-toll variants below that. Hassan completes the quest at 110.

Captured crossing (recordings 326, 1050, 1051, 1693), all on one tick: sound 69, an
`inviswall` (38848) on both closed-leaf tiles, the option-less open leaves
`inacmetalgateopenl`/`r` (1573/1574) one tile west, and the player's step through the gate
line. Two ticks after it opened, the closed leaves come back and the open leaves are removed.
Clicking the south leaf gives a left (face 3) and a right (face 1) open leaf. Clicking the north
leaf gives two left leaves (recording 1693; the facts for 1054, 1626, 1693 and 1702 show only
`inacmetalgateopenl`).

## Guard dialogue

Talk-to on a guard (user's rsprox recording 1001336, tick 3099) sends `if_setnpchead
chat_left:head` with the clicked guard (`borderguard1`, 4287) and names it "Border Guard". The
Wiki transcript labels the guard "Guard"; the dialogue export resolves that label to the page's
own NPC (`speaker_ids` 4287/4288, RSPSApp/osrsreboxed-db#148), so the line shows the clicked
guard's head rather than the first cache NPC called "Guard" (#6762).

Recorded differences, where the Wiki's wording is kept: live names the speaker "Border Guard",
the Wiki "Guard"; live says "a toll of ten gold coins", the Wiki "10 gold coins".

A crossing that starts from the guard dialogue waits one tick before the step. Stepping when the
dialogue packet arrives shows on the client as a two-tile jump. The gate still shuts two ticks
after it opened.
