---
quest: Pandemonium
key: pandemonium
status: passed-with-issues
tested: 2026-11-12
tester: agent
model: claude-opus-5-5
commit: fix/4406-pandemonium
cache: osrs-242_2026-11-03
start: fresh
travel: manual
---

# Pandemonium

A fresh account played the whole quest through the agent MCP against the rev 242 capture
`20261104T121356-9573646` (a full live run). Stages, the intro HUD, the crew's lines, Jim's free
cargo hold (#4406), the shipyard and finale now follow that capture. Open items are listed below.

## Findings

- **open** The raft gangplank's Board-previous does nothing; live boards the last boat with it
  (rsprox 242 tick 3613). General Sailing, not this quest's code.
- **open** Live sends "You trim the sails, ..." on the spam channel; Sailing sends it as a game
  message. General Sailing.
- **open** The dump has "notice boards found *in* various ports" (VOIS_P) where live says "*at*",
  and lacks the stage 12 re-talk's first line "Now that we're here, I think it's time to do some
  salvaging!". Both are osrsreboxed-db corrections.
- **open** Boarding the tutorial ship unlocks Set Sail/All Aboard; live unlocks Crest of a Wave,
  High Seas, Jolly R and Sea Shanty (its ship sits in a different map square). General Sailing.
- **open** Chartin' Charles doesn't hand out the spyglass yet; this quest no longer gives one.
- **fixed** Junior Jim didn't provide the cargo hold's materials at stage 28. #4406

## Capture facts (rsprox 242, 20261104T121356-9573646)

Stages, varbit 18314, and the line each arrives with (Quest Helper's steps agree):

| Stage | When |
| --- | --- |
| 2 | "Start the Pandemonium quest?" Yes |
| 4 | Anne: "Just let us know when you're ready, and we'll hop aboard!" |
| 6 | boarded Will and Anne's ship |
| 8 | Anne: "Over to you, ... Take the helm when ready." |
| 10 | Navigate at the helm |
| 12 | the player stops the boat at the wreck (sidepanel, tick 3300), ~6 tiles short of its root |
| 14 | the explanation's last line, "*sigh*" |
| 16 | washed ashore; Steve greets the player unprompted 4 ticks after the landing |
| 18 | Steve: "Aye! To be sure! This here is the finest establishment ..." |
| 20 | Steve: "... go speak to Ribs instead ..." |
| 22 | Ribs: "You should talk to Steve. He already put out a bounty ..." |
| 24 | Steve (bounty talk): "Jolly Roger!" |
| 26 | player: "Er... I do have this cup I found. ..." |
| 28 | "You give the cup to Junior Jim." (raft granted) |
| 30 | cargo hold built at the shipyard |
| 32/34 | log book given / Jim's request logged (after the portal back to the docks) |
| 36/38/40/42 | raft boarded, docked at Port Sarim, boarded with the crate, docked at the Pandemonium |
| 44 | crate delivered at the ledger table; Old Grog (14976) appears at 3049,2968 |
| 46 | Jim: "Don't mention it, mate." (starter log 31985 becomes 31986 in its slot) |
| 48 | "Old Grog departs." (a message box held 4 ticks without its continue) |
| 50 | complete |

- **Tutorial ship deck** (rev 242): helm (4,6), mast 29505 (4,4), sails (4,5), hook (3,2) rotation 1.
  Rev 231 had the hook at (3,4) and the sails at (4,4); rev 235 the hook at (3,2).
- **Intro HUD**: interface 345 on overlay_hud, opened on boarding (and at the shipyard), closed at
  Deploy (and at the shipyard portal). Clientscript 627 picks its text: 1 helm, 2 heading, 3 stop
  (sails set, and after each lull), 5 trim (gust), 6 boost (trimmed), 12 stop here, 0 at arrival,
  7 hook, then at the shipyard 8 saws, 9 hammers, 10 gangplank, 11 hotspot, -1 once built.
- **Hint arrows** (varbit 14192 toggles round each): helm deck (4,5) west 70, sail cloth (4,3)
  south 250, hook (3,2) west 90; shipyard saws 2082,2720 centre 60, hammers 2082,2721 centre 60,
  gangplank 2087,2724 south 30, raft hotspot deck (3,2) centre 30.
- **Crew lines** (npc_say, overhead and in chat): Anne "We need to be going south." on taking the
  helm and 35 ticks later; Will "...! The sails need trimming! Don't miss out on that wind!" on a
  gust; Anne "Very good!" on the trim; Anne "Stop here, ...! This is where we want to be!" near
  the wreck.
- **Cargo hold**: at stage 28 the client treats facility row 8462 (the raft's cargo hold) as
  buildable before the quest is done (script 8807) and shows Jim providing its materials
  (scripts 8828, 8839). The build takes nothing from the inventory; "Junior Jim helpfully provides
  the materials required to build the cargo hold." is a game message, then Jim's line.
- **Shipyard visit**: fade, Junior Jim (14973) at 2083,2724; the portal's Exit at stage 30 fades back
  to the docks and Jim carries on from "Okay, looks like that's you all sorted, mate".
- **Item boxes**: the cup (shown, given), saw, hammer, log book (31985: given, updated), crate
  (picked up, delivered), and Jim's tutorials: shipwright icon 32916, port task board 32913 with
  camera 3063,2985,640 to 3058,2986,280 and an arrow at 3058,2986 centre 140, log 31986 with camera
  3042,2991,720 to 3046,2998,120 and an arrow at 3046,2997 north 110.
- **Rewards**: Jim puts the two repair kits (31964) in the raft's cargo hold with varbit 18316 when
  he says so (the hold later holds just the kits); the completion adds the 25 sawmill coupons. The
  spyglass the Wiki lists comes from Chartin' Charles McAtless ("Charles thrusts a spyglass into
  your hands.", rsprox 242 20261105T101904), not from Jim. Sailing reaches level 2
  at the delivery (100 XP) and level 5 at completion (Wiki: 300 XP).

## Runs

### 2026-11-12 · agent · claude-opus-5-5

- **Start:** fresh account at Port Sarim with `::tele` (the only teleport).
- **Route:** the interview, the tutorial voyage steered with `set_heading` to the wreck and stopped
  there, the hook and its cutscene, Steve, Ribs, Steve, Jim, the shipyard (crates, gangplank,
  hotspot Build through the customisation trigger with no materials, portal), the raft to Port
  Sarim and back with the crate, the ledger, Jim, Old Grog and Steve.
- **Result:** stages 2 to 50 on the lines above; cargo hold built free at 28.
- **Not checked:** the vision client, the raft's cargo-hold contents in the interface, relog at
  every stage.
