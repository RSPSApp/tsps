# Tutorial Island

"Learning the Ropes", built from an RSProx recording of a full Tutorial Island run on OSRS: from the Gielinor Guide to Lumbridge, with a Hardcore Ironman chosen on the way. The OSRS Wiki transcripts give the instructors' words.
- **Plugin:** `server/plugins/areas/TutorialIsland.plugin.js`, with its units in `server/plugins/areas/tutorialisland/`.
- **Data:** `server/plugins/areas/data/tutorial-island.json`.
- **Ironman tutor:** `server/plugins/modes/ironman/Setup.Ironman.js` (see [ironman.md](ironman.md)).

The plugin is off in the shipped `world.json` (`"plugins": { "TutorialIsland": false }`). A world turns it on with `"plugins": { "TutorialIsland": true }` in its `world.local.json`.

## Progress

Progress is the OSRS `tutorial` varp (281) itself, saved as the attribute `tutorial-island:progress`:
- **Values:** 1 on the past-experience screen, 2 at the Gielinor Guide, 30 once the Survival Expert has handed over the net, … 680 before the Home Teleport, 1000 when done. Every value is a step in the data file, named in code (`STEP.FISH` is 40).
- **Old saves:** the old 0–53 stage index (`tutorial.island.stage`) is moved to the step it showed, the first time it's read.
- **Admins:** `::tutnext` / `::tutlast` walk the steps.

## The first login (captured)

A new account gets no welcome screen ("CLICK HERE TO PLAY"); it goes straight to the character design, as in OSRS.
- **The design:** MakeOverMage opens the design screen (`player_design` 679) at first login. Meanwhile the tutorial shows the captured "Setting your appearance" text.
- **Then:** once the design is confirmed, the past-experience screen opens.

## The past-experience screen (captured)

New accounts are at step 1 with `tutorial_player_experience` (929) open, under the text "Past Experience".
- **The answers:** the screen's script (8558) builds them in slots 1–3 of `929:4`: "I'm brand new! This is my first time here.", "I've played in the past, but not recently." and "I'm an experienced player."
- **Answering:** the server makes the slots clickable (pause button), gets the answer as a continue on `929:4` with the slot, and moves on to step 2. The answer is saved as `tutorial-island:experience` (new, returning or experienced). Closing the screen opens it again.
- **What it changes:** the transcripts' conditions read it. A brand-new player gets the Magic Instructor's short send-off; a returning or experienced player is asked "Were you planning to become an Ironman, by the way?", which points them to the Ironman tutor.
- **Players from before the screen** count as brand new.
- **Not applied:** in the capture, "experienced" also turns off a set of new-player safeguards (accept aid, drop warnings, the alchemy warning threshold to 150,000, and others).

## What each step shows (captured)

On every step change the server sends:
- **The progress varps:** `tutorial` (281) and `tutorial_progress_overlay` (406), a 0–20 section counter.
- **The step text in the chatbox:** `mesoverlay` (263) at `chatbox:chatoverlay` (162:567), filled by script 1974 with `<col=0000ff>Title</col><br>body`, and `chatoverlay_allowmesoverlap` (10690) = 1.
  - Steps 20 and 550 close it (10690 = 0), as captured.
  - While the player works ("Your character is now attempting to catch some shrimp…") the text is replaced, without a title.
- **The hint picture:** `tutorial_overlay` (614) at `overlay_atmosphere`, with 614:1 and 614:4 hidden, and script 2584 for the step's picture (1–23).
- **The hint arrow:** on an NPC or a tile, and `current_hint_arrow` (14192).
  - Tile arrows use the captured OSRS position and height, as the OSRS client draws them:
    - **Position:** the tile's centre, or the middle of its west, east, south or north edge (a door's arrow sits on the door's side).
    - **Height:** OSRS's height byte, so the arrow sits height × 2 world units up (128 above a door, 160 above the tree, 5 on the ladder hole).
    - `sendPositionalHint(tile, position, height, plane)` sends both. The hint packet carries them as OSRS does, plus the floor (`encodeHintArrow`).
- **The flashing side tab:** `flashside` (3756) = tab + 1. The other tabs stay locked until their step, in the captured order.
- **Highlights:**
  - inventory items: script 8461, with the tutorial's highlight styles; 8465 clears them;
  - interface buttons (the smithing dagger, Wind Strike, Home Teleport): script 8478.

**Tab clicks:** clicking the flashing tab completes the steps that ask for it (3→7, 30→40, 50→60, 230→240, 390→400, 430→440, 531→532, 560→570, 630→640). The tab buttons (`stone0`–`13`) are mapped for the three desktop layouts (161, 548, 164). On the mobile frame no click arrives, so talking to the instructor stands in for it.

## Hand-outs (captured)

An item and the step it completes arrive together, on the instructor's line that hands it over. If the player closes a talk early, the step stays and the talk replays. This applies to:
- the net (step 30);
- the axe and tinderbox (70);
- the pickaxe (300);
- the hammer (340);
- the sword and shield (420);
- the shortbow and arrows (480);
- the runes (650).

**How it looks:**
- The "gives you" lines are item boxes: `objectbox` for one item, `objectbox_double` (11) for two. The net has no box.
- The Wiki transcripts write the step text as message lines ("InventoryThis is your inventory…"). Those lines are skipped, since the step text already shows it.

**Lost tools:** the net, the axe and tinderbox, and the pickaxe are only handed out once in the transcripts. Talking to their instructor again while on that step gives back what's missing. This is ours; the recording doesn't show it. The chef's flour and water, the hammer, the combat gear and the runes already have "lost it" branches in the transcripts.

## The island's own skilling (captured)

The pond, the trees, the fire and the range are tutorial content. They always succeed and report in an item box:

| Action | Animation | Ticks | XP | Result |
|---|---|---|---|---|
| Net the pond (`newbiefishing` 3317) | 621 | 6 | 10 Fishing | raw shrimps 2514, "You manage to catch some shrimp." |
| Chop a tutorial tree | 879 | 5 | 25 Woodcutting | logs 2511, "You manage to cut some logs." |
| Tinderbox on the logs | 733 | 8 | 40 Firemaking | fire 26185, sound 2596 |
| Raw shrimps on the fire | 897 | 3 | 30 Cooking | shrimps 315, "You manage to cook some shrimp." |
| Pot of flour 2516 + bucket of water | none | 0 | none | bread dough, "You make some dough." |
| Bread dough on the range | 896 | 5 | 40 Cooking | bread, "You manage to bake some bread." |

| Mine the tutorial rocks | 625 | 5 | 17.5 Mining | tin or copper ore, "You manage to mine some tin/copper." |
| The furnace, with both ores | 899 | 3 | 6.2 Smithing | bronze bar, no smelting menu |

**While one of these runs, the player can't walk away**, as on the island.

**Smithing the dagger** runs through the Smithing plugin's menu, as captured.

## Doors and gates (captured)

The tutorial's doors and gates never stay open.
- **Passing:** clicking one walks the player through (the agility runner's forced walk), while its open leaves show for 2 ticks with the captured sound: 62 for doors, 67 for the wooden gate, 71 for the metal gates. Then it's closed again.
- **The swaps:** the open leaves are the captured ones, in data `passages`: `inactivepoordoor` 1539 for doors, `inactivefencegate_l/r` 1566/1565 for the wooden gate, and `inacmetalgateopenl/r` 1573/1574 for the mine's gates and the rat pen. OSRS also puts an `inviswall` in the doorway meanwhile; that isn't sent here.
- **Leaving early:** a section's exit refuses with the Wiki's "You need to … first." lines until its step.

## Leaving (captured)

1. **Wind Strike:** the first Wind Strike at a chicken (hit or splash) moves on to 670. On the next tick it moves to 671 with "Congratulations, you've completed a quest: Learning the Ropes".
2. **The Magic Instructor:** "Yes." to "Do you want to go to the mainland?" moves on to 680 (cast Home Teleport).
3. **The Home Teleport:** teleports are blocked on the island until 680. Then the Home Teleport plays as usual.
4. **Arrival:** arriving off the island clears the inventory and equipment and gives the starter kit:
   - bronze axe, pickaxe, tinderbox, small fishing net, shrimps;
   - bronze dagger, sword, wooden shield, shortbow, 25 bronze arrows;
   - 25 air, 15 mind, 6 water, 4 earth and 2 body runes;
   - bucket, pot, bread; and 25 coins in the bank.

   It also shows "Welcome to Old School RuneScape." and the "Welcome to Lumbridge!…" item box, and sets the progress to 1000.
5. **Where you end up:** a world whose spawn isn't Lumbridge moves the player to its spawn. A mode can send them elsewhere (`tutorial-island:destination` { player, location, welcome }): a Group Ironman arrives on The Node.
6. **A Group Ironman** leaves by the rowboat south of the Magic Instructor's house after the Ironman tutor, without the magic lessons (Wiki: Tutorial Island). Group Ironman asks `tutorial-island:leave` { player, handled }, which ends the tutorial at once (steps 4 and 5, so they arrive on The Node).

**Ours:** the Gielinor Guide's first talk offers to skip the island. `TutorialIsland:allowSkip` set to false in world.json `pluginConfig` turns this off.

## Not done yet

- **The display name screen** before the character design.
- **The experienced player's option defaults** (see above).
- **The poll booth's ballot interface** (928). The booth's three boxes are shown.
- **Music unlocks** on arrival in Lumbridge.
- **The quest completion scroll** (`questscroll` 153).
