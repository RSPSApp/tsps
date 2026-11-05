# Varlamore quest batches from RSProx 1695

Source: [RSProx recording 1695](https://rsprox.net/download/1695), revision 226. Raw recordings and
transcriptions stay outside the repository (they carry account details). Identifiers were checked
against this checkout's cache (revision 241); dialogue text comes from the Wiki transcripts, and
every quest line in the three captured routes matches them except one typo ("buisness") fixed in
`npc-dialogues.json`.

## Ethically Acquired Antiquities (ticks 7114-7934)

Stages follow varbit 11193 exactly: `0 → 2 → 4 → 6 → 8 → 10 → 12 → 14 → 16 → 18 → 20 → 22 → 24 → 26/28 → 30 → 32 → 34 → 36 → 38`,
each set as the line or box that carries it appears. The side varbits are mirrored as captured;
11202 (Betty told) is never set, and 11207 (the diadem back on display) only after completion,
so the display no longer shows the diadem from the crate search on.

- **Start:** the display opens interface 873 with clientscript 5006's captured arguments, and
  the player's thought follows four ticks later.
- **NPCs:** every NPC is the world's own; the old per-player duplicates of Herminius, the
  visitors, Regulus, Artima and the crews are gone. Visitors are any Citizen, Tourist or Academic
  in the Grand Museum, greeting by kind ("Hi!" for tourists); the informant (citizen or tourist,
  random per player) alone moves the quest to 8. Regulus is the landing site's 12885. The
  charter crew are matched by name at the Cothon and at the Port Sarim dock, where Trader Stan
  keeps his own head and name. The favour menu offers the acceptance beside "Not right now."
  with or without One Small Favour (the export had split it, leaving a "Goodbye.").
- **Item boxes:** tools (29908), sails, notes, key and crate (diadem 29907) show the captured
  item boxes; the display's second look is a plain box.
- **Artima** stitches for three timed four-tick lines with animation 10794, taking the tattered
  sails on the first and handing the repaired ones over on "There we have it!".
- **Betty's notes** open interface 291 with the three captured lines; the first read sets 22
  and closing it plays "What could this mean?".
- **Varrock:** pickpocketing Haig (animation 881) gives the key without advancing the stage. The
  storeroom door is a pass-through: "You use the key to unlock the door.", the open door shown
  for two ticks while the player walks the doorway, sounds 2419/44.
- **Interrogation:** a private copy of the museum with the cutscene Haig (13816), the captured
  camera (moveto 3257,3449 h221, look at the speaker h220, rates 232/100), the Shame-o-meter
  (overlay 881, varbit 11199) starting at 50, the captured -4/+4 opening exchange and
  `cam_rotateby` ±1024 over 5 cycles between speakers. Rounds offer the transcript's fixed
  groups of three; shaming options add 4-9. Reaching 100 sets 32; the flashback runs in the
  Grand Museum with Haig and the thief (13817), their captured walks, run, punches
  (11736/11737), the thief's swing/fall (11738/9101), the pickup, the 210-cycle `ease_out_sine`
  pan and the captured tick offsets, then returns to Haig (34) for the hand-off (36).
- **Completion** (38): 1 QP, 6,000 Thieving, 5,000 coins, Betty's notes removed, scroll model
  29907; the diadem returns to the display 64 ticks later, as recorded.

The client gained `cam_rotateby` (yaw) and the `ease_out_sine` easing for this route.

## Meat and Greet (ticks 7980-8789)

The old plugin used stages 0-7; the cache and capture use `0 → 2 → 4 → 6 → 8 → 10 → 12 → 14 → 16 → 18 → 20 → 22 → 24 → 26`
plus the delivery (11183/11184: 1 asked … 4 sent), recipe portion (11185-11188) and test-kebab
(11189) varbits. Old saves are mapped once.

- **Spice box:** keypad interface 888 with clientscript 7374's captured arguments; code 2546
  unlocks it (sound 2419, plain box).
- **Wolf den:** the den was never enterable before (the alpha was a public spawn nobody could
  reach). Entering crawls (11580) with the captured fades into a private den with the alpha at
  its captured tile and the exit hidden (`opFlags` 0) until the alpha falls; the alpha calls one
  pack wolf ("The dire wolf calls to its pack!"); its death sets meat 3 at once, the pack wolf
  flees, and the exit opens.
- **Recipe:** Emelio's menus show the current portions ("Adjust meat (currently at four
  portions).", "Four (current)."), set each portion varbit as chosen and speak the summary in
  words; 4/2/1/3 passes the taste test. Connoisseurs eat (829) and keep their own heads.
- **Colosseum:** Lelia (now a world spawn at her captured tile) eats a kebab (16) and readies the
  advert (18) with "I think so." / "I need to prepare first.". The advert is a private arena with
  the cutscene minotaur, the captured camera and timing and the announcer; "Oh boy..." starts
  the fight (20): the fighting minotaur, the exit gate and "Are You Not Entertained?". The
  minotaur fights as captured: melee, a "Moo!" magic attack every fourth swing (gfx 2950, impact
  2951 or splash 85) and the "Moooooo!" shout with a camera shake at 50%/25% that makes it a tick
  faster. The kill returns the player to Lelia (22, 24) and Emelio completes (26).

## At First Light (ticks 5134-5763)

The old stage numbering drifted from the capture from 4 on, and bushes could only be picked at
stage 5 while talking to Fox moved the quest to 6, so the poultice was unreachable after
meeting him. Stages now follow the capture (4 Wolf's pyre fox hint, 5 Fox found, 6 poultice,
7 sample asked, 8 sample given, 9 trimmed fur, 10 report, 11 bed repaired, 12 complete) and the
report/bed check/bed repair/distraction/pile/master met/sample/mouse varbits are mirrored. Old
saves are mapped once. The per-player duplicates of Apatura, Kiko and Atza are gone. Picking
(10094, item box two ticks on), crafting the poultice (10097), winding the mouse, the pile's
assembly while Atza chats, and the bed repair with the jerboa tail (10794, 10 Crafting XP) follow
the capture.

## Shared fixes

- The Corsair Curse's line handler replaced every other quest's `before` hook on every line;
  it now keeps them (this is what stopped At First Light's live stage changes).
- `startTranscript` passes the NPC talked to into the dialogue events.
- Quest completion messages carry the captured `<col=081190>` name.

## Verification

`server/tests/p2p-varlamore-group-2-parity.test.cjs` covers each route's stages,
varbits, boxes, menus, scenes, cameras, combat, migration and recovery. Each quest was also
played from a fresh account through the agent MCP on this branch's server with normal
interactions only (talk, options, objects, item use, combat): EAA 2→38 including the door,
interrogation, flashback, completion and relog; MAG 2→26 including the keypad, den, recipe,
advert and minotaur; AFL 1→12 including the bushes, poultice, pile, report, bed and relog.

## Remaining gaps

- The cutscenes do not hide the side tabs (the capture closes them) and use private areas at
  source coordinates rather than dynamic instances.
- Not recorded, so inferred or left as before: the Shame-o-meter's falls and menu order (random),
  a failed interrogation's transition, the pack call threshold (one call at two thirds), a wrong
  keypad code's reply, the failed taste test, re-entering the arena after leaving it (no
  replayed advert), the locked-door message, and the diadem's return mechanism (the 64-tick
  delay is one observation).
- Menu titles use the shared "Select an Option" default; the capture shows "Select an option".
- Emelio and Fox use their concrete NPC ids rather than the capture's multi-NPC roots.
- A complete visual comparison with live OSRS is still outstanding.


## Twilight's Promise (ticks 400–2423)

The next batch uses native `vmq2` stages 0–50 and the individual knight, crest,
Azali and Itzla visibility varbits. It restores the crypt entrance, all four
knight errands, the crate and letter, Azali's escort/rest/fountain sequence,
Mezan's two-style spar, Velam's judgement, Renu's feed and flight, and the
Teomat attack and aftermath. The eight cultists are real combat targets and the guards and
Itzla fight them for real: each pair closes to melee range, trades the captured swing/block
animations, and the hits take hitpoints. Each exchange also refreshes the scripted pair's
combat stopwatch, so `NPC.process()` cannot regenerate the damage between blows, and a
cultist's death is counted at the death itself, so an allied kill counts toward the eight
even though it carries no player damage credit. Mezan
changes protection after a streak of attacks in one style. Progress and scene
cleanup survive logout. Earlier stage values are migrated once.

The judgement now includes Ennius's recorded approach: three westward steps to
(1679,3156), then two northward steps beside Velam at (1679,3158). Recording1695
ticks2033–2040 supplies both legs; strike390 has delay5 and fall836 delay20.
The aftermath uses its scene heads12897/12928 (ticks2392–2399); a global name
lookup had selected generic Guard397. Those bindings apply only to this quest's
owned aftermath. Azali's dunk sits at the capture's two tiles (1755→1757) but plays
as the walk it stands for rather than the recording's 1541 teleport. The fountain tile itself is
clipped and holds the fountain actor, so the last two tiles walk under the same scoped
`movement:ignore-clipping` exemption the other scripted cutscene moves use; the flag is set only
for that move and cleared before the splash. splash10942 waits for that walk, so it lands two
ticks later than the capture.

The crypt gate is now a world loc change: the invisible wall 38848 stands on the
gate tile, the open leaf 50862 swings onto the tile across the doorway, and both
are sent to every player. It shuts two ticks after `ObstacleRunner` reports the
crossing finished, rather than two ticks after the click, so a route from a
distance cannot leave the player walking through a closed gate. "A Matter of
Intrigue" (810) plays and unlocks as the gate opens during the quest.

Quetzal travel uses the cache landing table and interface 874, with saved
unlocks, locked-destination checks and a single flight at a time. The new camera
arc packet is encoded and decoded by the server and client together.

Primio's Varrock service lands at (1700,3141,0), separately from Renu's Fortis
table entry, matching the [pinned RuneLite transport data](https://github.com/Skretzo/shortest-path/blob/65314c02128302402c15c730328030a78ae28f44/src/main/resources/transports/transports.tsv)
and the [April 2024 landing-site swap](https://oldschool.runescape.wiki/w/Quetzal_Transport_System#Changes).
Its first-trip and visited varbits are saved individually alongside the quetzal
snapshot; restoring the whole shared parent varp would overwrite Twilight's Promise progress.

## The Heart of Darkness (ticks 2423–4992)

Native `vmq3` stages 0–76 cover the Queen's visit, inn payment and sleep,
recruit conversations, the four trials, initiation, Tapoyauik and Servius's
ending. World NPCs use the cache multi-NPC roots; temporary actors and objects
belong to private scenes and are removed on exit/logout.

- The first trial saves each player's letter code, direction order and phrase.
  The letter and direction chests use cache interfaces 809/810, real wheel
  values, normal input packets, inventory space checks and recoverable clues.
  Inspecting the three scraps combines them into the completed note.
- The second trial has four combat waves, 16 opponents, finite medical supplies,
  bandages for the player and Itzla, and a retry after the companion falls. Strong
  brawlers warn before their slam. The third trial chooses a saved random traitor
  and uses the transcript's Mictl clues; the fourth is Itzla's nonlethal duel,
  including prayer disabling, a warned sweep and protection against specials.
- The ruins restore their mining blockage, hostile nagua, crabs and traps in the
  private area, including after relog. The route uses the ledges, icy slide,
  platforms, four levers and chain shortcut. The icon puzzle saves its intact
  statue and mural order, rejects wrong elements and penalises wrong sequences.
- The quest's Amoxliatl uses the existing instanced boss encounter with the
  quest variant. Victory advances this quest without normal loot, boss kill counts,
  personal bests, combat achievements or respawn. Servius grants rewards once,
  on the final captured line rather than the later Final Dawn transcript tail.

## Death on the Isle (ticks 5884–7030)

The quest follows native `doti` stages 0–50: uniform theft, staff entrance,
masked party, cellar, interrogation, evidence, accusations, Adala, backstage,
and the staged finale. The butler holds inventory and equipment with their
original slots and metadata, persists both sets, and returns the original gear
on exit. Quest clues are acquired through their actual objects and pickpockets,
and completion waits for the guards' final line.

Adala is a real level-49 opponent with nonlethal win/loss outcomes; interruption
and relog retain a retry instead of granting a win. The accusation and stage
have private actors. The finale uses the captured stage strikes and native
fight varbit. The backstage bookshelf is searchable at its captured placement;
its clue is required alongside poison, clothing and the costumer's answers.

## Additional verification and limits

The extended parity tests cover the new stages, random puzzles, full inventory,
scene cleanup, retries, held-gear metadata, dialogue progression and one-time
rewards. Client camera tests cover the arc decoder and terrain behavior. Live
MCP checks completed Twilight's Promise 0→50, including the escort, Mezan,
Quetzal flight and eight cultists, and Death on the Isle 0→50, including Adala,
all backstage clues and the stage fight. Both completions survived relog;
Death on the Isle returned the original held gear. Final test totals and the
Heart of Darkness route are recorded in PR #680. Heart of Darkness completed
0→76 through all four trials, the ruins puzzle, a real 400-HP guardian victory
and Servius's reward, with stage 76 retained on relog. A normal guardian death
retained stage 72 and allowed a retry without granting victory.

Testing uses fresh quest states with prerequisite quests, ordinary equipment,
combat levels and travel supplied as fixtures. Target quest stages and combat
victories are earned through normal interactions. The scripted tower solver
reads the generated puzzle from that test account's saved state; it submits
normal lock inputs and dialogue choices. Unit tests also cover wrong answers.

The earlier visual gaps remain. Additional known limits:

- Twilight's Promise's allied sparring uses the captured swing/block animations but an
  inferred maximum hit (the capture gives no max hits), and the guards and Itzla cannot die.
- Trial brawler slam damage uses its normal maximum because the available source
  does not specify the special's maximum. Random puzzle distributions, trap
  initial phase and some failure/re-entry presentation are inferred.
- Ruins crabs begin active at the captured crab/ice-block positions; their dormant
  ice-block transition is not reproduced. Nagua use the normal combat system.
- Quest Amoxliatl reuses the existing boss's hazard damage/timing. Quest-specific
  differences from the repeatable encounter have not received a visual comparison.
- Quetzal building, whistles and appearance customisation are outside this batch.
- A full rendered comparison with live OSRS remains outstanding. Camera packet
  changes require the client and server to be deployed together.
