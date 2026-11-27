# Kathy Corkat's boat

Kathy Corkat rows players between the Tree Gnome Stronghold (west of it, across the river, just east of Eagles' Peak)
and the Piscatoris Fishing Colony ([Wiki: Kathy Corkat (revision 15315454)](https://oldschool.runescape.wiki/w/Kathy_Corkat?oldid=15315454);
[Piscatoris Hunter area (revision 15399323)](https://oldschool.runescape.wiki/w/Piscatoris_Hunter_area?oldid=15399323)).
It is a Ferries unit, `server/plugins/world/ferries/Kathy.Ferries.js`, members-only like the whole plugin, with its
trips in `server/plugins/world/data/ferries.json` (`piscatoris`, `piscatoris-back`).

Before it, nothing handled her: Talk-to played her transcript's first variant at both docks (the pre-quest Eagles'
Peak talk, also at Piscatoris), its "Kathy Corkat rows you..." steps moved nobody, and Travel did nothing.

## The two Kathys

| Dock | Spawn (`npc-spawns.json`) | What the player sees (cache) |
| --- | --- | --- |
| Tree Gnome Stronghold | `swan_boat_boatwoman` (6207) at 2368, 3486 | A multi-NPC on Swan Song's varbit 2098: 0-4 shows `swan_boatwoman_1` (4298, Talk-to), any other value `swan_boatwoman_2` (4299, Talk-to and Travel). Swan Song starts at 5. |
| Piscatoris Fishing Colony | `swan_boatwoman_2` (4299) at 2357, 3640 | Talk-to and Travel. |

The unit tells them apart by the spawned NPC's base gameval.

## The fare

Northbound costs 50 coins until Swan Song is started:
[Wiki: Swan Song (revision 15377580)](https://oldschool.runescape.wiki/w/Swan_Song?oldid=15377580) says "To use the
boat, you must either pay Kathy Corkat 50 coins, or charm her while wearing the ring of Charos. After you have started
the quest, you will not need to pay her again." Feedback on
[Talk:Swan Song (revision 15126500)](https://oldschool.runescape.wiki/w/Talk:Swan_Song?oldid=15126500) agrees it is
free before the quest's end ("It happens some point prior in the questline") and links [screenshots](https://imgur.com/a/vfahD9t) of a player at
the quest's Sea Troll Queen step being rowed north with an empty inventory. The cache shows the Stronghold Kathy's
Travel from the quest's start.

Other Wiki pages say she is free after the quest: [Kathy Corkat](https://oldschool.runescape.wiki/w/Kathy_Corkat?oldid=15315454),
[Piscatoris Hunter area](https://oldschool.runescape.wiki/w/Piscatoris_Hunter_area?oldid=15399323),
[Piscatoris Fishing Colony (revision 15376333)](https://oldschool.runescape.wiki/w/Piscatoris_Fishing_Colony?oldid=15376333),
[Ring of Charos (revision 15411945)](https://oldschool.runescape.wiki/w/Ring_of_Charos?oldid=15411945) ("unnecessary after completion
of Swan Song as travel becomes permanently free") and Swan Song's own rewards list. The walkthrough's sentence is
followed: the newest first-hand report, the Talk:Swan Song feedback (September 2025), fits it. The
sentence is in the page's first revision (2006); the others date from 2014 to 2025.

The way back is free. Her transcript's Piscatoris variants, before and after the quest, take nothing, and RuneLite
shortest-path's transport data charges nothing for it. The Wiki's
[Eagles' Peak (mountain) (revision 15370258)](https://oldschool.runescape.wiki/w/Eagles%27_Peak_(mountain)?oldid=15370258)
says the trip from the colony "costs 50 coins" ("50 coins each ride"); her transcript is followed.

## Talk-to

Her transcript (`npc-dialogues.json` "Kathy Corkat") has a variant for each dock, before and after Swan Song's
completion. The unit switches at the quest's start instead: the before variants until then, the after variants from
then on (ours, as the fare ends there). Before the start, "Alright, I'll pay." takes 50 coins and starts
the trip. The other variants' "Yes please." starts it for free.

## Travel

Travel rows at once, with no conversation (the video), and is free: the Stronghold Kathy shows it only from the
quest's start, and the way back is free.

## The trip

No packet recording shows it: the rsprox archive has nothing with her lines or the trip's text, and the three
recordings that have one of her NPCs (3275, 3414, 1440) are not decoded here.

The timeline comes from [Swan Song Quest | OSRS Quality Quick Guide [2025]](https://www.youtube.com/watch?v=JWG9F3uWwWc&t=205s)
on YouTube: its part on getting to the quest start lists Kathy's boat last, with example footage from 3:25 of Travel at
the Stronghold (the coins stay at 200). The Talk:Swan Song screenshots also show the box without its continue on the
black screen, and the player beside the Piscatoris boat afterwards.

The footage plays at double speed (an inference): its fades take 0.5 s where the fade every captured ferry sends
(`fade_overlay`, script 948 over 50 client cycles) takes 1 s, and at double speed every event lands on a game tick,
the fade back in on tick 5 as on the captured Varla riverboat (`docs/varla-riverboat.md`). The chat panel's timer,
which changes on game ticks, moves one step in 0.317 s of video (0.63 s at double speed, about one 0.6 s tick).

| Video | Real time | Tick | Ours |
| --- | --- | --- | --- |
| 207.32 | 0 | 0 | Message box "Kathy Corkat rows you down the river to the sea..." without "Click here to continue", and the fade out |
| 207.82 | 1.0 s | | Fully black |
| 208.35 | 2.0 s | 3 | The minimap shows the new place, between tick 3 (208.22) and tick 4 (208.52): the move |
| 208.82 | 3.0 s | 5 | The fade back in |
| 209.32 | 4.0 s | | Fully visible |
| | | 7 | The overlay closes (the Ungael boat's tick) |
| 209.72 | 4.8 s | 8 | The box gains its continue |

The minimap stays on throughout and shows the new place while the screen is black, so the move came on tick 3 at the
latest; tick 3 fits best, as the client takes a moment to load the new area (an inference). It is also the Ungael
boat's and the riverboat's captured tick.

The landings are RuneLite shortest-path's tiles beside each dock's row boat (loc 9538 at 2358, 3641 and 2368, 3487),
checked walkable in the cache: 2357, 3641 at Piscatoris (the video shows the player there, west of the boat) and
2368, 3486 at the Stronghold (shortest-path only). The way back plays the same, with "Kathy Corkat rows you up the
river..."; no video or screenshot shows it.

## Not from OSRS (server/AGENTS.md rule 10)

The OSRS Wiki's transcript ([revision 15217917](https://oldschool.runescape.wiki/w/Transcript:Kathy_Corkat?oldid=15217917))
is marked incomplete and has neither of these; their words come from the RuneScape Wiki's
([revision 36847174](https://runescape.wiki/w/Transcript:Kathy_Corkat?oldid=36847174)), whose other lines are the
same:

- Without 50 coins: "I haven't got that much with me." and "Ooh, and you almost had me persuaded!" in place of the
  fare's menu (and, ours, when the coins are gone by "Alright, I'll pay.").
- With a Ring of Charos(a) worn: the fare's menu also offers "[Charm] A lady this beautiful shouldn't be so afraid!";
  she answers "Oooh, you shouldn't tease a poor girl so! But I'll take you downstream if you like!" and rows for free.
  That the ring makes the trip free is the OSRS Wiki's ([Ring of Charos](https://oldschool.runescape.wiki/w/Ring_of_Charos?oldid=15411945):
  "Free trips to the Piscatoris Fishing Colony").

The RuneScape Wiki offers the charm only with 50 coins carried (under "With 50 coins:"). The OSRS Wiki's Swan Song page
reads the ring as an alternative to the coins ("either pay Kathy Corkat 50 coins, or charm her while wearing the ring
of Charos"; its recommended items: "50 coins or a ring of Charos"), so with the ring the menu shows without the coins too, and
"Alright, I'll pay." without them gets her two lines above (ours).

`server/tests/kathy-corkat-boat.test.cjs` plays both docks with the real engine, tick by tick.
