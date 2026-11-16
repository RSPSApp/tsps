# Andras's boat (Port Phasmatys - Slepe)

`server/plugins/world/ferries/Andras.Ferries.js` (a unit of the Ferries plugin), routes `slepe` and
`slepe-back` in `server/plugins/world/data/ferries.json`, tests in
`server/tests/andras-boat.test.cjs`.

| What | Cache | Where |
|---|---|---|
| Andras (Port Phasmatys) | npc 8267 `slepe_boatman`, Talk-to / Travel | 3671,3543 |
| Andras (Slepe) | npc 8268 `slepe_boatman_return`, Talk-to / Travel | 3662,3278 |
| Row boat (Port Phasmatys) | loc 32601 `slepe_boat`, Travel | 3671,3545 |
| Row boat (Slepe) | loc 32602 `slepe_boat_return`, Travel | 3661,3279 |
| Permanent access | varbit 10150 `andras_perm_unlock` | |

## What live sends (rsprox captures)

- **Travel** on Andras or the row boat (rec 372 ticks 1049 and 1860, recs 373/390/391/392, rev
  231): no dialogue. fade_overlay (174) with script 948 `[0, 255, 0, 0, 50]`; two ticks later the
  player is at 3661,3277 facing west (face_angle 512) at Slepe, or 3671,3542 at Port Phasmatys;
  two ticks after that 948 `[0, 0, 0, 255, 50]` fades back in, and the overlay closes two ticks
  later again. The row boat starts the same timeline one tick after the player reaches it.
- **Talk-to** at Port Phasmatys: "Hello there. Want to travel to Slepe? I charge 10,000 coins for
  the journey." before access (rec 90 tick 10281, rec 1149 tick 1940), "Hello there. Want to travel
  to Slepe?" after (rec 372 tick 14). At Slepe: "Hello there. Want to return to Port Phasmatys?"
  (rec 392 ticks 6807, 6822).
- **Permanent access** (rec 1149 tick 1950, rec 90 tick 10291): after "Yes. Here's 1,000,000
  coins.", varbit `andras_perm_unlock` 0 -> 1, 1,000,000 coins leave the inventory, synth sound
  2114, and the item box (193) with `coins_10000` and "You pay Andras 1,000,000 coins for for
  permanent access to his boat." (the doubled "for" is live's). Then "Thank you so much. Now, do
  you want to go to Slepe?" and Yes please / No thank you.

Both purchase recordings are Leagues worlds; the league task message and notification are left
to the league plugins.

## From the Wiki only

- The fare to Slepe is 10,000 coins, and the way back from Slepe is free (OSRS Wiki, Andras; the
  transcript in `npc-dialogues.json`). No recording pays the fare: every captured trip had
  permanent access.
- Ours: a fare taken silently (the transcript says only "Player gives Andras 10,000 coins.").
- Ours: coins dropped between the question and the answer end the talk (nothing taken, no trip).
