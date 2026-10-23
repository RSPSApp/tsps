/**
 * Elemental Workshop II (members).
 *
 * Every word comes from the "Elemental Workshop II" transcript page; the quest has no NPC
 * index entry, so object/item interactions start the variants through startTranscript with
 * the jig cart (NpcIdentifiers.JIG_CART) as a chatheadless sentinel - none of the variants
 * speak NPC lines.
 *
 * Stages (varbit 2639 "elemental_quest_2_main" on varp 896 "elemental_quest_2_bits"):
 *   0 not started, 1 beaten book taken, 2 book read, 3 scroll read (key revealed),
 *   4 key taken, 5 hatch open, 6 schematics taken, 7 crane claw repaired, 8 junction pipes
 *   connected, 9 workshop repairs complete, 10 primed bar, 11 mind bar, 12 complete.
 * The stage values 1-4 follow OSRS; 5-12 split the reference's single "making the helm"
 * range. The cache's QUEST_STATUS_GET completes varbit 2639 at 11 (DB column 19), so the
 * durable mind-bar stage 11 is sent as 10 and the completed stage 12 as 11. Sub-state is persisted in attributes and mirrored to the real varbits on varps
 * 896/897 with the values the OSRS quest helper reads (verified against Jagex gamevals in
 * /tmp/varbits.txt): jig_state 1 placed / 2 hot / 3 flat hot / 4 cool flat / 5 dry;
 * jig_pos 0 crane / 1 press / 2 tank / 3 wind tunnel; fire_pos 0 raised / 1 lowered /
 * 2 above lava / 3 in lava; fire_state 1 repaired, 2 holding bar, 3 holding hot bar;
 * pipe states 5/6/13 = junction box solved; water_door 0-8 grabber/door combinations;
 * air_cog1 small / air_cog2 medium / air_cog3 large; mind_jig 1 placed / 2 mind bar.
 *
 * Object ids were confirmed against the cache loc dump (elem2_* gamevals) and
 * ObjectIdentifiers. The multiloc parents the cache leaves nameless (3413 hatch, 18593
 * boiler, 3414 broken piping, 3429/18721/18722 wind pins, 18725 extractor gun) are named
 * constants here, as ElementalWorkshopI does for its unnamed ids.
 *
 * Source: OSRS Wiki "Elemental Workshop II", its quick guide and transcript.
 * Rewards per the wiki: 1 Quest point, 7,500 Crafting and 7,500 Smithing XP, and the
 * ability to make elemental mind equipment.
 *
 * Gaps / approximations:
 *   - The junction box's pipe interface is client-side in OSRS; this server cannot read
 *     it, so each "Open" of the box connects the next correct pair (pipe states 5, 6, 13)
 *     and the third open plays the transcript's "I hope I got that right."
 *   - Elemental metal on the workbench is claimed first by ElementalWorkshopI's handler
 *     (registered earlier in Quests.plugin.js), which auto-crafts an elemental shield, so
 *     making the crane claw hangs off using the crane schematic on the workbench instead;
 *     the metal-on-workbench path is handled too, defensively. This stays until Elemental
 *     Workshop I defers to EW2 when the crane claw choice applies (shared change needed).
 *   - The wind tunnel pins and the old crane sit in blocking scenery, so a route assist
 *     sends the use to the player's own tile when they are already beside the footprint
 *     (the walk-to reach check rejects every adjacent tile); the workshop stairs are
 *     claimed through the ladders:climb event so the generic mapper cannot guess wrong.
 *   - The beaten book interface and the extractor cutscene/models are not shown; reading
 *     the book/scroll has no transcript of its own, so the search variant's own message
 *     lines are reused and the stage advances. The fan dries the bar instantly instead of
 *     on a timer. Random crate contents are rolled with Math.random once per player.
 *   - Post-quest mind shield smithing (slashed book) is not implemented.
 */
module.exports = function registerElementalWorkshopIIQuest(api) {
  const { ItemIdentifiers, Location, NpcIdentifiers, ObjectIdentifiers, Skill } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Elemental Workshop II";
  const START_HOOK = "quest:elemental-workshop-ii:start";
  const VARP = 896; // elemental_quest_2_bits
  const VARBIT_MAIN = 2639; // elemental_quest_2_main (5 bits)

  // Sub-state varbits (varp 896/897, element/machine states the client renders from).
  const VARBIT_HIDE_KEY = 2640;
  const VARBIT_HATCH = 2641;
  const VARBIT_JIG_POS = 2642;
  const VARBIT_JIG_STATE = 2643;
  const VARBIT_FIRE_STATE = 2644;
  const VARBIT_FIRE_POS = 2645;
  const VARBIT_PIPE_1 = 2646;
  const VARBIT_PIPE_2 = 2647;
  const VARBIT_PIPE_3 = 2648;
  const VARBIT_WATER_STATE = 2650;
  const VARBIT_VALVE_1 = 2651;
  const VARBIT_VALVE_2 = 2652;
  const VARBIT_WATER_DOOR = 2653;
  const VARBIT_WATER_LEVEL = 2654;
  const VARBIT_COG_1 = 2655;
  const VARBIT_COG_2 = 2656;
  const VARBIT_COG_3 = 2657;
  const VARBIT_AIR_STATE = 2659;
  const VARBIT_FAN_STATE = 2660;
  const VARBIT_MIND_JIG = 2662;
  const VARBIT_EARTH_FIXED = 2663;
  const VARBIT_BOX_STATE = 2664;

  const STAGE_STARTED = 1;
  const STAGE_BOOK_READ = 2;
  const STAGE_SCROLL_READ = 3;
  const STAGE_KEY_TAKEN = 4;
  const STAGE_HATCH_OPEN = 5;
  const STAGE_SCHEMATICS = 6;
  const STAGE_CRANE = 7;
  const STAGE_JUNCTION = 8;
  const STAGE_REPAIRS = 9;
  const STAGE_PRIMED_BAR = 10;
  const STAGE_MIND_BAR = 11;
  const STAGE_COMPLETE = 12;
  const WIRE_COMPLETE = 11; // the cache's completion threshold for varbit 2639

  /** Durable stages 11/12 are the post-bar split; the wire completes at 11. */
  function wireStage(value) {
    if (value >= STAGE_COMPLETE) return WIRE_COMPLETE;
    if (value >= STAGE_MIND_BAR) return STAGE_MIND_BAR - 1;
    return value;
  }

  const BEATEN_BOOK = ItemIdentifiers.BEATEN_BOOK; // 9717
  const SCROLL = ItemIdentifiers.SCROLL_3; // 9721
  const KEY = ItemIdentifiers.KEY_11; // 9722
  const CRANE_SCHEMATIC = ItemIdentifiers.CRANE_SCHEMATIC; // 9718
  const LEVER_SCHEMATIC = ItemIdentifiers.LEVER_SCHEMATIC; // 9719
  const CRANE_CLAW = ItemIdentifiers.CRANE_CLAW; // 9720
  const PIPE = ItemIdentifiers.PIPE; // 9723
  const LARGE_COG = ItemIdentifiers.LARGE_COG; // 9724
  const MEDIUM_COG = ItemIdentifiers.MEDIUM_COG; // 9725
  const SMALL_COG = ItemIdentifiers.SMALL_COG; // 9726
  const PRIMED_BAR = ItemIdentifiers.PRIMED_BAR; // 9727
  const PRIMED_MIND_BAR = ItemIdentifiers.PRIMED_MIND_BAR; // 9728
  const MIND_HELMET = ItemIdentifiers.MIND_HELMET; // 9733
  const ELEMENTAL_METAL = ItemIdentifiers.ELEMENTAL_METAL; // 2893
  const HAMMER = ItemIdentifiers.HAMMER; // 2347

  const TRANSCRIPT_NPC_ID = NpcIdentifiers.JIG_CART; // 5221, chathead sentinel

  const CART_NPC_IDS = new Set([
    NpcIdentifiers.JIG_CART, // 5221 empty
    NpcIdentifiers.JIG_CART_2, // 5222 bar
    NpcIdentifiers.JIG_CART_3, // 5223 hot bar
    NpcIdentifiers.JIG_CART_4, // 5224 flat hot bar
    NpcIdentifiers.JIG_CART_5, // 5225 flat bar
    NpcIdentifiers.JIG_CART_6, // 5226 flat dry bar
  ]);

  const BOOKCASE = ObjectIdentifiers.BOOKCASE_66; // 17382, Exam Centre
  const WORKBENCH = ObjectIdentifiers.WORKBENCH_5; // 3402
  const CRATE_IDS = [
    ObjectIdentifiers.CRATE_162, // 18612
    ObjectIdentifiers.CRATE_163, // 18613
    ObjectIdentifiers.CRATES_39, // 18614
    ObjectIdentifiers.CRATES_40, // 18615
    ObjectIdentifiers.CRATE_164, // 18616
    ObjectIdentifiers.CRATES_41, // 18617 (catwalk)
    ObjectIdentifiers.CRATE_165, // 18618 (catwalk)
    ObjectIdentifiers.CRATE_166, // 18619
  ];
  const CRATE_INDEX = new Map(CRATE_IDS.map((id, index) => [id, index]));
  const SCHEMATIC_CRATE = ObjectIdentifiers.SCHEMATIC_CRATE; // 18711
  const BOILER = 18593; // elemental_workshop_2_boiler_multi (nameless parent)
  const BOILER_FOR_KEY = ObjectIdentifiers.MACHINERY_4; // 18594, the Search version
  const BOILER_IDS = new Set([BOILER, BOILER_FOR_KEY]);
  const HATCH = 3413; // elem2_stairs_door (nameless parent -> 18595/18596/18597)
  const HATCH_IDS = new Set([HATCH, ObjectIdentifiers.HATCH, ObjectIdentifiers.HATCH_2]);
  const PIPE_REPAIR = 3414; // elemental_piping_blue_broken_multi (nameless parent)
  const PIPE_REPAIR_IDS = new Set([PIPE_REPAIR, ObjectIdentifiers.PIPING]);
  const OLD_CRANE = ObjectIdentifiers.OLD_CRANE_16; // 18638, the placed crane base
  const FIRE_LEVER_ROTATE = ObjectIdentifiers.AN_OLD_LEVER; // 18621, south-east
  const FIRE_LEVER_RAISE = ObjectIdentifiers.AN_OLD_LEVER_2; // 18622, south-west
  const CART_LEVER = ObjectIdentifiers.LEVER_47; // 18620, by the yellow sign
  const PRESS_LEVER = ObjectIdentifiers.AN_OLD_LEVER_3; // 18640
  const JUNCTION_BOX = ObjectIdentifiers.JUNCTION_BOX; // 18641
  const VALVE_WEST = ObjectIdentifiers.WATER_VALVE_2; // 18646
  const VALVE_EAST = ObjectIdentifiers.WATER_VALVE_3; // 18647
  const TANK_DOOR_LEVER = ObjectIdentifiers.AN_OLD_LEVER_4; // 18648
  const CORKSCREW = ObjectIdentifiers.CORKSCREW_LEVER; // 18649
  const FAN_LEVER = ObjectIdentifiers.AN_OLD_LEVER_5; // 18663
  const PIN_HIGH = 18722; // elem2_wind_pin_high_multi, small cog (nameless parent)
  const PIN_LOW = 3429; // elem2_wind_pin_low_multi, medium cog (nameless parent)
  const PIN_LEFT = 18721; // elem2_wind_pin_left_multi, large cog (nameless parent)
  const PIN_IDS = new Set([
    PIN_HIGH, PIN_LOW, PIN_LEFT,
    ObjectIdentifiers.PIN, ObjectIdentifiers.PIN_2, ObjectIdentifiers.PIN_3, // 18664-18666
  ]);
  // The wind tunnel pins and the crane's 5x5 base have no walkable tile of their own, and
  // every adjacent tile fails the walk-to reach check for item use ("You can't reach that!").
  const ROUTE_ASSIST_IDS = new Set([...PIN_IDS, OLD_CRANE, PIPE_REPAIR]);
  const EXTRACTOR_HAT = ObjectIdentifiers.EXTRACTOR_HAT; // 18690
  const EXTRACTOR_HAT_IDS = new Set([EXTRACTOR_HAT, ObjectIdentifiers.EXTRACTOR_HAT_2]);
  const EXTRACTOR_GUN_IDS = new Set([
    18725, // elem_extractor_gun, the placed nameless parent
    ObjectIdentifiers.EXTRACTOR_GUN, ObjectIdentifiers.EXTRACTOR_GUN_2, ObjectIdentifiers.EXTRACTOR_GUN_3,
  ]);
  const STAIRS_UP_MACHINE = ObjectIdentifiers.STAIRS_68; // 18598
  const STAIRWELL_DOWN = ObjectIdentifiers.STAIRWELL; // 18597
  const STAIRS_UP_BASEMENT = ObjectIdentifiers.STAIRS_69; // 18599
  const GANTRY_STAIRS = ObjectIdentifiers.STAIRS_70; // 18610
  const GANTRY_STAIRS_TOP = ObjectIdentifiers.STAIRS_71; // 18611

  // Cache tile facts from the loc dump: the hatch sits at 2719,9890 (2x2); the stairs
  // back up from the machine floor at 1953,5154 (2x2); the stairwell down at 1948,5158.
  const HATCH_ARRIVAL = new Location(2719, 9892, 0);
  const MACHINE_ARRIVAL = new Location(1954, 5156, 2);
  const BASEMENT_ARRIVAL = new Location(1948, 5161, 0);
  const CART_TILE = { x: 1954, y: 5147, z: 2 };

  const FLAGS_ATTRIBUTE = "quest.elemental_workshop_ii.flags";
  const JIG_ATTRIBUTE = "quest.elemental_workshop_ii.jig";
  const WATER_ATTRIBUTE = "quest.elemental_workshop_ii.water";
  const AIR_ATTRIBUTE = "quest.elemental_workshop_ii.air";
  const PIPES_ATTRIBUTE = "quest.elemental_workshop_ii.pipes";
  const MIND_ATTRIBUTE = "quest.elemental_workshop_ii.mind";
  const CRATES_ATTRIBUTE = "quest.elemental_workshop_ii.crates";

  const FLAG_KEY_REVEALED = 1 << 0;
  const FLAG_HATCH_OPEN = 1 << 1;
  const FLAG_PIPE_REPAIRED = 1 << 2;
  const FLAG_MACHINE_FIXED = 1 << 3;
  const FLAG_BOOK_TAKEN = 1 << 4;
  const FLAG_CRANE_SCHEMATIC_TAKEN = 1 << 5;
  const FLAG_LEVER_SCHEMATIC_TAKEN = 1 << 6;
  const FLAG_CRANE_SCHEMATIC_READ = 1 << 7;
  const FLAG_LEVER_SCHEMATIC_READ = 1 << 8;

  const PIPE_SOLVED = [5, 6, 13];
  const CRATE_KINDS = ["small", "medium", "large", "pipe"];
  const CRATE_ITEM_BY_KIND = new Map([
    ["small", SMALL_COG],
    ["medium", MEDIUM_COG],
    ["large", LARGE_COG],
    ["pipe", PIPE],
  ]);
  const CRATE_VARIANT = "into-the-workshop-searching-crates";
  const CRATE_CONDITION_KIND = new Map([
    ["e_gMjZ", "empty"],
    ["HYdl-l", "small"],
    ["ZfYdtR", "medium"],
    ["joNrup", "large"],
    ["nKU0jz", "pipe"],
  ]);
  const FULL_CONDITION_IDS = new Set(["dYjmbW", "jD15zv", "RmGHpD"]);
  const SPACE_CONDITION_IDS = new Set(["aUvF_N", "Dm7-Ht", "aGHkSR"]);

  const PIN_LAYOUT = new Map([
    [PIN_HIGH, { field: "cog1", value: 1, itemId: SMALL_COG, variant: "into-the-workshop-placing-cogs-on-the-shafts-small" }],
    [ObjectIdentifiers.PIN_2, { field: "cog1", value: 1, itemId: SMALL_COG, variant: "into-the-workshop-placing-cogs-on-the-shafts-small" }],
    [PIN_LOW, { field: "cog2", value: 2, itemId: MEDIUM_COG, variant: "into-the-workshop-placing-cogs-on-the-shafts-medium" }],
    [ObjectIdentifiers.PIN, { field: "cog2", value: 2, itemId: MEDIUM_COG, variant: "into-the-workshop-placing-cogs-on-the-shafts-medium" }],
    [PIN_LEFT, { field: "cog3", value: 3, itemId: LARGE_COG, variant: "into-the-workshop-placing-cogs-on-the-shafts-large" }],
    [ObjectIdentifiers.PIN_3, { field: "cog3", value: 3, itemId: LARGE_COG, variant: "into-the-workshop-placing-cogs-on-the-shafts-large" }],
  ]);

  let quest;
  /** Search-in-progress branch for the crate conditions (never persisted). */
  const crateSearch = new WeakMap();

  const has = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  const flags = (player) => Number(player.getAttribute(FLAGS_ATTRIBUTE)) || 0;
  const hasFlag = (player, bit) => (flags(player) & bit) !== 0;
  const stage = (player) => quest.getStage(player);

  function setFlag(player, bit) {
    player.setAttribute(FLAGS_ATTRIBUTE, flags(player) | bit);
  }

  function setStageAtLeast(player, value) {
    if (stage(player) < value) quest.setStage(player, value);
  }

  function jigState(player) {
    const value = Number(player.getAttribute(JIG_ATTRIBUTE)) || 0;
    return {
      position: value & 3,
      state: (value >> 2) & 7,
      firePos: (value >> 5) & 3,
      fireState: (value >> 7) & 3,
    };
  }

  function setJigState(player, next) {
    player.setAttribute(
      JIG_ATTRIBUTE,
      (next.position & 3) | ((next.state & 7) << 2) | ((next.firePos & 3) << 5) | ((next.fireState & 3) << 7)
    );
    syncVarbits(player);
  }

  function waterState(player) {
    const value = Number(player.getAttribute(WATER_ATTRIBUTE)) || 0;
    return {
      door: value & 15,
      level: (value >> 4) & 1,
      valveWest: (value >> 5) & 1,
      valveEast: (value >> 6) & 1,
    };
  }

  function setWaterState(player, next) {
    player.setAttribute(
      WATER_ATTRIBUTE,
      (next.door & 15) | ((next.level & 1) << 4) | ((next.valveWest & 1) << 5) | ((next.valveEast & 1) << 6)
    );
    syncVarbits(player);
  }

  function airState(player) {
    const value = Number(player.getAttribute(AIR_ATTRIBUTE)) || 0;
    return {
      cog1: value & 3,
      cog2: (value >> 2) & 3,
      cog3: (value >> 4) & 3,
      machine: (value >> 6) & 1,
      fan: (value >> 7) & 3,
    };
  }

  function setAirState(player, next) {
    player.setAttribute(
      AIR_ATTRIBUTE,
      (next.cog1 & 3) | ((next.cog2 & 3) << 2) | ((next.cog3 & 3) << 4) | ((next.machine & 1) << 6) |
        ((next.fan & 3) << 7)
    );
    syncVarbits(player);
  }

  function pipeState(player) {
    const value = Number(player.getAttribute(PIPES_ATTRIBUTE)) || 0;
    return { p1: value & 15, p2: (value >> 4) & 15, p3: (value >> 8) & 15 };
  }

  function setPipeState(player, next) {
    player.setAttribute(PIPES_ATTRIBUTE, (next.p1 & 15) | ((next.p2 & 15) << 4) | ((next.p3 & 15) << 8));
    syncVarbits(player);
  }

  const mindState = (player) => Number(player.getAttribute(MIND_ATTRIBUTE)) || 0;

  function setMindState(player, value) {
    player.setAttribute(MIND_ATTRIBUTE, value & 3);
    syncVarbits(player);
  }

  function cogsCorrect(air) {
    return air.cog1 === 1 && air.cog2 === 2 && air.cog3 === 3;
  }

  function pipesSorted(player) {
    const pipes = pipeState(player);
    return pipes.p1 === PIPE_SOLVED[0] && pipes.p2 === PIPE_SOLVED[1] && pipes.p3 === PIPE_SOLVED[2];
  }

  function repairsComplete(player) {
    const jig = jigState(player);
    return jig.fireState >= 1 && pipesSorted(player) && hasFlag(player, FLAG_PIPE_REPAIRED) &&
      cogsCorrect(airState(player));
  }

  function sendVarbit(player, id, value) {
    player.getPacketSender().sendVarbit(id, value | 0);
  }

  /** Mirrors every persisted sub-state to its cache varbit (also used on login). */
  function syncVarbits(player) {
    const f = flags(player);
    const jig = jigState(player);
    const water = waterState(player);
    const air = airState(player);
    const pipes = pipeState(player);
    sendVarbit(player, VARBIT_MAIN, wireStage(stage(player)));
    sendVarbit(player, VARBIT_HIDE_KEY, hasFlag(player, FLAG_KEY_REVEALED) ? 1 : 0);
    sendVarbit(player, VARBIT_HATCH, hasFlag(player, FLAG_HATCH_OPEN) ? 1 : 0);
    sendVarbit(player, VARBIT_WATER_STATE, hasFlag(player, FLAG_PIPE_REPAIRED) ? 1 : 0);
    sendVarbit(player, VARBIT_EARTH_FIXED, hasFlag(player, FLAG_MACHINE_FIXED) ? 1 : 0);
    sendVarbit(player, VARBIT_BOX_STATE, (f & FLAG_BOOK_TAKEN) ? 2 : 0);
    sendVarbit(player, VARBIT_JIG_POS, jig.position);
    sendVarbit(player, VARBIT_JIG_STATE, jig.state);
    sendVarbit(player, VARBIT_FIRE_STATE, jig.fireState);
    sendVarbit(player, VARBIT_FIRE_POS, jig.firePos);
    sendVarbit(player, VARBIT_WATER_DOOR, water.door);
    sendVarbit(player, VARBIT_WATER_LEVEL, water.level);
    sendVarbit(player, VARBIT_VALVE_1, water.valveWest);
    sendVarbit(player, VARBIT_VALVE_2, water.valveEast);
    sendVarbit(player, VARBIT_COG_1, air.cog1);
    sendVarbit(player, VARBIT_COG_2, air.cog2);
    sendVarbit(player, VARBIT_COG_3, air.cog3);
    sendVarbit(player, VARBIT_AIR_STATE, air.machine);
    sendVarbit(player, VARBIT_FAN_STATE, air.fan);
    sendVarbit(player, VARBIT_PIPE_1, pipes.p1);
    sendVarbit(player, VARBIT_PIPE_2, pipes.p2);
    sendVarbit(player, VARBIT_PIPE_3, pipes.p3);
    sendVarbit(player, VARBIT_MIND_JIG, mindState(player));
  }

  /** Plays a wiki variant of this quest's page; the cart is only a chathead placeholder. */
  function play(player, variant) {
    return startTranscript(api, player, TRANSCRIPT_NPC_ID, PAGE, variant);
  }

  function requireSpace(player, slots) {
    if ((player.getInventory().getFreeSlots?.() ?? 0) >= slots) return true;
    player.sendMessage("You don't have enough space in your inventory.");
    return false;
  }

  function elementalWorkshopOneComplete(player) {
    const request = { player, key: "elemental_workshop_i", complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  // ==========================================================================
  // Starting off
  // ==========================================================================

  function searchBookcase(player) {
    if (stage(player) >= STAGE_STARTED) {
      if (!has(player, BEATEN_BOOK)) {
        if (!requireSpace(player, 1)) return;
        player.getInventory().adds(BEATEN_BOOK, 1);
        player.sendMessage("You find an old-looking book."); // transcript step 0RUHhz
        return;
      }
      player.sendMessage("You search the bookcase but find nothing of interest.");
      return;
    }
    if (!elementalWorkshopOneComplete(player)) {
      player.sendMessage("You must have completed Elemental Workshop I before you can start this quest.");
      return;
    }
    if (!requireSpace(player, 2)) return;
    play(player, "starting-out-searching-the-bookcase");
  }

  function handleStartHook(event) {
    const { player, hook, npcId } = event;
    if (npcId !== TRANSCRIPT_NPC_ID || hook !== START_HOOK) return;
    if (stage(player) !== 0) return;
    player.getInventory().adds(BEATEN_BOOK, 1);
    player.getInventory().adds(SCROLL, 1);
    setFlag(player, FLAG_BOOK_TAKEN);
    setStageAtLeast(player, STAGE_STARTED);
    syncVarbits(player);
  }

  function readBeatenBook(player) {
    if (stage(player) === 0) return;
    if (stage(player) === STAGE_STARTED) {
      player.sendMessage("The book has two parts: an introduction and an instruction section."); // 7UpB8g
      player.sendMessage("You flip the book open to the introduction and start reading."); // zmWbaO
      setStageAtLeast(player, STAGE_BOOK_READ);
    }
    if (stage(player) <= STAGE_BOOK_READ && !has(player, SCROLL) && requireSpace(player, 1)) {
      player.getInventory().adds(SCROLL, 1);
      player.sendMessage(
        "You find a slip of paper that has been used for a bookmark. You put it in your pack to study later."
      ); // AKqEG4
    }
  }

  function readScroll(player) {
    if (stage(player) !== STAGE_BOOK_READ) return;
    setFlag(player, FLAG_KEY_REVEALED);
    setStageAtLeast(player, STAGE_SCROLL_READ);
    syncVarbits(player);
  }

  function readCraneSchematic(player) {
    if (!has(player, CRANE_SCHEMATIC) && !hasFlag(player, FLAG_CRANE_SCHEMATIC_TAKEN)) return;
    setFlag(player, FLAG_CRANE_SCHEMATIC_READ);
    play(player, "into-the-workshop-reading-the-crane-schematic");
  }

  function readLeverSchematic(player) {
    if (!has(player, LEVER_SCHEMATIC) && !hasFlag(player, FLAG_LEVER_SCHEMATIC_TAKEN)) return;
    setFlag(player, FLAG_LEVER_SCHEMATIC_READ);
  }

  // ==========================================================================
  // The second key and the hatch (EW1 first sublevel)
  // ==========================================================================

  function searchMachinery(player) {
    if (stage(player) < STAGE_SCROLL_READ) return;
    if (has(player, KEY) || hasFlag(player, FLAG_HATCH_OPEN)) return;
    if (!requireSpace(player, 1)) return;
    player.getInventory().adds(KEY, 1);
    setStageAtLeast(player, STAGE_KEY_TAKEN);
    play(player, "into-the-workshop-searching-machinery-for-the-key");
  }

  function unlockHatch(player) {
    if (hasFlag(player, FLAG_HATCH_OPEN)) return false;
    if (!has(player, KEY)) return false;
    setFlag(player, FLAG_HATCH_OPEN);
    setStageAtLeast(player, STAGE_HATCH_OPEN);
    syncVarbits(player);
    play(player, "into-the-workshop-unlocking-the-hatch");
    return true;
  }

  function descendHatch(player) {
    player.moveTo(MACHINE_ARRIVAL);
  }

  function climbStairs(player, destination, message) {
    player.sendMessage(message);
    player.moveTo(destination);
  }

  /**
   * The workshop's stairs are all two-way dungeon connections, so the generic
   * Ladders mapper guesses wrong. Claim the click and hand it the explicit
   * destination instead. The gantry stairs are placed twice (1949,5149 and
   * 1958,5159), so theirs is the clicked tile one plane up/down.
   */
  function climbTile(object, fallbackX, fallbackY, z) {
    const location = object?.getLocation?.();
    return location ? new Location(location.getX(), location.getY(), z) : new Location(fallbackX, fallbackY, z);
  }

  function claimClimb(request) {
    const { player, objectId } = request;
    const destinations = new Map([
      [STAIRS_UP_MACHINE, ["ladders:climbUp", HATCH_ARRIVAL]],
      [STAIRWELL_DOWN, ["ladders:climbDown", BASEMENT_ARRIVAL]],
      [STAIRS_UP_BASEMENT, ["ladders:climbUp", new Location(1948, 5157, 2)]],
      [GANTRY_STAIRS, ["ladders:climbUp", climbTile(request.object, 1949, 5149, 3)]],
      [GANTRY_STAIRS_TOP, ["ladders:climbDown", climbTile(request.object, 1949, 5149, 2)]],
    ]);
    const entry = destinations.get(objectId);
    if (!entry) return;
    request.handled = true;
    api.emitCustomEvent(entry[0], { player, object: request.object, destination: entry[1] });
  }

  // ==========================================================================
  // Schematics, the crane and the claw
  // ==========================================================================

  function takeSchematicChoice(player) {
    if (!requireSpace(player, 1)) return;
    play(player, "into-the-workshop-schematic-crate");
  }

  function grantSchematic(player, itemId, takenFlag) {
    if (!has(player, itemId) && requireSpace(player, 1)) player.getInventory().adds(itemId, 1);
    if (has(player, itemId)) setFlag(player, takenFlag);
    if (hasFlag(player, FLAG_CRANE_SCHEMATIC_TAKEN) && hasFlag(player, FLAG_LEVER_SCHEMATIC_TAKEN)) {
      setStageAtLeast(player, STAGE_SCHEMATICS);
    }
  }

  function startClawChoice(player) {
    if (has(player, CRANE_CLAW) || jigState(player).fireState >= 1) return;
    if (!has(player, ELEMENTAL_METAL)) {
      player.sendMessage("You need an elemental metal bar to make a crane claw.");
      return;
    }
    if (!has(player, HAMMER)) {
      player.sendMessage("You need a hammer to work the metal.");
      return;
    }
    play(player, "into-the-workshop-making-an-elemental-claw");
  }

  function craftCraneClaw(player) {
    if (!has(player, ELEMENTAL_METAL)) return;
    player.getInventory().deleteNumber(ELEMENTAL_METAL, 1);
    player.getInventory().adds(CRANE_CLAW, 1);
  }

  function repairCrane(player) {
    const jig = jigState(player);
    if (jig.fireState >= 1 || !has(player, CRANE_CLAW)) return;
    if (jig.firePos !== 1) return; // the wiki says lower the crane before replacing the claw
    player.getInventory().deleteNumber(CRANE_CLAW, 1);
    jig.fireState = 1;
    setJigState(player, jig);
    setStageAtLeast(player, STAGE_CRANE);
    play(player, "into-the-workshop-repairing-the-claw");
  }

  function moveCrane(player) {
    const jig = jigState(player);
    if (jig.firePos === 0) {
      jig.firePos = 1;
    } else if (jig.firePos === 1) {
      jig.firePos = 0;
      if (jig.fireState === 1 && jig.state === 1) {
        jig.fireState = 2; // picked the cold bar off the jig
        jig.state = 0;
      } else if (jig.fireState === 3) {
        jig.fireState = 1; // deposited the hot bar back on the jig
        jig.state = 2;
      }
    } else if (jig.firePos === 2) {
      jig.firePos = 3;
    } else if (jig.firePos === 3) {
      jig.firePos = 2;
      if (jig.fireState === 2) jig.fireState = 3; // heated in the lava
    }
    setJigState(player, jig);
  }

  function rotateCrane(player) {
    const jig = jigState(player);
    if (jig.firePos === 1 || jig.firePos === 3) {
      play(player, "into-the-workshop-rotating-the-claw-while-the-arm-is-down");
      return;
    }
    jig.firePos = jig.firePos === 0 ? 2 : 0;
    setJigState(player, jig);
  }

  // ==========================================================================
  // Junction box, piping and cogs
  // ==========================================================================

  function openJunctionBox(player) {
    if (pipesSorted(player)) return;
    const pipes = pipeState(player);
    if (pipes.p1 !== PIPE_SOLVED[0]) pipes.p1 = PIPE_SOLVED[0];
    else if (pipes.p2 !== PIPE_SOLVED[1]) pipes.p2 = PIPE_SOLVED[1];
    else pipes.p3 = PIPE_SOLVED[2];
    setPipeState(player, pipes);
    if (pipesSorted(player)) {
      setStageAtLeast(player, STAGE_JUNCTION);
      play(player, "into-the-workshop-connecting-the-junction-box-pipes");
    }
  }

  function searchCrate(player, objectId) {
    const index = CRATE_INDEX.get(objectId);
    if (index === undefined) return;
    const schematicsTaken = (hasFlag(player, FLAG_CRANE_SCHEMATIC_TAKEN) || has(player, CRANE_SCHEMATIC)) &&
      (hasFlag(player, FLAG_LEVER_SCHEMATIC_TAKEN) || has(player, LEVER_SCHEMATIC));
    const map = crateMap(player);
    let kind = "empty";
    if (schematicsTaken) {
      for (let slot = 0; slot < CRATE_KINDS.length; slot++) {
        if (map[slot] !== index) continue;
        const candidate = CRATE_KINDS[slot];
        if (canGiveCrateItem(player, candidate)) kind = candidate;
        break;
      }
    }
    if (kind !== "empty") {
      if (!requireSpace(player, 1)) return;
      player.getInventory().adds(CRATE_ITEM_BY_KIND.get(kind), 1);
    }
    crateSearch.set(player, kind);
    play(player, CRATE_VARIANT);
  }

  function canGiveCrateItem(player, kind) {
    const air = airState(player);
    if (kind === "small") return !has(player, SMALL_COG) && air.cog1 !== 1;
    if (kind === "medium") return !has(player, MEDIUM_COG) && air.cog2 !== 2;
    if (kind === "large") return !has(player, LARGE_COG) && air.cog3 !== 3;
    return !has(player, PIPE) && !hasFlag(player, FLAG_PIPE_REPAIRED);
  }

  function crateMap(player) {
    let packed = Number(player.getAttribute(CRATES_ATTRIBUTE)) || 0;
    if (packed === 0) {
      const order = CRATE_IDS.map((_, index) => index);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      packed = order[0] | (order[1] << 3) | (order[2] << 6) | (order[3] << 9);
      player.setAttribute(CRATES_ATTRIBUTE, packed);
    }
    return [packed & 7, (packed >> 3) & 7, (packed >> 6) & 7, (packed >> 9) & 7];
  }

  function repairPiping(player) {
    if (hasFlag(player, FLAG_PIPE_REPAIRED) || !has(player, PIPE)) return;
    player.getInventory().deleteNumber(PIPE, 1);
    setFlag(player, FLAG_PIPE_REPAIRED);
    syncVarbits(player);
    play(player, "into-the-workshop-repairing-piping");
    if (repairsComplete(player)) {
      setFlag(player, FLAG_MACHINE_FIXED);
      setStageAtLeast(player, STAGE_REPAIRS);
      syncVarbits(player);
    }
  }

  function placeCog(player, objectId, itemId) {
    const layout = PIN_LAYOUT.get(objectId);
    if (!layout) return;
    const air = airState(player);
    if (air.machine !== 0) {
      play(player, "into-the-workshop-trying-to-remove-a-cog-while-the-fan-is-on");
      return;
    }
    if (itemId !== layout.itemId) {
      player.sendMessage("The cog doesn't seem to fit.");
      return;
    }
    if (air[layout.field] === layout.value) {
      player.sendMessage("You have already placed a cog here.");
      return;
    }
    player.getInventory().deleteNumber(itemId, 1);
    air[layout.field] = layout.value;
    setAirState(player, air);
    play(player, layout.variant);
    if (repairsComplete(player)) {
      setFlag(player, FLAG_MACHINE_FIXED);
      setStageAtLeast(player, STAGE_REPAIRS);
      syncVarbits(player);
    }
  }

  // ==========================================================================
  // Priming a bar (jig cart, press, water tank, fan)
  // ==========================================================================

  function placeBarOnCart(player) {
    const jig = jigState(player);
    if (jig.position !== 0 || jig.state !== 0) return;
    player.getInventory().deleteNumber(ELEMENTAL_METAL, 1);
    jig.state = 1;
    setJigState(player, jig);
  }

  function advanceJig(player) {
    const jig = jigState(player);
    const water = waterState(player);
    const air = airState(player);
    if (jig.position === 2 && water.door !== 0) return; // rack extended into the tank
    if (jig.position === 3 && air.machine !== 0) return; // fan still running
    jig.position = (jig.position + 1) % 4;
    setJigState(player, jig);
  }

  function pullPress(player) {
    const jig = jigState(player);
    if (jig.fireState < 1) {
      play(player, "into-the-workshop-puling-the-press-lever-while-it-is-broken");
      return;
    }
    if (!pipesSorted(player)) {
      play(player, "into-the-workshop-pulling-the-press-lever-with-the-junction-pipes-not-correctly-connected");
      return;
    }
    if (jig.position !== 1) {
      play(player, "into-the-workshop-pulling-the-press-lever-at-the-wrong-time");
      return;
    }
    if (jig.state === 0) {
      play(player, "into-the-workshop-pulling-the-press-lever-without-a-bar-in-position");
      return;
    }
    if (jig.state === 2) {
      jig.state = 3;
      setJigState(player, jig);
      play(player, "into-the-workshop-flattening-an-elemental-bar-after-heating-it");
    }
  }

  function pullTankDoor(player) {
    const water = waterState(player);
    if (water.level === 1) {
      play(player, "into-the-workshop-pulling-the-lever-while-the-tank-is-full");
      return;
    }
    const transitions = new Map([[0, 1], [1, 0], [2, 0], [3, 4], [4, 3], [5, 3], [6, 7], [7, 6], [8, 6]]);
    water.door = transitions.get(water.door) ?? water.door;
    setWaterState(player, water);
  }

  function turnCorkscrew(player) {
    const water = waterState(player);
    if (water.door === 0 || water.door === 3 || water.door === 6) {
      play(player, "into-the-workshop-turning-the-corkscrew-while-the-door-is-closer");
      return;
    }
    const jig = jigState(player);
    if (water.door === 1) water.door = 2;
    else if (water.door === 2) water.door = jig.state >= 4 ? 7 : 4;
    else if (water.door === 7) water.door = 8;
    else if (water.door === 8) water.door = 2;
    setWaterState(player, water);
  }

  function turnValve(player, west) {
    const water = waterState(player);
    const open = west ? water.valveWest === 0 : water.valveEast === 0;
    if (open && !hasFlag(player, FLAG_PIPE_REPAIRED)) {
      play(player, "into-the-workshop-turning-the-water-valve-before-repairing-the-pipe");
      return;
    }
    if (west) {
      water.valveWest = water.valveWest ? 0 : 1;
      if (water.valveWest === 1) {
        water.level = 1;
        if (water.door >= 3 && water.door <= 5) {
          water.door += 3; // the hot bar cools: 3->6, 4->7, 5->8
          const jig = jigState(player);
          if (jig.state === 3) {
            jig.state = 4;
            setJigState(player, jig);
          }
        }
      }
    } else {
      water.valveEast = water.valveEast ? 0 : 1;
      if (water.valveEast === 1) water.level = 0;
    }
    setWaterState(player, water);
    play(player, open ? "into-the-workshop-opening-the-water-valve" : "into-the-workshop-closing-the-water-valve");
  }

  function pullFanLever(player) {
    const air = airState(player);
    if (air.machine !== 0) {
      air.machine = 0;
      air.fan = 0;
      setAirState(player, air);
      play(player, "into-the-workshop-turning-off-the-fan");
      return;
    }
    air.machine = 1;
    air.fan = cogsCorrect(air) ? 1 : 2;
    setAirState(player, air);
    if (!cogsCorrect(air)) {
      play(player, "into-the-workshop-trying-to-turn-on-the-fan-with-the-cogs-placed-incorrectly");
      return;
    }
    play(player, "into-the-workshop-turning-on-the-fan");
    const jig = jigState(player);
    if (jig.position === 3 && jig.state === 4) {
      jig.state = 5; // dried by the fan
      setJigState(player, jig);
    }
    if (repairsComplete(player)) {
      setFlag(player, FLAG_MACHINE_FIXED);
      setStageAtLeast(player, STAGE_REPAIRS);
      syncVarbits(player);
    }
  }

  function takePrimedBar(player) {
    const jig = jigState(player);
    if (jig.state !== 5 || jig.position !== 0) return;
    if (!requireSpace(player, 1)) return;
    player.getInventory().adds(PRIMED_BAR, 1);
    jig.state = 0;
    setJigState(player, jig);
    setStageAtLeast(player, STAGE_PRIMED_BAR);
    play(player, "into-the-workshop-taking-the-primed-bar");
  }

  // ==========================================================================
  // The extractor and the mind helm
  // ==========================================================================

  function placePrimedBar(player) {
    if (mindState(player) !== 0 || !has(player, PRIMED_BAR)) return;
    player.getInventory().deleteNumber(PRIMED_BAR, 1);
    setMindState(player, 1);
    play(player, "into-the-workshop-placing-the-primed-bar");
  }

  function operateExtractor(player) {
    if (mindState(player) !== 1) return;
    if (player.getSkillManager().getCurrentLevel(Skill.MAGIC) < 20) {
      player.sendMessage("You need level 20 Magic to use the extractor.");
      return;
    }
    const magic = player.getSkillManager().getCurrentLevel(Skill.MAGIC);
    player.getSkillManager().setCurrentLevel(Skill.MAGIC, Math.max(0, magic - 20), true);
    setMindState(player, 2);
    play(player, "into-the-workshop-making-the-mind-bar");
  }

  function takeMindBar(player) {
    if (mindState(player) !== 2) return;
    if (!requireSpace(player, 1)) return;
    player.getInventory().adds(PRIMED_MIND_BAR, 1);
    setMindState(player, 0);
    setStageAtLeast(player, STAGE_MIND_BAR);
    play(player, "into-the-workshop-taking-the-mind-bar");
  }

  function makeMindHelm(player) {
    if (player.getSkillManager().getCurrentLevel(Skill.SMITHING) < 30) {
      player.sendMessage("You need level 30 Smithing to work this metal.");
      return;
    }
    if (!has(player, HAMMER)) {
      play(player, "into-the-workshop-crafting-the-mind-helm-using-the-workbench-without-a-hammer");
      return;
    }
    if (!has(player, BEATEN_BOOK)) {
      play(player, "into-the-workshop-crafting-the-mind-helm-using-the-workbench-without-the-beaten-book");
      return;
    }
    if (!has(player, PRIMED_MIND_BAR)) return;
    player.getInventory().deleteNumber(PRIMED_MIND_BAR, 1);
    player.getInventory().adds(MIND_HELMET, 1);
    play(player, "into-the-workshop-crafting-the-mind-helm-using-the-workbench-with-the-proper-items");
    quest.complete(player);
  }

  function smithWorkbench(player) {
    if (has(player, ELEMENTAL_METAL) || has(player, PRIMED_MIND_BAR) || has(player, PRIMED_BAR)) return;
    play(player, "into-the-workshop-crafting-the-mind-helm-using-the-workbench-without-elemental-metal");
  }

  // ==========================================================================
  // Event routing
  // ==========================================================================

  function objectOption(event) {
    const actions = event.definition?.getInteractions?.() ?? [];
    return String(actions[event.clickType - 1] ?? "").toLowerCase();
  }

  function npcOption(event) {
    const actions = event.definition?.getActions?.() ?? [];
    return String(actions[event.clickType - 1] ?? "").toLowerCase();
  }

  /**
   * The pins and the old crane are set into blocking scenery, so the closest walkable tile
   * is beside them and `walkToObject` rejects every adjacent tile ("You can't reach that!").
   * When the player is already at the object's footprint, route the use to the player's own
   * tile so the interaction runs (the CurrentAffairs aquarium / Underground Pass guide-rope
   * pattern). Covers both option clicks and item-on-object uses.
   */
  function routeAdjacentObjectUse(event) {
    if (!ROUTE_ASSIST_IDS.has(event.objectId)) return;
    const playerLocation = event.player.getLocation();
    const objectLocation = event.object?.getLocation?.();
    if (!objectLocation) return;
    const definition = event.object.getDefinition?.();
    const size = Math.max(definition?.getSizeX?.() ?? 1, definition?.getSizeY?.() ?? 1);
    const reach = Math.max(
      objectLocation.getX() - playerLocation.getX(),
      playerLocation.getX() - (objectLocation.getX() + size - 1),
      objectLocation.getY() - playerLocation.getY(),
      playerLocation.getY() - (objectLocation.getY() + size - 1),
      0
    );
    if (reach > 2) return;
    event.destination = {
      x: playerLocation.getX(),
      y: playerLocation.getY(),
      z: playerLocation.getZ(),
    };
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    const option = objectOption(event);
    if (objectId === BOOKCASE && option.includes("search")) {
      event.handled = true;
      searchBookcase(player);
      return;
    }
    if (BOILER_IDS.has(objectId) && (option.includes("search") || option === "")) {
      event.handled = true;
      searchMachinery(player);
      return;
    }
    if (HATCH_IDS.has(objectId) && (option === "" || option.includes("open") || option.includes("unlock") || option.includes("climb"))) {
      event.handled = true;
      if (hasFlag(player, FLAG_HATCH_OPEN) && (option === "" || option.includes("climb"))) {
        descendHatch(player);
      } else {
        unlockHatch(player);
      }
      return;
    }
    if (objectId === SCHEMATIC_CRATE && option.includes("take")) {
      event.handled = true;
      takeSchematicChoice(player);
      return;
    }
    if (CRATE_INDEX.has(objectId) && option.includes("search")) {
      event.handled = true;
      searchCrate(player, objectId);
      return;
    }
    if (objectId === FIRE_LEVER_RAISE && option.includes("pull")) {
      event.handled = true;
      moveCrane(player);
      return;
    }
    if (objectId === FIRE_LEVER_ROTATE && option.includes("pull")) {
      event.handled = true;
      rotateCrane(player);
      return;
    }
    if (objectId === CART_LEVER && option.includes("pull")) {
      event.handled = true;
      advanceJig(player);
      return;
    }
    if (objectId === PRESS_LEVER && option.includes("pull")) {
      event.handled = true;
      pullPress(player);
      return;
    }
    if (objectId === JUNCTION_BOX && option.includes("open")) {
      event.handled = true;
      openJunctionBox(player);
      return;
    }
    if ((objectId === VALVE_WEST || objectId === VALVE_EAST) && option.includes("turn")) {
      event.handled = true;
      turnValve(player, objectId === VALVE_WEST);
      return;
    }
    if (objectId === TANK_DOOR_LEVER && option.includes("pull")) {
      event.handled = true;
      pullTankDoor(player);
      return;
    }
    if (objectId === CORKSCREW && option.includes("turn")) {
      event.handled = true;
      turnCorkscrew(player);
      return;
    }
    if (objectId === FAN_LEVER && option.includes("pull")) {
      event.handled = true;
      pullFanLever(player);
      return;
    }
    if (EXTRACTOR_HAT_IDS.has(objectId) && option.includes("operate")) {
      event.handled = true;
      operateExtractor(player);
      return;
    }
    if (EXTRACTOR_GUN_IDS.has(objectId) && (option.includes("take") || option === "")) {
      event.handled = true;
      takeMindBar(player);
      return;
    }
    if (objectId === STAIRS_UP_MACHINE && option.includes("climb")) {
      event.handled = true;
      climbStairs(player, HATCH_ARRIVAL, "You climb back up to the workshop.");
      return;
    }
    if (objectId === STAIRWELL_DOWN && option.includes("climb")) {
      event.handled = true;
      player.sendMessage("You climb down to the extractor room.");
      player.moveTo(BASEMENT_ARRIVAL);
      return;
    }
    if (objectId === STAIRS_UP_BASEMENT && option.includes("climb")) {
      event.handled = true;
      player.sendMessage("You climb back up to the machine room.");
      player.moveTo(new Location(1948, 5157, 2));
      return;
    }
    if (objectId === GANTRY_STAIRS && option.includes("climb")) {
      event.handled = true;
      player.moveTo(climbTile(event.object, 1949, 5149, 3));
      return;
    }
    if (objectId === GANTRY_STAIRS_TOP && option.includes("climb")) {
      event.handled = true;
      player.moveTo(climbTile(event.object, 1949, 5149, 2));
      return;
    }
    if (objectId === WORKBENCH && option.includes("smith")) {
      event.handled = true;
      smithWorkbench(player);
    }
  }

  function handleItemOnObject(event) {
    const { player, objectId, itemId } = event;
    if (itemId === KEY && HATCH_IDS.has(objectId)) {
      event.handled = true;
      unlockHatch(player);
      return;
    }
    if (itemId === PIPE && PIPE_REPAIR_IDS.has(objectId)) {
      event.handled = true;
      repairPiping(player);
      return;
    }
    if (PIN_IDS.has(objectId) && (itemId === SMALL_COG || itemId === MEDIUM_COG || itemId === LARGE_COG)) {
      event.handled = true;
      placeCog(player, objectId, itemId);
      return;
    }
    if (objectId === OLD_CRANE) {
      if (itemId === CRANE_CLAW) {
        event.handled = true;
        repairCrane(player);
        return;
      }
      if (itemId === ELEMENTAL_METAL) {
        event.handled = true;
        player.sendMessage("The crane needs a new claw, not a bar.");
        return;
      }
    }
    if (objectId === WORKBENCH) {
      if (itemId === CRANE_SCHEMATIC || itemId === ELEMENTAL_METAL) {
        if (!hasFlag(player, FLAG_CRANE_SCHEMATIC_TAKEN) && !has(player, CRANE_SCHEMATIC)) return;
        event.handled = true;
        startClawChoice(player);
        return;
      }
      if (itemId === PRIMED_MIND_BAR) {
        event.handled = true;
        makeMindHelm(player);
        return;
      }
    }
    if (itemId === PRIMED_BAR && EXTRACTOR_GUN_IDS.has(objectId)) {
      event.handled = true;
      placePrimedBar(player);
    }
  }

  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    if (!CART_NPC_IDS.has(npcId) || itemId !== ELEMENTAL_METAL) return;
    event.handled = true;
    placeBarOnCart(player);
  }

  function handleNpcInteraction(event) {
    const { player, npcId } = event;
    if (!CART_NPC_IDS.has(npcId)) return;
    const option = npcOption(event);
    if (option !== "" && !option.includes("take")) return;
    event.handled = true;
    takePrimedBar(player);
  }

  function handleItemAction(event) {
    if (!String(event.option ?? "").toLowerCase().includes("read")) return;
    const { player, itemId } = event;
    if (itemId === BEATEN_BOOK) {
      event.handled = true;
      readBeatenBook(player);
      return;
    }
    if (itemId === SCROLL) {
      event.handled = true;
      readScroll(player);
      return;
    }
    if (itemId === CRANE_SCHEMATIC) {
      event.handled = true;
      readCraneSchematic(player);
      return;
    }
    if (itemId === LEVER_SCHEMATIC) {
      event.handled = true;
      readLeverSchematic(player);
    }
  }

  function handleChoice(event) {
    if (event.npcId !== TRANSCRIPT_NPC_ID) return;
    const player = event.player;
    const option = String(event.option ?? "");
    if (option === "Crane schematic") {
      grantSchematic(player, CRANE_SCHEMATIC, FLAG_CRANE_SCHEMATIC_TAKEN);
      return;
    }
    if (option === "Lever schematic") {
      grantSchematic(player, LEVER_SCHEMATIC, FLAG_LEVER_SCHEMATIC_TAKEN);
      return;
    }
    if (option === "An elemental claw.") craftCraneClaw(player);
  }

  function answerCondition(event) {
    if (event.npcId !== TRANSCRIPT_NPC_ID) return null;
    const { player, stepId } = event;
    if (CRATE_CONDITION_KIND.has(stepId)) return crateSearch.get(player) === CRATE_CONDITION_KIND.get(stepId);
    if (FULL_CONDITION_IDS.has(stepId)) return player.getInventory().isFull() === true;
    if (SPACE_CONDITION_IDS.has(stepId)) return player.getInventory().isFull() !== true;
    return null;
  }

  function handleLogin({ player }) {
    syncVarbits(player);
    refreshQuestList(player);
  }

  function spawnJigCart() {
    const npcs = api.getWorld?.()?.getNpcs?.();
    if (npcs) {
      for (const npc of npcs) {
        if (npc && CART_NPC_IDS.has(npc.getId?.())) return;
      }
    }
    api.spawnNpc({ id: NpcIdentifiers.JIG_CART, x: CART_TILE.x, y: CART_TILE.y, z: CART_TILE.z, wanderRadius: 0 });
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const value = questHandle.getStage(player);
    if (value >= STAGE_COMPLETE) {
      return [
        "<str>I found a beaten book and scroll in the Exam Centre.</str>",
        "<str>I repaired the machinery in the deeper Elemental Workshop.</str>",
        "<str>I made a primed mind bar and smithed an elemental mind helm.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (value === 0) {
      return [
        "I can start this quest by searching the bookcase in the Exam Centre",
        "south of the Digsite.",
        "",
        "Minimum requirements: 20 Magic, 30 Smithing and Elemental Workshop I.",
      ];
    }
    const lines = ["<str>I found a beaten book in the Exam Centre.</str>"];
    if (value === STAGE_STARTED) {
      lines.push("I should read the <col=800000>beaten book</col>.");
      return lines;
    }
    lines.push("<str>I read the beaten book and found a scroll used as a bookmark.</str>");
    if (value === STAGE_BOOK_READ) {
      lines.push("I should read the <col=800000>scroll</col>.");
      return lines;
    }
    lines.push("<str>I read the scroll, which mentions a deeper workshop.</str>");
    if (value === STAGE_SCROLL_READ) {
      lines.push("I should search the <col=800000>machinery</col> in the north of the workshop for a key.");
      return lines;
    }
    lines.push("<str>I found a key hidden in the machinery.</str>");
    if (value === STAGE_KEY_TAKEN) {
      lines.push("I should use the key on the <col=800000>hatch</col> in the middle of the workshop.");
      return lines;
    }
    lines.push("<str>I unlocked the hatch and climbed down into the deeper workshop.</str>");
    if (!hasFlag(player, FLAG_CRANE_SCHEMATIC_TAKEN) || !hasFlag(player, FLAG_LEVER_SCHEMATIC_TAKEN)) {
      lines.push("I should take the <col=800000>schematics</col> from the crate by the crane.");
      return lines;
    }
    if (jigState(player).fireState < 1) {
      lines.push("I should make a <col=800000>crane claw</col> and use it on the old crane.");
      return lines;
    }
    if (!pipesSorted(player)) {
      lines.push("I should connect the pipes in the <col=800000>junction box</col> on the catwalk.");
      return lines;
    }
    if (!hasFlag(player, FLAG_PIPE_REPAIRED) || !cogsCorrect(airState(player))) {
      lines.push("I should search the crates for a <col=800000>pipe</col> and three <col=800000>cogs</col>,");
      lines.push("then repair the broken piping and place the cogs on the wind tunnel pins.");
      return lines;
    }
    const jig = jigState(player);
    if (jig.state < 5) {
      lines.push("I should prime an <col=800000>elemental bar</col> on the jig cart:");
      lines.push("heat it in the lava, press it, cool it in the water tank and dry it at the fan.");
      return lines;
    }
    if (value < STAGE_MIND_BAR && !has(player, PRIMED_BAR)) {
      lines.push("I should take the <col=800000>primed bar</col> from the jig cart.");
      return lines;
    }
    if (value < STAGE_MIND_BAR) {
      lines.push("I should use the bar on the <col=800000>extractor gun</col> and operate the hat.");
      return lines;
    }
    lines.push("I should smith the <col=800000>primed mind bar</col> into a mind helmet at a workbench.");
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 7500);
    player.getSkillManager().addExperiences(Skill.SMITHING, 7500);
  }

  api.persistAttribute(FLAGS_ATTRIBUTE);
  api.persistAttribute(JIG_ATTRIBUTE);
  api.persistAttribute(WATER_ATTRIBUTE);
  api.persistAttribute(AIR_ATTRIBUTE);
  api.persistAttribute(PIPES_ATTRIBUTE);
  api.persistAttribute(MIND_ATTRIBUTE);
  api.persistAttribute(CRATES_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "elemental_workshop_ii",
    name: "Elemental Workshop II",
    varpId: VARP,
    varbitId: VARBIT_MAIN,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    varbitValue: wireStage,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.CRAFTING.getIndex(), amount: 7500, label: "Crafting" },
      { skillId: Skill.SMITHING.getIndex(), amount: 7500, label: "Smithing" },
    ],
    rewardItemLabel: "A mind helmet",
    otherRewards: ["The ability to make and use elemental mind equipment"],
    buildJournal,
    onReward: grantReward,
  });

  api.onServerStartup(spawnJigCart);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("ladders:climb", claimClimb);
  api.onObjectRoute(routeAdjacentObjectUse);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject);
  api.onItemOnNpc(handleItemOnNpc);
  api.onNpcInteraction(handleNpcInteraction);
  api.onItemAction(handleItemAction);
  api.onPlayerLogin(handleLogin);
};
