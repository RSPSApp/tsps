/**
 * The Forsaken Tower (members).
 *
 * The words come from the "The Forsaken Tower" transcript page; this plugin supplies
 * the variant selectors for Lady Vulcana Lovakengj, Councillor Unkar and Undor, the
 * requirements/reward condition answers, and the tower machinery (display case,
 * generator crank, steam generator, power grid, coolant/furnace, refinery, energy
 * pylons and Dinh's Hammer hand-in).
 *
 * Stages (varbit 7796 "lovaquest", varp 2066 bits 0-3; sibling bits in the same varp
 * hold the puzzle state, confirmed with `yarn lookup-gameval`):
 *   1  accepted the job from Lady Lovakengj (go to Undor)
 *   2  Undor asked me to talk to Ignisia first
 *   3  Ignisia briefed me; find Dinh's Hammer in the Forsaken Tower
 *   8  all four tower puzzles solved; the display case is unlocked
 *   9  took Dinh's Hammer; hand it to Undor
 *  10  gave the hammer to Undor; report back to Lady Lovakengj
 *  11  complete
 * The stage values are this plugin's contract with the display-case and Undor multi-locs
 * (cache parents 34588/8626), whose transform tables were read from the cache:
 * 34588 -> 33487 sealed (0-7), 33488 search (8), 33489 search (9), 33490 empty (10+);
 * 8626  -> 8544 (0-10), 8545 (11).
 *
 * Puzzle varbits (same varp 2066 unless noted; values sent with sendVarbit so the
 * client's multi-loc scenery swaps without any object add/remove):
 *   7797 electricity 0 none, 1 crank found, 2 generator running, 3 grid ready, 4 aligned
 *   7798 furnace     0 none, 3 coolant poured, 4 lit
 *   7799 refinery    0 none, 2 needs cleansing, 3 cleansed, 4 active
 *   7800 altar       2 pylons solved
 *   7801 reward / 7802 favour set on completion
 *   7804 foundhammer 7805 foundcrank 7806 foundjugs 7807 pylon_setup 7808 foundnotes
 *   7809 fluid_setup 7810 hidden_note (ancient letter)
 *   7847/7848/7849 (varp 2069) pylon west/centre/east, one bit per disk (bit0 = level 1)
 *
 * The transcript itself is played by NpcDialogues.plugin.js; this plugin only answers its
 * conditions ("If the player doees not have the requirements..." / "...has the
 * requirements..."), lets the wiki "Start The Forsaken Tower quest?" marker (step 5ceuGp)
 * through to the accept menu, sets/reads the puzzle bits at the transcript's message steps
 * and hands out the items there.
 *
 * Source: OSRS Wiki "The Forsaken Tower" and its quick guide (requirements: Client of
 * Kourend; rewards: 1 Quest point, 500 Mining, 500 Smithing, 6,000 coins, Lovakengj
 * minecart network, Jewellery of Jubilation page, graceful recolour).
 *
 * Gaps / approximations:
 *  - The display-case "four locks" interface is not reproduced; the Inspect message plays
 *    and the locks are tracked with the machine varbits above.
 *  - The power-grid slider puzzle is reduced to Inspect -> Align (the wiki solution image
 *    is not reproducible without that interface); the wiki's own align messages play.
 *  - The furnace coolant pouring puzzle is simulated with jug contents (Check -> Empty) and
 *    a 4-gallon requirement; the furnace refuses to light without coolant instead of the
 *    wiki's damage roll. Smelting at the lit furnace is left to other content.
 *  - The refining-fluid riddle is simplified: the table cycles through the five unknown
 *    fluids and Reading the old notes names the player's cleansing fluid; a wrong fluid is
 *    consumed with a rejection line instead of dealing damage/poison.
 *  - Pylon Rebalance picks up the top disk and Rebalance on another pylon places it
 *    (bigger-on-smaller refused); Reset restores the opening position.
 *  - The runic altar only carries its varbit state; inspecting it is unhandled.
 *  - Undor's mid-quest "talk to Ignisia" stage is set when the variant is selected, and his
 *    long briefing is marked as seen on selection. Object lines not in the transcript
 *    (crate/cupboard/empty-case/furnace/pylon feedback) are authored and marked in code.
 */
module.exports = function registerForsakenTowerQuest(api) {
  const {
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "The Forsaken Tower";

  // NPC content ids (multi-loc spawns resolve to these; see NpcEntries 8626/11145/11146).
  const LADY_VULCANA_NPC_ID = NpcIdentifiers.LADY_VULCANA_LOVAKENGJ_3; // 11035
  const COUNCILLOR_UNKAR_NPC_ID = NpcIdentifiers.COUNCILLOR_UNKAR_2; // 11036
  const UNDOR_NPC_IDS = new Set([
    NpcIdentifiers.UNDOR, // 8544
    NpcIdentifiers.UNDOR_2, // 8545
  ]);
  const IGNISIA_NPC_ID = NpcIdentifiers.IGNISIA; // 7374
  const ASSEMBLY_NPC_IDS = new Set([LADY_VULCANA_NPC_ID, COUNCILLOR_UNKAR_NPC_ID]);
  const QUEST_NPC_IDS = new Set([LADY_VULCANA_NPC_ID, COUNCILLOR_UNKAR_NPC_ID, IGNISIA_NPC_ID, ...UNDOR_NPC_IDS]);

  // Varp 2066 ("lovaquest") and its varbits; the stage varbit is registerQuest's.
  const VARBIT_STAGE = 7796;
  const VARBIT_ELECTRICITY = 7797;
  const VARBIT_FURNACE = 7798;
  const VARBIT_REFINERY = 7799;
  const VARBIT_ALTAR = 7800;
  const VARBIT_REWARD = 7801;
  const VARBIT_FAVOUR = 7802;
  const VARBIT_FOUND_HAMMER = 7804;
  const VARBIT_FOUND_CRANK = 7805;
  const VARBIT_FOUND_JUGS = 7806;
  const VARBIT_PYLON_SETUP = 7807;
  const VARBIT_FOUND_NOTES = 7808;
  const VARBIT_FLUID_SETUP = 7809;
  const VARBIT_HIDDEN_NOTE = 7810;
  const VARBIT_PYLON_1 = 7847;
  const VARBIT_PYLON_2 = 7848;
  const VARBIT_PYLON_3 = 7849;

  const STAGE_STARTED = 1;
  const STAGE_UNDOR = 2;
  const STAGE_IGNISIA = 3;
  const STAGE_CASE = 8;
  const STAGE_HAS_HAMMER = 9;
  const STAGE_HAMMER_GIVEN = 10;
  const STAGE_COMPLETE = 11;

  const ELECTRICITY_ALIGNED = 4;
  const FURNACE_COOLED = 3;
  const FURNACE_LIT = 4;
  const REFINERY_NEEDS_CLEANSE = 2;
  const REFINERY_CLEANSED = 3;
  const REFINERY_ACTIVE = 4;
  const ALTAR_CHARGED = 2;

  const CLIENT_OF_KOUREND_KEY = "client_of_kourend";
  const CLIENT_OF_KOUREND_ATTRIBUTE = "quest.client_of_kourend.stage";
  const CLIENT_OF_KOUREND_COMPLETE = 2;

  // Items.
  const DINHS_HAMMER_ITEM_ID = ItemIdentifiers.DINHS_HAMMER; // 22761
  const GENERATOR_CRANK_ITEM_ID = ItemIdentifiers.GENERATOR_CRANK; // 22762
  const EIGHT_GALLON_JUG_ITEM_ID = ItemIdentifiers._8_GALLON_JUG; // 22763
  const FIVE_GALLON_JUG_ITEM_ID = ItemIdentifiers._5_GALLON_JUG; // 22764
  const UNKNOWN_FLUID_IDS = [
    ItemIdentifiers.UNKNOWN_FLUID_1, // 22769
    ItemIdentifiers.UNKNOWN_FLUID_2, // 22770
    ItemIdentifiers.UNKNOWN_FLUID_3, // 22771
    ItemIdentifiers.UNKNOWN_FLUID_4, // 22772
    ItemIdentifiers.UNKNOWN_FLUID_5, // 22773
  ];
  const OLD_NOTES_ITEM_ID = ItemIdentifiers.OLD_NOTES_30; // 22774
  const ANCIENT_LETTER_ITEM_ID = ItemIdentifiers.ANCIENT_LETTER; // 22775
  const TINDERBOX_ITEM_ID = ItemIdentifiers.TINDERBOX; // 590
  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995
  const REWARD_COINS = 6000;
  const REWARD_XP = 500;

  // Multi-loc cache parents (ids not in ObjectIdentifiers, which only names the resolved
  // children): object clicks and item-on-object carry the parent id, while event.definition
  // is the child resolved from the puzzle varbit (ObjectDefinition.forPlayer).
  const COOLANT_DISPENSER_MULTILOC = 34593; // -> 33506/33507
  const FURNACE_COOLANT_MULTILOC = 34594; // -> 33508-33510
  const REFINERY_MULTILOC = 34595; // -> 33516-33519
  const ENERGY_PYLON_MULTILOC_IDS = new Set([34598, 34599, 34600]); // -> 33525-33542
  const PYLON_MULTILOC_BY_INDEX = [34598, 34599, 34600];
  const JUG_CUPBOARD_OBJECT_IDS = new Set([
    ObjectIdentifiers.CUPBOARD_60, // 33513
    ObjectIdentifiers.CUPBOARD_61, // 33514
    ObjectIdentifiers.CUPBOARD_62, // 33515
  ]);
  const NOTES_CUPBOARD_OBJECT_ID = ObjectIdentifiers.CUPBOARD_63; // 33522
  const CRANK_CRATE_OBJECT_IDS = new Set([
    ObjectIdentifiers.CRATE_257, // 33496
    ObjectIdentifiers.CRATES_69, // 33497
    ObjectIdentifiers.CRATE_258, // 33498
  ]);
  const LETTER_CRATE_OBJECT_ID = ObjectIdentifiers.CRATE_260; // 33565

  // npc-dialogue mode step ids (condition/message/choice) on the page.
  const NO_REQUIREMENTS_CONDITION_ID = "9LU1OH";
  const HAS_REQUIREMENTS_CONDITION_ID = "WDsS9P";
  const START_MARKER_ID = "5ceuGp"; // wiki "Start The Forsaken Tower quest?" prompt
  const ACCEPT_OPTION = "I'm looking for a quest.";
  const CRANK_MESSAGE_ID = "2MQOZ8";
  const STEAM_CRANK_MISSING_ID = "PqSVRg";
  const STEAM_HAS_CRANK_ID = "MwFIA_";
  const STEAM_START_ID = "Xny7cb";
  const GRID_NOT_ALIGNED_ID = "BVZpTq";
  const GRID_ALIGNED_ID = "ZLKoQ9";
  const CUPBOARD_BASE_ID = "Rk9njm";
  const CUPBOARD_JUG_5_ID = "mxjnCR";
  const CUPBOARD_JUG_8_ID = "TT5lMq";
  const CUPBOARD_BOTH_ID = "a9L9Cu";
  const REFINERY_BASE_ID = "-ddJDi";
  const REFINERY_DIRTY_ID = "lSMgpK";
  const REFINERY_CLEANSED_ID = "XvLqj1";
  const HAMMER_TAKEN_ID = "iJCaaU";
  const HAMMER_GIVEN_ID = "w9a81Y";
  const COMPLETE_ACTION_ID = "g4UeAw";

  // Variant keys on the page.
  const ASSEMBLY_VARIANT = "the-assembly-talking-to-lady-lovakengj";
  const ASSEMBLY_AGAIN_VARIANT = "the-assembly-talking-to-lady-lovakengj-talking-to-councillor-unkar-again";
  const UNDOR_BEFORE_IGNISIA_VARIANT = "the-quest-for-the-hammer-talking-to-undor-before-talking-to-ignisia";
  const UNDOR_AFTER_IGNISIA_VARIANT = "the-quest-for-the-hammer-talking-to-undor-after-talking-to-ignisia";
  const UNDOR_AGAIN_VARIANT = "the-quest-for-the-hammer-talking-to-undor-after-talking-to-ignisia-talking-to-undor-again";
  const DISPLAY_CASE_VARIANT = "the-quest-for-the-hammer-the-forsaken-tower-inspecting-the-display-case";
  const CRANK_VARIANT = "the-quest-for-the-hammer-the-forsaken-tower-finding-the-generator-crank";
  const STEAM_GENERATOR_VARIANT = "the-quest-for-the-hammer-the-forsaken-tower-inspecting-the-steam-generator";
  const POWER_GRID_VARIANT = "the-quest-for-the-hammer-the-forsaken-tower-inspecting-the-power-grid";
  const CUPBOARD_VARIANT = "the-quest-for-the-hammer-the-forsaken-tower-searching-the-cupboard";
  const REFINERY_VARIANT = "the-quest-for-the-hammer-the-forsaken-tower-inspecting-the-refinery";
  const HAMMER_VARIANT = "the-quest-for-the-hammer-the-forsaken-tower-taking-dinh-s-hammer";
  const UNDOR_HANDOVER_VARIANT = "finishing-up-returning-to-undor";
  const UNDOR_HANDOVER_AGAIN_VARIANT = "finishing-up-returning-to-undor-talking-to-undor-again";
  const REWARD_VARIANT = "finishing-up-returning-to-lady-lovakengj";

  // Persisted state (quest stage is QuestRuntime's; these mirror the sibling varbits).
  const ELECTRICITY_ATTRIBUTE = "quest.the_forsaken_tower.electricity";
  const FURNACE_ATTRIBUTE = "quest.the_forsaken_tower.furnace";
  const REFINERY_ATTRIBUTE = "quest.the_forsaken_tower.refinery";
  const ALTAR_ATTRIBUTE = "quest.the_forsaken_tower.altar";
  const FLAGS_ATTRIBUTE = "quest.the_forsaken_tower.flags";
  const PYLON_ATTRIBUTE = "quest.the_forsaken_tower.pylons";
  const HELD_DISK_ATTRIBUTE = "quest.the_forsaken_tower.held-disk";
  const JUG_5_ATTRIBUTE = "quest.the_forsaken_tower.jug-5";
  const JUG_8_ATTRIBUTE = "quest.the_forsaken_tower.jug-8";
  const FLUID_ATTRIBUTE = "quest.the_forsaken_tower.fluid";
  const FLUID_TAKEN_ATTRIBUTE = "quest.the_forsaken_tower.fluid-taken";

  const FLAG_CRANK = 1 << 0;
  const FLAG_JUGS = 1 << 1;
  const FLAG_NOTES = 1 << 2;
  const FLAG_HAMMER = 1 << 3;
  const FLAG_LETTER = 1 << 4;
  const FLAG_BRIEFED = 1 << 5;
  const FLAG_PYLONS_STARTED = 1 << 6;

  const JUG_CAPACITY_5 = 5;
  const JUG_CAPACITY_8 = 8;
  const COOLANT_REQUIRED = 4;
  const PYLON_ALL_DISKS = 0b1111;

  const GENDER_LOOK_SLOT = 0; // Appearance.GENDER: 0 male, 1 female.

  api.persistAttribute(ELECTRICITY_ATTRIBUTE);
  api.persistAttribute(FURNACE_ATTRIBUTE);
  api.persistAttribute(REFINERY_ATTRIBUTE);
  api.persistAttribute(ALTAR_ATTRIBUTE);
  api.persistAttribute(FLAGS_ATTRIBUTE);
  api.persistAttribute(PYLON_ATTRIBUTE);
  api.persistAttribute(HELD_DISK_ATTRIBUTE);
  api.persistAttribute(JUG_5_ATTRIBUTE);
  api.persistAttribute(JUG_8_ATTRIBUTE);
  api.persistAttribute(FLUID_ATTRIBUTE);
  api.persistAttribute(FLUID_TAKEN_ATTRIBUTE);

  let quest;

  const amount = (player, itemId) => player.getInventory().getAmount(itemId);
  const held = (player, itemId, count = 1) => amount(player, itemId) >= count;
  const readInt = (player, key) => {
    const value = Number(player.getAttribute(key));
    return Number.isFinite(value) ? value | 0 : 0;
  };

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  /** The resolved child id when multi-locs are involved (event.definition is resolved). */
  function resolvedObjectId(event) {
    return event.definition?.id ?? event.objectId;
  }

  function sendVarbit(player, varbitId, value) {
    player.getPacketSender().sendVarbit(varbitId, value);
  }

  function getElectricity(player) {
    return readInt(player, ELECTRICITY_ATTRIBUTE);
  }

  function setElectricity(player, value) {
    player.setAttribute(ELECTRICITY_ATTRIBUTE, value);
    sendVarbit(player, VARBIT_ELECTRICITY, value);
    maybeUnlockCase(player);
  }

  function getFurnace(player) {
    return readInt(player, FURNACE_ATTRIBUTE);
  }

  function setFurnace(player, value) {
    player.setAttribute(FURNACE_ATTRIBUTE, value);
    sendVarbit(player, VARBIT_FURNACE, value);
    maybeUnlockCase(player);
  }

  function getRefinery(player) {
    return readInt(player, REFINERY_ATTRIBUTE);
  }

  function setRefinery(player, value) {
    player.setAttribute(REFINERY_ATTRIBUTE, value);
    sendVarbit(player, VARBIT_REFINERY, value);
    maybeUnlockCase(player);
  }

  function getAltar(player) {
    return readInt(player, ALTAR_ATTRIBUTE);
  }

  function setAltar(player, value) {
    player.setAttribute(ALTAR_ATTRIBUTE, value);
    sendVarbit(player, VARBIT_ALTAR, value);
    maybeUnlockCase(player);
  }

  function getFlags(player) {
    return readInt(player, FLAGS_ATTRIBUTE);
  }

  function hasFlag(player, flag) {
    return (getFlags(player) & flag) !== 0;
  }

  function setFlag(player, flag) {
    player.setAttribute(FLAGS_ATTRIBUTE, getFlags(player) | flag);
  }

  const hasCrank = (player) => hasFlag(player, FLAG_CRANK) || held(player, GENERATOR_CRANK_ITEM_ID);

  function requirementsMet(player) {
    const request = { player, key: CLIENT_OF_KOUREND_KEY, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    if (typeof request.complete === "boolean") return request.complete;
    return readInt(player, CLIENT_OF_KOUREND_ATTRIBUTE) >= CLIENT_OF_KOUREND_COMPLETE;
  }

  /** Opening the case needs all four tower puzzles; the stage drives its multi-loc. */
  function maybeUnlockCase(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_CASE) return;
    if (getElectricity(player) < ELECTRICITY_ALIGNED) return;
    if (getFurnace(player) < FURNACE_LIT) return;
    if (getRefinery(player) < REFINERY_ACTIVE) return;
    if (getAltar(player) < ALTAR_CHARGED) return;
    quest.setStage(player, STAGE_CASE);
    player.sendMessage("You hear the locks on the display case click open.");
  }

  // ---------------------------------------------------------------------------
  // Pylons (Tower of Hanoi; varbits 7847-7849 hold one bit per disk, bit0 = level 1)
  // ---------------------------------------------------------------------------

  function pylonMasks(player) {
    const packed = readInt(player, PYLON_ATTRIBUTE);
    return [(packed >> 0) & 0x1f, (packed >> 5) & 0x1f, (packed >> 10) & 0x1f];
  }

  function savePylons(player, masks) {
    player.setAttribute(PYLON_ATTRIBUTE, (masks[0] & 0x1f) | ((masks[1] & 0x1f) << 5) | ((masks[2] & 0x1f) << 10));
    sendVarbit(player, VARBIT_PYLON_1, masks[0]);
    sendVarbit(player, VARBIT_PYLON_2, masks[1]);
    sendVarbit(player, VARBIT_PYLON_3, masks[2]);
  }

  /** The top disk of a stack is the lowest set bit; 0 when the pylon is empty. */
  function topDisk(mask) {
    for (let disk = 1; disk <= 4; disk++) {
      if (mask & (1 << (disk - 1))) return disk;
    }
    return 0;
  }

  // ---------------------------------------------------------------------------
  // Jugs and coolant
  // ---------------------------------------------------------------------------

  function jugAmount(player, itemId) {
    return readInt(player, itemId === FIVE_GALLON_JUG_ITEM_ID ? JUG_5_ATTRIBUTE : JUG_8_ATTRIBUTE);
  }

  function setJugAmount(player, itemId, value) {
    player.setAttribute(itemId === FIVE_GALLON_JUG_ITEM_ID ? JUG_5_ATTRIBUTE : JUG_8_ATTRIBUTE, value);
  }

  function fillJug(player) {
    if (!held(player, FIVE_GALLON_JUG_ITEM_ID)) {
      player.sendMessage("You need a 5-gallon jug to collect coolant.");
      return;
    }
    setJugAmount(player, FIVE_GALLON_JUG_ITEM_ID, JUG_CAPACITY_5);
    player.sendMessage("You fill the 5-gallon jug with coolant.");
  }

  function pourJug(player) {
    const five = jugAmount(player, FIVE_GALLON_JUG_ITEM_ID);
    if (!held(player, FIVE_GALLON_JUG_ITEM_ID) || five < COOLANT_REQUIRED) {
      player.sendMessage("The coolant mechanism needs 4 gallons of coolant.");
      return;
    }
    setJugAmount(player, FIVE_GALLON_JUG_ITEM_ID, five - COOLANT_REQUIRED);
    setFurnace(player, FURNACE_COOLED);
    player.sendMessage("You pour the coolant into the mechanism.");
  }

  function emptyJug(player, itemId) {
    setJugAmount(player, itemId, 0);
    player.sendMessage("You empty the jug.");
  }

  // ---------------------------------------------------------------------------
  // Refinery fluid
  // ---------------------------------------------------------------------------

  /** The player's personal cleansing fluid is fixed on first use. */
  function cleansingFluidId(player) {
    let itemId = readInt(player, FLUID_ATTRIBUTE);
    if (!itemId) {
      itemId = UNKNOWN_FLUID_IDS[Math.floor(Math.random() * UNKNOWN_FLUID_IDS.length)];
      player.setAttribute(FLUID_ATTRIBUTE, itemId);
      sendVarbit(player, VARBIT_FLUID_SETUP, 1);
    }
    return itemId;
  }

  /** Uses one fluid; true when the correct one cleansed the refinery. */
  function cleanseRefinery(player) {
    const cleansing = cleansingFluidId(player);
    if (held(player, cleansing)) {
      player.getInventory().deleteNumber(cleansing, 1);
      setRefinery(player, REFINERY_CLEANSED);
      return true;
    }
    const wrong = UNKNOWN_FLUID_IDS.find((itemId) => held(player, itemId));
    if (wrong !== undefined) {
      player.getInventory().deleteNumber(wrong, 1);
      player.sendMessage("The refinery splutters and rejects the fluid. That wasn't the cleansing fluid.");
      return false;
    }
    player.sendMessage("You need cleansing fluid to cleanse the refinery.");
    return false;
  }

  // ---------------------------------------------------------------------------
  // Dialogue
  // ---------------------------------------------------------------------------

  function selectUndorVariant(player, stage) {
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return null;
    if (stage === STAGE_STARTED) {
      quest.setStage(player, STAGE_UNDOR);
      return UNDOR_BEFORE_IGNISIA_VARIANT;
    }
    if (stage === STAGE_UNDOR) return UNDOR_BEFORE_IGNISIA_VARIANT;
    if (stage < STAGE_HAS_HAMMER) {
      if (!hasFlag(player, FLAG_BRIEFED)) {
        setFlag(player, FLAG_BRIEFED);
        return UNDOR_AFTER_IGNISIA_VARIANT;
      }
      return UNDOR_AGAIN_VARIANT;
    }
    if (stage === STAGE_HAS_HAMMER) {
      return held(player, DINHS_HAMMER_ITEM_ID) ? UNDOR_HANDOVER_VARIANT : UNDOR_AGAIN_VARIANT;
    }
    if (stage === STAGE_HAMMER_GIVEN) return UNDOR_HANDOVER_AGAIN_VARIANT;
    return null;
  }

  function selectAssemblyVariant(npcId, player, stage) {
    if (stage >= STAGE_COMPLETE) {
      return npcId === LADY_VULCANA_NPC_ID
        ? { page: "Lady Vulcana Lovakengj", variant: "standard-dialogue-after-the-forsaken-tower" }
        : { page: "Councillor Unkar", variant: "after-completing-the-forsaken-tower-quest" };
    }
    if (stage >= STAGE_HAMMER_GIVEN) return REWARD_VARIANT;
    if (stage >= STAGE_STARTED && npcId === COUNCILLOR_UNKAR_NPC_ID) return ASSEMBLY_AGAIN_VARIANT;
    return ASSEMBLY_VARIANT;
  }

  function selectVariant({ npcId, player }) {
    if (ASSEMBLY_NPC_IDS.has(npcId)) return selectAssemblyVariant(npcId, player, quest.getStage(player));
    if (UNDOR_NPC_IDS.has(npcId)) return selectUndorVariant(player, quest.getStage(player));
    return null;
  }

  function answerCondition({ npcId, player, stepId }) {
    if (!ASSEMBLY_NPC_IDS.has(npcId)) return null;
    if (stepId === NO_REQUIREMENTS_CONDITION_ID) return !requirementsMet(player);
    if (stepId === HAS_REQUIREMENTS_CONDITION_ID) return requirementsMet(player);
    return null;
  }

  /** Fill the wiki's "[player name]" and "[laddie/lass]" / "[laddie/lassie]" blanks. */
  function fillTranscriptBlanks(request) {
    if (!request?.player || typeof request.text !== "string") return;
    if (!QUEST_NPC_IDS.has(request.npcId)) return;
    let text = request.text;
    if (text.includes("[player name]")) {
      text = text.replace(/\[player name\]/gi, String(request.player.getDisplayName()));
    }
    if (/\[laddie\/lass/i.test(text)) {
      const female = request.player.getAppearance?.()?.getLook?.()[GENDER_LOOK_SLOT] === 1;
      text = text.replace(/\[laddie\/(lass(?:ie)?)\]/gi, (_match, lassie) => (female ? lassie : "laddie"));
    }
    request.text = text;
  }

  function handleDialogueChoice({ npcId, player, option }) {
    if (!ASSEMBLY_NPC_IDS.has(npcId) || option !== ACCEPT_OPTION) return;
    if (quest.getStage(player) === 0 && requirementsMet(player)) {
      quest.setStage(player, STAGE_STARTED);
      maybeUnlockCase(player);
    }
  }

  function takeJugFromCupboard(player, itemId) {
    if (held(player, itemId)) return;
    if (freeSlots(player) < 1) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    player.getInventory().adds(itemId, 1);
    setFlag(player, FLAG_JUGS);
    sendVarbit(player, VARBIT_FOUND_JUGS, 1);
  }

  function handleDialogueAction(event) {
    const { player, stepId } = event;
    switch (stepId) {
      case START_MARKER_ID:
        // The wiki "Start The Forsaken Tower quest?" prompt is not an action; let the
        // accept menu after it play.
        event.handled = true;
        return;
      case CRANK_MESSAGE_ID:
        if (!hasFlag(player, FLAG_CRANK)) {
          if (freeSlots(player) < 1) {
            event.handled = true;
            player.sendMessage("You don't have enough inventory space to take the crank.");
            return;
          }
          player.getInventory().adds(GENERATOR_CRANK_ITEM_ID, 1);
          setFlag(player, FLAG_CRANK);
          setElectricity(player, 1);
          sendVarbit(player, VARBIT_FOUND_CRANK, 1);
        }
        return;
      case STEAM_CRANK_MISSING_ID:
        if (hasCrank(player) || getElectricity(player) >= 1) event.handled = true;
        return;
      case STEAM_HAS_CRANK_ID:
        if (!hasCrank(player) && getElectricity(player) < 1) event.handled = true;
        return;
      case STEAM_START_ID:
        if (!hasCrank(player)) {
          event.handled = true;
          player.sendMessage("You need a crank to start the generator.");
          return;
        }
        setElectricity(player, 2);
        return;
      case GRID_NOT_ALIGNED_ID:
        if (getElectricity(player) < 2) event.handled = true;
        return;
      case GRID_ALIGNED_ID:
        if (getElectricity(player) < 2) {
          event.handled = true;
          return;
        }
        setElectricity(player, ELECTRICITY_ALIGNED);
        return;
      case CUPBOARD_BASE_ID:
        if (hasFlag(player, FLAG_JUGS)) event.handled = true;
        return;
      case CUPBOARD_JUG_5_ID:
        if (held(player, FIVE_GALLON_JUG_ITEM_ID)) {
          event.handled = true;
          return;
        }
        takeJugFromCupboard(player, FIVE_GALLON_JUG_ITEM_ID);
        return;
      case CUPBOARD_JUG_8_ID:
        if (held(player, EIGHT_GALLON_JUG_ITEM_ID)) {
          event.handled = true;
          return;
        }
        takeJugFromCupboard(player, EIGHT_GALLON_JUG_ITEM_ID);
        return;
      case CUPBOARD_BOTH_ID:
        takeJugFromCupboard(player, FIVE_GALLON_JUG_ITEM_ID);
        takeJugFromCupboard(player, EIGHT_GALLON_JUG_ITEM_ID);
        return;
      case REFINERY_BASE_ID:
        return;
      case REFINERY_DIRTY_ID:
        if (getRefinery(player) < REFINERY_CLEANSED) setRefinery(player, REFINERY_NEEDS_CLEANSE);
        return;
      case REFINERY_CLEANSED_ID:
        event.handled = !cleanseRefinery(player);
        return;
      case HAMMER_TAKEN_ID:
        if (!hasFlag(player, FLAG_HAMMER) || !held(player, DINHS_HAMMER_ITEM_ID)) {
          if (freeSlots(player) < 1) {
            event.handled = true;
            player.sendMessage("You need more inventory space to take the hammer.");
            return;
          }
          player.getInventory().adds(DINHS_HAMMER_ITEM_ID, 1);
          setFlag(player, FLAG_HAMMER);
          sendVarbit(player, VARBIT_FOUND_HAMMER, 1);
          if (quest.getStage(player) < STAGE_HAS_HAMMER) quest.setStage(player, STAGE_HAS_HAMMER);
        }
        return;
      case HAMMER_GIVEN_ID:
        player.getInventory().deleteNumber(DINHS_HAMMER_ITEM_ID, 1);
        if (quest.getStage(player) < STAGE_HAMMER_GIVEN) quest.setStage(player, STAGE_HAMMER_GIVEN);
        return;
      case COMPLETE_ACTION_ID:
        event.handled = true;
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      default:
        return;
    }
  }

  function handleIgnisiaTalk(event) {
    if (event.npcId !== IGNISIA_NPC_ID) return false;
    if (quest.getStage(event.player) === STAGE_UNDOR) quest.setStage(event.player, STAGE_IGNISIA);
    return false; // keep the shared Ignisia transcript
  }

  // ---------------------------------------------------------------------------
  // Tower objects
  // ---------------------------------------------------------------------------

  function handleDisplayCaseInspect(event) {
    if (resolvedObjectId(event) !== ObjectIdentifiers.DISPLAY_CASE_54) return false;
    cleansingFluidId(event.player);
    startTranscript(api, event.player, LADY_VULCANA_NPC_ID, PAGE, DISPLAY_CASE_VARIANT);
    return true;
  }

  function handleDisplayCaseSearch(event) {
    const childId = resolvedObjectId(event);
    const { player } = event;
    if (childId === ObjectIdentifiers.DISPLAY_CASE_55) {
      if (freeSlots(player) < 1) {
        player.sendMessage("You need more inventory space.");
        return true;
      }
      startTranscript(api, player, LADY_VULCANA_NPC_ID, PAGE, HAMMER_VARIANT);
      return true;
    }
    if (childId === ObjectIdentifiers.DISPLAY_CASE_56) {
      if (!held(player, DINHS_HAMMER_ITEM_ID)) {
        player.getInventory().adds(DINHS_HAMMER_ITEM_ID, 1);
        player.sendMessage("The display case contains an old ornate hammer made of some strange metal. You take it.");
        return true;
      }
      player.sendMessage("The display case is empty.");
      return true;
    }
    return false;
  }

  function handleSteamGeneratorInspect(event) {
    if (resolvedObjectId(event) !== ObjectIdentifiers.STEAM_GENERATOR_2) return false;
    startTranscript(api, event.player, LADY_VULCANA_NPC_ID, PAGE, STEAM_GENERATOR_VARIANT);
    return true;
  }

  function handleSteamGeneratorStart(event) {
    const { player } = event;
    if (getElectricity(player) < 1 || !hasCrank(player)) return false;
    setElectricity(player, 2);
    player.sendMessage("You use the crank to start up the generator.");
    return true;
  }

  function handlePowerGridInspect(event) {
    if (resolvedObjectId(event) !== ObjectIdentifiers.POWER_GRID) return false;
    const { player } = event;
    if (getElectricity(player) < 2) {
      player.sendMessage("It's an old power grid. It doesn't seem to be receiving any power.");
      return true;
    }
    setElectricity(player, 3);
    startTranscript(api, player, LADY_VULCANA_NPC_ID, PAGE, POWER_GRID_VARIANT);
    return true;
  }

  function handlePowerGridAlign(event) {
    if (resolvedObjectId(event) !== ObjectIdentifiers.POWER_GRID_2) return false;
    setElectricity(event.player, ELECTRICITY_ALIGNED);
    event.player.sendMessage("You successfully align the power grid.");
    return true;
  }

  function handleFurnaceInspect(event) {
    if (resolvedObjectId(event) !== ObjectIdentifiers.FURNACE_23) return false;
    event.player.sendMessage("It's an old furnace. There's a coolant mechanism attached to it.");
    return true;
  }

  function handleFurnaceLight(event) {
    if (resolvedObjectId(event) !== ObjectIdentifiers.FURNACE_24) return false;
    const { player } = event;
    if (getFurnace(player) < FURNACE_COOLED) {
      player.sendMessage("The furnace isn't ready to be lit yet.");
      return true;
    }
    if (!held(player, TINDERBOX_ITEM_ID)) {
      player.sendMessage("You need a tinderbox to light the furnace.");
      return true;
    }
    setFurnace(player, FURNACE_LIT);
    player.sendMessage("You light the furnace.");
    return true;
  }

  function handleCoolantDispenserFillJug(event) {
    if (resolvedObjectId(event) !== ObjectIdentifiers.COOLANT_DISPENSER) return false;
    fillJug(event.player);
    return true;
  }

  function handleCupboardSearch(event) {
    const childId = resolvedObjectId(event);
    const { player } = event;
    if (JUG_CUPBOARD_OBJECT_IDS.has(childId)) {
      if (hasFlag(player, FLAG_JUGS)) {
        player.sendMessage("The cupboard is empty.");
        return true;
      }
      if (!held(player, TINDERBOX_ITEM_ID)) {
        if (freeSlots(player) < 1) {
          player.sendMessage("You need more inventory space.");
          return true;
        }
        player.getInventory().adds(TINDERBOX_ITEM_ID, 1);
        player.sendMessage("You also find a tinderbox in the cupboard.");
      }
      startTranscript(api, player, LADY_VULCANA_NPC_ID, PAGE, CUPBOARD_VARIANT);
      return true;
    }
    if (childId === NOTES_CUPBOARD_OBJECT_ID) {
      if (!hasFlag(player, FLAG_NOTES)) {
        if (freeSlots(player) < 1) {
          player.sendMessage("You need more inventory space.");
          return true;
        }
        player.getInventory().adds(OLD_NOTES_ITEM_ID, 1);
        setFlag(player, FLAG_NOTES);
        sendVarbit(player, VARBIT_FOUND_NOTES, 1);
        player.sendMessage("You search the cupboard and find some old notes.");
        return true;
      }
      player.sendMessage("The cupboard is empty.");
      return true;
    }
    return false;
  }

  function handleCrateSearch(event) {
    const childId = resolvedObjectId(event);
    const { player } = event;
    if (CRANK_CRATE_OBJECT_IDS.has(childId)) {
      if (!hasFlag(player, FLAG_CRANK) && getElectricity(player) === 0) {
        if (freeSlots(player) < 1) {
          player.sendMessage("You need more inventory space.");
          return true;
        }
        startTranscript(api, player, LADY_VULCANA_NPC_ID, PAGE, CRANK_VARIANT);
        return true;
      }
      player.sendMessage("You search the crate but find nothing.");
      return true;
    }
    if (childId === LETTER_CRATE_OBJECT_ID) {
      if (!hasFlag(player, FLAG_LETTER)) {
        if (freeSlots(player) < 1) {
          player.sendMessage("You need more inventory space.");
          return true;
        }
        player.getInventory().adds(ANCIENT_LETTER_ITEM_ID, 1);
        setFlag(player, FLAG_LETTER);
        sendVarbit(player, VARBIT_HIDDEN_NOTE, 1);
        player.sendMessage("You search the crate and find an ancient letter.");
        return true;
      }
      player.sendMessage("You search the crate but find nothing.");
      return true;
    }
    return false;
  }

  function handleRefineryInspect(event) {
    if (resolvedObjectId(event) !== ObjectIdentifiers.REFINERY) return false;
    startTranscript(api, event.player, LADY_VULCANA_NPC_ID, PAGE, REFINERY_VARIANT);
    return true;
  }

  function handleRefineryCleanse(event) {
    if (resolvedObjectId(event) !== ObjectIdentifiers.REFINERY_2) return false;
    if (cleanseRefinery(event.player)) {
      event.player.sendMessage("You pour the fluid into the refinery. The warning on the control panel disappears.");
    }
    return true;
  }

  function handleRefineryActivate(event) {
    if (resolvedObjectId(event) !== ObjectIdentifiers.REFINERY_3) return false;
    const { player } = event;
    if (getRefinery(player) >= REFINERY_CLEANSED) {
      setRefinery(player, REFINERY_ACTIVE);
      player.sendMessage("You activate the refinery.");
      return true;
    }
    setRefinery(player, REFINERY_NEEDS_CLEANSE);
    player.sendMessage("You attempt to activate the refinery but nothing happens. A warning on the control panel reads 'Foreign objects detected, refinery must be cleansed.'");
    return true;
  }

  function handleTableTakeFrom(event) {
    if (resolvedObjectId(event) !== ObjectIdentifiers.TABLE_270) return false;
    const { player } = event;
    if (quest.getStage(player) < STAGE_STARTED) return false;
    if (freeSlots(player) < 1) {
      player.sendMessage("You need more inventory space.");
      return true;
    }
    const index = readInt(player, FLUID_TAKEN_ATTRIBUTE) % UNKNOWN_FLUID_IDS.length;
    player.getInventory().adds(UNKNOWN_FLUID_IDS[index], 1);
    player.setAttribute(FLUID_TAKEN_ATTRIBUTE, index + 1);
    cleansingFluidId(player);
    player.sendMessage("You take a bottle of unknown fluid from the table.");
    return true;
  }

  function handlePylonRebalance(event) {
    const index = PYLON_MULTILOC_BY_INDEX.indexOf(event.objectId);
    if (index === -1) return false;
    const { player } = event;
    if (quest.getStage(player) < STAGE_STARTED) return false;
    if (!hasFlag(player, FLAG_PYLONS_STARTED)) {
      setFlag(player, FLAG_PYLONS_STARTED);
      sendVarbit(player, VARBIT_PYLON_SETUP, 1);
      savePylons(player, [PYLON_ALL_DISKS, 0, 0]);
    }
    const masks = pylonMasks(player);
    const carried = readInt(player, HELD_DISK_ATTRIBUTE);
    if (carried) {
      const top = topDisk(masks[index]);
      if (top !== 0 && carried > top) {
        player.sendMessage("That energy disk is too large to place there.");
        return true;
      }
      masks[index] |= 1 << (carried - 1);
      player.setAttribute(HELD_DISK_ATTRIBUTE, 0);
    } else {
      const disk = topDisk(masks[index]);
      if (disk === 0) {
        player.sendMessage("There are no energy disks on this pylon.");
        return true;
      }
      masks[index] &= ~(1 << (disk - 1));
      player.setAttribute(HELD_DISK_ATTRIBUTE, disk);
    }
    savePylons(player, masks);
    if (masks[0] === 0 && masks[1] === PYLON_ALL_DISKS && masks[2] === 0) {
      setAltar(player, ALTAR_CHARGED);
      player.sendMessage("The pylons hum with power, and the runic altar glows.");
    }
    return true;
  }

  function handlePylonReset(event) {
    if (!ENERGY_PYLON_MULTILOC_IDS.has(event.objectId)) return false;
    savePylons(event.player, [PYLON_ALL_DISKS, 0, 0]);
    event.player.setAttribute(HELD_DISK_ATTRIBUTE, 0);
    event.player.sendMessage("The pylons reset to their original positions.");
    return true;
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (itemId === FIVE_GALLON_JUG_ITEM_ID && objectId === COOLANT_DISPENSER_MULTILOC) {
      event.handled = true;
      fillJug(player);
      return;
    }
    if (itemId === FIVE_GALLON_JUG_ITEM_ID && objectId === FURNACE_COOLANT_MULTILOC) {
      event.handled = true;
      pourJug(player);
      return;
    }
    if (UNKNOWN_FLUID_IDS.includes(itemId) && objectId === REFINERY_MULTILOC) {
      event.handled = true;
      if (cleanseRefinery(player)) {
        player.sendMessage("You pour the fluid into the refinery. The warning on the control panel disappears.");
      }
    }
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);
    if (!pair.has(FIVE_GALLON_JUG_ITEM_ID) || !pair.has(EIGHT_GALLON_JUG_ITEM_ID)) return;
    event.handled = true;
    const five = jugAmount(player, FIVE_GALLON_JUG_ITEM_ID);
    const eight = jugAmount(player, EIGHT_GALLON_JUG_ITEM_ID);
    if (usedItemId === FIVE_GALLON_JUG_ITEM_ID) {
      const poured = Math.min(five, JUG_CAPACITY_8 - eight);
      setJugAmount(player, FIVE_GALLON_JUG_ITEM_ID, five - poured);
      setJugAmount(player, EIGHT_GALLON_JUG_ITEM_ID, eight + poured);
    } else {
      const poured = Math.min(eight, JUG_CAPACITY_5 - five);
      setJugAmount(player, EIGHT_GALLON_JUG_ITEM_ID, eight - poured);
      setJugAmount(player, FIVE_GALLON_JUG_ITEM_ID, five + poured);
    }
    player.sendMessage("You pour the coolant between the jugs.");
  }

  function handleJugCheck(event) {
    const { player, itemId } = event;
    if (itemId !== FIVE_GALLON_JUG_ITEM_ID && itemId !== EIGHT_GALLON_JUG_ITEM_ID) return false;
    const label = itemId === FIVE_GALLON_JUG_ITEM_ID ? "5-gallon" : "8-gallon";
    const contents = jugAmount(player, itemId);
    api.sendMultiChatboxPrompt(
      player,
      `The ${label} jug contains ${contents} gallons.`,
      "Empty the jug.",
      () => emptyJug(player, itemId),
      "Leave it.",
      () => {}
    );
    return true;
  }

  function readOldNotes(event) {
    if (event.itemId !== OLD_NOTES_ITEM_ID) return false;
    const index = UNKNOWN_FLUID_IDS.indexOf(cleansingFluidId(event.player)) + 1;
    event.player.sendMessage(`The old notes describe a cleansing fluid: it is potion number ${index}.`);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Journal / rewards / login
  // ---------------------------------------------------------------------------

  function machineLine(label, done, remaining) {
    return done
      ? `<str>${label}</str>`
      : remaining;
  }

  function buildJournal(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Lady Lovakengj asked me to help Undor investigate</str>",
        "<str>the failing Doors of Dinh.</str>",
        "<str>I recovered Dinh's Hammer from the Forsaken Tower and</str>",
        "<str>gave it to Undor so he could repair the Doors.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage <= 0) {
      return [
        "I can start this quest by talking to <col=800000>Lady Vulcana",
        "Lovakengj</col> in the <col=800000>Lovakengj Assembly</col>.",
        "",
        "I must have completed <col=800000>Client of Kourend</col>.",
      ];
    }
    const lines = [
      "<str>Lady Lovakengj asked me to help Undor investigate</str>",
      "<str>the failing Doors of Dinh.</str>",
      "",
    ];
    if (stage === STAGE_STARTED) {
      lines.push("I should speak to <col=800000>Undor</col> outside the", "<col=800000>Doors of Dinh</col>, north of Arceuus.");
      return lines;
    }
    if (stage === STAGE_UNDOR) {
      lines.push("Undor is finishing a job; I should talk to", "<col=800000>Ignisia</col> at the Wintertodt Camp while I wait.");
      return lines;
    }
    if (stage <= STAGE_HAS_HAMMER) {
      lines.push("Undor needs <col=800000>Dinh's Hammer</col> from the", "<col=800000>Forsaken Tower</col> west of Lovakengj.", "");
      lines.push(machineLine("I have powered the steam generator and aligned the power grid.", getElectricity(player) >= ELECTRICITY_ALIGNED, "The power grid still needs aligning."));
      lines.push(machineLine("I have cooled and lit the furnace.", getFurnace(player) >= FURNACE_LIT, "The furnace still needs coolant and lighting."));
      lines.push(machineLine("I have cleansed and activated the refinery.", getRefinery(player) >= REFINERY_ACTIVE, "The refinery still needs cleansing."));
      lines.push(machineLine("I have solved the energy pylons.", getAltar(player) >= ALTAR_CHARGED, "The energy pylons still need solving."));
    }
    if (stage === STAGE_CASE) {
      lines.push("", "The display case is unlocked. I should take", "<col=800000>Dinh's Hammer</col> from it.");
    }
    if (stage === STAGE_HAS_HAMMER) {
      lines.push("", "I should bring <col=800000>Dinh's Hammer</col> to <col=800000>Undor</col>", "outside the Doors of Dinh.");
    }
    if (stage >= STAGE_HAMMER_GIVEN) {
      lines.push("", "I should return to <col=800000>Lady Lovakengj</col> and tell her", "that Undor can repair the Doors.");
    }
    return lines;
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.MINING, REWARD_XP);
    skills.addExperiences(Skill.SMITHING, REWARD_XP);
    // registerQuest adds the first coin; top the stack up to the wiki's 6,000.
    player.getInventory().adds(COINS_ITEM_ID, REWARD_COINS - 1);
    sendVarbit(player, VARBIT_REWARD, 1);
    sendVarbit(player, VARBIT_FAVOUR, 1);
  }

  function restoreVarbits(player) {
    sendVarbit(player, VARBIT_STAGE, quest.getStage(player));
    sendVarbit(player, VARBIT_ELECTRICITY, getElectricity(player));
    sendVarbit(player, VARBIT_FURNACE, getFurnace(player));
    sendVarbit(player, VARBIT_REFINERY, getRefinery(player));
    sendVarbit(player, VARBIT_ALTAR, getAltar(player));
    const masks = pylonMasks(player);
    sendVarbit(player, VARBIT_PYLON_1, masks[0]);
    sendVarbit(player, VARBIT_PYLON_2, masks[1]);
    sendVarbit(player, VARBIT_PYLON_3, masks[2]);
    sendVarbit(player, VARBIT_FOUND_CRANK, hasFlag(player, FLAG_CRANK) ? 1 : 0);
    sendVarbit(player, VARBIT_FOUND_JUGS, hasFlag(player, FLAG_JUGS) ? 1 : 0);
    sendVarbit(player, VARBIT_FOUND_NOTES, hasFlag(player, FLAG_NOTES) ? 1 : 0);
    sendVarbit(player, VARBIT_FOUND_HAMMER, hasFlag(player, FLAG_HAMMER) ? 1 : 0);
    sendVarbit(player, VARBIT_HIDDEN_NOTE, hasFlag(player, FLAG_LETTER) ? 1 : 0);
    sendVarbit(player, VARBIT_PYLON_SETUP, hasFlag(player, FLAG_PYLONS_STARTED) ? 1 : 0);
    sendVarbit(player, VARBIT_FLUID_SETUP, readInt(player, FLUID_ATTRIBUTE) ? 1 : 0);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    restoreVarbits(player);
  }

  quest = registerQuest(api, {
    key: "the_forsaken_tower",
    name: "The Forsaken Tower",
    varpId: 2066, // "lovaquest"
    varbitId: VARBIT_STAGE, // 7796, bits 0-3
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.MINING.getIndex(), amount: REWARD_XP, label: "Mining" },
      { skillId: Skill.SMITHING.getIndex(), amount: REWARD_XP, label: "Smithing" },
    ],
    rewardItemId: COINS_ITEM_ID,
    rewardItemLabel: "6,000 Coins",
    otherRewards: ["Free use of the Lovakengj Minecart Network", "Jewellery of Jubilation page for Kharedst's memoirs"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", fillTranscriptBlanks);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onNpcInteraction("Ignisia", { "Talk-to": handleIgnisiaTalk });
  api.onObjectInteraction("Display Case", { Inspect: handleDisplayCaseInspect, Search: handleDisplayCaseSearch });
  api.onObjectInteraction("Steam Generator", { Inspect: handleSteamGeneratorInspect, Start: handleSteamGeneratorStart });
  api.onObjectInteraction("Power Grid", { Inspect: handlePowerGridInspect, Align: handlePowerGridAlign });
  api.onObjectInteraction("Furnace", { Inspect: handleFurnaceInspect, Light: handleFurnaceLight });
  api.onObjectInteraction("Coolant Dispenser", { "Fill-jug": handleCoolantDispenserFillJug });
  api.onObjectInteraction("Cupboard", { Search: handleCupboardSearch });
  api.onObjectInteraction("Crate", { Search: handleCrateSearch });
  api.onObjectInteraction("Crates", { Search: handleCrateSearch });
  api.onObjectInteraction("Refinery", {
    Inspect: handleRefineryInspect,
    Cleanse: handleRefineryCleanse,
    Activate: handleRefineryActivate,
  });
  api.onObjectInteraction("Table", { "Take-from": handleTableTakeFrom });
  api.onObjectInteraction("Energy Pylon", { Rebalance: handlePylonRebalance, Reset: handlePylonReset });
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction("5-gallon jug", { Check: handleJugCheck });
  api.onItemAction("8-gallon jug", { Check: handleJugCheck });
  api.onItemAction("Old notes", { Read: readOldNotes });
  api.onPlayerLogin(handleLogin);
};
