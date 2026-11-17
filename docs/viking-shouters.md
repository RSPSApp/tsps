# Jatizso and Neitiznot watchtower shouters

The two Guards on the watchtowers between Jatizso and Neitiznot (plane 2): the Jatizso guard
(`frisd_izso_viking_shouter`, 2372,3801) and the Neitiznot guard (`frisd_iznot_viking_shouter`,
2364,3800). Plugin: `server/plugins/npcs/VikingShouters.plugin.js`, data
`server/plugins/npcs/data/viking-shouters.json`.

## What live does (rsprox captures)

Recordings 3027 (rev 231; Watch-shouting at ticks 5008, 5228, 5331 on the Jatizso guard and
6942 on the Neitiznot guard) and local 1000323 (rev 227, Leagues V; tick 6517 on the Neitiznot
guard).

- **Chant.** Between rounds each guard shouts its island's name, "JATIZSO!" / "NEITIZNOT!",
  every 6 ticks, with a face_angle at the other guard (471 / 1496).
- **Watch-shouting.** On arrival the player's camera moves behind the clicked guard and looks at
  the other one: cam_moveto (2380,3802) height 1000 / cam_lookat (2364,3800) height 128 for the
  Jatizso guard, (2356,3800) / (2372,3801) for the Neitiznot guard, rate 20, rate2 50.
- **Round.** 3 ticks after the arrival (all five) the guards trade 11 insults, one every 5 ticks,
  the Jatizso guard first.
- **Talk-to** ("What are you doing here?" / "I'M ON SHOUTING DUTY!", rec 3027 tick 5212) is the
  generated transcript; its "Can I watch?" choice continues at "Watching the shouting" (Wiki
  Guard (Jatizso watchtower): talking or Watch-shouting "plays a cutscene").
- **After.** Chants stop for the round; the Jatizso guard resumes 56-61 ticks after the round's
  start, the Neitiznot guard 62-66 (we use the medians, 58 and 64). cam_reset comes 63 ticks
  after the round's start in all five. Walking during the round doesn't reset the camera
  (rec 3027 ticks 5012, 5297-5321).

## Wiki over recording

The lines are the Wiki transcripts' (the generated `watching-the-shouting` variant). Recorded
difference: the fifth line after the three Jatizso-guard clicks reads "CALL THAT A TOWN? I'VE
SEEN BETTER HAMLETS!" (rec 3027 ticks 5032, 5251, 5354); after both Neitiznot-guard clicks it is
the Wiki's "CALL THAT A TOWN, I'VE SEEN BETTER HAMLETS!" (rec 3027 tick 6965, local 1000323 tick
6540).

## Ours

- A Watch-shouting while a round still has lines to say joins it (the watcher's camera resets
  with that round's). One after its last line starts the next round, which keeps the earlier
  watchers for their cam_reset. No recording clicks during or just after a round.
- The "Can I watch?" path's timing (camera when the choice's action step runs, round 3 ticks
  later): no recording finishes that conversation.
- The chant phases at startup (Neitiznot 5 ticks after Jatizso) are the first recorded run's.
- The guards face each other with a face-position update where live sends face_angle; same
  direction.
