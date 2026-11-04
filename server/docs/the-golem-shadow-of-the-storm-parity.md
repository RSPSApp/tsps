# The Golem / Shadow of the Storm — route parity

Quest Helper source (pinned by the coordinator):
[TheGolem.java](https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/thegolem/TheGolem.java),
[ShadowOfTheStorm.java](https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/shadowofthestorm/ShadowOfTheStorm.java),
[IncantationStep.java](https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/shadowofthestorm/IncantationStep.java).

Cache ids come from this checkout's cache (revision 241), not from the guide.
Packet evidence is RSProx capture https://rsprox.net/download/3333, which covers both complete
routes. Where the guide and capture disagree, the capture wins and the difference is noted.

## Validation status
Descriptive "native"/parity below means the plugin path and focused tests, not a full MCP pass.
The Golem is a current full native pass (native3, unchanged, reward and relog verified). Shadow
of the Storm's previous run stopped at native3 stage 110; native4 is still not a full pass.
This candidate reworks the ritual/fight scenes from capture 3333 and has focused red/green tests
only (see "Validation status" below). Current full native passes across the issue are six (The
Golem, Throne of Miscellania, Shades of Mort'ton, Tai Bwo Wannai Trio, Scrambled!, Royal
Trouble); no all-32 claim.

## The Golem

| Route node | Server behaviour | Source |
| --- | --- | --- |
| Start at the Uzer golem | `Clay golem` transcript, stage 1 | Quest Helper `talkToGolem` |
| 4 soft clay repairs | Consumes clay, `golem_clay` 1-4, NPC 6277 transforms to 5134/5135/5136 | varbit 348 transforms `[5134,5134,5135,5135,5136]` |
| Letter on the floor | Spawned at 3479,3092, readable, `golem_b` 1 | Quest Helper `pickUpLetter` |
| Enter ruins / strange implement | First ruin entry sets `seen_underground`; implement spawned at 2713,4913 | capture tick 408 |
| Elissa | Notes location advances `golem_b` to 2 | capture `golem_b` 1 -> 2 |
| Exam Centre bookcase | Only 6292 at 3366,3332 gives Varmen's notes; no stage change | capture ticks 622-624 |
| Reading the notes | Item action sets `golem_b` 3 | capture tick 548 |
| Curator conversation | Moves stage 2 -> 3; pickpocket requires `golem_b` 3 | capture tick 926 |
| Museum case | Key opens 24626, `retrieved_statuette` 1 | varbit 355 transforms 24626 to the empty case |
| Alcove puzzle | D at 2725,4896 accepts the statuette; each Turn changes only the clicked alcove; A/B/C can be turned before D is placed | varbits 349-352, targets a=1 b=1 c=0 d=2; capture ticks 1020-1031 |
| Portal / throne room | 6310 -> (2720,4884,2); first-entry skeleton line at stage 5 only; 6282 -> (2721,4911,0) | capture ticks 1042 and 10719 |
| Open golem head | Implement sets `head_open` 1 and plays only the opening message | varbit 353; capture tick 1251 |
| Golem program | Used at stage 7; completion keeps `head_open` 1, which clears two ticks later with "The golem's skull shuts automatically." | capture ticks 1257-1262 |
| Lost statuette recovery | Curator hands a replacement before the alcove placement | Quest Helper statuette tooltip |

Item/monster ids: letter 4615, notes 4616, key 4617, statuette 4618, implement 4619, mushroom 4620,
feather 4621, ink 4622, quill 4623, program 4624.

## Shadow of the Storm

| Route node | Server behaviour | Source |
| --- | --- | --- |
| Reen start gate | Refuses with the generic requirement message unless The Golem and Demon Slayer are complete (no refusal branch exists in the transcript) | Quest Helper requirements |
| Wizard/helper recruitment | Dave, Badden, Reen, golem bits, only four helpers | transcript conditions |
| Kiln search | Wrong kilns leave `agrith_kiln` alone; the hidden kiln gives the tome | Quest Helper `searchKilns` |
| Throne room | The captured room is an instance copying source plane 2 (zones 338-341, 609-614 at 2704,4872); the plugin uses the existing QuestScenes/PrivateArea at those source tiles. 6310 enters at (2720,4884,2), 6282 leaves at (2721,4911,0) | capture t1808, t2017, t2362; Wiki instance notice |
| Room dressing | 14 standing torches (including the inner north-west flinch torch at 2718,4905 and the outer 2712,4905), fire remains and four campsite beds are placed into the scene. Summon standards 10253 at 2723,4912/2717,4912 are shape 11, not shape 10. The `3550 inviswall_serverside` corridor exists only on the initial t1808 visit and is deleted at t1857 before the ritual visits; it is not added to the ritual/fight room. | capture t1808-t1857/t2017/t2362/t2398; Wiki flinching note |
| First ritual circle | Seven actors ring 2720,4900 on plane 2: Denath 2720,4903; Eric 2722,4898; Tanya 2718,4898; Matthew 2722,4902; Jennifer 2723,4900; Patrick 2717,4900; Dave 2720,4897. Every actor faces the centre | capture t2065-t2092 |
| First incantation | Click the sigil's `Chant` at (2720,4903,2); Denath speaks Nahudu Caldar Tarren Agrith-Naar Camerinthum, and the varbits store the reverse. Each word moves the camera out to 2726,4903..2722,4907 and plays `summon_summon_start` 2879; completion plays `summon_summon` 2880 with graphic 480, then Denath walks to 2720,4900 and plays `denath_leave` 2888 | capture t2050-t2101 |
| Post-first ritual | Magic circle 10252 at (2719,4899) appears at t2095 and is deleted at t2104; Denath leaves, BOOM plus shake 15, then portal 10251 replaces the open portal at (2719,4883) at t2116, camera reset. The loc lifecycle is phase-owned, not static dressing. | capture t2095-t2123 |
| Tanya's sigil | Player returns to (2721,4911,0). Tanya 919 (facing south) and three ghosts 1989 (facing Tanya at 2722,4905) spawn; Tanya plays 425 then death 836, the ghosts play 5532, the sigil drops at 2722,4905 and the camera resets | capture t2139-t2150 |
| Final ritual circle | The seven second-ritual actors stand at Reen 2722,4898; Badden 2722,4902; Dave 2720,4897; Matthew 2718,4902; Jennifer 2717,4900; Patrick 2718,4898; golem 2723,4900, all facing 2720,4900. Words play 2879 (golem 2884); completion plays 2880 (golem 2885) with graphic 480. At t2455 circle 10252 returns, the closed portal 10251 is removed and 6282 is open again; circle 10252 is deleted at t2464. | capture t2420-t2464 |
| Agrith-Naar summon | Agrith appears at 2719,4899 with `qip_ds_delrith_summoned` 4623 and graphic 482, initially facing Matthew; the summon camera then frames the fight and resets | capture t2455-t2475 |
| Agrith-Naar combat | Melee 4679 up close by default. Fire Blast (anim 69, projectile 130, start/end graphics 129/131, max 10) when out of melee or against Protect from Melee. Out of range with Protect from Magic, Telekinetic Grab pulls the player against his 3x3 footprint, and skips safely if no legal tile exists. He does not walk. The final blow requires Silverlight equipped **and** the killer in melee footprint range, even when the last damage is a spell or poison. The effective flinch is the inner NW torch at 2718,4905, which turns magic reach from true on the bare template to false with the captured locs. | Wiki /w/Agrith_Naar, /w/Shadow_of_the_Storm; cache `demon_casting`; cache NPC 911 magic 100/attack 83/HP 95 |
| Post-quest portal | 6282 remains usable after completion and returns the player to (2721,4911,0) | Merged PR 2206; recorded in-quest exit route and tested shared Portal dispatch |

## Capture provenance

- RSProx submission 3333, revision 235, downloaded archive `/private/tmp/cap3333/3333.bin`
  (gzip, 727,906 bytes, SHA-256 `77513a3f73e358ddc0d7e22443c9b8e7f765ecabcbb9f324e07ba39e5c4da181`).
- Decompressed blob decoded with the pinned rsprox libs: 214,605 packets over 15,180 ticks.
  Raw/account-bearing captures remain outside Git; only the target facts above are recorded.
- Relevant stage values on parent varp 602: 10 at t1351, 20 at t1752, 30 at t1807,
  40 at t1851, 50 at t1881, 60 at t1944, 70 at t2034, 80 at t2050, 90 at t2092,
  100 at t2147, 110 at t2406, 120 at t2455, 124 at t2490 and 125 at t2499.
- Instance palettes: t1808 -> centre zone (1458,249), t2017 -> (1434,273), t2362 -> (1482,321);
  all three are the same 24-chunk palette copying source zones 338-341 x 609-614, source level 2
  (region 42,76) onto target instance plane 0. The candidate uses the source tiles directly
  (QuestScenes convention) and does not claim REBUILD_REGION death parity.

## Validation status

This candidate is source review plus the focused `server/tests/golem-storm-quest-parity.test.cjs`
suite (30 tests after integrating the two upstream portal cases). That includes a real native section using `Player`/`PlayerSession`/`PacketSender`,
cache `NPC`, `PrivateArea`, `TaskManager`, `World`, `CombatFactory`/`Combat`/`PendingHit`, and the
loaded cache map. It proves:

- both ritual casts share the player's private scene, face the centre, and receive their cached
  animation updates; logout and leave remove the owner-only actors and scene locs;
- a wrong first ritual ends its scene, and a retry opens a fresh scene without stale actors;
- the demon is spawned through `Scenes.actor`, shares the player's private area, and is removed on
  completion/death/logout; a relog during the fight restores demon and cast in one private area;
  the Denath leave callback is player-keyed and identity-guarded so cleanup cannot remove a
  replacement;
- the real combat path selects melee, Fire Blast and Telekinetic Grab; the safe-skip path does not
  force a move when every adjacent tile is blocked; the inner NW torch blocks reach and the demon
  never chases; and `PendingHit` stays within the Wiki/cache max hit 10;
- each selected sequence shares its actor's cache skeleton (humans/golem/ghost/Tanya/Denath/demon),
  not just a matching name;
- source region 10828 plane 2 supplies the temple mesh; the 14 torches/fire/beds/standards and the
  phase-owned circle/portal locs are explicit dynamic additions.

The existing `npc-dialogue-event-entrypoints.test.cjs` also passes all 48 cases after main integration, including two
real `NpcDialogues`/`DialogueManager`/native Continue conversations for the corrected Golem
exchange, with and without a sigil. Both new cases fail against the original generated export
(16/15 spoken lines instead of 8/7). The sigil handoff still consumes one item and advances once.

It is **not** a full native/MCP playthrough: no server, client, browser or listener was started for
this worktree. The room uses QuestScenes/PrivateArea at the source tiles, not a true client
REBUILD_REGION instance, so instance-only death/grave behaviour is not claimed.

## Remaining dependencies and blockers

- **Golem reprogram dialogue duplicate** is fixed at the source in
  [osrsreboxed-db PR 39](https://github.com/RSPSApp/osrsreboxed-db/pull/39), head
  `44fecf07e24792a29098e9357abf62c6a431506d`. Its canonical output was imported byte-for-byte
  after main integration; SHA-256
  `ddf9899dcb0cf2a53343103610d2ddf2db8abb2d267a70304ac68f3674118632`.
  The source correction has a regression; two complete offline generations and all 3,375
  generated files were independently compared. Only the Shadow page changes semantically.
  No generated JSON was hand-edited or filtered at runtime. The source PR remains a merge
  dependency while open.
- **PR 2206** (Shadow exit + RFD shared Portal interception) is merged and preserved from
  main at `68fdf8e4586186947177c4ccfb07563c3489d440`; its two real hook/exit regressions pass
  alongside the new scene tests. This candidate adds no duplicate generic Portal hook.
- A true instance transition, the full cosmetic sound set, and the optional double-sigil Tanya
  glitch are not reproduced. Fire Blast timing uses the cache `CombatSpells.FIRE_BLAST` projectile
  (130, end 20, heights 43/31), not invented values.
- An earlier broad run in the inherited worktree reported failures outside ShadowOfTheStorm.
  It was not repeated on this final main integration; the validation above is the focused
  scene/combat suite, native dialogue entrypoints and selected-variant check. No whole-suite
  passing claim is made.
