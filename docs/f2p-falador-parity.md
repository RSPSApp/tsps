# Falador F2P quest parity

The implementations use the revision 240 RSProx recordings supplied for issue #600 and the OSRS Wiki. Recordings remain outside the repository; these notes contain only quest events. Cache revision 241 supplies the identifiers.

| Quest | Recording | Captured milestones |
| --- | --- | --- |
| Doric's Quest | `20260816T164303-59bcb26` | Anvil refusal 5146; start/pickaxe 5194; copper item box and animations 5216; Continue consumes materials and completes at 5221, jingle 154 |
| The Knight's Sword | `20260817T113003-59bcb26` | Start 1215; Reldo's final explanation changes state 1659; pie changes state 2319; request picture 2343; Squire's response 2583; portrait collected on Continue 2866; portrait hand-in Continue 3177; sword made 3706; final hand-in Continue 3997, jingle 153 |
| Goblin Diplomacy | `20260817T005704-59bcb26` | Crate claimed before starting at 202; main varbit 2378 is 3 at 375, 4 at 432, 5 at 516, 6 at 568; completion at 571, jingle 153 |
| Black Knights' Fortress | `20260817T005704-59bcb26` | Start and dossier 1678; countdown 1698–1706; listening finishes 2589; cabbage cutscene 3068–3166; completion 3421, jingle 152 |

## Doric

Starting through either Doric or his anvil changes state and awards the bronze pickaxe immediately before his materials request. Anvil and item-on-anvil actions use the generic Smithing access hook; other anvils remain usable. His whetstone refuses use before completion. Low Mining gets the recorded recommendation warning, rather than a hard level requirement.

The native copper-ore box plays player animation 3071 and Doric animation 3072. Materials remain in the backpack until Continue, are revalidated and consumed together, and reward 180 coins, 1,300 Mining XP and one Quest point exactly once. The existing 10/100 save stages are retained.

## The Knight's Sword

The existing 0–7 save stages are retained. Merely opening dialogue or choosing Reldo's topic cannot advance progress. Reldo, Thurgo's picture request and the Squire's portrait directions change state with the captured displayed lines. Previous Giant Dwarf contact permits the documented Reldo skip.

Thurgo's pie box updates after three and nine cycles, then waits for Continue. It consumes an actual whole pie once. Portrait collection waits for its native statement's Continue; Sir Vyvin can prevent a watched search in his room. Opening/shutting the cupboard changes its model; opening uses animation 536. Portrait, ore, bars and sword hand-ins revalidate the actual inventory, use the recorded native boxes, and prevent repeated rewards. Blurite mining now belongs to the shared Mining engine, including depletion and respawn, rather than granting an instant ore in the quest.

## Goblin Diplomacy

The previous internal stages 1/3/4/6 are preserved and mapped to OSRS varbit 2378 values 3/4/5/6. It is no longer sent as an unrelated varp. Varbit 13594 controls Grubfoot's public armour, while 2379–2381 persist each crate's separate one-time claim. Crates work before starting and use the recorded goblin-mail item box and sound 2581.

All three fittings use private template instances with the two generals and Grubfoot. The scene fades, camera, twelve-cycle changing-room sequence, curtain animations 4346/4347 and armour appearances follow the recording. Mail is consumed and progress advances when a fitting ends, so interrupted fittings preserve the undelivered item. The final scene returns the player before granting five Quest points, 200 Crafting XP and one gold bar. Logout restores the village and controls. Direct mail hand-ins replay the scene instead of skipping it. Orange/blue dye work in either item order and can recolour previously painted mail.

## Black Knights' Fortress

The 12 Quest point requirement is enforced; the low-combat warning is advisory. The dossier arrives with Sir Amik's recorded start line. Its native countdown repeats three at +2, then two at +4 and one at +6, exploding at +8 with animations 4549/4551 and graphic 770. Reading does not advance the investigation. The four saved story stages remain unchanged.

Listening uses animations 4195/4552 and advances only after the final overheard line, then stands with 4197. Speaker portraits are preserved rather than flattened to the witch. The banquet warning stores each player's pending crossing separately. Normal cabbage starts a private sabotage scene; a Draynor cabbage is retained and refused. The scene includes the throw animation/graphic, both cabbage projectiles, cauldron bubbles and morph, actors and their recorded ambient walks, fades, camera and timed dialogue transitions. Progress advances on returning from the scene, not when using the cabbage. Logout restores the original hole tile and controls. The recorded post-quest Sir Amik greeting is supplied without replacing active Wanted! dialogue.

**Capture coverage.** No capture available today shows the main route: Sir Amik's start, the dossier, first listening, the cabbage scene and the hand-in. The `20260817T005704` capture cited above is not in the rsprox database or on this machine, so those timings cannot be re-checked and that route is compared only with the Wiki. Rsprox 469 (rev 233, varp 130 already 4 at login and never changing) is a post-quest fortress visit, ticks 2963–6051, and proves these legs:

- Sturdy door and every other fortress passage: the player crosses between the passage's own tile and the tile across its edge, not past it. Each crossing opens the passage for two ticks (loc 38848 on its tile, open leaf 2340 or 17142 across it at rotation +1) with sound 46 or 2410.
- Main doors 73/74 at x 3007: "You can't open this door."
- Banquet door: guard 4775 warns from the west side only. Going in makes the nearest Black Knight shout "Die, intruder!" and attack (tick 4697).
- Sturdy door warning head is guard 4774.
- Grill after the quest: 4195, then 4552 two ticks later with the first line, then 4197 after "Purrr....".

Rsprox 1581 (rev 225) and 2977 (rev 231) prove the completed journal text and the overview's start sentence. Rsprox 552 (rev 227) has nothing for this quest; its Sir Amik lines are Recipe for Disaster.

**Known differences left in place.** Generated dialogue, from the Wiki, differs from 469: after "Yes, but I work here!" the capture has one box, "I might be new here but I can tell that's not true! You're not even wearing proper uniform!", where the data has two, and the sturdy-door branch lacks the player's line. It also has "scar ing" for "scaring". The disguised guard line in 469 (King Arthur, tick 4193) is the King's Ransom variant, so "Hey! Get back on duty!" stays Wiki-only. The Wiki's black-armour disguise passes the sturdy door and gets "Good day to you."; its "please go on through" at the banquet door is not played because the generated text holds an unresolved `[sir/madam]` template. Banquet entry happens on picking the option rather than two ticks later after the player's line. Fortress knights spawn as 517 where 469 shows 11953.

## Verification and evidence limits

From `server/`: `node --test tests/f2p-falador-parity.test.cjs` covers the milestones, native boxes, interrupted scenes, all three fittings, item revalidation, anvil access, crate exhaustion, prior-contact skip and one-time rewards.

Live checks on worktree MCP port 49802 confirmed Doric’s low-Mining warning and full start/hand-in: varp 31 remains 10 while the native copper box is open with all materials held, then Continue changes it to 100 and awards exactly 180 coins, 1,300 Mining XP and one Quest point. A live orange Goblin fitting entered its private template, showed all three actors with orange Grubfoot 11252, retained the mail during dialogue, and returned to the original village tile with mail consumed, varbit 2378=4, appearance 13594=1 and busy 12393=0.

The captures show one successful route through each quest. Sir Vyvin's refusal wording/facing boundary and other unrecorded failure branches use Wiki intent and need dedicated captures to establish exact packets. Hidden Grubfoot armour changes currently replace the private actor while behind the curtain because the shared NPC API lacks an explicit transformation update. Scene HUD suppression uses the existing busy/minimap controls, without reproducing every temporary sidebar mount. These are remaining visual/packet fidelity limits, not alternative quest routes. The captured 15-cycle blurite sample is not treated as a guaranteed mining timer; the Wiki specifies a 25-second respawn and skill-based success chance.

## Shared dialogue condition isolation

The full quest registry previously allowed unrelated members quests to answer F2P prose conditions. Dwarf Cannon treated Rune Mysteries research notes as Nulodion’s notes; other broad rules matched ship materials, Tutorial Island equipment and shield-container capacity. Narrow NPC or owned-page guards now keep those predicates in their own quests. Recipe for Disaster’s Cook’s Assistant check is restricted to its Cook, and Shield of Arrav answers its two container-capacity conditions itself. `tests/f2p-condition-registry.test.cjs` loads the actual quest registration order and tutorial instructor handlers to verify held/missing research notes, ship payments and materials, full/available shield-container inventory, tutorial slot/equipment branches and the public Lumbridge Guide’s routing.


## Recorded camera coverage

The complete decoded sessions were audited rather than only the dialogue extracts. Goblin Diplomacy and Black Knights' Fortress share `20260817T005704`; Doric is `20260816T164303`, and The Knight's Sword is `20260817T113003` through its completion at tick 3997. The later camera commands in the last session belong to The Corsair Curse and are outside The Knight's Sword's route.

| Quest scene | Captured directed camera commands | Timing and rates |
| --- | --- | --- |
| Goblin Diplomacy, orange/blue/brown fitting | Move to `(2961,3514)`, height 450; look at `(2957,3512)`, height 150 | At +2 from each fitting's fade-out; both use `232/232`, `heightrelative=false` |
| Black Knights' Fortress, cabbage sabotage | Move to `(3035,3499)`, height 1500; look at `(3032,3505)`, height 300 | At +10 from the throw; both use `100/100`, `heightrelative=false` |
| Doric's Quest | None on the captured quest route | Session/login resets are not quest cutscenes |
| The Knight's Sword | None on the captured quest route | Later Corsair cameras are not attributed to this quest |

All three Goblin fittings clear the five shake channels one tick before the shot and send `unlock=false` before their return reset. Black Knights clears them at the throw; its camera resets on returning from the room and sends the recorded final unlock/reset three ticks later. All source tiles are translated into the private room. Existing Falador tests now assert these command values, shot boundaries, resets and all three Goblin repetitions, including interrupted fitting cleanup.
