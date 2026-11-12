---
quest: The Lost Tribe
key: the_lost_tribe
status: passed-with-issues
tested: 2026-11-12
tester: agent
model: claude-opus-5-5
commit: 5303576e4
cache: osrs-242_2026-11-03
start: fresh
travel: travel_to
---

# The Lost Tribe

Fresh run from Sigmund to the treaty cutscene and the ring of life, against the user's start-to-finish capture
(#4071, #4175). It was run on the fix branch (then on `ac3564d7c`; since rebased onto `5303576e4`). Unchecked: the maze's traps (none are modelled),
the Cook, Bob and Father Aereck as the witness (Hans was this account's), and the brooch-for-helmet exchange.

## Findings

- **open** The tunnel's darkness overlay (`darkness_level`, overlays 96/97 and the minimap) isn't drawn. Darkness
  only runs Lumbridge Swamp Caves' insect timer. The dark-cave warning before the hole is done.
- **open** Duke Horacio can wander onto the tile of his room's closed door (3210,3220,1). From there he can't be
  reached ("I can't reach that!") until the door is opened. This is NPC wander collision, not quest code.
- **open** How the Cook and Father Aereck are named as the witness ("The cook says ...", "Father Aereck says ...")
  is ours. Only Hans is captured; Bob's wording is the Wiki's older revision.
- **fixed** The cellar hole moved the player 3 tiles from the wall's x with no animation, so from the tunnel side it
  sent them further in, again and again. #4175 #4071
- **fixed** Only Bob could be the witness; Father Aereck had no cellar question. #4071
- **fixed** The generals didn't show the greetings; Mistag didn't answer the Goblin Bow emote. #4071
- **fixed** The chest gave a H.A.M. cloak for the shirt; the brooch lay on the wrong tile.
- **open** Father Aereck's "Could you tell me more about prayers?" and "... about Saradomin?" have no lines in any
  transcript, so they are left out of his Lost Tribe menu. While The Restless Ghost is under way he keeps that quest's
  dialogue and is never picked as the witness (ours).
- **fixed** The book moved the quest on when closed, and the bookcase needed Reldo first.

## Live behaviour (rsprox captures)

From the user's capture 20261112T152024-5ab63b4 (revision 242, the whole quest). Ticks are the capture's.
`lost_tribe_quest` (varbit 532) is the quest's progress; the plugin's saved stages map onto it.

- **Start (38):** "So what do you need me to do?" moves 532 from 0 to 1.
- **Witness (62-73):** Hans was the witness. His menu's "Do you know what happened in the cellar?" plays the witness
  lines (Transcript:The Lost Tribe revision 15398483, "Talking to the NPC who saw the goblin"). His last line,
  "Thank you, ...! If you can convince the Duke ...", moves 532 to 2 as it opens. The Cook, not the witness, keeps
  his own menu.
- **Duke (110-121):** the option reads "Hans says he saw something in the cellar"; the Duke's last line, "Hmm, very
  well. I give you permission ...", moves 532 to 3.
- **Dig (173-181):** the pickaxe's wall swing (`human_mining_dragon_pickaxe_wall`, 6758). Three ticks later 532
  moves to 4 and an item box of the pickaxe says "You dig a narrow tunnel through the rocks."
- **The hole (191-245):** Squeeze-through on either side (6898 at 3219,9618, 6899 at 3221,9618) sends "You squeeze
  through the hole." and faces the wall on the click's tick. `human_pipesqueeze` (746) plays the next tick, then the
  player moves two tiles across with `human_pipeunsqueeze` (748). Without a light source, going in opens
  `cws_warning_16` (569) first and counts each showing in varbit 3866; "Yes I am sure." crosses from that tick.
- **Brooch (251-262):** it lies at 3230,9610 for the player only. Taking it changes no varbit.
- **Duke and brooch (305-317):** the Duke's "... The librarian in Varrock might be able to help ..." moves 532 to 5.
- **Library (363-397):** the player went straight to the bookcase (3207,3496), without Reldo. The first search plays
  "'A History of the Goblin Race'. This must be it." and the message box "You take the book from the bookcase.";
  later searches say "You search the bookcase..." and, four ticks on, "You find nothing of interest." In the book,
  turning to the symbols spread moves 532 to 6 (bookmark varbit 541 to 5). Closing it then plays "Hey... The
  symbol of the 'Dorgeshuun' tribe ..." (`chathap2`).
- **Generals (476-536):** the continue past Wartface's "That good idea. Watch." moves 532 to 7 and closes the chat.
  A tick later the player plays `human_cave_goblin_dance` (2128, 45 cycles in) and Bentnoze plays 6137; four ticks
  after that, `human_cave_goblin_bow` (2127) and Wartface 6136. Four ticks later comes the message box "The goblins
  show you the Goblin Victory Salute and Goblin Bow.", then the menu.
- **Mistag (845-884):** every Talk-to is the two panic lines. The Goblin Bow emote beside him starts "A human knows
  ancient greeting?" by itself; he bows (`dttd_zanik_bow`, 6000) at "Greetings, friend", and "We blocked up our
  tunnel ..." moves 532 to 8. Varbits 535 (mistag_denial) and 537
  (contact) stay 0 for the whole quest. "Can you show me the way out of the mines?" fades to 200, and three ticks
  later the player is at 3235,9610.
- **Duke and contact (933-941):** "Unless it is returned ..." moves 532 to 9.
- **Pickpocket (972-976):** `human_pickpocket` (881) facing Sigmund, the key in an item box ("You steal a little
  key."); again with it: "You have already stolen Sigmund's key."
- **Chest (992-1003):** without the key, a message box: "You don't have the key to open this chest." With it,
  varbit 534 goes to 1. The key is used up and the shirt, robe and hood are given (4298, 4300, 4302), the shirt in
  the key's slot. The chest shows
  opendungeonchest (2194) with `chest_open` (52) and an item box of the shirt, and it closes again as the player's
  line is continued. Live's chest now stands at 3209,3217,1; this cache's is at 3211,3212,1, and both answer.
- **H.A.M. hideout (1123-1191):** the trapdoor is picked (HamTrapdoor.Thieving). The crate's silverware moves 534
  to 3 with an item box; a second search says "You search the crate but find nothing."
- **Hand-in (1225-1268):** with the Duke's "I see I was ill-advised ..." line, 532 goes to 10 and 540 to 1. The
  castle Sigmund hides and `lost_tribe_sigmund_leaving` (6289) walks from his tile to 3208,3221, gone 15 ticks later;
  540 is back to 0 at 30 ticks. "The Duke writes a document and signs it." is an item box of the treaty.
- **Kazgar (1288):** Follow fades to 200, as Mistag's way out does (revision 224 recordings faded to 255).
- **Treaty (1305-1378):** continuing Mistag's "I will summon Ur-tag" fades out to 200. Two ticks later the dining
  room copy opens with the title box, which has no continue; a tick after that come the camera (3208,3226 height 300,
  looking at 3206,3222) and the fade in. The player enters at 3207,3217 and walks to 3207,3222 four ticks after the
  title, as the dining door opens (`elfdooropen` 1544 at 3207,3218, `nicedoor_open` 81). Ur-tag (from 3207,3216, ending at 3206,3221) and Mistag (from 3207,3215 to 3207,3220) follow a tick behind.
  The Duke is at 3206,3223 and Sigmund at 3213,3222. The player's bow line comes ten ticks after the title; at the
  Duke's "Welcome" the player runs to 3207,3224 while the Duke bows (858) and Ur-tag bows (6000, 20 cycles in). The
  camera pans at "I assure you", "Lumbridge is in your debt" and "These are strange times"; the Duke plays
  `emote_no` at "No, let it stay", Ur-tag steps to 3207,3223 to thank the player, and Sigmund laughs (861) at "Soon
  you will be destroyed!". After the last continue Sigmund walks SE, SE, E; four ticks later it fades out and 532
  goes to 11, and the player ends on the real map at 3207,3224.

## Runs

### 2026-11-12 · agent · claude-opus-5-5

- **Start:** fresh account with Goblin Diplomacy and Rune Mysteries completed and `::master`, a rune pickaxe and a
  lit torch, placed by Sigmund with `::tele`.
- **Route:** `travel_to` and teleport tablets (Varrock, Falador, Lumbridge) as the capture did, through the kitchen
  trapdoor, the cellar hole both ways, the tunnel, Mistag's way out, the H.A.M. trapdoor (picked) and Kazgar's
  Follow. The Duke's door had to be opened by hand (finding above).
- **Result:** varbit 532 followed the capture 0-11 step by step. 534 went 0 -> 1 -> 3; 535 and 537 stayed 0. 540 was
  1 for 30 ticks with Sigmund walking out. The ring of life arrived. A server restart mid-cutscene brought the
  player back to the scene's exit with the treaty, and the replayed scene matched the capture's tiles.
- **Not checked:** the other three witnesses, wrong maze paths, the brooch -> mining helmet exchange, a full
  inventory at the chest or crate.
