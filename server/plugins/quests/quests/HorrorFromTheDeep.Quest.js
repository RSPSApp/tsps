/**
 * Horror from the Deep (members).
 *
 * Words come from the "Horror from the Deep" transcript page; this plugin supplies
 * the variant selector for Larrissa (4425/4426), Jossik (4423/4424) and Gunnjorn
 * (2153), the prose-condition answers (bookcase space), the start hook, the bridge
 * plank hand-in, the lighthouse door/key, the strange-wall rune/sword/arrow
 * offerings, the lighting-mechanism repairs, and the dagannoth -> dagannoth mother
 * boss progression that completes the quest.
 *
 * Stages (varp 351 "deephorror"): 1 started, 2 entered the lighthouse, 4 lighthouse
 * repaired, 5 dagannoth defeated, 10 complete. Progress beyond the stage (bridge
 * halves, key, door, tar/glass/light, wall offerings) lives in the persisted
 * "quest.horror_from_the_deep.flags" bitmask.
 *
 * Source: LostCityRS/Content quest_horror (pinned in issue #196).
 * Gaps: the dagannoth mother colour phases and their change messages are not
 * reproduced (one attackable form, 988, is spawned); stair/ladder travel between
 * the lighthouse floors and the cave, the basalt-rock and broken-bridge jumps, the
 * lighthouse shop, the god-book reward choice/reclaim and the post-quest bookcase
 * are not simulated; sword/arrow wall offerings are matched by item name rather
 * than the cache weapon category.
 */
module.exports = function registerHorrorFromTheDeepQuest(api) {
  const {
    Skill,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
    ItemDefinition,
    Location,
  } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const LARRISSA_NPC_IDS = new Set([NpcIdentifiers.LARRISSA, NpcIdentifiers.LARRISSA_2]);
  const JOSSIK_NPC_IDS = new Set([NpcIdentifiers.JOSSIK, NpcIdentifiers.JOSSIK_2]);
  const GUNNJORN_NPC_ID = NpcIdentifiers.GUNNJORN;
  const DAGANNOTH_JR_ID = NpcIdentifiers.DAGANNOTH_11; // 979, walkable level-100 Dagannoth
  const DAGANNOTH_MOTHER_ID = NpcIdentifiers.DAGANNOTH_MOTHER_9; // 988, attackable mother

  const LIGHTHOUSE_DOOR_ID = ObjectIdentifiers.DOORWAY_6; // 4577
  const BOOKCASE_ID = ObjectIdentifiers.BOOKCASE_15; // 4617
  const BRIDGE_IDS = new Set([ObjectIdentifiers.BROKEN_BRIDGE, ObjectIdentifiers.BROKEN_BRIDGE_2]);
  const LIGHTING_MECHANISM_IDS = new Set([
    ObjectIdentifiers.LIGHTING_MECHANISM,
    ObjectIdentifiers.LIGHTING_MECHANISM_2,
    ObjectIdentifiers.LIGHTING_MECHANISM_3,
    ObjectIdentifiers.LIGHTING_MECHANISM_4,
  ]);
  const STRANGE_WALL_MID_IDS = new Set([
    ObjectIdentifiers.STRANGE_WALL,
    ObjectIdentifiers.STRANGE_WALL_2,
  ]);
  const STRANGE_WALL_FAR_IDS = new Set([
    ObjectIdentifiers.STRANGE_WALL_3,
    ObjectIdentifiers.STRANGE_WALL_4,
  ]);
  const IRON_LADDER_IDS = new Set([
    ObjectIdentifiers.IRON_LADDER,
    ObjectIdentifiers.IRON_LADDER_2,
    ObjectIdentifiers.IRON_LADDER_3,
    ObjectIdentifiers.IRON_LADDER_4,
  ]);

  const VARP_HORROR_FROM_THE_DEEP = 351; // "deephorror"
  const STAGE_STARTED = 1;
  const STAGE_ENTERED_LIGHTHOUSE = 2;
  const STAGE_REPAIRED_LIGHTHOUSE = 4;
  const STAGE_DEFEATED_DAGANNOTH = 5;
  const STAGE_COMPLETE = 10;

  const LIGHTHOUSE_KEY = ItemIdentifiers.LIGHTHOUSE_KEY;
  const RUSTY_CASKET = ItemIdentifiers.RUSTY_CASKET;
  const PLANK = ItemIdentifiers.PLANK;
  const STEEL_NAILS = ItemIdentifiers.STEEL_NAILS;
  const HAMMER = ItemIdentifiers.HAMMER;
  const SWAMP_TAR = ItemIdentifiers.SWAMP_TAR;
  const MOLTEN_GLASS = ItemIdentifiers.MOLTEN_GLASS;
  const TINDERBOX = ItemIdentifiers.TINDERBOX;
  const MANUAL = ItemIdentifiers.MANUAL;
  const DIARY = ItemIdentifiers.DIARY_3;
  const JOURNAL = ItemIdentifiers.JOURNAL_2;

  const ATTR_FLAGS = "quest.horror_from_the_deep.flags";
  const FLAG_BRIDGE_LEFT = 1 << 0;
  const FLAG_BRIDGE_RIGHT = 1 << 1;
  const FLAG_KEY_GIVEN = 1 << 2;
  const FLAG_DOOR_UNLOCKED = 1 << 3;
  const FLAG_TAR = 1 << 4;
  const FLAG_GLASS = 1 << 5;
  const FLAG_LIGHT = 1 << 6;
  const FLAG_WALL_AIR = 1 << 7;
  const FLAG_WALL_WATER = 1 << 8;
  const FLAG_WALL_EARTH = 1 << 9;
  const FLAG_WALL_FIRE = 1 << 10;
  const FLAG_WALL_SWORD = 1 << 11;
  const FLAG_WALL_ARROW = 1 << 12;
  const WALL_BITS = [
    FLAG_WALL_AIR,
    FLAG_WALL_WATER,
    FLAG_WALL_EARTH,
    FLAG_WALL_FIRE,
    FLAG_WALL_SWORD,
    FLAG_WALL_ARROW,
  ];

  const WALL_RUNES = [
    {
      itemId: ItemIdentifiers.AIR_RUNE,
      bit: FLAG_WALL_AIR,
      place: "You place an air rune into the slot in the wall.",
      already: "There is no space to put an air rune into the wall.",
    },
    {
      itemId: ItemIdentifiers.WATER_RUNE,
      bit: FLAG_WALL_WATER,
      place: "You place a water rune into the slot in the wall.",
      already: "There is no space to put a water rune into the wall.",
    },
    {
      itemId: ItemIdentifiers.EARTH_RUNE,
      bit: FLAG_WALL_EARTH,
      place: "You place an earth rune into the slot in the wall.",
      already: "There is no space to put an earth rune into the wall.",
    },
    {
      itemId: ItemIdentifiers.FIRE_RUNE,
      bit: FLAG_WALL_FIRE,
      place: "You place a fire rune into the slot in the wall.",
      already: "There is no space to put a fire rune into the wall.",
    },
  ];
  const SWORD_NAME_PATTERN = /(sword|scimitar|dagger|claws?|whip|halberd|spear|mace|battleaxe|\baxe\b|scythe|excalibur|silverlight)/;
  const BOOK_ACTIONS = new Map([
    ["v-MHfA", MANUAL],
    ["LZ1XXE", DIARY],
    ["awYSNR", JOURNAL],
  ]);

  const START_HOOK = "quest:horror-from-the-deep:start";
  const SPAWN_DAGANNOTH_ACTION_ID = "fhKQH9";
  const SPAWN_MOTHER_ACTION_ID = "yh8sGI";
  const COMPLETE_ACTION_ID = "a0mVSp";

  let quest;
  const bossesByPlayer = new Map();

  const getFlags = (player) => Number(player.getAttribute(ATTR_FLAGS)) || 0;
  const hasFlag = (player, bit) => (getFlags(player) & bit) !== 0;
  const hasItem = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  function setFlag(player, bit, value = true) {
    const flags = getFlags(player);
    player.setAttribute(ATTR_FLAGS, value ? (flags | bit) : (flags & ~bit));
  }

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull?.() === true
        ? 0
        : 28;
  }

  const bridgesFixed = (player) => hasFlag(player, FLAG_BRIDGE_LEFT) && hasFlag(player, FLAG_BRIDGE_RIGHT);
  const wallComplete = (player) => WALL_BITS.every((bit) => hasFlag(player, bit));

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I travelled to the isolated lighthouse north of the</str>",
        "<str>Barbarian Outpost and helped Larrissa find Jossik.</str>",
        "<str>I repaired the lighthouse light and slew the sea</str>",
        "<str>monsters beneath it.</str>",
        "",
        "<str>I can now buy god books from Jossik.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage <= 0) {
      return [
        "I can start this quest by speaking to <col=800000>Larrissa</col>",
        "at the <col=800000>Lighthouse</col> north of the",
        "<col=800000>Barbarian Outpost</col>.",
        "",
        "I need 35 <col=800000>Agility</col> and Alfred Grimhand's Barcrawl.",
      ];
    }
    const lines = ["Larrissa is very worried about her boyfriend Jossik."];
    lines.push(
      bridgesFixed(player)
        ? "<str>I have repaired the broken bridge to Rellekka.</str>"
        : "I need to repair the bridge with two planks, a hammer and steel nails."
    );
    lines.push(
      hasItem(player, LIGHTHOUSE_KEY) || hasFlag(player, FLAG_DOOR_UNLOCKED)
        ? "<str>I have the lighthouse key from Gunnjorn.</str>"
        : "I need to get the lighthouse key from <col=800000>Gunnjorn</col>."
    );
    if (stage >= STAGE_ENTERED_LIGHTHOUSE) {
      lines.push("I must repair the lighthouse light:");
      lines.push(hasFlag(player, FLAG_TAR) ? "<str>The torch has been re-tarred.</str>" : "Use swamp tar on the lighting mechanism.");
      lines.push(hasFlag(player, FLAG_GLASS) ? "<str>The lens has been repaired.</str>" : "Use molten glass on the lighting mechanism.");
      lines.push(hasFlag(player, FLAG_LIGHT) ? "<str>The torch has been lit.</str>" : "Light the torch with a tinderbox.");
    }
    if (stage >= STAGE_REPAIRED_LIGHTHOUSE) {
      if (wallComplete(player)) {
        lines.push("<str>The strange wall is open.</str>");
      } else {
        lines.push("I must put the four elemental runes, a sword and an arrow into the strange wall.");
      }
    }
    if (stage >= STAGE_DEFEATED_DAGANNOTH) {
      lines.push("I must defeat the dagannoth mother to save Jossik!");
    }
    return lines;
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.MAGIC, 4662);
    skills.addExperiences(Skill.STRENGTH, 4662);
    skills.addExperiences(Skill.RANGED, 4662);
  }

  function larrissaVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "after-horror-from-the-deep";
    if (stage >= STAGE_DEFEATED_DAGANNOTH) {
      return "upon-killing-the-dagannoth-or-talking-to-jossik-talking-to-larrissa-after-killing-the-dagannoth";
    }
    if (stage >= STAGE_REPAIRED_LIGHTHOUSE) return "returning-to-larrissa-talking-to-larrissa-outside";
    if (stage >= STAGE_ENTERED_LIGHTHOUSE) return "talking-to-larrissa-inside-the-lighthouse";
    if (stage >= STAGE_STARTED) {
      const unlocked = hasFlag(player, FLAG_DOOR_UNLOCKED);
      if (bridgesFixed(player) && (hasItem(player, LIGHTHOUSE_KEY) || unlocked)) {
        return "returning-with-the-key-or-door-unlocked-and-the-bridge-repaired";
      }
      if (bridgesFixed(player)) {
        return "getting-the-key-returning-to-larrissa-after-repairing-the-bridge-but-without-the-key";
      }
      if (hasItem(player, LIGHTHOUSE_KEY)) {
        return "getting-the-key-returning-the-key-to-larrissa-before-repairing-the-bridge";
      }
      return "starting-off-talking-to-her-again";
    }
    return "starting-off";
  }

  function jossikVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return null; // default Jossik page handles post-quest
    if (stage >= STAGE_DEFEATED_DAGANNOTH) return "upon-killing-the-dagannoth-or-talking-to-jossik";
    if (stage >= STAGE_REPAIRED_LIGHTHOUSE) return "talking-to-jossik-in-the-basement";
    return null;
  }

  function gunnjornVariant(player) {
    if (quest.getStage(player) !== STAGE_STARTED) return null;
    if (hasItem(player, LIGHTHOUSE_KEY)) return null; // default Gunnjorn page
    return hasFlag(player, FLAG_KEY_GIVEN)
      ? "getting-the-key-after-obtaining-the-key"
      : "getting-the-key";
  }

  function selectVariant({ npcId, player }) {
    if (LARRISSA_NPC_IDS.has(npcId)) return larrissaVariant(player);
    if (JOSSIK_NPC_IDS.has(npcId)) return jossikVariant(player);
    if (npcId === GUNNJORN_NPC_ID) return gunnjornVariant(player);
    return null;
  }

  /** Answer the bookcase prose conditions; everything else belongs to another plugin. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (!value.includes("inventory space")) return null;
    const slots = freeSlots(player);
    if (value.includes("three open inventory spaces")) return slots < 3;
    if (value.includes("space for all three")) return slots >= 3;
    if (value.includes("does not have an open inventory space")) return slots < 1;
    if (value.includes("does have inventory space")) return slots >= 1;
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!LARRISSA_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  function spawnAtPlayer(player, npcId) {
    if (bossesByPlayer.has(player)) return;
    const location = player.getLocation();
    const npc = api.spawnNpc({
      id: npcId,
      x: location.getX() + 1,
      y: location.getY(),
      z: location.getZ(),
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) bossesByPlayer.set(player, npc);
  }

  function clearBoss(player) {
    const npc = bossesByPlayer.get(player);
    if (npc) api.removeNpc(npc);
    bossesByPlayer.delete(player);
  }

  /** Gunnjorn's key hand-out, the dagannoth spawns and the terminal completion action. */
  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (!player) return;
    if (npcId === GUNNJORN_NPC_ID && (stepId === "Wh6Z8x" || stepId === "fpqzrz")) {
      if (!hasItem(player, LIGHTHOUSE_KEY)) {
        player.getInventory().adds(LIGHTHOUSE_KEY, 1);
        setFlag(player, FLAG_KEY_GIVEN, true);
      }
      return;
    }
    if (JOSSIK_NPC_IDS.has(npcId) && stepId === SPAWN_DAGANNOTH_ACTION_ID) {
      if (quest.getStage(player) < STAGE_REPAIRED_LIGHTHOUSE) return;
      if (quest.getStage(player) >= STAGE_DEFEATED_DAGANNOTH) return;
      spawnAtPlayer(player, DAGANNOTH_JR_ID);
      return;
    }
    if (JOSSIK_NPC_IDS.has(npcId) && stepId === SPAWN_MOTHER_ACTION_ID) {
      if (quest.getStage(player) < STAGE_DEFEATED_DAGANNOTH || quest.isComplete(player)) return;
      spawnAtPlayer(player, DAGANNOTH_MOTHER_ID);
      return;
    }
    if (stepId === COMPLETE_ACTION_ID) {
      if (!quest.isComplete(player)) quest.complete(player);
      return;
    }
    const book = BOOK_ACTIONS.get(stepId);
    if (book !== undefined) {
      if (freeSlots(player) >= 1) player.getInventory().adds(book, 1);
      return;
    }
    if (stepId === "yT1TRy") {
      if (freeSlots(player) < 3) return;
      player.getInventory().adds(MANUAL, 1);
      player.getInventory().adds(DIARY, 1);
      player.getInventory().adds(JOURNAL, 1);
    }
  }

  function handleNpcDeath(event) {
    const player = event.killer;
    if (!player || player.isPlayer?.() === false) return;
    if (bossesByPlayer.get(player) === event.npc) bossesByPlayer.delete(player);
    if (event.npcId === DAGANNOTH_JR_ID && quest.getStage(player) === STAGE_REPAIRED_LIGHTHOUSE) {
      quest.setStage(player, STAGE_DEFEATED_DAGANNOTH);
      return;
    }
    if (event.npcId === DAGANNOTH_MOTHER_ID && quest.getStage(player) >= STAGE_DEFEATED_DAGANNOTH) {
      if (!quest.isComplete(player)) quest.complete(player);
    }
  }

  function handleLighthouseDoor(event) {
    const { player } = event;
    if (quest.getStage(player) >= STAGE_ENTERED_LIGHTHOUSE) return; // door is open + walkable
    event.handled = true;
    if (!hasFlag(player, FLAG_DOOR_UNLOCKED)) {
      if (hasItem(player, LIGHTHOUSE_KEY)) {
        player.getInventory().deleteNumber(LIGHTHOUSE_KEY, 1);
        setFlag(player, FLAG_DOOR_UNLOCKED, true);
        player.sendMessage("You unlock the Lighthouse front door.");
      } else {
        player.sendMessage("This door is locked securely shut.");
      }
      return;
    }
    if (!bridgesFixed(player)) {
      player.sendMessage("Please adventurer... We are both curious as to what has happened in that lighthouse, but you need to fix the bridge for me!");
      return;
    }
    quest.setStage(player, STAGE_ENTERED_LIGHTHOUSE);
  }

  function handleBookcase(event) {
    const { player } = event;
    event.handled = true;
    const books = [MANUAL, DIARY, JOURNAL].filter((itemId) => !hasItem(player, itemId));
    if (books.length === 0) {
      player.sendMessage("There is nothing else of interest here.");
      return;
    }
    if (freeSlots(player) < books.length) {
      player.sendMessage("You do not have enough room to take all three.");
      return;
    }
    for (const book of books) player.getInventory().adds(book, 1);
    player.sendMessage("You take the books from the bookcase.");
  }

  function handleFarStrangeDoor(event) {
    const { player } = event;
    if (!wallComplete(player)) {
      event.handled = true;
      player.sendMessage("You cannot see any way to move this part of the wall...");
      return;
    }
    const from = player.getLocation();
    const wall = event.location;
    const stepX = Math.sign(wall.x - from.getX());
    const stepY = Math.sign(wall.y - from.getY());
    event.handled = true;
    player.moveTo(new Location(wall.x + stepX, wall.y + stepY, from.getZ()));
    player.sendMessage("You pass through the opening in the strange wall.");
  }

  function handleLighthouseLadder(event) {
    if (quest.getStage(event.player) >= STAGE_REPAIRED_LIGHTHOUSE) return;
    event.handled = true;
    event.player.sendMessage("You must fix the lighthouse before any ships crash!");
  }

  function handleObjectInteraction(event) {
    if (event.objectId === LIGHTHOUSE_DOOR_ID) return handleLighthouseDoor(event);
    if (event.objectId === BOOKCASE_ID) return handleBookcase(event);
    if (STRANGE_WALL_FAR_IDS.has(event.objectId)) return handleFarStrangeDoor(event);
    if (IRON_LADDER_IDS.has(event.objectId)) return handleLighthouseLadder(event);
  }

  function handleBridgePlank(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) <= 0) {
      player.sendMessage("You have no reason to do that.");
      return;
    }
    if (event.itemId !== PLANK) {
      player.sendMessage("That won't help fix the bridge.");
      return;
    }
    const side = event.objectId === ObjectIdentifiers.BROKEN_BRIDGE ? FLAG_BRIDGE_LEFT : FLAG_BRIDGE_RIGHT;
    if (hasFlag(player, side)) {
      player.sendMessage("You have already fixed this half of the bridge.");
      return;
    }
    if (!hasItem(player, STEEL_NAILS, 4)) {
      player.sendMessage("You need 4 steel nails to attach the plank with.");
      return;
    }
    if (!hasItem(player, HAMMER)) {
      player.sendMessage("You need a hammer to hammer the nails in with.");
      return;
    }
    player.getInventory().deleteNumber(PLANK, 1);
    player.getInventory().deleteNumber(STEEL_NAILS, 4);
    setFlag(player, side, true);
    const other = side === FLAG_BRIDGE_LEFT ? FLAG_BRIDGE_RIGHT : FLAG_BRIDGE_LEFT;
    player.sendMessage(
      hasFlag(player, other)
        ? "You have now made a makeshift walkway over the bridge."
        : "You create half a makeshift walkway out of the plank."
    );
  }

  function checkLighthouseRepaired(player) {
    if (!hasFlag(player, FLAG_TAR) || !hasFlag(player, FLAG_GLASS) || !hasFlag(player, FLAG_LIGHT)) return;
    if (quest.getStage(player) < STAGE_REPAIRED_LIGHTHOUSE) {
      quest.setStage(player, STAGE_REPAIRED_LIGHTHOUSE);
    }
    player.sendMessage("You have managed to repair the lighthouse torch!");
  }

  function handleLightingMechanism(event) {
    const { player, itemId } = event;
    if (itemId === SWAMP_TAR) {
      event.handled = true;
      if (hasFlag(player, FLAG_TAR)) {
        player.sendMessage("You have already put tar on the torch.");
        return;
      }
      setFlag(player, FLAG_TAR, true);
      player.getInventory().deleteNumber(SWAMP_TAR, 1);
      player.sendMessage("You use the swamp tar to make the torch flammable again.");
      return;
    }
    if (itemId === TINDERBOX) {
      event.handled = true;
      if (hasFlag(player, FLAG_LIGHT)) {
        player.sendMessage("You have already lit the torch.");
        return;
      }
      if (!hasFlag(player, FLAG_TAR)) {
        player.sendMessage("The torch does not seem to be flammable...");
        return;
      }
      setFlag(player, FLAG_LIGHT, true);
      player.sendMessage("You light the torch with your tinderbox");
      checkLighthouseRepaired(player);
      return;
    }
    if (itemId === MOLTEN_GLASS) {
      event.handled = true;
      if (hasFlag(player, FLAG_GLASS)) {
        player.sendMessage("You have already repaired the lens.");
        return;
      }
      setFlag(player, FLAG_GLASS, true);
      player.getInventory().deleteNumber(MOLTEN_GLASS, 1);
      player.sendMessage("You use the molten glass to repair the lens");
      checkLighthouseRepaired(player);
    }
  }

  function wallPieceFor(itemId) {
    for (const rune of WALL_RUNES) {
      if (rune.itemId === itemId) return rune;
    }
    const definition = ItemDefinition.forId(itemId);
    const name = String(definition?.getName?.() ?? "").toLowerCase();
    if (name.endsWith("arrow") && !name.includes("ogre") && !name.includes("training")) {
      return {
        bit: FLAG_WALL_ARROW,
        place: "You place an arrow into the slot in the wall.",
        already: "There is no space to put an arrow into the wall.",
      };
    }
    if (SWORD_NAME_PATTERN.test(name) && !name.includes("rusty") && !name.includes("prop")) {
      return {
        bit: FLAG_WALL_SWORD,
        place: "You place a sword into the slot in the wall.",
        already: "There is no space to put a weapon into the wall.",
      };
    }
    return null;
  }

  function handleStrangeWall(event) {
    const { player, itemId } = event;
    const piece = wallPieceFor(itemId);
    if (!piece) return;
    event.handled = true;
    if (quest.getStage(player) < STAGE_REPAIRED_LIGHTHOUSE) {
      player.sendMessage("You cannot see any way to move this part of the wall...");
      return;
    }
    if (hasFlag(player, piece.bit)) {
      player.sendMessage(piece.already);
      return;
    }
    player.getInventory().deleteNumber(itemId, 1);
    setFlag(player, piece.bit, true);
    player.sendMessage(piece.place);
    if (wallComplete(player)) {
      player.sendMessage("You hear the sound of something moving within the wall.");
    }
  }

  function handleItemOnObject(event) {
    if (BRIDGE_IDS.has(event.objectId)) return handleBridgePlank(event);
    if (LIGHTING_MECHANISM_IDS.has(event.objectId)) return handleLightingMechanism(event);
    if (STRANGE_WALL_MID_IDS.has(event.objectId)) return handleStrangeWall(event);
  }

  function handleLogout({ player }) {
    if (player) clearBoss(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  api.persistAttribute(ATTR_FLAGS);

  quest = registerQuest(api, {
    key: "horror_from_the_deep",
    name: "Horror from the Deep",
    varpId: VARP_HORROR_FROM_THE_DEEP,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.MAGIC.getIndex(), amount: 4662, label: "Magic" },
      { skillId: Skill.STRENGTH.getIndex(), amount: 4662, label: "Strength" },
      { skillId: Skill.RANGED.getIndex(), amount: 4662, label: "Ranged" },
    ],
    rewardItemId: RUSTY_CASKET,
    rewardItemLabel: "A rusty casket",
    otherRewards: ["The ability to buy god books from Jossik", "Access to the Dagannoth caves"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onNpcDeath(handleNpcDeath);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onPlayerLogout(handleLogout);
  api.onPlayerLogin(handleLogin);
};
