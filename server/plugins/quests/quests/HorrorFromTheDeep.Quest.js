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
 * Stages (varbit 34, bits 0-10 of varp 351 "deephorror"): 1 started, 2 entered
 * the lighthouse, 4 lighthouse repaired, 5 dagannoth defeated, 10 complete.
 * Cache quest DB row 74 column 19 requires 10, and script 4024 case 74 reads
 * varbit 34. Progress beyond the stage (bridge halves, key, door,
 * tar/glass/light, wall offerings) lives in the persisted
 * "quest.horror_from_the_deep.flags" bitmask.
 *
 * Travel is explicit: the ground-floor iron ladder drops into the basement (the
 * strange-wall room at 2513-2516,10003), the basement's foyer ladders (4485/4413)
 * drop into the dagannoth dungeon at 2515,4632 where Jossik (4424) sits, and each
 * ladder climbs back the way it came. The upstairs Jossik (4423) only speaks the
 * post-quest transcript; the basement fight is Jossik 4424 in the dungeon.
 *
 * Source: LostCityRS/Content quest_horror (pinned in issue #196).
 * The mother cycles through its six documented weaknesses every 30 game ticks
 * (18 seconds). Damage is gated against the current phase and the canonical
 * colour-change message reports the phase. The cached recolour HSL values map
 * forms 983-988 to white, blue, red, orange, green and brown respectively.
 * Gaps: the basalt-rock and
 * broken-bridge jumps, the lighthouse shop, god-book reclaim and the post-quest
 * bookcase are not simulated; sword/arrow wall offerings are
 * matched by item name rather than the cache weapon category.
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
  const JOSSIK_DUNGEON_ID = NpcIdentifiers.JOSSIK_2; // 4424, seated in the cave during the quest
  const JOSSIK_NPC_IDS = new Set([NpcIdentifiers.JOSSIK, JOSSIK_DUNGEON_ID]);
  const GUNNJORN_NPC_ID = NpcIdentifiers.GUNNJORN;
  const DAGANNOTH_JR_ID = NpcIdentifiers.DAGANNOTH_11; // 979, walkable level-100 Dagannoth
  const DAGANNOTH_MOTHER_ID = NpcIdentifiers.DAGANNOTH_MOTHER_9; // 988, attackable mother
  const MOTHER_PHASE_TICKS = 18 / 0.6;
  // Cache npc recolour HSL (hue is the high 6 bits, saturation the next 3,
  // lightness the low 7) identifies the visible forms: 983 neutral white,
  // 984 hue 42 blue, 985 hue 0 red, 986 hue 5 orange, 987 hue 21 green,
  // 988 hue 7 brown. Spell IDs below are CombatSpell.spellId() values.
  const MOTHER_PHASES = [
    { colour: "white", weakness: "air", npcId: NpcIdentifiers.DAGANNOTH_MOTHER_4 },
    { colour: "blue", weakness: "water", npcId: NpcIdentifiers.DAGANNOTH_MOTHER_5 },
    { colour: "orange", weakness: "melee", npcId: NpcIdentifiers.DAGANNOTH_MOTHER_7 },
    { colour: "brown", weakness: "earth", npcId: NpcIdentifiers.DAGANNOTH_MOTHER_9 },
    { colour: "red", weakness: "fire", npcId: NpcIdentifiers.DAGANNOTH_MOTHER_6 },
    { colour: "green", weakness: "ranged", npcId: NpcIdentifiers.DAGANNOTH_MOTHER_8 },
  ];
  const ELEMENTAL_SPELLS = new Map([
    [1152, "air"], [1160, "air"], [1172, "air"], [1183, "air"], [21876, "air"],
    [1154, "water"], [1163, "water"], [1175, "water"], [1185, "water"], [21877, "water"],
    [1156, "earth"], [1166, "earth"], [1177, "earth"], [1188, "earth"], [21878, "earth"],
    [1158, "fire"], [1169, "fire"], [1181, "fire"], [1189, "fire"], [21879, "fire"],
  ]);

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
  /** 4485, the foyer/dungeon ladder half that has no cache identifier. */
  const CAVE_LADDER_ID = 4485;
  const GROUND_LADDER_IDS = new Set([
    ObjectIdentifiers.IRON_LADDER, // 4380, lighthouse ground floor
    ObjectIdentifiers.IRON_LADDER_2, // 4383
  ]);
  const BASEMENT_LADDER_ID = ObjectIdentifiers.IRON_LADDER_3; // 4412
  const FOYER_LADDER_IDS = new Set([
    CAVE_LADDER_ID,
    ObjectIdentifiers.IRON_LADDER_4, // 4413
  ]);

  // The cache carries the lighthouse twice; all four landings are the quest map's.
  const BASEMENT_LANDING = new Location(2519, 9995, 0);
  const LIGHTHOUSE_LANDING = new Location(2508, 3645, 0);
  const FOYER_LANDING = new Location(2515, 10005, 0);
  const DUNGEON_LANDING = new Location(2515, 4632, 0);

  const BRIDGE_NAILS = 30;

  const VARP_HORROR_FROM_THE_DEEP = 351; // "deephorror"
  const VARBIT_HORROR_FROM_THE_DEEP = 34; // bits 0-10; script 4024 reads this for quest 74
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
  const FLAG_BOOK_CLAIMED = 1 << 13;
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
  // Jossik's post-quest casket exchange (Transcript:Jossik).
  const GOD_BOOK_ACTIONS = new Map([
    ["wZLOyL", ItemIdentifiers.DAMAGED_BOOK],
    ["UDtF8K", ItemIdentifiers.DAMAGED_BOOK_2],
    ["frpSFr", ItemIdentifiers.DAMAGED_BOOK_3],
  ]);

  const START_HOOK = "quest:horror-from-the-deep:start";
  const SPAWN_DAGANNOTH_ACTION_ID = "fhKQH9";
  const SPAWN_MOTHER_ACTION_ID = "yh8sGI";
  const COMPLETE_ACTION_ID = "a0mVSp";

  let quest;
  const bossesByPlayer = new Map();
  const motherPhasesByPlayer = new Map();

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

  function jossikVariant(player, npcId) {
    const stage = quest.getStage(player);
    // Once complete, Jossik opens with the casket exchange until it has been
    // handed in; afterwards his default shop page takes over.
    if (stage >= STAGE_COMPLETE) {
      return hasFlag(player, FLAG_BOOK_CLAIMED) ? null : "initial-dialogue-after-horror-from-the-deep";
    }
    if (npcId !== JOSSIK_DUNGEON_ID) return null;
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
    // Only the dungeon Jossik (4424) runs the basement scenes; either Jossik
    // carries the post-quest casket exchange.
    if (JOSSIK_NPC_IDS.has(npcId)) return jossikVariant(player, npcId);
    if (npcId === GUNNJORN_NPC_ID) return gunnjornVariant(player);
    return null;
  }

  /**
   * Gunnjorn's key transcript carries two prose branches (full inventory /
   * open inventory) as plain action steps, so the first would always play and
   * end the chat. Play the variant ourselves and drop the branch that does not
   * apply, leaving the "Sure. Here you go." hand-out reachable.
   */
  function talkToGunnjorn(event) {
    const { player } = event;
    const variant = gunnjornVariant(player);
    if (!variant) return false;
    const roomy = freeSlots(player) >= 1;
    api.emitCustomEvent("npc-dialogue:start", {
      player,
      npcId: GUNNJORN_NPC_ID,
      variant,
      select: (steps) => steps.filter((step) =>
        roomy ? step.id !== "RSeXNc" && step.id !== "zQMARq" : step.id !== "Wh6Z8x" && step.id !== "fpqzrz"),
    });
    return true;
  }

  /** Where a lighthouse ladder leads, or null when the object is not one. */
  function ladderMove(object) {
    if (!object) return null;
    const { x, y } = object.getLocation();
    if (GROUND_LADDER_IDS.has(object.getId()) && x >= 2500 && x <= 2520 && y >= 3635 && y <= 3655) {
      return { destination: BASEMENT_LANDING, up: false };
    }
    if (object.getId() === BASEMENT_LADDER_ID) {
      // The main basement (y~9994) goes back up to the lighthouse; the dungeon's
      // copy of that room (y~4618) leads out to the basement foyer.
      return y > 9000
        ? { destination: LIGHTHOUSE_LANDING, up: true }
        : { destination: FOYER_LANDING, up: true };
    }
    if (FOYER_LADDER_IDS.has(object.getId())) {
      return y > 9000
        ? { destination: DUNGEON_LANDING, up: false }
        : { destination: FOYER_LANDING, up: true };
    }
    return null;
  }

  /** Claims the lighthouse ladders from the generic ladder handler. */
  function handleLadderClaim(request) {
    const { player } = request;
    const move = ladderMove(request.object);
    if (!move) return;
    request.handled = true;
    if (quest.getStage(player) < STAGE_REPAIRED_LIGHTHOUSE) {
      player.sendMessage("You must fix the lighthouse before any ships crash!");
      return;
    }
    api.emitCustomEvent(move.up ? "ladders:climbUp" : "ladders:climbDown", {
      player,
      destination: move.destination,
    });
  }

  /** Answer the bookcase prose conditions; everything else belongs to another plugin. */
  function answerCondition({ player, npcId, text }) {
    if (!JOSSIK_NPC_IDS.has(npcId)) return null;
    const value = String(text).toLowerCase();
    if (value.includes("rusty casket")) {
      const hasCasket = hasItem(player, RUSTY_CASKET);
      if (value.includes("does not have")) return !hasCasket;
      if (value.includes("stored somewhere")) return false;
      return hasCasket;
    }
    if (value.includes("dropped it after obtaining it")) return !hasItem(player, RUSTY_CASKET);
    if (value.includes("full inventory")) return freeSlots(player) === 0;
    if (!value.includes("inventory space")) return null;
    const slots = freeSlots(player);
    if (value.includes("three open inventory spaces")) return slots < 3;
    if (value.includes("space for all three")) return slots >= 3;
    if (value.includes("does not have an open inventory space")) return slots < 1;
    if (value.includes("does have inventory space")) return slots >= 1;
    return null;
  }

  /** 35 Agility is checked here; Alfred Grimhand's Barcrawl has no server quest to read. */
  function meetsStartRequirements(player) {
    return player.getSkillManager().getMaxLevel(Skill.AGILITY) >= 35;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!LARRISSA_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    if (!meetsStartRequirements(player)) {
      player.sendMessage("You need an Agility level of at least 35 to start this quest.");
      return;
    }
    quest.setStage(player, STAGE_STARTED);
  }

  function spawnAtPlayer(player, npcId) {
    // A stale spawn (logged out mid-fight, interrupted conversation) must not
    // leave two dagannoths in the room; replace everything tracked for them.
    clearBoss(player);
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
    if (npc) {
      bossesByPlayer.set(player, npc);
      if (npcId === DAGANNOTH_MOTHER_ID) {
        const state = { npc, ticks: 0, phase: 0, task: null };
        motherPhasesByPlayer.set(player, state);
        npc?.setNpcTransformationId?.(MOTHER_PHASES[state.phase].npcId);
        startMotherPhaseTask(player, state);
      }
    }
  }

  function clearBoss(player) {
    // Tracked spawn plus any of ours the map lost (a relog mid-fight leaves the
    // NPC behind): never let two dagannoths share the room. The boss is spawned
    // beside the player and the fight never leaves the room, so the region-indexed
    // near lookup is enough; the old full-world scan ran for every player's death.
    const tracked = bossesByPlayer.get(player);
    if (tracked) api.removeNpc(tracked);
    bossesByPlayer.delete(player);
    motherPhasesByPlayer.get(player)?.task?.stop?.();
    motherPhasesByPlayer.delete(player);
    // A dagannoth only exists once the lighthouse is fixed (both spawn actions
    // require it). The death and logout hooks run for every player, so skip the
    // lookup for the players it can never concern.
    if (quest.getStage(player) < STAGE_REPAIRED_LIGHTHOUSE) return;
    for (const npc of api.core.World.getNpcsNear(player.getLocation(), 32, null)) {
      const npcId = npc?.getId?.();
      if ((npcId === DAGANNOTH_JR_ID || npcId === DAGANNOTH_MOTHER_ID) && npc.getOwner?.() === player) {
        api.removeNpc(npc);
      }
    }
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
    if (npcId === JOSSIK_DUNGEON_ID && stepId === SPAWN_DAGANNOTH_ACTION_ID) {
      if (quest.getStage(player) < STAGE_REPAIRED_LIGHTHOUSE) return;
      if (quest.getStage(player) >= STAGE_DEFEATED_DAGANNOTH) return;
      spawnAtPlayer(player, DAGANNOTH_JR_ID);
      return;
    }
    if (npcId === JOSSIK_DUNGEON_ID && stepId === SPAWN_MOTHER_ACTION_ID) {
      if (quest.getStage(player) < STAGE_DEFEATED_DAGANNOTH || quest.isComplete(player)) return;
      spawnAtPlayer(player, DAGANNOTH_MOTHER_ID);
      return;
    }
    if (stepId === COMPLETE_ACTION_ID) {
      if (!quest.isComplete(player)) quest.complete(player);
      return;
    }
    const godBook = GOD_BOOK_ACTIONS.get(stepId);
    if (godBook !== undefined) {
      event.handled = true;
      if (hasFlag(player, FLAG_BOOK_CLAIMED)) return;
      // The casket is handed over; if it was lost the dialogue says Jossik
      // already picked it up, so nothing is consumed.
      if (hasItem(player, RUSTY_CASKET)) player.getInventory().deleteNumber(RUSTY_CASKET, 1);
      if (freeSlots(player) < 1) {
        player.sendMessage("You need an open inventory space to take the book.");
        return;
      }
      player.getInventory().adds(godBook, 1);
      setFlag(player, FLAG_BOOK_CLAIMED, true);
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
    const mother = motherPhaseFor(event.npc);
    if (mother) {
      const owner = event.npc.getOwner?.();
      if (player !== owner || motherPhasesByPlayer.get(owner) !== mother) return;
      mother.task?.stop?.();
      motherPhasesByPlayer.delete(owner);
      if (bossesByPlayer.get(owner) === event.npc) bossesByPlayer.delete(owner);
      if (quest.getStage(owner) >= STAGE_DEFEATED_DAGANNOTH && !quest.isComplete(owner)) {
        quest.complete(owner);
      }
      return;
    }
    if (bossesByPlayer.get(player) !== event.npc || event.npc?.getOwner?.() !== player) return;
    bossesByPlayer.delete(player);
    motherPhasesByPlayer.get(player)?.task?.stop?.();
    if (motherPhasesByPlayer.get(player)?.npc === event.npc) motherPhasesByPlayer.delete(player);
    if (event.npcId === DAGANNOTH_JR_ID && quest.getStage(player) === STAGE_REPAIRED_LIGHTHOUSE) {
      quest.setStage(player, STAGE_DEFEATED_DAGANNOTH);
    }
  }

  function motherPhaseFor(npc) {
    const owner = npc?.getOwner?.();
    const state = motherPhasesByPlayer.get(owner);
    return state?.npc === npc ? state : null;
  }

  function handleMotherHit({ npc, hit }) {
    const state = motherPhaseFor(npc);
    const attacker = hit?.getAttacker?.();
    if (!state || !attacker || attacker !== npc.getOwner?.()) return;

    const phase = MOTHER_PHASES[state.phase];
    const combatType = hit.getCombatType?.();
    let weakness = null;
    if (combatType === api.core.CombatType.MELEE) weakness = "melee";
    else if (combatType === api.core.CombatType.RANGED) weakness = "ranged";
    else if (combatType === api.core.CombatType.MAGIC) {
      const spellId = hit.getSpell?.()?.spellId?.();
      weakness = ELEMENTAL_SPELLS.get(spellId) ?? null;
    }
    if (weakness !== phase.weakness) hit.setTotalDamage(0);
  }

  function startMotherPhaseTask(player, state) {
    class MotherPhaseTask extends api.core.Task {
      constructor() {
        super(1, state, false);
      }
      execute() {
        if (motherPhasesByPlayer.get(player) !== state || quest.getStage(player) >= STAGE_COMPLETE
          || state.npc.getOwner?.() !== player || !state.npc.isRegistered?.()) {
          this.stop();
          return;
        }
        state.ticks++;
        if (state.ticks < MOTHER_PHASE_TICKS) return;
        state.ticks = 0;
        state.phase = (state.phase + 1) % MOTHER_PHASES.length;
        state.npc.setNpcTransformationId?.(MOTHER_PHASES[state.phase].npcId);
        player.sendMessage(`The Dagannoth changes to ${MOTHER_PHASES[state.phase].colour}...`);
      }
    }
    state.task = new MotherPhaseTask();
    api.core.TaskManager.submit(state.task);
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

  // Ladder IDs are reused throughout the world; the shared climb event reaches
  // ladderMove, which scopes this quest's destinations by object and location.
  function handleObjectInteraction(event) {
    if (event.objectId === LIGHTHOUSE_DOOR_ID) return handleLighthouseDoor(event);
    if (event.objectId === BOOKCASE_ID) return handleBookcase(event);
    if (STRANGE_WALL_FAR_IDS.has(event.objectId)) return handleFarStrangeDoor(event);
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
    if (!hasItem(player, STEEL_NAILS, BRIDGE_NAILS)) {
      player.sendMessage(`You need ${BRIDGE_NAILS} steel nails to attach the plank with.`);
      return;
    }
    if (!hasItem(player, HAMMER)) {
      player.sendMessage("You need a hammer to hammer the nails in with.");
      return;
    }
    player.getInventory().deleteNumber(PLANK, 1);
    player.getInventory().deleteNumber(STEEL_NAILS, BRIDGE_NAILS);
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

  function handlePlayerDeath({ player }) {
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
    varbitId: VARBIT_HORROR_FROM_THE_DEEP,
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
  api.onNpcInteraction("Gunnjorn", { "Talk-to": talkToGunnjorn });
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("ladders:climb", handleLadderClaim);
  api.onNpcDeath(handleNpcDeath);
  api.onNpcHitModify(handleMotherHit);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onPlayerLogout(handleLogout);
  api.onPlayerDeath(handlePlayerDeath);
  api.onPlayerLogin(handleLogin);
};
