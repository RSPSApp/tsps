# Barracuda Trials

Sailing's three timed courses: the **Tempor Tantrum** (30 Sailing, Rum-dashed Ralph, the Storm
Tempor), the **Jubbly Jive** (55, Gurtob and Ros, Backwater) and the **Gwenith Glide** (72, Gwyna,
the crystal-flecked waters, after Regicide). Each has Unranked, Swordfish, Shark and Marlin ranks,
lost supplies to collect, its own objective, hazards, XP, a reward for each rank's first time,
personal bests and a scoreboard.

Plugin: `server/plugins/skills/sailing/BarracudaTrials.Sailing.js`, with its units in
`barracudatrials/` and its data in `data/barracuda-trials.json`. Tests:
`server/tests/barracuda-trials.test.cjs`.

## Sources

- rsprox captures from https://rsprox.net/database (rev 235). Tempor Tantrum: recordings 856,
  3457, 3461, 3467 (intro), 3578, 3579 and 3834. Jubbly Jive: 907 (intro) and 908. Gwenith Glide:
  936 (intro), 948, 1030, 1031 and 1032.
- The cache. DB table 143, rows 7243 to 7245, gives each rank's time limit, objectives, crate
  count, XP and first-rank bonus (column 22) and the rewards (columns 23 to 25). The map gives
  the crates (collectable locs, objective k = the trial's first collectable + k), the rapids, the
  fetid pools, the portals and the motes. Interfaces: 931 (HUD, script 8605), 932 (selection),
  933 (statistics).
- The masters' Wiki transcripts in `npc-dialogues.json`, played by the transcript engine. Their
  variants and conditions are answered in `Master.BarracudaTrials.js`.

## Units

| Unit | Does |
|---|---|
| `Common` | Data, DB-143 ranks, the saved `barracuda-trials:progress` attribute and the variables sent from it at login, time formatting, map loc lookups. |
| `Ships` | The masters' and the trials' NPC boats (world entity config 10), the masters, Ros and the rats on their decks. |
| `Master` | Talk-to through the transcripts; Start-trial and Start-previous-rank; the helm and crew refusals; Gwyna's full-screen-effects question; lost rewards; Ralph's whirlpool surprise. |
| `Cutscene` | The three intros' tours of their course. |
| `Selection` | The rank selection (932). |
| `Run` | Start, the per-tick HUD, out of bounds, completion, the reset button. |
| `Supplies` | Lost supplies, picked up by sailing past (projectile 3497, sound 10703, XP). |
| `Hazards` | Rapids, fetid pools, rocks. |
| `StormClouds` | The Storm Tempor's 61 lightning clouds. |
| `Tempor` | Rum: collect from the south boat, deliver to Ralph's. |
| `Jubbly` | Balloon toads, outcrops and the jubblies' hops. |
| `Gwenith` | Portals, crystals and crystal motes. |
| `Resonance` | Resonance crystals and the crystallised helm. |
| `Scoreboard` | Server-wide statistics in `data/saves/barracuda-trials.json`, shown on 933. |
| `Dev` | `::bt start <trial> <rank>`, `::bt complete`, `::bt intro <trial>`, `::bt go <trial>`, `::bt npcs` (developers). |

## Core changes

- `BoatManager.teleport` moves a boat with a new heading. `WorldEntitySync` sends it as update
  type 3 once per teleport, as live does for portals, starts and completions.
- Boat speed as live (`BoatMovement`, docs/sailing.md): the speed ramps toward its target by the
  sails' acceleration; `Boat.speedBonuses` push the sails up to the hull's cap (rapids) or take
  off (lightning), `burstBonuses` and a trim go a half-tile step past it, `speedLimits` hold it
  back (fetid pools). `Boat.lastStep` and the previous position give the path for pickups.
- Boats' hitpoints: the parts' maximum less the damage taken (`OwnedBoat.damage`), cleared when a
  shipwright recovers the boat. Before, every boat had 0 and the first hit sank it.
- Deck locs can be removed (`BoatManager.removeDeckLoc`), for the rum crate and the toads on deck.
- Locs on an NPC ship's deck can be used from 12 tiles away (the rum boats; a click from further
  waits up to 10 ticks for the boats to close in), and its NPCs spoken
  to from your own boat or the shore within 16 tiles, "I can't reach that!" further away (the
  masters). Another player's boat stays out of reach. Main-world locs can be given a reach of their
  own from a deck (`api.setDeckReach`: the outcrops, 18 tiles).
- A hint arrow on a world entity (type 4) and a camera target on an NPC, a world entity, or a tile
  glided to over client cycles. The client draws and follows all of them.

## Behaviour (rsprox)

The units' header comments list the captured details: messages, ticks, sounds, graphics,
varbits and interface packets. In short:

- **Start** (rank chosen at T): T fade; T+1 timer varps, rank, crates, the master's form,
  "You prepare to begin the X..." and the timer message, the boat teleported and moored (move mode
  4), the hint arrow, "Test Your Sails"; T+2 the HUD. The timer starts on the tick the player sets
  the sails (1 to 188 ticks after the start in the recordings). Start-trial, Start-previous-rank and
  the scoreboards stop the boat on the click.
- **Completion** (last objective at F): HUD updates to F+2; F+2 HUD closed and fade; F+3 the
  count, PB and first rank (only within the limit, `<=`), the messages, the trial's XP whatever the
  time, the first rank's bonus XP and reward, the boat moored back at the start, "Test Your Sails"
  then the area's track; F+4 the boat stopped (sound 10837) and the fade closed. An exit does the
  same over two ticks.
- **Tempor Tantrum**: rum shipments from the south boat to Ralph's, one at a time. 61 storm clouds
  grow, charge and strike twice ("A lightning strike reduces the speed of the boat!", 3-5 damage,
  sound 10700 on the strike) and walk 1-4 tiles 19 ticks after growing.
- **Jubbly Jive**: toads by rank (4/4/12/9); outcrop states 0 to 3; a jubbly moves one outcrop at
  a time, at least 11 ticks after its last hop and 2 after the toad lands, checked every 2 ticks; a
  lure at outcrop 7. The birds land and leave a tick after a hop.
- **Gwenith Glide**: each clan's pair of portals sends the boat to one place; that clan's return
  portal sends it back beside the other portal of the pair it left through (after another clan's
  pair, its own side), and imbues the crystal. The portals work out of a trial too. The last of
  three crystals goes to the start, and the completion counts from that portal's tick. The HUD's
  crystal string is in the fixed clan order. Every 20 ticks all 35 resonance crystals fire; a boat
  in a field gets its helm crystallised (59597, headbar 82), which hurts its holder every 4 ticks
  (up to 5) until three Break-crystals.
- **Intros**: on the first talk the course lines play over a camera tour of the course, with the
  demo's crates, outcrops or crystals and the HUD. The master's Start-trial form follows the tour.

## Ours (not captured)

- Level, Regicide and skiff refusals, and the boat-part requirements: Tempor needs storm resistance
  (sails) and an oak helm's rapid resistance, Jubbly a mahogany helm's, Gwenith the keel's
  crystal-flecked resistance. Ralph and Ros name the parts in their tips; the refusal texts are ours.
- A locked rank's message in the selection.
- Out of bounds: the captured warning, then the run ends after 17 ticks (10 seconds) outside.
- Rapids: powerful and deadly rapids' extra (1.5 and 2 tiles a tick; only gentle and strong are
  captured). A helm too weak takes 15 whatever the rapids' tier (one capture).
- Storm clouds: a hit within 3 tiles of the boat's centre (live's hits were 2-7 tiles off it, the
  hull), the slow's length (5 ticks; half a tile a tick, live's most).
- Portal reach (1 tile around the portal), the return exits never captured (the other portal of
  the pair, mirrored), the portal colours of the five clans never seen with effects on (Ithell's),
  the bursts after portals, motes and crystal clearing.
- A crystal mote can be taken again 6 ticks later. Its wind mote goes into a switched-on wind or
  gale catcher with room (`WindCatcher.Helm.js`).
- Resonance crystals: each shot's direction (random) and distance (6), and what's caught (the
  boat's centre within 3 tiles of the field's middle; live caught boats 0.5-4.5 tiles off).
- A crate's pickup range (4 tiles along the path; live's look measured from the hull, 1-5.5).
- Intros: the camera glides along a tile target instead of following the roaming camera NPC,
  because our NPC updates only reach 127 tiles and the tours go further. NPCs near a far stop
  (storm clouds, birds) aren't shown. A line's first showing with its continue held back isn't
  copied. Closing the conversation ends the tour.
- The Gwenith Glide's full-screen-effects question is asked before every attempt while the effects
  are on and nobody has said not to ask again. Live also asks it in Gwyna's first talk, after "Oh!
  Sorry, sailor... nice to meet you."; the transcript engine can't put a menu in the middle of a
  transcript, so that one is left out.

## Not done (captured)

- The Gwenith Glide's out-of-bounds area isn't the rectangle used here: live warned at spots well
  inside it (near (2064, 3532), (2073, 3456), (2114, 3300), (2207, 3611)). Seven warnings aren't
  enough to draw its edge.
- The Stormy key handed out again after a Swordfish run when it was used (varbit
  `sailing_bt_stormy_key_used`): there's no stormy chest to use it on yet.
- The whirlpool surprise shown in an `objectbox_double` with the two glasses (the message plays as
  a plain box).
- Projectile ends on the boats' deck tiles (the rum, the toads): they go from and to the boats'
  centres.
- The interaction mode and hidden ops during the intro tours.

## Wiki and capture differences

- The Gwenith Glide's Marlin XP changed between builds (14,800 in 936, 16,050 later); the cache's
  value is used.
- The portal message changed from "sent someplace else" (936) to "sent somewhere else" (later);
  the later one is used.
- Ralph's tips: the capture says "at least an oak helm", the Wiki transcript (which plays) "at least
  an iron helm"; Ros's say "mahogany" live and "mithril" in the transcript. The requirements follow
  the captures. The transcripts are generated from the Wiki, so the text stays as the Wiki has it.
- Gwyna's transcript has only her first talk. Her later Talk-to plays the captured greeting and
  her menu, with the answers from the first talk.
