/**
 * Prying Times (members).
 *
 * The words come from the "Prying Times" transcript page; this plugin supplies the
 * variant selector for 'Squawking' Steve Beanie, the prose-condition answers, the
 * ledger-table and crate interactions, the crowbar hand-out from Thurgo, the drink
 * troll, the journal and the rewards.
 *
 * Stages (varbit 18317 "quest_pry", varp 4960 bits 0-6; the Wiki lists no values, so
 * the quest-helper stage map is the authority, corroborated in-cache by the cargo
 * hold's crowbar tool unlock at value 20 - sailing/Cargo.Sailing.js): 5 courier task accepted
 * (Steve writes it into the captain's log), 10 looty delivered, 15 Steve asks for a
 * 'special key', 20 crowbar made by Thurgo, 25 'key' shown to Steve (test the grog),
 * 30 told Steve the key works / open the crate, 35 complete (capture 3455 sets
 * 30 during the "About that crate..." talk and 35 on the completion action).
 * Sibling bits 18318 quest_pry_steve_log / 18319 quest_pry_thurgo_met /
 * 18320 quest_pry_reward are mirrored client-side as the stage reaches them.
 *
 * Thurgo is shared with The Knight's Sword (a Prying Times requirement), whose
 * variant hook is registered first and answers for him once it is complete. This
 * plugin therefore takes his Talk-to over only while the quest needs the crowbar and
 * replays the wiki's "making-a-key-talking-to-thurgo" variant itself; every other time
 * it falls through, so his Knight's Sword/standard dialogue is never stolen.
 *
 * Objects missing from this world's maps are placed at their quest-helper tiles on the
 * first login (the PorcineOfInterest pattern): ledger tables at Port Sarim (3049,3193)
 * and The Pandemonium (3068,2987), the floating grog crate north-west of The
 * Pandemonium (3013,2998), and Steve's locked crate behind the bar (3048,2965).
 * Steve Beanie (14968) is owner-spawned at (3050,2966).
 *
 * Rewards (OSRS Wiki): 1 Quest point, 1,000 Smithing XP, 800 Sailing XP, 25 sawmill
 * coupon (oak plank), ability to chart forgotten drinks and unlimited crowbars from
 * the crate of crowbars.
 *
 * Quest Helper models the delivery as port task 600 ("Pandemonium pirate looty delivery"),
 * so Steve writes that real task row into a free slot and the ordinary ledger tables in
 * Port Sarim and The Pandemonium take and deposit its crate.
 *
 * Gaps/approximations:
 * - The floating crate sits on the north-west shore so it is reachable on foot; "on
 *   deck" is standing near it, as a boat cannot be boarded there (no Sailing API in
 *   api.core either, so `Sailing.instanceAboard` is out of reach).
 * - The drink confirmation is wrapped in an "unavailable" wiki marker in the dump; the
 *   plugin expands that marker before replaying the variant, because the shared runtime
 *   would close the chat on it.
 * - The drink troll stays until killed or logout (logout clears it, like OSRS
 *   disembarking); Steve has no post-quest variant, so a completed player replays the
 *   "subsequent" one.
 */
module.exports = function registerPryingTimesQuest(api) {
  const {
    Equipment,
    GameObject,
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    ObjectManager,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, loadTranscripts, startTranscript } = require("../QuestRuntime");
  const portTasks = require("../../skills/sailing/porttasks/Common.PortTasks");
  portTasks.init(api);

  // NPCs (cache ids; NpcIdentifiers comments). Steve spawns as the base 14967,
  // whose cache transform (sailing_intro 18314) publishes 14968/14969.
  const STEVE_BASE_NPC_ID = 14967; // steve_beanie, multinpc 14968/14969
  const STEVE_NPC_ID = NpcIdentifiers.SQUAWKING_STEVE_BEANIE; // 14968
  const STEVE_NPC_ID_2 = NpcIdentifiers.SQUAWKING_STEVE_BEANIE_2; // 14969
  const THURGO_NPC_ID = NpcIdentifiers.THURGO; // 4733
  const DRINK_TROLL_NPC_ID = NpcIdentifiers.DRINK_TROLL; // 15164
  const STEVE_NPC_IDS = new Set([STEVE_NPC_ID, STEVE_NPC_ID_2]);

  // Items (cache ids; ItemIdentifiers comments).
  const CAPTAINS_LOG_ITEM_ID = ItemIdentifiers.CAPTAINS_LOG; // 31985
  const CRATE_OF_LOOTY_ITEM_ID = ItemIdentifiers.CRATE_OF_LOOTY; // 32808
  const CROWBAR_ITEM_ID = ItemIdentifiers.CROWBAR; // 31807
  const STOUT_ITEM_ID = ItemIdentifiers.BOTTLE_OF_FISH_BLADDER_STOUT; // 31833
  const SAWMILL_COUPON_ITEM_ID = ItemIdentifiers.SAWMILL_COUPON_OAK_PLANK_; // 32085
  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER; // 2347
  const IMCANDO_HAMMER_ITEM_ID = ItemIdentifiers.IMCANDO_HAMMER; // 25644
  const STEEL_BAR_ITEM_ID = ItemIdentifiers.STEEL_BAR; // 2353
  const REDBERRY_PIE_ITEM_ID = ItemIdentifiers.REDBERRY_PIE; // 2325

  // Objects (cache ids; ObjectIdentifiers comments).
  const PORT_SARIM_LEDGER_ID = ObjectIdentifiers.LEDGER_TABLE_2; // 60320 Take-cargo
  const PANDEMONIUM_LEDGER_ID = ObjectIdentifiers.LEDGER_TABLE_3; // 60321 Deposit-cargo
  const GROG_CRATE_ID = ObjectIdentifiers.SEALED_CRATE; // 58405 Open
  const STEVE_CRATE_ID = ObjectIdentifiers.SEALED_CRATE_2; // 59283 Pry-open
  const CROWBAR_CRATE_ID = ObjectIdentifiers.CRATE_OF_CROWBARS; // 58406 Take-from

  const VARP = 4960; // "quest_pry_main"
  const VARBIT_STAGE = 18317; // quest_pry, varp 4960 bits 0-6
  const VARBIT_STEVE_LOG = 18318; // quest_pry_steve_log, bit 7
  const VARBIT_THURGO_MET = 18319; // quest_pry_thurgo_met, bit 8
  const VARBIT_REWARD = 18320; // quest_pry_reward, bit 9
  const VARBIT_CHARTED_DRINK = 18585; // sailing charting: prying times drink complete

  const STAGE_ACCEPTED = 5;
  const STAGE_DELIVERED = 10;
  const STAGE_TOLD_STEVE = 15;
  const STAGE_HAS_CROWBAR = 20;
  const STAGE_TEST_KEY = 25;
  const STAGE_OPEN_CRATE = 30;
  const STAGE_COMPLETE = 35;

  const DELIVERY_TASK_ID = 600; // port-tasks.json "Pandemonium pirate looty delivery"

  const START_LEVEL_SMITHING = 30;
  const START_LEVEL_SAILING = 12;
  const RECOMMENDED_COMBAT = 10;
  const SMITHING_XP = 1000;
  const SAILING_XP = 800;
  const SAWMILL_COUPONS = 25;

  const PAGE = "Prying Times";

  // Variant names (npc-dialogues.json, "Prying Times" page).
  const STEVE_START_VARIANT = "starting-off";
  const STEVE_LOG_PENDING_VARIANT = "starting-off-talking-to-steave-beanie-again-before-he-writes-in-the-log";
  const STEVE_SUBSEQUENT_VARIANT = "starting-off-subsequent-dialogue-with-squawking-steve-beanie";
  const STEVE_HOLDING_LOOTY_VARIANT = "retrieving-and-depositing-the-pirate-looty-talking-to-steve-beanie-while-holding-the-looty";
  const STEVE_DELIVERED_VARIANT = "retrieving-and-depositing-the-pirate-looty-talking-to-squawking-steve-beanie";
  const STEVE_ABOUT_CRATE_VARIANT = "retrieving-and-depositing-the-pirate-looty-talking-to-squawking-steve-beanie-talking-to-squawking-steve-beanie-again";
  const STEVE_WITH_SPECIAL_KEY_VARIANT = "making-a-key-talking-to-steve-beanie-with-the-special-key";
  const STEVE_MAKING_KEY_AGAIN_VARIANT = "making-a-key-talking-to-steve-beanie-again";
  const STEVE_WITH_GROG_VARIANT = "the-grog-talking-to-steve-beanie-with-the-grog";
  const STEVE_AFTER_DRINKING_VARIANT = "the-grog-talking-to-steve-beanie-after-drinking-the-grog";
  const STEVE_GROG_SUBSEQUENT_VARIANT = "the-grog-subsequent-dialogue-with-steve-beanie";
  const THURGO_MAKE_VARIANT = "making-a-key-talking-to-thurgo";
  const INSPECT_CROWBAR_VARIANT = "making-a-key-inspecting-the-crowbar";
  const FINAL_CRATE_NOT_READY_VARIANT = "making-a-key-attempting-to-open-the-crate-before-talking-with-steve";
  const GROG_OPEN_VARIANT = "the-grog-reaching-the-sealed-crate";
  const GROG_DRINK_VARIANT = "the-grog-drinking-the-bottle-of-fish-bladder-stout";
  const FINAL_CRATE_VARIANT = "finishing-up-opening-the-crate-next-to-steve-beanie";

  // Condition step ids on the "Prying Times" page (research pack).
  const START_REQUIREMENTS_CONDITION_ID = "aifq0J";
  const START_COMBAT_CONDITION_ID = "iQa-sh";
  const START_NO_LOG_CONDITION_ID = "KQdAeL";
  const START_MAX_TASKS_CONDITION_ID = "PSw89b";
  const START_NO_LOG_AGAIN_CONDITION_ID = "gOV6qS";
  const START_MAX_TASKS_AGAIN_CONDITION_ID = "RnrmQY";
  const THURGO_MATERIALS_CONDITION_ID = "yj685s";
  const GROG_NO_CROWBAR_CONDITION_ID = "jRVn_M";
  const GROG_NO_SPACE_CONDITION_ID = "RUI6jN";
  const GROG_HAS_STOUT_CONDITION_ID = "fMx2Sg";
  const GROG_ON_LAND_CONDITION_ID = "iskMgS";
  const FINAL_NO_CROWBAR_CONDITION_ID = "SquvVf";
  const FINAL_HAS_SPACE_CONDITION_ID = "quxPxY";

  // Message/action step ids whose side effects this plugin performs.
  const ACCEPTED_MESSAGE_ID = "nbTB-L";
  const ACCEPTED_AGAIN_MESSAGE_ID = "g6tGbJ";
  const THURGO_CROWBAR_ACTION_ID = "e2Ow6O";
  const GROG_TAKE_STOUT_MESSAGE_ID = "Gyue8X";
  const GROG_DRINK_MESSAGE_ID = "PkEAX6";
  const GROG_TROLL_MESSAGE_ID = "bivi2Q";
  const GROG_CHARTED_MESSAGE_ID = "98CGQt";
  const FINAL_CROWBAR_MESSAGE_ID = "eoE1Ay";
  const COMPLETE_ACTION_ID = "rP9tMj";

  // Option texts the side effects key on.
  const START_YES_OPTION = "Yes.";
  const DELIVERED_OPTION = "I delivered that cargo for you.";
  const SPECIAL_KEY_OPTION = "I made that 'special key' you needed.";
  const ABOUT_CRATE_OPTION = "About that crate...";
  const THURGO_SPECIAL_KEY_OPTION = "I need some help with a 'special key'.";

  // Quest-only scenery tiles (quest-helper positions; objects absent from the maps).
  const PORT_SARIM_LEDGER_TILE = { x: 3049, y: 3193 };
  const PANDEMONIUM_LEDGER_TILE = { x: 3068, y: 2987 };
  const GROG_CRATE_TILE = { x: 3013, y: 2998 };
  const STEVE_CRATE_TILE = { x: 3048, y: 2965 };
  const STEVE_SPAWN = { x: 3050, y: 2966 };
  const GROG_CRATE_DECK_RANGE = 12; // the deck can use a main-world loc within 12 tiles
  const FINE_UNITS_PER_TILE = 128; // Boat.fineX/fineY are 128ths of a world tile
  const VARBIT_BOARDED_BOAT = 19136;

  const STEVE_LOG_ATTRIBUTE = "prying-times:steve-log";
  const DELIVERY_ASSIGNED_ATTRIBUTE = "prying-times:delivery-assigned";
  const DELIVERY_BASELINE_ATTRIBUTE = "prying-times:delivery-baseline";
  const STAGE_VERSION_ATTRIBUTE = "prying-times:stage-v2";
  const THURGO_MET_ATTRIBUTE = "prying-times:thurgo-met";
  const DRANK_STOUT_ATTRIBUTE = "prying-times:drank-stout";
  const TOLD_STEVE_ATTRIBUTE = "prying-times:told-steve";

  let quest;
  let transcriptPage;
  let questObjectsInstalled = false;
  let finalCrateObject = null;
  const steveByPlayer = new WeakMap();
  const drinkTrollByPlayer = new WeakMap();

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const freeSlots = (player) => player.getInventory().getFreeSlots();

  function isSteve(npcId) {
    return STEVE_NPC_IDS.has(npcId);
  }

  /** Pandemonium must own Steve until its own quest is complete; then Prying starts. */
  function pandemoniumComplete(player) {
    const request = { player, key: "pandemonium", complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function questActive(player) {
    return quest.isStarted(player) && !quest.isComplete(player);
  }

  function steveLogWritten(player) {
    return player.getAttribute(STEVE_LOG_ATTRIBUTE) === true;
  }

  function drankStout(player) {
    return player.getAttribute(DRANK_STOUT_ATTRIBUTE) === true;
  }

  function toldSteve(player) {
    return player.getAttribute(TOLD_STEVE_ATTRIBUTE) === true;
  }

  function knightsSwordComplete(player) {
    const request = { player, key: "the_knights_sword", complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function hasOpenPortTaskSlot(player) {
    const request = { player, available: false };
    api.emitCustomEvent("sailing:has-port-task-slot", request);
    return request.available === true;
  }

  function meetsStartRequirements(player) {
    const skills = player.getSkillManager();
    const pandemonium = { player, key: "pandemonium", complete: false };
    api.emitCustomEvent("quest:is-complete", pandemonium);
    return (
      skills.getMaxLevel(Skill.SMITHING) >= START_LEVEL_SMITHING &&
      skills.getMaxLevel(Skill.SAILING) >= START_LEVEL_SAILING &&
      knightsSwordComplete(player) &&
      pandemonium.complete === true
    );
  }

  function hasCrowbarMaterials(player) {
    const weapon = player.getEquipment().get(Equipment.WEAPON_SLOT);
    const hammer =
      held(player, HAMMER_ITEM_ID) ||
      held(player, IMCANDO_HAMMER_ITEM_ID) ||
      weapon?.getId?.() === IMCANDO_HAMMER_ITEM_ID;
    return hammer && held(player, STEEL_BAR_ITEM_ID) && held(player, REDBERRY_PIE_ITEM_ID);
  }

  /** True when the player is on their own boat (sailing_boarded_boat). */
  function aboard(player) {
    const sender = player.getPacketSender?.();
    if (sender?.getVarbit?.(VARBIT_BOARDED_BOAT) === 1) return true;
    const state = player.getSailing?.();
    const boat = state?.boats?.find?.((entry) => entry.slot === state.activeBoatSlot);
    return boat?.location?.kind === "at_sea";
  }

  /** The boat's world tile at sea, or the player's tile when they are on foot. */
  function worldTile(player) {
    const state = player.getSailing?.();
    const boat = state?.boats?.find?.((entry) => entry.slot === state.activeBoatSlot);
    if (aboard(player) && boat?.location?.kind === "at_sea") {
      return { x: Math.floor(boat.location.fineX / FINE_UNITS_PER_TILE), y: Math.floor(boat.location.fineY / FINE_UNITS_PER_TILE) };
    }
    const location = player.getLocation();
    return { x: location.getX(), y: location.getY() };
  }

  function nearGrogCrate(player) {
    if (!aboard(player)) return false;
    const tile = worldTile(player);
    return Math.max(
      Math.abs(tile.x - GROG_CRATE_TILE.x),
      Math.abs(tile.y - GROG_CRATE_TILE.y)
    ) <= GROG_CRATE_DECK_RANGE;
  }

  function page() {
    if (transcriptPage === undefined) transcriptPage = loadTranscripts(api)?.[PAGE] ?? null;
    return transcriptPage;
  }

  // ==========================================================================
  // Variant selection and condition answers
  // ==========================================================================

  /** Which transcript variant Steve plays, by stage and carried items. */
  function selectVariant({ npcId, player }) {
    if (!isSteve(npcId)) return null;
    // Pandemonium is a prerequisite and its own hook returned Steve's post-quest
    // page for every eligible player. Yield until it is done, then own Steve;
    // once Prying is complete, yield back so Pandemonium's post-quest page plays.
    if (!pandemoniumComplete(player)) return null;
    if (quest.isComplete(player)) return null;
    const stage = quest.getStage(player);
    if (stage >= STAGE_OPEN_CRATE) return STEVE_SUBSEQUENT_VARIANT;
    if (stage >= STAGE_TEST_KEY) {
      if (!drankStout(player)) {
        return held(player, STOUT_ITEM_ID) ? STEVE_WITH_GROG_VARIANT : STEVE_MAKING_KEY_AGAIN_VARIANT;
      }
      return toldSteve(player) ? STEVE_GROG_SUBSEQUENT_VARIANT : STEVE_AFTER_DRINKING_VARIANT;
    }
    if (stage >= STAGE_HAS_CROWBAR) return STEVE_WITH_SPECIAL_KEY_VARIANT;
    if (stage >= STAGE_TOLD_STEVE) return STEVE_ABOUT_CRATE_VARIANT;
    if (stage >= STAGE_DELIVERED) return STEVE_DELIVERED_VARIANT;
    if (stage >= STAGE_ACCEPTED) {
      if (!steveLogWritten(player)) return STEVE_LOG_PENDING_VARIANT;
      if (deliveryDone(player)) {
        // Quest Helper stage 10 is "let Steve know"; the ledger cleared the task
        // row, so the conversation is due even before the player picks the line.
        if (stage < STAGE_DELIVERED) quest.setStage(player, STAGE_DELIVERED);
        return STEVE_DELIVERED_VARIANT;
      }
      return held(player, CRATE_OF_LOOTY_ITEM_ID) ? STEVE_HOLDING_LOOTY_VARIANT : STEVE_SUBSEQUENT_VARIANT;
    }
    return STEVE_START_VARIANT;
  }

  /** Answers the wiki prose conditions, scoped to the NPC that owns each step id. */
  function answerCondition({ npcId, player, stepId }) {
    if (npcId === THURGO_NPC_ID) {
      return stepId === THURGO_MATERIALS_CONDITION_ID ? !hasCrowbarMaterials(player) : null;
    }
    if (npcId === DRINK_TROLL_NPC_ID) {
      switch (stepId) {
        case GROG_NO_CROWBAR_CONDITION_ID:
          return !held(player, CROWBAR_ITEM_ID);
        case GROG_NO_SPACE_CONDITION_ID:
          return freeSlots(player) < 1;
        case GROG_HAS_STOUT_CONDITION_ID:
          return held(player, STOUT_ITEM_ID);
        case GROG_ON_LAND_CONDITION_ID:
          return !nearGrogCrate(player);
        default:
          return null;
      }
    }
    if (!isSteve(npcId)) return null;
    switch (stepId) {
      case START_REQUIREMENTS_CONDITION_ID:
        return !meetsStartRequirements(player);
      case START_COMBAT_CONDITION_ID:
        return player.getSkillManager().getCombatLevel() < RECOMMENDED_COMBAT;
      case START_NO_LOG_CONDITION_ID:
      case START_NO_LOG_AGAIN_CONDITION_ID:
        return !held(player, CAPTAINS_LOG_ITEM_ID);
      case START_MAX_TASKS_CONDITION_ID:
      case START_MAX_TASKS_AGAIN_CONDITION_ID:
        return !hasOpenPortTaskSlot(player);
      case FINAL_NO_CROWBAR_CONDITION_ID:
        return !held(player, CROWBAR_ITEM_ID);
      case FINAL_HAS_SPACE_CONDITION_ID:
        return freeSlots(player) >= 1;
      default:
        return null;
    }
  }

  // ==========================================================================
  // Dialogue side effects
  // ==========================================================================

  function deliverySlot(player) {
    return portTasks.slots(player).findIndex((slot) => slot?.id === DELIVERY_TASK_ID);
  }

  /** Quest Helper models the delivery as port task 600, so accept the real row. */
  function assignDeliveryTask(player) {
    if (deliverySlot(player) >= 0) return true;
    const slots = portTasks.slots(player);
    const free = slots.findIndex((slot) => !slot);
    if (free < 0) return false;
    slots[free] = { id: DELIVERY_TASK_ID, taken: 0, delivered: 0 };
    portTasks.setSlots(player, slots);
    return true;
  }

  function completedTotal(player) {
    return Number(player.getAttribute(portTasks.COMPLETED_ATTRIBUTE)?.total) || 0;
  }

  /**
   * The task row is cleared by the ledger table when the looty is delivered. A
   * cancellation clears it too, so require the completed-task counter to have
   * risen since acceptance (capture 3455 increments it).
   */
  function deliveryDone(player) {
    return player.getAttribute(DELIVERY_ASSIGNED_ATTRIBUTE) === true
      && deliverySlot(player) < 0
      && completedTotal(player) > (Number(player.getAttribute(DELIVERY_BASELINE_ATTRIBUTE)) || 0);
  }

  /** Steve writes the task into the captain's log. */
  function writeSteveLog(player) {
    if (!assignDeliveryTask(player)) {
      player.sendMessage("You can't take on any more port tasks right now.");
      return;
    }
    player.setAttribute(STEVE_LOG_ATTRIBUTE, true);
    player.setAttribute(DELIVERY_ASSIGNED_ATTRIBUTE, true);
    player.setAttribute(DELIVERY_BASELINE_ATTRIBUTE, completedTotal(player));
    player.getPacketSender().sendVarbit(VARBIT_STEVE_LOG, 1);
    if (quest.getStage(player) < STAGE_ACCEPTED) quest.setStage(player, STAGE_ACCEPTED);
  }

  function setThurgoMet(player) {
    player.setAttribute(THURGO_MET_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_THURGO_MET, 1);
  }

  /** "You hammer a crowbar out of your steel bar..." - consumes bar and pie. */
  function makeCrowbar(player) {
    if (!questActive(player) || quest.getStage(player) < STAGE_TOLD_STEVE) return;
    if (!hasCrowbarMaterials(player)) return;
    player.getInventory().deleteNumber(STEEL_BAR_ITEM_ID, 1);
    player.getInventory().deleteNumber(REDBERRY_PIE_ITEM_ID, 1);
    if (!held(player, CROWBAR_ITEM_ID)) player.getInventory().adds(CROWBAR_ITEM_ID, 1);
    setThurgoMet(player);
    if (quest.getStage(player) < STAGE_HAS_CROWBAR) quest.setStage(player, STAGE_HAS_CROWBAR);
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (typeof option !== "string") return;
    if (npcId === THURGO_NPC_ID) {
      if (option === THURGO_SPECIAL_KEY_OPTION) setThurgoMet(player);
      return;
    }
    if (!isSteve(npcId)) return;
    const stage = quest.getStage(player);
    if (option === START_YES_OPTION) {
      if (stage < STAGE_ACCEPTED) quest.setStage(player, STAGE_ACCEPTED);
      return;
    }
    if (option === DELIVERED_OPTION) {
      if (stage === STAGE_DELIVERED) quest.setStage(player, STAGE_TOLD_STEVE);
      return;
    }
    if (option === SPECIAL_KEY_OPTION) {
      if (stage >= STAGE_HAS_CROWBAR && stage < STAGE_TEST_KEY) quest.setStage(player, STAGE_TEST_KEY);
      return;
    }
    if (option === ABOUT_CRATE_OPTION) {
      if (stage >= STAGE_TEST_KEY && drankStout(player) && !toldSteve(player)) {
        player.setAttribute(TOLD_STEVE_ATTRIBUTE, true);
        player.setAttribute(STAGE_VERSION_ATTRIBUTE, true);
        quest.setStage(player, STAGE_OPEN_CRATE);
      }
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    switch (stepId) {
      case ACCEPTED_MESSAGE_ID:
      case ACCEPTED_AGAIN_MESSAGE_ID:
        if (isSteve(npcId)) writeSteveLog(player);
        return;
      case THURGO_CROWBAR_ACTION_ID:
        if (npcId !== THURGO_NPC_ID) return;
        event.handled = true;
        makeCrowbar(player);
        return;
      case GROG_TAKE_STOUT_MESSAGE_ID:
        if (!held(player, STOUT_ITEM_ID) && freeSlots(player) >= 1) {
          player.getInventory().adds(STOUT_ITEM_ID, 1);
        }
        return;
      case GROG_DRINK_MESSAGE_ID:
        if (held(player, STOUT_ITEM_ID)) player.getInventory().deleteNumber(STOUT_ITEM_ID, 1);
        player.setAttribute(DRANK_STOUT_ATTRIBUTE, true);
        return;
      case GROG_TROLL_MESSAGE_ID:
        spawnDrinkTroll(player);
        return;
      case GROG_CHARTED_MESSAGE_ID:
        player.getPacketSender().sendVarbit(VARBIT_CHARTED_DRINK, 1);
        return;
      case FINAL_CROWBAR_MESSAGE_ID:
        if (freeSlots(player) >= 1) player.getInventory().adds(CROWBAR_ITEM_ID, 1);
        return;
      case COMPLETE_ACTION_ID:
        event.handled = true;
        completeQuest(player);
        return;
      default:
    }
  }

  // ==========================================================================
  // Thurgo (shared with The Knight's Sword)
  // ==========================================================================

  /**
   * The Knight's Sword's variant hook is registered first and owns Thurgo once that
   * quest is complete, so Prying Times replays the wiki variant itself while the
   * crowbar is still needed. False hands him back to the normal transcript.
   */
  function thurgoTalkTo(event) {
    const { player, npcId } = event;
    if (npcId !== THURGO_NPC_ID || !questActive(player)) return false;
    if (quest.getStage(player) < STAGE_TOLD_STEVE) return false;
    startTranscript(api, player, THURGO_NPC_ID, PAGE, THURGO_MAKE_VARIANT);
    return true;
  }

  // ==========================================================================
  // Objects
  // ==========================================================================

  function registerQuestObject(objectId, tile) {
    const object = new GameObject(objectId, new Location(tile.x, tile.y, 0), 10, 0, null);
    ObjectManager.register(object, true);
    return object;
  }

  function installQuestObjects() {
    if (questObjectsInstalled) return;
    questObjectsInstalled = true;
    registerQuestObject(PORT_SARIM_LEDGER_ID, PORT_SARIM_LEDGER_TILE);
    registerQuestObject(PANDEMONIUM_LEDGER_ID, PANDEMONIUM_LEDGER_TILE);
    registerQuestObject(GROG_CRATE_ID, GROG_CRATE_TILE);
    finalCrateObject = registerQuestObject(STEVE_CRATE_ID, STEVE_CRATE_TILE);
  }

  /** Steve's locked crate becomes the crate of crowbars once the quest completes. */
  function replaceFinalCrate() {
    if (finalCrateObject) ObjectManager.deregister(finalCrateObject, true);
    finalCrateObject = registerQuestObject(CROWBAR_CRATE_ID, STEVE_CRATE_TILE);
  }

  function openGrogCrate(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) < STAGE_TEST_KEY || quest.isComplete(player)) return;
    if (!nearGrogCrate(player)) {
      player.sendMessage("You need to be on your boat at the crate to reach it.");
      return;
    }
    startTranscript(api, player, DRINK_TROLL_NPC_ID, PAGE, GROG_OPEN_VARIANT);
  }

  function openFinalCrate(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) < STAGE_OPEN_CRATE) {
      if (quest.isStarted(player) && !quest.isComplete(player)) {
        startTranscript(api, player, STEVE_NPC_ID, PAGE, FINAL_CRATE_NOT_READY_VARIANT);
      }
      return;
    }
    if (quest.isComplete(player)) return;
    startTranscript(api, player, STEVE_NPC_ID, PAGE, FINAL_CRATE_VARIANT);
  }

  function takeCrowbar(event) {
    const { player } = event;
    event.handled = true;
    if (freeSlots(player) < 1) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    player.getInventory().adds(CROWBAR_ITEM_ID, 1);
    player.sendMessage("You take a crowbar from the crate.");
  }

  function handleObjectInteraction(event) {
    const { player } = event;
    switch (event.objectId) {
      // The ledger tables are ordinary port-task ledgers: the sailing plugin's
      // "Ledger table" hooks take and deposit the crate. This generic hook runs
      // before them, so a deposit is confirmed a tick later (capture 3455: 5 -> 10).
      case PORT_SARIM_LEDGER_ID:
      case PANDEMONIUM_LEDGER_ID:
        if (quest.getStage(player) !== STAGE_ACCEPTED) return;
        if (portTasks.heldCrate(player) !== portTasks.taskById(DELIVERY_TASK_ID)?.crate) return;
        // This generic hook is registered before the sailing plugin's named
        // "Ledger table" hook, so on a deposit the task row is cleared after we
        // return. Re-check a tick later, where capture 3455 has the 5 -> 10 move.
        {
          const { CountdownTask, TaskManager } = api.core;
          TaskManager.submit(new CountdownTask(player, 1, () => {
            if (quest.getStage(player) === STAGE_ACCEPTED && deliveryDone(player)) {
              quest.setStage(player, STAGE_DELIVERED);
            }
          }));
        }
        return;
      case GROG_CRATE_ID:
        openGrogCrate(event);
        return;
      case STEVE_CRATE_ID:
        openFinalCrate(event);
        return;
      case CROWBAR_CRATE_ID:
        takeCrowbar(event);
        return;
      default:
    }
  }

  // ==========================================================================
  // The stout, the drink troll and the two item options
  // ==========================================================================

  /** Replaces wiki "unavailable" wrappers with their contents (the runtime closes on them). */
  function expandUnavailable(steps) {
    const out = [];
    for (const step of steps) {
      if (step.type === "unavailable" && Array.isArray(step.steps)) {
        out.push(...expandUnavailable(step.steps));
        continue;
      }
      const copy = { ...step };
      if (Array.isArray(copy.steps)) copy.steps = expandUnavailable(copy.steps);
      if (Array.isArray(copy.options)) {
        copy.options = copy.options.map((option) => ({
          ...option,
          steps: expandUnavailable(option.steps || []),
        }));
      }
      out.push(copy);
    }
    return out;
  }

  /**
   * The drink variant's confirmation is wrapped in an "unavailable" marker, so it is
   * replayed directly through the NpcDialogues runtime with that wrapper expanded;
   * the "on land" condition still resolves through onNpcDialogueCondition.
   */
  function playDrinkTranscript(player) {
    const record = page();
    const variant = record?.variants?.[GROG_DRINK_VARIANT];
    if (!Array.isArray(variant)) return;
    const { startDialogue: playDialogue } = require("../../npcs/NpcDialogues.plugin.js");
    const definition = api.core.NpcDefinition.forId(DRINK_TROLL_NPC_ID);
    const event = { player, npc: null, npcId: DRINK_TROLL_NPC_ID, definition };
    const context = {
      player,
      npc: null,
      npcId: DRINK_TROLL_NPC_ID,
      definition,
      pages: [{ page: PAGE, variants: [GROG_DRINK_VARIANT] }],
    };
    playDialogue(api, event, expandUnavailable(variant), record.branches, context);
  }

  function inspectCrowbar(event) {
    event.handled = true;
    const { player } = event;
    if (!questActive(player)) return;
    startTranscript(api, player, STEVE_NPC_ID, PAGE, INSPECT_CROWBAR_VARIANT);
  }

  function drinkStout(event) {
    event.handled = true;
    const { player } = event;
    if (!held(player, STOUT_ITEM_ID)) return;
    if (!questActive(player) && !quest.isComplete(player)) return;
    playDrinkTranscript(player);
  }

  function retryDrinkTroll(player, retries) {
    if (retries <= 0) return;
    const { CountdownTask, TaskManager } = api.core;
    if (!CountdownTask || !TaskManager) return;
    TaskManager.submit(new CountdownTask(player, 1, () => spawnDrinkTroll(player, retries - 1)));
  }

  function detachDrinkTroll(npc) {
    const area = npc?.getArea?.();
    if (!area) return;
    if (typeof area.remove === "function") area.remove(npc);
    else area.detach?.(npc);
  }

  function spawnDrinkTroll(player, retries = 2) {
    const existing = drinkTrollByPlayer.get(player);
    if (existing?.isRegistered?.()) return existing;
    drinkTrollByPlayer.delete(player);
    const boat = api.core.BoatManager?.getBoatAboard?.(player);
    const deck = boat ? api.core.BoatManager?.getDeck?.(boat) : undefined;
    if (!deck) {
      // The troll stands on the player's virtual deck; retry after the boarding tick.
      retryDrinkTroll(player, retries);
      return undefined;
    }
    const location = player.getLocation();
    const npc = api.spawnNpc({
      id: DRINK_TROLL_NPC_ID,
      x: location.getX(),
      y: location.getY(),
      z: location.getZ(),
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (!npc) {
      retryDrinkTroll(player, retries);
      return undefined;
    }
    deck.enter(npc);
    drinkTrollByPlayer.set(player, npc);
    return npc;
  }

  function handleNpcDeath(event) {
    if (event.npcId !== DRINK_TROLL_NPC_ID) return;
    const owner = event.npc?.getOwner?.();
    if (!owner) return;
    const troll = drinkTrollByPlayer.get(owner);
    if (troll === event.npc) {
      drinkTrollByPlayer.delete(owner);
      detachDrinkTroll(event.npc);
    }
  }

  // ==========================================================================
  // Completion, spawns and session lifecycle
  // ==========================================================================

  function completeQuest(player) {
    if (!quest.complete(player)) return;
    player.getPacketSender().sendVarbit(VARBIT_REWARD, 1);
    replaceFinalCrate();
  }

  function ensureSteve(player) {
    const existing = steveByPlayer.get(player);
    if (existing?.isRegistered?.()) return;
    const npc = api.spawnNpc({
      id: STEVE_BASE_NPC_ID,
      x: STEVE_SPAWN.x,
      y: STEVE_SPAWN.y,
      z: 0,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) steveByPlayer.set(player, npc);
  }

  /** Old completion was stage 30; the captured completion is 35. */
  function migrateStage(player) {
    if (player.getAttribute(STAGE_VERSION_ATTRIBUTE) === true) return;
    player.setAttribute(STAGE_VERSION_ATTRIBUTE, true);
    if (quest.getStage(player) === 30) {
      quest.setStage(player, STAGE_COMPLETE);
      player.getPacketSender().sendVarbit(VARBIT_REWARD, 1);
    }
  }

  function handleLogin({ player }) {
    migrateStage(player);
    refreshQuestList(player);
    installQuestObjects();
    ensureSteve(player);
    player.getPacketSender().sendVarbit(VARBIT_REWARD, quest.isComplete(player) ? 1 : 0);
    const stage = quest.getStage(player);
    if (drankStout(player) && stage >= STAGE_TEST_KEY && stage < STAGE_OPEN_CRATE) {
      spawnDrinkTroll(player);
    }
  }

  function handleLogout({ player }) {
    if (!player) return;
    const steve = steveByPlayer.get(player);
    if (steve) api.removeNpc(steve);
    steveByPlayer.delete(player);
    const troll = drinkTrollByPlayer.get(player);
    if (troll) {
      detachDrinkTroll(troll);
      api.removeNpc(troll);
    }
    drinkTrollByPlayer.delete(player);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Steve Beanie sent me to collect a crate of 'pirate looty'</str>",
        "<str>from Port Sarim, then had Thurgo forge me a crowbar.</str>",
        "<str>I tested it on a crate of grog (and met a drink troll),</str>",
        "<str>told Steve, and opened his crate full of crowbars.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_OPEN_CRATE) {
      return [
        "<str>Steve said I can take as many crowbars as I like.</str>",
        "",
        "I should open the <col=800000>crate</col> next to Steve.",
      ];
    }
    if (stage >= STAGE_TEST_KEY) {
      if (drankStout(player)) {
        return [
          "<str>I sampled the fish bladder stout from the sealed crate</str>",
          "<str>north-west of The Pandemonium and a drink troll attacked.</str>",
          "",
          "I should tell <col=800000>Steve Beanie</col> the 'key' works, then open",
          "the crate next to him.",
        ];
      }
      if (held(player, STOUT_ITEM_ID)) {
        return [
          "<str>The sealed crate held a bottle of fish bladder stout.</str>",
          "",
          "I should drink it back at the crate on deck, then tell",
          "<col=800000>Steve Beanie</col> on The Pandemonium.",
        ];
      }
      return [
        "<str>Steve wants the crowbar tested before it is used on his looty.</str>",
        "",
        "I should find the <col=800000>sealed crate</col> north-west of The",
        "<col=800000>Pandemonium</col> and pry it open with the crowbar.",
      ];
    }
    if (stage >= STAGE_HAS_CROWBAR) {
      return [
        "<str>Thurgo made me a crowbar out of my steel bar.</str>",
        "",
        "I should show the <col=800000>crowbar</col> to <col=800000>Steve Beanie</col>",
        "on The Pandemonium.",
      ];
    }
    if (stage >= STAGE_TOLD_STEVE) {
      return [
        "<str>Steve wants a 'special key' to open his crate of looty.</str>",
        "",
        "I should ask <col=800000>Thurgo</col> near Mudskipper Point to make",
        "a crowbar. He needs a <col=800000>hammer</col>, a <col=800000>steel bar</col>",
        "and a <col=800000>redberry pie</col>.",
      ];
    }
    if (stage >= STAGE_DELIVERED) {
      return [
        "<str>I delivered the crate of looty to The Pandemonium.</str>",
        "",
        "I should let <col=800000>Steve Beanie</col> know.",
      ];
    }
    if (stage >= STAGE_ACCEPTED) {
      if (!steveLogWritten(player)) {
        return [
          "<str>Steve wants to write his courier task in my captain's log.</str>",
          "",
          "I need my <col=800000>captain's log</col> for him.",
        ];
      }
      return [
        "<str>Steve Beanie gave me a pirate looty delivery task.</str>",
        "",
        "I should collect the <col=800000>crate of looty</col> from the ledger",
        "table in <col=800000>Port Sarim</col> and deposit it at the ledger",
        "table on <col=800000>The Pandemonium</col>.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>'Squawking' Steve",
      "Beanie</col> in <col=800000>The Pandemonium</col> pub.",
      "",
      "I need level 30 Smithing, level 12 Sailing and to have completed",
      "<col=800000>The Knight's Sword</col>.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.SMITHING, SMITHING_XP);
    skills.addExperiences(Skill.SAILING, SAILING_XP);
    // QuestRuntime adds the first coupon. Use the engine's normal reward
    // overflow (merge an existing stack, or drop at the reward tile) instead of
    // silently skipping the other 24 when the inventory is full.
    player.getInventory().forceAdd(
      player,
      new Item(SAWMILL_COUPON_ITEM_ID, SAWMILL_COUPONS - 1)
    );
  }

  api.persistAttribute(STEVE_LOG_ATTRIBUTE);
  api.persistAttribute(DELIVERY_ASSIGNED_ATTRIBUTE, false);
  api.persistAttribute(DELIVERY_BASELINE_ATTRIBUTE, 0);
  api.persistAttribute(STAGE_VERSION_ATTRIBUTE, false);
  api.persistAttribute(THURGO_MET_ATTRIBUTE);
  api.persistAttribute(DRANK_STOUT_ATTRIBUTE);
  api.persistAttribute(TOLD_STEVE_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "prying_times",
    name: "Prying Times",
    varpId: VARP,
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_ACCEPTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.SAILING.getIndex(), amount: SAILING_XP, label: "Sailing" },
      { skillId: Skill.SMITHING.getIndex(), amount: SMITHING_XP, label: "Smithing" },
    ],
    rewardItemId: SAWMILL_COUPON_ITEM_ID,
    rewardItemLabel: "25 Sawmill coupons (oak)",
    otherRewards: ["Access to charting forgotten drinks"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction("Thurgo", { "Talk-to": thurgoTalkTo });
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  // Optional shared hook from Ledger.PortTasks.complete (see the shared report):
  // removes the one-tick re-check after a deposit.
  api.onCustomEvent("sailing:port-task-completed", ({ player, task }) => {
    if (player && task?.id === DELIVERY_TASK_ID && quest.getStage(player) === STAGE_ACCEPTED) {
      quest.setStage(player, STAGE_DELIVERED);
    }
  });
  api.onItemAction("Crowbar", { Inspect: inspectCrowbar });
  api.onItemAction("Bottle of fish bladder stout", { Drink: drinkStout });
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
