/**
 * Dragon Slayer I.
 *
 * Words come from npc-dialogues.json. The "Dragon Slayer I" page mixes every
 * quest NPC, so the branch is chosen by the speaker's cache id and quest stage:
 *   Guildmaster 814, Duke Horacio 815, Elvarg 816, Ned 818/5865/824/4280/5864,
 *   Klarense 819, Wormbrain 820, Oracle 821, Oziach 822, Melzar 823.
 *
 * Stage flow (VARP 176, xrsps constants):
 *   0  not started        Guildmaster start hook (needs 32 Quest Points)
 *   1  Guildmaster        Oziach offers "slay the dragon of Crandor"
 *   2  Oziach             buy the Lady Lumbridge from Klarense
 *   3  bought ship        repair 3 holes (planks + 30 steel nails each)
 *   4/5/7 repair holes    Ned hires on with the complete map
 *   8  Ned ready          board the ship and sail to Crandor
 *   9  Crandor            kill Elvarg to complete
 *   10 complete
 *
 * Aux state is kept in persisted player attributes (the reference's varps 177,
 * 183, 184): oracle progress, whether Ned has been asked, whether Oziach has
 * seen the kill, and whether the Crandor shortcut rope is open.
 *
 * The plugin supplies the variant selector, the prose-condition answers, the
 * start hook, the map/coin/shield hand-ins and the object interactions (maze
 * doors, magic door, Melzar/Oracle chests, ship hole, gangplanks, Crandor).
 *
 * Gaps (needing content the dump/reference cannot supply, see summary):
 *   - Duke Horacio's quest dialogue lives on the "Dragon Slayer I" page but the
 *     id index only lists his own page; the generic "Duke Horacio" page already
 *     carries the shield conversation, so his shield is granted by action id.
 *   - Klarense has no pre-Oziach refusal variant; purchase is refused in the
 *     condition handler instead of a dedicated line.
 *   - The offered ship captains (Ahab, Seagull, Ben, Lorris/Tobias, Stan), the
 *     sawmill plank hand-out and Cabin Boy Jenkins have no NPC ids in the
 *     reference; only Ned is wired.
 *   - The sailing cutscene / Elvarg instance is not spawned here; the gangplank
 *     and Ned's "let's go" teleport the player to Crandor directly.
 *   - Maze key droppers 748-752 come from the reference; the id index maps some
 *     of them to an unrelated transcript, so no talk dialogue is added.
 */
module.exports = function registerDragonSlayerQuest(api) {
  const { Skill, Item, Location, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest } = require("../QuestRuntime");

  const GUILDMASTER_NPC_ID = NpcIdentifiers.GUILDMASTER;
  const DUKE_HORACIO_NPC_ID = NpcIdentifiers.DUKE_HORACIO;
  const KLARENSE_NPC_ID = NpcIdentifiers.KLARENSE;
  const WORMBRAIN_NPC_ID = NpcIdentifiers.WORMBRAIN;
  const ORACLE_NPC_ID = NpcIdentifiers.ORACLE;
  const OZIACH_NPC_ID = NpcIdentifiers.OZIACH;

  /** Elvarg/Ned cache variants absent from NpcIdentifiers (xrsps ids). */
  const ELVARG_LEGACY_NPC_ID = 816;
  const NED_LEGACY_NPC_IDS = [818, 5865];

  const ELVARG_NPC_IDS = new Set([
    ELVARG_LEGACY_NPC_ID,
    NpcIdentifiers.ELVARG_2,
    NpcIdentifiers.ELVARG_3,
    NpcIdentifiers.ELVARG,
  ]);
  const NED_NPC_IDS = new Set([
    ...NED_LEGACY_NPC_IDS,
    NpcIdentifiers.CAPTAIN_NED,
    NpcIdentifiers.NED,
    NpcIdentifiers.CAPTAIN_NED_2,
  ]);

  const VARP_DRAGON_SLAYER = 176;
  const STAGE_NOT_STARTED = 0;
  const STAGE_GUILDMASTER = 1;
  const STAGE_OZIACH = 2;
  const STAGE_BOUGHT_SHIP = 3;
  const STAGE_REPAIR_1 = 4;
  const STAGE_REPAIR_2 = 5;
  const STAGE_REPAIR_3 = 7;
  const STAGE_NED_READY = 8;
  const STAGE_CRANDOR = 9;
  const STAGE_COMPLETE = 10;

  const ITEM = {
    coins: ItemIdentifiers.COINS,
    silk: ItemIdentifiers.SILK,
    plank: ItemIdentifiers.PLANK,
    lobsterPot: ItemIdentifiers.LOBSTER_POT,
    wizardMindBomb: ItemIdentifiers.WIZARDS_MIND_BOMB,
    unfiredBowl: ItemIdentifiers.UNFIRED_BOWL,
    steelNails: ItemIdentifiers.STEEL_NAILS,
    antiDragonShield: ItemIdentifiers.ANTI_DRAGON_SHIELD,
    mapMelzar: ItemIdentifiers.MAP_PART,
    mapWormbrain: ItemIdentifiers.MAP_PART_2,
    mapOracle: ItemIdentifiers.MAP_PART_3,
    crandorMap: ItemIdentifiers.CRANDOR_MAP,
    mazeKey: ItemIdentifiers.MAZE_KEY,
    redKey: ItemIdentifiers.KEY_3,
    orangeKey: ItemIdentifiers.KEY_4,
    yellowKey: ItemIdentifiers.KEY_5,
    blueKey: ItemIdentifiers.KEY_6,
    magentaKey: ItemIdentifiers.KEY_7,
    greenKey: ItemIdentifiers.KEY_8,
  };

  const MAP_PIECES = [ITEM.mapMelzar, ITEM.mapWormbrain, ITEM.mapOracle];
  const MAZE_KEYS = [ITEM.redKey, ITEM.orangeKey, ITEM.yellowKey, ITEM.blueKey, ITEM.magentaKey, ITEM.greenKey];
  const MAZE_DOORS = [
    ObjectIdentifiers.RED_DOOR,
    ObjectIdentifiers.ORANGE_DOOR,
    ObjectIdentifiers.YELLOW_DOOR,
    ObjectIdentifiers.BLUE_DOOR,
    ObjectIdentifiers.MAGENTA_DOOR,
    ObjectIdentifiers.GREEN_DOOR,
  ];
  // Reference maze-key droppers. 748/749 have no generated member; 750-753 map to
  // unrelated cache names (My Arm / Adventurer) in NpcIdentifiers.
  const MAZE_KEY_DROPPERS = [
    748,
    749,
    NpcIdentifiers.MY_ARM_4,
    NpcIdentifiers.MY_ARM_5,
    NpcIdentifiers.ADVENTURER,
    NpcIdentifiers.MY_ARM_6,
  ];
  const OFFERINGS = [ITEM.silk, ITEM.unfiredBowl, ITEM.lobsterPot, ITEM.wizardMindBomb];

  const LOC = {
    magicDoor: ObjectIdentifiers.HOPPER,
    oracleChest: [ObjectIdentifiers.CHEST_14, ObjectIdentifiers.CHEST_15],
    shipHole: ObjectIdentifiers.HOLE_3,
    shipGangplanks: [ObjectIdentifiers.GANGPLANK_15, ObjectIdentifiers.GANGPLANK_16],
    melzarEntrance: ObjectIdentifiers.DOOR_91,
    melzarChest: [ObjectIdentifiers.CHEST_16, ObjectIdentifiers.CHEST_17],
    crandorOpening: ObjectIdentifiers.STAIRCASE_8,
    crandorRope: ObjectIdentifiers.STAIRCASE_9,
  };

  const TILE = {
    melzarInside: new Location(2933, 3248, 0),
    crandor: new Location(2835, 3235, 0),
    elvargLair: new Location(2852, 9637, 0),
    crandorSurface: new Location(2833, 3255, 0),
  };

  const ATTR_ORACLE = "dragon-slayer.oracle";
  const ATTR_NED_ASKED = "dragon-slayer.ned-asked";
  const ATTR_OZIACH_CONGRATS = "dragon-slayer.oziach-congrats";
  const ATTR_SHORTCUT = "dragon-slayer.shortcut";
  const QUEST_POINTS_ATTRIBUTE = "quest.points";

  const PAGE = "Dragon Slayer I";
  const OZIACH_PAGE = "Oziach";
  const ORACLE_PAGE = "Oracle";
  const KLARENSE_PAGE = "Klarense";
  const NED_PAGE = "Ned";

  const START_HOOK = "quest:dragon-slayer-i:start";
  const REQUIRED_QUEST_POINTS = 32;

  const hasItem = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const hasCrandorMap = (player) => hasItem(player, ITEM.crandorMap);
  const hasAllMapPieces = (player) => MAP_PIECES.every((id) => hasItem(player, id));
  const ownsMapPiece = (player, itemId) => hasItem(player, itemId) || hasCrandorMap(player);
  const questPoints = (player) => Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0;
  const oracleState = (player) => Number(player.getAttribute(ATTR_ORACLE)) || 0;
  const setOracleState = (player, value) => player.setAttribute(ATTR_ORACLE, value);

  let quest;
  let itemOnGroundManager;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return ["<str>I slew Elvarg and became a true dragon slayer.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }
    if (stage >= STAGE_CRANDOR) return ["Enter Crandor's volcano and defeat <col=800000>Elvarg</col>."];
    if (stage >= STAGE_NED_READY) return ["Board the Lady Lumbridge with Captain Ned and sail to Crandor."];
    if (stage >= STAGE_REPAIR_3) return ["Bring the completed Crandor map to <col=800000>Ned</col> in Draynor."];
    if (stage >= STAGE_BOUGHT_SHIP) {
      return [
        "Repair all three holes in the Lady Lumbridge with planks",
        "and 30 steel nails per hole. Complete the three map pieces.",
      ];
    }
    if (stage >= STAGE_OZIACH) {
      return [
        "Find the three Crandor map pieces: in Melzar's Maze,",
        "behind the Oracle's magic door, and from Wormbrain.",
        "Obtain an anti-dragon shield from Duke Horacio.",
      ];
    }
    if (stage >= STAGE_GUILDMASTER) return ["Speak to <col=800000>Oziach</col> near Edgeville."];
    return ["You need 32 Quest Points, then speak to the Champions' Guildmaster."];
  }

  function reward(player) {
    player.getSkillManager().addExperiences(Skill.STRENGTH, 18650);
    player.getSkillManager().addExperiences(Skill.DEFENCE, 18650);
  }

  function giveItem(player, itemId, amount = 1) {
    if (player.getInventory().isFull()) {
      player.sendMessage("You need more free inventory space.");
      return false;
    }
    player.getInventory().adds(itemId, amount);
    return true;
  }

  function dropItem(player, itemId, location) {
    if (!itemOnGroundManager) return;
    itemOnGroundManager.registerLocation(
      player,
      new Item(itemId, 1),
      new Location(location.x, location.y, location.z)
    );
  }

  function sailToCrandor(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_NED_READY || stage >= STAGE_COMPLETE) return;
    if (stage < STAGE_CRANDOR) quest.setStage(player, STAGE_CRANDOR);
    player.moveTo(TILE.crandor.clone());
    player.sendMessage("The Lady Lumbridge crashes onto Crandor's shore.");
  }

  // ============================================================================
  // Transcript selection
  // ============================================================================

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (npcId === GUILDMASTER_NPC_ID) {
      if (stage >= STAGE_COMPLETE) {
        return { page: PAGE, variant: "the-dragon-of-crandor-talking-to-the-guildmaster-after-slaying-elvarg" };
      }
      if (stage === STAGE_NOT_STARTED) {
        if (questPoints(player) < REQUIRED_QUEST_POINTS) return null;
        return { page: PAGE, variant: "a-quest-for-the-rune-platebody-talking-to-the-guildmaster" };
      }
      if (stage === STAGE_GUILDMASTER) {
        return {
          page: PAGE,
          variant: "a-quest-for-the-rune-platebody-talking-to-the-guildmaster-talking-to-the-guildmaster-again-before-talking-to-oziach",
        };
      }
      if (stage === STAGE_OZIACH) {
        return { page: PAGE, variant: "a-quest-for-the-rune-platebody-talking-to-the-guildmaster-after-talking-to-oziach" };
      }
      return { page: PAGE, variant: "a-quest-for-the-rune-platebody-talking-to-the-guildmaster-again" };
    }

    if (npcId === OZIACH_NPC_ID) {
      if (stage === STAGE_GUILDMASTER) {
        // The reference advances once Oziach sets the challenge; the dump has
        // no action step for it.
        quest.setStage(player, STAGE_OZIACH);
        return { page: PAGE, variant: "a-quest-for-the-rune-platebody-talking-to-oziach" };
      }
      if (stage >= STAGE_COMPLETE) {
        if (player.getAttribute(ATTR_OZIACH_CONGRATS) !== true) {
          return { page: PAGE, variant: "the-dragon-of-crandor-talking-to-oziach-after-slaying-elvarg" };
        }
        return { page: OZIACH_PAGE, variant: "after-completing-dragon-slayer-i" };
      }
      if (stage >= STAGE_OZIACH) {
        return { page: PAGE, variant: "a-quest-for-the-rune-platebody-talking-to-oziach-talking-to-oziach-before-slaying-the-dragon" };
      }
      return null;
    }

    if (npcId === ORACLE_NPC_ID) {
      if (stage >= STAGE_OZIACH && !ownsMapPiece(player, ITEM.mapOracle)) {
        setOracleState(player, Math.max(2, oracleState(player)));
        return { page: PAGE, variant: "thalzar-s-map-piece-talking-to-the-oracle" };
      }
      if (stage >= STAGE_OZIACH) return { page: ORACLE_PAGE, variant: "standard-dialogue" };
      return null;
    }

    if (npcId === KLARENSE_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return { page: KLARENSE_PAGE, variant: "after-dragon-slayer-i" };
      if (stage === STAGE_CRANDOR) {
        return { page: PAGE, variant: "the-dragon-of-crandor-talking-to-klarense-after-reaching-crandor" };
      }
      if (stage >= STAGE_BOUGHT_SHIP) {
        return { page: PAGE, variant: "an-old-crandorian-ship-talking-to-klarense-after-purchasing-the-lady-lumbridge" };
      }
      // No pre-Oziach refusal variant; the purchase is refused in the
      // condition handler instead.
      return { page: PAGE, variant: "an-old-crandorian-ship-talking-to-klarense" };
    }

    if (npcId === WORMBRAIN_NPC_ID) {
      if (stage < STAGE_OZIACH || ownsMapPiece(player, ITEM.mapWormbrain)) return null;
      return { page: PAGE, variant: "lozar-s-map-piece-talking-to-wormbrain" };
    }

    if (NED_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) {
        return { page: NED_PAGE, variant: "standard-dialogue-after-completion-of-dragon-slayer-i" };
      }
      if (stage === STAGE_CRANDOR) {
        return { page: PAGE, variant: "the-dragon-of-crandor-talking-to-ned-after-reaching-crandor" };
      }
      if (stage >= STAGE_NED_READY) {
        const loc = player.getLocation();
        const onShip =
          loc.getZ() === 1 && Math.abs(loc.getX() - 3048) <= 3 && Math.abs(loc.getY() - 3207) <= 3;
        return onShip
          ? { page: PAGE, variant: "the-dragon-of-crandor-talking-to-ned-on-the-lady-lumbridge" }
          : { page: PAGE, variant: "the-dragon-of-crandor-talking-to-ned-after-giving-him-the-crandor-map" };
      }
      if (stage >= STAGE_OZIACH) {
        if (player.getAttribute(ATTR_NED_ASKED) !== true) {
          player.setAttribute(ATTR_NED_ASKED, true);
          return { page: PAGE, variant: "an-old-crandorian-ship-finding-a-willing-captain-ned" };
        }
        return {
          page: PAGE,
          variant: "an-old-crandorian-ship-finding-a-willing-captain-talking-to-ned-again-if-the-player-wasn-t-ready-the-first-time",
        };
      }
      return null;
    }

    return null;
  }

  // ============================================================================
  // Prose conditions from the transcripts
  // ============================================================================

  function answerCondition({ npcId, player, text }) {
    const value = String(text).toLowerCase();
    const stage = quest.getStage(player);

    if (npcId === GUILDMASTER_NPC_ID) {
      if (value.includes("45 combat or 33 magic")) {
        return (
          player.getSkillManager().getCombatLevel() < 45 ||
          player.getSkillManager().getCurrentLevel(Skill.MAGIC) < 33
        );
      }
      if (value.includes("does not have the key")) return !hasItem(player, ITEM.mazeKey);
      if (value.includes("key in their key ring")) return false;
      if (value.includes("key in their inventory or bank")) return hasItem(player, ITEM.mazeKey);
      return null;
    }

    if (npcId === OZIACH_NPC_ID) {
      if (value.includes("murder mystery has been completed")) return false;
      return null;
    }

    if (npcId === WORMBRAIN_NPC_ID) {
      if (value.includes("does not have enough coins")) {
        return player.getInventory().getAmount(ITEM.coins) < 10000;
      }
      if (value.includes("has enough coins")) {
        return player.getInventory().getAmount(ITEM.coins) >= 10000;
      }
      return null;
    }

    if (npcId === KLARENSE_NPC_ID) {
      if (value.includes("does not have enough coins")) {
        return player.getInventory().getAmount(ITEM.coins) < 2000;
      }
      if (value.includes("has enough coins")) {
        return player.getInventory().getAmount(ITEM.coins) >= 2000;
      }
      if (value.includes("has not fixed the ship")) return stage < STAGE_REPAIR_3;
      if (value.includes("has fixed the ship")) return stage >= STAGE_REPAIR_3;
      return null;
    }

    if (NED_NPC_IDS.has(npcId)) {
      const mapReady = hasCrandorMap(player) || hasAllMapPieces(player);
      if (value.includes("shortcut has been opened")) return player.getAttribute(ATTR_SHORTCUT) === true;
      if (value.includes("hasn't bought the ship yet")) return stage < STAGE_BOUGHT_SHIP;
      if (value.includes("hasn't repaired the ship yet")) return stage < STAGE_REPAIR_3;
      if (value.includes("does not have the completed map or all 3 pieces")) return !mapReady;
      if (value.includes("has the completed map or all 3 pieces")) return mapReady;
      if (value.includes("does not have the completed map")) return !hasCrandorMap(player);
      if (value.includes("has all three map parts")) return hasAllMapPieces(player);
      if (value.includes("has the completed map")) return hasCrandorMap(player);
      return null;
    }

    if (npcId === DUKE_HORACIO_NPC_ID) {
      if (value.includes("has not finished dragon slayer i")) return stage < STAGE_COMPLETE;
      if (value.includes("has finished dragon slayer i")) return stage >= STAGE_COMPLETE;
      return null;
    }

    return null;
  }

  // ============================================================================
  // Hooks / choices / chosen conditions that carry state
  // ============================================================================

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== START_HOOK || npcId !== GUILDMASTER_NPC_ID) return;
    if (quest.getStage(player) !== STAGE_NOT_STARTED) return;
    if (questPoints(player) < REQUIRED_QUEST_POINTS) {
      player.sendMessage("Only champions with at least 32 Quest Points may take this challenge.");
      return;
    }
    quest.setStage(player, STAGE_GUILDMASTER);
  }

  // Klarense's purchase branch has no action id; do the sale when the
  // "has enough coins" condition is the one the transcript picks.
  function handlePurchaseCondition({ player, npcId, stepId }) {
    if (npcId !== KLARENSE_NPC_ID || stepId !== "FSI6VP") return;
    if (quest.getStage(player) !== STAGE_OZIACH) {
      if (quest.getStage(player) < STAGE_OZIACH) {
        player.sendMessage("The Lady Lumbridge is not for sale to you.");
      }
      return;
    }
    if (player.getInventory().getAmount(ITEM.coins) < 2000) return;
    player.getInventory().deleteNumber(ITEM.coins, 2000);
    quest.setStage(player, STAGE_BOUGHT_SHIP);
    player.sendMessage("You buy the Lady Lumbridge for 2,000 coins.");
  }

  // ============================================================================
  // Hand-ins and completion
  // ============================================================================

  function handleDialogueAction(event) {
    const { player, npcId, stepId } = event;
    const stage = quest.getStage(player);

    if (npcId === WORMBRAIN_NPC_ID && stepId === "I8YYjs") {
      if (hasItem(player, ITEM.coins, 10000) && !ownsMapPiece(player, ITEM.mapWormbrain)) {
        player.getInventory().deleteNumber(ITEM.coins, 10000);
        giveItem(player, ITEM.mapWormbrain);
      }
      return; // leave the transcript's own message to play
    }

    if (npcId === GUILDMASTER_NPC_ID && stepId === "xUz7Ja") {
      if (!hasItem(player, ITEM.mazeKey) && !player.getInventory().isFull()) {
        player.getInventory().adds(ITEM.mazeKey, 1);
      }
      return;
    }

    if (
      npcId === DUKE_HORACIO_NPC_ID &&
      (stepId === "LnbjYr" || stepId === "igRDii" || stepId === "if_uB3" || stepId === "emj6I8")
    ) {
      if (!hasItem(player, ITEM.antiDragonShield) && !player.getInventory().isFull()) {
        player.getInventory().adds(ITEM.antiDragonShield, 1);
      }
      return;
    }

    if (
      NED_NPC_IDS.has(npcId) &&
      (stepId === "PjZiNz" || stepId === "fvCrJ7" || stepId === "nJiC7S")
    ) {
      if (stage >= STAGE_REPAIR_3 && stage < STAGE_NED_READY) {
        if (hasCrandorMap(player)) {
          player.getInventory().deleteNumber(ITEM.crandorMap, 1);
        } else if (hasAllMapPieces(player)) {
          for (const id of MAP_PIECES) player.getInventory().deleteNumber(id, 1);
        } else {
          return;
        }
        quest.setStage(player, STAGE_NED_READY);
      }
      return;
    }

    if (npcId === OZIACH_NPC_ID && stepId === "0KEI_n") {
      if (quest.getStage(player) < STAGE_COMPLETE) quest.complete(player);
      player.setAttribute(ATTR_OZIACH_CONGRATS, true);
      event.handled = true;
      event.end = true;
      return;
    }

    // Ship cutscene stage directions: move the player without a spawned
    // instance, then let the remaining narration play out.
    if (stepId === "1nn6tK" || stepId === "9r5-VW") {
      if (stage >= STAGE_NED_READY && stage < STAGE_COMPLETE) {
        sailToCrandor(player);
        event.handled = true;
        event.end = false;
      }
    }
  }

  // ============================================================================
  // Map pieces and maze / Oracle / ship / Crandor objects
  // ============================================================================

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    if (usedItemId === usedWithItemId) return;
    if (!MAP_PIECES.includes(usedItemId) || !MAP_PIECES.includes(usedWithItemId)) return;
    if (hasAllMapPieces(player)) {
      for (const id of MAP_PIECES) player.getInventory().deleteNumber(id, 1);
      player.getInventory().adds(ITEM.crandorMap, 1);
      player.sendMessage(
        "You put the three pieces together and assemble a map that shows the route through the reefs to Crandor."
      );
    } else {
      player.sendMessage("You still need one more piece of map.");
    }
    event.handled = true;
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    const stage = quest.getStage(player);

    if (itemId === ITEM.mazeKey && objectId === LOC.melzarEntrance) {
      if (stage >= STAGE_OZIACH) player.moveTo(TILE.melzarInside.clone());
      event.handled = true;
      return;
    }

    const doorIndex = MAZE_DOORS.indexOf(objectId);
    if (doorIndex >= 0 && MAZE_KEYS.includes(itemId)) {
      if (itemId !== MAZE_KEYS[doorIndex]) {
        player.sendMessage("This key doesn't fit this door.");
        event.handled = true;
        return;
      }
      player.getInventory().deleteNumber(itemId, 1);
      player.sendMessage("The key disintegrates as it unlocks the door.");
      const loc = event.location;
      const px = player.getLocation().getX();
      player.moveTo(new Location(px <= loc.x ? loc.x + 1 : loc.x - 1, loc.y, loc.z));
      event.handled = true;
      return;
    }

    if (itemId === ITEM.plank && objectId === LOC.shipHole) {
      repairShip(player);
      event.handled = true;
    }
  }

  function handleShipHoleClick(event) {
    repairShip(event.player);
  }

  function handleGangplankClick(event) {
    if (quest.getStage(event.player) !== STAGE_NED_READY) {
      event.player.sendMessage("The ship is not ready to sail yet.");
      return;
    }
    sailToCrandor(event.player);
  }

  function handleMagicDoorClick(event) {
    const { player } = event;
    if (oracleState(player) < 2) {
      player.sendMessage("The magic door is locked.");
      return;
    }
    if (oracleState(player) < 3) {
      if (!OFFERINGS.every((id) => hasItem(player, id))) {
        player.sendMessage("The door remains locked. The Oracle's four offerings are required.");
        return;
      }
      for (const id of OFFERINGS) player.getInventory().deleteNumber(id, 1);
      setOracleState(player, 3);
    }
    const loc = event.location;
    const px = player.getLocation().getX();
    player.moveTo(new Location(px <= loc.x ? loc.x + 1 : loc.x - 1, loc.y, loc.z));
    player.sendMessage("The door swings open.");
  }

  function handleOracleChestClick(event) {
    const { player } = event;
    if (oracleState(player) < 3 || ownsMapPiece(player, ITEM.mapOracle)) {
      player.sendMessage("You find nothing useful.");
      return;
    }
    if (giveItem(player, ITEM.mapOracle)) player.sendMessage("You find a piece of an old map.");
  }

  function handleMelzarChestClick(event) {
    const { player } = event;
    if (quest.getStage(player) < STAGE_OZIACH || ownsMapPiece(player, ITEM.mapMelzar)) {
      player.sendMessage("You find nothing in the chest.");
      return;
    }
    if (giveItem(player, ITEM.mapMelzar)) player.sendMessage("You find a piece of an old map.");
  }

  function handleCrandorOpeningClick(event) {
    event.player.moveTo(TILE.elvargLair.clone());
  }

  function handleCrandorRopeClick(event) {
    event.player.setAttribute(ATTR_SHORTCUT, true);
    event.player.moveTo(TILE.crandorSurface.clone());
  }

  // ============================================================================
  // NPC deaths: maze keys, Wormbrain's map piece and Elvarg
  // ============================================================================

  function handleNpcDeath(event) {
    const { killer, npcId } = event;
    if (!killer || typeof killer.getInventory !== "function") return;
    const stage = quest.getStage(killer);

    if (ELVARG_NPC_IDS.has(npcId)) {
      if (stage === STAGE_CRANDOR) {
        killer.sendMessage("Elvarg is slain! You have completed Dragon Slayer I.");
        quest.complete(killer);
      }
      return;
    }

    if (npcId === WORMBRAIN_NPC_ID) {
      if (stage >= STAGE_OZIACH && !ownsMapPiece(killer, ITEM.mapWormbrain)) {
        dropItem(killer, ITEM.mapWormbrain, event.location);
        killer.sendMessage("Wormbrain drops a map piece on the floor.");
      }
      return;
    }

    const dropIndex = MAZE_KEY_DROPPERS.indexOf(npcId);
    if (
      dropIndex >= 0 &&
      stage >= STAGE_OZIACH &&
      stage < STAGE_NED_READY &&
      !hasItem(killer, MAZE_KEYS[dropIndex])
    ) {
      giveItem(killer, MAZE_KEYS[dropIndex]);
    }
  }

  function repairShip(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_BOUGHT_SHIP || stage >= STAGE_REPAIR_3) {
      player.sendMessage("The ship doesn't need repairing.");
      return;
    }
    if (!hasItem(player, ITEM.plank)) {
      player.sendMessage("You'll need to use wooden planks on this hole to patch it up.");
      return;
    }
    if (!hasItem(player, ITEM.steelNails, 30)) {
      player.sendMessage("You need 30 steel nails to attach the plank with.");
      return;
    }
    player.getInventory().deleteNumber(ITEM.plank, 1);
    player.getInventory().deleteNumber(ITEM.steelNails, 30);
    const next =
      stage === STAGE_BOUGHT_SHIP ? STAGE_REPAIR_1 : stage === STAGE_REPAIR_1 ? STAGE_REPAIR_2 : STAGE_REPAIR_3;
    quest.setStage(player, next);
    player.sendMessage(
      next >= STAGE_REPAIR_3
        ? "You nail a final plank over the hole. You have successfully patched the hole in the ship."
        : "You nail a plank over the hole, but you still need more planks to close it completely."
    );
  }

  quest = registerQuest(api, {
    key: "dragon_slayer_i",
    name: "Dragon Slayer I",
    varpId: VARP_DRAGON_SLAYER,
    startedValue: STAGE_GUILDMASTER,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.STRENGTH.getIndex(), amount: 18650, label: "Strength" },
      { skillId: Skill.DEFENCE.getIndex(), amount: 18650, label: "Defence" },
    ],
    scrollItemId: ITEM.antiDragonShield,
    otherRewards: [
      "The right to wear rune platebodies and green dragonhide bodies",
      "Access to Crandor",
    ],
    buildJournal,
    onReward: reward,
  });

  api.persistAttribute(ATTR_ORACLE);
  api.persistAttribute(ATTR_NED_ASKED);
  api.persistAttribute(ATTR_OZIACH_CONGRATS);
  api.persistAttribute(ATTR_SHORTCUT);
  itemOnGroundManager = api.getItemOnGroundManager();

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handlePurchaseCondition);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject);
  api.onObjectFirstClick(LOC.shipHole, handleShipHoleClick);
  api.onObjectFirstClick(LOC.shipGangplanks, handleGangplankClick);
  api.onObjectFirstClick(LOC.magicDoor, handleMagicDoorClick);
  api.onObjectFirstClick(LOC.oracleChest, handleOracleChestClick);
  api.onObjectFirstClick(LOC.melzarChest, handleMelzarChestClick);
  api.onObjectFirstClick(LOC.crandorOpening, handleCrandorOpeningClick);
  api.onObjectFirstClick(LOC.crandorRope, handleCrandorRopeClick);
  api.onNpcDeath(handleNpcDeath);
};
