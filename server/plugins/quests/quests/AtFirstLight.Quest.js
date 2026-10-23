/**
 * At First Light (members).
 *
 * Behaviour follows the complete quest in RSProx recording 1695 (revision 226, ticks
 * 5134-5763); the words come from the "At First Light" transcript page. Evidence and
 * remaining gaps: docs/p2p-varlamore-group-2-parity.md.
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
 * 9840 (1 asked to assemble the pile, 2 assembled), afl_mastermet 9841, afl_sampletaken
 * 9842 and afl_mousetaken 9843.
 *
 * Saves from the old 1-12 model (bed check at 4, report delivered at 11) are mapped once.
 * Rewards per the capture: 1 Quest point, 4,500 Hunter, 800 Construction and 500 Herblore
 * XP, and access to Master Tier Hunters' Rumours.
 */
module.exports = function registerAtFirstLightQuest(api) {
  const {
    Animation, CountdownTask, DialogueChainBuilder, Equipment, ItemStatementDialogue, ObjectDefinition,
    Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, TaskManager,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, loadTranscripts } = require("../QuestRuntime");

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
  };

  const APATURA_NPC_ID = NpcIdentifiers.GUILDMASTER_APATURA; // 13120
  const WOLF_NPC_ID = NpcIdentifiers.GUILD_HUNTER_WOLF_MASTER_; // 13126
  const VERITY_NPC_ID = NpcIdentifiers.GUILD_SCRIBE_VERITY; // 13127
  const KIKO_NPC_ID = NpcIdentifiers.GUILD_HUNTER_KIKO; // 12934
  const ATZA_NPC_ID = NpcIdentifiers.ATZA; // 12933
  const FOX_NPC_ID = NpcIdentifiers.GUILD_HUNTER_FOX; // 12932, the injured Fox
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

  // Fox has no npc-spawns.json row: the injured Fox is the player's own while the quest needs him.
  const FOX_SPAWN = { id: FOX_NPC_ID, x: 1623, y: 2982, z: 0, wanderRadius: 0 };

  // Captured animations and timings.
  const PICK_ANIMATION = 10094;
  const PICK_SOUND = 2581;
  const POULTICE_ANIMATION = 10097;
  const ASSEMBLE_ANIMATION = 3676;
  const REPAIR_ANIMATION = 10794;
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
  /** Text-only message boxes. */
  const STATEMENTS = new Set(["MdlNBh", "LNk3X1", "fZnlnI", "AFxMNH", "oSl9ut"]);

  const VERITY_LEAD_LINE = "If anyone did, it would've been Wolf. She's always getting Fox into some kind of trouble.";
  const WOLF_MOUSE_LINE = "He's very easy to distract. We have a little fake mouse we use sometimes.";
  const WOLF_PYRE_LINE = "He'll have stopped off for a bit of hunting first. There are some pyre foxes about halfway between here and the Locus Oasis that he was eyeing up. I bet that's where you'll find him.";
  const FOX_TRAPS_LINE = "Don't forget... your traps for the jerboa... they're boxy...";
  const FOX_SAMPLE_LINE = "Well it's your lucky day! Take this sample to a woman called Atza in Outer Fortis. She'll have exactly what we need.";
  const ATZA_PILE_LINE = "It's all in that pile on the floor there. You can work it out, I'm sure.";
  const ASSEMBLE_LINES = new Set(["Well, he actually got attacked on his way over here.", "Oh he'll be alright. He was on the mend when I left him."]);
  const ASSEMBLED_LINE = "All done!";
  const APATURA_DONE_LINE = "Actually... I think I'll just read the report.";

  const spawnedFoxes = new WeakMap();
  const playerTasks = new WeakMap();
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

  function canRepairBed(player) {
    return (
      held(player, TRIMMED_FUR_ITEM_ID) &&
      held(player, JERBOA_TAIL_ITEM_ID) &&
      (held(player, NEEDLE_ITEM_ID) || held(player, COSTUME_NEEDLE_ITEM_ID))
    );
  }

  /** Advances the stage (and Fox's presence) without ever regressing. */
  function advance(player, stage) {
    if (stageOf(player) >= stage) return;
    quest.setStage(player, stage);
    syncFox(player);
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
    if (stage >= STAGE_POULTICE) return "fox-tracking-talking-to-guild-hunter-wolf-after-giving-fox-the-poultice";
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
      case "2AzwyN": // never talked to Verity
        return stage <= STAGE_STARTED;
      case "dgY8x-": // previously talked to Verity
        return stage > STAGE_STARTED;
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
    player.sendMessage("You've started a new quest: <col=081190>At First Light</col>");
  }

  /** Line events fire as a run of lines is queued; captured changes as a line appears go in `before`. */
  function handleLine(event) {
    const { player, npcId, text } = event;
    if (typeof text !== "string") return;
    const at = (expected, action) => { if (text === expected) event.before = action; };
    const stage = stageOf(player);
    if (npcId === VERITY_NPC_ID && stage === STAGE_STARTED) at(VERITY_LEAD_LINE, () => advance(player, STAGE_VERITY));
    if (npcId === WOLF_NPC_ID) {
      if (stage === STAGE_VERITY) at(WOLF_MOUSE_LINE, () => advance(player, STAGE_MOUSE));
      if (stage === STAGE_MOUSE) at(WOLF_PYRE_LINE, () => advance(player, STAGE_PYRE_FOXES));
    }
    if (npcId === FOX_NPC_ID) {
      if (stage === STAGE_PYRE_FOXES) at(FOX_TRAPS_LINE, () => advance(player, STAGE_FOX_FOUND));
      if (stage === STAGE_POULTICE) at(FOX_SAMPLE_LINE, () => advance(player, STAGE_SAMPLE));
    }
    if (npcId === ATZA_NPC_ID) {
      if (stage === STAGE_SAMPLE_GIVEN && sub(player, "housetrapped") === 0) at(ATZA_PILE_LINE, () => setSub(player, "housetrapped", 1));
      if (ASSEMBLE_LINES.has(text)) event.before = () => later(player, 1, () => player.performAnimation(new Animation(ASSEMBLE_ANIMATION, 10)));
      at(ASSEMBLED_LINE, () => setSub(player, "housetrapped", 2));
    }
    if (npcId === APATURA_NPC_ID && stage === STAGE_BED_REPAIRED && text === APATURA_DONE_LINE) event.after = () => {
      quest.complete(player);
      syncFox(player);
    };
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
      case "fZnlnI": // You carefully fix up Kiko's bed.
        take(player, TRIMMED_FUR_ITEM_ID);
        take(player, JERBOA_TAIL_ITEM_ID);
        player.performAnimation(new Animation(REPAIR_ANIMATION));
        player.getSkillManager().addExperiences(Skill.CRAFTING, REPAIR_CRAFTING_XP);
        setSub(player, "bedRepair", 1);
        advance(player, STAGE_BED_REPAIRED);
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
    const stage = stageOf(player);
    if (stage >= STAGE_MOUSE && stage < STAGE_COMPLETE) {
      startTranscript(api, player, KIKO_NPC_ID, PAGE, "a-missing-fox-petting-kiko");
      return;
    }
    startTranscript(api, player, KIKO_NPC_ID, "Guild Hunter Kiko",
      understandsCats(player) ? "petting-kiko-with-a-catspeak-amulet" : "petting-kiko-without-a-catspeak-amulet");
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
    if (inventoryFull(player)) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    player.performAnimation(new Animation(PICK_ANIMATION));
    player.getPacketSender().sendSound(PICK_SOUND, 1, 15);
    later(player, PICK_TICKS, () => {
      if (held(player, itemId) || inventoryFull(player)) return;
      player.getInventory().adds(itemId, 1);
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
    player.performAnimation(new Animation(ASSEMBLE_ANIMATION, 10));
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

  function handleWindToyMouse(event) {
    if (event.itemId !== TOY_MOUSE_ITEM_ID) return;
    event.handled = true;
    event.player.getInventory().deleteNumber(TOY_MOUSE_ITEM_ID, 1);
    event.player.getInventory().adds(WOUND_TOY_MOUSE_ITEM_ID, 1);
    event.player.sendMessage("You wind up the mouse.");
  }

  function handleReadReport(event) {
    if (event.itemId !== FOXS_REPORT_ITEM_ID) return;
    event.handled = true;
    startTranscript(api, event.player, FOX_NPC_ID, PAGE, "fox-tracking-reading-fox-s-report");
  }

  // ==========================================================================
  // Fox, saves, login/logout and journal
  // ==========================================================================

  function syncFox(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const stage = stageOf(player);
    const wanted = stage >= STAGE_PYRE_FOXES && stage < STAGE_COMPLETE;
    const fox = spawnedFoxes.get(player);
    if (wanted && !fox) {
      const npc = api.spawnNpc({ ...FOX_SPAWN, owner: player, ownerOnly: true });
      if (npc) spawnedFoxes.set(player, npc);
    } else if (!wanted && fox) {
      api.removeNpc(fox);
      spawnedFoxes.delete(player);
    }
  }

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
    for (const name of Object.keys(VARS)) player.getPacketSender().sendVarbit(VARS[name][0], sub(player, name));
    syncFox(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    const fox = player ? spawnedFoxes.get(player) : null;
    if (!fox) return;
    api.removeNpc(fox);
    spawnedFoxes.delete(player);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Guildmaster Apatura asked me to help Guild Scribe Verity,</str>",
        "<str>who was worried about the missing Guild Hunter Fox.</str>",
        "<str>I found Fox, delivered his report and repaired Kiko's bed.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_REPORT) {
      const lines = [];
      lines.push(sub(player, "report") === 1 ? "I delivered Fox's report to Guild Scribe Verity." : "Fox gave me a report to take back to the guild.");
      if (sub(player, "bedRepair") === 1) lines.push("I repaired Kiko's bed with the trimmed fur.");
      lines.push("");
      if (sub(player, "report") === 0) lines.push("I should deliver it to <col=800000>Guild Scribe Verity</col> in the Burrow.");
      if (sub(player, "bedRepair") === 0) lines.push("I should use the trimmed fur along with a jerboa tail to", "repair <col=800000>Kiko's bed</col>.");
      if (sub(player, "report") === 1 && sub(player, "bedRepair") === 1) lines.push("I should speak to <col=800000>Guildmaster Apatura</col>.");
      return lines;
    }
    if (stage >= STAGE_TRIMMED_FUR) {
      return ["I set up Atza's equipment and she gave me the trimmed fur.", "", "I should take it back to <col=800000>Fox</col> in the savannah."];
    }
    if (stage >= STAGE_SAMPLE_GIVEN) {
      return ["I gave Atza the fur sample. She asked me to set up the", "<col=800000>pile of equipment</col> on her floor first."];
    }
    if (stage >= STAGE_SAMPLE) {
      return held(player, FUR_SAMPLE_ITEM_ID)
        ? ["I gave Fox the poultice and he gave me a fur sample.", "", "I should take it to <col=800000>Atza</col> near the south western", "gate of Civitas illa Fortis."]
        : ["I gave Fox the poultice but still need his sample of the", "fur from <col=800000>Kiko's bed</col>."];
    }
    if (stage >= STAGE_POULTICE) {
      return ["I gave <col=800000>Fox</col> the poultice. I should see what he needs now."];
    }
    if (stage >= STAGE_FOX_FOUND) {
      return held(player, MAKESHIFT_POULTICE_ITEM_ID)
        ? ["I found <col=800000>Fox</col> injured in the savannah.", "", "I should give him the makeshift poultice."]
        : ["I found <col=800000>Fox</col> injured in the savannah.", "", "He needs a poultice of two kinds of leaves tied together", "with an embertailed jerboa tail."];
    }
    if (stage >= STAGE_PYRE_FOXES) {
      return ["Wolf thinks Fox stopped to hunt <col=800000>pyre foxes</col> on his way", "to the Locus Oasis. I should look for him in the savannah."];
    }
    if (stage >= STAGE_MOUSE) {
      return sub(player, "bedCheck") === 1
        ? ["I distracted <col=800000>Kiko</col> and checked his bed.", "", "Some of the fur was deliberately cut off. I should tell", "<col=800000>Wolf</col> about it."]
        : ["Wolf explained Fox was repairing <col=800000>Kiko's bed</col>.", "", "I should wind up the <col=800000>toy mouse</col> and distract Kiko", "so I can check the bed."];
    }
    if (stage >= STAGE_VERITY) {
      return ["Guild Scribe Verity is worried about Guild Hunter Fox.", "", "She suggested I speak to <col=800000>Guild Hunter Wolf</col>."];
    }
    if (stage >= STAGE_STARTED) {
      return ["Guildmaster Apatura asked me to help Guild Scribe Verity", "in <col=800000>The Burrow</col> below the Hunter Guild."];
    }
    return [
      "I can start this quest by talking to <col=800000>Guildmaster",
      "Apatura</col> in the <col=800000>Hunter Guild</col>.",
      "",
      "I need level 46 Hunter, 30 Herblore and 27 Construction, and",
      "the Children of the Sun and Eagles' Peak quests.",
    ];
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
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onNpcInteraction(ATZA_NPC_NAME, { "Talk-to": handleAtzaTalk });
  api.onNpcInteraction(KIKO_NPC_NAME, { Pet: handlePetKiko });
  api.onNpcInteraction(VERITY_NPC_NAME, { "Talk-to": talkFor(VERITY_NPC_ID, selectVerityVariant) });
  api.onNpcInteraction(WOLF_NPC_NAME, { "Talk-to": talkFor(WOLF_NPC_ID, selectWolfVariant) });
  api.onNpcInteraction("Guild Hunter Fox", { "Talk-to": handleFoxTalk });
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemAction("Toy mouse", { Wind: handleWindToyMouse });
  api.onItemAction("Fox's report", { Read: handleReadReport });
  api.onCustomEvent("player:bootstrap-complete", syncVars);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
