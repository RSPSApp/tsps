# Jardric's rowboat (Fossil Island - Lithkren)

After Dragon Slayer II, Jardric rows players between the rowboat on Fossil Island's north-west
coast and Lithkren. Routes `lithkren` and `lithkren-back`, ops, steps and `talk` entries in
`server/plugins/world/data/ferries.json`, played by the Ferries plugin
(`server/plugins/world/ferries/Routes.Ferries.js`, `Voyages.Ferries.js`). Tests in
`server/tests/ferries.test.cjs`.

| What | Cache | Where |
|---|---|---|
| Jardric (Fossil Island) | npc 7498 `jardric_boat`, multi-NPC; after the quest it shows 8106 `jardric_travel`, Talk-to / Travel | 3661,3849 |
| Jardric (Lithkren) | npc 8107 `jardric_lithkren`, Talk-to / Travel | 3582,3973 |

## What live sends (rsprox captures)

- **Fossil Island to Lithkren** (rec 711, rev 231, tick 5704): Talk-to plays "Hello. Wanting to go
  to Lithkren?", then Yes please. / How are things with you? / No thank you. On the continue after
  "Yes please." the same tick has "You board the boat and travel to Lithkren." (spam),
  fade_overlay (174) with script 948 `[0, 255, 0, 0, 50]`, and the chat closing. A tick later
  `minimap_state` goes 0 -> 2; on the third tick the player is at 3583,3973 facing north
  (face_angle 1024); on the fifth 948 `[0, 0, 0, 255, 50]` fades back in and the minimap returns;
  the overlay closes on the seventh. No `busy` varbit in this main-game recording.
- **Lithkren to Fossil Island** (recs 91 and 1768, rev 227, Leagues V): Travel sends "You board the
  boat and travel to Fossil Island." and the fade on the click; the player lands at 3660,3849
  facing east (face_angle 1536) on the third tick and fades in on the fifth. Rec 711 (rev 231,
  main game) has the Talk-to opening "Hello. Wanting to go back to Fossil Island?".

The Talk-to lines and the boarding messages are in Transcript:Jardric (`npc-dialogues.json`,
variants `standard-dialogue-after-dragon-slayer-ii-fossil-island` and `...-lithkren`). The
ferry starts on the transcript's boarding message step (`OoijAs`, `0P4s9G`), so the line is
sent once, as spam, by the ferry.

## Our rules

- Talk-to plays the post-quest variant for the dock (base npc gameval) once Dragon Slayer II is
  complete (`talk` and gate `dragonSlayerII`); before that the transcript's default and Dragon
  Slayer II's own Jardric dialogue apply as before.
- Travel is not gated: the cache shows it on Fossil Island only once the multi-NPC turns into
  `jardric_travel`, and Lithkren is reached only through the quest.
