# Treasure Trails: easy to master

Beginner clues are in [beginner-treasure-trails.md](beginner-treasure-trails.md). This page covers
the members tiers, built in `server/plugins/treasuretrails/TreasureTrails.plugin.js`
(`members: true`) and its `trails/` units. Easy, medium, hard and elite are implemented. Master
trails are complete too: hot/cold, the three-part torn cryptics and Watson's master-clue exchange.

## Where the content comes from

The installed cache (revision 241) holds Jagex's whole clue-helper catalogue: the
`cluehelper_clue_*` DB tables, filtered by their `difficulty` column (1 easy … 5 master).

From easy upwards, every step is its own "Clue scroll (<tier>)" item, and item param 623 names
that step's clue-helper row. `Catalogue.TreasureTrails.js` joins the two, so the item in the
player's hand *is* the step. For each step it resolves:
- the target: an NPC (with its live morphs), a loc, a tile, or a keyed loc with the NPCs that drop
  its key;
- the outfit: one requirement per worn slot. It is either "any of these items", "any item of this
  clue item group" (item param 258: ring of dueling is 18, amulet of glory 6), or "nothing worn
  here". The cache writes the last as its `blankobject` item: "Have nothing equipped at all",
  "… and no boots";
- the challenge, if any: its question and answer come from the same `cluehelper_challenge_question`
  row, and its "Challenge scroll (<tier>)" item points back at the step's row;
- the emote slot and the STASH loc;
- the music track (DB table `music`, `midi` column).

Only rows with a "Clue scroll (<tier>)" item are clue steps. Quest scrolls such as the treasure
scroll share the tables.

Easy has 166 steps:

| Family | Target | Steps |
| --- | --- | --- |
| Cryptic | NPC | 41 |
| Cryptic | Loc (search/open) | 71 |
| Cryptic | Dig | 8 |
| Emote | Tile, outfit, Uri | 33 |
| Map | Dig | 7 |
| Music (Cecilia) | NPC | 6 |

Medium has 167 steps, 44 of them with a challenge scroll:

| Family | Target | Steps |
| --- | --- | --- |
| Anagram | NPC | 47 |
| Cipher | NPC | 6 |
| Coordinate | Dig | 44 |
| Cryptic | NPC / loc / key | 8 / 8 / 11 |
| Emote | Tile, outfit, two emotes, Uri | 25 |
| Map | Dig / crate | 10 / 2 |
| Music (Cecilia) | NPC | 6 |

Hard has 186 steps:

| Family | Target | Steps | Extra |
| --- | --- | --- | --- |
| Anagram | NPC / loc | 17 / 1 | 13 question challenges, 5 puzzle boxes |
| Cipher | NPC | 11 | 6 questions, 5 puzzle boxes |
| Coordinate | Dig | 54 | 53 summon a wizard named by the row: Saradomin 2955 (32), Zamorak 2954 (21) |
| Cryptic | NPC / loc / dig | 23 / 17 / 18 | 3 question challenges |
| Emote | Tile, outfit, Uri | 17 | the row names a double agent: 1778 (14), 1777 (3) |
| Fairy ring | Dig | 11 | read as "The cryptic reveals where to dig:" then the code, as on the Wiki |
| Map | Dig / crate | 4 / 3 | |
| Music (Cecilia) | NPC | 10 | |

Elite has 124 steps:

| Family | Target | Steps | Extra |
| --- | --- | --- | --- |
| Anagram | NPC | 12 | all question challenges, on one shared scroll |
| Coordinate | Dig | 41 | every one summons a guard: Armadylean 6587 (40), Bandosian 6588 (1) |
| Cryptic | NPC / loc / dig / kill / key | 15 / 2 / 12 / 14 / 1 | NPC includes Sherlock's skill challenge; the key is the King Black Dragon's chest |
| Emote | Tile, outfit, Uri | 19 | one emote each, every one with a STASH unit, no double agents |
| Map | Dig / crate | 5 / 1 | |
| Music (Cecilia) | NPC | 2 | |

The cache gives elite no puzzle-box or light-box rows. Only master rows use the challenge-box rows,
and the Wiki also lists light boxes as master-only. The legacy `Puzzle box (elite)` (12161) has no
row and is not used.

Master is different: it has one `Clue scroll (master)` (19835) for every step, with no row param.
The catalogue gives every master row that one item, and the trail meta's row names the step, as the
beginner runtime does. Master has 265 steps, plus Falo's 20 songs:

| Family | Target | Steps | Extra |
| --- | --- | --- | --- |
| Anagram | NPC | 16 | every one hands over a puzzle box or a light box |
| Coordinate | Dig | 28 | a Brassican Mage 7310 (19) or three Ancient Wizards 7307-7309 (9) |
| Cryptic | NPC / loc / dig | 33 | Falo the Bard's, Jorral's and Watson's, and 30 parts of three-part steps |
| Emote | Tile, outfit, Uri | 25 | a level 141 double agent 7312 on every one; all with STASH units |
| Skill challenge | Sherlock | 27 | the master clue is the task; there is no master challenge scroll |
| Hot/cold | Dig | 136 | Brassican Mage (117) or three Ancient Wizards (19) |

- **Hot/cold targets** are reached through Jorral's cryptic, never rolled themselves.
- **Three-part steps:** the targetless "Combine the torn clue scroll parts." row draws three of the
  other master cryptics.
- **Not rolled**, by the same rule as content the server lacks (`trails/data/master-parts.json`):
  - Watson's hot/cold starter: Watson gave out the device only in the Twisted League (Wiki);
  - Viggora's part: Curse of the Empty Lord isn't on this server;
  - Piles's part: the Resource Area fee isn't on this server;
  - Lovada's part: she has no world spawn;
  - Sherlock tasks without a detector (below).

The challenge answers are read from the cache. They agree with the Wiki's challenge-scroll guide
(the osrsreboxed-db `clue-challenges.json` export) on 89 of 90 questions. The exception is the Old
Crone's Slayer Tower question: the cache says 623, the Wiki 619. The game uses the cache.

## Trail state

A trail's state lives in the scroll's item metadata, under `treasure-trails:<tier>`:
`{version, token, revision, completed, length, row}`.

**Starting a trail:**
- A scroll with no trail (a drop, box or vessel gives the tier's first cache item, 2677 for easy)
  starts one the first time it is read or used.
- The trail starts on a uniformly random step, and the scroll becomes that step's item.

**Solving a step:**
- Each solved step replaces the scroll in the same slot with the next step's item, carrying the trail.
- The last step leaves a reward casket.
- Stale tokens and revisions cannot advance a trail twice.
- Banking, dropping, death and saves keep the trail, because they keep item metadata. A scroll
  read before a logout resumed at the same step after logging in again.

**Trail length:** easy trails are 2–4 steps, medium 3–5, hard 4–6 and elite 5–7 (Wiki, "Clue scroll (<tier>)"). The
Wiki publishes no per-length weights, so the length is chosen uniformly; this is an implementation
assumption.

## Steps

- **NPC:** talk to the target NPC; the step completes after the dialogue. The NPC may wander
  during the conversation without invalidating the handover.
  - NPCs speak their own transcript: the `treasure-trails-<tier>` variant in `npc-dialogues.json`,
    read through NpcDialogues' `npc-dialogue:start` with `exact: true` and a `select` that only
    captures the steps. An NPC without that variant gets the fallback line, not its everyday chat.
  - Where the transcript has nothing, a shared fallback line is used.
  - The received item and handover wording appear in the native item dialogue (`objectbox`,
    group 193, item argument 400). The transcript supplies its wording, including Lowe's
    generic "You've found another clue!"; the fallback names the giving NPC.
- **Challenge scroll** (Wiki "Challenge scroll"):
  - The first talk adds the challenge alongside the clue, requiring a free inventory slot.
    The challenge carries the same trail token and revision; it is not a second trail.
  - Reading the challenge scroll shows the question.
  - The next talk shows the NPC's question-request line, then opens the number prompt labelled
    "Enter amount:". A wrong answer costs nothing; the right one consumes both scrolls in one
    inventory refresh and gives the next clue or casket with an item dialogue.
  - Without its matching clue in the inventory, the challenge remains readable but cannot advance
    a trail. Repeated answers and stale dialogue callbacks cannot grant another step.
  - The words come from the NPC's transcript. The "talk again" variant goes under nine names
    (`when-talked-to-again`, `answering-the-clue`, …), and the wrong/correct branches under several
    wordings; any missing part uses the most common transcript wording.
- **Key** (medium cryptic): killing one of the step's NPCs drops its key (`npc-drops:add`) while
  the trail is held and the player has no key. The target loc then opens only with the key, which
  is used up. Contextual drop events also run when the NPC has no base drop table. A search without
  the key is handled as locked and shows the cache clue-helper's hint about the key's source;
  this feedback is functional wording, not a replay of each container's exact locked note.
- **Search:** a new generic core hook, `onBeforeObjectInteraction`, claims an interaction on the
  target loc at its exact tile before ordinary object handlers. It mirrors `onBeforeNpcInteraction`,
  and unclaimed interactions fall through.
- **Dig:** a spade (or Eastfloor spade) on the exact tile and plane.
- **Map:** Read opens the step's map interface; the dig is as above.
- **Emote:**
  - The player performs the step's emote within 3 tiles of its target while wearing the full outfit.
  - That spawns that tier's Uri for the player only; a successful talk advances the inventory on
    his first phrase, even if the player closes the conversation before "What?".
  - Medium steps need a second emote after Uri appears and before he is spoken to.
  - Uri speaks his transcript. With the wrong outfit or a missing emote he says "I do not believe we
    have any business, Comrade."; otherwise a random phrase, the player's "What?", then "You have
    been given a new clue!" (or a casket). The verified medium handover instead says "You've been
    given a clue!" and displays cache item `trail_medium_emote_exp9` (19780), independently of the
    next clue actually in the inventory. Uri remains through the spoken lines and is removed at
    the handover continuation; the recording's additional 3–5 tick transmitted-list delay is not
    reproduced.
  - The cache gives a target tile but no area, so the 3-tile radius follows the beginner runtime's
    usual value. This is an assumption.
- **Puzzle box** (hard; `Puzzle.TreasureTrails.js`, Wiki "Puzzle box" and the puzzle box guide):
  - **Hand-over:** the first talk adds the step's box alongside the held clue, on one of the
    tier's images (hard: castle, tree, troll).
    - The box pairs with its clue by gameval name (`<clue gameval>_puzzlebox`).
    - The image is stored in the trail meta.
  - **The board:**
    - Opening the box shows interface `trail_slidepuzzle`. Its board is inventory `trail_puzzleinv`
      (slots 0–24, an empty slot is the blank), and varp `if1` picks the image.
    - Each image's 24 pieces come from cache enum 1864.
    - The client predicts each slide and plays the sounds.
    - The server owns the board: it accepts only a piece next to the blank and always resends the
      board, so a refused move snaps back.
  - **Scramble:** a box starts 101 random slides from solved (Wiki), which keeps every board
    solvable. The board lasts the session, so a relog gives a new puzzle, as the Wiki says. Each new puzzle step gets a fresh board even within the same trail.
  - **Solving and words:**
    - Solving it marks the trail; talking to the NPC with the solved box gives the next clue.
    - The NPC's words come from its transcript: the "having solved" / "without having solved"
      variants or the "holding the puzzle box" branches.
    - "[player name]" is filled in.
- **Fights** (hard; Wiki coordinates guide, "Saradomin wizard", "Double agent"):
  - **Coordinate digs:** the first correct dig summons the step's wizard, owned by the player,
    seen only by them and attacking at once. Digging again does nothing while it lives. Its death
    marks the trail, and the next dig gives the clue.
  - **Emotes:** the emote summons the double agent first; its death brings Uri. There's no agent
    when the emote is the trail's first step (Wiki "Double agent"). The outfit must be worn again
    to speak to Uri.
  - **A wizard that is gone** (logout, death, despawn) is summoned again by the next dig. The
    Wiki notes that hiding and digging again summons another.
  - **Drops:** the fights keep their own Wiki drop tables.
  - **Data gaps, outside clue code:**
    - The Saradomin wizard only melees, because the NPC loader picks one combat style.
    - The Zamorak wizard lacks the Flames of Zamorak graphic.
    - Their shouts are missing.
- **Shared challenge scrolls** (elite): elite rows have no challenge scroll of their own. Every
  elite anagram hands over `trail_elite_anagram_challenge`, and Sherlock hands over
  `trail_elite_skill_challenge`. Like every challenge, the scroll is carried beside its clue and
  linked to it by the trail's token, so Read finds that trail's own question or task, and one item
  stands for many rows.
- **Sherlock's skill challenges** (elite; `Skills.TreasureTrails.js`, Wiki "Sherlock",
  Transcript:Sherlock):
  - **Hand-over:** showing him the clue ("Show this to Sherlock.") adds the challenge scroll beside
    it (a free slot is needed), with a task from `cluehelper_clue_skillchallenge` stored on the
    scroll. Read shows the task.
  - **Choice:** the task is picked from those whose stat requirements the player meets at their
    current level (the Wiki allows boosts). It falls back to any supported task.
  - **Counting:** the task counts only when it is done with the scroll in the inventory (Wiki). That
    marks the scroll and sends "You have completed your elite/master level challenge!"; talking to
    him then gives the next clue. Before that, he gives his everyday "bring it to me" line.
  - **Detection:** `trails/data/skill-challenges.json` maps each task to the event its action
    already emits, matched by item, NPC or prayer:
    - existing events: `equipment:changed`, `runecrafting:success`, `agility:lap`,
      `fletching:made`, `hunter:success`, `smithing:success`, `fishing:success`,
      `woodcutting:success`, `cooking:success`, and NPC deaths;
    - existing events that now carry the item: `mining:success` and `firemaking:success` gained
      `itemId`, aerial fishing's `fishing:success` its fish, and `runecrafting:success`
      `amountPerEssence`;
    - new generic emits at the action: `magic:enchanted`, `herblore:made`, `crafting:made`,
      `farming:planted`, and core `prayer:activated`.
  - **Every elite task is assigned:** skullball (`skullball:goal`) and the Dorgesh-Kaan lamps
    (`dorgesh-kaan-lamps:fixed`) have their own plugins.
- **Kill steps** (elite cryptic, Wiki cryptic clues: "pick up the clue or casket that it drops"):
  killing one of the step's NPCs while holding the clue takes the clue and drops the next one, or
  the casket, on the NPC's tile. The drop is the killer's alone and keeps the trail's meta.
  - A kill step is only rolled if one of its NPCs has a world spawn (`npc-spawns.json`).
  - That leaves out the pyre-ship barbarian spirit (Barbarian Firemaking isn't implemented), the
    shellbane gryphon (spawned only inside Troubled Tortugans), and the clue's Frost Nagua. The clue
    names 13788, but the world's Frost Nagua are 13787.
  - These steps return once the content does.
- **Guards** (elite coordinates, Wiki "Armadylean guard", "Bandosian guard"): the hard fight code
  as it is. The dig summons the step's guard, who must die before the dig gives the clue.
  - Data gap, outside clue code: melee hits flying monsters here. That includes the Armadylean
    guard (the Wiki allows only ranged, magic or a halberd) and the aviansies of a kill step ("fly
    high where a sword cannot help you"). This belongs to NPC combat definitions.
- **Master boxes** (`Puzzle.TreasureTrails.js`, `Light.TreasureTrails.js`):
  - **Which box:** each master anagram NPC hands over a puzzle box or a light box (the cache's
    `puzzle_or_light`); the Wiki doesn't say how one is chosen, so it is even.
  - **Puzzle box:** a master box is one of enum 1864's Zulrah, Cerberus, gnome child or Theatre of
    Blood images, each its own item (`trail_master_*_puzzlebox`).
  - **Light box** (`light_puzzle_box`, Wiki "Light box"): interface `light_puzzle` draws 25 lights
    from varp `trail_lights`, a set bit unlit (cs2 1339), so 0 is solved. Switches A-H are buttons
    1-8.
    - Neither the cache nor the Wiki gives which lights a switch toggles. Live captures do: nine
      boxes in three rsprox.net recordings (rev 227) each had their own masks, a switch averaging
      8.7 of the 25 lights. So each box gets 8 random masks (35% of the lights each) and starts a
      few presses from solved, which keeps it solvable.
    - The box keeps its masks and lights; all lit marks it solved. Its NPC then gives the next clue,
      as for a solved puzzle box.
- **Box messages** (live captures, rsprox.net):
  - **Master hand-over:** "Wingstone hands you a light puzzle box." or "Immenizz hands you a
    puzzlebox!", shown with the box. These replace the transcripts' "[light box/puzzlebox]".
  - **Opening a light box:** "You open the light box's control panel."
  - **Solving:** "Well done, hand this back!"
  - **Opening a solved box:** "You've already solved this challenge! Go hand it back."
- **Three Ancient Wizards** (master digs, Wiki "Ancient Wizard": "a three-on-one fight"): the fight
  code summons every NPC the cache's encounter lists. The dig gives the clue only once all of them
  are dead, and leaving dismisses all three.
- **Falo the Bard** (master, `Falo.TreasureTrails.js`, Wiki and Transcript:Falo the Bard):
  - **The song:** "Falo the bard wants to see you." sends the player to him. He sings one of his
    songs (`cluehelper_clue_falobard`), kept with the clue, so he sings the same one until it is
    answered.
  - **The answer:** using the object it names on him gives the next clue. The cache names it as an
    item list or a clue item group. A noted item doesn't count, and he doesn't keep it (the Wiki
    doesn't say he does).
  - **Wrong object:** "Falo's eyes fail to light up."
  - **Outlanders:** without The Fremennik Trials started, he says "Get away! I do not speak to
    outlanders."
- **Hot/cold** (`HotCold.TreasureTrails.js`; Wiki "Strange device", Transcript:Jorral; messages
  from live captures, rsprox.net):
  - **Jorral:** without Making History he refuses ("Stop! I can't help you unless you help me out
    first."). Without a device he hands one over ("Jorral hands you the strange device.", or "You
    should make some room for it before I can give you it."). Either way the clue then holds a
    random master hot/cold target.
  - **Feel:** "The device is warm." the first time, then "…, and warmer than last time.", "…, but
    colder than last time." or "…, and the same temperature as last time.". Beginner's bands are the
    Wiki's master table. Each feel deals 3-8 damage (Wiki) with "The power of the strange device
    hurts you in the process.".
  - **Without a target:** with no master clue, "This device won't function yet."; with one that has
    no target, "The strange device is inactive.".
  - **The dig:** inside the target's 9x9 square, the dig first summons its fight (a Brassican Mage
    or three Ancient Wizards); once they're beaten, digging again says "The strange device cools as
    you find your treasure." and gives the next clue. The device is kept (Wiki).
- **Three-part torn cryptics** (`Parts.TreasureTrails.js`; Wiki cryptic clues guide, "Torn clue
  scroll"; live captures):
  - **Reading:** the clue reads its three cryptics, each struck through once found.
  - **Torn parts:** each part gives its own torn part (1, 2 or 3, by its place on the clue). Dig
    parts say "You find a torn part of a clue scroll."; NPCs speak their transcript ("Here you
    go."), hand it over with "You are handed a torn part of a clue scroll.", then their
    compliment. With no space they say "Hey, I have something for you but you don't have any space
    for it!".
  - **A lost part:** a destroyed or lost part is given again by solving its part again (Wiki: "You'll
    have to solve another clue to re-obtain it"). While it is still carried or banked, its NPC talks
    as normal, and its dig says "You distinctly remember already finding a torn clue scroll part
    here and there isn't another one to take." (live captures).
  - **Conditions** (`data/master-parts.json`):
    - Robin wants 180 ranged attack and no toxic blowpipe; his "not the sort I'd recommend" line
      when not.
    - Ghommal wants 100 melee strength, and Wizard Cromperty 100 magic attack.
    - Abbot Langley wants a negative prayer bonus.
    - The Monk of Entrana wants a weapon or armour worn as one talks or tries to take the boat.
    - The Mage of Zamorak and Juna want three items from their cache outfit lists, and Sir Vyvin
      his white plate.
    - The Shadow Dungeon dig needs its cached ring of visibility.
    - Failing a condition, the NPC carries on as normal.
  - **Combining:** all three with the clue give the next clue or the casket ("You've obtained a new
    clue!" / "You've obtained a casket!").
    - Fewer: "I cannot combine the pieces without having all 3."
    - Without the clue: "You cannot see how to combine the 3 pieces without also carrying your
      clue scroll."
    - Inspect: "There must be more parts to this. If I can combine them together...".
- **Watson** (`Watson.TreasureTrails.js`; Wiki "Watson"; the exchange from live captures):
  - **Handing over:** using an easy, medium, hard or elite clue on him asks "Hand over <tier>
    clue." / "Cancel.". He takes it ("You hand over the clue scroll to Watson.") and remembers the
    tier (attribute `treasure-trails:watson-<tier>`, varbits `trail_watson_*`). A repeat says "You
    have already given Watson a clue scroll of that tier.".
  - **Check:** says which tiers he still needs ("I still need a medium clue from you before I give
    you a master clue scroll.").
  - **All four in:** "Nice work …, I've had one of each lower tier clue scroll from you." and a
    master clue, a box after X Marks the Spot, when clue capacity allows.
  - **A master clue used on him:** "Sorry [player name]. That scroll is for you, not me." (or his
    Sherlock joke).
- **Master Sherlock:**
  - **The task:** the master clue reads the task. It counts when done with the clue held, and
    Sherlock then gives the next clue.
  - **Supported tasks:** 19 of the 27 are detected by the same JSON. The data gains several worn
    slots (prospector, angler, lumberjack, graceful by name for its recolours) and areas (the Slayer
    Tower demons, the Ardougne market).
  - **New generic emits:**
    - `spirit-trees:travelled { planted }`;
    - `godwars:kill { godItems }`;
    - `crafting:made` at a furnace;
    - `thieving:success` with the stall or pickpocket target.
  - **Not assigned:** the Barrows teleport tablet, ranging mix, fiyr remains, sacred eel, light orb,
    reanimated abyssal, fiyr shade and the torn-scroll combine have no content or no check here.
- **Music:** from Cecilia's Wiki transcript, the player selects the requested track, then speaks to
  her.
  - "Select the song I asked you to play, and speak to me again."
  - "Thank you, I love that song!" then completes the step.
  - The track is tracked from `audio:play-song`.

### Map interfaces

No cache data links a map step to its map interface, so `trails/data/map-interfaces.json` records
them. Each was matched by opening every candidate interface on an isolated test world, capturing
it with the agent MCP's vision clip, and comparing it with the Wiki's map images.

| Step | Location | Interface |
| --- | --- | --- |
| `cluehelper_map_easy_0` | Al Kharid mine | `trail_map18` |
| `cluehelper_map_easy_1` | West of the Champions' Guild | `trail_map01` |
| `cluehelper_map_easy_2` | South-east Varrock mine | `trail_map02` |
| `cluehelper_map_easy_3` | Falador standing stones | `trail_map06` |
| `cluehelper_map_easy_4` | Galahad's house | `trail_map09` |
| `cluehelper_map_easy_5` | Behind the Wizards' Tower | `trail_map11` |
| `cluehelper_map_easy_6` | Falador statue crossroads | `trail_clue_easy_map006` |
| `cluehelper_map_medium_0` | Draynor willows | `trail_map03` |
| `cluehelper_map_medium_1` | West of the Crafting Guild (hobgoblin peninsula) | `trail_map07` |
| `cluehelper_map_medium_2` | McGrubor's Wood crate | `trail_map10` |
| `cluehelper_map_medium_3` | North of the Tower of Life | `trail_map15` |
| `cluehelper_map_medium_4` | Crate west of the Clock Tower | `trail_map16` |
| `cluehelper_map_medium_5` | Chemist's house, Rimmington | `trail_map17` |
| `cluehelper_map_medium_6` | Miscellania | `trail_clue_medium_map008` |
| `cluehelper_map_medium_7` | Mort Myre Swamp | `trail_clue_medium_map009` |
| `cluehelper_map_medium_8` | Ourania Cave entrance | `trail_clue_medium_map010` |
| `cluehelper_map_medium_9` | South-east of the Lighthouse | `trail_clue_medium_map011` |
| `cluehelper_map_medium_10` | Between Seers' Village and Rellekka | `trail_clue_medium_map012` |
| `cluehelper_map_medium_11` | East of the Ranging Guild | `trail_map04` |
| `cluehelper_map_hard_0` | Lumber Yard crate | `trail_map05` |
| `cluehelper_map_hard_1` | Yanille anvils | `trail_map08` |
| `cluehelper_map_hard_2` | West Ardougne | `trail_map12` |
| `cluehelper_map_hard_3` | Observatory crate | `trail_map13` |
| `cluehelper_map_hard_4` | Dark Warriors' Fortress crate | `trail_map14` |
| `cluehelper_map_hard_5` | South-east of the Wilderness Agility Course (volcanoes) | `trail_clue_hard_map006` |
| `cluehelper_map_hard_6` | South of the Legends' Guild (picnic tables) | `trail_clue_hard_map007` |
| `cluehelper_map_elite_0` | North-east of Castle Wars | `trail_map19` |
| `cluehelper_map_elite_1` | Mogre Camp mudskipper cave | `trail_map20` |
| `cluehelper_map_elite_2` | Zul-Andra | `trail_map21` |
| `cluehelper_map_elite_3` | South of the Soul Altar | `trail_map22` |
| `cluehelper_map_elite_4` | East of the Burgh de Rott furnace | `trail_map23` |
| `cluehelper_map_elite_5` | South-western Ape Atoll shack (crate) | `trail_map24` |

The named `trail_clue_medium_map008`–`012` interfaces were rendered too, not assumed from their
names. The six elite maps are the six `trail_map19`–`24` interfaces no other tier uses, each matched
to the Wiki's elite map image in a slot-14 capture.

The same captures show that the beginner runtime's `MAP_INTERFACES` gets four of its five maps
wrong:

| Beginner map | Beginner shows | Should show |
| --- | --- | --- |
| South-east Varrock mine | `trail_map06` | `trail_map02` |
| Draynor willows | `trail_map15` | `trail_map03` |
| Falador stones | `trail_map05` | `trail_map06` |
| Wizards' Tower | `trail_map03` | `trail_map11` |

That is a separate fix; this change leaves beginner untouched.

## STASH units

`Stash.TreasureTrails.js` handles the STASH units. Each emote step's `hidey_hole_loc` is a multiloc
on its own `hh_constructed_*` varbit. Easy has 31 units and medium 25; the Wiki "STASH" page has the
rules:

- **Build:** a hammer, any saw and 10 nails of one metal (not dragon), plus:
  - easy: Construction 27 (boostable) and 2 planks, for 150 Construction XP;
  - medium: Construction 42 and 2 oak planks, for 250 XP;
  - hard: Construction 55 and 2 teak planks, for 400 XP;
  - elite: Construction 77 and 2 mahogany planks, for 600 XP;
  - master: Construction 88, 2 mahogany planks and a gold leaf, for 1,500 XP.

  Building sets the unit's varbit.
- **Search a built unit:** it stores the step's complete outfit, or returns it if the inventory has
  room for all of it. Item-group slots take any item of the group; "nothing worn" slots store
  nothing.
- **Saved state:** built units and their contents are saved per player
  (`treasure-trails:stash-built`, `treasure-trails:stash-stored`), and the varbits are re-sent at
  login.

Not yet implemented:
- the "STASH units take equipped items" setting;
- cosmetic variants, such as (g) or (or) items;
- the S.T.A.S.H chart and Watson's noticeboard.

## Reward caskets

`Caskets.TreasureTrails.js` opens tier caskets with the shared `Rolls.RewardCaskets` roller over
`clue-caskets.json`.

**Before anything is consumed,** it:
- rolls the base rewards, each unique row (a tier's "clue uniques" and mega-rare rows, after
  Entrana's filter) made as likely as `drops:chance` { player, source: "treasure-trails-casket",
  rules } says (`Rolls.uniqueMultiplier`, which the Mimic's `treasure-trails:roll-casket` roll
  shares; a league's boosted drops answer it);
- rolls chance-based tertiaries using their exact `probability`;
- asks ClueCapacity for milestone rewards (`treasure-trails:milestone-rewards`);
- checks that every reward resolves to an item.

**Then it:**
- consumes the casket once;
- counts the completion;
- feeds the collection log;
- hands over overflow through `forceAdd`;
- shows the reward screen.

**Entrana** (Wiki): armour and weapon rolls are removed, and non-shared clue uniques can't be
obtained. This uses the exporter's section names: easy keeps Food, Runes and Shared treasure trail
items.

**Milestones:**
- ClueCapacity owns the scroll cases (minor at 100, major at 200), including their recovery.
- Any other milestone item, the easy Large spade at 500, comes with the casket whose completion
  reaches it.

**The Mimic** (Wiki "Mimic"): elite and master tables carry a `mimic_chance` (1/35, 1/15).
- **The roll:** opening such a casket rolls its roll count and the chance, then asks the Mimic
  plugin (`treasure-trails:mimic-casket`).
- **The answer:** the Mimic plugin owns the rest and answers with the Mimic item, keeping the
  casket's clue rolls (`Shared.initializeCasket`). It answers only for a player who opted in at the
  strange casket and holds no Mimic. It also answers for the dry protection: the first Mimic is
  guaranteed on the 25th elite or 10th master casket (`mimic:encountered`).
- **Then:** the item replaces the casket, the completion and its milestone rewards count, and the
  message is "The chest turned out to be the Mimic!". The Mimic's own chest later asks for the
  clue loot through `treasure-trails:roll-casket`, as before.

**Messages** (live captures, rsprox.net):
- Opening a casket says "Well done, you've completed the Treasure Trail!", then the count in red
  ("<col=ef1020>You have completed 3 master Treasure Trails.</col>"), the collection log, and the
  rewards' Grand Exchange worth in red ("Your treasure is worth around 424,731 coins!").
- A clue step ends with "You've found a new clue!" in a message box, where the NPC's transcript gives
  no words of its own.
- An elite kill step's drop says "<col=ff0000>You spot a new clue falling to the floor.</col>".

**The rewarded 1/50 master clue** obeys clue capacity (`treasure-trails:can-receive`). After X Marks
the Spot it becomes a scroll box (`treasure-trails:clue-item`).

**The table:** `clue-caskets.json` is imported unedited from the `osrsreboxed-db` exporter
(`scripts/drops/clue_caskets.py`, RSPSApp/osrsreboxed-db#13 at `efbf4bbe`, SHA-256
`87d26369d2408d11b19cb4bace5c741d628ac3283d29bcc2f6cc80b4df560c29`; two generations byte-identical).
- It adds the easy, medium and hard pools and structured `milestones` for every tier.
- The elite and master pools are unchanged apart from their new `milestones`.
- Without a tier's table, its casket says "You can't open this casket right now." and is kept.
- Generated JSON is never hand-edited.

## Verification

PR #890 review verification independently decoded RSProx recordings
[559](https://rsprox.net/download/559), [1063](https://rsprox.net/download/1063),
[1064](https://rsprox.net/download/1064) and [1067](https://rsprox.net/download/1067):

- 559 is **revision 227, Leagues V**. Its medium Baraek (12057/12058), Karim (2849/2850) and
  Charlie (19750/19751) windows retain the clue when adding the challenge, then remove both on a
  correct answer. Karim and Charlie receive another clue; Baraek receives a medium casket.
  All handovers use objectbox 193:1 with integer argument 400. The NPC's answer-request line
  precedes count-prompt script 108 with "Enter amount:". These are narrow inventory/UI facts;
  no trail lengths, reward rates or gameplay timing are derived from Leagues.
- 1063/1064/1067 are **revision 235, ordinary members worlds**. Each replaces the medium clue in
  the same tick as Uri's first phrase, before "What?" and the handover. The handover displays
  item 19780; Uri leaves the transmitted NPC list 3–5 ticks later.
- No ordinary-world challenge handout sample was found in the database's challenge-text search.
  The selected windows do not establish the full-inventory case; refusing the handout without
  a free slot is the tested implementation policy.
- The imported Baraek answer-request line names Dunstan because the cached Wiki source itself
  (`Transcript:Baraek`, revision 15315303) names Dunstan. This is not a parser defect. Generated
  data remains unchanged pending an upstream Wiki correction and regeneration. The dialogue
  adapter preserves player lines and rejects unrelated named NPC speakers, using the common
  question-request fallback here.
- Loaded drop tables cover Hill Giant 7261 already. NPCs 11195, 10498, 10499, 3063 and 3266 have
  no base table; their kills now reach the same contextual-drop lifecycle. All six variants are
  covered through the real NPC death callback, including no duplicate key when one is carried.

- `tests/treasure-trails-easy.test.cjs` runs on the real cache and checks:
  - the object-hook contract;
  - all 166 steps resolving to distinct items and targets;
  - trail start and lengths;
  - every NPC, search, dig, map, emote and music step solved from the right place and refused from
    the wrong one;
  - stale advances;
  - STASH build, store and withdraw;
  - the imported easy table: every reward resolves, the casket opens once, and a missing table keeps it;
  - the Entrana filter over 300 seeded caskets;
  - the master clue's capacity and box rules;
  - the Large spade on exactly the 500th casket.
- `tests/treasure-trails-medium.test.cjs` covers all 167 medium steps and every one of the 44
  challenge NPCs: hand-over, the question on Read, a wrong answer kept, and the cache's answer
  accepted. It also covers:
  - the transcript words, including Ali's differently named variant;
  - an NPC with no transcript lines;
  - all 11 keyed steps (key drop only during the trail, locked without the key, key used up);
  - crate maps, coordinate and map digs;
  - all 25 double emotes with item groups and Uri's transcript;
  - "no boots";
  - challenge coexistence, full inventories, orphan challenges and repeated answers;
  - native item dialogue packets and prompt wording;
  - Uri's immediate inventory advancement and early dialogue closure;
  - player versus NPC transcript speakers and actual death-drop dispatch without base tables;
  - the medium casket and medium STASH units.
- Original implementation baseline: clue, casket and Mimic tests passed 128/128 with the
  imported tables; beginner, beginner-casket and clue-capacity tests passed unchanged.
- Review-fix verification: server TypeScript build passed; the easy, medium, NPC drop override
  and looting-bag drop tests passed 42/42, followed by a fresh medium-file run including the
  additional final-challenge atomic-refresh/casket regression (19/19). The final full server
  suite, 366 files at concurrency 4, passed **4,938/4,938**, with no failures, cancellations or
  skips (248 seconds); its log includes that additional regression.
- **Original implementation live checks, before the review fixes:** the following natural-route
  results are historical; the review follow-up uses recordings and automated tests, without a
  fresh live-account walkthrough.
- **Natural route:** on the isolated slot-8 world (game 43708, agent MCP 49808), a headless test
  account completed three full easy trails through real packets: 7 NPC, 5 search, 2 dig and 1 emote
  steps. Each ended in a reward casket.
- Two closed chests failed only because the test teleported onto their walled side. Both open
  normally from the open side.
- A clue read before a logout resumed at the same step after logging in again.
- With the table imported, two more trails ended in real casket openings. Each showed the reward
  screen (group 73), new collection-log entries and "You have completed 2 easy Treasure Trails."
- **Medium natural route** on the isolated slot-10 world (game 43710, agent MCP 49810): a headless
  account finished nine medium trails through real packets. Along the way it:
  - answered 13 challenge scrolls through the number prompt (Teicuh, Nicholas, Zoo keeper,
    Captain Tobias, Aretha, Hickton, Cook, Dunstan, Nieve, Marisi …);
  - performed double emotes with Uri's transcript phrases;
  - solved coordinate, map and crate steps.
  - Each trail opened a real medium casket.
- Live checks found three bugs the fixture-based tests had missed, all now fixed and covered by tests:
  - an empty dialogue never ran its action;
  - the "nothing worn" `blankobject` outfits were treated as an item to wear;
  - a wandering NPC could walk out of range before the challenge hand-over.
- Elder Torgan's anagram step first looked as though Torgan wasn't spawned, but he is. He has no
  Treasure Trails transcript, and two things went wrong:
  - `npc-dialogue:start` fell back to his everyday chat for the missing variant;
  - the step then demanded he still be within 3 tiles after that long talk, though he wanders.

  The clue transcripts now ask with the new `exact: true` flag. Without that flag, a missing variant
  still plays the default transcript, so other callers are unchanged. NPC steps no longer re-check
  range after the dialogue. Both fixes are tested, and Torgan's step completes live.
- Keyed steps were left to the unit tests in the walk, because they need a kill.

- `tests/treasure-trails-hard.test.cjs` covers all 186 hard steps, with every fight, puzzle box and
  challenge. It checks:
  - the 24 cache pieces of each hard image;
  - that scrambles are real, solvable boards (even inversions) and that only adjacent slides count;
  - all 10 puzzle steps (hand-over, the board sent to the client, refusal unsolved, the next clue
    solved), with Brambickle's transcript words;
  - wizards (summon, no second while one lives, death, then the dig), a wizard summoned again after
    it vanished, and double agents before Uri (none on a first step);
  - fairy-ring digs, the hard casket and hard STASH units.
- **Joint casket outcomes:** the hard table's mega-rare Super attack, strength and defence entry is a
  joint outcome (`items`). The shared casket roller rejected it, which would have kept every hard
  casket shut; it now grants all of its items (`tests/casket-reward-rolls.test.cjs`).
- **Hard natural route** on the isolated slot-13 world (game 43713, agent MCP 49813), through real
  packets:
  - Saradomin and Zamorak wizards fought and the dig repeated, including in the Wilderness.
  - A double agent fought, the outfit worn again, and Uri's phrase.
  - Challenge scrolls answered.
  - Fairy-ring digs.
  - Puzzle boxes handed over with their image varp set, refused unsolved, and rendered in the real
    client (vision clip).
  - Hard caskets opened.
- An unarmed walker was killed by a wizard once. The clue survived, and the next dig summoned a fresh
  wizard, as the Wiki describes.

- `tests/treasure-trails-elite.test.cjs` covers all 124 elite steps. It checks:
  - the skipped rows (three kill steps, four Sherlock tasks);
  - all 12 anagram challenges on the shared scroll;
  - every supported Sherlock task (hand-over, task text, refusal before done, the wrong action not
    counting, the right one counting, then the next clue);
  - task choice by level, and a task done without the scroll not counting;
  - every rollable kill step's drop (and the casket on a last step);
  - both guards, Uri on every emote, and the King Black Dragon key;
  - the Mimic (opt-in, one at a time, the 25th casket guaranteed once);
  - the elite casket and the elite STASH units.

- **Elite natural route** on the isolated slot-14 world (game 43714, agent MCP 49814), through real
  packets with best-in-slot switches:
  - an Armadylean guard fought and the dig repeated;
  - Jardric's question answered on the shared elite challenge scroll;
  - an aviansie killed for a kill step, and its dropped clue picked up;
  - a Fountain of Heroes emote with Uri's phrase and the next clue;
  - the Mogre Camp map dug;
  - Sherlock's hand-over and his "bring it to me" line before the task, on several Sherlock steps.
- The six elite maps were matched in captures against the Wiki's images.
- `tests/treasure-trails-master.test.cjs` covers every master row. It checks:
  - the one-item meta trail (6-8 steps) and exactly the rows not rolled yet;
  - both box kinds, each master image's 24 pieces and its own box;
  - light boxes over 200 seeded boards: always solvable, presses toggling their masks, varp
    `trail_lights` sent, refused unsolved, the next clue once lit;
  - the three wizards (no dig until all are dead) and the Brassican Mage;
  - the double agent then Uri on every emote;
  - Falo (the sung song, the same song again, a wrong and the right object, outlanders);
  - every supported master Sherlock task;
  - the master casket and its 10th-casket Mimic;
  - master STASH units with the gold leaf.

- The master test also covers PR B:
  - Jorral's three cases and the device given once;
  - every feel message, the damage and both inactive messages;
  - the hot/cold dig's fight, the cooling line and the next clue;
  - three-part reading and striking;
  - each part kind's torn part and NPC words;
  - every condition passing and failing;
  - combining all, too few or without the clue;
  - a destroyed part solved again (NPC and dig), but not while carried or banked, and the clue
    still finished;
  - three distinct finishable parts per three-part step over 100 seeded rolls;
  - Watson's exchange end to end, with the capacity block.

Sources:
- [Clue scroll (easy)](https://oldschool.runescape.wiki/w/Clue_scroll_(easy))
- [STASH](https://oldschool.runescape.wiki/w/STASH)
- [Cecilia](https://oldschool.runescape.wiki/w/Cecilia) and [her transcript](https://oldschool.runescape.wiki/w/Transcript:Cecilia)
- [Easy maps](https://oldschool.runescape.wiki/w/Treasure_Trails/Guide/Maps/Easy)
- [Beginner maps](https://oldschool.runescape.wiki/w/Treasure_Trails/Guide/Maps/Beginner)
- [Clue scroll (medium)](https://oldschool.runescape.wiki/w/Clue_scroll_(medium))
- [Challenge scroll](https://oldschool.runescape.wiki/w/Challenge_scroll)
- [Coordinate clues](https://oldschool.runescape.wiki/w/Treasure_Trails/Guide/Coordinates)
- [Emote clues](https://oldschool.runescape.wiki/w/Treasure_Trails/Guide/Emote_clues)
- [Uri's transcript](https://oldschool.runescape.wiki/w/Transcript:Uri)
- [Medium maps](https://oldschool.runescape.wiki/w/Treasure_Trails/Guide/Maps/Medium)
- [Clue scroll (hard)](https://oldschool.runescape.wiki/w/Clue_scroll_(hard))
- [Puzzle box](https://oldschool.runescape.wiki/w/Puzzle_box)
- [Double agent](https://oldschool.runescape.wiki/w/Double_agent)
- [Saradomin wizard](https://oldschool.runescape.wiki/w/Saradomin_wizard)
- [Hard maps](https://oldschool.runescape.wiki/w/Treasure_Trails/Guide/Maps/Hard)
- [Clue scroll (elite)](https://oldschool.runescape.wiki/w/Clue_scroll_(elite))
- [Sherlock](https://oldschool.runescape.wiki/w/Sherlock) and [his transcript](https://oldschool.runescape.wiki/w/Transcript:Sherlock)
- [Cryptic clues](https://oldschool.runescape.wiki/w/Treasure_Trails/Guide/Cryptic_clues)
- [Armadylean guard](https://oldschool.runescape.wiki/w/Armadylean_guard) and [Bandosian guard](https://oldschool.runescape.wiki/w/Bandosian_guard)
- [Mimic](https://oldschool.runescape.wiki/w/Mimic)
- [Elite maps](https://oldschool.runescape.wiki/w/Treasure_Trails/Guide/Maps/Elite)
- [Clue scroll (master)](https://oldschool.runescape.wiki/w/Clue_scroll_(master))
- [Light box](https://oldschool.runescape.wiki/w/Light_box) and the [light box guide](https://oldschool.runescape.wiki/w/Treasure_Trails/Guide/Light_boxes)
- [Falo the Bard](https://oldschool.runescape.wiki/w/Falo_the_Bard) and [his transcript](https://oldschool.runescape.wiki/w/Transcript:Falo_the_Bard)
- [Ancient Wizard](https://oldschool.runescape.wiki/w/Ancient_Wizard) and [Brassican Mage](https://oldschool.runescape.wiki/w/Brassican_Mage)
- [Strange device](https://oldschool.runescape.wiki/w/Strange_device), [hot/cold guide](https://oldschool.runescape.wiki/w/Treasure_Trails/Guide/Hot_Cold) and [Jorral's transcript](https://oldschool.runescape.wiki/w/Transcript:Jorral)
- [Torn clue scroll](https://oldschool.runescape.wiki/w/Torn_clue_scroll) and [Watson](https://oldschool.runescape.wiki/w/Watson)
- installed cache revision 241

## Inventory and repeat-step regressions

Question challenges and puzzle boxes are linked to the original held clue by token and
revision. Both require a free inventory slot, cannot duplicate on repeated dialogue, and
are consumed in the same refresh as clue advancement. Orphan auxiliary items cannot
initialize another trail. Removal uses the container's empty Item rather than null.

Real Player/Inventory/Equipment regressions cover middle and final challenge answers,
stale callbacks, full bags, active clue capacity, two puzzles within one trail, reopening
a box, and changing from combat gear before the required repeat emote. Existing medium
Uri timing, transcript/item-box behavior, key drops and all cache-backed tier tests remain.
No new live capture is claimed by these regression tests.

Isolated own-server verification (revision241, slot2/MCP49802): a naturally rolled
hard cipher for Otto Godblessed retained clue19900 alongside challenge19901.
Answering3 and continuing the success dialogue replaced the clue with2739,
removed the challenge and displayed the NPC's next-clue item box. Adding a coin
then reused the freed slot without an inventory error. This is local runtime
validation, not a new OSRS capture or a full visual replay of every puzzle.
