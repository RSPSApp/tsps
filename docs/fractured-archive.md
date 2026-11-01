# The Fractured Archive (Raids 4)

Raids 4, released on 2026-10-20, needs the `osrs-241_2026-10-20` cache. It is one members plugin, `server/plugins/minigames/FracturedArchive.plugin.js`, which hands off to one unit per area in `server/plugins/minigames/tfa/`.

Sources:
- Three rsprox captures from release day, all rev 241.1:
  - the lobby, with the first visit and mining;
  - a session that forms a party and makes five attempts at the Archive Guardian;
  - a second session of Guardian attempts.
- The Wiki's [strategies page](https://oldschool.runescape.wiki/w/The_Fractured_Archive/Strategies) and five YouTube boss guides (transcripts), for what a spectator can't see: player-side mechanics such as rolling, absorbing cracks and the tank.
- Five rsprox sessions recorded as a **spectator** on 2026-10-21/22 (rev 241.1): four full clears and two partial runs, parties of two to five. They show the Guardian's kill, the Nexus and its doors, Bork and the Smorks, Ezekiel, Dreadnoth the Jellied with the Quartermaster, Xarth, Ocellus, the vault, and spectating from the Strategy board.
  - A spectator sees every NPC and loc change, map animation, projectile, the boss bar (with its second bar) and the party's health slots, and the followed player's inventory.
  - It sees no fighter's hitsplats, prayers, equipment, experience or messages, no door choice, no shop and no loot. **Every damage figure on players is an estimate.**
- The OSRS Wiki pages [The Fractured Archive](https://oldschool.runescape.wiki/w/The_Fractured_Archive), [Archive Guardian](https://oldschool.runescape.wiki/w/Archive_Guardian), [Chest (The Fractured Archive)](https://oldschool.runescape.wiki/w/Chest_(The_Fractured_Archive)) and [Quartermaster (The Fractured Archive)](https://oldschool.runescape.wiki/w/Quartermaster_(The_Fractured_Archive)).
- The cache: gamevals for every id, and the client scripts for the interfaces.

**Estimate** marks what none of these show.

## Layout

| File | What it owns |
| --- | --- |
| `Shared.FracturedArchive.js` | Ids by gameval name, resolved through `CacheDefinitions` on first use. Also the tiles, the script numbers, and the helpers: fades, prompts, projectiles and timers. |
| `Entry.*` | The Chasm of Tears shortcut, the lobby's exit back, the opening cutscene, and the saved `wgs_tfa_shortcut_unlocked` and `tfa_miniquest`. |
| `Lobby.*` | The lobby `Area`: the party overlay (975) and leaving parties on the way out. Also Montoya's pronoun. |
| `Gathering.*` | The Ascension rocks' rotation, mining, the gathering sprite and the builders' banter. One task runs all of it. |
| `Parties.*` | The party model: up to eight members, applicants, rejections and the leader's preferences. |
| `Grouping.*` | The Grouping Board: the party list (977) and party details (976). |
| `Records.*` | The Alliance records (979): personal attempts, completions, deaths, wipes, failures and best times. |
| `RaidState.*` | `Raid` and the `Room` base class: the private copy of the Archive, the HUD (974), deaths, spectating, wipes, abandoning and logouts. |
| `Raid.*` | The Archive Door, the Passageway, the death, item and login hooks, and the room hooks. |
| `Guardian.*` | The Archive Guardian's room. |
| `Hub.*` | The Nexus between rooms: its section doors, the path taken, the Alliance staff and the Navigator back. |
| `Bork.*` | Bork and the Smorks. |
| `Ezekiel.*` | Ezekiel. |
| `Dreadnoth.*` | Dreadnoth the Jellied. |
| `Quartermaster.*` | The Quartermaster's Alliance Supplies shop and the Supply Credits. |
| `Xarth.*` | Xarth. |
| `Ocellus.*` | Ocellus, his three phases and the four censers. |
| `Vault.*` | The inner vault: the chests, the loot and the Rift out. |
| `Spectate.*` | Spectating a party from the lobby's Strategy board. |
| `Commands.*` | `::tfa`, `::tfaguardian`, `::tfaroom <ROOM>`, `::tfaintro`, `::tfacomplete` and `::tfahp <n> [2]`, all for developers. `::tfaroom` (BORK, EZEKIEL, DREADNOTH, XARTH, OCELLUS, VAULT, HUB) goes in first when needed, marks everything before the room done (the Guardian, each section won along the east side, and for VAULT the raid won) and takes the party there. |

Plugin data lives in `server/plugins/minigames/data/fractured-archive.json`: the intro's actors, camera shots, walk and lines, the rock tiles and the builders' lines, the Nexus staff for each visit, and the vault's loot table. The lobby NPCs are in `npc-spawns.json` at their captured tiles (`"source":"rsprox"`). The Record Keeper's and General Montoya's conversations are in `npc-dialogues.json`.

## Engine changes

- **`PlayerDeathTask.dropItems` / `returnKeptItems` / `loseItemsAsDeath`**:
  - A death's item loss, split out of the death task.
  - The raid keeps its dead in the room with their items and takes them only when the party wipes, as live does.
  - The death task calls the same methods, so nothing changed for other deaths.
- **The `ease_in_sine` camera easing**: the intro's first glide uses it. Added to both the server encoder and the client decoder.
- **BossHud's second bar** (`boss-hud:extra` `{ player, current, maximum, colours, hidden }`): `hpbar_hud_show_extra_bar` (varp 5991), the extra bar's base and current (varbits 16571 and 16570), its colours on 303:24-26, and script 10152 every tick while it shows, as live sends it for Bork's Smorks and Ocellus' charge.
- **NPC base animations** (`NPC.setBaseAnimations({ idle, walk, turnLeft, turnRight })`): live changes an NPC's stand, walk and turn sequences on the fly (rsprox's `[bas]`): the grounded Guardian's ground idle, Ezekiel's weakened stance and finale loop, his swords' idles, Ocellus' loops. A new NPC update block (mask 0x2000: a count, then slot and sequence pairs; slots 0 idle, 1 walk, 2 turn left, 3 turn right; empty resets) is sent while set, as model customisation is, and the client feeds it into its movement overrides. Without it the client falls back to the cache's stand pose whenever an animation ends (the grounded Guardian rising).
- **Loc animations across instance rebuilds** (`LocAnimated.carryOver` in `replaceSceneWithInstance` and WebGPU's `applyInstanceScene`): a loc change in an instance that isn't only doors or only other locs rebuilds the whole scene, which started every animated loc again from frame 0. A held loc animation (a frame-step sequence such as Ocellus' fallen slices, `dungeonkit_guthixian03_collapse_01`) then replayed each time locs were added nearby: the earlier quadrant fell again when the next one did. The rebuilt scene now carries the old one's animations over, as a square rebuilt in place already did.
- **Turned spot graphics** (`GfxCache.placeAsSpot`): a spot graphic's scale and orientation (its `_90`, `_180`, `_270` versions) are applied after its animation, as OSRS's spot animation model does. The client turned the base model first, so the frames moved and scaled the pieces along the wrong axes: on Ocellus' lines (one model, 62692, for the crack, its green flow and the slam debris) the green ran across its line instead of along it, and the slam's debris landed off its ring.
- **Sampled sound effects** (`SoundEffectLoader`, `decodeWithOwnSetup` in `VorbisSample`): from 11988 on (171 sounds in rev 241), a sound effect's archive holds file 1 instead of file 0: an int length, its own Vorbis setup (4,032 bytes, not the music's), then a Vorbis sample (44.1 kHz). The client read only file 0, so these were silent, among them Ocellus' transformations (12819, 12825), his phase two to three (12814), the quadrant destruction loop (12837) and his death (12826). They decode now against their own setup, switched in around the decode so the music samples' shared setup is untouched. Ocellus' other sounds are animation frame sounds (range 31), all synths, which played already.
- **Large NPCs step diagonally** (`MovementQueue.validatedStep`): a step is tried diagonally first for actors of any size, when their whole footprint can make it, then east/west, then north/south. Before, only 1x1 actors took diagonals, so the 3x3 Ocellus walked a diagonal as a staircase; live walks it a tile a tick (captured).
- **NPC fades** (`NPC.fade(to, { from, startCycles, endCycles })`, rsprox's `[transparency]`): live fades NPCs in and out, from 0 opaque to 255 invisible over client cycles of the tick, and they stay at the end value. A new NPC update block (mask 0x8000: start and end cycles as shorts, the value it fades from as a short, 0xffff for its current look, then the value it fades to) is sent the tick it's set. The client keeps each NPC's fade and both renderers draw a fading NPC screen-door dithered (a 4x4 ordered dither on its transparency, in the actor data texture's free channel), which needs no re-sorting between the opaque and alpha passes. `Room.spawn(..., { fadeIn })` fades a new NPC in. A teleported NPC is normally left out of view the tick it moves and added back the next; with a fade (as with an exact move) it stays, so the fade-in reaches the client with the teleport. `::tfafade <0-255> [cycles]` fades the current boss and leaves it there, to check the client.
  - Captured and used: Ocellus' teleports to the middle (out over cycles 30-45, in over 0-20) and his moves between third-phase quadrants (out 0-30 or 0-28, in 0-28); Ezekiel's swords (in as they appear, out over 30-60 of their flight), his fence swords (out the tick before they go) and his death (out over 210-270); the Smork's death (out two ticks before it goes); Xarth's corpses, the Navigator (in over 30) and the vault's rift (in over 90).
  - Not built yet, so not faded: the Alliance escorts (knights, Guardians of Armadyl, druids, Armacus) that fade in at the Nexus.
- **Projectiles**: rsprox prints `map_projanim_v2` heights at four times the packet's, so `Shared.projectile` divides them; and it names the firing actor as the packet's source, as live does, so the client starts the projectile from the model.
- **`MovementQueue.getDestination()`**: where a player's walk ends, for rolling them there (Ezekiel).
- **`Area.handleForcedWalk`**: a walk click the engine refuses because the player is mid forced move (or being placed after one) goes to the player's area first, so the room can chain a roll or a hop at once; other movement blocks still refuse it. The raid's area passes it to the room: Ezekiel's dodges (with `onWalkRoute`, so the click itself rolls the player, with no normal step or wait first) and Ocellus' stepping stones.
- **Camera target** (`PacketSender.sendCameraTarget`, CAMERA_CONTROL subtype 12; OSRS's `cam_target`): the client's follow camera, scene centre, roofs and sound listener follow a tile or another player instead of the local player until a camera reset. `Player.setFixedViewDistance` holds a player's view distance (up to 64) for a spectator.
- **Locs seen below the floor** (`render/loc/SunkenLocs.ts`): Ocellus' void locs (62701-62705) have faces down to 50 units under the floor. OSRS paints a loc after its floor with no depth test, so you see down into them, and their depth shows as the camera turns. Both renderers draw these locs again after the opaque scene. First their faces reset the depth under them to the far plane with no colour (depth range or viewport depth 1). Then they are drawn normally, and their translucent faces follow in the transparent pass.
- **Omnishop buy amounts**: a shop row's `omnishop_buy_q1-4` are codes into enum 5844 (1→1, 2→5, 3→10, 4→50, 5→2, 6→3; client script 10163). Rows without them keep 1/5/10/50, so the existing shops are unchanged; Alliance Supplies buys 1, 2, 3 or 5.

## Getting in

**The Chasm of Tears.**
- After While Guthix Sleeps, reaching the Chasm sets varbit 16354 `wgs_tfa_shortcut_unlocked` to 1. That turns the Blocked cavity (multiloc 62542 at 4050,4567) into the Opening ("Crawl-through").
- The varbit is saved and sent at login.

**Crawling through.**
- `human_longcrawl` and synth 2454 (four loops, delay 4), a fade, and two ticks later the player is in the lobby at 4127,5508.
- The lobby's own Opening (63009, "Enter", at 4126,5505) goes back. It uses the quest's `wgs:enter-chasm` event and lands east of the cavity. *Estimate:* the exit was never used in a capture.

**The first visit** (`tfa_miniquest` 0) plays the cutscene instead:
1. "You have unlocked a new music track: Into the Archive" (891).
2. `cutscene_status` 1, minimap off. The player stands at 4131,5540, and Armacus Selles, Eva Cashien and Ivy Sophista (the cutscene NPCs 16727-16729) stand by the lobby's east wall.
3. The camera: a sweep across the lobby (`cam_moveto_cycles` 500 cycles, `ease_in_sine`), a second one southwards (555 cycles, `ease_out_sine`), a look at Montoya's corner, then onto the three.
4. The player walks to 4135,5548 over ticks 32-39.
5. From tick 41, forty lines of conversation with their captured chathead animations.
   - Ivy's "Hello agai-" and the player's "Thank you, I'll-" are cut off after three ticks without a click.
6. Ivy bows, the three walk off, the screen fades, and the player is in the lobby at 4135,5548 with `tfa_miniquest` 2.

A logout during the cutscene skips it. *Estimate.*

## The lobby

**The overlay.** `tfa_lobby` (975) is on overlay_hud while you are in the lobby (region 16470). 975:5 lists the party's eight members, with "-" for an empty slot. 975:4 is drawn by the client from `tfa_client_partystatus`: 0 "No Party", 1 "Party", 2 "Step Inside Now!".

**NPCs.**
- **Record Keeper.** His conversation ends on "View Stats?", and "Yes." opens the records.
- **General Montoya.** Four options; the "Thank you." branch was never chosen, so it just ends. He quotes Armacus as seeing the flame of justice "in her eyes". The capture's player was female, so the pronoun follows the player's own.
- **Builders.** One says "This bridge will hold a thousand marching soldiers once I'm done with it!", another answers "Stop boasting and get back to work, pal." four ticks later, and sometimes "I am!" follows. *Estimate:* how often they talk.
- **Others.** The Banker and the Bank Chest work as every bank does. The druids, the Temple Knights and the wizard apprentice stand at their captured tiles.

**The Alliance records (979).**
- Opened by "Read" on the records, or by the Record Keeper.
- The client asks for each category's rows with a script trigger on 979:34 (`[category dbrow]`). The server answers each row with script 10125 `(category, stat, party size or -1, current or blank, 0, personal, global, global today, world today)`, then 10124.
- Overall lists attempts, completions, deaths, wipes, failures, and the time for each party size. Each boss lists attempts, completions, practice completions, deaths and the times.
- Only the personal column is kept. The global and world columns stay blank (`-2147483648`).

**The Ascension rocks.** The map places ten rocks as inactive, as `tfa_gathering_rock_inactive01-03`. The rotation:
- Three at a time become `tfa_gathering_rock_active0N` ("Mine").
- Every 289 ticks a new three come up. They are never the three just lowered.
- The rocks going down play `crystal_ascension0N_lower`, the ones coming up `_raise`, both with synth 2661. The wizard apprentice says "The roots are shifting!" from the second rotation on. *Estimate:* when he says it.
- A player mining a rock that goes down stops.

Mining:
- "You swing your pick at the crystal." and the pickaxe's wall animation (`human_mining_<metal>_pickaxe_wall`).
- `tfa_gathering_coord_temp` (varp 5916) holds the rock's packed tile: (z << 28) | (x << 14) | y.
- Success: "You manage to mine some ascension shards.", one `ascension_shards` (34669) and synth 3600. Successes came 20-70 ticks apart with a dragon pickaxe at 89 Mining. *Estimate:* the success chance.
- **No Mining experience is given.** The captures' stat packets carry no usable totals, so the amount is unknown.

**The sprite.**
- `tfa_gathering_sprite` appears beside the rocks once a rotation (synth 10391) and wanders.
- "Look-at" shatters it: `tfa_gathering_sprite_explode`, synth 10467, "The sprite shatters, giving you some ascension shards.", one or two shards, and the loot-tracker script 7192 with live's key 196151.
- *Estimate:* its timing and its 40-tick lifetime.

## Parties

**The list.** The Grouping Board's "Inspect" opens `tfa_partylist` (977).
- Each row is script 10094 `(row, "8 names|members|preferred size|preferred completions|mode|age in ticks")`.
- All 45 rows are sent each time, row 44 last, because that row lays the list out.
- 977:1's buttons: 0 Refresh, 1 Make Party / My Party (by `tfa_mycontroller`), 2 the Friends/Clan filter (varbit 16380, saved).
- 977:14 sub i opens row i.

**The details.** `tfa_partydetails` (976) is drawn as follows:
- Eight script 10053 `(rights, line)` member rows, leader first.
- Then 10058 applicant rows.
- Then 10060 `(rights, preferred completions, mode, preferred size, spectating disabled, tab)`.
- Rights: 0 can apply, 1 member, 2 leader, 3 applicant, 4 can't apply.
- A line is "name|combat|attack|strength|ranged|magic|defence|hitpoints|prayer|completions|practice".
- Both screens count their rows from their onload script, so every redraw opens the interface again, as live does.

976:1's buttons:

| Sub | Button |
| --- | --- |
| 0 | Back |
| 1 | Refresh |
| 2 | Unblock |
| 3 | Preferred size |
| 4 | Preferred completions |
| 5 | Mode |
| 6 | Disband / Leave / Withdraw / Apply |
| 7 | Members tab |
| 8 | Applicants tab |
| 9 | Spectating |
| 10+r | Kick (or quit, on your own row) |
| 18+r | Move up |
| 26+r | Move down |
| 34+i | Accept |
| 41+i | Reject |

The client sends Refresh by itself every ~17 ticks.

Captured details:
- A new party opens on the applicants tab with a preferred size of 4.
- Joining sets `tfa_mycontroller` (varp 5913) to an opaque number. It is -1 outside a party.
- *Estimate:* the rules behind the buttons, modelled on the Theatre of Blood's. A rejected player is blocked until the leader unblocks. Leaving hands the lead to the next member. Leaving the lobby leaves the party.

## The raid

**Entering by the Archive Door** (62768):
1. A messagebox: "You are about to enter the Fractured Archive which is not a safe area. In addition, be aware that the raid uses various flashing effects that may cause discomfort to some users. Are you sure you wish to enter?"
2. Then "Are you sure you wish to enter?" with Yes. / Yes, and don't ask again. / No. The last choice is saved.
3. "You enter the Archive...", `hpbar_hud_show_extra_bar` (varp 5991) 0, `tfa_miniquest` 4, and the lobby overlay closes.
4. A fade, and three ticks later the player is at 4127,5571, then the fade back.
5. Two ticks after that, `tfa_hud` (974) opens on overlay_atmosphere:
   - script 10042 with the eight names;
   - `tfa_client_partyslot` (the viewer's slot, from 1);
   - each slot's `tfa_client_p0-7`: 1-27 health, 30 dead, 31 not in the room;
   - the timer, script 10036 `(ticks, 1 = stopped)`, every tick.
6. Members still outside see "Step Inside Now!". They go in by the door themselves, each joining the raid as they do; the leader has to be first.
7. Nobody can join once the Inert Guardian has been touched (or after it is beaten): "Your party has already started the challenge. You can't join them now." (our wording), and "Step Inside Now!" goes back to "Party".
8. A member who leaves the lobby or logs out before going in just leaves the party and their HUD slot. The raid ends as soon as nobody is left inside it.

*Estimates:* needing a party, and the late-join message.

**The Nexus instance.** Between bosses the party is in the Nexus: map square 64,87's levels 2 and 3, which live copies onto its instance's levels 0 and 1 (captured build_area). On the real map those levels stand on the Guardian's, and the Guardian's level 1 is 392 height units higher under most of the Nexus than under the Archive Door's end (y 5619 north), so drawn in place that end sank a level and a half. The Nexus is therefore a `TemplatedInstanceArea` of its own, copied as live does; the Hub unit keeps using real-map tiles, which the room maps into the instance (and door clicks back). A logout there is saved on the lobby tile.

**Instancing.** One `PrivateArea` per raid covers every other room's map square at the real coordinates. Live copies each room into an instance of its own (each room change is a `rebuild_region`). The area is multi-combat, and teleports are refused ("You can't teleport out of the Archive.", *estimate*).

| Room | Map square | Level | Arrival | Music |
| --- | --- | --- | --- | --- |
| Archive Guardian | 64,87 | 0 | 4127,5571 | 887 |
| The Nexus | 64,87 | 2 | beside the door taken | none |
| Bork | 65,87 | 0 | 4173,5599 | 888 "Bork's Beats" |
| Ezekiel | 63,86 | 0 | 4079,5536 | 890 "Blade of Forgotten Justice" |
| Dreadnoth | 65,88 | 0 | 4174,5664 | 895 "Hellatine" |
| Xarth | 65,86 | 0 | 4175,5535 | 896 "Forged Through Fire" |
| Ocellus | 64,88 | 1 | 4127,5656 (*estimate*) | 893 "Artifacts of Old", then 894 "Ascension" |
| The vault | 64,90 | 2 | 4127,5779 | 147 |

**Moving between rooms.**
- A fade, then the move four ticks later, then the HUD again two ticks after that. A member's slot reads 31 while they move.
- The four boss rooms have an **Archive transporter** (63087; Dreadnoth's is 63134, "Use" / "Quick-use") between the arrival and the arena. It puts the player in the arena: Bork 4184,5599, Ezekiel 4067,5535, Dreadnoth 4184,5663, Xarth 4184,5535. *Estimate:* an instant move, to the tile the captures first show fighters on.
- The leader going through the transporter starts the challenge (the first member if the leader isn't in the room).
- None of the bosses plays a block animation when hit (captured), so each has a combat definition with block -1; the jellies attack with `jelly_attack` and die with `jelly_death`.

**Damage timing.** The rooms' ticks run after each player's turn, where queued damage is applied, so damage queued for "now" landed a tick after its graphic. Damage to players from the rooms and hits due at once are applied on the spot instead, so a ground attack lands on the tick its impact shows (Ezekiel's barrage at the impact's tick, his star at tick 3, the Guardian's ranged at tick 4). Hits with a travel time are still queued for their own tick. NPCs keep the queue, whose death handling the rooms' phase changes use.

**After a win.**
- "Challenge complete: <name>. Duration: <col=ef1020>m:ss.ss</col>. Total: <col=ef1020>m:ss.ss</col>". The Guardian's duration counts from the raid's start, the others from their boss bar.
- Everyone, the dead too, is back to full hitpoints and prayer.
- Music 147, and the Alliance Navigator (16700, "Follow" / "Quick-follow") appears in the arena three ticks later. Following it goes back to the Nexus beside the door the party took.
- After Ocellus: "The Fractured Archive: Total completion time: <col=ef1020>m:ss.ss</col>".

**The timer** (script 10036): `(0, 1)` before the first challenge, `(ticks, 0)` from the raid's start on, never reset between rooms and not sent during fades, and `(ticks, 1)` once Ocellus falls.

**Deaths** in a challenge:
- "You have died. Total deaths: N." The others see the name in red.
- "You will respawn when your party completes or fails the challenge." while anyone still fights.
- Then "Spectating the room. Click a fighting player's health display to spectate them." at the corner tile 4097,5569, with `tfa_client_spectate_mode` 1 and the inventory and combat tabs closed. Items stay with the player.
- Spectate on a HUD slot (a script trigger on 974:5, `[slot, 1]`) sets `tfa_spectate_slot` to the slot + 1. It sends that player's inventory as another's (inv 93 + 32768), opens `tfa_spectate_hud_inv` (978) on side3 with script 158 and "Ping", and says "Spectating NAME...". `[-1, 1]` goes back to the room.
- **Estimate:** a won challenge brings the dead back at the room's entrance.

**A wipe**, two ticks after the last fighter falls:
- The boss bar clears, "You failed to survive the Fractured Archive.", a fade, and jingle 90.
- Three ticks later everyone is at 4130,5560 in front of the door.
- Those who fought lose their items as a death would there, to a gravestone ("Some of your dropped items are being held in a gravestone, near where you died.").

**Abandoning** by the Passageway (62766, placed at 4124,5569):
- A warning: "You are about to abandon the raid. If you do this, you will not be able to return to your current run."
- "Abandon the raid?" with Yes, abandon the raid. / No, I want to stay.
- "You abandon the raid and leave the Fractured Archive.", a fade, and the move to 4128,5559 three ticks later.
- The Passageway's ops are off while a challenge runs (opflags 0).

**Logouts.** *Estimate*, as the Theatre of Blood: a logout in a challenge counts as a death. Logging back in returns the player to the raid while it lasts. If it has ended, they lose their items as the wipe would have.

**Records.** These are counted, as the boards show them: attempts on arrival, deaths, wipes and failures on a wipe, failures on abandoning, each boss's attempts, completions, deaths and best time per party size, and the overall completions and times. The Wiki's death-fee discount for the first five clears is not done.

**Party scaling.** One player counts as two (Wiki). The captured hitpoints for two to five players are below; other sizes follow the last step (*estimate*).

| Boss | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- |
| Guardian shield | 550 | 800 | 1,030 | 1,260 |
| Guardian ground (twice the shield) | 1,100 | 1,600 | 2,060 | 2,520 |
| Guardian battery | 180 | 250 | 330 | 400 |
| Bork | 1,500 | 2,180 | 2,810 | – |
| The Smorks | 600 | 870 | 1,120 | – |
| Ezekiel | 3,000 (cache) | – | – | 6,870 |
| Dreadnoth | 2,100 | 3,050 | 3,930 | 4,810 |
| Xarth | 2,600 | 3,770 | 4,860 | 5,950 |
| Ocellus, first phase | 2,500 (cache) | 3,630 | 4,680 | 5,730 (6,780 for six) |
| Ocellus, second and third (one bar) | 5,250 (cache) | 7,610 | 9,820 | 12,020 |

Ezekiel's three and four, and the two-player Ocellus and Ezekiel figures past the cache's, follow Dreadnoth's steps (*estimate*).

## The Archive Guardian

**Before the challenge.** The Inert Guardian (16657, 5x5) at 4125,5597 shows `vfx_guardian_spawn_idle_spotanim01` every three ticks. Four batteries (Inert Guardian 16661, 2x2) stand at 4139,5592 / 4139,5605 / 4114,5605 / 4114,5592. The room's doors are placed by the server, not the map:
- Doors (63094) at 4141/4113 x 5597/5584, and from later 5610.
- The Ocellus door (63110) at 4124,5621.

**Starting it.** "Touch" asks "Begin the challenge?":
- "Challenge started: Archive Guardian.", music 887 unlocked, `npc_archive_guardian_spawn01` with `vfx_guardian_spawn_spotanim01`.
- Five ticks later it becomes `tfa_guardian` (16659) and the batteries become active (16662). The shield, the batteries and its health scale with the party (the table above).
- The boss bar shows npc 16659 on its shield, in the shield's blue (back 132, sliding 623, remaining 853).

**Flying.** It acts every five ticks:
- **Ranged.**
  - `range_attack01` with `vfx_guardian_ranged_spotanim01`, and projectile 4201 (start 48, end 116, angle 127, heights 0) at each target.
  - It lands four ticks later with `vfx_guardian_ranged_hitanim01`.
  - Prayer counts as it is thrown.
  - About one attack in five went to both players.
- **Special**, every fifth action.
  - `special_attack01` with its graphic.
  - It places two mushrooms per player: one at Chebyshev distance 1, one at 3.
  - A mushroom ripens three ticks later (`nightmare_infection_spotanim_idle`). With a player beside a ripe one it bursts: the despawn loc, area sound 12175, poison 10 and "You have been poisoned!".
- **Swoop.** With its target 7 or more tiles from its centre, it swoops (`swoosh_attack01`, an exact move of 40-56 cycles) and lands a few tiles from them.
- **Melee.** A player under it is hit in melee (`melee_attack01`, 33 seen through Protect from Missiles).
- **No melee against it.** Melee gets "It's flying too high to hit using melee." Its footprint can be walked under while it flies.

**The shield at 0.**
- Three ticks later: `idle_to_ground01`, `vfx_guardian_idletoground_spotanim01`, and the landing blast on its centre.
- It becomes `tfa_guardian_unshielded` (16660), and its stand pose changes to `npc_archive_guardian_ground_idle01` (a base animation change; the cache's stand pose is the flying one). The boss bar moves to its health (twice the shield), which carries over between landings, in red (25600/576/800).
- On the ground it doesn't attack. From five ticks in, a Vine (16664) rises beside each player every three ticks: spawn, attacks at +3, +6 and +9, despawn at +12, gone at +13.
- The first landing lasts 35 ticks (41 for five players). Later ones end three or four ticks after its health drops below a third (two thirds, then one third).
- Then `ground_to_flying01` and a full shield.

**Enraged**, once its health is below a third:
- It takes off at once and stops its ranged attacks.
- Every 20 ticks a special, and five ticks later `enraged_phase01` with "@mes_hl_ora@The Archive Guardian focuses intently on you!". Ten ticks later 43 damage lands on that player's tile, through prayer.
- With a live battery about four tiles away, the battery takes it:
  - The battery is hit for its full hitpoints, plays `guthixian_battery_despawn` and shakes the camera, and is destroyed (16663) two ticks later.
  - The player takes 20.
  - Four ticks after the beam the Guardian loses 40% of its shield.
- The second battery broken grounds it at once: the rest of its shield goes, and as much again comes off its health.
- Players can hit the batteries too (captured hitsplats): the Wiki calls it charging them, for "~40% damage to shield". A battery charged to its full hitpoints breaks as the beam breaks it.
- It faces its target as an entity (captured), its laser's target included: scripted raid NPCs carry `interaction:keep`, else the engine turns an NPC whose target is far off back to its spawn facing. The vines' hits carry no attacker, so they don't pull a player's auto retaliate. The camera shake stops three ticks after a battery breaks (*estimate*: a spectator never sees it).
- **On the ground for good** it has no vines: every 20 ticks its special, a dive three ticks later and the beam five after that.

**Estimates:**
- The ranged and melee damage: 25 and 35, with prayer letting through 40% and 50%. The Wiki gives a max hit of 25.
- The vines: 20, halved by Protect from Melee. The captures show 17-19, and 6-11 under the prayer.
- The swoop's trigger and landing, and the mushroom and battery reach.

**The kill** (all four captured):
- At 0: `npc_archive_guardian_death01` with `vfx_ocellus_null` (4345) in graphic slot 2, height 200.
- Seven ticks later: the dead Guardian (16658), the batteries gone, "Challenge complete: Archive Guardian.", music 147, and section 1's two doors "slightly" open (63089 / 63092), fully three ticks later (63090 / 63093). The Passageway works again.
- The boss bar fades at +11 and is gone at +15.
- Armacus Selles and four Guardians of Armadyl (16724, 16720-16723) fade in at 4126-4128,5573-5577 and run north.
- A `fractured-archive:room-complete` event `{ raid, room, players }`.

## The Nexus

Level 2 of the Guardian's map square, between the rooms.
- **Doors.** Three sections, each with a west door (x 4113, facing 3) and an east one (x 4141, facing 1), at y 5584, 5597 and 5610. The Archive Door to Ocellus is at 4124,5621. Section 1 is on the Guardian's own level; the others and the Ocellus door are on level 2.
  - The doors show the next section: section 2 is 63098 / 63101, section 3 63103 / 63104 and 63106 / 63107. The Ocellus door opens (63111) after the third boss.
  - "Enter" asks "Enter this chamber?" (Yes. / No.); "Quick-enter" goes straight in.
- **The path.** West leads to Ezekiel, Moia, the Dagon'hai; east to Bork, Dreadnoth, Xarth. The first member through a door chooses for the party, and the other door of that section closes. *Estimate:* no door choice reached the spectator, and every capture went east after section 1. Moia's and the Dagon'hai's doors stay shut ("That way isn't open yet.").
- **Coming back** beside the door taken: east 4139, west 4116, two tiles north of the door's row.
- **Staff.** The Alliance stand about the Nexus on each visit, with their captured lines every 12 ticks. The Quartermaster (16761, 4129,5609) and his loot wheelbarrow (63302, 4130,5608) are there only on the visit after the second boss.

## Bork and the Smorks

From the captures of four fights (two to four players) and the Wiki's strategy, Bork and Smorks pages.

- **Spawns.** Bork (16640, 4x4) at 4194,5603 and the Smorks' tower (16641, 3x3) at 4190,5598, both facing the entrance, with nine `invisible_type8_blockrange` on the tower's tiles. The boss bar is on `tfa_bork_smork_hp_ui_handler` (16642) with Bork's hitpoints, and the second bar on the Smorks (colours 9312 / 22784 / 31104). Flat armour (Wiki): Bork 10 (2 against magic, none while dazed), the Smorks 2.
- **The start**, six ticks after the first arrival: sound 12769. Bork goes for the first player in (Wiki), a tile a tick.
- **The gong.** `npc_bork_gong_melee01` and sound 10051, eight ticks in and then every 7, 6, 5 or 4 ticks as the tempo rises: two strikes two ticks apart. The second shakes the ring of tiles touching him. The first reaches out to his target when they stand two or three tiles off, covering every ring out to them (the Wiki's "stronger beat with a larger area"). The `tfa_wave_dust_short` delay is the tile's Manhattan distance from his footprint's tile (2,2), in cycles (219 of 222 strikes exactly).
- **The Smorks** (`npc_smork_cannon_attack01`, from the tower's middle), facing whom they shoot:
  - **Volleys** of all bones (ranged, 4056) or all potions (magic, 4057) at every player but Bork's target, flying 150, 120, then 90 cycles as the tempo rises.
  - **Their cycle.** The first volley comes 13 ticks in, then napalm, one or two volleys, and the heavy cannonball. Later cycles have two or three volleys, napalm, then one or two volleys (four in all) before the cannonball, starting 39 ticks after the daze. Volleys are a tempo's spacing apart (7, 6, 5, 4). The volley after the napalm comes 2 x spacing - 1 after its cast, and the cannonball's line a spacing after the last volley.
  - **Napalm.** "Burny gloop!" / "Fireeeeeeeeee!" / "Hot stuff!" with a goblin voice (12747-12756). A tick later comes the cast (sound 12240), with `gargboss_debris_shadow_120` on the tile. Four ticks after that the fire (12239) splashes from the tile two tiles towards the tower: the 2x3 beyond it when straight, the 2x2 when diagonal, plus a drip or two beside the tile (the base shape is inside 17 of 18 captured splashes). In the frenzy, next to the tower, it runs away from it instead. Fire and splat graphics are 3 cycles a tile out. A tick later `tfa_bork_ragged_tile` oil, turned at random, lies there for 199 ticks. Oil does 6-7 a tick and a burn from 2 (Wiki). Napalm landing on Bork hurts him.
  - **The heavy cannonball.** "Big bomb! Bork watch out!", then two ticks later `npc_smork_big_cannon_attack01`, sound 12248 (delay 15) and `gargboss_debris_shadow_150` on the tile of a player other than Bork's target. It lands five ticks later. Every captured one landed on Bork (14 of 14), the party luring him onto it.
- **The daze.** "Oof." with `npc_bork_14_cycle_stun01` and sounds 3201, 12273, 12758 and 12249. A Smork apologises: "Bork! We sorry! No go!" / "No! Fearless leader!" / "That you fault!". For the 14 ticks his armour is gone and melee always hits (Wiki).
- **The stomp.** "Bork very angry!!" with `stomp_attack_in01`, then two ticks later `stomp_attack01`. Four shockwaves come 3, 6, 9 and 12 ticks in (sound 10051 each) over the arena, his own tiles too: 4184-4198 x 5591-5607 without its four corner tiles. Each rolls out a cycle a tile of Manhattan distance from one of his feet. The feet are the two of his footprint's eight non-corner edge tiles on the side facing his target as the stomp starts, in turn, the clockwise one first (all 40 captured shockwaves exactly). The tower's shadow is safe: a tile is shadowed when every line from his middle 2x2 to points 0.3 in from the tile's corners crosses the tower (fitted, a tile or two off at the edges). The recovery `cycle_and_out01` plays at 8, "Bork smash <player> now." at 15, and the gong again at 19. A missed cannonball brings "Bork think it stomp time now!" (Wiki).
- **Tempo** at the Smorks' 75, 50 and 25%: "Bork get into it!" / "Smorks go faster!", "Bork make fast drum!" / "Smorks feeling drum beat now!", "Bork maximum crush!" / "Smorks go fastest!".
- **Deaths.**
  - Bork: `npc_bork_death01` and `vfx_bork_death_spotanim01`, "Smorks... avenge... Bork.", and gone seven ticks later, when the Smorks say "Human die for that!". Four ticks on, the frenzy starts: a volley at everyone (90 cycles) every two ticks. After two or three volleys comes napalm, with the next volley three ticks after its cast, and from then on five volleys between napalms.
  - The Smorks: "Uh oh." (12761), the tower's three death graphics two ticks later (12251), a fade out over the seventh tick, and gone at nine.
  - The room is won when both have gone. The oil crumbles (`vfx_smork_napalm_despawn_spotanim01`, turned at random) and the Navigator fades in three ticks later.
- *Estimates:* every damage figure, the burn's ticking (2 every four ticks, five times), the missed cannonball's stomp (two ticks after the landing), and Bork stomping every 45 ticks over the whole arena once the Smorks are dead (Wiki: "Bork's stomps cover the entire arena").

## Ezekiel

- Ezekiel (16652, 3x3) at 4062,5537 in an arena 4056-4068 x 5528-5540. He walks after his tank, the first player in (Wiki), faced as an entity.
- **His cycle**, 36-37 ticks: the special, melee at +7 and +12, the swords flying at +14, melee at +26 and +31.
- **Melee** (`npc_ezekiel_melee01`) is a cleave: `tfa_wave_dust` on the ring round him, except the three tiles directly behind him, opposite his target (the Wiki's safe spot). With the tank out of reach, a magic attack (`magic01`) goes at everyone instead.
- **The special:** a star of explosions one to three steps round him, then the swords (Animated Sword 16653, 3x3), each with a timer bar (headbar 87, 60 to 0 over 390 cycles). Fourteen ticks later each flies twelve tiles along its lane in one tick and fades:
  - "Divine consequence!": a cross, one vertical lane (both ends) and one horizontal;
  - "Divine judgement!": three in a row from the north, flying a tick apart west to east; or two vertical lanes, both ends.
- A player walking out of a sword's lane as it flies rolls clear (`tfa_ezekiel_roll`, Wiki and user).
- The finale's blocked tiles are walkable again once he is dead.
- Players' hits on a sword charge it instead of hurting it (hitsplat 23 and a second bar, headbar 42); the charge raises its damage (Wiki).
- A sword flying through him: "Agh!", `idle_to_weaken01` and the weakened stance (`weaken01`) for eight ticks, without attacking. All swords missing him heal him (Wiki; 5% here, *estimate*).
- **The finale**, below a third: he moves to 4059,5534 (a 60-cycle exact move), `finale01` with its glow, standing in `finale_loop01`. The 9x9 round him is blocked except the 3x3 in front of him (4062-4064 x 5534-5536), and everyone is pushed into it, unhurt (user). Seven fence swords drop round it, and three finale swords on his footprint.
- **Every 11 ticks a barrage** in three steps a tick apart: lightning on two of the three finale swords each step; the one left out shows the safe tile, the east row of the 3x3 at that sword's row (guides; *estimate* of the exact tile). From the barrage's start to its last impact the click itself rolls a player to the 3x3 tile they click (a 15-cycle forced move; a click mid-roll finishes it and rolls on at once); otherwise they walk. Moving against the way they face is a quick step back instead (`tfa_ezekiel_strafe`, keeping their facing; user). They face their target while attacking one, else the way their last roll went (for six ticks), else Ezekiel.
- **Death:** `npc_ezekiel_finale_death01`, "...Formidable.", the finale swords' despawns, the death sword (16656) left on his tile, and the room is won ten ticks later.
- *Estimates:* every damage figure, the charge's scale, the heal. The swords' fade-in (a transparency update) isn't sent.

## Dreadnoth the Jellied

- Dreadnoth (16665, 5x5) at 4189,5661 in an arena 4181-4198 x 5656-5670, with headbar 66 (90 wide). It crawls after its target, a tile every two ticks as live's crawl steps (which clients play over both ticks, so it doesn't stop and start), and hits whoever is beside it in melee.
- **Waves** at 85, 65 and 45% (headbar 66 fills of about 75, 56 and 40 of 90): one, two and three volleys six ticks apart. Each is `jump01`, then a tick later three damage tiles in or by its footprint (sound 12361) and three `ranged_proj01` at each player (10-90, 12-120, 14-150). Where they land, a splat and `jelly_spawning_idle`, sent again every tick until the jellies (16666, 75 hitpoints, at most 12) rise eight ticks after the last volley.
- It faces its target as an entity. The jellies are ordinary combat NPCs that always go for the nearest fighter; they and Dreadnoth walk through other NPCs, so jellies stack and never block it.
- **Phase two** at 25%: "*glub glub*", then five ticks later (all five captures) and every eight ticks after, a jump (`jump02`) at its target, a 90-cycle exact move with `tfa_boss_jelly_5x5_jump` (the shadow) where it lands. It lands centred on the player's tile when they are within five tiles, else five tiles the nearest of eight ways towards them, never west of x 4184 (fits the captured jumps; 38 of 48 to a tile from the tile it faced). A player still under it is slammed, and it heals by the damage (Wiki and guides; hitsplat 6). As it lands: one to three damage tiles in its footprint, and at each player a `ranged_proj01` (10-90) and a `ranged_proj02` (10-180, sound 12362) at their tile, which becomes a damage tile six ticks later.
- **Death:** it splits into seven jellies of 37 hitpoints; the room is won when the last one dies. The damage tiles are cleared (`invisible_type8_nonblocking`).
- *Estimates:* every damage figure, how many jellies a volley makes, a jelly's damage (the cache's).

## The Quartermaster

- "Resupply" opens Alliance Supplies (omnishop row `tfa_midraid_supplies_shop`), or `tfa_midraid_supplies_shop_failure`, which adds Leftovers. "Talk-to" is a messagebox.
- The stock and prices come from the cache: Saradomin brew(4) and Super restore(4) 3 credits, Prayer potion(4), Manta ray, Halibut, Ranging potion(2) and Super combat potion(2) 2, Giant krill and Prayer potion(2) 1, the Alliance log free.
- The currency is Supply Credits, in `tfa_supply_points` (16381).
- *Estimates* (a spectator has no credits and sees no shop): 10 credits for each challenge won, lost on leaving the raid; the failure row once anyone in the party has died; the dialogue.

## Xarth

From the captures of five fights (four to five players).

- Xarth (16684, 3x3) at 4190,5534 never moves; his footprint is nine `invisible_type8_blocking`. Three rubble heaps (2x2) at 4193,5530 (south), 4196,5536 (east) and 4193,5540 (north).
- **Phase one**, three cycles of 31 ticks:
  - five magic attacks four ticks apart (fireball 4034 at a player);
  - an AoE (`xarth_attack_aoe_01`, sounds 9221, 9335, 9215): a projectile at each player's tile, with a shadow;
  - three ticks later the flame blast (sounds 9224, 9210, 9215, 9259, then 9240 for each player a tick later). Three ticks after that comes the wave (`vfx_vmq4_ennius_fire_explosion`, sound 10579), rolling out a cycle per tile of distance from his footprint (every captured tile).
  - **The wave's shape:** a 90° wedge out of his footprint towards the heap that falls (a row out it is the footprint plus a tile each side, a tile wider each side every row), then all round in the third cycle. The heaps fall south or north first (at random: 3 and 2 of 5 captures), then east, then the last.
  - **The falling heap shelters the tiles behind it.** A tile the heap hides from his centre tile, by OSRS's projectile line of sight, gets no fire. One it hides only from his footprint's tile nearest that tile gets the smaller explosion (`_smaller`). This fits 3,892 of 3,920 captured tiles.
  - The heap NPC goes and a destroyed one plays `loc_xarth_rubble_collapse_01` with its graphic for three ticks. The heap's tiles get `invisible_type8_nonblocking` and `invisible_type8_blockrange_size2`, so the 2x2 is walkable.
- **Phase two** starts on the third wave's tick:
  - seven arena fires, one to seven tiles from his footprint (mostly two to five), and the eight corpse piles burning;
  - ranged attacks seven and eleven ticks in;
  - then a 21-tick cycle from 15: two magic attacks two ticks apart (three for five players) at edge tiles, four ranged attacks four ticks apart from five, three more fires at twelve.
  - Three ticks after each magic attack a Corpse (16687, 62 hitpoints) fades in there (0 to 30 cycles) and walks a tile a tick to him. One that reaches him is absorbed (`xarth_corpse_absorbed_01`, gone two ticks later) and heals him twice the hitpoints it has left (hitsplat 6: 124 for an unhurt one). One killed plays `xarth_corpse_death_01` with the doused flame and goes four ticks later.
- **Death:** `xarth_death_01` with its graphic. Six ticks later he and the corpses go, his footprint becomes `invisible_type8_nonblocking`, and the room is won.
- *Estimates:* every damage figure, the fires' burn, whether the smaller explosions hurt (here they don't), where on the edge the corpses rise.

## Ocellus

From the captures of three kills, the Wiki's Ocellus and strategy pages, and the guides.

- The room (level 1) centres on 4127,5673. The hooded figure (16671; met or not by `tfa_ocellus_met`, saved) stands at 4126,5669. "Talk-to" or "Proceed" asks "Begin the challenge?" (*estimate*).
- **The start:** "Now... ascension...", the entrance closes behind the party, and it becomes the first phase (16674).
- **Headbars and hitsplats** (captured): in the first phase his headbar is the blue one (headbar 10, 100 wide), and damage on him shows cyan (hitsplats 18 for your own hits, 19 for others'; blocks stay 12 and 13). From the third phase it is headbar 19 (100 wide), showing the shared pool the HUD shows, with the usual hitsplats. Heals show as hitsplat 6: on a player intercepting a crack line, and on him from his soulsplit. Not built: the small heals (2-6) live shows on him in the first phase, whose cause the captures don't show.

**First phase** (blue bar, and a second bar of 96 for his charge):
- He walks corner to corner anticlockwise, SE (4132,5666), NE (4132,5678), NW (4120,5678), SW (4120,5666), from a random first corner. He shows Protect from Melee while walking (melee does nothing then), and every five ticks throws a fireball (ranged: `phase1_basic_projectile_start`, 4231/4232) or a water ball (magic: `_end`, 4228/4229) at everyone.
- **At a corner** (the tick after he arrives): seven tendrils two ticks apart. Each is eight tiles of `floor_crack` from a far tile in to his footprint, at random from seven spots (captured; not aimed at players): straight along either of the two rows or columns of his side nearer the middle, or diagonal from his inner corner, its tile or either beside it.
  - A tendril shows two ticks after it is laid. Its energy flows back into him five ticks after it is laid, and the whole line lights up green (the `_end` graphics, sound 12513; on every line in the captures).
  - Anyone standing on any tile of the crack as the green passes intercepts it (no timing needed: they can stand on it early and wait). An interception heals that player's chip damage: what they lost since their last interception, from the most health they had since (guides).
  - With nobody on it, he charges: 2 on the second bar.
- Three ticks after the last tendril: "Pointless..." / "You... fail..." / "Unworthy...". Three ticks after that, his explosion: the two rings round his footprint (inner at once, outer a moment later), up to 35. Three ticks later he walks on.
- **The middle**, at two thirds and a quarter, even mid-walk (captured): he teleports out, fading out, and four ticks later in at 4126,5672, fading in, with the centre's walk-block loc.
  - Four sides clockwise from a random one, eight ticks apart. Each side has two diagonal six-tile tendrils, from the ends of that side: the first shows at once and flows after four ticks, the second two ticks later.
  - Each side ends in the explosion six ticks after it starts.
  - Eight ticks after the last side: "Death... awaits..." (17-18), or, from a charge of 12, "Embrace... annihilation..." (80-90). Both are unavoidable (Wiki; the threshold is an *estimate*). Two ticks later he expends the charge and it empties; seven ticks after that he walks on.
- **At 1:** "You... will disappear...". He teleports to the middle if he isn't there; three ticks later comes `phase1_transformation`, and ten ticks after the line, the second phase (16675).

**Second phase, 123 ticks whatever the damage** (music 894):
- Two ticks in, six portals stand on each arm of the cross: E 4128-4138, W 4115-4125 at y 5673, N 5674-5684 and S 5661-5671 at x 4127, every two tiles.
- Seven ticks in comes "Your time... comes...". The Blade (16676) stands with him and takes the party's attacks (he has no Attack option). 43% of its damage reaches his bar (832 of 1,951 seen).
- **The party's quadrant** (where most of them stand, then clockwise NW, NE, SE, SW) gets 42 ticks:
  - **Six volleys, five ticks apart.** On the two arms beside the quadrant every portal turns purple (`quadrant_wall_active`) but one an arm, which stays orange. Four ticks later each purple portal fires across the quadrant from a 2x2 at it, covering its 2-tile strip, at 6 cycles a tile. Anyone in a strip is hit for 20-25 as the shot reaches them. The 2x2 where the two orange strips cross is safe.
  - Which portals stay orange is a fixed pattern per quadrant, the same in every captured kill (`ORANGE`; counted out from the middle, the N/S arm's then the E/W arm's): NW and SW 2-2, 2-3, 1-4, 2-2, 2-4, 3-3; NE 1-0, 1-3, 1-5, 3-3, 2-2, 3-0; SE 1-1, 3-1, 1-3, 1-1, 2-2, 4-1. Each safe spot is on the floor and a few tiles from the last.
  - **28 ticks in:** purple pools burst on 10-12 tiles and every player's tile (25, four ticks later; *estimate*).
  - **31 ticks in:** every portal on both arms turns purple.
  - **33 ticks in:** an orange portal opens on the floor for seven ticks (`p2_safe_portal`; its idle graphic again every tick), with the Blade's discharge. Stepping on it moves a player to the same spot in the next quadrant clockwise (*estimate*).
  - **40 ticks in:** every purple portal fires across the quadrant, and anyone still in it dies.
- The client keeps a tile graphic sent again on its tile within 800 ms (the floor portal's idle, a tick long) playing up to 150 ms past its end until the next arrives, so tick jitter doesn't make it flash.
- "This... is enough..." ends it, in the middle of the third quadrant.

**Third phase** (16677, on the same bar):
- **The cross falls.** Four ticks in, each arm cracks (`straight_collapse_01-04`, solid 3-wide). Five ticks later they fall in (`dungeonkit_guthixian03_cracking_collapsing_01-04`), with explosions running out from the middle every three tiles, 15 cycles apart (`tfa_arena_collapsing_explosion02, 03, 04, 01`). Three ticks after that, the empty forms leave the hole. The middle platform gives way to a 3x3 invisible blocker (the hole shows there too), and the stairs up to the room to invisible locs (4126,5658 and the entrance tile). The portals play their despawn two ticks in; the sword's drop explodes a tick in. The middle is blocked (5x5), and invisible walls stand along both sides of every arm, open only beside its three stepping stones ("Gap", Jump; the other walls also block projectiles). Anyone left on an arm is moved into the quadrant (*estimate*).
- When a quadrant falls, the stones of the arms beside it crumble (`dungeonkit_guthixian03_steppingstone_despawn_01-03`) as he moves on; those crossings are gone.
- **Jumping:** a stone is jumped onto from the quadrant's edge tile beside it (outer stones) or from the stone before it, a tick each (`human_steppingstonejump`). A walk click from a stone hops on towards it. The crossings:
  - SE 4129,5663 to SW 4125,5669;
  - SW 4117,5671 to NW 4123,5675;
  - NW 4125,5683 to NE 4129,5677;
  - NE 4137,5675 to SE 4131,5671.
  Nobody can jump while the barriers stand, and out of his quadrant only over the arm to the quadrant he takes next, clockwise ("The way back is closed." otherwise; *estimates*).
- **The quadrants:** he takes the quadrant the portals ended in, then clockwise, from its corner tile, with its two barriers up. Three ticks in, two void bombs fall in each quadrant still standing and leave void (6-7 a tick) until it falls.
- **His rotation:** melee, melee and a slash, twice, three ticks apart. The slash is a wave three tiles deep and his width, in front of him towards the tank, the rows two cycles apart the tick after his swing (captured); it hits a tick later. The tank is the first to hit him, while they stay in his quadrant. If he can't reach them he fires a void shot at everyone instead (Wiki).
- **Then a special in turn.** From the second quadrant on, "Insolence..." comes first; after that the cog, the void and "Untether...", round again:
  - **The cog:** a circle under him (`prayer_in`), then the cog strikes three ticks later (40), once more each quadrant, three ticks apart (`melee_prayer` per strike, `prayer_out` on the last, the loop animation between). Prayers must be off as the circle forms and Protect from Melee on when it strikes: anyone with an overhead prayer as it forms is hit through it. Debris falls where everyone stood (on the second-last strike) and five ticks later leaves void for 24 ticks.
  - **The void:** "Await... the void..." / "Your panic... is futile..." / "The void... will take you...". Three ticks later, a void shot at everyone and a Void Vine (45 hitpoints, from its headbar) rooting someone other than the tank. The vine has no model: the entangle shows on the player (`spell_entangle01` start, its idle each tick, end). Another player must break it within 15 ticks, or the rooted player takes 50.
  - **"Untether...":** he rises where he stands and floats to his corner over three ticks (captured exact move), his stance the `unleash_loop` until he lands, as live's base animation change (the quadrant's destruction and the final stand's rise do the same with theirs). The quadrant erupts four times, four ticks apart, including every player's tile (40). 25 ticks in, the square shows under him; four ticks later he comes down on the quadrant (45), all but the square (his footprint and a tile round it), which is safe. No head icon changes (captured).
  - **"Insolence...":** three superior slashes five ticks apart, each a wave three wide running eight tiles out towards a player, two cycles a step, leaving void in three bands (`insolence_1/4/7`) that crumbles after 15 ticks.
- **Void flares**, 44 hitpoints each, two at a time, with a charging bar under their health (headbar 75, filling over 28 ticks). One not killed when it is full detonates on everyone (15-30). In the first quadrant they are Siphons, after Untether; in the second Augmenters and in the third Rifts, every 48 ticks.
  - A Siphon heals him 1% every four ticks while it lives.
  - An Augmenter that detonates also strengthens him (*estimate*).
- **The quadrants fall at 75, 50 and 25%:** "Obliteration..." / "Run... It matters not..." and the barriers drop. Eleven ticks later comes "This end... comes..." / "Everything... ends..." / "You can't... escape... the end...". A tick after the line he fades out; a tick later the quadrant falls: its floor's map pieces are overwritten by invisible locs (three tiles a quadrant, each an s10 piece and its s22 decoration), then its slices, its floor blocked, and anyone still on it lost (`tfa_ocellus_void_player_death`). Four ticks after that he takes the next quadrant, fading in.
- **The censers** (Saradomin 62699 SE, Armadylean 62695 SW, Zarosian 62697 NW, Bandosian 62693 NE) work once each, in this phase, for the whole party (Wiki):
  - Saradomin: 50 hitpoints and 50 prayer;
  - Zarosian: 50% special attack;
  - Armadylean: the next ranged hit on him at its maximum;
  - Bandosian: the next melee hit on him at its maximum.

**The final stand** (one quadrant left, "End..."), a 60-tick loop from three ticks after he arrives (captured):
- **0:** he rises (`deflect_in`, his stance `deflect_loop` as live's base animation change) with Deflect Melee (head icon 440:15; melee hits on him turn back on the attacker). The "range" arena graphic shows round him (start, its loop again every three ticks, end), and the tiles next to him are void. **2:** `deflect_loop`.
- **3:** `soul_fragment_start`: he takes half of everyone's health into an orb a few tiles away (shown only to its player; *estimate*), which gives it back once grown (12 ticks). Void bursts mark each player's tile every two ticks, six times, and hit two ticks later anyone still on it (15-16). He takes half damage meanwhile. His levitating fragment graphic (slot 2) shows until he lands, sent again every two ticks as live loops it.
- **21:** he lands (`deflect_out`), the arena graphic ends, the fragment graphic is cleared. No `soul_fragment_end` while risen.
- **24:** his charged attack, a style at random: the cog (melee), the black hole (magic) or arrows (ranged). Protected, 6-7; otherwise 40-50. A tick on, Soul Split (440:11, until his next deflect): the blast heals him a fifth of what it deals (*estimate*).
- **31:** on the ground, no deflect animation: Deflect Range (440:16), the "melee" arena graphic, everywhere but next to him void. **34:** the orbs and bursts again (his ground fragment graphic). **50:** `soul_fragment_end`, the arena ends.
- **52:** his charged attack, Soul Split a tick later. **59:** Rifts, two at first, then up to five. **60:** round again.

**Death:**
- `npc_ocellus_phase3_death` with its graphics, the raid's total time, and a Combat Achievements kill (`combat-achievements:kill`, "Fractured Archive, The", monster key 26).
- The Blade (16683, "Travel") appears where he fell 14 ticks later and takes the party to the vault.

*Estimates:* every damage figure, the tendrils' charge and its threshold, the floor portal's destination, the Blade's share, the cog's prayer checks, the vine's and the flares' hitpoints and timers, the Augmenter's effect, the Untether square, the barriers stopping jumps, and the final stand's void and orb tiles. The last quadrant's slices aren't placed: they never fell in the captures.

## The vault

- Level 2 of map square 64,90. The exit loc (63297) at 4127,5773, the Merit scroll (62775, "Read" opens the records) at 4129,5778, the braziers at 4131,5805 and 4123,5805.
- Eight chests round the island, one per party slot: 4124,5793, 4130,5793, 4121,5796, 4133,5796, 4120,5800, 4134,5800, 4121,5803, 4133,5803. Each is a multinpc on `tfa_vault_own_chest`, so a player's own shows as theirs. "Open" plays `chest_guthixian02_open01` and turns it into a Rift ("Search").
- The Rift out (16690, "Leave" / "Quick-leave") fades in at 4126,5796 about 15 ticks after the party arrives, and goes back to the lobby.
- **The loot** follows the Wiki's chest table (`loot` in the data file):
  - one unique (Rondache > Zorya's tome = Horn of Bran > Ascension crossbows > Obligator), or else three standard rolls (weights out of 148 from the Drop Rate Project; each roll 1/51 to give five times as much);
  - tertiaries: the inert Archivist's folio 1/20, each elemental fragment 1/80, an elite clue;
  - Orion, the pet.
- **The reward chest:** Search opens `tfa_chests` (973), the Archive's copy of the Tombs of Amascut's chest. Its items sit on inventory 1029 (six slots, `tfa_chests`), with Take / Take-5 / Take-10 / Take-All on an item (`interface_inv_init`, 149) and Bank-all (973:5), Take-all (973:7) and Discard-all (973:9, after "Are you sure you want to discard everything?"). Taken to the inventory, bulky drops come noted; banked, they're unnoted. The loot counts for the collection log when the chest is first opened.
- *Estimates:* the unique chance (4%) and weights, the pet's rate (1/400), the unique chest's tile, opening only your own chest, the chest's item options (as the Tombs of Amascut's), unclaimed loot going to the bank on leaving or logging out (the Wiki says the lobby's Loot Wheelbarrow keeps it), and the cabbage for a poor run (not done). Aether catalyst (3/148) is left out: the cache has no item by that name.

## The rewards

- **Zorya's tome** (`plugins/items/ZoryasTome.plugin.js`): a powered tome (built-in spell, base max hit 18, 3 ticks, 7 tiles / 9 on Longrange), charged by using astral and nature runes on it (3 + 2 a charge, 20,000 max), with Check / Uncharge, one charge a cast and the uncharged id when empty. Its special, Zorya's flow (50%), is x2.5 accuracy and x1.6 damage, and a landed hit buffs the next 3 attacks (5 if used again during the buff) for 30 seconds at 2 ticks each. *Estimates:* that reading of "150% / 60% increased", the five-attack rule and Sanguinesti's projectile timing. Not done: Configure-Charges in the bank. Limit: the flow buff is kept in memory, so it does not survive a logout.
- **Elemental fragments** (`plugins/combat/elementalspells/Fragments.ElementalSpells.js`): "Break" one to add 2 to that element's spells' base max hit for good (`elemental-spells:fragments`, one bit an element). The Wiki doesn't say whether more stack; each element counts once (*estimate*).
- **Ascension crossbows** (`AscensionCrossbows.plugin.js`, `RangedData.ts`, `WeaponProfile.ts`): crossbow type, cache speed 3 (Rapid 2), range 6 (8 on Longrange), ascension bolts only (plain 53, diamond and onyx 58 ranged strength; flight spotanims 4437 plain, 4439 diamond, 4438 onyx; the (e) bolts run `EnchantedBolts` as the gems do). No special attack or passive. The shot alternates `tfa_human_ascension_crossbow_fire_left`/`right` (and `_pvn` on NPCs) and remembers the side across targets. *Estimates:* the projectile's heights and no launch graphic (the cache has none).
- **Obligator** (`Obligator.plugin.js`): cache category 36 (`extending_chainmace`, `EXTENDING_CHAINMACE` in `item-combat-styles.json`; `sync:weapon-types` maps the Wiki's "Extending Chain Mace" to it). Thrust (5 ticks) rolls twice, three times when stab or slash defence beats crush, takes the best roll, and adds 20% on a 2x2 and 40% on a 3x3 or larger; Smash is 3 ticks, plain. Charged with a shard, 20 nature and 20 death runes per 10 charges (max 20,000), Check / Charge / Uncharge. *Estimates:* a charge per attack; the passive only while charged; the Thrust animation (`..._multihit`) and Smash (`..._attack`); the Thrust only ever strikes its target (the Wiki doesn't say how it reaches others); stances for female characters use the male ones.

## Spectating from outside

- The lobby's Strategy board (63083, "Spectate") asks "Spectate a specific party." / "Spectate a recent party." / "Cancel.".
  - Specific: "Who would you like to spectate?". "<name> does not appear to be defending the Archive." when they aren't in it; "That player is offline, or has privacy mode enabled.".
  - Recent: "There aren't any recent raids to spectate." *Estimate:* otherwise the raid that started last.
  - Carrying anything: "Spectators cannot bring anything into the Archive. Please visit the bank to deposit your items." (live strikes the options out).
- In: a fade, `tfa_client_spectate_mode` 2, "Spectating the room. Click a fighting player's health display to spectate them.", the body parked on local tile 62,1 of the party's room, the HUD, and `tfa_client_num_external_spectators` (16425) for everyone. Clicking a fighter's health follows them, as for the dead.
- **The view** (captured `cam_target_v4`, for outside spectators and the dead alike): the camera looks at the room's middle, or at the followed fighter, until `cam_reset` when they leave. The parked body is 30-55 tiles from the fight, so the spectator sees players and NPCs out to 64 tiles, and the room's graphics, sounds and projectiles reach them as far.

  | Room | Camera target |
  | --- | --- |
  | Guardian | 4127,5599 (level 0) |
  | Nexus | 4127,5599 (level 2) |
  | Bork | 4191,5599 |
  | Ezekiel | 4063,5535 (*estimate:* not captured; square + 31,31 like Bork, Dreadnoth and Xarth) |
  | Dreadnoth | 4191,5663 |
  | Xarth | 4191,5535 |
  | Ocellus | 4127,5673 (level 1) |
  | Vault | 4127,5798 (level 2) |
- The spectator follows the party between rooms. The HUD's leave (974:1, `[2]`), a wipe or the party leaving sends them back beside the board.
- *Difference:* live closes side tabs 0-6; here the inventory and combat tabs close, as for the dead, because those are what the server can put back.

## Reward items

`tfa/Rewards.FracturedArchive.js` and `combat/effects/Rondache.EquipmentEffects.js`.
- **Horn of Bran / Zeal.** Entering Camelot Castle (an `Area`; *estimated* bounds 2745-2776, 3489-3524) with the horn unlocks Zeal (`prayer:zeal-unlocked`, varbit `prayer_zeal_unlocked` 16578, sent at login). *Estimates:* the horn is used up (the Wiki doesn't say), and the Wiki's cutscene is a message. Zeal is `PrayerData.ZEAL` (id 29, varbit `prayer_zeal` 16577): Prayer 84, plus Attack 75, Strength 75 and Defence 70 (dbrow 17168), drain as Piety (40 points a minute), +25% Attack, +28% Strength, +25% Defence. It takes Piety's place in the book (cache table `alternate_prayers`), so Piety's button toggles it once unlocked. *Known limits:* the unlock is read in core `PrayerHandler` (as Rigour's and Preserve's are); quick prayers cannot select Zeal (the quick-prayer varbit is a per-slot mask with none for it, and Piety's slot does not turn into Zeal), and it is left out of the mask.
- **Archivist's folio.** Read teleports to the lobby (4127,5508), spending a charge; Charge or ascension shards on it add 5 charges per shard; Check. The charges are on the item (item meta), and at 0 it is the inert folio. The noted/placeholder copies (34680, 34724, 34670) cannot be held unnoted, so are not handled. *Estimates:* no charge cap, 20 Wilderness limit, the normal teleport animation.
- **Rondache.** Flat armour 2 per landing hit (Wiki; no cache param carries it), the damage removed becomes `rondache:charges` (cap 20, varbit `rondache_charges` 16438). Shield Slam is the combat tab's special bar button (the cs2 shows the charges as the bar): `CombatSpecial.assign` falls back to the worn shield's special when the weapon has none, and equipping or removing a shield refreshes it. It needs 10 charges, uses them all, rolls Crush accuracy with +6 per charge and hits x + x%. The hit goes through `PendingHit` (protection prayers, XP). The shield also counts as Saradomin's in the God Wars Dungeon (`protectionItems` in `godwars.json`, [god-wars-dungeon.md](god-wars-dungeon.md)). The shield's special follows the `equipment:changed` event. *Known limit:* a weapon with its own special takes priority over the shield's. *Estimates:* the one-tick delay, the refusal messages, no weapon-swap behaviour.

## Not done yet

What is left, and what a capture needs to show (as a fighter this time):

| Content | A capture needs to show |
| --- | --- |
| Moia (`tfa_moia_shadow_shield_amount`) and the Dagon'hai Elder with the monks, the two west doors | both fights |
| Damage on players for every boss; prayers and what they block | a fighter's own session |
| The door choice: how a party picks a side | entering a section |
| The Quartermaster's shop in use, and how Supply Credits are earned | buying, with the credits before and after |
| The loot: the unique chance, the lobby's Loot Wheelbarrow, the cape claims, the cabbage, the death-fee discount | a completion and its loot screen |
| Ocellus: the tendrils' damage and charge, the floor portal's destination, the stones' jump, the cog's prayer rule, the final stand's orbs | a fighter in each phase |
| The items: Obligator's and Zorya's tome's weapon types, Leftovers, the Ascension crossbows and bolts, the elemental fragments, Horn of Bran and Zeal, the Archivist's folio, Rondache, the Living records, and what the shards are for | each item used |

Also missing:
- The banker's and the wizard apprentice's dialogue.
- Mining experience.
- Practice mode, which is not out on live.
