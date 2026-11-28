/**
 * At First Light (members).
 *
 * Behaviour follows the user's revision 243 capture of the whole quest (AtFirstLight.bin)
 * and RSProx recording 1695 (revision 226, ticks 5134-5763); the words come from the
 * "At First Light" transcript page with that capture's wording. Evidence and remaining
 * gaps: docs/quests/at-first-light/README.md.
 *
 * Fox is two world NPCs, as live spawns him: the injured afl_hunter_fox_multi (13400) by the
 * Locus Oasis, which each player's client shows as 12932 at stages 4-10, and
 * afl_hunter_fox_normal (13422) by the Hunter Guild, shown as 13426 from stage 11
 * (npc-spawns.json). Neither is spawned per player.
 *
 * Stage lives in varbit 9835 "afl" (varp 4151, bits 0-4), as captured:
 *   1 started               7 Fox asked for the sample to go to Atza
 *   2 Verity named Wolf     8 Atza has the sample
 *   3 Wolf lent the mouse   9 Atza gave the trimmed fur
 *   4 Wolf's pyre fox hint 10 Fox gave his report
 *   5 found Fox (the cache's bushes offer Pick only here)
 *   6 Fox has the poultice 11 Kiko's bed repaired, 12 complete
 * The sibling varbits on varp 4151 are mirrored as captured: afl_report 9836 (report handed
 * to Verity), afl_bedcheck 9837, afl_bedrepair 9838, afl_catdistract 9839, afl_housetrapped
 * 9840 (1 asked to assemble the pile, 2 assembled), afl_mastermet 9841 (met Apatura: set at
 * the first meeting, before the quest), afl_sampletaken 9842, afl_mousetaken 9843 and
 * afl_wolf_dialogue 9995 (told Wolf about Fox).
 *
 * Saves from the old 1-12 model (bed check at 4, report delivered at 11) are mapped once.
 * Rewards per the capture: 1 Quest point, 4,500 Hunter, 800 Construction and 500 Herblore
 * XP, and access to Master Tier Hunters' Rumours.
 */
module.exports = function registerAtFirstLightQuest(api) {
  const {
    Animation, CountdownTask, DialogueChainBuilder, Equipment, ItemStatementDialogue, NpcDefinition, ObjectDefinition,
    Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, TaskManager,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, loadTranscripts, questStartMessage, giveReward } = require("../QuestRuntime");

  const VARP_AT_FIRST_LIGHT = 4151;
  const STAGE_VARBIT = 9835;

  const PAGE = "At First Light";
  const START_HOOK = "quest:at-first-light:start";

  const STAGE_STARTED = 1;
  const STAGE_VERITY = 2;
  const STAGE_MOUSE = 3;
  const STAGE_PYRE_FOXES = 4;
  const STAGE_FOX_FOUND = 5;
  const STAGE_POULTICE = 6;
  const STAGE_SAMPLE = 7;
  const STAGE_SAMPLE_GIVEN = 8;
  const STAGE_TRIMMED_FUR = 9;
  const STAGE_REPORT = 10;
  const STAGE_BED_REPAIRED = 11;
  const STAGE_COMPLETE = 12;

  /** Sibling varbits of varp 4151: [varbit, first bit, width]. */
  const VARS = {
    report: [9836, 5, 1],
    bedCheck: [9837, 6, 1],
    bedRepair: [9838, 7, 1],
    catDistract: [9839, 8, 1],
    housetrapped: [9840, 9, 2],
    masterMet: [9841, 11, 1],
    sampleTaken: [9842, 12, 1],
    mouseTaken: [9843, 13, 1],
    wolfDialogue: [9995, 14, 1],
  };

  const APATURA_NPC_ID = NpcIdentifiers.GUILDMASTER_APATURA; // 13120
  const WOLF_NPC_ID = NpcIdentifiers.GUILD_HUNTER_WOLF_MASTER_; // 13126
  const VERITY_NPC_ID = NpcIdentifiers.GUILD_SCRIBE_VERITY; // 13127
  const KIKO_NPC_ID = NpcIdentifiers.GUILD_HUNTER_KIKO; // 12934
  const ATZA_NPC_ID = NpcIdentifiers.ATZA; // 12933
  const FOX_NPC_ID = NpcIdentifiers.GUILD_HUNTER_FOX; // 12932, the injured Fox
  const APATURA_NPC_NAME = "Guildmaster Apatura";
  const ATZA_NPC_NAME = "Atza";
  const KIKO_NPC_NAME = "Guild Hunter Kiko";
  const VERITY_NPC_NAME = "Guild Scribe Verity";
  const WOLF_NPC_NAME = "Guild Hunter Wolf (Master)";

  const TOY_MOUSE_ITEM_ID = ItemIdentifiers.TOY_MOUSE; // 7767
  const WOUND_TOY_MOUSE_ITEM_ID = ItemIdentifiers.TOY_MOUSE_WOUND_; // 7769
  const SMOOTH_LEAF_ITEM_ID = ItemIdentifiers.SMOOTH_LEAF; // 28978
  const STICKY_LEAF_ITEM_ID = ItemIdentifiers.STICKY_LEAF; // 28979
  const MAKESHIFT_POULTICE_ITEM_ID = ItemIdentifiers.MAKESHIFT_POULTICE; // 28980
  const FUR_SAMPLE_ITEM_ID = ItemIdentifiers.FUR_SAMPLE; // 28981
  const TRIMMED_FUR_ITEM_ID = ItemIdentifiers.TRIMMED_FUR; // 28982
  const FOXS_REPORT_ITEM_ID = ItemIdentifiers.FOXS_REPORT; // 28983
  const JERBOA_TAIL_ITEM_ID = ItemIdentifiers.JERBOA_TAIL; // 29166
  const HAMMER_ITEM_IDS = [
    ItemIdentifiers.HAMMER, // 2347
    ItemIdentifiers.IMCANDO_HAMMER, // 25644
    ItemIdentifiers.IMCANDO_HAMMER_OFF_HAND_, // 29775
  ];
  const NEEDLE_ITEM_ID = ItemIdentifiers.NEEDLE; // 1733
  const COSTUME_NEEDLE_ITEM_ID = ItemIdentifiers.COSTUME_NEEDLE; // 29920
  const CATSPEAK_AMULET_ITEM_IDS = [
    ItemIdentifiers.CATSPEAK_AMULET, // 4677
    ItemIdentifiers.CATSPEAK_AMULET_E_, // 6544
    ItemIdentifiers.CATSPEAK_AMULET_2, // 17002
    ItemIdentifiers.CATSPEAK_AMULET_E__2, // 17040
  ];

  // Loc 53011 "Cat bed" (Check), 53012 the no-op sibling at stage 11+.
  const CAT_BED_CHECK_OBJECT_ID = ObjectIdentifiers.CAT_BED; // 53011
  const CAT_BED_NOOP_OBJECT_ID = ObjectIdentifiers.CAT_BED_2; // 53012
  const LEAFY_BUSH_PICK_OBJECT_ID = ObjectIdentifiers.LEAFY_BUSH; // 53020
  const ROUGH_BUSH_PICK_OBJECT_ID = ObjectIdentifiers.ROUGH_LOOKING_BUSH; // 53022
  const EQUIPMENT_SETUP_OBJECT_ID = ObjectIdentifiers.PILE_OF_EQUIPMENT_2; // 50880

  // Captured animations, sounds and timings (revision 243 capture ticks in brackets).
  const PICK_ANIMATION = 10094; // picking_low_short [603]
  const PICK_SOUND = 2581; // pick, delay 15, a tick after the animation [604]
  const PICK_SOUND_DELAY = 15;
  const POULTICE_ANIMATION = 10097; // human_grind [712]
  const POULTICE_SOUND = 2608; // grind, delay 25 [712]
  const POULTICE_SOUND_DELAY = 25;
  const ASSEMBLE_ANIMATION = 3676; // human_poh_build, delay 10 [1012, 1019, 1026]
  const ASSEMBLE_SOUND = 938; // poh_build_wood, delay 10, with each build animation
  const ASSEMBLE_DELAY = 10;
  const REPAIR_ANIMATION = 10794; // human_crafting [1251]
  const REPAIR_SOUND = 2591; // stiching [1251]
  const PET_ANIMATION = 827; // human_pickupfloor, on every Pet [326, 343, 385, 872, 1242]
  const ATZA_CRYING_SOUND = 3424; // tol_homonculus_crying on Atza's chores line [992]
  const REPAIR_CRAFTING_XP = 10;
  const PICK_TICKS = 2;
  const ASSEMBLE_LINE_TICKS = 2;

  const VARS_ATTRIBUTE = "at-first-light:vars";
  const STAGE_VERSION_ATTRIBUTE = "at-first-light:stage-version";
  const OLD_FLAGS_ATTRIBUTE = "quest.at_first_light.flags";
  const STAGE_VERSION = 1;

  // "If the player has no inventory space:" and its friends.
  const NO_SPACE_CONDITION_IDS = new Set(["e8Gw-V", "nG-8od", "I-q-Xd", "6bjit4", "44YziC", "etZ1L7"]);

  // Item boxes the capture shows for the page's message steps.
  const MESSAGE_BOXES = {
    NIGwV0: TOY_MOUSE_ITEM_ID, FAtnvh: TOY_MOUSE_ITEM_ID,
    "EU-hSW": MAKESHIFT_POULTICE_ITEM_ID,
    PGRj0H: FUR_SAMPLE_ITEM_ID, rc_N8o: FUR_SAMPLE_ITEM_ID, "-cQ3L8": FUR_SAMPLE_ITEM_ID,
    "a-lgm5": FUR_SAMPLE_ITEM_ID,
    CTBIaF: TRIMMED_FUR_ITEM_ID, KG819o: TRIMMED_FUR_ITEM_ID, DbDMlx: TRIMMED_FUR_ITEM_ID,
    L7f8Yj: FOXS_REPORT_ITEM_ID, LUIK9t: FOXS_REPORT_ITEM_ID,
    qTFJ7n: FOXS_REPORT_ITEM_ID,
    akPfwh: MAKESHIFT_POULTICE_ITEM_ID,
  };
  /** Text-only message boxes (g3koUf: the bed checked again, capture tick 871). */
  const STATEMENTS = new Set(["MdlNBh", "LNk3X1", "fZnlnI", "AFxMNH", "oSl9ut", "g3koUf"]);

  const VERITY_LEAD_LINE = "If anyone did, it would've been Wolf. She's always getting Fox into some kind of trouble.";
  const WOLF_MOUSE_LINE = "He's very easy to distract. We have a little fake mouse we use sometimes.";
  const WOLF_PYRE_LINE = "He'll have stopped off for a bit of hunting first. There are some pyre foxes about halfway between here and the Locus Oasis that he was eyeing up. I bet that's where you'll find him.";
  const FOX_TRAPS_LINE = "Don't forget... your traps for the jerboa... they're boxy...";
  const FOX_SAMPLE_LINE = "Well, it's your lucky day! Take this sample to a woman called Atza in Outer Fortis. She'll have exactly what we need.";
  const ATZA_PILE_LINE = "It's all in that pile on the floor there. You can work it out, I'm sure.";
  const ATZA_CHORES_LINE = "Oh... Fox usually helps me with my chores when he visits.";
  // The player's lines during the pile: once each is continued, the build animation and
  // sound play and Atza answers two ticks later (capture ticks 1017-1028).
  const ASSEMBLE_LINES = new Set(["Well, he actually got attacked on his way over here.", "Oh he'll be alright. He was on the mend when I left him."]);
  // The player's captured chathead animations by conversation NPC (per NPC: the shared table keys by text alone).
  const PLAYER_EXPRESSIONS = require("../data/at-first-light-player-expressions.json").npcs;
  const APATURA_MET_LINE ="Well, I'm Apatura. Let me welcome you to our small corner of Varlamore.";
  const WOLF_FOX_FOUND_LINES = new Set([
    "I've found Fox. He's been injured by something out in the savannah.",
    "I've found Fox. He's been injured by something out in the savannah, but he's doing okay. He's got me doing a few things for him whilst he recuperates.",
  ]);
  const ASSEMBLED_LINE = "All done!";
  const APATURA_DONE_LINE = "Actually... I think I'll just read the report.";

  const playerTasks = new WeakMap();
  /** Players with a pick under way: a second click can't start another (a dropped leaf isn't held). */
  const picking = new WeakSet();
  let quest;

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const hasTool = (player, itemIds) => itemIds.some((itemId) => held(player, itemId)) ||
    [Equipment.WEAPON_SLOT, Equipment.SHIELD_SLOT].some((slot) => itemIds.includes(player.getEquipment().get(slot)?.getId?.()));
  const inventoryFull = (player) => player.getInventory().isFull();
  const holdsMouse = (player) => held(player, TOY_MOUSE_ITEM_ID) || held(player, WOUND_TOY_MOUSE_ITEM_ID);

  function packed(player) {
    return Number(player.getAttribute(VARS_ATTRIBUTE)) || 0;
  }

  function sub(player, name) {
    const [, shift, width] = VARS[name];
    return (packed(player) >>> shift) & ((1 << width) - 1);
  }

  function setSub(player, name, value) {
    const [varbit, shift, width] = VARS[name];
    const mask = ((1 << width) - 1) << shift;
    player.setAttribute(VARS_ATTRIBUTE, ((packed(player) & ~mask) | ((value << shift) & mask)) >>> 0);
    player.getPacketSender().sendVarbit(varbit, value);
  }

  function stageOf(player) {
    return quest.getStage(player);
  }

  function later(player, ticks, callback) {
    let key = playerTasks.get(player);
    if (!key) { key = {}; playerTasks.set(player, key); }
    TaskManager.submit(new CountdownTask(key, ticks, () => {
      if (player.isRegistered?.() !== false) callback();
    }));
  }

  function isQuestComplete(player, key) {
    const request = { player, key };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    return (
      skills.getMaxLevel(Skill.HUNTER) >= 46 &&
      skills.getMaxLevel(Skill.HERBLORE) >= 30 &&
      skills.getMaxLevel(Skill.CONSTRUCTION) >= 27 &&
      isQuestComplete(player, "children_of_the_sun") &&
      isQuestComplete(player, "eagles_peak")
    );
  }

  function hasCatspeakAmulet(player) {
    if (CATSPEAK_AMULET_ITEM_IDS.some((itemId) => held(player, itemId))) return true;
    const amulet = player.getEquipment().get(Equipment.AMULET_SLOT);
    return CATSPEAK_AMULET_ITEM_IDS.includes(amulet?.getId?.());
  }

  function understandsCats(player) {
    return hasCatspeakAmulet(player) || isQuestComplete(player, "dragon_slayer_ii");
  }

  /** Whether Verity has explained the rumours (skills/hunter/Rumours.Hunter.js owns that state). */
  function verityIntroduced(player, done = false) {
    const request = { player, done };
    api.emitCustomEvent("hunter:verity-introduction", request);
    return request.introduced === true;
  }

  function canRepairBed(player) {
    return (
      held(player, TRIMMED_FUR_ITEM_ID) &&
      held(player, JERBOA_TAIL_ITEM_ID) &&
      (held(player, NEEDLE_ITEM_ID) || held(player, COSTUME_NEEDLE_ITEM_ID))
    );
  }

  /** Advances the stage without ever regressing. */
  function advance(player, stage) {
    if (stageOf(player) >= stage) return;
    quest.setStage(player, stage);
  }

  function take(player, itemId) {
    if (held(player, itemId)) player.getInventory().deleteNumber(itemId, 1);
  }

  function give(player, itemId) {
    if (!held(player, itemId) && !inventoryFull(player)) player.getInventory().adds(itemId, 1);
  }

  // ==========================================================================
  // Variant selection
  // ==========================================================================

  function selectVariant({ npcId, player }) {
    if (!player) return null;
    if (npcId === APATURA_NPC_ID) return selectApaturaVariant(player);
    if (npcId === VERITY_NPC_ID) return selectVerityVariant(player);
    if (npcId === WOLF_NPC_ID) return selectWolfVariant(player);
    if (npcId === FOX_NPC_ID) return selectFoxVariant(player);
    return null;
  }

  function selectApaturaVariant(player) {
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) return null; // her standard-dialogue-subsequent-dialogue
    if (stage >= STAGE_BED_REPAIRED) return sub(player, "report") === 1 ? "finishing-up-talking-to-apatura" : null;
    if (stage >= STAGE_POULTICE) return "fox-tracking-talking-to-guildmaster-apatura-after-giving-guild-hunter-fox-the-poultice";
    if (stage >= STAGE_FOX_FOUND) return "fox-tracking-talking-to-guildmaster-apatura-after-finding-guild-hunter-fox";
    if (stage >= STAGE_PYRE_FOXES || sub(player, "bedCheck") === 1) return "a-missing-fox-talking-to-guildmaster-apatura-after-checking-the-cat-bed";
    if (stage >= STAGE_VERITY) return "a-missing-fox-talking-to-guildmaster-apatura-after-talking-to-verity";
    if (stage >= STAGE_STARTED) return "a-missing-fox-talking-to-guildmaster-apatura-talking-to-apatura-again";
    return "a-missing-fox-talking-to-guildmaster-apatura";
  }

  function selectVerityVariant(player) {
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) return null; // her standard-dialogue
    if (sub(player, "report") === 1) {
      return sub(player, "bedRepair") === 1
        ? "finishing-up-talking-to-guild-scribe-verity-after-repairing-the-bed"
        : "finishing-up-talking-to-verity-before-repairing-the-bed";
    }
    if (stage >= STAGE_REPORT) return held(player, FOXS_REPORT_ITEM_ID) ? "finishing-up-talking-to-verity" : null;
    if (stage >= STAGE_POULTICE) return "fox-tracking-talking-to-guild-scribe-verity-after-giving-fox-the-poultice";
    if (stage >= STAGE_FOX_FOUND) return "fox-tracking-talking-to-guild-scribe-verity-after-talking-to-fox";
    if (stage >= STAGE_MOUSE) return "a-missing-fox-talking-to-verity-after-speaking-to-wolf";
    if (stage >= STAGE_VERITY) return "a-missing-fox-talking-to-guild-scribe-verity-talking-to-verity-again";
    if (stage >= STAGE_STARTED) return "a-missing-fox-talking-to-guild-scribe-verity";
    return null;
  }

  function selectWolfVariant(player) {
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) {
      return { page: "Guild Hunter Wolf (Master)", variant: "standard-dialogue-after-talking-to-verity" };
    }
    if (sub(player, "report") === 1 || stage >= STAGE_BED_REPAIRED) {
      return sub(player, "bedRepair") === 1
        ? "finishing-up-talking-to-guild-hunter-wolf-after-repairing-the-bed"
        : "finishing-up-talking-to-guild-hunter-wolf-after-turning-in-the-report";
    }
    // afl_wolf_dialogue: whether the player has told Wolf about Fox. Never having done so,
    // the first talk after the poultice is the capture's single line (ticks 860-861).
    if (stage >= STAGE_POULTICE) {
      return sub(player, "wolfDialogue") === 1
        ? "fox-tracking-talking-to-guild-hunter-wolf-after-giving-fox-the-poultice"
        : "fox-tracking-talking-to-guild-hunter-wolf-for-the-first-time-after-giving-fox-the-poultice";
    }
    if (stage >= STAGE_FOX_FOUND) return "fox-tracking-talking-to-guild-hunter-wolf-after-talking-to-fox";
    if (stage >= STAGE_PYRE_FOXES) return "a-missing-fox-talking-to-wolf-after-inspecting-the-cat-bed-talking-to-wolf-again";
    if (stage === STAGE_MOUSE && sub(player, "bedCheck") === 1) return "a-missing-fox-talking-to-wolf-after-inspecting-the-cat-bed";
    if (stage >= STAGE_MOUSE) return "a-missing-fox-talking-to-guild-hunter-wolf-talking-to-wolf-again";
    if (stage >= STAGE_VERITY) return "a-missing-fox-talking-to-guild-hunter-wolf";
    return null;
  }

  function selectFoxVariant(player) {
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) return null;
    if (sub(player, "report") === 1) return "finishing-up-talking-to-guild-hunter-fox-after-turning-in-the-report";
    if (stage >= STAGE_REPORT) return "fox-tracking-reading-fox-s-report-talking-to-fox-again";
    if (stage >= STAGE_TRIMMED_FUR) return "fox-tracking-talking-to-fox";
    if (stage >= STAGE_SAMPLE_GIVEN) return "fox-tracking-talking-to-fox-after-giving-atza-the-material";
    if (stage >= STAGE_SAMPLE) {
      return !held(player, FUR_SAMPLE_ITEM_ID) && !inventoryFull(player)
        ? "fox-tracking-talking-to-fox-before-getting-the-fur-sample-with-inventory-space"
        : "fox-tracking-talking-to-fox-before-getting-the-fur-sample-with-inventory-space-talking-to-fox-again";
    }
    if (stage >= STAGE_POULTICE) return "fox-tracking-talking-to-fox-with-the-makeshift-poultice";
    if (stage >= STAGE_FOX_FOUND) {
      return held(player, MAKESHIFT_POULTICE_ITEM_ID)
        ? "fox-tracking-talking-to-fox-with-the-makeshift-poultice"
        : "fox-tracking-talking-to-guild-hunter-fox-talking-to-fox-again";
    }
    return stage >= STAGE_PYRE_FOXES ? "fox-tracking-talking-to-guild-hunter-fox" : null;
  }

  /** After the poultice, the conversation picks up from Fox's recovery (the Wiki's "above"). */
  function fromRecovery(steps) {
    const index = steps.findIndex((step) => step.text === "Kuani! That's making a difference already.");
    return index >= 0 ? steps.slice(index) : steps;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function answerCondition({ player, stepId }) {
    const stage = stageOf(player);
    if (NO_SPACE_CONDITION_IDS.has(stepId)) return inventoryFull(player);
    switch (stepId) {
      case "X-9CI3": // does not meet the quest's requirements
        return !meetsRequirements(player);
      case "2AzwyN": // never talked to Verity: her rumours introduction not yet given (Hunter plugin)
        return !verityIntroduced(player);
      case "dgY8x-": // previously talked to Verity
        return verityIntroduced(player);
      case "iOxnjg": // space and has not yet gotten the mouse
        return !inventoryFull(player) && sub(player, "mouseTaken") === 0;
      case "SHkSHB": // has the toy mouse in their inventory
        return holdsMouse(player);
      case "vL-AZN": // lost the toy mouse
        return sub(player, "mouseTaken") === 1 && !holdsMouse(player) && sub(player, "catDistract") === 0;
      case "SdFoGP": // no catspeak amulet or Dragon Slayer II
        return !understandsCats(player);
      case "xAmw_A": // has a toy mouse (wound)
        return held(player, WOUND_TOY_MOUSE_ITEM_ID) || sub(player, "catDistract") === 1;
      case "c-avW4": // does not have a smooth leaf
        return !held(player, SMOOTH_LEAF_ITEM_ID);
      case "aXen1A": // already has a smooth leaf
        return held(player, SMOOTH_LEAF_ITEM_ID);
      case "khCtCH": // does not have a sticky leaf
        return !held(player, STICKY_LEAF_ITEM_ID);
      case "DM1ufw": // already has a sticky leaf
        return held(player, STICKY_LEAF_ITEM_ID);
      case "AW4lzO": // "I think I've got them both." while holding both leaves
        return held(player, SMOOTH_LEAF_ITEM_ID) && held(player, STICKY_LEAF_ITEM_ID);
      case "U7Wq-I": // ... without both leaves
        return !(held(player, SMOOTH_LEAF_ITEM_ID) && held(player, STICKY_LEAF_ITEM_ID));
      case "W8dord": // still has the fur sample, or full and not yet received
        return held(player, FUR_SAMPLE_ITEM_ID) || inventoryFull(player);
      case "XRTAlW": // lost the fur sample and has a full inventory
        return !held(player, FUR_SAMPLE_ITEM_ID) && inventoryFull(player);
      case "obG97l": // lost the fur sample
        return !held(player, FUR_SAMPLE_ITEM_ID);
      case "SVFxAS": // Atza: lost the sample
        return stage >= STAGE_SAMPLE && !held(player, FUR_SAMPLE_ITEM_ID);
      case "t0t5aX": // lost the trimmed fur
        return stage >= STAGE_TRIMMED_FUR && !held(player, TRIMMED_FUR_ITEM_ID) && sub(player, "bedRepair") === 0;
      case "zL_kax": // still has the trimmed fur
        return held(player, TRIMMED_FUR_ITEM_ID);
      case "z0q-oA": // lost Fox's report
        return stage >= STAGE_REPORT && sub(player, "report") === 0 && !held(player, FOXS_REPORT_ITEM_ID);
      case "PUZnFQ": // still has Fox's report
        return held(player, FOXS_REPORT_ITEM_ID);
      case "cAMLzj": // does not have the items to repair the bed
        return !canRepairBed(player);
      case "QfBega": // has the items to repair the bed
        return canRepairBed(player);
      default:
        return null;
    }
  }

  // ==========================================================================
  // Dialogue side effects
  // ==========================================================================

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== APATURA_NPC_ID || hook !== START_HOOK || stageOf(player) !== 0) return;
    player.setAttribute(VARS_ATTRIBUTE, 0); // a ::quest reset keeps stale flags otherwise
    player.setAttribute(STAGE_VERSION_ATTRIBUTE, STAGE_VERSION);
    advance(player, STAGE_STARTED);
    setSub(player, "masterMet", 1);
    player.sendMessage(questStartMessage(player, "At First Light"));
  }

  /** Line events fire as a run of lines is queued; captured changes as a line appears go in `before`. */
  function handleLine(event) {
    const { player, npcId, text } = event;
    if (typeof text !== "string") return;
    const at = (expected, action) => { if (text === expected) event.before = action; };
    const stage = stageOf(player);
    const own = PLAYER_EXPRESSIONS[npcId]?.[String(event.step?.player ?? "").replace(/\s+/g, " ").trim()];
    if (own !== undefined) event.expression = own;
    // Met Apatura: set as her second line appears, at the first meeting (capture tick 123).
    if (npcId === APATURA_NPC_ID && stage === 0) at(APATURA_MET_LINE, () => setSub(player, "masterMet", 1));
    // Her lead also closes the quest's first talk, whose explanation counts as the rumours introduction
    // (capture ticks 243-267, 1352). Marked here, after both "talked to Verity" branches have been answered.
    if (npcId === VERITY_NPC_ID && stage === STAGE_STARTED) at(VERITY_LEAD_LINE, () => {
      verityIntroduced(player, true);
      advance(player, STAGE_VERITY);
    });
    if (npcId === WOLF_NPC_ID) {
      if (stage === STAGE_VERITY) at(WOLF_MOUSE_LINE, () => advance(player, STAGE_MOUSE));
      if (stage === STAGE_MOUSE) at(WOLF_PYRE_LINE, () => advance(player, STAGE_PYRE_FOXES));
      // Told Wolf about Fox: set as the player's line appears (capture tick 860).
      if (stage >= STAGE_FOX_FOUND && WOLF_FOX_FOUND_LINES.has(text)) event.before = () => setSub(player, "wolfDialogue", 1);
    }
    if (npcId === FOX_NPC_ID) {
      if (stage === STAGE_PYRE_FOXES) at(FOX_TRAPS_LINE, () => advance(player, STAGE_FOX_FOUND));
      if (stage === STAGE_POULTICE) at(FOX_SAMPLE_LINE, () => advance(player, STAGE_SAMPLE));
    }
    if (npcId === ATZA_NPC_ID) {
      if (stage === STAGE_SAMPLE_GIVEN && sub(player, "housetrapped") === 0) at(ATZA_PILE_LINE, () => setSub(player, "housetrapped", 1));
      at(ATZA_CHORES_LINE, () => player.getPacketSender().sendSound(ATZA_CRYING_SOUND, 1, 0));
      if (stage === STAGE_SAMPLE_GIVEN && sub(player, "housetrapped") === 1 && ASSEMBLE_LINES.has(text)) {
        event.after = () => buildAnimation(player);
        event.pauseTicks = ASSEMBLE_LINE_TICKS;
      }
      at(ASSEMBLED_LINE, () => setSub(player, "housetrapped", 2));
    }
    if (npcId === APATURA_NPC_ID && stage === STAGE_BED_REPAIRED && text === APATURA_DONE_LINE) event.after = () => quest.complete(player);
  }

  /** One round of work on Atza's pile: the build animation with its sound. */
  function buildAnimation(player) {
    player.performAnimation(new Animation(ASSEMBLE_ANIMATION, ASSEMBLE_DELAY));
    player.getPacketSender().sendSound(ASSEMBLE_SOUND, 1, ASSEMBLE_DELAY);
  }

  function handleDialogueAction(event) {
    const { player, stepId } = event;
    if (event.kind === "message" && Object.hasOwn(MESSAGE_BOXES, stepId)) event.box = { items: [MESSAGE_BOXES[stepId]] };
    if (event.kind === "message" && STATEMENTS.has(stepId)) event.box = { statement: true };
    switch (stepId) {
      case "NIGwV0": // Wolf hands you a small toy mouse.
      case "FAtnvh":
        if (!holdsMouse(player)) give(player, TOY_MOUSE_ITEM_ID);
        setSub(player, "mouseTaken", 1);
        return;
      case "MdlNBh": // You check the cat's bed...
        take(player, WOUND_TOY_MOUSE_ITEM_ID);
        setSub(player, "catDistract", 1);
        setSub(player, "bedCheck", 1);
        return;
      case "LNk3X1": // Kiko happily starts playing with the toy mouse.
        take(player, WOUND_TOY_MOUSE_ITEM_ID);
        setSub(player, "catDistract", 1);
        return;
      case "EU-hSW": // You give the poultice to Fox.
        take(player, MAKESHIFT_POULTICE_ITEM_ID);
        advance(player, STAGE_POULTICE);
        return;
      case "PGRj0H": // Fox gives you a fur sample.
      case "rc_N8o":
      case "-cQ3L8":
        give(player, FUR_SAMPLE_ITEM_ID);
        setSub(player, "sampleTaken", 1);
        return;
      case "a-lgm5": // You give the fur sample to Atza.
        take(player, FUR_SAMPLE_ITEM_ID);
        advance(player, STAGE_SAMPLE_GIVEN);
        return;
      case "CTBIaF": // Atza gives you some trimmed fur.
      case "KG819o":
      case "DbDMlx":
        give(player, TRIMMED_FUR_ITEM_ID);
        advance(player, STAGE_TRIMMED_FUR);
        return;
      case "L7f8Yj": // Fox gives you a report.
      case "LUIK9t": // Fox writes up another report...
        give(player, FOXS_REPORT_ITEM_ID);
        if (stepId === "L7f8Yj") advance(player, STAGE_REPORT);
        return;
      case "qTFJ7n": // You give Fox's report to Guild Scribe Verity.
        take(player, FOXS_REPORT_ITEM_ID);
        setSub(player, "report", 1);
        return;
      case "fZnlnI": // You carefully fix up Kiko's bed: the varbits, then the items, animation and sound (tick 1251).
        setSub(player, "bedRepair", 1);
        advance(player, STAGE_BED_REPAIRED);
        take(player, TRIMMED_FUR_ITEM_ID);
        take(player, JERBOA_TAIL_ITEM_ID);
        player.performAnimation(new Animation(REPAIR_ANIMATION));
        player.getPacketSender().sendSound(REPAIR_SOUND, 1, 0);
        player.getSkillManager().addExperiences(Skill.CRAFTING, REPAIR_CRAFTING_XP);
        return;
      default:
        return;
    }
  }

  // ==========================================================================
  // NPCs: Kiko (Pet), Atza, Verity, Wolf and Fox. Verity and Wolf are claimed back from
  // Hunter.plugin.js's rumour Talk-to while the quest needs them (this plugin registers first).
  // ==========================================================================

  function handleAtzaTalk(event) {
    const { player, npcId } = event;
    if (npcId !== ATZA_NPC_ID) return;
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) {
      startTranscript(api, player, ATZA_NPC_ID, "Atza", "standard-dialogue-after-finishing-at-first-light");
    } else if (stage < STAGE_SAMPLE) {
      startTranscript(api, player, ATZA_NPC_ID, "Atza", "standard-dialogue-before-at-first-light");
    } else if (stage >= STAGE_TRIMMED_FUR) {
      // The "talking to Atza again" variant carries the imported guards: t0t5aX only
      // replaces the trimmed fur while the bed is unrepaired and zL_kax points the
      // player back to Fox. The unconditional hand-out (KG819o) would give a second
      // trimmed fur once the bed repair has eaten the first one.
      startTranscript(api, player, ATZA_NPC_ID, PAGE, "fox-tracking-talking-to-atza-after-setting-up-the-equipment-talking-to-atza-again");
    } else if (stage >= STAGE_SAMPLE_GIVEN) {
      const trapped = sub(player, "housetrapped");
      if (trapped === 2) {
        // The pile was assembled, but the trimmed fur hand-out never reached the
        // player (the conversation was cut short). Atza still has it to give.
        startTranscript(api, player, ATZA_NPC_ID, PAGE, "fox-tracking-talking-to-atza-after-setting-up-the-equipment");
        return;
      }
      // The sample is in Atza's hands, so she has asked for the pile: the pile object
      // only opens once housetrapped is 1, which the interrupted hand-in never set.
      if (trapped === 0) setSub(player, "housetrapped", 1);
      startTranscript(api, player, ATZA_NPC_ID, PAGE, "fox-tracking-talking-to-atza-after-she-asks-to-set-up-the-equipment");
    } else {
      startTranscript(api, player, ATZA_NPC_ID, PAGE, "fox-tracking-talking-to-atza");
    }
  }

  function handlePetKiko(event) {
    const { player, npcId } = event;
    if (npcId !== KIKO_NPC_ID) return;
    player.performAnimation(new Animation(PET_ANIMATION));
    const stage = stageOf(player);
    if (stage >= STAGE_MOUSE && stage < STAGE_COMPLETE) {
      startTranscript(api, player, KIKO_NPC_ID, PAGE, "a-missing-fox-petting-kiko");
      return;
    }
    startTranscript(api, player, KIKO_NPC_ID, "Guild Hunter Kiko",
      understandsCats(player) ? "petting-kiko-with-a-catspeak-amulet" : "petting-kiko-without-a-catspeak-amulet");
  }

  /**
   * Apatura before the quest. Her first meeting is the quest variant's own greeting; once met
   * (afl_mastermet) she opens with her page's "Nilsal, hunter." / "Nilsal, Apatura." instead,
   * and "What do you do here?" leads back to the other two options (capture ticks 120-174).
   */
  function handleApaturaTalk(event) {
    const { player } = event;
    if (event.npcId !== APATURA_NPC_ID || stageOf(player) !== 0) return false;
    // Another plugin's variant comes first (the Hunter cape's enhancement, Teleports.SkillCapes.js): leave it the talk.
    // This relies on items/ registering before quests/ (PluginManager sorts plugin paths), as the variant order does.
    const ours = selectApaturaVariant(player);
    const definition = event.definition ?? NpcDefinition.forId(APATURA_NPC_ID);
    const first = api.core.PluginManager.emitNpcDialogueVariant({ player, npc: event.npc ?? null, npcId: APATURA_NPC_ID, definition });
    if (first && first !== ours) return false;
    const met = sub(player, "masterMet") === 1;
    startTranscript(api, player, APATURA_NPC_ID, PAGE, ours, (steps) => beforeQuestTalk(steps, met));
    return true;
  }

  function beforeQuestTalk(steps, met) {
    const menuIndex = steps.findIndex((step) => step?.type === "choice");
    if (menuIndex < 0) return steps;
    const menu = steps[menuIndex];
    const asked = menu.options.find((option) => option.text === "What do you do here?");
    const others = menu.options.filter((option) => option !== asked);
    const again = { ...menu, options: others };
    const options = menu.options.map((option) => (option === asked ? { ...option, steps: [...option.steps, again] } : option));
    const greeting = met ? subsequentGreeting() : steps.slice(steps.findIndex((step) => step?.type !== "condition"), menuIndex);
    const conditions = steps.slice(0, menuIndex).filter((step) => step?.type === "condition");
    return [...conditions, ...greeting, { ...menu, options }, ...steps.slice(menuIndex + 1)];
  }

  /** Her page's opening once met: its first two lines, before the rumour conditions. */
  function subsequentGreeting() {
    const steps = loadTranscripts(api)?.["Guildmaster Apatura"]?.variants?.["standard-dialogue-subsequent-dialogue"] ?? [];
    return steps.slice(0, steps.findIndex((step) => step?.type === "condition"));
  }

  /** Hunter.plugin.js would otherwise answer with rumours; claim the quest's stages only. */
  function talkFor(npcId, select) {
    return (event) => {
      if (event.npcId !== npcId) return false;
      const variant = select(event.player);
      if (typeof variant !== "string") return false;
      startTranscript(api, event.player, npcId, PAGE, variant);
      return true;
    };
  }

  function handleFoxTalk(event) {
    const { player } = event;
    if (event.npcId !== FOX_NPC_ID) return false;
    const variant = selectFoxVariant(player);
    if (typeof variant !== "string") return false;
    event.handled = true;
    const recovered = variant === "fox-tracking-talking-to-fox-with-the-makeshift-poultice" && stageOf(player) >= STAGE_POULTICE;
    startTranscript(api, player, FOX_NPC_ID, PAGE, variant, recovered ? fromRecovery : undefined);
    return true;
  }

  // ==========================================================================
  // Objects
  // ==========================================================================

  /** The bushes: the pick, then the leaf two ticks on, in an item box. */
  function pickLeaf(player, itemId, message) {
    if (stageOf(player) !== STAGE_FOX_FOUND) return;
    if (held(player, itemId)) {
      startTranscript(api, player, FOX_NPC_ID, PAGE, itemId === SMOOTH_LEAF_ITEM_ID ? "fox-tracking-picking-the-leafy-bush" : "fox-tracking-picking-the-rough-looking-bush",
        (steps) => steps.filter((step) => step.type === "condition"));
      return;
    }
    if (picking.has(player)) return;
    picking.add(player);
    player.performAnimation(new Animation(PICK_ANIMATION));
    later(player, 1, () => player.getPacketSender().sendSound(PICK_SOUND, 1, PICK_SOUND_DELAY));
    later(player, PICK_TICKS, () => {
      picking.delete(player);
      if (held(player, itemId)) return;
      // Transcript:At First Light, both bush conditions' note "Goes to the ground with full inventory." (giveReward drops what won't fit).
      giveReward(player, itemId);
      player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, message)));
    });
  }

  function checkCatBed(player) {
    const stage = stageOf(player);
    if (stage < STAGE_MOUSE || stage > STAGE_REPORT) return;
    if (sub(player, "bedCheck") === 1) {
      startTranscript(api, player, KIKO_NPC_ID, PAGE, "a-missing-fox-using-a-wound-toy-mouse-on-kiko-or-the-cat-bed-checking-the-bed-again");
      return;
    }
    // A distracted Kiko lets the player straight at the bed, as captured.
    startTranscript(api, player, KIKO_NPC_ID, PAGE, "a-missing-fox-checking-the-cat-bed", sub(player, "catDistract") === 1
      ? (steps) => steps.flatMap((step) => (step.id === "xAmw_A" ? step.steps.filter((inner) => inner.type === "message") : [])) : undefined);
  }

  /** The pile: worked on while Atza chats (two ticks before her first line), as captured. */
  function setUpEquipment(player) {
    if (stageOf(player) !== STAGE_SAMPLE_GIVEN || sub(player, "housetrapped") !== 1) return;
    if (!hasTool(player, HAMMER_ITEM_IDS)) {
      startTranscript(api, player, ATZA_NPC_ID, PAGE, "fox-tracking-setting-up-the-pile-of-equipment-without-a-hammer");
      return;
    }
    buildAnimation(player);
    later(player, ASSEMBLE_LINE_TICKS, () => startTranscript(api, player, ATZA_NPC_ID, PAGE, "fox-tracking-setting-up-the-pile-of-equipment"));
  }

  function handleObjectInteraction(event) {
    const { player } = event;
    const definition = event.definition ?? ObjectDefinition.forPlayer(event.objectId, player);
    const resolvedId = definition?.id ?? event.objectId;
    const action = String((definition?.getActions?.() ?? [])[event.clickType - 1] ?? "");
    if (resolvedId === LEAFY_BUSH_PICK_OBJECT_ID && action === "Pick") {
      event.handled = true;
      pickLeaf(player, SMOOTH_LEAF_ITEM_ID, "You pull a smooth leaf off the bush.");
      return;
    }
    if (resolvedId === ROUGH_BUSH_PICK_OBJECT_ID && action === "Pick") {
      event.handled = true;
      pickLeaf(player, STICKY_LEAF_ITEM_ID, "You pull a sticky leaf off the bush.");
      return;
    }
    const isCatBed = resolvedId === CAT_BED_CHECK_OBJECT_ID || resolvedId === CAT_BED_NOOP_OBJECT_ID;
    if (isCatBed && action === "Check") {
      event.handled = true;
      checkCatBed(player);
      return;
    }
    if (resolvedId === EQUIPMENT_SETUP_OBJECT_ID && action === "Set-up") {
      event.handled = true;
      setUpEquipment(player);
    }
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  function handleItemOnObject(event) {
    const { player, itemId } = event;
    const definition = ObjectDefinition.forPlayer(event.objectId, player);
    const resolvedId = definition?.id ?? event.objectId;
    const isCatBed = resolvedId === CAT_BED_CHECK_OBJECT_ID || resolvedId === CAT_BED_NOOP_OBJECT_ID;
    if (!isCatBed) return;
    // The capture repairs with the jerboa tail used on the bed; the trimmed fur works too.
    if (itemId === TRIMMED_FUR_ITEM_ID || itemId === JERBOA_TAIL_ITEM_ID) {
      event.handled = true;
      if (stageOf(player) < STAGE_TRIMMED_FUR) return;
      if (sub(player, "bedRepair") === 1) {
        player.sendMessage("You have already repaired this bed.");
        return;
      }
      startTranscript(api, player, KIKO_NPC_ID, PAGE, "finishing-up-repairing-kiko-s-bed");
      return;
    }
    if (itemId === WOUND_TOY_MOUSE_ITEM_ID && stageOf(player) === STAGE_MOUSE) {
      event.handled = true;
      distractKiko(player);
    }
  }

  /** The wound mouse given to Kiko, as captured: the player's line and Kiko's delight. */
  function distractKiko(player) {
    take(player, WOUND_TOY_MOUSE_ITEM_ID);
    setSub(player, "catDistract", 1);
    const steps = locate(variantSteps("a-missing-fox-checking-the-cat-bed"), "xAmw_A")?.steps ?? [];
    startTranscript(api, player, KIKO_NPC_ID, PAGE, "a-missing-fox-checking-the-cat-bed", () => steps.filter((step) => step.type !== "message"));
  }

  function variantSteps(variant) {
    return loadTranscripts(api)?.[PAGE]?.variants?.[variant] ?? [];
  }

  function locate(steps, id) {
    for (const step of steps) {
      if (step?.id === id) return step;
      for (const nested of [step?.steps, ...(step?.options ?? []).map((option) => option.steps)]) {
        const found = Array.isArray(nested) ? locate(nested, id) : null;
        if (found) return found;
      }
    }
    return null;
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const stage = stageOf(player);
    if (stage !== STAGE_FOX_FOUND || held(player, MAKESHIFT_POULTICE_ITEM_ID)) return;
    const pair = new Set([usedItemId, usedWithItemId]);
    const ingredients = [SMOOTH_LEAF_ITEM_ID, STICKY_LEAF_ITEM_ID, JERBOA_TAIL_ITEM_ID];
    if (ingredients.filter((itemId) => pair.has(itemId)).length < 2) return;
    event.handled = true;
    if (!ingredients.every((itemId) => held(player, itemId))) {
      startTranscript(api, player, FOX_NPC_ID, PAGE, "fox-tracking-using-two-poultice-ingredients-together-without-the-third");
      return;
    }
    for (const itemId of ingredients) player.getInventory().deleteNumber(itemId, 1);
    player.getInventory().adds(MAKESHIFT_POULTICE_ITEM_ID, 1);
    player.performAnimation(new Animation(POULTICE_ANIMATION));
    player.getPacketSender().sendSound(POULTICE_SOUND, 1, POULTICE_SOUND_DELAY);
    startTranscript(api, player, FOX_NPC_ID, PAGE, "fox-tracking-using-two-poultice-ingredients-together-while-holding-all-three");
  }

  function handleItemOnNpc(event) {
    const { player, itemId } = event;
    const npcId = event.npcId ?? event.target?.getId?.();
    const stage = stageOf(player);
    if (npcId === FOX_NPC_ID) {
      if (itemId === MAKESHIFT_POULTICE_ITEM_ID && stage === STAGE_FOX_FOUND) {
        event.handled = true;
        startTranscript(api, player, FOX_NPC_ID, PAGE, "fox-tracking-talking-to-fox-with-the-makeshift-poultice");
        return;
      }
      if (itemId === TRIMMED_FUR_ITEM_ID && stage === STAGE_TRIMMED_FUR) {
        event.handled = true;
        startTranscript(api, player, FOX_NPC_ID, PAGE, "fox-tracking-talking-to-fox");
      }
      return;
    }
    if (npcId === ATZA_NPC_ID && itemId === FUR_SAMPLE_ITEM_ID && stage === STAGE_SAMPLE) {
      event.handled = true;
      startTranscript(api, player, ATZA_NPC_ID, PAGE, "fox-tracking-talking-to-atza");
      return;
    }
    if (npcId === VERITY_NPC_ID && itemId === FOXS_REPORT_ITEM_ID && held(player, FOXS_REPORT_ITEM_ID)) {
      event.handled = true;
      startTranscript(api, player, VERITY_NPC_ID, PAGE, "finishing-up-talking-to-verity");
      return;
    }
    if (npcId === KIKO_NPC_ID) {
      if (itemId === TOY_MOUSE_ITEM_ID) {
        event.handled = true;
        startTranscript(api, player, KIKO_NPC_ID, PAGE, "a-missing-fox-using-an-unwound-toy-mouse-on-kiko");
      } else if (itemId === WOUND_TOY_MOUSE_ITEM_ID) {
        event.handled = true;
        distractKiko(player);
      }
    }
  }

  function handleReadReport(event) {
    if (event.itemId !== FOXS_REPORT_ITEM_ID) return;
    event.handled = true;
    startTranscript(api, event.player, FOX_NPC_ID, PAGE, "fox-tracking-reading-fox-s-report");
  }

  // ==========================================================================
  // Saves, login and journal
  // ==========================================================================

  /** Old stages 1-12 onto the captured values (and their flags onto the varbits), once. */
  function migrate(player) {
    if (player.getAttribute(STAGE_VERSION_ATTRIBUTE) === STAGE_VERSION) return;
    player.setAttribute(STAGE_VERSION_ATTRIBUTE, STAGE_VERSION);
    const old = stageOf(player);
    if (old <= 0) return;
    const flags = Number(player.getAttribute(OLD_FLAGS_ATTRIBUTE)) || 0;
    const repaired = (flags & 1) !== 0;
    const mapped = [0, 1, 2, 3, 3, 4, 5, held(player, FUR_SAMPLE_ITEM_ID) ? 7 : 6, 8, 9, 10, repaired ? 11 : 10, 12][old] ?? old;
    setSub(player, "masterMet", 1);
    if (old >= 3) setSub(player, "mouseTaken", 1);
    if (old >= 4 || (flags & 2) !== 0) setSub(player, "catDistract", 1);
    if (old >= 4) setSub(player, "bedCheck", 1);
    if (old >= 7 && mapped >= 7) setSub(player, "sampleTaken", 1);
    if (old >= 8) setSub(player, "housetrapped", old >= 9 ? 2 : 1);
    if (old >= 11) setSub(player, "report", 1);
    if (repaired) setSub(player, "bedRepair", 1);
    quest.setStage(player, mapped);
  }

  function syncVars({ player }) {
    if (!player || player.isPlayerBot?.() === true) return;
    migrate(player);
    // Past Verity's first talk she has given the rumours introduction (saves from before it was recorded).
    if (stageOf(player) >= STAGE_VERITY) verityIntroduced(player, true);
    for (const name of Object.keys(VARS)) player.getPacketSender().sendVarbit(VARS[name][0], sub(player, name));
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  // Journal sections as live sends them (revision 243 capture, journal opened at ticks 186-1133).
  const JOURNAL_DONE = {
    1: ["<str>I spoke to Guildmaster Apatura in the Hunter Guild. She told", "<str>me that Guild Scribe Verity needed help with something and", "<str>asked me to speak to her in The Burrow below the Guild."],
    2: ["<str>I spoke to Guild Scribe Verity in The Burrow. She asked to look", "<str>into the disappearance of Guild Hunter Fox. She suggested I", "<str>talk to Guild Hunter Wolf to learn more."],
    3: ["<str>I spoke to Wolf and she explained to me that Fox was looking", "<str>into making some repairs to Guild Hunter Kiko's Cat Bed."],
    4: ["<str>I distracted Kiko and then inspected his Bed to find some of", "<str>the fur missing. Fox presumably took a sample to help him", "<str>find the right replacement. Wolf suggested I look for him near", "<str>the Pyre Foxes on the way to the Locus Oasis."],
    5: ["<str>I found Fox by a Chasm near the Locus Oasis, but he'd been", "<str>attacked. He asked me to make a Poultice for him."],
    6: ["<str>I created a Poultice for Fox and gave it to him."],
    7: ["<str>Fox explained to me that he was attacked whilst on route to", "<str>trade with Atza in Outer Fortis. He asked me to go to her on", "<str>his behalf while he recovered from his injuries. He gave me", "<str>the Fur Sample that he took from Kiko's Bed to give to her."],
    9: ["<str>I took the Fur Sample to Atza in Outer Fortis and she gave me", "<str>the Trimmed Fur needed to fix Kiko's Bed."],
  };
  const JOURNAL_NOW = {
    1: ["<col=000080>I spoke to <col=800000>Guildmaster Apatura<col=000080> in the <col=800000>Hunter Guild<col=000080>. She told", "<col=000080>me that <col=800000>Guild Scribe Verity<col=000080> needed help with something and", "<col=000080>asked me to speak to her in <col=800000>The Burrow<col=000080> below the <col=800000>Guild<col=000080>."],
    2: ["<col=000080>I spoke to <col=800000>Guild Scribe Verity<col=000080> in <col=800000>The Burrow<col=000080> and learned that", "<col=000080>she is concerned about the disappearance of <col=800000>Guild Hunter", "<col=800000>Fox<col=000080>. She suggested I talk to <col=800000>Guild Hunter Wolf<col=000080> to learn more."],
    3: ["<col=000080>I spoke to <col=800000>Wolf<col=000080> and she explained to me that <col=800000>Fox<col=000080> was looking", "<col=000080>into making some repairs to <col=800000>Guild Hunter Kiko's Cat Bed<col=000080>. I", "<col=000080>should have a look at the <col=800000>Bed<col=000080> and see what repairs he was", "<col=000080>trying to make."],
    4: ["<col=000080>I distracted <col=800000>Kiko<col=000080> and then inspected his <col=800000>Bed<col=000080> to find some of", "<col=000080>the fur missing. <col=800000>Fox<col=000080> presumably took a sample to help him", "<col=000080>find the right replacement. <col=800000>Wolf<col=000080> suggested I look for him near", "<col=000080>the <col=800000>Pyre Foxes<col=000080> on the way to the <col=800000>Locus Oasis<col=000080>, as he'll have", "<col=000080>likely stopped off there."],
    5: ["<col=000080>I found <col=800000>Fox<col=000080> by a <col=800000>Chasm<col=000080> near the <col=800000>Locus Oasis<col=000080>, but he'd been", "<col=000080>attacked. He asked me to make a <col=800000>Poultice<col=000080> for him using leaves", "<col=000080>from two nearby <col=800000>Plants<col=000080> along with an <col=800000>Embertailed Jerboa Tail<col=000080>."],
    7: ["<col=800000>Fox<col=000080> explained to me that he was attacked whilst on route to", "<col=000080>trade with <col=800000>Atza<col=000080> in <col=800000>Outer Fortis<col=000080>. He asked me to go to her on", "<col=000080>his behalf while he recovers from his injuries. If I give her the", "<col=000080><col=800000>Fur Sample<col=000080> that <col=800000>Fox<col=000080> took from <col=800000>Kiko's Bed<col=000080>, she should be able", "<col=000080>to supply the <col=800000>Fur<col=000080> needed. I can find her home near the south", "<col=000080>western gate of <col=800000>Civitas illa Fortis<col=000080>."],
    8: ["<col=000080>I took the <col=800000>Fur Sample<col=000080> to <col=800000>Atza<col=000080> in <col=800000>Outer Fortis<col=000080>. She asked me to", "<col=000080>assemble some <col=800000>Equipment<col=000080> on her floor while she searched for", "<col=000080>the right material."],
    9: ["<col=000080>I took the <col=800000>Fur Sample<col=000080> to <col=800000>Atza<col=000080> in <col=800000>Outer Fortis<col=000080> and she gave me", "<col=000080>the <col=800000>Trimmed Fur<col=000080> needed to fix <col=800000>Kiko's Bed<col=000080>. I should return to", "<col=800000><col=800000>Fox<col=000080> near the <col=800000>Locus Oasis<col=000080> and let him know."],
    10: ["<col=000080>I returned to <col=800000>Fox<col=000080> with the <col=800000>Trimmed Fur<col=000080>. He asked me to head", "<col=000080>back to the <col=800000>Hunter Guild<col=000080> and use the <col=800000>Fur<col=000080> along with an", "<col=800000><col=800000>Embertailed Jerboa Tail<col=000080> to fix <col=800000>Kiko's Bed<col=000080>. He also asked me to", "<col=000080>deliver a <col=800000>Report<col=000080> from him to <col=800000>Guild Scribe Verity<col=000080>."],
  };


  /** Stage -> the journal sections it shows: done ones struck through, the current one in colour. */
  const JOURNAL_SECTION_AT = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 8, 10: 10 };
  const strike = (lines) => lines.map((line) => `<str>${line.replace(/<col=[0-9a-f]+>/g, "")}`);

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage < STAGE_STARTED) {
      // Ours: the start overview is not captured.
      return [
        "I can start this quest by talking to <col=800000>Guildmaster",
        "Apatura</col> in the <col=800000>Hunter Guild</col>.",
        "",
        "I need level 46 Hunter, 30 Herblore and 27 Construction, and",
        "the Children of the Sun and Eagles' Peak quests.",
      ];
    }
    const current = JOURNAL_SECTION_AT[Math.min(stage, STAGE_REPORT)];
    const lines = [];
    for (const section of [1, 2, 3, 4, 5, 6, 7, 9]) {
      if (section >= current || (section === 9 && current < 10)) break;
      lines.push(...JOURNAL_DONE[section]);
    }
    if (stage === STAGE_POULTICE) {
      // Ours: stage 6 lasts only until Fox's next line, so it was not captured unstruck.
      return [...lines, "<col=000080>I created a <col=800000>Poultice<col=000080> for <col=800000>Fox<col=000080> and gave it to him."];
    }
    if (stage < STAGE_REPORT) return [...lines, ...JOURNAL_NOW[current === 8 && stage === STAGE_TRIMMED_FUR ? 9 : current]];
    if (stage === STAGE_REPORT) return [...lines, ...JOURNAL_NOW[10]];
    // Ours from here: the capture opened no journal after stage 10.
    lines.push(...strike(JOURNAL_NOW[10]));
    if (stage >= STAGE_COMPLETE) return [...lines, "", "<col=ff0000>QUEST COMPLETE!"];
    return [...lines, sub(player, "report") === 1
      ? "<col=000080>I should speak to <col=800000>Guildmaster Apatura<col=000080>."
      : "<col=000080>I should deliver <col=800000>Fox's Report<col=000080> to <col=800000>Guild Scribe Verity<col=000080>."];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.HUNTER, 4500);
    skills.addExperiences(Skill.CONSTRUCTION, 800);
    skills.addExperiences(Skill.HERBLORE, 500);
  }

  api.persistAttribute(VARS_ATTRIBUTE, 0);
  api.persistAttribute(STAGE_VERSION_ATTRIBUTE);
  api.persistAttribute(OLD_FLAGS_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "at_first_light",
    name: "At First Light",
    varpId: VARP_AT_FIRST_LIGHT,
    varbitId: STAGE_VARBIT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.HUNTER.getIndex(), amount: 4500, label: "Hunter" },
      { skillId: Skill.CONSTRUCTION.getIndex(), amount: 800, label: "Construction" },
      { skillId: Skill.HERBLORE.getIndex(), amount: 500, label: "Herblore" },
    ],
    scrollItemId: TRIMMED_FUR_ITEM_ID,
    otherRewards: ["Access to Master Tier Hunters' Rumours"],
    buildJournal,
    journalAsSent: true,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onNpcInteraction(APATURA_NPC_NAME, { "Talk-to": handleApaturaTalk });
  api.onNpcInteraction(ATZA_NPC_NAME, { "Talk-to": handleAtzaTalk });
  api.onNpcInteraction(KIKO_NPC_NAME, { Pet: handlePetKiko });
  api.onNpcInteraction(VERITY_NPC_NAME, { "Talk-to": talkFor(VERITY_NPC_ID, selectVerityVariant) });
  api.onNpcInteraction(WOLF_NPC_NAME, { "Talk-to": talkFor(WOLF_NPC_ID, selectWolfVariant) });
  api.onNpcInteraction("Guild Hunter Fox", { "Talk-to": handleFoxTalk });
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  // Wind on the toy mouse: construction/ClockworkToys.Construction.js (all clockwork toys).
  api.onItemAction("Fox's report", { Read: handleReadReport });
  api.onCustomEvent("player:bootstrap-complete", syncVars);
  api.onPlayerLogin(handleLogin);
};
