/**
 * Cold War (members).
 *
 * The words come from the "Cold War" transcript page (plus the "Larry" page's
 * standard pre/post-quest variants); this plugin supplies the variant selector for
 * Larry, the prose-condition answers, the emote-greeting, the hide/suit/outpost
 * item and object interactions, the penguin agility course hops, the KGP base
 * entry, the bards' song and the Icelord escape that completes the quest.
 *
 * Stage varbit: 3293 "peng_quest" (varp 968, bits 0-7). Evidence: cs2 script 4024
 * (the quest list's quest-id -> progress map) with the quest DB row id 15 found in
 * cache dbTable 0 row 15 ("Cold War", Larry 827 as start NPC); RuneLite's Quest
 * enum has COLD_WAR(15). The DB row stores completion 135 (column 19), and loc
 * 21245's transform table turns into "A crack" (21157) at varbit values 130 and
 * 135, so 130 (escaped the Icelords) and 135 (quest complete) are the cache's own
 * values. Intermediate values are this plugin's ordering (no cache consumer beyond
 * the crack); sibling bits of varp 968/969 are driven separately:
 *   3294 peng_multi_hide (hide: 0 patch, 1 structure, 2 snowy, 3 destroyed),
 *   3295 peng_farmer, 3296 peng_dwarf_fly, 3297 peng_balloon_fly,
 *   3298 peng_multi_larry (Larry visible at the Lumbridge farm), 3299 peng_multi_kgp,
 *   3300-3302 peng_emote_1/2/3, 3306 peng_transmog, 3307 peng_emote_check.
 *
 * Stages (varbit 3293): 1 started, 2 on the iceberg with materials, 3 hide built,
 * 4 hide covered, 5 penguins observed, 6 book received, 7 suit crafted, 8 second
 * iceberg visit, 9 testing at the zoo, 10 Ardougne report, 11 Lumbridge, 12 sheep
 * greeted, 13 Larry's phrase hint, 14 phrase known, 15 sheep's task, 16 Fred
 * checked (Lumbridge report + outpost location), 17 outpost known, 18 at the
 * entrance, 19 KGP wants an ID, 20 Noodle trade talked, 21 ID obtained, 22 inside
 * the outpost, 23 debriefed, 24 agility course passed, 25 army reported, 26 bards
 * asked, 27 instrument hint, 28 bards done (guard moved), 29 caught in the war
 * room, 130 escaped the Icelords, 135 complete.
 *
 * Rewards per the OSRS Wiki: 1 Quest point, 5,000 Agility, 2,000 Crafting and
 * 1,500 Construction XP, the ability to make penguin suits and use the penguin
 * agility course. Each Icelord kill grants 40 Attack XP (wiki).
 *
 * Sources: OSRS Wiki "Cold War", its Quick guide and Transcript page; RuneLite
 * Quest Helper for walkthrough tiles (not for behaviour); the cache for every id,
 * varbit and placement.
 *
 * Gaps / approximations:
 *  - No player transmog in this repo: "in the suit" is a persisted flag mirrored
 *    to varbit 3306, not a visual change.
 *  - The penguin emote interface (223, old IF1 format) cannot be driven from the
 *    server here, so the three-emote greeting uses chained chatbox prompts with the
 *    eight wiki emote names, and the cutscene names the three emotes in a game
 *    message (the varbits 3300-3302 mirror the sequence for observation).
 *  - The penguin suit is assembled at a Clockmaker's bench (6796-6799) or, since
 *    this repo has no POH crafting-table plugin, by using the clockwork book on the
 *    plank/silk/clockwork in the inventory (this is the documented fallback).
 *  - The agility course is not a real obstacle simulator: each obstacle moves the
 *    player one hop along the wiki/RuneLite tile path and never fails/damages.
 *  - The destroyed-hide transition, the "caught as a human" extra, the war-room
 *    cutscene visuals, the giant-suit cutscene and Larry's dance are replayed as
 *    transcript lines without scenes; 0BlU-b never fires.
 *  - DairyCow.plugin owns the Steal-cowbell object option (both plain and Zanaris
 *    cows); its generic extras-stealing-a-cowbell fail branch (B-J5lc) is
 *    unanswered. The talking Zanaris cow's transcript is the quest conversation.
 */
module.exports = function registerColdWarQuest(api) {
  const {
    Animation,
    Equipment,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectDefinition,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  const PAGE = "Cold War";
  const LARRY_PAGE = "Larry";

  // ==========================================================================
  // Ids
  // ==========================================================================

  const LARRY_ZOO = NpcIdentifiers.LARRY; // 827
  const LARRY_RELLEKKA = NpcIdentifiers.LARRY_2; // 828
  const LARRY_ICEBERG = NpcIdentifiers.LARRY_3; // 829
  const LARRY_FARM_PLACEHOLDER = 1980; // nameless cache placeholder -> Larry 827 via varbit 3298
  const LARRY_NPC_IDS = new Set([
    LARRY_ZOO,
    LARRY_RELLEKKA,
    LARRY_ICEBERG,
    LARRY_FARM_PLACEHOLDER,
  ]);
  const PENGUIN_NPC_IDS = new Set([
    NpcIdentifiers.PENGUIN, // 830
    NpcIdentifiers.PENGUIN_2, // 831
    NpcIdentifiers.PENGUIN_3, // 832
    NpcIdentifiers.PENGUIN_4, // 845, the Ardougne Zoo enclosure penguin
    NpcIdentifiers.PENGUIN_5, // 849
    NpcIdentifiers.PENGUIN_6, // 850
    NpcIdentifiers.PENGUIN_7, // 851
  ]);
  const ZOO_PENGUIN = NpcIdentifiers.PENGUIN_4; // 845
  const OUTPOST_PENGUIN = NpcIdentifiers.PENGUIN_2; // 831, the outpost decor penguin
  const SHEEP = NpcIdentifiers.SHEEP; // 731
  const FRED = NpcIdentifiers.FRED_THE_FARMER; // 732
  const KGP_AGENT = NpcIdentifiers.KGP_AGENT; // 841
  const KGP_ENTRANCE_PLACEHOLDER = 1982; // nameless -> KGP 841 via varbit 3299
  const KGP_WARROOM_PLACEHOLDER = 1983; // nameless -> KGP 841 via varbit 3299 < 2
  const NOODLE = NpcIdentifiers.NOODLE; // 844
  const NOODLE_PLACEHOLDER = 843; // nameless -> Noodle 844 via varbit 3299
  const PING = NpcIdentifiers.PING_3; // 839
  const PONG = NpcIdentifiers.PONG_3; // 840
  const AGILITY_INSTRUCTOR = NpcIdentifiers.AGILITY_INSTRUCTOR; // 847
  const ARMY_COMMANDER = NpcIdentifiers.ARMY_COMMANDER; // 848
  const PESCALING_PAX = NpcIdentifiers.PESCALING_PAX; // 834
  const ICELORD_NPC_IDS = new Set([
    NpcIdentifiers.ICELORD, // 852
    NpcIdentifiers.ICELORD_2, // 853
    NpcIdentifiers.ICELORD_3, // 854
    NpcIdentifiers.ICELORD_4, // 855
  ]);
  const ZANARIS_COW = NpcIdentifiers.COW_5; // 5842, the talking Zanaris cow
  const COLD_WAR_NPC_IDS = new Set([
    LARRY_ZOO,
    LARRY_RELLEKKA,
    LARRY_ICEBERG,
    LARRY_FARM_PLACEHOLDER,
    NpcIdentifiers.PENGUIN,
    NpcIdentifiers.PENGUIN_2,
    NpcIdentifiers.PENGUIN_3,
    NpcIdentifiers.PENGUIN_4,
    NpcIdentifiers.PENGUIN_5,
    NpcIdentifiers.PENGUIN_6,
    NpcIdentifiers.PENGUIN_7,
    SHEEP,
    FRED,
    KGP_AGENT,
    NpcIdentifiers.KGP_AGENT_2,
    NOODLE,
    NpcIdentifiers.PING_3,
    NpcIdentifiers.PONG_3,
    AGILITY_INSTRUCTOR,
    ARMY_COMMANDER,
    PESCALING_PAX,
    NpcIdentifiers.ICELORD,
    NpcIdentifiers.ICELORD_2,
    NpcIdentifiers.ICELORD_3,
    NpcIdentifiers.ICELORD_4,
    ZANARIS_COW,
  ]);

  const OAK_PLANK_ITEM = ItemIdentifiers.OAK_PLANK; // 8778
  const STEEL_NAILS_ITEM = ItemIdentifiers.STEEL_NAILS; // 1539
  const HAMMER_ITEM = ItemIdentifiers.HAMMER; // 2347
  const SPADE_ITEM = ItemIdentifiers.SPADE; // 952
  const PLANK_ITEM = ItemIdentifiers.PLANK; // 960
  const SILK_ITEM = ItemIdentifiers.SILK; // 950
  const CLOCKWORK_ITEM = ItemIdentifiers.CLOCKWORK; // 8792
  const STEEL_BAR_ITEM = ItemIdentifiers.STEEL_BAR; // 2353
  const RAW_COD_ITEM = ItemIdentifiers.RAW_COD; // 341
  const SWAMP_TAR_ITEM = ItemIdentifiers.SWAMP_TAR; // 1939
  const FEATHER_ITEM = ItemIdentifiers.FEATHER; // 314
  const MAHOGANY_PLANK_ITEM = ItemIdentifiers.MAHOGANY_PLANK; // 8782
  const LEATHER_ITEM = ItemIdentifiers.LEATHER; // 1741
  const RING_OF_CHAROS_ITEM = ItemIdentifiers.RING_OF_CHAROS; // 4202
  const RING_OF_CHAROS_A_ITEM = ItemIdentifiers.RING_OF_CHAROS_A_; // 6465
  const PENGUIN_BONGOS_ITEM = ItemIdentifiers.PENGUIN_BONGOS; // 10592
  const COWBELLS_ITEM = ItemIdentifiers.COWBELLS; // 10593
  const CLOCKWORK_BOOK_ITEM = ItemIdentifiers.CLOCKWORK_BOOK; // 10594
  const CLOCKWORK_SUIT_ITEM = ItemIdentifiers.CLOCKWORK_SUIT; // 10595, unwound
  const CLOCKWORK_SUIT_WOUND_ITEM = ItemIdentifiers.CLOCKWORK_SUIT_2; // 10596, wound/active
  const MISSION_REPORT_ARDOUGNE_ITEM = ItemIdentifiers.MISSION_REPORT; // 10597
  const MISSION_REPORT_LUMBRIDGE_ITEM = ItemIdentifiers.MISSION_REPORT_2; // 10598
  const MISSION_REPORT_FAKE_ITEM = ItemIdentifiers.MISSION_REPORT_3; // 10599
  const KGP_ID_ITEM = ItemIdentifiers.KGP_ID_CARD; // 10600
  const SUIT_ITEM_IDS = new Set([CLOCKWORK_SUIT_ITEM, CLOCKWORK_SUIT_WOUND_ITEM]);

  const FIRM_SNOW_PATCH = ObjectIdentifiers.FIRM_SNOW_PATCH; // 21179 (multiloc 21246)
  const BIRD_HIDE_STRUCTURE = ObjectIdentifiers.BIRD_HIDE_STRUCTURE; // 21180
  const SNOWY_BIRD_HIDE = ObjectIdentifiers.SNOWY_BIRD_HIDE; // 21181
  const DESTROYED_BIRD_HIDE = ObjectIdentifiers.DESTROYED_BIRD_HIDE; // 21182
  const HIDE_MULTILOC = 21246; // nameless varbit-3294 multiloc parent
  const AVALANCHE_IDS = new Set([ObjectIdentifiers.AVALANCHE, ObjectIdentifiers.AVALANCHE_2]); // 21158/21159
  const ICEBERG_BOAT = ObjectIdentifiers.BOAT_7; // 21175, iceberg -> Rellekka
  const COAST_BOAT = ObjectIdentifiers.BOAT_9; // 21177, used at both the Rellekka and Weiss coasts
  const WEISS_BOAT_TILE = [2843, 3967];
  const CONTROL_PANEL = ObjectIdentifiers.CONTROL_PANEL_2; // 21055
  const CHASM = ObjectIdentifiers.CHASM; // 21035
  const CRACK_MULTILOC = 21245; // nameless varbit-3293 multiloc parent (A crack at 130/135)
  const A_CRACK = ObjectIdentifiers.A_CRACK; // 21157
  const ZOO_PEN_DOOR = ObjectIdentifiers.DOOR_437; // 21243
  const COURSE_ENTRY_DOOR = ObjectIdentifiers.DOOR_433; // 21169
  const WAR_ROOM_DOOR = ObjectIdentifiers.DOOR_427; // 21160 at 2671,10418
  const PEN_DOOR = ObjectIdentifiers.DOOR_432; // 21167 at 2639,10424
  const EXIT_GATE = ObjectIdentifiers.GATE_154; // 21172
  const STILE = ObjectIdentifiers.STILE_4; // 12982
  const CLOCKMAKER_BENCH_IDS = new Set([6796, 6797, 6798, 6799]); // "Clockmaker's bench"
  const COURSE_OBJECT_IDS = new Set([
    ObjectIdentifiers.ICE_STEPS, // 21095
    ObjectIdentifiers.STEPPING_STONE_18, // 21120
    ObjectIdentifiers.STEPPING_STONE_19, // 21121
    ObjectIdentifiers.STEPPING_STONE_20, // 21122
    ObjectIdentifiers.STEPPING_STONE_21, // 21123
    ObjectIdentifiers.STEPPING_STONE_22, // 21124
    ObjectIdentifiers.STEPPING_STONE_23, // 21126
    ObjectIdentifiers.STEPPING_STONE_24, // 21127
    ObjectIdentifiers.STEPPING_STONE_25, // 21128
    ObjectIdentifiers.STEPPING_STONE_26, // 21129
    ObjectIdentifiers.STEPPING_STONE_27, // 21130
    ObjectIdentifiers.STEPPING_STONE_28, // 21131
    ObjectIdentifiers.STEPPING_STONE_29, // 21132
    ObjectIdentifiers.STEPPING_STONE_30, // 21133
    ObjectIdentifiers.ICICLES, // 21134
    ObjectIdentifiers.ICE, // 21148
    ObjectIdentifiers.ICE_2, // 21149
    ObjectIdentifiers.ICE_3, // 21150
    ObjectIdentifiers.ICE_4, // 21151
    ObjectIdentifiers.ICE_5, // 21152
    ObjectIdentifiers.ICE_6, // 21153
    ObjectIdentifiers.ICE_7, // 21154
    ObjectIdentifiers.ICE_8, // 21155
    ObjectIdentifiers.ICE_9, // 21156
    ObjectIdentifiers.SNOW_JUMP, // 21142
    ObjectIdentifiers.SNOW_JUMP_2, // 21143
  ]);

  // ==========================================================================
  // Varbits / stages / attributes
  // ==========================================================================

  const VARP_COLD_WAR = 968; // "peng_quest" parent, bits 0-7 carry the stage
  const VARBIT_STAGE = 3293; // peng_quest
  const VARBIT_HIDE = 3294; // peng_multi_hide
  const VARBIT_FARMER = 3295; // peng_farmer
  const VARBIT_DWARF_FLY = 3296; // peng_dwarf_fly (Between a Rock)
  const VARBIT_BALLOON_FLY = 3297; // peng_balloon_fly (Enlightened Journey)
  const VARBIT_LARRY = 3298; // peng_multi_larry
  const VARBIT_KGP = 3299; // peng_multi_kgp
  const VARBIT_EMOTE_1 = 3300;
  const VARBIT_EMOTE_2 = 3301;
  const VARBIT_EMOTE_3 = 3302;
  const VARBIT_TRANSMOG = 3306; // peng_transmog
  const VARBIT_EMOTE_CHECK = 3307;
  const VARBIT_DOING_GREETING = 3308;

  const STAGE_STARTED = 1;
  const STAGE_MATERIALS = 2;
  const STAGE_HIDE_BUILT = 3;
  const STAGE_HIDE_COVERED = 4;
  const STAGE_OBSERVED = 5;
  const STAGE_PLANNED = 6;
  const STAGE_SUIT = 7;
  const STAGE_SECOND_ICEBERG = 8;
  const STAGE_ZOO_TEST = 9;
  const STAGE_ZOO_REPORT = 10;
  const STAGE_LUMBRIDGE = 11;
  const STAGE_SHEEP_GREETED = 12;
  const STAGE_PHRASE_HINT = 13;
  const STAGE_PHRASE = 14;
  const STAGE_SHEEP_TASK = 15;
  const STAGE_FRED_DONE = 16;
  const STAGE_OUTPOST_KNOWN = 17;
  const STAGE_ENTRY = 18;
  const STAGE_ASK_ID = 19;
  const STAGE_TRADING = 20;
  const STAGE_ID = 21;
  const STAGE_ENTERED = 22;
  const STAGE_DEBRIEFED = 23;
  const STAGE_COURSE = 24;
  const STAGE_ARMY = 25;
  const STAGE_BARDS = 26;
  const STAGE_INSTRUMENTS = 27;
  const STAGE_BARDS_DONE = 28;
  const STAGE_CAUGHT = 29;
  const STAGE_ESCAPED = 130; // cache: crack appears
  const STAGE_COMPLETE = 135; // cache dbTable 0 row 15 completion value

  const HIDE_ATTRIBUTE = "quest.cold_war.hide";
  const FARMER_ATTRIBUTE = "quest.cold_war.farmer"; // 0 not asked, 1 harmless, 2 threat
  const GREETING_ATTRIBUTE = "quest.cold_war.greeting"; // "a,b,c" emote indexes
  const GREETING_PROGRESS_ATTRIBUTE = "quest.cold_war.greeting-progress";
  const SUIT_ATTRIBUTE = "quest.cold_war.in-suit";
  const SUIT_EVER_ATTRIBUTE = "quest.cold_war.suit-worn";
  const OBSERVED_TALKED_ATTRIBUTE = "quest.cold_war.observed-talked";
  const PHRASE_ATTEMPTED_ATTRIBUTE = "quest.cold_war.phrase-attempted";
  const ZOO_GREETED_ATTRIBUTE = "quest.cold_war.zoo-greeted";
  const SHEEP_GREETED_ATTRIBUTE = "quest.cold_war.sheep-greeted";
  const KGP_GREETED_ATTRIBUTE = "quest.cold_war.kgp-greeted";
  const NOODLE_ASKED_ATTRIBUTE = "quest.cold_war.noodle-asked";
  const KGP_ATTRIBUTE = "quest.cold_war.kgp"; // 0 outside, 1 inside the story, 2 guard moved
  const DWARF_FLY_ATTRIBUTE = "quest.cold_war.dwarf-fly";
  const BALLOON_FLY_ATTRIBUTE = "quest.cold_war.balloon-fly";
  const ICELORD_KILLS_ATTRIBUTE = "quest.cold_war.icelord-kills";

  // Teleport tiles (RuneLite Quest Helper / the 2009scape boat listener).
  const ICEBERG_LANDING = new Location(2660, 3989, 1);
  const RELLEKKA_PIER = new Location(2707, 3735, 0);
  const ZOO_LANDING = new Location(2595, 3265, 0);
  const OUTPOST_ENTRY = new Location(2656, 10384, 0);
  const OUTPOST_EXIT = new Location(2666, 3989, 1);
  const ICELORD_CAGE = new Location(2647, 10427, 0);
  const PEN_DOOR_EXIT = new Location(2637, 10424, 0);
  const COURSE_START = new Location(2634, 4054, 0);

  const QUEST_KEYS = {
    between_a_rock: "between_a_rock",
    enlightened_journey: "enlightened_journey",
  };

  const EMOTE_NAMES = ["Shiver", "Cheer", "Spin", "Wave", "Clap", "Preen", "Bow", "Flap"];
  const DANCE_ANIMATION_ID = 866;

  const bardsRefused = new WeakSet();

  let quest;

  // ==========================================================================
  // Small state helpers
  // ==========================================================================

  function stageOf(player) {
    return quest.getStage(player);
  }

  function setStage(player, value) {
    if (quest.getStage(player) !== value) {
      quest.setStage(player, value);
      syncVarbits(player);
    }
  }

  function hasItem(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function inSuit(player) {
    return player.getAttribute(SUIT_ATTRIBUTE) === true;
  }

  function setInSuit(player, value) {
    player.setAttribute(SUIT_ATTRIBUTE, value === true);
    player.getPacketSender().sendVarbit(VARBIT_TRANSMOG, value ? 1 : 0);
  }

  function hideState(player) {
    return Number(player.getAttribute(HIDE_ATTRIBUTE)) || 0;
  }

  function setHideState(player, value) {
    player.setAttribute(HIDE_ATTRIBUTE, value | 0);
    player.getPacketSender().sendVarbit(VARBIT_HIDE, value | 0);
  }

  function kgpState(player) {
    return Number(player.getAttribute(KGP_ATTRIBUTE)) || 0;
  }

  function setKgpState(player, value) {
    player.setAttribute(KGP_ATTRIBUTE, value | 0);
    player.getPacketSender().sendVarbit(VARBIT_KGP, value | 0);
  }

  function farmerAnswer(player) {
    return Number(player.getAttribute(FARMER_ATTRIBUTE)) || 0;
  }

  function setFarmerAnswer(player, value) {
    player.setAttribute(FARMER_ATTRIBUTE, value | 0);
    player.getPacketSender().sendVarbit(VARBIT_FARMER, value > 1 ? 1 : 0);
  }

  function greetingSequence(player) {
    const raw = String(player.getAttribute(GREETING_ATTRIBUTE) ?? "");
    const parts = raw.split(",").map((value) => Number(value));
    return parts.length === 3 && parts.every((value) => Number.isInteger(value) && value >= 0 && value <= 7)
      ? parts
      : null;
  }

  function setGreetingSequence(player, sequence) {
    player.setAttribute(GREETING_ATTRIBUTE, sequence.join(","));
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_EMOTE_1, sequence[0]);
    sender.sendVarbit(VARBIT_EMOTE_2, sequence[1]);
    sender.sendVarbit(VARBIT_EMOTE_3, sequence[2]);
    player.setAttribute(GREETING_PROGRESS_ATTRIBUTE, 0);
    sender.sendVarbit(VARBIT_EMOTE_CHECK, 0);
  }

  function greetingProgress(player) {
    const value = Number(player.getAttribute(GREETING_PROGRESS_ATTRIBUTE));
    return Number.isInteger(value) && value >= 0 && value <= 3 ? value : 0;
  }

  function setGreetingProgress(player, value) {
    player.setAttribute(GREETING_PROGRESS_ATTRIBUTE, value | 0);
    player.getPacketSender().sendVarbit(VARBIT_EMOTE_CHECK, value | 0);
  }

  function setDoingGreeting(player, value) {
    player.getPacketSender().sendVarbit(VARBIT_DOING_GREETING, value ? 1 : 0);
  }

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    return (
      skills.getMaxLevel(Skill.HUNTER) >= 10 &&
      skills.getMaxLevel(Skill.AGILITY) >= 30 &&
      skills.getMaxLevel(Skill.CRAFTING) >= 30 &&
      skills.getMaxLevel(Skill.CONSTRUCTION) >= 34 &&
      skills.getMaxLevel(Skill.THIEVING) >= 15
    );
  }

  function toolsFree(player) {
    const equipment = player.getEquipment();
    return (
      !equipment.get(Equipment.WEAPON_SLOT) && !equipment.get(Equipment.SHIELD_SLOT)
    );
  }

  function capeFree(player) {
    return !player.getEquipment().get(Equipment.CAPE_SLOT);
  }

  function hasSuitItem(player) {
    return hasItem(player, CLOCKWORK_SUIT_ITEM) || hasItem(player, CLOCKWORK_SUIT_WOUND_ITEM);
  }

  function hasAnyReport(player) {
    return (
      hasItem(player, MISSION_REPORT_ARDOUGNE_ITEM) ||
      hasItem(player, MISSION_REPORT_LUMBRIDGE_ITEM) ||
      hasItem(player, MISSION_REPORT_FAKE_ITEM)
    );
  }

  function addItem(player, itemId, amount = 1, label) {
    player.getInventory().adds(itemId, amount);
    if (label) player.sendMessage(`You receive ${label}.`);
  }

  function resolvedObjectId(event) {
    const resolved = ObjectDefinition.forPlayer(event.objectId, event.player);
    return resolved?.id ?? event.definition?.id ?? event.definition?.getId?.() ?? event.objectId;
  }

  function isZooPenguinLocation(event) {
    const location = event.npc?.getLocation?.() ?? event.location;
    return !location || location.getY?.() < 10000;
  }

  // ==========================================================================
  // Transcript select helpers
  // ==========================================================================

  /** The raw steps up to and including a top-level action/condition id. */
  function selectUpTo(steps, stepId) {
    if (!Array.isArray(steps)) return steps;
    const index = steps.findIndex((step) => step && step.id === stepId);
    return index === -1 ? steps : steps.slice(0, index + 1);
  }

  /** The steps starting at a top-level condition id (drops the earlier prose). */
  function selectFromCondition(steps, conditionId) {
    if (!Array.isArray(steps)) return steps;
    const index = steps.findIndex((step) => step?.type === "condition" && step.id === conditionId);
    return index === -1 ? steps : steps.slice(index);
  }

  /** The nested steps of a condition (searched through steps and choice options). */
  function selectBranch(steps, conditionId) {
    if (!Array.isArray(steps)) return null;
    for (const step of steps) {
      if (!step || typeof step !== "object") continue;
      if (step.type === "condition" && step.id === conditionId) {
        return Array.isArray(step.steps) ? step.steps : [];
      }
      const nested = selectBranch(step.steps, conditionId);
      if (nested) return nested;
      for (const option of step.options ?? []) {
        const found = selectBranch(option.steps, conditionId);
        if (found) return found;
      }
    }
    return null;
  }

  /** Removes the three bards' instrument conditions from the "Yes." option body. */
  function selectBardsSuccess(steps) {
    if (!Array.isArray(steps)) return steps;
    return steps.map((step) => {
      if (step?.type !== "choice" || !Array.isArray(step.options)) return step;
      return {
        ...step,
        options: step.options.map((option) => {
          if (option.text !== "Yes.") return option;
          const body = option.steps ?? [];
          const start = body.findIndex((entry) => entry?.type === "condition" && entry.id === "csSSzj");
          if (start === -1) return option;
          return { ...option, steps: [...body.slice(0, start), ...body.slice(start + 3)] };
        }),
      };
    });
  }

  /** The bards' song on demand, without the instrument checks or hand-in. */
  function selectBardsReplay(steps) {
    if (!Array.isArray(steps)) return steps;
    const skipIds = new Set(["csSSzj", "Y-u_aN", "SvxKW_", "sPTOfL"]);
    return steps.map((step) => {
      if (step?.type !== "choice" || !Array.isArray(step.options)) return step;
      return {
        ...step,
        options: step.options.map((option) => {
          if (option.text !== "Yes.") return option;
          return { ...option, steps: (option.steps ?? []).filter((entry) => !skipIds.has(entry?.id)) };
        }),
      };
    });
  }

  /** Keeps the instrument checks but ends the conversation after the missing line. */
  function selectBardsMissing(steps) {
    if (!Array.isArray(steps)) return steps;
    return steps.map((step) => {
      if (step?.type !== "choice" || !Array.isArray(step.options)) return step;
      return {
        ...step,
        options: step.options.map((option) => {
          if (option.text !== "Yes.") return option;
          const body = option.steps ?? [];
          const start = body.findIndex((entry) => entry?.type === "condition" && entry.id === "csSSzj");
          if (start === -1) return option;
          return { ...option, steps: [...body.slice(0, start + 3), { type: "end" }] };
        }),
      };
    });
  }

  // ==========================================================================
  // Emote greeting
  // ==========================================================================

  const GREETING_CONTEXTS = {
    zoo: {
      variant: "testing-the-suit-at-the-zoo-entering-the-cage-as-a-penguin",
      npcId: ZOO_PENGUIN,
      success: "zRlJMG",
      fail: "iWM-mB",
      first: "UiL_cZ",
      second: "kVRwUH",
    },
    sheep: {
      variant: "finding-the-outpost-greeting-the-sheep",
      npcId: SHEEP,
      success: "zFthiI",
      fail: "wUChoz",
      first: "EXCxjt",
      second: "AqgE_s",
    },
    kgp: {
      variant: "entering-the-outpost-in-front-of-the-entrance",
      npcId: KGP_AGENT,
      success: "yOzRyk",
      fail: "A3AsaQ",
      first: "SJBE02",
      second: "ocmiwc",
    },
  };

  const CONTEXT_BY_GREETING_ACTION = new Map([
    ["gf-bpU", "zoo"],
    ["aLnwgb", "sheep"],
    ["yhoAH1", "kgp"],
  ]);

  function showGreetingPage(player, context, offset) {
    const progress = greetingProgress(player);
    const options = [];
    EMOTE_NAMES.slice(offset, offset + 4).forEach((name, index) => {
      options.push(name, () => greetingChoose(player, context, offset + index));
    });
    options.push(
      offset === 0 ? "More..." : "Back...",
      () => showGreetingPage(player, context, offset === 0 ? 4 : 0)
    );
    setDoingGreeting(player, 1);
    api.sendMultiChatboxPrompt(player, `Secret greeting (move ${progress + 1} of 3)`, ...options);
  }

  function playGreetingBranch(player, context, conditionId) {
    const info = GREETING_CONTEXTS[context];
    startTranscript(api, player, info.npcId, PAGE, info.variant, (steps) => selectBranch(steps, conditionId));
  }

  function greetingChoose(player, context, emote) {
    const expected = greetingSequence(player);
    const progress = greetingProgress(player);
    if (!expected) return;
    if (emote !== expected[progress]) {
      setGreetingProgress(player, 0);
      setDoingGreeting(player, 0);
      playGreetingBranch(player, context, GREETING_CONTEXTS[context].fail);
      return;
    }
    const next = progress + 1;
    setGreetingProgress(player, next);
    if (next >= 3) {
      setDoingGreeting(player, 0);
      greetingSucceeded(player, context);
      return;
    }
    playGreetingBranch(player, context, next === 1 ? GREETING_CONTEXTS[context].first : GREETING_CONTEXTS[context].second);
    showGreetingPage(player, context, 0);
  }

  function greetingSucceeded(player, context) {
    if (context === "zoo") {
      player.setAttribute(ZOO_GREETED_ATTRIBUTE, true);
      playGreetingBranch(player, context, GREETING_CONTEXTS[context].success);
      return;
    }
    if (context === "sheep") {
      player.setAttribute(SHEEP_GREETED_ATTRIBUTE, true);
      setStage(player, STAGE_SHEEP_GREETED);
      playGreetingBranch(player, context, GREETING_CONTEXTS[context].success);
      return;
    }
    player.setAttribute(KGP_GREETED_ATTRIBUTE, true);
    if (stageOf(player) < STAGE_ASK_ID) setStage(player, STAGE_ASK_ID);
    playGreetingBranch(player, context, GREETING_CONTEXTS[context].success);
  }

  function beginGreeting(player, context) {
    if (!greetingSequence(player)) {
      setGreetingSequence(player, [0, 1, 2].map(() => Math.floor(Math.random() * EMOTE_NAMES.length)));
    }
    setGreetingProgress(player, 0);
    showGreetingPage(player, context, 0);
  }

  // ==========================================================================
  // Sync persisted state to cache varbits
  // ==========================================================================

  function syncVarbits(player) {
    const sender = player.getPacketSender();
    const stage = stageOf(player);
    sender.sendVarbit(VARBIT_HIDE, hideState(player));
    sender.sendVarbit(VARBIT_FARMER, farmerAnswer(player) > 1 ? 1 : 0);
    sender.sendVarbit(VARBIT_DWARF_FLY, player.getAttribute(DWARF_FLY_ATTRIBUTE) === true ? 1 : 0);
    sender.sendVarbit(VARBIT_BALLOON_FLY, player.getAttribute(BALLOON_FLY_ATTRIBUTE) === true ? 1 : 0);
    sender.sendVarbit(VARBIT_LARRY, stage >= STAGE_LUMBRIDGE && stage < STAGE_ENTRY ? 1 : 0);
    sender.sendVarbit(VARBIT_KGP, kgpState(player));
    const greeting = greetingSequence(player) ?? [0, 0, 0];
    sender.sendVarbit(VARBIT_EMOTE_1, greeting[0]);
    sender.sendVarbit(VARBIT_EMOTE_2, greeting[1]);
    sender.sendVarbit(VARBIT_EMOTE_3, greeting[2]);
    sender.sendVarbit(VARBIT_TRANSMOG, inSuit(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_EMOTE_CHECK, greetingProgress(player));
    sender.sendVarbit(VARBIT_DOING_GREETING, 0);
  }

  function handleLogin({ player }) {
    syncVarbits(player);
  }

  function handleBootstrap({ player }) {
    syncVarbits(player);
  }

  // ==========================================================================
  // Larry variant selector (NpcDialogues Talk-to)
  // ==========================================================================

  function larryAtFarm(event) {
    return (event.npc?.getId?.() ?? event.npcId) === LARRY_FARM_PLACEHOLDER;
  }

  function larryAtIceberg(event) {
    const location = event.npc?.getLocation?.();
    return location ? location.getZ() === 1 && location.getY() < 10000 : event.npcId === LARRY_ICEBERG;
  }

  function selectLarryVariant(event) {
    const { npcId, player } = event;
    if (!LARRY_NPC_IDS.has(npcId) && !LARRY_NPC_IDS.has(event.npc?.getId?.())) return null;
    const stage = stageOf(player);
    const atFarm = larryAtFarm(event);
    const atIceberg = larryAtIceberg(event);

    if (stage >= STAGE_COMPLETE) {
      if (atIceberg) return "standard-dialogue-at-the-iceberg-after-cold-war";
      if (npcId === LARRY_RELLEKKA) return "standard-dialogue-at-rellekka-boat-after-cold-war";
      return "standard-dialogue-at-the-ardougne-zoo-after-cold-war";
    }

    if (stage === 0) {
      if (npcId === LARRY_RELLEKKA) return "standard-dialogue-at-rellekka-boat-before-cold-war";
      return "standard-dialogue-at-ardougne-zoo-before-cold-war";
    }

    if (inSuit(player) && stage >= STAGE_ZOO_TEST && stage <= STAGE_ZOO_REPORT) {
      return "testing-the-suit-at-the-zoo-speaking-to-larry-at-ardougne-zoo-speaking-to-larry-while-in-the-suit";
    }

    if (atFarm || stage === STAGE_LUMBRIDGE || stage === STAGE_SHEEP_GREETED || stage === STAGE_PHRASE_HINT) {
      if (stage >= STAGE_FRED_DONE) return "finding-the-outpost-after-finding-the-outpost-s-location";
      if (stage === STAGE_PHRASE) {
        setStage(player, STAGE_SHEEP_TASK);
        return "finding-the-outpost-after-obtaining-the-phrase";
      }
      if (stage === STAGE_SHEEP_GREETED) {
        setStage(player, STAGE_PHRASE_HINT);
        return "finding-the-outpost-returning-to-larry-about-a-secret-phrase";
      }
      if (stage === STAGE_PHRASE_HINT) {
        if (player.getAttribute(PHRASE_ATTEMPTED_ATTRIBUTE) === true) {
          return "finding-the-outpost-not-getting-the-phrase-from-the-zoo-penguin";
        }
        return "finding-the-outpost-returning-to-larry-about-a-secret-phrase";
      }
      return "finding-the-outpost-searching-for-the-penguins-at-lumbridge";
    }

    if (atIceberg) {
      if (stage >= STAGE_ESCAPED) return "finishing-up-after-escaping-the-ice-lords";
      if (stage >= STAGE_CAUGHT) return "finishing-up-after-escaping-the-ice-lords";
      if (stage >= STAGE_ARMY) {
        if (stage >= STAGE_BARDS && stage < STAGE_BARDS_DONE) {
          if (stage === STAGE_BARDS) {
            setStage(player, STAGE_INSTRUMENTS);
            return "searching-for-the-secret-room-asking-penguins-in-a-room-nearby-about-the-door-asking-larry-about-the-cowbell-and-bongos";
          }
          return "searching-for-the-secret-room-asking-penguins-in-a-room-nearby-about-the-door-asking-larry-about-the-cowbell-and-bongos";
        }
        return "searching-for-the-secret-room-speaking-to-larry-again-before-looking-for-the-war-room";
      }
      if (stage === STAGE_COURSE) {
        setStage(player, STAGE_ARMY);
        return "inside-the-outpost-reporting-to-larry-after-finding-about-penguin-training";
      }
      if (stage >= STAGE_ASK_ID && stage <= STAGE_DEBRIEFED) {
        return "entering-the-outpost-asking-larry-about-an-id";
      }
      if (stage === STAGE_ENTRY || stage === STAGE_OUTPOST_KNOWN) {
        return "entering-the-outpost-speaking-to-larry";
      }
      if (stage === STAGE_PLANNED || stage === STAGE_SUIT) {
        return "planning-the-infiltration-making-the-penguin-suit";
      }
      if (stage === STAGE_SECOND_ICEBERG) {
        return "planning-the-infiltration-second-iceberg-visit";
      }
      if (stage === STAGE_ZOO_TEST || stage === STAGE_ZOO_REPORT) {
        return "planning-the-infiltration-second-iceberg-visit-speaking-to-larry-again-without-leaving";
      }
      if (stage === STAGE_HIDE_COVERED) {
        return "first-trip-to-the-iceberg-with-a-fully-built-hideout";
      }
      if (stage === STAGE_HIDE_BUILT) {
        return "first-trip-to-the-iceberg-with-hideout-partially-built";
      }
      if (stage === STAGE_OBSERVED) {
        if (player.getAttribute(OBSERVED_TALKED_ATTRIBUTE) === true) {
          return "first-trip-to-the-iceberg-after-observing-the-penguins-speaking-to-larry-again-without-leaving";
        }
        return "first-trip-to-the-iceberg-after-observing-the-penguins";
      }
      return "first-trip-to-the-iceberg-before-building-the-hideout";
    }

    // Off the iceberg at the zoo / Rellekka pier.
    if (stage === STAGE_STARTED) {
      return "getting-started-getting-materials-to-build-the-hideout";
    }
    if (stage === STAGE_MATERIALS || stage === STAGE_HIDE_BUILT || stage === STAGE_HIDE_COVERED) {
      return "getting-started-getting-materials-to-build-the-hideout";
    }
    if (stage === STAGE_OBSERVED || stage === STAGE_PLANNED) {
      return "planning-the-infiltration-speaking-to-larry-at-the-zoo-or-relekka";
    }
    if (stage === STAGE_SUIT || stage === STAGE_SECOND_ICEBERG) {
      return "planning-the-infiltration-making-the-penguin-suit";
    }
    if (stage === STAGE_ZOO_TEST || stage === STAGE_ZOO_REPORT) {
      if (stage === STAGE_ZOO_REPORT) {
        setStage(player, STAGE_LUMBRIDGE);
        return "testing-the-suit-at-the-zoo-after-speaking-with-ardougne-zoo-s-penguins";
      }
      return "testing-the-suit-at-the-zoo-speaking-to-larry-at-ardougne-zoo";
    }
    if (stage === STAGE_OUTPOST_KNOWN || stage === STAGE_ENTRY) {
      return "entering-the-outpost-speaking-to-larry";
    }
    return "entering-the-outpost-speaking-to-larry";
  }

  // ==========================================================================
  // Condition answers
  // ==========================================================================

  function answerCondition(event) {
    const { player, stepId } = event;
    if (!COLD_WAR_NPC_IDS.has(event.npcId)) return null;
    switch (stepId) {
      case "ckTrSI":
        return !meetsRequirements(player);
      case "RHMS4E":
        return !hasItem(player, OAK_PLANK_ITEM, 10);
      case "7OC0wq":
        return !hasItem(player, STEEL_NAILS_ITEM, 10);
      case "moBm_9":
        return !hasItem(player, HAMMER_ITEM);
      case "75_MO0":
        return !hasSuitItem(player);
      case "jeoYJO":
        return hasItem(player, CLOCKWORK_BOOK_ITEM);
      case "1ot_FT":
        return !toolsFree(player);
      case "WcD3jc":
        return !capeFree(player);
      case "-AeTOp":
        return questComplete(player, QUEST_KEYS.between_a_rock);
      case "zi6PiL":
        return questComplete(player, QUEST_KEYS.enlightened_journey);
      case "1aFyOj":
        return wearingCharos(player);
      case "MO9fws":
        return hasItem(player, RAW_COD_ITEM);
      case "ylnoAH":
        return farmerAnswer(player) === 2;
      case "0rzTQg":
        return farmerAnswer(player) === 1;
      case "V7Cvsk":
        return !hasItem(player, KGP_ID_ITEM);
      case "PudkDR":
        return player.getAppearance?.().isMale?.() !== false;
      case "5z-QWh":
        return player.getAppearance?.().isMale?.() === false;
      case "h9KcXB":
        return questComplete(player, QUEST_KEYS.between_a_rock);
      case "8PxEDS":
        return questComplete(player, QUEST_KEYS.enlightened_journey);
      case "uxzR9J":
        return !hasItem(player, SWAMP_TAR_ITEM) || !hasItem(player, FEATHER_ITEM, 5);
      case "auvLmd":
        return hasItem(player, SWAMP_TAR_ITEM) && !hasItem(player, FEATHER_ITEM, 5);
      case "FXHaid":
        return !hasItem(player, SWAMP_TAR_ITEM) && hasItem(player, FEATHER_ITEM, 5);
      case "jdpWO4":
        return hasItem(player, KGP_ID_ITEM);
      case "7YurS-":
        return hasItem(player, MISSION_REPORT_FAKE_ITEM);
      case "csSSzj":
        return !hasItem(player, COWBELLS_ITEM) && !hasItem(player, PENGUIN_BONGOS_ITEM);
      case "Y-u_aN":
        return hasItem(player, COWBELLS_ITEM) && !hasItem(player, PENGUIN_BONGOS_ITEM);
      case "SvxKW_":
        return !hasItem(player, COWBELLS_ITEM) && hasItem(player, PENGUIN_BONGOS_ITEM);
      case "B-J5lc":
      case "0BlU-b":
        return false;
      default:
        break;
    }
    // Greeting guards are owned by the prompt; never let the transcript branch them.
    if (
      ["iWM-mB", "UiL_cZ", "ghtZ3I", "kVRwUH", "hyttwc", "zRlJMG",
        "wUChoz", "EXCxjt", "onaD4-", "AqgE_s", "QDQ2lw", "zFthiI",
        "A3AsaQ", "SJBE02", "aZzyQz", "ocmiwc", "CMMy1v", "yOzRyk"].includes(stepId)
    ) {
      return false;
    }
    return null;
  }

  function wearingCharos(player) {
    const ring = player.getEquipment().get(Equipment.RING_SLOT);
    return ring?.getId?.() === RING_OF_CHAROS_ITEM || ring?.getId?.() === RING_OF_CHAROS_A_ITEM;
  }

  // ==========================================================================
  // Transcript action handler
  // ==========================================================================

  function handleAction(event) {
    const { player, stepId } = event;
    switch (stepId) {
      case "919VsK":
        setStage(player, STAGE_STARTED);
        return;
      case "_0WHki":
        setStage(player, STAGE_MATERIALS);
        setHideState(player, 0);
        player.moveTo(ICEBERG_LANDING);
        return;
      case "TMchju":
        setHideState(player, 1);
        setStage(player, STAGE_HIDE_BUILT);
        return;
      case "WH_ZIo":
        setHideState(player, 2);
        setStage(player, STAGE_HIDE_COVERED);
        return;
      case "7rg9i8":
        if (!greetingSequence(player)) {
          setGreetingSequence(player, [0, 1, 2].map(() => Math.floor(Math.random() * EMOTE_NAMES.length)));
        }
        return;
      case "bq2--X": {
        const greeting = greetingSequence(player) ?? [0, 0, 0];
        player.sendMessage(`The two penguins greet each other: ${greeting.map((index) => EMOTE_NAMES[index]).join(", ")}.`);
        return;
      }
      case "oFxpz9":
        setStage(player, STAGE_OBSERVED);
        return;
      case "_0I9uW":
        setStage(player, STAGE_PLANNED);
        if (!hasItem(player, CLOCKWORK_BOOK_ITEM)) addItem(player, CLOCKWORK_BOOK_ITEM);
        return;
      case "2YQiy3":
        if (!hasItem(player, CLOCKWORK_BOOK_ITEM)) addItem(player, CLOCKWORK_BOOK_ITEM);
        return;
      case "rbWlqr":
        setHideState(player, 3);
        setKgpState(player, 0);
        setStage(player, STAGE_SECOND_ICEBERG);
        player.moveTo(ICEBERG_LANDING);
        return;
      case "_5Rfk9":
        setStage(player, STAGE_ZOO_TEST);
        player.moveTo(ZOO_LANDING);
        return;
      case "PCdoMg":
        takeSuitFromInventory(player);
        setInSuit(player, true);
        player.setAttribute(SUIT_EVER_ATTRIBUTE, true);
        return;
      case "eFxEgK":
        setInSuit(player, false);
        if (!hasSuitItem(player) && player.getAttribute(SUIT_EVER_ATTRIBUTE) === true) {
          player.getInventory().adds(CLOCKWORK_SUIT_WOUND_ITEM, 1);
        }
        return;
      case "gf-bpU":
      case "aLnwgb":
      case "yhoAH1": {
        const context = CONTEXT_BY_GREETING_ACTION.get(stepId);
        event.handled = true;
        event.end = true;
        beginGreeting(player, context);
        return;
      }
      case "QokytE":
        if (!hasItem(player, MISSION_REPORT_ARDOUGNE_ITEM)) addItem(player, MISSION_REPORT_ARDOUGNE_ITEM);
        player.setAttribute(DWARF_FLY_ATTRIBUTE, questComplete(player, QUEST_KEYS.between_a_rock));
        player.setAttribute(BALLOON_FLY_ATTRIBUTE, questComplete(player, QUEST_KEYS.enlightened_journey));
        player.getPacketSender().sendVarbit(VARBIT_DWARF_FLY, player.getAttribute(DWARF_FLY_ATTRIBUTE) === true ? 1 : 0);
        player.getPacketSender().sendVarbit(VARBIT_BALLOON_FLY, player.getAttribute(BALLOON_FLY_ATTRIBUTE) === true ? 1 : 0);
        setStage(player, STAGE_ZOO_REPORT);
        return;
      case "nLiz6A":
        if (hasItem(player, RAW_COD_ITEM)) {
          player.getInventory().deleteNumber(RAW_COD_ITEM, 1);
          setStage(player, STAGE_PHRASE);
        }
        return;
      case "xyEjEU":
        if (!hasItem(player, MISSION_REPORT_LUMBRIDGE_ITEM)) addItem(player, MISSION_REPORT_LUMBRIDGE_ITEM);
        setStage(player, STAGE_OUTPOST_KNOWN);
        return;
      case "Ws0sJV":
        setKgpState(player, 1);
        setStage(player, STAGE_ENTRY);
        player.moveTo(ICEBERG_LANDING);
        return;
      case "s3yToC":
        if (!hasItem(player, SWAMP_TAR_ITEM) || !hasItem(player, FEATHER_ITEM, 5)) {
          event.handled = true;
          event.end = true;
          player.sendMessage("You need swamp tar and five feathers.");
          return;
        }
        player.getInventory().deleteNumber(SWAMP_TAR_ITEM, 1);
        player.getInventory().deleteNumber(FEATHER_ITEM, 5);
        return;
      case "60XoJz":
        if (!hasItem(player, KGP_ID_ITEM)) addItem(player, KGP_ID_ITEM);
        if (!hasItem(player, MISSION_REPORT_FAKE_ITEM)) addItem(player, MISSION_REPORT_FAKE_ITEM);
        setStage(player, STAGE_ID);
        return;
      case "Wz1t4b":
        if (!hasItem(player, KGP_ID_ITEM)) addItem(player, KGP_ID_ITEM);
        return;
      case "PxWEzj":
        if (!hasItem(player, MISSION_REPORT_FAKE_ITEM)) addItem(player, MISSION_REPORT_FAKE_ITEM);
        return;
      case "qMwHHN":
        setStage(player, STAGE_ENTERED);
        player.moveTo(OUTPOST_ENTRY);
        return;
      case "HeyQcq":
        if (!hasAllReports(player)) {
          event.handled = true;
          event.end = true;
          player.sendMessage("You need all three mission reports.");
          return;
        }
        player.getInventory().deleteNumber(MISSION_REPORT_ARDOUGNE_ITEM, 1);
        player.getInventory().deleteNumber(MISSION_REPORT_LUMBRIDGE_ITEM, 1);
        player.getInventory().deleteNumber(MISSION_REPORT_FAKE_ITEM, 1);
        setStage(player, STAGE_DEBRIEFED);
        return;
      case "sPTOfL":
        if (!hasItem(player, COWBELLS_ITEM) || !hasItem(player, PENGUIN_BONGOS_ITEM)) {
          event.handled = true;
          event.end = true;
          return;
        }
        player.getInventory().deleteNumber(COWBELLS_ITEM, 1);
        player.getInventory().deleteNumber(PENGUIN_BONGOS_ITEM, 1);
        bardsRefused.delete(player);
        return;
      case "imIvkM":
        setKgpState(player, 2);
        setStage(player, STAGE_BARDS_DONE);
        return;
      case "8BUDMn":
        setInSuit(player, false);
        return;
      case "1Swytg":
        takeSuitFromInventory(player);
        player.setAttribute(SUIT_EVER_ATTRIBUTE, false);
        return;
      case "rTDnPW":
        player.setAttribute(ICELORD_KILLS_ATTRIBUTE, 0);
        setStage(player, STAGE_CAUGHT);
        player.moveTo(ICELORD_CAGE);
        return;
      case "LaGhbe":
        event.npc?.performAnimation?.(new Animation(DANCE_ANIMATION_ID));
        return;
      case "hqkqI9":
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      case "IzwAvd":
        return;
      case "LP6eq3":
        player.moveTo(OUTPOST_EXIT);
        return;
      case "W_ULie":
        if (!hasItem(player, COWBELLS_ITEM)) addItem(player, COWBELLS_ITEM);
        return;
      case "zZl9eZ":
        if (!hasItem(player, PENGUIN_BONGOS_ITEM)) addItem(player, PENGUIN_BONGOS_ITEM);
        return;
      case "DN2JGj":
        player.setHitpoints(Math.max(1, player.getHitpoints() - 3));
        return;
      case "VGPMLP":
        if (!hasItem(player, COWBELLS_ITEM)) addItem(player, COWBELLS_ITEM);
        return;
      default:
        return;
    }
  }

  function hasAllReports(player) {
    return (
      hasItem(player, MISSION_REPORT_ARDOUGNE_ITEM) &&
      hasItem(player, MISSION_REPORT_LUMBRIDGE_ITEM) &&
      hasItem(player, MISSION_REPORT_FAKE_ITEM)
    );
  }

  function takeSuitFromInventory(player) {
    for (const itemId of SUIT_ITEM_IDS) {
      const amount = player.getInventory().getAmount(itemId);
      if (amount > 0) player.getInventory().deleteNumber(itemId, amount);
    }
  }

  // ==========================================================================
  // Transcript choice handler
  // ==========================================================================

  function handleChoice(event) {
    const { player, npcId, option } = event;
    switch (option) {
      case "Okay, why not!":
        if (LARRY_NPC_IDS.has(npcId) && stageOf(player) === 0) setStage(player, STAGE_STARTED);
        return;
      case "That's crazy!":
      case "It did seem rather suspicious.":
        if (LARRY_NPC_IDS.has(npcId)) player.setAttribute(OBSERVED_TALKED_ATTRIBUTE, true);
        return;
      case "Bully Fred":
        if (npcId === FRED) {
          setFarmerAnswer(player, 2);
          setStage(player, STAGE_FRED_DONE);
        }
        return;
      case "Warn Fred":
        if (npcId === FRED) {
          setFarmerAnswer(player, 1);
          setStage(player, STAGE_FRED_DONE);
        }
        return;
      case "I've lost the clockwork book, could I have another?":
        if (
          LARRY_NPC_IDS.has(npcId) &&
          stageOf(player) >= STAGE_PLANNED &&
          !hasItem(player, CLOCKWORK_BOOK_ITEM)
        ) {
          addItem(player, CLOCKWORK_BOOK_ITEM);
        }
        return;
      case "Yes.":
        if ((npcId === PING || npcId === PONG) && (!hasItem(player, COWBELLS_ITEM) || !hasItem(player, PENGUIN_BONGOS_ITEM))) {
          bardsRefused.add(player);
        }
        return;
      default:
        return;
    }
  }

  function handleLine(event) {
    const { player, text, npcId } = event;
    // The wiki export puts the "Quest complete!" action after an end marker, so
    // it never plays; finish the quest on Larry's last line of the epilogue.
    if (String(text ?? "").startsWith("As for our next move") && LARRY_NPC_IDS.has(npcId)) {
      const stage = stageOf(player);
      if (stage >= STAGE_ESCAPED && stage < STAGE_COMPLETE) quest.complete(player);
    }
    if (!bardsRefused.has(player)) return;
    if (String(text ?? "").startsWith("Dude, good job")) event.skip = true;
  }

  // ==========================================================================
  // Item interactions
  // ==========================================================================

  function handleItemOnObject(event) {
    const { player, itemId } = event;
    const objectId = resolvedObjectId(event);

    if (itemId === OAK_PLANK_ITEM && objectId === FIRM_SNOW_PATCH) {
      event.handled = true;
      buildHide(player);
      return;
    }
    if (itemId === SPADE_ITEM && objectId === BIRD_HIDE_STRUCTURE) {
      event.handled = true;
      coverHide(player);
      return;
    }
    if (CLOCKMAKER_BENCH_IDS.has(objectId)) {
      if (itemId === CLOCKWORK_BOOK_ITEM || itemId === PLANK_ITEM || itemId === CLOCKWORK_ITEM || itemId === SILK_ITEM) {
        event.handled = true;
        craftSuit(player);
      }
      return;
    }
  }

  function buildHide(player) {
    if (stageOf(player) < STAGE_STARTED) return;
    if (hideState(player) !== 0) return;
    if (!hasItem(player, OAK_PLANK_ITEM, 10) || !hasItem(player, STEEL_NAILS_ITEM, 10) || !hasItem(player, HAMMER_ITEM)) {
      player.sendMessage("You need 10 oak planks, 10 steel nails and a hammer to build the bird hide.");
      return;
    }
    player.getInventory().deleteNumber(OAK_PLANK_ITEM, 10);
    player.getInventory().deleteNumber(STEEL_NAILS_ITEM, 10);
    startTranscript(api, player, LARRY_ZOO, PAGE, "first-trip-to-the-iceberg-before-building-the-hideout-building-the-hideout");
  }

  function coverHide(player) {
    if (hideState(player) !== 1) return;
    if (!hasItem(player, SPADE_ITEM)) return;
    startTranscript(api, player, LARRY_ZOO, PAGE, "first-trip-to-the-iceberg-with-hideout-partially-built-covering-the-structure-in-snow");
  }

  function craftSuit(player) {
    if (stageOf(player) < STAGE_PLANNED) return;
    if (hasSuitItem(player)) {
      player.sendMessage("You already have a clockwork suit.");
      return;
    }
    if (!hasItem(player, PLANK_ITEM) || !hasItem(player, SILK_ITEM)) {
      player.sendMessage("You need a plank, a piece of silk and a clockwork mechanism to make the suit.");
      return;
    }
    if (!hasItem(player, CLOCKWORK_ITEM) && !hasItem(player, STEEL_BAR_ITEM)) {
      player.sendMessage("You need a clockwork mechanism (or a steel bar to make one) to make the suit.");
      return;
    }
    player.getInventory().deleteNumber(PLANK_ITEM, 1);
    player.getInventory().deleteNumber(SILK_ITEM, 1);
    if (hasItem(player, CLOCKWORK_ITEM)) player.getInventory().deleteNumber(CLOCKWORK_ITEM, 1);
    else player.getInventory().deleteNumber(STEEL_BAR_ITEM, 1);
    player.getInventory().adds(CLOCKWORK_SUIT_ITEM, 1);
    player.sendMessage("You follow the book's designs and assemble a clockwork penguin suit.");
    setStage(player, STAGE_SUIT);
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);
    if (pair.has(MAHOGANY_PLANK_ITEM) && pair.has(LEATHER_ITEM)) {
      event.handled = true;
      if (hasItem(player, PENGUIN_BONGOS_ITEM)) {
        player.sendMessage("You already have penguin bongos.");
        return;
      }
      player.getInventory().deleteNumber(MAHOGANY_PLANK_ITEM, 1);
      player.getInventory().deleteNumber(LEATHER_ITEM, 1);
      startTranscript(api, player, LARRY_ZOO, PAGE, "extras-making-the-bongos");
      return;
    }
    if (pair.has(CLOCKWORK_BOOK_ITEM) && (pair.has(PLANK_ITEM) || pair.has(SILK_ITEM) || pair.has(CLOCKWORK_ITEM) || pair.has(STEEL_BAR_ITEM))) {
      event.handled = true;
      craftSuit(player);
    }
  }

  function handleItemAction(event) {
    const { player, itemId } = event;
    if (itemId === CLOCKWORK_BOOK_ITEM && event.option === "Read") {
      event.handled = true;
      player.sendMessage("Larry's book describes a clockwork penguin suit: a plank, a piece of silk and a clockwork mechanism, assembled at a clockmaker's bench.");
      return;
    }
    if (itemId === CLOCKWORK_SUIT_ITEM && event.option === "Wind") {
      event.handled = true;
      player.getInventory().deleteNumber(CLOCKWORK_SUIT_ITEM, 1);
      player.getInventory().adds(CLOCKWORK_SUIT_WOUND_ITEM, 1);
      player.sendMessage("You wind the clockwork suit.");
      return;
    }
    if (itemId === CLOCKWORK_SUIT_WOUND_ITEM && event.option === "Release") {
      event.handled = true;
      startTranscript(api, player, LARRY_ZOO, PAGE, "extras-trying-to-manually-unequip-the-penguin-suit");
      return;
    }
    if (itemId === SPADE_ITEM && event.option === "Dig" && hideState(player) === 1) {
      event.handled = true;
      coverHide(player);
    }
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function handleObjectInteraction(event) {
    const { player } = event;
    const objectId = resolvedObjectId(event);
    const stage = stageOf(player);

    if (AVALANCHE_IDS.has(objectId)) {
      if (stage < STAGE_ENTRY) return;
      event.handled = true;
      enterOutpost(player, stage);
      return;
    }
    if (objectId === ICEBERG_BOAT) {
      event.handled = true;
      player.moveTo(RELLEKKA_PIER);
      return;
    }
    if (objectId === COAST_BOAT) {
      event.handled = true;
      const atWeiss = event.location?.x === WEISS_BOAT_TILE[0] && event.location?.y === WEISS_BOAT_TILE[1];
      player.moveTo(atWeiss ? RELLEKKA_PIER : ICEBERG_LANDING);
      return;
    }
    if (objectId === SNOWY_BIRD_HIDE) {
      event.handled = true;
      startTranscript(api, player, LARRY_ZOO, PAGE, "first-trip-to-the-iceberg-with-a-fully-built-hideout-interacting-with-the-hideout-again");
      return;
    }
    if (objectId === DESTROYED_BIRD_HIDE) {
      event.handled = true;
      startTranscript(api, player, LARRY_ZOO, PAGE, "extras-interacting-with-the-destroyed-hideout");
      return;
    }
    if (objectId === CONTROL_PANEL) {
      event.handled = true;
      if (kgpState(player) >= 2) player.sendMessage("You operate the control panel. The control room doors slide open.");
      else player.sendMessage("The control panel is locked.");
      return;
    }
    if (objectId === CHASM) {
      event.handled = true;
      if (stage >= STAGE_CAUGHT) {
        setStage(player, STAGE_ESCAPED);
        player.moveTo(OUTPOST_EXIT);
      }
      return;
    }
    if (objectId === A_CRACK || objectId === CRACK_MULTILOC) {
      event.handled = true;
      if (stage >= STAGE_ESCAPED) player.moveTo(ICELORD_CAGE);
      return;
    }
    if (objectId === COURSE_ENTRY_DOOR) {
      event.handled = true;
      player.moveTo(COURSE_START);
      player.sendMessage("You enter the penguin agility course.");
      return;
    }
    if (objectId === EXIT_GATE) {
      return;
    }
    if (objectId === WAR_ROOM_DOOR && event.location?.x === 2671 && event.location?.y === 10418) {
      if (stage >= STAGE_BARDS_DONE && inSuit(player)) {
        event.handled = true;
        startTranscript(api, player, PESCALING_PAX, PAGE, "searching-for-the-secret-room-entering-the-secret-room");
      }
      return;
    }
    if (objectId === PEN_DOOR && event.location?.x === 2639 && event.location?.y === 10424) {
      event.handled = true;
      leaveIcelordCage(player);
      return;
    }
    if (objectId === STILE && inSuit(player)) {
      event.handled = true;
      startTranscript(api, player, LARRY_ZOO, PAGE, "extras-trying-to-use-the-shortcut-near-fred-as-a-penguin");
      return;
    }
    if (COURSE_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      courseHop(player, objectId);
    }
  }

  function enterOutpost(player, stage) {
    if (!inSuit(player)) {
      startTranscript(api, player, KGP_AGENT, PAGE, "extras-when-caught-as-a-human-at-the-iceberg");
      return;
    }
    if (stage >= STAGE_ID) {
      startTranscript(api, player, KGP_AGENT, PAGE, "entering-the-outpost-obtaining-entry-permission-upon-entering");
      return;
    }
    if (stage >= STAGE_ASK_ID) {
      startTranscript(api, player, KGP_AGENT, PAGE, "entering-the-outpost-obtaining-entry-permission");
      return;
    }
    startTranscript(api, player, KGP_AGENT, PAGE, "entering-the-outpost-in-front-of-the-entrance", (steps) => selectUpTo(steps, "yhoAH1"));
  }

  function leaveIcelordCage(player) {
    if (stageOf(player) < STAGE_CAUGHT) return;
    const kills = Number(player.getAttribute(ICELORD_KILLS_ATTRIBUTE)) || 0;
    const opens = kills >= 3 || (kills === 2 && Math.random() < 0.66) || (kills === 1 && Math.random() < 0.33);
    if (!opens) {
      startTranscript(api, player, NpcIdentifiers.ICELORD, PAGE, "extras-trying-to-leave-the-ice-lord-cage-before-defeating-them");
      return;
    }
    player.moveTo(PEN_DOOR_EXIT);
  }

  function courseHop(player, objectId) {
    let destination;
    switch (objectId) {
      case ObjectIdentifiers.ICE_STEPS:
      case ObjectIdentifiers.STEPPING_STONE_18:
      case ObjectIdentifiers.STEPPING_STONE_19:
      case ObjectIdentifiers.STEPPING_STONE_20:
      case ObjectIdentifiers.STEPPING_STONE_21:
      case ObjectIdentifiers.STEPPING_STONE_22:
      case ObjectIdentifiers.STEPPING_STONE_23:
      case ObjectIdentifiers.STEPPING_STONE_24:
      case ObjectIdentifiers.STEPPING_STONE_25:
      case ObjectIdentifiers.STEPPING_STONE_26:
      case ObjectIdentifiers.STEPPING_STONE_27:
      case ObjectIdentifiers.STEPPING_STONE_28:
      case ObjectIdentifiers.STEPPING_STONE_29:
      case ObjectIdentifiers.STEPPING_STONE_30:
        destination = new Location(2635, 4065, 1);
        break;
      case ObjectIdentifiers.ICICLES:
        destination = new Location(2662, 4083, 1);
        break;
      case ObjectIdentifiers.ICE:
      case ObjectIdentifiers.ICE_2:
      case ObjectIdentifiers.ICE_3:
      case ObjectIdentifiers.ICE_4:
      case ObjectIdentifiers.ICE_5:
      case ObjectIdentifiers.ICE_6:
      case ObjectIdentifiers.ICE_7:
      case ObjectIdentifiers.ICE_8:
      case ObjectIdentifiers.ICE_9:
        destination = new Location(2666, 4068, 1);
        break;
      case ObjectIdentifiers.SNOW_JUMP:
      case ObjectIdentifiers.SNOW_JUMP_2:
        destination = new Location(2656, 4039, 1);
        break;
      default:
        return;
    }
    player.moveTo(destination);
  }

  // ==========================================================================
  // NPC Talk-to handlers
  // ==========================================================================

  function talkPenguin(event) {
    const { player, npcId } = event;
    const baseId = event.npc?.getId?.() ?? npcId;
    if (!PENGUIN_NPC_IDS.has(npcId) && !PENGUIN_NPC_IDS.has(baseId)) return false;
    if (!isZooPenguinLocation(event)) {
      if (inSuit(player)) {
        startTranscript(api, player, npcId, PAGE, "finding-the-outpost-asking-the-penguin-again");
      } else {
        startTranscript(api, player, npcId, PAGE, "extras-attempting-to-speak-to-sheep-as-a-human");
      }
      return;
    }
    if (!inSuit(player)) {
      startTranscript(api, player, npcId, PAGE, "extras-attempting-to-speak-to-sheep-as-a-human");
      return;
    }
    const stage = stageOf(player);
    if (!player.getAttribute(ZOO_GREETED_ATTRIBUTE) && stage >= STAGE_ZOO_TEST && stage <= STAGE_ZOO_REPORT) {
      startTranscript(api, player, npcId, PAGE, "testing-the-suit-at-the-zoo-entering-the-cage-as-a-penguin", (steps) => selectUpTo(steps, "gf-bpU"));
      return;
    }
    if (stage >= STAGE_PHRASE_HINT && stage < STAGE_PHRASE) {
      player.setAttribute(PHRASE_ATTEMPTED_ATTRIBUTE, true);
      startTranscript(api, player, npcId, PAGE, "finding-the-outpost-asking-the-zoo-penguin-the-phrase");
      return;
    }
    startTranscript(api, player, npcId, PAGE, "finding-the-outpost-asking-the-penguin-again");
  }

  function talkSheep(event) {
    const { player, npcId } = event;
    if ((event.npc?.getId?.() ?? npcId) !== SHEEP) return false;
    const location = event.npc?.getLocation?.() ?? event.location;
    if (location && (location.getX() < 3175 || location.getX() > 3210 || location.getY() < 3250 || location.getY() > 3290)) {
      return false;
    }
    // Before Cold War, The Thing is Sheep Shearer's sheep: live answers with its own page,
    // "That's a sheep...I think. I can't talk to sheep." (2026-11-06 capture, Cold War unstarted).
    if (stageOf(player) === 0) return false;
    if (!inSuit(player)) {
      startTranscript(api, player, npcId, PAGE, "extras-attempting-to-speak-to-sheep-as-a-human");
      return;
    }
    const stage = stageOf(player);
    if (stage < STAGE_LUMBRIDGE) return false;
    if (stage === STAGE_LUMBRIDGE) {
      startTranscript(api, player, npcId, PAGE, "finding-the-outpost-greeting-the-sheep", (steps) => selectUpTo(steps, "aLnwgb"));
      return;
    }
    if (stage === STAGE_SHEEP_GREETED || stage === STAGE_PHRASE_HINT) {
      startTranscript(api, player, npcId, PAGE, "finding-the-outpost-greeting-the-sheep", (steps) => selectBranch(steps, "zFthiI"));
      return;
    }
    if (stage === STAGE_PHRASE) {
      setStage(player, STAGE_SHEEP_TASK);
      startTranscript(api, player, npcId, PAGE, "finding-the-outpost-returning-to-the-sheep-with-the-phrase");
      return;
    }
    if (stage === STAGE_SHEEP_TASK && player.getAttribute(FARMER_ATTRIBUTE)) {
      startTranscript(api, player, npcId, PAGE, "finding-the-outpost-reporting-back-to-the-sheep");
      return;
    }
    if (stage >= STAGE_FRED_DONE) {
      startTranscript(api, player, npcId, PAGE, "finding-the-outpost-reporting-back-to-the-sheep");
      return;
    }
    startTranscript(api, player, npcId, PAGE, "finding-the-outpost-greeting-the-sheep", (steps) => selectBranch(steps, "zFthiI"));
  }

  function talkFred(event) {
    const { player, npcId } = event;
    if ((event.npc?.getId?.() ?? npcId) !== FRED) return false;
    const stage = stageOf(player);
    if (stage < STAGE_SHEEP_TASK || stage >= STAGE_OUTPOST_KNOWN) return false;
    startTranscript(api, player, npcId, PAGE, "finding-the-outpost-speaking-with-fred");
  }

  function talkKgp(event) {
    const { player, npcId } = event;
    const location = event.npc?.getLocation?.() ?? event.location;
    if (!location) return false;
    const stage = stageOf(player);
    if (stage < STAGE_ENTRY) return false;

    if (location.getZ() === 1) {
      if (!inSuit(player)) {
        startTranscript(api, player, npcId, PAGE, "extras-when-caught-as-a-human-at-the-iceberg");
        return;
      }
      if (stage >= STAGE_ID) {
        startTranscript(api, player, npcId, PAGE, "entering-the-outpost-obtaining-entry-permission");
        return;
      }
      if (player.getAttribute(KGP_GREETED_ATTRIBUTE) === true) {
        if (stage < STAGE_ASK_ID) setStage(player, STAGE_ASK_ID);
        startTranscript(api, player, npcId, PAGE, "entering-the-outpost-in-front-of-the-entrance", (steps) => selectBranch(steps, "yOzRyk"));
        return;
      }
      startTranscript(api, player, npcId, PAGE, "entering-the-outpost-in-front-of-the-entrance", (steps) => selectUpTo(steps, "yhoAH1"));
      return;
    }

    if (location.getY() >= 10400) {
      if (stage >= STAGE_ARMY) {
        startTranscript(api, player, npcId, PAGE, "searching-for-the-secret-room-talking-to-the-agent-near-the-large-door");
        return;
      }
      return false;
    }

    if (stage >= STAGE_ENTERED) {
      if (stage >= STAGE_DEBRIEFED) {
        startTranscript(api, player, npcId, PAGE, "inside-the-outpost-debriefing", (steps) =>
          steps.filter((step) => step?.id !== "HeyQcq")
        );
        return;
      }
      startTranscript(api, player, npcId, PAGE, "inside-the-outpost-debriefing");
      return;
    }
    return false;
  }

  function talkNoodle(event) {
    const { player, npcId } = event;
    const stage = stageOf(player);
    if (stage < STAGE_ENTRY) return false;
    if (!player.getAttribute(NOODLE_ASKED_ATTRIBUTE)) {
      player.setAttribute(NOODLE_ASKED_ATTRIBUTE, true);
      setStage(player, STAGE_TRADING);
      startTranscript(api, player, npcId, PAGE, "entering-the-outpost-obtaining-an-id-from-the-black-market");
      return;
    }
    if (stage >= STAGE_ID) {
      startTranscript(api, player, npcId, PAGE, "entering-the-outpost-trading-noodle-retrieving-lost-items");
      return;
    }
    startTranscript(api, player, npcId, PAGE, "entering-the-outpost-trading-noodle");
  }

  function talkPingPong(event) {
    const { player, npcId } = event;
    const stage = stageOf(player);
    if (stage < STAGE_ENTRY) return false;
    if (stage >= STAGE_BARDS_DONE) {
      startTranscript(api, player, npcId, PAGE, "searching-for-the-secret-room-asking-penguins-in-a-room-nearby-about-the-door-the-iceberg-s-history-song", selectBardsReplay);
      return;
    }
    if (stage < STAGE_ARMY) {
      startTranscript(api, player, npcId, PAGE, "searching-for-the-secret-room-asking-penguins-in-a-room-nearby-about-the-door");
      return;
    }
    if (stage === STAGE_ARMY) {
      setStage(player, STAGE_BARDS);
      startTranscript(api, player, npcId, PAGE, "searching-for-the-secret-room-asking-penguins-in-a-room-nearby-about-the-door");
      return;
    }
    if (hasItem(player, COWBELLS_ITEM) && hasItem(player, PENGUIN_BONGOS_ITEM)) {
      startTranscript(api, player, npcId, PAGE, "searching-for-the-secret-room-asking-penguins-in-a-room-nearby-about-the-door-the-iceberg-s-history-song", selectBardsSuccess);
      return;
    }
    startTranscript(api, player, npcId, PAGE, "searching-for-the-secret-room-asking-penguins-in-a-room-nearby-about-the-door-the-iceberg-s-history-song", selectBardsMissing);
  }

  function talkInstructor(event) {
    const { player, npcId } = event;
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) {
      startTranscript(api, player, npcId, "Agility Instructor", "after-cold-war");
      return;
    }
    if (stage < STAGE_DEBRIEFED) return false;
    if (stage < STAGE_COURSE) setStage(player, STAGE_COURSE);
    startTranscript(api, player, npcId, PAGE, "inside-the-outpost-finishing-the-agility-course");
  }

  function talkCommander(event) {
    const { player, npcId } = event;
    if (stageOf(player) < STAGE_COURSE) return false;
    startTranscript(api, player, npcId, PAGE, "inside-the-outpost-finishing-the-agility-course-speaking-with-the-army-commander-outside-the-course");
  }

  function talkCow(event) {
    const { player, npcId } = event;
    if ((event.npc?.getId?.() ?? npcId) !== ZANARIS_COW) return false;
    const stage = stageOf(player);
    if (stage < STAGE_BARDS || stage >= STAGE_BARDS_DONE) return false;
    if (hasItem(player, COWBELLS_ITEM)) return false;
    startTranscript(api, player, npcId, PAGE, "extras-stealing-a-cowbell-from-a-dairy-cow-in-zanaris");
  }

  // ==========================================================================
  // Combat / icelords
  // ==========================================================================

  function handleNpcDeath(event) {
    const player = event?.killer?.isPlayer?.() ? event.killer : null;
    if (!player || !ICELORD_NPC_IDS.has(event.npcId)) return;
    if (stageOf(player) < STAGE_CAUGHT) return;
    const kills = (Number(player.getAttribute(ICELORD_KILLS_ATTRIBUTE)) || 0) + 1;
    player.setAttribute(ICELORD_KILLS_ATTRIBUTE, kills);
    player.getSkillManager().addExperiences(Skill.ATTACK, 40);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, handle) {
    const stage = handle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Larry asked me to help him observe penguins on an iceberg.</str>",
        "<str>I built the bird hide, infiltrated the penguin outpost in a</str>",
        "<str>clockwork suit and discovered the penguin war plans.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_ESCAPED) {
      return [
        "<str>Larry and I uncovered the penguin war plans in their outpost.</str>",
        "<str>Pescaling Pax caught me, but I escaped the Ice Lord cage.</str>",
        "I should tell <col=800000>Larry</col> what I saw in the war room.",
      ];
    }
    if (stage >= STAGE_CAUGHT) {
      return [
        "<str>I slipped into the war room and saw the penguin war plans.</str>",
        "The <col=800000>Ice Lords</col> block my escape; defeat them and leave",
        "through the chasm to find Larry.",
      ];
    }
    if (stage >= STAGE_BARDS_DONE) {
      return [
        "<str>The penguin bards played their song and distracted the guard.</str>",
        "The guard left his booth. I should use the",
        "<col=800000>control panel</col> and get into the war room.",
      ];
    }
    if (stage >= STAGE_INSTRUMENTS) {
      return [
        "<str>Larry told me how to get the instruments for the bards.</str>",
        "Steal a <col=800000>cowbell</col> from a dairy cow and make",
        "<col=800000>penguin bongos</col> from a mahogany plank and leather.",
      ];
    }
    if (stage >= STAGE_BARDS) {
      return [
        "<str>Ping and Pong asked me for a cowbell and penguin bongos.</str>",
        "I should ask <col=800000>Larry</col> where to find them.",
      ];
    }
    if (stage >= STAGE_ARMY) {
      return [
        "<str>I passed the agility course and told Larry about the army.</str>",
        "Larry wants me to find the secret <col=800000>war room</col> deep",
        "in the glacier without arousing suspicion.",
      ];
    }
    if (stage >= STAGE_COURSE) {
      return [
        "<str>I was debriefed and passed the penguin agility course.</str>",
        "I should report what I saw to <col=800000>Larry</col> outside.",
      ];
    }
    if (stage >= STAGE_ENTERED) {
      return [
        "<str>I entered the penguin outpost under the avalanche.</str>",
        "Speak to the <col=800000>KGP Agent</col> in the room to the left,",
        "then complete the <col=800000>agility course</col>.",
      ];
    }
    if (stage >= STAGE_ID) {
      return [
        "<str>Noodle sold me a Kgp id card and a fake report.</str>",
        "The KGP Agent should let me through the avalanche now.",
      ];
    }
    if (stage >= STAGE_TRADING) {
      return [
        "<str>Larry says a black market penguin can get me an ID.</str>",
        "Trade <col=800000>Noodle</col> a swamp tar and five feathers.",
      ];
    }
    if (stage >= STAGE_ASK_ID) {
      return [
        "<str>The entrance guard wants an ID card before I can enter.</str>",
        "I should ask <col=800000>Larry</col> about getting one.",
      ];
    }
    if (stage >= STAGE_ENTRY) {
      return [
        "<str>Larry brought me back to the iceberg entrance.</str>",
        "Tuxedo-time with Larry, give the guard the greeting and the",
        "password <col=800000>cabbage</col>, then enter the outpost.",
      ];
    }
    if (stage >= STAGE_OUTPOST_KNOWN) {
      return [
        "<str>The penguins' outpost is hidden under the avalanche on the iceberg.</str>",
        "Speak to <col=800000>Larry</col> so he can take me back.",
      ];
    }
    if (stage >= STAGE_FRED_DONE) {
      return [
        "<str>I asked Fred about the penguins and reported to the sheep.</str>",
        "The sheep told me where their outpost is; I should tell",
        "<col=800000>Larry</col>.",
      ];
    }
    if (stage >= STAGE_SHEEP_TASK) {
      return [
        "<str>The disguised sheep want me to investigate Fred the Farmer.</str>",
        "Talk to <col=800000>Fred</col> in the sheep field.",
      ];
    }
    if (stage >= STAGE_PHRASE) {
      return [
        "<str>The zoo penguin told me the secret phrase:</str>",
        "<str>'Do not trust the walrus'.</str>",
        "Return to the <col=800000>sheep</col> in Lumbridge with it.",
      ];
    }
    if (stage >= STAGE_PHRASE_HINT) {
      return [
        "<str>The penguins want a secret phrase before they will talk.</str>",
        "Ask the <col=800000>zoo penguin</col> for it (a raw cod or the",
        "Ring of Charos will help).",
      ];
    }
    if (stage >= STAGE_SHEEP_GREETED) {
      return [
        "<str>I gave the sheep the greeting, but they want a secret phrase.</str>",
        "Speak to <col=800000>Larry</col> about it.",
      ];
    }
    if (stage >= STAGE_LUMBRIDGE) {
      return [
        "<str>The zoo penguin gave me his report for the outpost.</str>",
        "Meet <col=800000>Larry</col> at the Lumbridge sheep field and",
        "tuxedo-up to question the penguins there.",
      ];
    }
    if (stage >= STAGE_ZOO_REPORT) {
      return [
        "<str>I earned the zoo penguin's trust and got his mission report.</str>",
        "I should speak to <col=800000>Larry</col> at the zoo.",
      ];
    }
    if (stage >= STAGE_ZOO_TEST) {
      return [
        "<str>The penguins destroyed the bird hide, so we went back to the zoo.</str>",
        "Tuxedo-time with <col=800000>Larry</col> to test the penguin suit",
        "on the zoo penguins.",
      ];
    }
    if (stage >= STAGE_SUIT) {
      return [
        "<str>I built the clockwork penguin suit.</str>",
        "Take it to <col=800000>Larry</col> and return to the iceberg.",
      ];
    }
    if (stage >= STAGE_PLANNED) {
      return [
        "<str>Larry gave me his clockwork book with the suit designs.</str>",
        "Gather a plank, a piece of silk and a clockwork mechanism and",
        "make the suit.",
      ];
    }
    if (stage >= STAGE_OBSERVED) {
      return [
        "<str>Larry and I watched the penguins from the bird hide.</str>",
        "Larry is convinced they are up to something. Speak to him.",
      ];
    }
    if (stage >= STAGE_HIDE_COVERED) {
      return [
        "<str>I built and covered the bird hide on the iceberg.</str>",
        "Speak to <col=800000>Larry</col> to start observing the penguins.",
      ];
    }
    if (stage >= STAGE_HIDE_BUILT) {
      return [
        "<str>I built the bird hide structure on the iceberg.</str>",
        "Use a <col=800000>spade</col> on it to cover it in snow.",
      ];
    }
    if (stage >= STAGE_MATERIALS) {
      return [
        "<str>Larry teleported us to the iceberg.</str>",
        "Use the <col=800000>oak planks</col> on the patch of snow to",
        "build the bird hide.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>Larry asked me to help him observe penguins.</str>",
        "Gather 10 <col=800000>oak planks</col>, 10 <col=800000>steel nails</col>,",
        "a <col=800000>hammer</col> and a <col=800000>spade</col>,",
        "then meet him east of Rellekka.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Larry</col>",
      "at the <col=800000>Ardougne Zoo</col>.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.AGILITY, 5000);
    skills.addExperiences(Skill.CRAFTING, 2000);
    skills.addExperiences(Skill.CONSTRUCTION, 1500);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(HIDE_ATTRIBUTE);
  api.persistAttribute(FARMER_ATTRIBUTE);
  api.persistAttribute(GREETING_ATTRIBUTE);
  api.persistAttribute(GREETING_PROGRESS_ATTRIBUTE);
  api.persistAttribute(SUIT_ATTRIBUTE);
  api.persistAttribute(SUIT_EVER_ATTRIBUTE);
  api.persistAttribute(OBSERVED_TALKED_ATTRIBUTE);
  api.persistAttribute(PHRASE_ATTEMPTED_ATTRIBUTE);
  api.persistAttribute(ZOO_GREETED_ATTRIBUTE);
  api.persistAttribute(SHEEP_GREETED_ATTRIBUTE);
  api.persistAttribute(KGP_GREETED_ATTRIBUTE);
  api.persistAttribute(NOODLE_ASKED_ATTRIBUTE);
  api.persistAttribute(KGP_ATTRIBUTE);
  api.persistAttribute(DWARF_FLY_ATTRIBUTE);
  api.persistAttribute(BALLOON_FLY_ATTRIBUTE);
  api.persistAttribute(ICELORD_KILLS_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "cold_war",
    name: "Cold War",
    varpId: VARP_COLD_WAR,
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.AGILITY.getIndex(), amount: 5000, label: "Agility" },
      { skillId: Skill.CRAFTING.getIndex(), amount: 2000, label: "Crafting" },
      { skillId: Skill.CONSTRUCTION.getIndex(), amount: 1500, label: "Construction" },
    ],
    otherRewards: [
      "The ability to make penguin suits",
      "The ability to use the penguin agility course",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectLarryVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction(handleItemAction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcInteraction("Larry", { "Tuxedo-time": handleLarryTuxedo, Travel: handleLarryTravel });
  api.onNpcInteraction("Penguin", { "Talk-to": talkPenguin });
  api.onNpcInteraction("Sheep", { "Talk-to": talkSheep });
  api.onNpcInteraction("Fred the Farmer", { "Talk-to": talkFred });
  api.onNpcInteraction("KGP Agent", { "Talk-to": talkKgp });
  api.onNpcInteraction("Noodle", { "Talk-to": talkNoodle });
  api.onNpcInteraction("Ping", { "Talk-to": talkPingPong });
  api.onNpcInteraction("Pong", { "Talk-to": talkPingPong });
  api.onNpcInteraction("Agility Instructor", { "Talk-to": talkInstructor });
  api.onNpcInteraction("Army Commander", { "Talk-to": talkCommander });
  api.onNpcInteraction("Cow", { "Talk-to": talkCow });
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);

  // ==========================================================================
  // Larry option handlers
  // ==========================================================================

  function handleLarryTuxedo(event) {
    const { player, npcId } = event;
    const stage = stageOf(player);
    if (stage < STAGE_ZOO_TEST) return false;
    if (inSuit(player)) {
      startTranscript(api, player, npcId, PAGE, "testing-the-suit-at-the-zoo-speaking-to-larry-at-ardougne-zoo-using-larry-s-tuxedo-time-while-in-the-suit");
      return;
    }
    const suitStory = player.getAttribute(SUIT_EVER_ATTRIBUTE) === true;
    startTranscript(api, player, npcId, PAGE, "testing-the-suit-at-the-zoo-speaking-to-larry-at-ardougne-zoo", (steps) =>
      suitStory ? selectFromCondition(steps, "1ot_FT") : steps
    );
    return;
  }

  function handleLarryTravel(event) {
    const { player, npcId } = event;
    const stage = stageOf(player);
    if (stage < STAGE_MATERIALS) return false;
    if (npcId === LARRY_RELLEKKA) {
      player.moveTo(ICEBERG_LANDING);
      return;
    }
    if (npcId === LARRY_ICEBERG) {
      player.moveTo(RELLEKKA_PIER);
    }
  }
};
