---
quest: Monkey Madness I
key: monkey_madness_i
status: passed-with-issues
tested: 2026-10-31
tester: agent
model: claude-opus-5-5
commit: 1182ccc20
cache: osrs-241_2026-10-20
start: checkpoint
travel: travel_to
---

# Monkey Madness I

The quest is played to the end across two watched runs: chapter 1 in the first, then chapters 2 to 4,
the rewards, Daero's training, the repeat talk and a relog in the second. The second run fixed eight
quest bugs, including two soft-locks (the zoo pen and the demon arena) and the mm_main wire values
Quest Helper keys on. A later focused check covered the jail on every approach, the human
exit from Marim and the hangar exit. Open findings are the pronoun placeholders and a core varp
overwrite (#1647). The hangar sliding puzzle was added after those runs (see Findings); it has not
been played in a client.

## Findings

Newest first. Nothing is filed as an issue yet; the fixes are in this branch's PR and #1645.

- **fixed** The hangar Teleportation Device (4868-4870, Operate) did nothing. It is the hangar's
  exit (wiki): it now lands the player south of the Gnome Ball field at 2393,3466.
- **fixed** A human could not leave Marim except by the gate or a teleport: the south-east Bamboo
  Ladder (4743/4744) climbs from plane 0 straight to plane 2, so the Ladders plugin found nothing
  above it, and End of bridge (4745, Jump off) had no handler. The quest now owns both ends of the
  ladder and the jump, with the landing tiles from Shortest Path's transport rows.
- **fixed** The jail happened only once, and the Bamboo Gate let a human through. During the quest
  a human is now knocked out and jailed on every approach up the valley or click on the gate (the
  wiki's guide: "placed in the jail cell again"); only monkey form passes. Each catch is counted
  for Lumo's sent-back lines, his 10/15/20/50/100-times lines and the one-time stuffed monkey
  (3169). As exported those count lines sit after a random block that ends every option, so the
  plugin plays the matching count's condition, or the random block, on its own.

- **fixed** King Narnode's repeat talk after the quest played The Grand Tree's generic line. The
  plugin handed Narnode to Monkey Madness II whenever The Grand Tree was complete, which is always
  true here, so the "after Monkey Madness I" talk was unreachable. It now yields only once Monkey
  Madness II has started.
- **fixed** The Jungle Demon arena had no way out. In live the whole 10th squad is summoned and
  Zooknock teleports the player out. Only the demon was spawned, so after the kill the player was
  stuck. Garkor (1434) and Zooknock (1442), the final-battle NPCs, are now summoned with it and play
  the battle and after-battle talks. A login back in the arena summons them again.
- **fixed** The first sigil teleport played "the final battle begins... again!". The shake message
  set the used flag before the transcript's first-time check.
- **fixed** A player caged in the Ardougne Zoo monkey pen could not leave. The minders walk outside
  the fence, the pen has no gate, and talking to one said "I can't reach that!". A caged player now
  reaches a minder across the fence.
- **fixed** The Bamboo Gate (4787/4788 at 2719-2722, 2766) moved the player along the gate row and
  could wall them in at 2718,2766. It now crosses at x 2720, between 2720,2765 and 2720,2767, as the
  live transport data does.
- **fixed** The temple trapdoor (4879 at 2807,2785): the shared Doors plugin took its Open and
  swapped in the open trapdoor (4880) a tile east, where Climb-down was out of reach. The quest now
  claims the Open through `door:toggle` and drops the player into the temple dungeon.
- **fixed** The denture building's south doorway (4710 at 2764,2764) did nothing. Its open leaf
  (4711) has no name, so Doors can't pair it. The quest now passes the player through, both ways.
- **fixed** mm_zooknock (varbit 127) never reached 5. The plugin matched only half of Zooknock's
  "Garkor had long decided..." line. The route test fed it the same half line, so it passed.
- **fixed** varp 365 (mm_main) carried the plugin's own stage numbers. Quest Helper keys on the live
  values (3 chapter 2, 4 the zoo, 5 the sigil, 6 back to Narnode, 9 complete), so its step was wrong
  from chapter 2 on ("Return to King Narnode" while on Ape Atoll). Saved stages are unchanged; a
  `varpValue` mapping sends the live value. Where live moves 1 to 2 inside chapter 1 is not recorded
  (saved stages 3 to 6 send 2).
- **fixed** Daero's Travel option in the Grand Tree always played the in-hangar "How do I leave?"
  line, so it never took the player back to the hangar. Outside the hangar it now plays his
  "return to the hangar?" talk.
- **open** Core: mounting the magic tab sends `SPELL_UNLOCK_VARPS`, which writes varp 365 =
  0x7fffffff (for the Ape Atoll Dungeon Teleport). Unwielding the greegree did that mid-quest, so
  the client saw the quest as complete until the next login. Not quest code (`PacketSender`); #1647.
- **open** Transcript pronoun placeholders show literally: "[He is/She is/They are]" in Daero's
  hangar briefing, "[him/her/them]" in Waydar's Lumdo menu and in Caranock's line in the chapter 4
  cutscene. Shared dialogue runtime or dumper.
- **fixed (source and test level, not played in game)** The hangar sliding puzzle. Operating the
  Reinitialisation Panel after Waydar's task opens the 5x5 puzzle on `trail_slidepuzzle` (cache
  interface 306, whose CS2 688 calls 690, which picks the inventory by varp `if1` (261): 7 draws
  inventory 221 `reinitialisation_inv`, and the panel sets `if1` to 7; pieces are the
  objs `reinitialisation_01`-`24`, the inventory RuneLite's Puzzle Solver reads); stage 5 comes when
  the last piece slides home. Evidence: Wiki "Monkey Madness I" ("similar to the puzzle boxes") and
  the cache. No rsprox capture of the puzzle was found (searched object 4871, NPC 2021 and the
  text), so the scramble (a puzzle box's 101 random slides) and closing the interface on the last
  slide are inference. Test: `server/tests/monkey-madness-hangar-puzzle.test.cjs`.
- **open** Zooknock's first talk repeats its opening three lines. The Wiki transcript has the same
  repeat, so the export is faithful to it.
- **open** `travel_to`: the Grand
  Tree's Tree Doors (1967/1968) and the Stronghold gate (190) came back `blocked` even though the
  doors were already open and walkable. It has no route out of the mould cavern or from the dungeon
  to Marim, since ropes and dungeon ladders aren't in its data. Its legs name the Grand Tree ladders
  by their live ids, which differ from the data ids (matched by name).
- **open** `travel_to` returns `no-route` for the Tree Gnome Stronghold, since it needs a spirit
  tree, glider or teleport (from the first run).

## Runs

### 2026-10-31 · agent · claude-opus-5-5 (focused)

- **Start:** a fresh headless account set to stage 7 with the quest command and placed on Ape Atoll
  with `::tele` (diagnostic positioning, not a playthrough), on the branch stacked on #1645.
- **Checked:** the first valley approach jails with the newcomer line; after picking the lock, the
  south-east ladder climbs to 2803,2733 (plane 2) and the bridge jump lands on 2806,2724. A second
  approach jails again with a random sent-back line, and so does a human opening the gate from
  inside Marim. Wielding the greegree, the gate opens to 2720,2765. In the hangar the Teleportation
  Device lands on 2393,3466. The count lines and the stuffed monkey are covered by the route test.
- **Not checked:** the denture house's light floor (in live it sends the player back to jail), the
  guard patrol and the Monkey's Aunt, a jailing after the quest, and a watched client.

### 2026-10-31 · agent · claude-opus-5-5

- **Start:** checkpoint from the first run: Tester at the Lumdo landing on Ape Atoll, varp 365 =
  7 (saved stage 7), 7 quest points, all skills 99, inventory Gnome amulet and Gnome royal seal.
  Declared setup: a gold bar, a ball of wool, 5 bananas, 10 sharks, Varrock teleport runes, one
  Monkey bones (the ordinary Karamja monkey drop; the Monkey Archers here drop ninja bones), and
  `::infhp` as a combat aid. No `::tele`.
- **Route:** valley to the knock-out and jail, Lumo's talk, pick-lock out, Garkor (mm_garkor 2). The
  denture crate, the hole crate down to the mould cavern, the mould crate, the rope up. Varrock
  teleport, the Grand Exchange spirit tree to the Stronghold, Daero's Travel to the hangar, Waydar
  to Crash Island, Lumdo to Ape Atoll, the dungeon ladder down to Zooknock. Dentures, mould and gold
  bar handed over, the enchanted bar returned. Through the Bamboo Gate, the temple trapdoor, the bar
  on the wall of flame, the amulet strung and worn. The monkey child (uncle, bananas, toy) gave the
  talisman. Back out through the gate to Zooknock: talisman and bones gave the Karamjan greegree and
  the Caranock/Waydar cutscene (varp 365 = 4). Varrock teleport, spirit tree to the Battlefield of
  Khazard, walked to the Ardougne Zoo: caught by the minder as a monkey, the zoo monkey into the
  pack, the greegree off, out through a minder. Walked back to the Stronghold and flew Daero,
  Waydar and Lumdo to Ape Atoll. Garkor disguised (mm_garkor 3), the Elder Guard, the west
  watchtower and bridge to Kruk, Kruk to the throne room, Awowogei twice (varp 365 = 5). Garkor's
  chapter 4 cutscene, the sigil (mm_garkor 6), the sigil worn to the arena. The Jungle Demon took
  ordinary hits, then `set_npc_hitpoints` lowered it to 5 and combat finished it (varp 365 = 6).
  Garkor, then Zooknock's teleport out. Varrock teleport, spirit tree to the Stronghold, Narnode.
- **Result:** completion on Narnode's report: varp 365 = 9, quest points 7 to 10, 10,000 coins and 3
  Diamonds, no XP. Quest Helper reports FINISHED and agrees with the cache's completion value 9.
  Repeat talk to Narnode: no second reward. With the fix it plays the "after Monkey Madness I" talk
  and the "requirements to start Monkey Madness II" message. Daero's training (strength and
  stamina) gave +35,000 Strength and Hitpoints and +20,000 Attack and Defence, set varp 365 = 10,
  and refused a second claim. Relog by the user: stage 10, quest points 10, XP and inventory
  unchanged, and the offline save (written on logout) holds them. Quest Helper's step was right
  from the first fix onwards.
- **Fixes re-tested in game:** Daero's Travel, the temple trapdoor, the Bamboo Gate, the minder
  across the fence, the arena squad (restored by the login after the restart) and Zooknock's way
  out, the Narnode repeat talk. The Zooknock varbit and the sigil first-time line are covered by the
  route test only. This account had passed both points before those fixes loaded.
- **Not checked:** the hangar sliding puzzle in a client (added later, source and test level only), Glough's 200,000-coin skip, the
  monkey's aunt and the lost-toy talks, the attack-and-defence training choice, Bonzara, a lost
  sigil from Waymottin in game (the route test covers it), teleporting with the monkey, and the
  Quest Helper overlay in a client.

### 2026-10-31 · agent · claude-haiku-5-5

- **Start:** the Tester account was at a plain spot with all skills at 99 and melee max gear from setup commands. The prerequisites The Grand Tree and Tree Gnome Village were not finished, and Narnode refuses to start the quest without them. They were set complete with the quest command as declared setup. Then the account was placed at Narnode's tile with `::tele` before the quest's first step. Quest points went from 0 to 7 from the prerequisites.
- **Route:** from Narnode, up the Grand Tree ladders (objects 4458, 56233 and 56232), a glider from Captain Errdo to Gandius, the shipyard gate, G.L.O. Caranock. Back to Ta Quir Priw by glider, down to Narnode. Up to Daero, the blindfold to the hangar, the Panel, the hangar glider with Waydar to Crash Island. Lumdo, Waydar's convincing menu, then Lumdo's boat to Ape Atoll.
- **Result:** the quest varp 365 (`mm_main`) reached stage 7. Stage 1 gave the Gnome royal seal (item 4004). Stage 3 gave Narnode's orders (item 4005), which Daero took at stage 4. Stage 5, the panel, and stage 6, the Crash Island landing, were both recorded. Quest points stayed at 7 because the quest is not complete. The Gnome amulet (item 589) was in the inventory after the prerequisite quests were completed, probably their reward.
- **Not checked:** chapters 2 to 4, quest rewards, the repeat talk to King Narnode after completion, and a logout and login persistence check. The server was restarted once, so Tester went through a relog, but no explicit logout check was run.
