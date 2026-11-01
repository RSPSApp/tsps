---
quest: Desert Treasure II - The Fallen Empire
key: desert_treasure_ii
status: in-progress
tested: 2026-10-31
tester: agent
model: claude-opus-5-5
commit: ff35e7634
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Desert Treasure II - The Fallen Empire

A watched progression run reached the Leviathan chapter (stage 8, wire 54): the opening chapter, the
war room and the whole Vardorvis chapter play through, after the fixes below. The Scar route to the
first shipwreck chamber is blocked, so the Leviathan, Sucellus, Whisperer and finale chapters are not
tested. Many steps still differ from live OSRS; they are listed as open findings.

Live evidence: rsprox capture [1703](https://rsprox.net/database) (rev 226) is a full playthrough;
[3229](https://rsprox.net/database) (rev 232) covers the Digsite steps.

## Findings

Newest first.

- **open** The Scar north-west passage: from the damaged growth room only a dead-end pocket south of
  passage 49412 (2225,6421) is reachable; the shipwreck chamber entrance 49418 (2220,6402) and the blue
  teleporter (2237,6443) can't be reached, so the run stopped there.
- **open** Item Destroy prints "Drop item: &lt;id&gt;." and does nothing (Scar nerves 28446, X Marks the
  Spot treasure scroll 23067); spare Scar nerves can't be discarded. Not quest code.
- **open** The Wizards' Tower basement portal to the Temple of the Eye (43841, 3104,9574) has no handler
  ("You can't reach that!"); the run used the Minigame Teleport to Guardians of the Rift. Not quest code.
- **open** Quest Vardorvis bypasses protection prayers on every attack (Wiki and Quest Helper: Protect from
  Melee works except during specials); with his 50% lifesteal a magic player stalemates.
- **open** Quest Vardorvis drops a Bronze javelin beside the Temple key.
- **open** The Stranglewood barricade 49492 (1193,3401) doesn't block walking, and Climb-over flips the
  player back to the side they came from. Live crosses with an exact move (1193,3402 to 3400).
- **open** Strangler serum: tsps requires another talk to Kasonde before drinking; Quest Helper goes
  straight from mixing to drinking. Several Stranglewood messages are invented (herb, serum, potion).
- **open** The Stranglewood itself: live fades in with the text overlay (837), sets dt2 42 to 44 and
  15125 10 to 12, opens the infection HUD (836, varbit 15099) and fills the ruins with Strangled; tsps
  teleports to 1196,3450 with none of it. The hideout defence has no tumbler chests, satchels or detonator.
- **open** Korbal herb: Quest Helper's varbit 15100 (ingredient taken = 2) is never sent.
- **open** Kasonde's desk: live shows a two-item box (`objectbox_double`) with sound 2582; the potion note
  opens `note` (291) with 12 lines; drinking the potion says "You drink the potion. It tastes horrible."
  (anim 829, sound 2401). tsps uses invented chat lines.
- **open** Chapters are stages 7-10 in a fixed order (Vardorvis, Leviathan, Sucellus, Whisperer); live
  allows any order. Quest Helper (reorderable) points at the Whisperer first.
- **open** At the Frostenhorn record live sets 15125/15126/15127/15128 to 2 and 15130 to 1; tsps leaves them 0.
- **open** Opening chapter: no "Start the Desert Treasure II quest?" menu, door message box or
  "I don't understand... How?" cutscene; the winch and Digsite rocks skip live's animations, sounds and
  "That's the rocks cleared." line; the Ancient Guardian fight is hand-rolled (ids 12336/12337 swapped,
  spawns on the player, invented messages, no exit loc or barrier, human block animation); Banikan isn't
  a follower (12296, varbit 15110) and spawns on the player.
- **open** Transcript (data, not fixed here): Asgarnia Smith's last line reads "sigh*"; live is "\*sigh\*".
- **fixed** Kasonde wouldn't give the unfinished serum with a free slot: the transcript's inventory-space
  condition (szffOl) was unanswered, so its "no room" branch always played.
- **fixed** Climbing out of Kasonde's hideout landed outside his building (1187,3411), where he can't be
  reached; live lands inside at 1191,3410.
- **fixed** The Digsite rope (48919) had no Climb-up: the excavation could only be left by teleport. Now
  as live: anim 828, then 3383,3418 on the third tick.
- **fixed** The Frostenhorn record (transcript step -HvgV3) did nothing, leaving the quest stuck at wire 40.
  It now opens the record and sets 40 to 42, as live.
- **fixed** The golem search prompt was closed by its own transcript; it now opens the tick after.
- **fixed** War room, from capture 1703: altar Imbue charges all 8 cells (anim, gfx, sound, item box);
  inspecting the golem with charged cells inserts them and opens the puzzle from squares 0-7; puzzle drags
  from `cells` (35) work like a real client and any order of the identical cells powers it; the golem
  search shows "Checking..." / "Data found. Outputting now.", the stone-plaque record and varbits
  15111-15114; crate and altar use item boxes. Wrong-spell messages on the totems come from the transcript.
- **fixed** Totems attacked and chased the player, turned to face them, and the staff's follow-up attack
  spammed "That totem requires a blood burst spell or higher". They now never fight or turn, and live's
  "You empower the totem." and last-totem message box play.
- **fixed** A server restart left players logged in on a vanished instance (client stuck on "Loading -
  please wait."); DT2 now keeps the instance's exit and sends them there on login.
- **fixed** The vault plaque and statues used invented chat lines and sent no varbits: the plaque opens
  `woodplaque` (749) and the statues show live's message box; varbits 15105-15109 are sent.
- **fixed** The quest could start without His Faithful Servants (a Wiki requirement).
- **fixed** The Ancient Vault rendered as void in the middle (only plane 1 of its map was copied). Fixed in #1666.

## Runs

### 2026-10-31 · agent · claude-opus-5-5

- **Start:** the user's account Tester after `::master` and `::maxgear mage`; declared setup:
  `::quest ... complete` for Desert Treasure I, Secrets of the North, Enakhra's Lament, Temple of the Eye,
  The Garden of Death and Below Ice Mountain (His Faithful Servants left open to test the requirement),
  runes, ring of visibility, tinderbox, pestle and mortar, dragon pickaxe, facemask, Nardah and Digsite
  teleports, potions and a shark; Ancients through the Magic cape; `::tele` to the vault door. Baseline:
  QP 10, stage 0.
- **Route:** vault (Smith, plaque, statues), Digsite teleport to Terry Balando, winch, rocks, Ancient
  Guardian, totems, cells, golem puzzle and searches, Frostenhorn; Elissa; X Marks the Spot completed
  with `::quest` (declared aid: Veos only sails to Kourend after it) and Veos to Port Piscarilius; Barus,
  Kasonde's desk, note, potion, rowboat, ruins, hideout defence, herb, berries, temple, serum, Vardorvis,
  Temple key, Kasonde fight, medallion chest; Nardah teleport to the vault (Mysterious Figure), medallion
  placed. Minigame Teleport to Guardians of the Rift, Catalytic Guardian, Scar demons, Persten,
  pathfinder maze, tether, catalyst, growths and energies.
- **Aids:** a restart left Tester outside Kasonde's building (fixed bug), recovered with one
  `::tele 1191 3410`; `::infhp` for the fights (no food left); `set_npc_hitpoints` on Vardorvis (185 to 20)
  after real hits, because of the prayer-bypass stalemate.
- **Result:** stage 8 (wire 54), Vardorvis' medallion placed, Scar varbit 15128 = 16. Run stopped at the
  Scar shipwreck route.
- **Not checked:** Leviathan, Sucellus, Whisperer and the finale; rewards, repeat talk and relog at
  completion; the opening cutscene and Guardian against live (open findings).
