# Vale Totems

The Fletching minigame in the Auburn Valley, built from the OSRS Wiki ("Vale Totems", "Totem site", "Vale offerings", the Vale Totem creation template), rsprox captures (recordings 1098, 1100, 1105, 1108, 3127 and 3276 on https://rsprox.net/database, and the regular-world rev 242 recording 20261109T224258-5ab63b4 of the whole miniquest) and the cache. It is one plugin, `server/plugins/minigames/ValeTotems.plugin.js`, with its units in `server/plugins/minigames/valetotems/` and its data in `server/plugins/minigames/data/vale-totems.json`. The accompanying miniquest is the Quests plugin's `server/plugins/quests/quests/ValeTotems.Quest.js`.

The captures were all recorded on Leagues VI and Grid Master worlds. Leagues multiplies the offerings a player collects by 4 (the Wiki calculator's "League offering multiplier"): the captured pile varbit held 10 for a decorated oak totem and "You collect 40 offerings." followed. Everything else matched the Wiki, so the plugin follows the varbit and the Wiki.

Status:
- **Done:**
  - building, carving and decorating at all eight sites, with the Fletching level per wood, run energy and Construction xp;
  - the ents' visit every 80 ticks: offerings, durability, collapse and new spirits;
  - the spirit NPCs at each site, with per-viewer spawn/despawn sequences and slot-2 spot effects;
  - the durability leaves above a carved totem, sent to each viewer's invisible site NPC;
  - claiming and inspecting offerings;
  - Rummage, Hasty-rummage and Inspect on Vale offerings, with the loot table, research points and collection log;
  - the Vale Totems miniquest (Ranulph and Isadora), as recorded: its three cutscenes in instances, every line with its chathead animation, the lessons, the scripted 100-offering visit and the Sacraments of Ent Folk reward. The minigame's other sites stay closed until it is complete;
  - the carve menu coming back two ticks after each carving;
  - Ranulph's Vale Research Exchange (Trade, the cache omnishop, paid in research points);
  - the Sacraments of Ent Folk (Read: the captured book with the reader's own notes);
  - Bale of flax (Unpack: 25 flax) and Dirty arrowtips (Clean: arrowheads by Fletching level);
  - `::entvisit` for testing.
- **Not done:**
  - the ents walking their route, ent trails (double offerings and +15% xp for four actions, `ent_totems_trail_*`), and admiring beautiful scenery for run energy;
  - the fletching knife's faster actions, the Carpenter's outfit bonus, ent seeds and the clue nests;
  - filterable ("spam") chat messages, which the server doesn't support yet.

## Layout

| File | What it owns |
| --- | --- |
| `Shared.ValeTotems.js` | The data, ids by cache gameval, captured animations and sounds, dialogue helpers and the one repeated action per player. |
| `State.ValeTotems.js` | The ent_totems varps and varbits: reading, writing, saving, restoring at login, and which players the visits apply to. |
| `Totems.ValeTotems.js` | Build, Carve and Decorate. |
| `Offerings.ValeTotems.js` | The offerings pile (Claim, Inspect) and the Vale offerings item (Rummage, Hasty-rummage, Inspect). |
| `Loot.ValeTotems.js` | One roll of the rummage loot table. |
| `Ents.ValeTotems.js` | The 80-tick visit cycle and the spirit NPC spawns. |
| `Spirits.ValeTotems.js` | References to the actual shared spirit NPCs and effects sent to one viewer. |
| `Icons.ValeTotems.js` | Invisible site NPCs and viewer-specific durability leaves derived from saved site state. |
| `Commands.ValeTotems.js` | `::entvisit`. |
| `Items.ValeTotems.js` | Bale of flax (Unpack) and Dirty arrowtips (Clean). |
| `Book.ValeTotems.js` | The Sacraments of Ent Folk (Read, its Destroy warning) and the counts its notes give. |
| `Shop.ValeTotems.js` | Ranulph's Trade: the `ent_totems_shop` omnishop and its research-point currency. |

The miniquest lives with the other quests in `server/plugins/quests/quests/ValeTotems.Quest.js`; it owns Ranulph's and Isadora's conversations, the three chat varbits and the site-1 gate. Its cutscenes are `server/plugins/quests/valetotems/Scenes.ValeTotems.js`, their timelines `valetotems/data/scenes.json`.

## State

A player's state is the client's own varps, which the cache's multilocs and multi-NPCs read: `ent_totems_site_N_a` and `_b` for each site, and `ent_totems_research_points`. They are saved as one attribute (`vale-totems:varps`) and sent again at login.

| Varbit | Values |
| --- | --- |
| `site_N_base` | The totem's wood: 0 none, 1 oak, 2 willow, 3 maple, 4 yew, 5 magic, 6 redwood. |
| `site_N_base_carved` | 1 once all three animals are carved. |
| `site_N_base_multiloc` | Spans both: 0 shows the Totem site (Build), 1-6 the uncarved totem (Carve), 9-14 the carved one (Decorate). |
| `site_N_low`, `_mid`, `_top` | 1-6 uncarved (the wood), 10-14 carved: 9 + the animal (1 buffalo, 2 jaguar, 3 eagle, 4 snake, 5 scorpion). |
| `site_N_decorations` | 0-4. |
| `site_N_decay` | The durability left: oak 2, willow 3, maple 4, yew 5, magic 6, redwood 7. |
| `site_N_points` | The offerings pile; above 0 it shows the Offerings loc (Claim, Inspect). |
| `site_N_animal_1..3` | The three spirits at the site. |
| `site_N_multianimal_a..e_1` | 1 shows that spirit's NPC (`ent_totems_site_N_animal_X_1`). |

The sites' base locs are `ent_totems_site_N_base` (57016 + 6 × (N − 1)), with the offerings loc beside it. Sites 2 and 6 were never clicked in the captures; their tiles are the Wiki's two remaining Totem site locations.

Durability leaves use `npc_headicon_specific` on slot 0 of `ent_totems_site_icon`, with sprite archive `headicons_et` and frame `site_N_decay - 1`. In recording **234/03276**, site 7 finishes carving at tick 5968 with durability 6; tick 5969 sets frame 5. Visits at ticks 6041 through 6361 count down through frames 4 to 0, and collapse at tick 6441 clears the slot with 65535/65535. The [Wiki](https://oldschool.runescape.wiki/w/Vale_totems#Ents_visits) establishes the durability mechanic; the recording establishes frame selection and timing: a visit's decay varbit and leaf frame arrive in the same tick, and the collapse clear likewise, while a carve's frame follows its varbit by one tick. These are Leagues captures; regular-world leaf rendering has not been independently captured here.

The generic viewer-only packet changes one of eight icon slots after NPC info. It leaves other slots and shared NPC prayer icons alone. Native clients ignore unknown NPC indices and discard customization when the actor leaves local view; later global head-icon updates replace it. The content unit listens to `network:npc-sync`, containing the actual objects encoded for that viewer, and queues changed leaves for the next sync. On re-entry or fresh login it derives the current leaves from saved varps. It stores no persistent icon override and does not replay the old frame.

## Miniquest

The route and stage values come from Quest Helper (`helpers/miniquests/valetotems/ValeTotems.java`); the words are the Wiki's "Vale Totems (miniquest)" transcript. Progress is `ent_totems_intro` (varbit 17227), the same varbit the cache's own script reads:

| Value | Meaning |
| --- | --- |
| 0 | Not started. Ranulph offers the miniquest after Children of the Sun and level 20 Fletching. Site 1 shows the old totem (oak; buffalo, jaguar, eagle; durability 2), which can't be carved or decorated ("You're not really sure what to do with that, but maybe there's someone in the valley who does."). |
| 10 | Accepted (no chat line). The ent's scene plays. |
| 20 | The ent worshipped the totem (scene 1, tick 480). Talking replays from "Interesting... It's like some sort of ritual." |
| 30 | Ranulph broke the totem (scene 2, tick 527): every site 1 varbit back to 0. Rebuild, carve and decorate site 1. |
| 40 | Set as the next conversation opens after the fourth decoration (tick 693); the offering scene plays. |
| 50 | The scene's visit left 100 offerings (tick 710); claim them. |
| 60 | Offering claimed; talk to Ranulph or Isadora. |
| 70 | Complete (the client's `ent_totems_intro` reads 100, tick 758): no chat line, jingle or scroll; the Sacraments of Ent Folk (item 31016) in an objectbox, "Ranulph gives you a notebook.". |

Ranulph and Isadora spawn as the cache's multi-NPC parents (`ent_totems_intro_ranulph` 14576, `ent_totems_intro_child` 14579), so the client picks their form from `ent_totems_intro`: Isadora shows from 30, Ranulph gets Trade at 100.

### Cutscenes

Each one fades out on the continue that starts it, rebuilds the player into an instance two ticks later (13x13 zones copied from 1312, 3320, unturned), plays there, fades out, rebuilds the real map and fades in before the talk goes on. Inside: `fov_clamp` 3, `cutscene_status` 1, `minimap_state` 2, the area-sound, draw-distance and roof overrides, hidden NPC/ground-item ops and closed side tabs, all cleared on the exit tick. The camera moves at 232/100, then glides 120 cycles (ease-in-out sine) to 1366, 3361.

| Scene | Recording ticks | What happens |
| --- | --- | --- |
| Worship | 469-495 | The ent (`ent_totems_ent_cs`) walks to 1370, 3372, worships (seq 12511; stage 20) and leaves; the animal spirits wander. |
| Break | 506-538 | The player and Ranulph walk up to the totem; "It's a beautiful totem." / "Indeed! Look at this bit!" wait for their continues; Ranulph pickpockets it (seq 881) and a tick later it breaks (varbits, map effect 2369, sounds 1739 and 7018; stage 30). Isadora's talk follows; its last line is the player's. |
| Offering | 696-722 | As the worship, with Isadora; on tick 710 the pile reads 100, the totem loses a point of durability and stage 50 is set (map effect 3359). |

A logout mid-scene puts the player on the scene's exit tile; the stage stays at its last checkpoint, and talking replays from there. Not sent: `hidelocops` and `minimap_toggle` (no encoder yet). The web client does not redraw the broken totem inside the instance (its rebuilt scene reads stale vars); the official client does.

Ents leave site 1 alone until the miniquest is complete: its durability and pile stay as they are from the carving (tick 621) to the scripted visit (tick 710).

Three chat varbits mirror the lessons: `ent_totems_broken_chat` (17228), `ent_totems_carve_chat` (17229) and `ent_totems_decorate_chat` (17230). Until Isadora teaches carving the Carve option says "You're not quite sure how to carve the totem. Ranulph and Isadora might be able to help."; until Ranulph teaches decorating, Decorate says the same about decorating. Building the quest totem also prints "... It's now ready to be carved. Ranulph and Isadora might be able to tell you how." and does not open the carve menu.

The minigame asks the quest plugin through the custom event `vale-totems:access` which sites are open. During the miniquest only site 1 is; after stage 70 every site is. The quest asks the minigame to show Isadora's and Ranulph's wrong-animal warning through `vale-totems:wrong-carve`, and `vale-totems:offerings-claimed` moves 50 to 60. The fourth decoration stays at stage 30: stage 40 is only set by the next conversation with Ranulph or Isadora, and that conversation's scene always resets site 1's pile to 100 offerings. This also covers an ent visit that dropped its own offerings between the decoration and the conversation.

The gate only covers Build. A player who already built a totem at sites 2-8 before starting the miniquest keeps that totem's Carve, Decorate and Claim options until the quest is complete.

The minigame's `vale-totems:varps` snapshot does not include the shared `ent_totems` varp (4758), so the quest stage and chat bits are left to the Quests plugin rather than restored from a stale snapshot.

Not captured: the wrong-animal warning, the "still working on it" reminders and the knife hand-out use the Wiki transcript's words; the replays after a logout are ours.

## Captured behaviour

- **Build:** a tick after arriving, the log is used, with `human_pickupfloor` and sound 1739 and the message "You erect an oak totem.". The carve menu opens on the same tick. "You don't have any logs to build a totem with." when there are none.
- **Carve:** skillmulti mode 34, one at a time: "What animal would you like to carve?" with Buffalo, Jaguar, Eagle, Snake and Scorpion and their `ent_totems_animal_icon_X` items. Carved ones show the `_disabled` icon. The menu comes back by itself two ticks after each carving that leaves the totem unfinished (20261109T224258-5ab63b4 ticks 613-619, 1094-1101); walking off stops it. The third carving's only message is "You finish carving the totem." (ticks 1103, 1317); during the miniquest it names the animal and the finish mesbox follows a tick later.
  - Choosing one plays `human_pickuptable_walkmerge` with sound 10384 (delay 15) and says "You carve a buffalo into the totem.".
  - The third carving sets `base_carved`, the carved `base_multiloc` and the durability.
- **Decorate:** `human_pickuptable_walkmerge` with sound 2739 (delay 20). A tick later the item goes and "You decorate the totem." shows. The next decoration starts the tick after that.
  - The fourth is a mesbox, "You add the final decoration to the totem."; during the quest it is followed by the player line "There we go! I's say that's the totem finished!".
  - A fifth gets the mesbox "You have already added as many decorations as possible to the totem.".
  - With nothing to use: "You don't have anything to decorate the totem with.".
- **Ent visits:** every 80 ticks every site is visited at once.
  - A fully carved totem gets its offerings and loses a point of durability. At 0 it collapses, with every site varbit back to 0, on the same visit.
  - A site with no totem gets three new spirits. A built totem, carved or not, keeps its spirits.
- **Spirit transitions:** RSProx 232/03127 ticks 253/255, 237/01108 ticks 6608/6610 and 237/04054 ticks 5099/5101 show removed species' despawn sequence followed by a slot-2 spot effect, then introduced species' spawn pair two ticks later. Retained species receive neither effect. The detailed 234/03285 ticks 8114/8116 update `animal_1..3` before despawn, keep the old visibility mask for two ticks, then update `multianimal_*_1` before spawn. The cache names the buffalo's sequence family `bison`. These recordings are from the special worlds identified above; this adds their visual contract without changing visit rates or rewards.
  - Effects belong to one viewer and never change the shared NPC animation/graphic flags. They are queued after NPC sync and discarded when the NPC is absent from that viewer's local list; they are not replayed on later entry or login.
  - The live visibility mask is transient during those two ticks. Saved snapshots always contain the final selected species and mask. Logout settles that mask and stops its timer. A superseding developer-triggered reroll stops the previous timer and restores a reselected despawning actor; that recovery is a defensive lifecycle choice, not a recorded gameplay sequence.
- **Offerings per visit:** the Wiki's table, the wood's base plus an amount per decoration: oak, willow and maple 2 + 2, yew 3 + 2.5 (rounded down), magic and redwood 3 + 3. Recorded visits matched it for oak, maple, yew and magic.
- **Claim:** a tick after arriving, `human_pickupfloor` with sound 2582 and "You collect 40 offerings." (an objectbox during the miniquest). **Inspect:** an objectbox with the offerings, "There are ten offerings here." / "There are 20 offerings here." (words up to ten).
- **Exchange:** Trade opens the omnishop (`omnishop_main_init` [5458]); the info panel shows the items' examines; "You don't have enough Vale Research Points.".
- **Sacraments of Ent Folk:** Read opens `indexed_book` (680), ten pages: contents, the reader's notes (totems built, rummages, research points) and Ranulph's notes. Destroy warns "Ranulph in Auburnvale can give you another.".
- **Dirty arrowtips:** Clean turns one dirty arrowtip into one arrowhead at a time, on the click's tick, with no message, sound, animation or xp, and stops at the first arrowhead with no room (RSProx cleaning-arrowtips, rev 242, Fletching 59: 27 to 26 for a steel arrowhead with one free slot; 26 to 20 for 4 steel, an adamant and a mithril with two). With no free slot: "You need at least one free inventory space to clean those.". The arrowheads' weights per Fletching band (boostable) and the 50 a click are the Wiki's.
- **Bale of flax:** Unpack takes one bale for 25 flax, "You unpack a bale of flax."; with fewer than 25 empty slots, "You need at least 25 empty spaces to unpack the flax.".
- **Rummage:**
  - Uses 100 offerings every 2 ticks while there are enough. Each plays sound 1412 with "You rummage through the offerings..." and "You find some loot: 26 x Dirty arrowtips" ("You find some loot: Bird nest" for one), and gives a research point.
  - The first point ever also says "You now have 1 Vale Research Point!" (green) and "Ranulph offers rewards to those who help with his research.".
  - With fewer than 100, an objectbox: "You don't have enough offerings to rummage through.<br>You need at least 100.".
- **Hasty-rummage:** up to 500 at once: "You rummage through the offerings four times..." then a loot line per rummage.
- **Inspect (item):** an objectbox, "You have enough offerings to rummage through them<br>once. You've earned 0 Vale Research Points." (green numbers, "4<br>times" for more).

## Estimates

These are not in the captures or the Wiki:

- **Wrong animals:** one maple totem with one wrong animal got 6 offerings instead of 10, the only sample. Each wrong animal takes 40% off here. The Wiki only says "significantly fewer".
- **Messages:** "You need a Fletching level of 50 to build a maple totem.", "You need a knife to carve the totem.", "Hasty-rummage twice/three times/five times", and the pile's Inspect above twenty, which shows digits.
- **Book plurals:** the notes' "Vale Totems", "N times" and "Research Points" are the Wiki transcript's, in the captured line breaks.
- **Exchange for ironmen:** the `ent_totems_shop_ironman` row for every ironman mode.
- **Log choice:** with several logs, the best one the player has the level for is used.
- **Quest refusals:** the requirement refusal ("...you'll need a Fletching level of 20 first.") and the not-started refusal at sites 2-8 (the captured site 1 mesbox, "You're not really sure what to do with that, but maybe there's someone in the valley who does.") are ours. During the quest the captured mesbox "You should probably talk to Ranulph and Isadora before doing that." is used. The knife hand-out uses Isadora's transcript lines.

## Checking it

- `node --test server/tests/vale-totems.test.cjs` (after `yarn build`) covers building, carving, decorating, visits, claiming and rummaging.
- `node --test server/tests/vale-totems-quest.test.cjs` covers the quest registration, the site gate, the old totem, the intro, the two lessons, the scripted 100 offerings and completion.
- `node --test server/tests/vale-totems-scenes.test.cjs` plays the three cutscenes' timelines against the recording's ticks, and a logout mid-scene.
- `node --test server/tests/vale-totems-specific-effects.test.cjs` uses real Player, PlayerSession, PacketSender, cache varbits, TaskManager and the startup hook's actual NPC spawns. Only transport output and RNG are controlled. It checks the two-tick visibility boundary, packet order/slot/species, a second viewer, saved-state restoration on a fresh player during the transition, logout cancellation and a superseding reroll. The older Vale tests use lightweight player fixtures and supplement this coverage.
- `server/tests/npc-specific-headicons.test.cjs` and `server/tests/vale-totems-headicons.test.cjs` cover real sessions and startup NPCs, viewer isolation, stale queued actors, slot boundaries, durability/visits/collapse, view removal/re-entry and saved-state login. Browser tests cover cache slots, global replacement, map removal and same-frame NPC continuation; gateway tests round-trip actual native bytes through the revision-241 decoder.
- With the agent MCP: teleport to site 3 (`tele 1386 3276 0`), give oak logs, a knife and four oak shortbows (u), then `object_option` Build, Carve and Decorate on loc 57028 at 1385, 3274. `::entvisit` runs a visit at once. The minigame now requires the miniquest, so complete it first or set stage 70.
- Miniquest by hand: talk to Ranulph at 1366, 3367, build at 1370, 3375, carve the three nearby spirits, decorate with four oak items, talk again, claim the 100 offerings and talk once more. The `::entvisit` command is not needed for the scripted offering.
