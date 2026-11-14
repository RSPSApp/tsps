---
quest: Contact!
key: contact
status: in-progress
tested: 2026-11-03
tester: agent
model: DeepSeek V4.1 Flash
commit: eaeda7f9f
cache: osrs-241_2026-10-20
start: fresh
travel: not run
---

# Contact!

Capture/source audit of archive recording **101** (revision 227.1, Leagues V). The recording has
its own start and completion messages. A full native route was not replayed in this pass; the
login mirrors for the city/dungeon visibility bits were fixed and checked against a completion
fixture.

## Findings

- **fixed** `contact_people_vis` (3275) was only sent after completion, but capture 101 sets it
  when Osman sends the player back at stage 120, before the quest completes. Login now sends it
  from stage 120.
- **fixed** Login never restored `contact_bankers_vis` (3276), `contact_been_downstairs` (3279),
  the post-quest Menaphos/Osman flags (13866-13871), and it cleared `contact_maisa_invis` (3284)
  at stage 120 although the capture leaves it **1** through completion. All are now mirrored.
- **fixed** Osman leaving the cavern (stage 110 → 120) also sent `contact_maisa_invis` = 0, so
  Maisa's state flipped on the next relog. The boss attack and Osman's exit now both send 3284
  through the same visibility sync as login, so it stays **1** from the boss onwards.
- After the fix, a completed MCP fixture relogged to varp 964 = **1057497986**, the exact value
  recorded at completion in capture 101 (with the lamp-unused state).
- Covered by `server/tests/remaining-desert-parity.test.cjs`.
- **fixed** The dungeon traps (`server/plugins/quests/contact/Traps.Contact.js`, test
  `server/tests/contact-traps.test.cjs`). Four floor-spike traps (`contact_spiketrap_floor` 20271,
  Evade) and six spear traps (`contact_speartrap` 20272, Disable), four locs each (`yarn dump:loc
  20271,20272`). The spike locs cover the 2x2 floor that sets them off. The spear locs line both
  walls, and the 2x2 between them is that floor. Before the fix, walking on a trap did nothing,
  and Evade/Disable printed a random line. From rsprox captures (rec 3015, rev 231):
  - Stepping onto the floor sets the trap off the tick after. The player gets "You accidentally
    set off a trap!" and says "Ouch!", and the four locs play their release: spikes
    `agilityarena_floorspikes_activate` (1111) with synth 1383, spears `speartrap_release` (459)
    with synth 1394. A tick later comes a hit of 10% of current hitpoints, rounded down, plus 10
    (Wiki, Contact!/Quick guide). The four recorded hits fit this exactly: 19/16/18/15 at
    97/69/80/55 HP (ticks 1253, 2128, 2137, 4714).
  - Evade/Disable gives "You successfully evade the trap." / "You successfully disable the
    trap." with synth 2387, then a walk (walk pace) across to the tile beyond, without setting it
    off (ticks 2252, 3027, 3347, 4993, 5924, 5985). If the player is already on the floor, they
    leave towards the clicked loc (tick 2339), or by the nearer edge when level with it (tick
    4815). None of the 8 attempts failed.
  - Ours: no failure roll. The hit is always one tick after the set-off; at tick 2338 the crossing
    that followed delayed it to three. The spike trap at 2138,4408 is crossed east-west, like the
    three recorded ones.

## Runs

### 2026-11-03 — capture/source audit

- **Capture:** [RSProx 101](https://rsprox.net/download/101), revision 227.1, Leagues V,
  `rsprox-101.bin` size 9,262,945, SHA-256
  `4C6BA8BDEF146CFE63A2CDF645A1F31BED50B69F510EBC65803A2C599A40413D`.
  Start `RunClientScript` at tick 7612, line 136056; stage first set at tick 7614, line 136091.
  Completion message at tick 8611, line 157432. Relied on lines ~136050-157440.
- **Wire:** varbit 3274 `contact` in varp 964 bits 0-7. Captured stages:
  `10, 20, 30, 40, 50, 60, 70, 90, 100, 110, 120, 130`.
- **Auxiliary bits at completion (capture):** `people_vis=1`, `bankers_vis=1`,
  `been_downstairs=1`, `maisa_invis=1`, `lamp=2` (both lamp wishes used), and
  `13866-13871=1` except `13872` (baker) `0`. The fixture reproduced every bit except the lamp
  count because it did not use the reward lamp.
- **Rewards observed by the fixture:** 1 quest point, 7,000 Thieving XP, one Combat lamp
  (item 10586), no duplicate on repeat completion. Lamp wishes and Keris reclaim were not
  replayed.
- **Not checked:** a full native playthrough, the Sophanem cutscenes, the Giant
  Scarab fight, full-bag/lamp recovery, post-quest NPC dialogue, visuals and audio/jingle parity.
- **Quest Helper:** bridge unavailable. Pinned source uses `CONTACT >= 50` for the parchment and
  does not define the visibility bits tested here.
