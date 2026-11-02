# Rune Mysteries, The Restless Ghost, Romeo & Juliet and Imp Catcher

Behavior sources are the [OSRS Wiki](https://oldschool.runescape.wiki/), the supplied live rev240 recordings, and this worktree's rev241 cache for identifiers. No recording, account name or raw packet transcript is committed.

Recordings: `20260811T103609-59bcb26` (Rune Mysteries start), `20260814T112547-59bcb26` (remaining Rune Mysteries plus the three other quests). Times below are recording ticks, not wall time. The complete relevant conversations and scenes were read, including the optional Cadava drink and failed ghost conversations.

## Rune Mysteries

The capture writes varp63=1 after continuing the accepted player response (start t2586); the air talisman arrives in objectbox193 one tick later, alongside varbit13720. All talisman/package/notes handovers and examination messages use item boxes, rather than printing narration to game chat.

The return recording takes the talisman and writes stage2 at t1322. Agreeing to visit Aubury writes3 at t1340; package290 arrives at1341. Aubury takes it and writes4 at1983, writes5 when offering his notes at1989, then gives notes291 at1990. Tea is consumed directly with animation829 and sound2401. Sedridor takes the notes at3593, but completion and the returned air talisman1438 wait until the explanation ends at3606. The completion jingle is154; the reward is1QP and mine access, with no XP.

The plugin keeps issued/delivered flags so cancelling after a handover can resume without losing progress or duplicating quest items. Existing stages0–6 retain their meaning. The short explanation, identity-doubt continuation and interrupted package/notes branches now execute their actual transcript continuations. Wizard mine teleports remain in the existing canonical Runecrafting plugin, which also remembers the return wizard.

References: [Rune Mysteries](https://oldschool.runescape.wiki/w/Rune_Mysteries), [Rune essence mine](https://oldschool.runescape.wiki/w/Rune_essence_mine).

## The Restless Ghost

The start menu displays a continued message229 when combat is below10. Urhney hands over amulet552 in objectbox193 at t786 and writes varp107=2. A replacement checks inventory, equipment and banks, and a full inventory cannot advance progress. His sigh uses message229. The ghost's failed/scary conversation does not advance anything. Stage3 waits until continuing the thankful response after the full skull explanation (t1089). A broken imported `above` jump is now an explicit canonical continuation so the other amulet conversation choices can reach that explanation.

Opening the coffin plays player536 after1tick, changes to multiloc15061 after2 and raises ghost922 at3250,3195 after4, using4019. Only the quest coffin at3249,3192 is handled. Its open form transforms through varbit2129. Search uses continued message229.

Searching altar2146 at3120,9566 takes skull553, writes stage4 plus varbits2130/2128, and animates skeleton924 at3120,9569 with4017. It attacks after standing and disappears after100ticks; defeating it is optional. The Wiki's -97.5% combat XP bonus is applied. Re-searching with a skull uses message229. Inspecting and destroying the skull have the captured item message/confirmation.

Returning the skull plays832 and sound1744. The client sees stage5 before the river sequence, but the saved pending-release flag keeps delayed rewards recoverable after logout. A private copy of the graveyard contains the ghost, its two overhead phrases and animation4018. The captured projectile668 route is3248,3193→3244,3193→3244,3190→3253,3181, with60/60/95client cycles and the camera changes. The player returns to3247,3193, then receives1QP/1125PrayerXP and jingle152. No skull or extra amulet is rewarded.

References: [The Restless Ghost](https://oldschool.runescape.wiki/w/The_Restless_Ghost), [its Skeleton](https://oldschool.runescape.wiki/w/Skeleton_(The_Restless_Ghost)), [Ghostspeak amulet](https://oldschool.runescape.wiki/w/Ghostspeak_amulet).

## Romeo & Juliet

Varp144 follows the captured0→10→20→30→40→50→60→100 sequence. Stage10 follows Romeo's kiss wording, stage30 follows reading the message, stage40 is the crypt/potion instruction, and stage50 is the request for berries. Handing over message755 immediately removes it, but a delivered flag lets interrupted reading resume. Berries753 leave with the "You hand over the berries" box, as its text says (#1673); a saved `romeo-and-juliet:berries-handed-over` flag lets a mix cancelled before potion756 is handed out resume on the next talk, so it cannot destroy the ingredient. The mix uses3283, graphic188(height64), sound1930 and a delay before the final handover box.

Father Lawrence's congregation segment uses its own chathead5042 and fixed14tick camera sequence with three overhead player fragments. It no longer asks for several Continues on duplicate imported fragments.

Juliet's room scene copies the mansion's plane1 cache chunks into a private area, with Juliet5035, Phillipa5040 and Draul5039, correct speakers, camera positions and drinking/death animations3284/836. The potion remains until the final Phillipa line; stage60 and varbit1838=1 change there (capture t2988), and the player returns to3157,3425,1. The crypt scene copies the actual2320,4632 map, moves Romeo and Phillipa, restores the player's original tile, then grants5QP and jingle154. Varbit1838=2 restores Juliet afterwards. The potion displayed on the completion scroll is not a reward.

Look-at and the optional drink work from the inventory. Drinking elsewhere is refused. At the Apothecary, the confirmation consumes one potion into vial229, plays829, camera sway and836, the near-death/fade/time-lapse messages and the Apothecary's recovery line. It does not kill or damage the player. Existing stages10–100 are preserved.

References: [Romeo & Juliet](https://oldschool.runescape.wiki/w/Romeo_%26_Juliet), [Cadava potion](https://oldschool.runescape.wiki/w/Cadava_potion).

## Imp Catcher

Both ordinary completion and the precollected-beads start play the full checking conversation. The fast route writes varp160=1 when accepting at t3801. After the bead-handover message at3823, the ritual has no Continue button: fade/camera/jingle133, wizard4285 at+5, four beads consumed and client stage2 at+7, graphic714(height100)/sound1633 at+8, amulet1478 and875MagicXP at+17, then1QP/completion at+19 with jingle153. Pending/issued flags recover interrupted rewards exactly once. General postquest dialogue and trading another full bead set for an amulet stay available, with no further XP or points. Grayzag's in-progress taunt is selected.

Recording 3202 (rev 232, main game) rechecks the post-quest menu: "Got any more quests?" gives "No, everything is good with the world today.", the spell option gives "I don't think so, the type of magic I study involves years of meditation and research.", and the amulet option asks for "one of each coloured bead again... Black, white, yellow and red." The no-beads reply and "Very well. See you soon!" match the transcript. The journal now follows [the wiki journal transcript](https://oldschool.runescape.wiki/w/Transcript:Imp_Catcher/Journal) at every stage, including the all-four-beads branch.

References: [Imp Catcher](https://oldschool.runescape.wiki/w/Imp_Catcher), [Amulet of accuracy](https://oldschool.runescape.wiki/w/Amulet_of_accuracy).

## Verification and limits

From `server/`, after building:

```sh
node --test tests/f2p-varrock-parity.test.cjs tests/restless-ghost.test.cjs tests/npc-dialogues.test.cjs tests/runecrafting-exit-portals.test.cjs tests/lumbridge-vampyre-parity.test.cjs tests/cowbell-amulet-parity.test.cjs
```

The focused suite uses the real cache, quest runtime, dialogue manager, transcript replay and templated scene palettes. It includes full Rune Mysteries short-route, ghost amulet and Juliet/crypt dialogue round trips, warning continuation, item safety, projectile timing, optional drinking, scene cleanup/recovery and the full timed Imp ritual. The older Restless Ghost regressions assert the captured delayed behavior. Syntax checks and `git diff --check` pass.

The full camera audit covers the ghost release's2 move/3 look-at packets, Romeo & Juliet's9 move/9 look-at packets and Imp Catcher's1 move/1 look-at packet. Every shot carries the captured rates and terrain-height mode, with positions remapped into the templated scenes. The crypt restores all three previously missing tour pans at+0/+5/+8 ticks, the return shot at+15 and continued dialogue at+16; its final approach waits for Romeo's Continue. The river's5/5 look-at and the ritual's232/100 pair are preserved. Camera shake, clearing and pitch-lock resets follow the recorded scenes. Rune Mysteries' supplied start and completion recordings contain no quest-directed camera move/look-at sequence.

Remaining presentation differences: journal wording remains the existing semantic journal rather than a packet-identical transcription. Death's Office/item-retrieval storage has no common lookup for Urhney's lost-amulet branch. Generic Apothecary strength/energy/antipoison services (interface556) are outside these quest changes. No fresh MCP/client replay was performed for this batch yet; the earlier Cook/Sheep/Count live checks are documented separately.
