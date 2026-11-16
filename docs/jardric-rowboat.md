# Jardric's rowboat (Fossil Island - Lithkren)

After Dragon Slayer II, Jardric rows players between the rowboat on Fossil Island's north-west
coast and Lithkren. Routes `lithkren` and `lithkren-back`, ops, steps and `talk` entries in
`server/plugins/world/data/ferries.json`, played by the Ferries plugin
(`server/plugins/world/ferries/Routes.Ferries.js`, `Voyages.Ferries.js`). Tests in
`server/tests/ferries.test.cjs`.

| What | Cache | Where |
|---|---|---|
| Jardric (Fossil Island) | npc 7498 `jardric_boat`, multi-NPC (varbit 6104); from 65, the rowboat built, it shows 8106 `jardric_travel`, Talk-to / Travel | 3661,3849 |
| Jardric (Lithkren) | npc 8107 `jardric_lithkren`, Talk-to / Travel | 3582,3973 |

## What live sends (rsprox captures)

All from rec 711 (rev 231, main game); recs 91 and 1768 (rev 227, Leagues V) show the same
Lithkren-side Travel.

- **Travel at Fossil Island** (tick 5876): "You board the boat and travel to Lithkren." (spam) and
  fade_overlay (174) with script 948 `[0, 255, 0, 0, 50]` on the click tick. A tick later
  `minimap_state` goes 0 -> 2; on the third tick the player is at 3583,3973 facing north
  (face_angle 1024); on the fifth 948 `[0, 0, 0, 255, 50]` fades back in and the minimap returns;
  the overlay closes on the seventh. No `busy` varbit.
- **Talk-to** opens "Hello. Wanting to go to Lithkren?" at Fossil Island and "Hello. Wanting to go
  back to Fossil Island?" at Lithkren, then Yes please. / How are things with you? / No thank you.
- **Talk-to at Lithkren, Yes please.** (tick 5863): the continue after "Yes please." sends "You
  board the boat and travel to Fossil Island." (spam), the fade and the chat closing on the same
  tick, then the same timeline; the player lands at 3660,3849 facing east (face_angle 1536).

The Talk-to lines and the boarding messages are in Transcript:Jardric (`npc-dialogues.json`,
variants `standard-dialogue-after-dragon-slayer-ii-fossil-island` and `...-lithkren`). The
ferry starts on the transcript's boarding message step (`OoijAs`, `0P4s9G`), so the line is
sent once, as spam, by the ferry.

## Our rules

- Talk-to plays the post-quest variant for the dock (base npc gameval) once Dragon Slayer II is
  complete (`talk` and gate `dragonSlayerII`); before that the transcript's default and Dragon
  Slayer II's own Jardric dialogue apply as before.
- Travel needs Dragon Slayer II complete, or the quest's own arrival on Lithkren
  (`dragon-slayer-ii:lithkren-arrived`, gate `dragonSlayerIILithkren`). The cache shows Travel on
  the Fossil Island Jardric from DS2 varbit 6104 65 (rowboat built), before that arrival; until
  then the click is left to the quest. Live Travel at varbit 65 isn't recorded.
