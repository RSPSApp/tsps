/**
 * The Queen of Thieves (members).
 *
 * Words come from the "The Queen of Thieves" transcript page; this plugin supplies
 * the variant selector for Tomas Lawry (7904), Robert O'Reilly (7905), Devan Rutter
 * (7906), the Queen of Thieves (7908) and the poor-looking locals (6982-6985/7923),
 * the prose-condition answers, the start hook, the stew hand-in, the sewers manhole
 * and Warrens tent doorway, the non-combat murder of Conrad King (7907, "Murder"
 * option -> "Brutally"/"Softly" choice, no combat), the Councillor Hughes chest,
 * the letter hand-in and the Lady Shauna reward.
 *
 * Stages (varp 1672 "piscquest_main", varbit 6037 "piscquest" bits 0-5; both
 * confirmed from the cache gameval dump, which also names 6038
 * "piscquest_reward", 6039 "piscquest_favour", 12144 "tomas_lawry_location" and
 * 12145 "piscquest_queen_vis"):
 *   0 not started, 1 Tomas accepted, 2 locals named Robert, 3 Robert asked for
 *   stew, 4 stew given (Warrens known), 5 Devan's task (kill Conrad King),
 *   6 Conrad killed, 7 queen impressed (go in), 8 queen revealed (search
 *   Hughes), 9 letter found, 10 letter handed to Tomas, 11 complete.
 * The durable stages above keep their old saves' meaning, but they are not the
 * values the cache reads: the varbit 6037 wire follows Quest Helper's
 * loadSteps keys (the helper reads the same varbit), whose final active step is
 * 12 (talk to Lady Shauna) and whose completion threshold is 13 (quest DB row
 * 113, read by script 4029). stageWireValue below maps the durable stages:
 * 5->6, 6->7, 7->8, 8->10, 9->11, 10->12, 11->13; 0-4 are unchanged. Helper
 * keys 5 (inside the Warrens) and 9 (another talk-to-queen step) are duplicate
 * guide states this plugin does not store separately, so they are not emitted.
 * Varbit 6039 "piscquest_favour" is deliberately NOT set: the wiki's 10 January
 * 2024 change removed Kourend favour and the Piscarilius favour certificate
 * from the rewards.
 *
 * Requirements (wiki): Client of Kourend complete, 20 Thieving, required to
 * start (not boostable). Rewards (wiki): 1 Quest point, 2,000 Thieving XP,
 * 2,000 coins, The Fisher's Flute (21764) page for Kharedst's memoirs, and the
 * Port Piscarilius graceful recolour.
 *
 * Source: https://oldschool.runescape.wiki/w/The_Queen_of_Thieves (+ quick guide).
 *
 * The cache map already places transform parents for Tomas, Conrad and the
 * Queen; the plugin does not add duplicate static children. The Queen's reveal
 * enables the post-reveal Lady Shauna form for this player. The Hughes chest
 * uses an owner-only visual over the unchanged map chest and clipping.
 * The letter-reading interface remains unimplemented.
 */
module.exports = function registerQueenOfThievesQuest(api) {
  const {
    Skill,
    Location,
    GameObject,
    MapObjects,
    ObjectManager,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "The Queen of Thieves";
  const START_HOOK = "quest:the-queen-of-thieves:start";

  const VARP_PISCQUEST = 1672; // piscquest_main
  const VARBIT_PISCQUEST_STAGE = 6037; // piscquest, bits 0-5
  const VARBIT_QUEEN_VISIBLE = 12145; // piscquest_queen_vis
  const VARBIT_MEMOIR_PAGE_ADDED = 7921; // kourend_diary_pisc_teleport
  const VARBIT_PISCQUEST_REWARD = 6038; // piscquest_reward, bit 6
  // 6039 piscquest_favour: unused, Kourend favour was removed in January 2024.

  const THIEVING_REQUIREMENT = 20;
  const THIEVING_XP = 2000;
  const COINS_REWARD = 2000;
  const CLIENT_OF_KOUREND_KEY = "client_of_kourend";
  const KINGDOM_DIVIDED_HOUSES_STAGE = 110;

  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 1;
  const STAGE_ASKED_LOCALS = 2;
  const STAGE_TOLD_STEW = 3;
  const STAGE_STEW_GIVEN = 4;
  const STAGE_CONRAD_TASK = 5;
  const STAGE_CONRAD_KILLED = 6;
  const STAGE_QUEEN_VIS = 7;
  const STAGE_QUEEN_REVEALED = 8;
  const STAGE_LETTER_FOUND = 9;
  const STAGE_LETTER_GIVEN = 10;
  const STAGE_COMPLETE = 11;

  // Quest Helper loadSteps keys, which are varbit 6037 values: 5 is the
  // in-the-Warrens duplicate of step 4 and 9 is a second talk-to-queen step.
  // The cache's completion threshold is 13 (quest DB row 113, script 4029).
  const WIRE_CONRAD_TASK = 6;
  const WIRE_CONRAD_KILLED = 7;
  const WIRE_QUEEN_VIS = 8;
  const WIRE_QUEEN_REVEALED = 10;
  const WIRE_LETTER_FOUND = 11;
  const WIRE_LETTER_GIVEN = 12;
  const WIRE_COMPLETE = 13;

  /** Durable stage (old saves keep their meaning) -> canonical varbit value. */
  function stageWireValue(stage) {
    if (stage >= STAGE_COMPLETE) return WIRE_COMPLETE;
    if (stage === STAGE_LETTER_GIVEN) return WIRE_LETTER_GIVEN;
    if (stage === STAGE_LETTER_FOUND) return WIRE_LETTER_FOUND;
    if (stage === STAGE_QUEEN_REVEALED) return WIRE_QUEEN_REVEALED;
    if (stage === STAGE_QUEEN_VIS) return WIRE_QUEEN_VIS;
    if (stage === STAGE_CONRAD_KILLED) return WIRE_CONRAD_KILLED;
    if (stage === STAGE_CONRAD_TASK) return WIRE_CONRAD_TASK;
    return stage; // 0-4 match the helper's wire values
  }

  const TOMAS_LAWRY_NPC_ID = NpcIdentifiers.TOMAS_LAWRY; // 7904
  const ROBERT_OREILLY_NPC_ID = NpcIdentifiers.ROBERT_OREILLY; // 7905
  const DEVAN_RUTTER_NPC_ID = NpcIdentifiers.DEVAN_RUTTER; // 7906
  const CONRAD_KING_NPC_ID = NpcIdentifiers.CONRAD_KING; // 7907
  const LADY_SHAUNA_NPC_ID = NpcIdentifiers.LADY_SHAUNA_PISCARILIUS; // 7909
  const THE_QUEEN_OF_THIEVES_NPC_ID = NpcIdentifiers.THE_QUEEN_OF_THIEVES; // 7908
  const POOR_LOOKING_NPC_IDS = new Set([
    NpcIdentifiers.POOR_LOOKING_MAN, // 6982
    NpcIdentifiers.POOR_LOOKING_MAN_2, // 6983
    NpcIdentifiers.POOR_LOOKING_WOMAN, // 6984
    NpcIdentifiers.POOR_LOOKING_WOMAN_2, // 6985
    NpcIdentifiers.POOR_LOOKING_WOMAN_3, // 7923
  ]);

  const STEW_ITEM_ID = ItemIdentifiers.STEW; // 2003
  const STEW_ITEM_ID_2 = ItemIdentifiers.STEW_2; // 2004
  const LETTER_ITEM_ID = ItemIdentifiers.LETTER_7; // 21774 Letter (The Queen of Thieves)
  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995
  const FISHERS_FLUTE_ITEM_ID = ItemIdentifiers.THE_FISHERS_FLUTE; // 21764

  const MANHOLE_CLOSED_OBJECT_ID = ObjectIdentifiers.MANHOLE_7; // 31706 piscquest_manhole_closed
  const MANHOLE_OPEN_OBJECT_ID = ObjectIdentifiers.MANHOLE_8; // 31707 piscquest_manhole_open
  const MANHOLE_LADDER_OBJECT_ID = ObjectIdentifiers.LADDER_367; // 31708 piscquest_manhole_ladder
  const TENT_DOOR_OBJECT_ID = ObjectIdentifiers.DOORWAY_10; // 31709 piscquest_tentdoor
  const CHEST_PICKLOCK_OBJECT_ID = ObjectIdentifiers.CHEST_136; // 41760 piscquest_chest_closed_picklock
  const CHEST_SEARCH_OBJECT_ID = ObjectIdentifiers.CHEST_137; // 41761 piscquest_chest_closed_search

  // Owner visuals share the map's 10084 chest geometry and never remove its clipping.
  const CHEST_TILE = { x: 1681, y: 3677, z: 1 };
  const CHEST_REGION_ID = ((CHEST_TILE.x >> 6) << 8) | (CHEST_TILE.y >> 6);
  // The placed 10084 chest is shape 10 rotation 0 (dump:loc); every runtime
  // state is registered with the same pose so the client keeps seeing a chest.
  const CHEST_TYPE = 10;
  const CHEST_FACE = 0;
  // Saved lock progress rebuilds this player's menu on login.
  const CHEST_ATTRIBUTE = "quest.the_queen_of_thieves.chest";
  const CHEST_LOCKED = 0;
  const CHEST_PICKLOCKED = 1;
  const CHEST_SEARCHED = 2;

  const MANHOLE_TILE = { x: 1813, y: 3745, z: 0 };
  const MANHOLE_SURFACE_LANDING = { x: 1813, y: 3746, z: 0 };
  const TENT_DOOR_TILE = { x: 1765, y: 10149, z: 0 };

  // Variant keys on the "The Queen of Thieves" page.
  const TOMAS_START_VARIANT = "a-bit-of-tomas-and-lawry-talking-to-tomas";
  const TOMAS_DURING_VARIANT = "a-bit-of-tomas-and-lawry-talking-to-tomas-again";
  const TOMAS_LETTER_VARIANT = "bringing-down-the-law-ry-returning-to-tomas";
  const TOMAS_AFTER_VARIANT = "bringing-down-the-law-ry-returning-to-tomas-talking-to-tomas-again";
  const POOR_LOOKING_FIRST_VARIANT = "questioning-the-locals-talking-to-the-poor-looking-man-woman";
  const POOR_LOOKING_AGAIN_VARIANT = "questioning-the-locals-talking-to-the-poor-looking-man-woman-again";
  const ROBERT_PREFIX = "i-ll-stew-over-it-talking-to-robert";
  const ROBERT_FIRST_VARIANT = ROBERT_PREFIX;
  const ROBERT_AGAIN_VARIANT = `${ROBERT_PREFIX}-again-before-giving-him-stew`;
  const ROBERT_AFTER_VARIANT = `${ROBERT_PREFIX}-again-after-giving-him-stew`;
  const DEVAN_PREFIX = "stewing-in-the-sewers-talking-to-devan";
  const DEVAN_FIRST_VARIANT = DEVAN_PREFIX;
  const DEVAN_AGAIN_VARIANT = `${DEVAN_PREFIX}-again`;
  const DEVAN_RETURN_VARIANT = "revelation-of-a-redhead-returning-to-devan";
  const DEVAN_AFTER_VARIANT = "revelation-of-a-redhead-talking-to-devan-again";
  const CONRAD_KILL_VARIANT = "revelation-of-a-redhead-killing-conrad-king";
  const QUEEN_REVEAL_VARIANT = "revelation-of-a-redhead-talking-to-the-queen-of-thieves";
  const QUEEN_AGAIN_VARIANT = "revelation-of-a-redhead-talking-to-the-queen-of-thieves-again";
  const QUEEN_REWARD_VARIANT = "bringing-down-the-law-ry-returning-to-lady-piscarilius";

  // Prose-condition step ids on the "The Queen of Thieves" page.
  const NO_REQUIREMENTS_STEP_IDS = new Set(["3yrKMF", "vvd2A9"]);
  const HAS_REQUIREMENTS_STEP_IDS = new Set(["iIjtNv", "uYbU9d"]);
  const NO_STEW_STEP_IDS = new Set(["T-CKQt", "16-sWy"]);
  const HAS_STEW_STEP_IDS = new Set(["3xoB3Z", "QqVuJ4"]);
  // Action/message step ids.
  const STEW_GIVEN_MESSAGE_ID = "SuV2zA"; // "You give Robert O'Reilly some stew."
  const CONRAD_KILLED_MESSAGE_IDS = new Set(["29NrrK", "ekB1KV"]); // brutal / "softly" murder
  const LETTER_TAKEN_MESSAGE_ID = "CI6IE4"; // "Tomas takes the letter."
  const QUEST_COMPLETE_ACTION_ID = "4FEXH_"; // "Congratulations! Quest complete!"

  let quest;
  const chestObjects = new WeakMap();

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const hasStew = (player) => held(player, STEW_ITEM_ID) || held(player, STEW_ITEM_ID_2);
  const hasLetter = (player) => held(player, LETTER_ITEM_ID);

  function takeStew(player) {
    if (held(player, STEW_ITEM_ID)) {
      player.getInventory().deleteNumber(STEW_ITEM_ID, 1);
    } else {
      player.getInventory().deleteNumber(STEW_ITEM_ID_2, 1);
    }
  }

  function clientOfKourendComplete(player) {
    const request = { player, key: CLIENT_OF_KOUREND_KEY, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    if (typeof request.complete === "boolean") return request.complete;
    return Number(player.getAttribute(`quest.${CLIENT_OF_KOUREND_KEY}.stage`)) >= 2;
  }

  function meetsRequirements(player) {
    return (
      player.getSkillManager().getMaxLevel(Skill.THIEVING) >= THIEVING_REQUIREMENT &&
      clientOfKourendComplete(player)
    );
  }

  function advance(player, stage) {
    if (quest.getStage(player) < stage) quest.setStage(player, stage);
  }

  /** Which transcript variant each quest NPC plays, by stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === TOMAS_LAWRY_NPC_ID) {
      if (quest.isComplete(player) || stage >= STAGE_LETTER_GIVEN) return TOMAS_AFTER_VARIANT;
      if (stage >= STAGE_LETTER_FOUND && hasLetter(player)) return TOMAS_LETTER_VARIANT;
      if (stage >= STAGE_STARTED) return TOMAS_DURING_VARIANT;
      return TOMAS_START_VARIANT;
    }
    if (npcId === ROBERT_OREILLY_NPC_ID) {
      if (quest.isComplete(player)) return null; // "Robert O'Reilly" post-quest page
      if (stage >= STAGE_STEW_GIVEN) return ROBERT_AFTER_VARIANT;
      if (stage >= STAGE_TOLD_STEW) return ROBERT_AGAIN_VARIANT;
      return ROBERT_FIRST_VARIANT;
    }
    if (npcId === DEVAN_RUTTER_NPC_ID) {
      if (quest.isComplete(player)) return null; // "Devan Rutter" post-quest page
      if (stage >= STAGE_QUEEN_VIS) return DEVAN_AFTER_VARIANT;
      if (stage >= STAGE_CONRAD_KILLED) return DEVAN_RETURN_VARIANT;
      if (stage >= STAGE_CONRAD_TASK) return DEVAN_AGAIN_VARIANT;
      return DEVAN_FIRST_VARIANT;
    }
    if (npcId === THE_QUEEN_OF_THIEVES_NPC_ID || npcId === LADY_SHAUNA_NPC_ID) {
      if (quest.isComplete(player)) return lostMemoirPage(player)
        ? { page: "Lady Shauna Piscarilius", variant: "if-the-player-lost-the-memoir-page-before-using-it-on-the-memoir" } : null; // Lady Shauna's standard dialogue
      if (stage >= STAGE_LETTER_GIVEN) return QUEEN_REWARD_VARIANT;
      if (stage >= STAGE_QUEEN_REVEALED) return QUEEN_AGAIN_VARIANT;
      if (stage === STAGE_QUEEN_VIS) return QUEEN_REVEAL_VARIANT;
      return QUEEN_AGAIN_VARIANT; // no dedicated pre-task variant in the transcript
    }
    return null;
  }

  /** Answer the start-requirement and stew prose conditions. */
  function answerCondition({ player, stepId }) {
    if (NO_REQUIREMENTS_STEP_IDS.has(stepId)) return !meetsRequirements(player);
    if (HAS_REQUIREMENTS_STEP_IDS.has(stepId)) return meetsRequirements(player);
    if (NO_STEW_STEP_IDS.has(stepId)) return !hasStew(player);
    if (HAS_STEW_STEP_IDS.has(stepId)) return hasStew(player);
    return null;
  }

  /** The "Yes." start option carries the quest slug; commit the start there. */
  function handleStartHook(event) {
    const { player, npcId, hook } = event;
    if (hook !== START_HOOK || npcId !== TOMAS_LAWRY_NPC_ID) return;
    if (quest.getStage(player) !== STAGE_NOT_STARTED) return;
    if (!meetsRequirements(player)) return;
    quest.setStage(player, STAGE_STARTED);
  }

  /** Robert's "no stew" branch means he has asked for one. */
  function handleConditionStep(event) {
    if (!NO_STEW_STEP_IDS.has(event.stepId)) return;
    advance(event.player, STAGE_TOLD_STEW);
  }

  /**
   * Stage changes that only become true once a specific wiki line has played:
   * Devan directions, Devan's "queen is impressed", and the end of the reveal.
   */
  function handleDialogueLine(event) {
    const text = String(event.text ?? "");
    const player = event.player;
    if ([THE_QUEEN_OF_THIEVES_NPC_ID, LADY_SHAUNA_NPC_ID].includes(event.npcId)
      && text === "Looking for your reward, idiot? Take it and get lost." && lostMemoirPage(player)) {
      const previous = event.after;
      event.after = () => {
        previous?.();
        if (!lostMemoirPage(player)) return;
        if (player.getInventory().getFreeSlots() < 1) {
          player.sendMessage("You need a free inventory space.");
          return;
        }
        player.getInventory().adds(FISHERS_FLUTE_ITEM_ID, 1);
      };
    }
    if (event.npcId === DEVAN_RUTTER_NPC_ID) {
      if (/find Conrad King south of the Piscarilius Foodhall/i.test(text)) {
        advance(player, STAGE_CONRAD_TASK);
        return;
      }
      if (/queen is impressed/i.test(text) && quest.getStage(player) === STAGE_CONRAD_KILLED) {
        quest.setStage(player, STAGE_QUEEN_VIS);
      }
      return;
    }
    if (
      [THE_QUEEN_OF_THIEVES_NPC_ID, LADY_SHAUNA_NPC_ID].includes(event.npcId) &&
      /now get lost/i.test(text) &&
      quest.getStage(player) === STAGE_QUEEN_VIS
    ) {
      quest.setStage(player, STAGE_QUEEN_REVEALED);
    }
  }

  /** Wiki message/action steps that hand items over or finish the quest. */
  function handleDialogueAction(event) {
    const { player, stepId } = event;
    if (stepId === STEW_GIVEN_MESSAGE_ID) {
      if (!hasStew(player)) return;
      takeStew(player);
      advance(player, STAGE_STEW_GIVEN);
      return;
    }
    if (CONRAD_KILLED_MESSAGE_IDS.has(stepId)) {
      advance(player, STAGE_CONRAD_KILLED);
      return;
    }
    if (stepId === LETTER_TAKEN_MESSAGE_ID) {
      if (!hasLetter(player)) return;
      player.getInventory().deleteNumber(LETTER_ITEM_ID, 1);
      advance(player, STAGE_LETTER_GIVEN);
      return;
    }
    if (stepId === QUEST_COMPLETE_ACTION_ID) {
      event.handled = true;
      if (quest.getStage(player) >= STAGE_LETTER_GIVEN) quest.complete(player);
    }
  }

  /** The poor-looking locals are unindexed for the quest page, so claim Talk-to. */
  function talkPoorLooking(event) {
    const { player } = event;
    if (!POOR_LOOKING_NPC_IDS.has(event.npcId)) return;
    if (quest.isComplete(player)) return; // fall through to their default page
    if (quest.getStage(player) < STAGE_STARTED) return;
    event.handled = true;
    if (quest.getStage(player) >= STAGE_ASKED_LOCALS) {
      startTranscript(api, player, event.npcId, PAGE, POOR_LOOKING_AGAIN_VARIANT);
      return;
    }
    quest.setStage(player, STAGE_ASKED_LOCALS);
    startTranscript(api, player, event.npcId, PAGE, POOR_LOOKING_FIRST_VARIANT);
  }

  /** Conrad is killed through his non-combat "Murder" option, not a fight. */
  function murderConrad(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_CONRAD_TASK) {
      player.sendMessage(
        quest.getStage(player) > STAGE_CONRAD_TASK
          ? "You have already dealt with Conrad King."
          : "You have no reason to kill this man."
      );
      return;
    }
    startTranscript(api, player, CONRAD_KING_NPC_ID, PAGE, CONRAD_KILL_VARIANT);
  }

  function replaceObject(object, newId) {
    const location = object.getLocation();
    ObjectManager.deregister(object, true);
    ObjectManager.register(
      new GameObject(
        newId,
        new Location(location.getX(), location.getY(), location.getZ()),
        object.getType(),
        object.getFace(),
        object.getPrivateArea() ?? null
      ),
      true
    );
  }

  /** wiki: pick the lock (may take a few tries), then search for the letter. */
  function picklockChest(player) {
    if (quest.getStage(player) < STAGE_QUEEN_REVEALED) {
      player.sendMessage("You have no reason to pick the lock on this chest.");
      return;
    }
    if (chestState(player) >= CHEST_PICKLOCKED) {
      // A repeated stale Picklock click only restores this player's Search menu.
      dressChest(player);
      return;
    }
    setChestState(player, CHEST_PICKLOCKED);
    dressChest(player);
    player.sendMessage("You pick the lock on the chest.");
  }

  function searchChest(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_QUEEN_REVEALED) {
      player.sendMessage("You have no reason to search through this chest.");
      return;
    }
    if (chestState(player) < CHEST_PICKLOCKED) {
      player.sendMessage("The chest is locked.");
      return;
    }
    // Once the letter is handed in the quest no longer needs it; before that,
    // an empty hand may search again after destroying or losing the letter.
    if (stage >= STAGE_LETTER_GIVEN || hasLetter(player)) {
      player.sendMessage("The chest is empty.");
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory space.");
      return;
    }
    player.getInventory().adds(LETTER_ITEM_ID, 1);
    setChestState(player, CHEST_SEARCHED);
    dressChest(player);
    player.sendMessage("You search the chest and find a letter.");
    advance(player, STAGE_LETTER_FOUND);
  }

  function chestState(player) {
    return Number(player.getAttribute(CHEST_ATTRIBUTE)) || CHEST_LOCKED;
  }

  function setChestState(player, state) {
    if (chestState(player) < state) player.setAttribute(CHEST_ATTRIBUTE, state);
  }

  /** Keep the map chest and its clipping intact; only this player's menu changes. */
  function dressChest(player) {
    const previous = chestObjects.get(player);
    const objectId = chestState(player) >= CHEST_PICKLOCKED
      ? CHEST_SEARCH_OBJECT_ID : CHEST_PICKLOCK_OBJECT_ID;
    if (previous?.getId() === objectId) return;
    if (previous) ObjectManager.deregister(previous, true);
    const object = new GameObject(objectId,
      new Location(CHEST_TILE.x, CHEST_TILE.y, CHEST_TILE.z), CHEST_TYPE, CHEST_FACE, null).setOwner(player);
    ObjectManager.register(object, true);
    chestObjects.set(player, object);
  }

  function clearChest({ player }) {
    const object = chestObjects.get(player);
    if (object) ObjectManager.deregister(object, true);
    chestObjects.delete(player);
  }

  /** The tent doorway drops the player on the far side of its wall. */
  function goThroughTentDoor(event) {
    const { player, location } = event;
    // event.location is a plain { x, y, z }; Doors.plugin.js reads it the same way.
    const doorX = location.getX?.() ?? location.x;
    const doorY = location.getY?.() ?? location.y;
    const from = player.getLocation();
    const destinationY = from.getY() <= doorY ? doorY + 2 : doorY - 1;
    player.moveTo(new Location(doorX, destinationY, from.getZ()));
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (objectId === MANHOLE_CLOSED_OBJECT_ID) {
      event.handled = true;
      replaceObject(event.object, MANHOLE_OPEN_OBJECT_ID);
      return;
    }
    if (objectId === MANHOLE_OPEN_OBJECT_ID) {
      // Climb-down is left to the Ladders plugin, which maps the underground
      // shaft (the Warrens ladder sits 6400 tiles north). Only Close is ours.
      const option = event.definition?.getInteractions?.()?.[event.clickType - 1];
      if (option === "Close") {
        event.handled = true;
        replaceObject(event.object, MANHOLE_CLOSED_OBJECT_ID);
      }
      return;
    }
    if (objectId === MANHOLE_LADDER_OBJECT_ID) {
      event.handled = true;
      const surfaceManhole = MapObjects.get(MANHOLE_CLOSED_OBJECT_ID, new Location(MANHOLE_TILE.x, MANHOLE_TILE.y, MANHOLE_TILE.z), null);
      if (surfaceManhole) replaceObject(surfaceManhole, MANHOLE_OPEN_OBJECT_ID);
      api.emitCustomEvent("ladders:climbUp", {
        player,
        object: event.object,
        location: event.location,
        destination: new Location(MANHOLE_SURFACE_LANDING.x, MANHOLE_SURFACE_LANDING.y, MANHOLE_SURFACE_LANDING.z),
      });
      return;
    }
    if (objectId === TENT_DOOR_OBJECT_ID) {
      event.handled = true;
      goThroughTentDoor(event);
      return;
    }
    if (objectId === CHEST_PICKLOCK_OBJECT_ID) {
      event.handled = true;
      picklockChest(player);
      return;
    }
    if (objectId === CHEST_SEARCH_OBJECT_ID) {
      event.handled = true;
      searchChest(player);
    }
  }

  /** Register owner visuals when the map region first loads. */
  function handleRegionLoaded({ regionId }) {
    if (regionId !== CHEST_REGION_ID) return;
    for (const player of api.getWorld().getPlayers()) dressChest(player);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (questHandle.isComplete(player)) {
      return [
        "<str>I helped Tomas Lawry investigate the Saviours of</str>",
        "<str>Kourend, infiltrating the gang and killing Conrad King.</str>",
        "<str>Their leader, the Queen of Thieves, turned out to be</str>",
        "<str>Lady Shauna Piscarilius, and I gave Tomas proof of</str>",
        "<str>Councillor Hughes' corruption.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_LETTER_GIVEN) {
      return [
        "<str>I infiltrated the Saviours of Kourend and found out their</str>",
        "<str>leader, the Queen of Thieves, is Lady Shauna Piscarilius.</str>",
        "<str>I found a letter in Councillor Hughes' chest and gave it</str>",
        "<str>to Tomas Lawry.</str>",
        "",
        "I should return to <col=800000>Lady Shauna Piscarilius</col> for my reward.",
      ];
    }
    if (stage >= STAGE_LETTER_FOUND) {
      return [
        "<str>I infiltrated the Saviours of Kourend and found out that</str>",
        "<str>the Queen of Thieves is Lady Shauna Piscarilius.</str>",
        "<str>I found a letter in Councillor Hughes' chest.</str>",
        "",
        "I should take the <col=800000>letter</col> to <col=800000>Tomas Lawry</col>.",
      ];
    }
    if (stage >= STAGE_QUEEN_REVEALED) {
      return [
        "<str>I infiltrated the Saviours of Kourend and the Queen of</str>",
        "<str>Thieves revealed herself to be Lady Shauna Piscarilius.</str>",
        "",
        "I need to search <col=800000>Councillor Hughes' chest</col> for",
        "proof of her corruption, in her house in <col=800000>Kingstown</col>.",
      ];
    }
    if (stage >= STAGE_QUEEN_VIS) {
      return [
        "<str>I proved myself to the Saviours of Kourend by killing</str>",
        "<str>Conrad King.</str>",
        "",
        "Devan Rutter says the <col=800000>queen</col> is impressed and",
        "wants to see me in the <col=800000>tent</col> in the Warrens.",
      ];
    }
    if (stage >= STAGE_CONRAD_KILLED) {
      return [
        "<str>Devan Rutter wants me to kill Conrad King to prove</str>",
        "<str>myself. I have killed Conrad King south of the</str>",
        "<str>Piscarilius Foodhall.</str>",
        "",
        "I should return to <col=800000>Devan Rutter</col> in the Warrens.",
      ];
    }
    if (stage >= STAGE_CONRAD_TASK) {
      return [
        "<str>I found the Saviours of Kourend in the Warrens</str>",
        "<str>beneath the sewers.</str>",
        "",
        "<col=800000>Devan Rutter</col> wants me to kill <col=800000>Conrad King</col>",
        "to prove my worth. He is south of the",
        "<col=800000>Piscarilius Foodhall</col>.",
      ];
    }
    if (stage >= STAGE_STEW_GIVEN) {
      return [
        "<str>I gave Robert O'Reilly some stew and he told me the</str>",
        "<str>Saviours of Kourend make their home in the Warrens.</str>",
        "",
        "I should climb down the <col=800000>manhole</col> to reach the Warrens.",
      ];
    }
    if (stage >= STAGE_TOLD_STEW) {
      return [
        "<str>The locals say Robert O'Reilly has been working</str>",
        "<str>with the gang.</str>",
        "",
        "I should bring <col=800000>Robert O'Reilly</col> a <col=800000>stew</col>",
        "so he will tell me where the Saviours of Kourend are.",
      ];
    }
    if (stage >= STAGE_ASKED_LOCALS) {
      return [
        "<str>I agreed to help Tomas Lawry find the Queen of Thieves.</str>",
        "",
        "The locals say <col=800000>Robert O'Reilly</col> has been working with",
        "the gang. He lives in the middle of <col=800000>Port Piscarilius</col>.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>I agreed to help Tomas Lawry investigate the</str>",
        "<str>Saviours of Kourend.</str>",
        "",
        "He wants me to infiltrate the gang and apprehend the",
        "<col=800000>Queen of Thieves</col>. I should ask around",
        "<col=800000>Port Piscarilius</col> to find their headquarters.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Tomas Lawry</col>",
      "outside the <col=800000>Port Piscarilius</col> bank.",
    ];
  }

  function ownsItem(player, itemId) {
    return held(player, itemId) || (player.getBanks?.() ?? []).some(bank => (bank?.getAmount(itemId) ?? 0) > 0)
      || (player.getBank?.()?.getAmount?.(itemId) ?? 0) > 0
      || (player.getEquipment?.()?.getItems?.() ?? []).some(item => item?.getId?.() === itemId);
  }

  function pageAdded(player) {
    return player.getPacketSender().getVarbit(VARBIT_MEMOIR_PAGE_ADDED) !== 0;
  }

  function lostMemoirPage(player) {
    if (!quest.isComplete(player) || ownsItem(player, FISHERS_FLUTE_ITEM_ID) || pageAdded(player)) return false;
    return !api.core.World.getItems().some(item => !item.isPendingRemoval()
      && item.getOwner() === player.getUsername() && item.getItem().getId() === FISHERS_FLUTE_ITEM_ID);
  }

  function syncAppearance(player) {
    const sender = player.getPacketSender();
    // AKD also owns this transform: 1 is Shauna, 2/3 hide the sewer actor.
    const kingdom = { player, key: "a_kingdom_divided", stage: null };
    api.emitCustomEvent("quest:get-stage", kingdom);
    const kingdomStage = kingdom.stage ?? Number(player.getAttribute("quest.a_kingdom_divided.stage") ?? 0);
    if ((quest.getStage(player) >= STAGE_QUEEN_REVEALED || kingdomStage >= KINGDOM_DIVIDED_HOUSES_STAGE)
      && sender.getVarbit(VARBIT_QUEEN_VISIBLE) === 0) {
      sender.sendVarbit(VARBIT_QUEEN_VISIBLE, 1);
    }
  }

  function syncRewardFlag(player) {
    const sender = player.getPacketSender();
    if (quest.isComplete(player) && sender.getVarbit(VARBIT_PISCQUEST_REWARD) !== 1) {
      sender.sendVarbit(VARBIT_PISCQUEST_REWARD, 1);
    }
  }

  function handleAppearanceStageChanged({ player, key }) {
    if (key === "the_queen_of_thieves" || key === "a_kingdom_divided") syncAppearance(player);
  }

  function handleAppearanceBootstrap({ player }) {
    syncAppearance(player);
    syncRewardFlag(player);
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.THIEVING, THIEVING_XP);
    player.getInventory().forceAdd(player, new api.core.Item(COINS_ITEM_ID, COINS_REWARD));
    player.getPacketSender().sendVarbit(VARBIT_PISCQUEST_REWARD, 1);
  }

  function handleLogin({ player }) {
    syncAppearance(player);
    syncRewardFlag(player);
    refreshQuestList(player);
    dressChest(player);
  }

  api.persistAttribute(CHEST_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "the_queen_of_thieves",
    name: "The Queen of Thieves",
    varpId: VARP_PISCQUEST,
    varbitId: VARBIT_PISCQUEST_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.THIEVING.getIndex(), amount: THIEVING_XP, label: "Thieving" }],
    rewardItemId: FISHERS_FLUTE_ITEM_ID,
    rewardItemLabel: "The Fisher's Flute",
    otherRewards: ["2,000 Coins"],
    buildJournal,
    onReward: grantReward,
    varbitValue: stageWireValue,
  });

  api.onCustomEvent("quest:stage-changed", handleAppearanceStageChanged);
  api.onCustomEvent("player:bootstrap-complete", handleAppearanceBootstrap);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handleConditionStep);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onNpcInteraction("Conrad King", { Murder: murderConrad });
  api.onNpcInteraction("Poor looking man", { "Talk-to": talkPoorLooking });
  api.onNpcInteraction("Poor looking woman", { "Talk-to": talkPoorLooking });
  api.onObjectInteraction(handleObjectInteraction);
  api.onRegionLoaded(handleRegionLoaded);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(clearChest);
};
