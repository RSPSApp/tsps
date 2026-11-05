/**
 * Icthlarin's Little Helper (members).
 *
 * The words come from the "Icthlarin's Little Helper" transcript page; this plugin
 * supplies the variant selector for the Wanderer, Sphinx, Klenter, High Priest,
 * priests, Siamun, Embalmer, Carpenter and Raetul, the prose-condition answers, the
 * start hook and the item/object actions, plus the pyramid pit, doors, canopic jars,
 * suntrap and the Devourer's possessed priest.
 *
 * Stage lives in varbit 418 (`ics_little_var`, base varp 445 `main_ics_var`).
 * Evidence: `yarn dump:cs2 4024` maps quest DB row 75 ("Icthlarin's Little Helper",
 * DB table 0) to `get_varbit 418`; cache gamevals name varbit 418 `ics_little_var`
 * on base varp 445 `main_ics_var`. The NPC/loc multi transforms keyed on varbit 418
 * pin the values to the OSRS stage map: Wanderer 6187 -> 4194 for 0-2, High Priest
 * 6192 -> 4206 for 0-15 and 25-26, Raetul 4204 -> 11598/11599, rock 6621 ->
 * 6622/6623.
 *
 * Stages (varbit 418): 0 not started, 1 supplies promised, 2 woke in Sophanem
 * (touch the pyramid door), 3 first flashback, 4 first memory recovered, 5 Sphinx
 * riddle, 6 Sphinx's token, 7 returning the jar, 8 jar room, 9 apparition guardian,
 * 10 guardian defeated, 11 jar taken, 12 second memory left, 13 jar returned,
 * 14 High Priest told, 15 ceremony preparations, 16 ceremony started, 17 unholy
 * symbol, 18 third flashback over, 19 eastern chamber, 20 possessed priest,
 * 23 ceremony saved, 24 Icthlarin's flashback, 25 finishing up, 26 complete.
 *
 * Rewards (OSRS Wiki): 2 Quest points, 4,500 Thieving, 4,000 Agility and 4,000
 * Woodcutting experience, the amulet of catspeak and access to Sophanem.
 *
 * Gaps/approximations (no instance or puzzle-interface support in this repo):
 * - the pyramid is not instanced; the flashbacks teleport to the real Klenter's
 *   Pyramid map (y 9170-9204) and the tile puzzle is replaced by opening the
 *   western door (44059); the traps, mummies and scarabs are not simulated;
 * - the apparition fight spawns the jar's guardian owner-only and ends on the
 *   NPC death event; the guardian potion drop is not reproduced;
 * - tree sap is gathered by using a knife on any "Evergreen tree" with a bucket
 *   (the wiki's route), so the supply is recoverable if it is lost;
 * - a wrong riddle answer removes cat items and the owned cat follower;
 * - the post-quest cat cutscene and the sarcophagus "Search" loot are left to
 *   their default handlers.
 *
 * Source: https://oldschool.runescape.wiki/w/Icthlarin%27s_Little_Helper
 */
module.exports = function registerIcthlarinsLittleHelperQuest(api) {
  const {
    CountdownTask,
    Equipment,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
    TaskManager,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Icthlarin's Little Helper";
  const START_HOOK = "quest:icthlarin-s-little-helper:start";

  // ==========================================================================
  // Stage / varbits
  // ==========================================================================

  const VARBIT_ICS_LITTLE_VAR = 418; // ics_little_var, base varp 445 main_ics_var
  const VARP_ICS_MAIN = 445;
  const VARBIT_KLENTER_VISIBLE = 449; // ics_specvis (varp 446 bit 4)

  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 1;
  const STAGE_SOPHANEM = 2;
  const STAGE_FLASHBACK_1 = 3;
  const STAGE_FIRST_MEMORY = 4;
  const STAGE_TALK_SPHINX = 5;
  const STAGE_TALK_HIGH_PRIEST = 6;
  const STAGE_FLASHBACK_2 = 7;
  const STAGE_JAR_ROOM = 8;
  const STAGE_APPARITION = 9;
  const STAGE_GUARDIAN_DEAD = 10;
  const STAGE_JAR_HELD = 11;
  const STAGE_FLASHBACK_2_END = 12;
  const STAGE_RETURN_JAR = 13;
  const STAGE_JAR_RETURNED = 14;
  const STAGE_PREPARE = 15;
  const STAGE_RITUAL = 16;
  const STAGE_FLASHBACK_3 = 17;
  const STAGE_FLASHBACK_3_END = 18;
  const STAGE_EAST_ROOM = 19;
  const STAGE_FIGHT = 20;
  const STAGE_SAVED = 23;
  const STAGE_FLASHBACK_4 = 24;
  const STAGE_FINISH = 25;
  const STAGE_COMPLETE = 26;

  // ==========================================================================
  // NPCs
  // ==========================================================================

  const WANDERER_NPC_IDS = new Set([
    NpcIdentifiers.WANDERER, // 4193
    NpcIdentifiers.WANDERER_2, // 4194, the quest Wanderer
    NpcIdentifiers.WANDERER_3, // 11590, ceremony
  ]);
  const SPHINX_NPC_IDS = new Set([NpcIdentifiers.SPHINX, NpcIdentifiers.SPHINX_2]); // 2637, 4209
  const KLENTER_NPC_IDS = new Set([NpcIdentifiers.KLENTER]); // 948
  const TOWN_HIGH_PRIEST_NPC_IDS = new Set([
    NpcIdentifiers.HIGH_PRIEST_2, // 4206
    NpcIdentifiers.HIGH_PRIEST_4, // 11502
  ]);
  const CEREMONY_HIGH_PRIEST_NPC_IDS = new Set([
    NpcIdentifiers.HIGH_PRIEST_5, // 11602, no-op until stage 23
    NpcIdentifiers.HIGH_PRIEST_6, // 11603, after saving the ceremony
    NpcIdentifiers.HIGH_PRIEST_7, // 11604
    NpcIdentifiers.HIGH_PRIEST_8, // 11605
  ]);
  const PRIEST_NPC_IDS = new Set([
    NpcIdentifiers.PRIEST_3, // 4207, temple
    NpcIdentifiers.PRIEST_4, // 4208, gate doorman
    NpcIdentifiers.PRIEST_17, // 11503
    NpcIdentifiers.PRIEST_18, // 11606
    NpcIdentifiers.PRIEST_19, // 11607
    NpcIdentifiers.PRIEST_20, // 11609
    NpcIdentifiers.PRIEST_21, // 11610
  ]);
  const GATE_PRIEST_NPC_ID = NpcIdentifiers.PRIEST_4; // 4208
  const EMBALMER_NPC_IDS = new Set([NpcIdentifiers.EMBALMER, NpcIdentifiers.EMBALMER_2]); // 4202, 11596
  const CARPENTER_NPC_IDS = new Set([NpcIdentifiers.CARPENTER, NpcIdentifiers.CARPENTER_2]); // 4203, 11597
  const RAETUL_NPC_IDS = new Set([
    NpcIdentifiers.RAETUL, // 11598
    NpcIdentifiers.RAETUL_2, // 11599
    NpcIdentifiers.RAETUL_3, // 11600
  ]);
  // Jex is not indexed against this transcript page (his id belongs to Contact!),
  // so his quest lines need an explicit interaction instead of a variant selector.
  const JEX_NPC_IDS = new Set([
    NpcIdentifiers.JEX, // 3875
    NpcIdentifiers.JEX_2, // 11562
    NpcIdentifiers.JEX_3, // 11563
  ]);
  const SIAMUN_NPC_IDS = new Set([NpcIdentifiers.SIAMUN, NpcIdentifiers.SIAMUN_2]); // 4205, 11601
  const APPARITION_NPC_IDS = new Set([
    NpcIdentifiers.APPARITION, // 4195, Het
    NpcIdentifiers.APPARITION_2, // 4196, Apmeken
    NpcIdentifiers.APPARITION_3, // 4197, Scabaras
    NpcIdentifiers.APPARITION_4, // 4198, Crondis
  ]);
  const POSSESSED_PRIEST_NPC_IDS = new Set([
    NpcIdentifiers.POSSESSED_PRIEST, // 4210
    NpcIdentifiers.POSSESSED_PRIEST_2, // 11608
  ]);
  const OWNED_NPC_IDS = new Set([
    ...WANDERER_NPC_IDS,
    ...SPHINX_NPC_IDS,
    ...KLENTER_NPC_IDS,
    ...TOWN_HIGH_PRIEST_NPC_IDS,
    ...CEREMONY_HIGH_PRIEST_NPC_IDS,
    ...PRIEST_NPC_IDS,
    ...EMBALMER_NPC_IDS,
    ...CARPENTER_NPC_IDS,
    ...RAETUL_NPC_IDS,
    ...SIAMUN_NPC_IDS,
    ...JEX_NPC_IDS,
  ]);
  // Nameless multi id that transforms to the ceremony High Priest (11602/11603) on
  // varbit 418; spawned for the ceremony (no generated identifier exists).
  const CEREMONY_HIGH_PRIEST_MULTI_NPC_ID = 11649;
  /** Every owner-only hostile/quest NPC this plugin spawns (dedupe + cleanup). */
  const OWNED_QUEST_NPC_IDS = new Set([
    ...APPARITION_NPC_IDS,
    ...POSSESSED_PRIEST_NPC_IDS,
    CEREMONY_HIGH_PRIEST_MULTI_NPC_ID,
  ]);

  const CAT_NPC_IDS = new Set([
    NpcIdentifiers.CAT, // 1619
    NpcIdentifiers.CAT_2, // 1620
    NpcIdentifiers.CAT_3, // 1621
    NpcIdentifiers.CAT_4, // 1622
    NpcIdentifiers.CAT_5, // 1623
    NpcIdentifiers.CAT_6, // 1624
    NpcIdentifiers.HELLCAT, // 1625
    5591, 5592, 5593, 5594, 5595, 5596, // kittens
    5597, // hell-kitten
    5598, 5599, 5600, 5601, 5602, 5603, // overgrown cats
    5604, // overgrown hellcat
  ]);
  const CAT_ITEM_IDS = [
    1555, 1556, 1557, 1558, 1559, 1560, // kittens
    1561, 1562, 1563, 1564, 1565, 1566, // cats
    1567, 1568, 1569, 1570, 1571, 1572, // overgrown cats
    7581, 7582, 7583, // hellcats
  ];

  // ==========================================================================
  // Items
  // ==========================================================================

  const TINDERBOX_ITEM_ID = ItemIdentifiers.TINDERBOX;
  const KNIFE_ITEM_ID = ItemIdentifiers.KNIFE; // 946
  const WATERSKIN_FULL_ITEM_IDS = [
    ItemIdentifiers.WATERSKIN_4_, // 1823
    ItemIdentifiers.WATERSKIN_4__2, // 1824
  ];
  const WILLOW_LOGS_ITEM_ID = ItemIdentifiers.WILLOW_LOGS;
  const BUCKET_ITEM_ID = ItemIdentifiers.BUCKET;
  const BAG_OF_SALT_ITEM_ID = ItemIdentifiers.BAG_OF_SALT;
  const BUCKET_OF_SAP_ITEM_ID = ItemIdentifiers.BUCKET_OF_SAP; // 4687
  const PILE_OF_SALT_ITEM_ID = ItemIdentifiers.PILE_OF_SALT; // 4689
  const BUCKET_OF_SALTWATER_ITEM_ID = ItemIdentifiers.BUCKET_OF_SALTWATER; // 4693
  const LINEN_ITEM_ID = ItemIdentifiers.LINEN; // 4684
  /** Quest-only leftovers removed once the ceremony is saved. */
  const CEREMONY_ITEM_IDS = [
    BUCKET_OF_SAP_ITEM_ID,
    PILE_OF_SALT_ITEM_ID,
    BUCKET_OF_SALTWATER_ITEM_ID,
    LINEN_ITEM_ID,
  ];
  const HOLY_SYMBOL_ITEM_ID = 4682; // ics_little_holy_symbol
  const UNHOLY_SYMBOL_ITEM_ID = 4683; // ics_little_unholy_symbol
  const SPHINX_TOKEN_ITEM_ID = 4691; // ics_little_sphinxstatue
  const CATSPEAK_AMULET_ITEM_ID = ItemIdentifiers.CATSPEAK_AMULET; // 4677
  const COINS_ITEM_ID = ItemIdentifiers.COINS;
  const GHOSTSPEAK_AMULET_ITEM_IDS = new Set([
    ItemIdentifiers.GHOSTSPEAK_AMULET, // 552
    ItemIdentifiers.GHOSTSPEAK_AMULET_2, // 4250
    ItemIdentifiers.GHOSTSPEAK_AMULET_3, // 16918
    ItemIdentifiers.GHOSTSPEAK_AMULET_4, // 17771
  ]);

  // Canopic jars; ids from gameval (liver 4678/6634/varbit 404, intestines
  // 4679/6640/407, stomach 4680/6638/406, lungs 4681/6636/405).
  const JARS = [
    { key: "liver", itemId: 4678, objectId: 6634, varbit: 404, apparitionId: NpcIdentifiers.APPARITION },
    { key: "intestines", itemId: 4679, objectId: 6640, varbit: 407, apparitionId: NpcIdentifiers.APPARITION_2 },
    { key: "stomach", itemId: 4680, objectId: 6638, varbit: 406, apparitionId: NpcIdentifiers.APPARITION_3 },
    { key: "lungs", itemId: 4681, objectId: 6636, varbit: 405, apparitionId: NpcIdentifiers.APPARITION_4 },
  ];
  const JAR_BY_OBJECT = new Map(JARS.map((jar) => [jar.objectId, jar]));
  // ==========================================================================
  // Objects (ids from gameval; nameless multis have no generated identifier)
  // ==========================================================================

  const DOOR_PYRAMID_ID = ObjectIdentifiers.DOOR_171; // 6614, Klenter's Pyramid door
  const HOLE_ID = ObjectIdentifiers.HOLE_7; // 6620, eastern wall hole (Climb-through)
  const PIT_SOUTH_ID = ObjectIdentifiers.PIT; // 6632, y 9194
  const PIT_NORTH_ID = ObjectIdentifiers.PIT_2; // 6633, y 9196
  const LADDER_ID = ObjectIdentifiers.LADDER_79; // 6645
  const WATER_EDGE_ID = ObjectIdentifiers.WATER_2; // 6605
  const SUNTRAP_ID = ObjectIdentifiers.SUNTRAP; // 6606
  const WEST_DOOR_ID = ObjectIdentifiers.DOOR_665; // 44059
  const EAST_DOOR_ID = ObjectIdentifiers.DOOR_666; // 44060
  const ROCK_ENTRANCE_ID = 6621; // ics_little_entrance_multi, opens to 6623 at stage 2
  const SARCOPHAGUS_MULTI_ID = 44600; // ics_sarcophigi_door_2 multi
  // The embalmer's "cone-shaped" coniferous trees: any cache loc with this name.
  const SAP_TREE_OBJECT_NAME = "Evergreen tree";

  // ==========================================================================
  // Locations
  // ==========================================================================

  const SOPHANEM_WAKE = new Location(3294, 2781, 0);
  const INSIDE_CITY = new Location(3320, 2794, 0);
  const OUTSIDE_HOLE = new Location(3323, 2796, 0);
  const PYRAMID_SOUTH = new Location(3292, 9193, 0);
  const PYRAMID_NORTH = new Location(3292, 9197, 0);
  const WEST_ROOM = new Location(3284, 9195, 0);
  const EAST_ROOM = new Location(3306, 9196, 0);
  const APPARITION_SPAWN = new Location(3284, 9195, 0);
  const PRIEST_SPAWN = new Location(3304, 9193, 0);
  const CEREMONY_PRIEST_SPAWN = new Location(3308, 9197, 0);
  const CITY_ZONE = { minX: 3262, maxX: 3322, minY: 2751, maxY: 2809 };

  // ==========================================================================
  // State
  // ==========================================================================

  const BITS_ATTRIBUTE = "quest.ictlharins_little_helper.bits";
  const JAR_ATTRIBUTE = "quest.ictlharins_little_helper.jar";

  const BIT_ENTERED_PYRAMID = 1 << 0;
  const BIT_SPHINX_MET = 1 << 1;
  const BIT_RIDDLE_SEEN = 1 << 2;
  const BIT_RIDDLE_ANSWERED = 1 << 3;
  const BIT_WRONG_PENDING = 1 << 4;
  const BIT_CAT_LOST = 1 << 5;
  const BIT_EMBALMER_INIT = 1 << 6;
  const BIT_EMBALMER_MET = 1 << 7;
  const BIT_NEEDS_SAP = 1 << 8;
  const BIT_NEEDS_SALT = 1 << 9;
  const BIT_NEEDS_LINEN = 1 << 10;
  const BIT_EMBALMER_GAVE = 1 << 11;
  const BIT_CARPENTER_MET = 1 << 12;
  const BIT_CARPENTER_LOGS = 1 << 13;
  const BIT_SYMBOL_GIVEN = 1 << 14;

  const trackedNpcs = new WeakMap();

  let quest;

  // ==========================================================================
  // Helpers
  // ==========================================================================

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;

  function hasAny(player, itemIds) {
    return itemIds.some((itemId) => held(player, itemId));
  }

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | bit);
  }

  function clearBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, bits(player) & ~bit);
  }

  function chosenJar(player) {
    const key = player.getAttribute(JAR_ATTRIBUTE);
    return JARS.find((jar) => jar.key === key) ?? JARS[0];
  }

  function rememberJar(player) {
    if (!player.getAttribute(JAR_ATTRIBUTE)) {
      const skills = player.getSkillManager();
      const levels = [
        skills.getCurrentLevel(Skill.ATTACK),
        skills.getCurrentLevel(Skill.STRENGTH),
        skills.getCurrentLevel(Skill.RANGED),
        skills.getCurrentLevel(Skill.MAGIC),
      ];
      const highest = Math.max(...levels);
      const index = levels.indexOf(highest); // tie: Het (liver)
      player.setAttribute(JAR_ATTRIBUTE, JARS[index]?.key ?? JARS[0].key);
    }
  }

  function hasSupplies(player) {
    return hasAny(player, WATERSKIN_FULL_ITEM_IDS) && held(player, TINDERBOX_ITEM_ID);
  }

  function wearingGhostspeak(player) {
    const amulet = player.getEquipment().get(Equipment.AMULET_SLOT);
    return GHOSTSPEAK_AMULET_ITEM_IDS.has(amulet?.getId?.());
  }

  function insideCity(player) {
    const location = player.getLocation();
    return (
      location.getX() >= CITY_ZONE.minX &&
      location.getX() <= CITY_ZONE.maxX &&
      location.getY() >= CITY_ZONE.minY &&
      location.getY() <= CITY_ZONE.maxY
    );
  }

  function hasCatFollower(player) {
    const world = api.getWorld();
    if (!world?.getNpcs) return false;
    for (const npc of world.getNpcs()) {
      if (npc && npc.getOwner?.() === player && CAT_NPC_IDS.has(npc.getId())) return true;
    }
    return false;
  }

  function hasCat(player) {
    return hasCatFollower(player) || hasAny(player, CAT_ITEM_IDS);
  }

  function hasAnyJar(player) {
    return JARS.some((jar) => held(player, jar.itemId));
  }

  function removeInventoryItem(player, itemId) {
    const amount = player.getInventory().getAmount(itemId);
    if (amount > 0) player.getInventory().deleteNumber(itemId, amount);
  }

  /** Quest-only items do not survive the quest; the jar and unused supplies are destroyed. */
  function clearQuestItems(player) {
    for (const jar of JARS) removeInventoryItem(player, jar.itemId);
    for (const itemId of [
      SPHINX_TOKEN_ITEM_ID,
      HOLY_SYMBOL_ITEM_ID,
      UNHOLY_SYMBOL_ITEM_ID,
      ...CEREMONY_ITEM_IDS,
    ]) {
      removeInventoryItem(player, itemId);
    }
    player.setAttribute(JAR_ATTRIBUTE, "");
  }

  function loseCat(player) {
    setBit(player, BIT_CAT_LOST);
    clearBit(player, BIT_RIDDLE_ANSWERED);
    clearBit(player, BIT_WRONG_PENDING);
    for (const itemId of CAT_ITEM_IDS) {
      const amount = player.getInventory().getAmount(itemId);
      if (amount > 0) player.getInventory().deleteNumber(itemId, amount);
    }
    const world = api.getWorld();
    if (!world?.getNpcs) return;
    for (const npc of world.getNpcs()) {
      if (npc && npc.getOwner?.() === player && CAT_NPC_IDS.has(npc.getId())) api.removeNpc(npc);
    }
  }

  function teleport(player, location) {
    player.moveTo(new Location(location.x, location.y, location.z));
  }

  function syncVarbits(player) {
    const stage = quest.getStage(player);
    const sender = player.getPacketSender();
    // Klenter's shade is visible while the burial jar is stolen.
    sender.sendVarbit(VARBIT_KLENTER_VISIBLE, stage >= STAGE_SOPHANEM && stage < STAGE_JAR_RETURNED ? 1 : 0);
    const chosen = chosenJar(player);
    for (const jar of JARS) {
      const visible =
        quest.isComplete(player) ||
        stage >= STAGE_JAR_RETURNED ||
        (stage >= STAGE_FLASHBACK_2 &&
          !(stage >= STAGE_JAR_HELD &&
            stage < STAGE_RETURN_JAR &&
            jar.key === chosen.key));
      // The jar multi transforms are [jar, -1]: 0 shows the jar, 1 hides it.
      sender.sendVarbit(jar.varbit, visible ? 0 : 1);
    }
  }

  function setStage(player, value) {
    quest.setStage(player, value);
    syncVarbits(player);
  }

  function initEmbalmerNeeds(player) {
    if (hasBit(player, BIT_EMBALMER_INIT)) return;
    setBit(player, BIT_EMBALMER_INIT);
    setBit(player, BIT_NEEDS_SAP | BIT_NEEDS_SALT | BIT_NEEDS_LINEN);
  }

  function needsEmbalmerItems(player) {
    return hasBit(player, BIT_NEEDS_SAP | BIT_NEEDS_SALT | BIT_NEEDS_LINEN);
  }

  function grantJar(player) {
    const jar = chosenJar(player);
    if (!held(player, jar.itemId)) player.getInventory().adds(jar.itemId, 1);
  }

  function trackNpc(player, key, spawn) {
    let tracked = trackedNpcs.get(player);
    if (!tracked) {
      tracked = {};
      trackedNpcs.set(player, tracked);
    }
    const existing = tracked[key];
    if (existing?.isRegistered?.()) {
      removeOwnedNpcs(player, new Set([spawn.id]), existing);
      return existing;
    }
    delete tracked[key];
    // Owner-only spawns no longer respawn; clear any duplicate of this spawn id
    // (a stale copy from an earlier stage/relog) before making the new one.
    removeOwnedNpcs(player, new Set([spawn.id]));
    const npc = api.spawnNpc({
      id: spawn.id,
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) tracked[key] = npc;
    return npc;
  }

  function clearAllTracked(player) {
    const tracked = trackedNpcs.get(player);
    if (tracked) {
      for (const key of Object.keys(tracked)) {
        if (tracked[key]) api.removeNpc(tracked[key]);
        delete tracked[key];
      }
    }
    removeOwnedNpcs(player, OWNED_QUEST_NPC_IDS);
  }

  function playCutscene(player, npcId, variant, select) {
    startTranscript(api, player, npcId, PAGE, variant, select);
  }

  /** Removes this player's owner-only quest NPCs of the given spawn ids (never `keep`). */
  function removeOwnedNpcs(player, npcIds, keep) {
    const world = api.getWorld();
    if (!world?.getNpcs) return;
    for (const npc of world.getNpcs()) {
      if (!npc || npc === keep) continue;
      if (npc.getOwner?.() === player && npcIds.has(npc.getId())) api.removeNpc(npc);
    }
  }

  function normText(value) {
    return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function cloneStep(step) {
    return JSON.parse(JSON.stringify(step));
  }

  /**
   * The wiki dump splits the riddle into a single-option "7." menu followed by the
   * "9./12./14./I don't know." menu, so the correct answer only appears after the cat
   * has already been lost. Rebuild the "Okay, that sounds fair." option with one menu
   * offering every answer, reusing the transcript's own outcome steps.
   */
  function mergeSphinxRiddleOption(fair) {
    const inner = Array.isArray(fair.steps) ? fair.steps : [];
    const riddleIndex = inner.findIndex(
      (step) => step.type === "line" && /husband and wife/i.test(step.text ?? "")
    );
    const wrongFlow = inner.find((step) => step.type === "line" && /are you sure/i.test(step.text ?? ""));
    const menus = inner.filter((step) => step.type === "choice");
    const answers = menus.length ? menus[menus.length - 1] : undefined;
    if (riddleIndex === -1 || !wrongFlow || !answers) return fair;
    const correct = (answers.options ?? []).find((option) => normText(option.text) === "9");
    const dontKnow = (answers.options ?? []).find((option) => normText(option.text) === "idontknow");
    const options = [{ text: "7.", steps: [{ player: "7." }, cloneStep(wrongFlow)] }];
    if (correct) options.push(cloneStep(correct));
    options.push({ text: "12.", steps: [{ player: "12." }, cloneStep(wrongFlow)] });
    options.push({ text: "14.", steps: [{ player: "14." }, cloneStep(wrongFlow)] });
    if (dontKnow) options.push(cloneStep(dontKnow));
    return { ...fair, steps: [...inner.slice(0, riddleIndex + 1), { type: "choice", options }] };
  }

  function mergeSphinxRiddle(steps) {
    if (!Array.isArray(steps)) return steps;
    return steps.map((step) => {
      if (step.type === "choice") {
        return {
          ...step,
          options: (step.options ?? []).map((option) =>
            normText(option.text) === "okaythatsoundsfair"
              ? mergeSphinxRiddleOption(option)
              : { ...option, steps: mergeSphinxRiddle(option.steps ?? []) }
          ),
        };
      }
      if (Array.isArray(step.steps)) return { ...step, steps: mergeSphinxRiddle(step.steps) };
      return step;
    });
  }

  /** Owns the riddle conversation; later stages fall through to the variant selector. */
  function sphinxTalkTo(event) {
    const { player } = event;
    if (!SPHINX_NPC_IDS.has(event.npcId)) return false;
    if (quest.getStage(player) !== STAGE_TALK_SPHINX) return false;
    if (hasBit(player, BIT_RIDDLE_ANSWERED) || hasBit(player, BIT_CAT_LOST)) return false;
    event.handled = true;
    startTranscript(
      api,
      player,
      event.npcId,
      PAGE,
      "figuring-out-what-on-gielinor-is-going-on-asking-the-sphinx-for-help",
      mergeSphinxRiddle
    );
    return true;
  }

  /**
   * The dump nests the has-token hand-in inside the lost-token condition, so the
   * transcript itself can never offer it. `eXmHe5` there is an empty condition and
   * the hand-in steps (`6qP-S3` and friends) are its following siblings after the
   * no-token `end`. Play the "Prove it!" lead-in plus that sibling tail; the
   * 6qP-S3 action consumes the token and advances to stage 7.
   */
  function selectHighPriestToken(steps) {
    const lead = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.type !== "condition") {
        lead.push(step);
        continue;
      }
      if (step.id === "eXmHe5") {
        // Empty condition at this level: the hand-in steps follow it.
        return [...lead, ...steps.slice(i + 1)];
      }
      if (step.id === "i6RE2X") {
        const inner = step.steps ?? [];
        const at = inner.findIndex((s) => s.type === "condition" && s.id === "eXmHe5");
        if (at !== -1) return [...lead, ...inner.slice(at + 1)];
      }
    }
    return steps;
  }

  function highPriestTalkTo(event) {
    const { player } = event;
    if (!TOWN_HIGH_PRIEST_NPC_IDS.has(event.npcId)) return false;
    if (quest.getStage(player) !== STAGE_TALK_HIGH_PRIEST) return false;
    if (!held(player, SPHINX_TOKEN_ITEM_ID)) return false;
    event.handled = true;
    startTranscript(
      api,
      player,
      event.npcId,
      PAGE,
      "figuring-out-what-on-gielinor-is-going-on-talking-to-the-high-priest-after-receiving-the-sphinx-s-token",
      selectHighPriestToken
    );
    return true;
  }

  /**
   * Jex is indexed to Contact!'s "Jex" page, not this one, so the variant selector
   * never sees him. Play the Icthlarin lines directly while this quest owns him and
   * fall through to Contact!/standard dialogue otherwise.
   */
  function jexTalkTo(event) {
    const { player } = event;
    if (!JEX_NPC_IDS.has(event.npcId)) return false;
    const variant = selectJexVariant(player, quest.getStage(player));
    if (!variant) return false;
    event.handled = true;
    startTranscript(api, player, event.npcId, PAGE, variant);
    return true;
  }

  /**
   * The Doors plugin pairs 44059/44060 with consecutive same-model locs and claims
   * them before the global object hook. Claim them here instead, only when this quest
   * owns the stage, so the generic door still opens otherwise.
   */
  function handleDoorToggle(request) {
    if (request.handled) return;
    const stage = quest.getStage(request.player);
    if (request.objectId === WEST_DOOR_ID) {
      handleWestDoor(request, request.player, stage);
      return;
    }
    if (request.objectId === EAST_DOOR_ID) {
      handleEastDoor(request, request.player, stage);
    }
  }

  // ==========================================================================
  // Variant selection
  // ==========================================================================

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (WANDERER_NPC_IDS.has(npcId)) {
      if (stage === STAGE_NOT_STARTED) return "starting-out-meeting-the-wanderer";
      if (stage === STAGE_STARTED) {
        return hasSupplies(player)
          ? "starting-out-when-the-player-has-all-the-supplies"
          : "starting-out-talking-to-the-wanderer-or-using-a-full-waterskin-or-tinderbox-on-her";
      }
      return null;
    }
    if (SPHINX_NPC_IDS.has(npcId)) return selectSphinxVariant(player, stage);
    if (KLENTER_NPC_IDS.has(npcId)) {
      return stage >= STAGE_SOPHANEM && stage < STAGE_JAR_RETURNED
        ? "city-of-the-dead-talking-to-klenter"
        : null;
    }
    if (TOWN_HIGH_PRIEST_NPC_IDS.has(npcId)) return selectTownHighPriestVariant(player, stage);
    if (CEREMONY_HIGH_PRIEST_NPC_IDS.has(npcId)) {
      if (stage !== STAGE_SAVED) return null;
      setStage(player, STAGE_FLASHBACK_4);
      return "the-devourer-revealed-talking-to-the-high-priest-after-saving-the-ceremony";
    }
    if (PRIEST_NPC_IDS.has(npcId)) return selectPriestVariant(npcId, player, stage);
    if (EMBALMER_NPC_IDS.has(npcId)) return selectEmbalmerVariant(player, stage);
    if (CARPENTER_NPC_IDS.has(npcId)) return selectCarpenterVariant(player, stage);
    if (RAETUL_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_SOPHANEM && stage < STAGE_JAR_RETURNED) {
        return "city-of-the-dead-talking-to-raetul";
      }
      if (stage === STAGE_PREPARE && hasBit(player, BIT_EMBALMER_MET)) {
        return "ceremony-preparations-aiding-the-embalmer-buying-linen-from-raetul";
      }
      return null;
    }
    if (SIAMUN_NPC_IDS.has(npcId)) {
      return stage >= STAGE_SOPHANEM && stage < STAGE_JAR_RETURNED
        ? "city-of-the-dead-talking-to-siamun"
        : null;
    }
    return null;
  }

  function selectSphinxVariant(player, stage) {
    if (stage < STAGE_TALK_SPHINX) {
      if (hasBit(player, BIT_SPHINX_MET)) {
        return "city-of-the-dead-talking-to-the-sphinx-talking-to-the-sphinx-again";
      }
      setBit(player, BIT_SPHINX_MET);
      return "city-of-the-dead-talking-to-the-sphinx";
    }
    if (stage === STAGE_TALK_SPHINX) {
      if (hasBit(player, BIT_RIDDLE_ANSWERED) || hasBit(player, BIT_CAT_LOST)) {
        return "figuring-out-what-on-gielinor-is-going-on-being-accused-of-robbing-a-grave-after-answering-the-sphinx-s-riddle";
      }
      return "figuring-out-what-on-gielinor-is-going-on-asking-the-sphinx-for-help";
    }
    if (stage === STAGE_TALK_HIGH_PRIEST) {
      return "figuring-out-what-on-gielinor-is-going-on-talking-to-the-sphinx-after-receiving-the-sphinx-s-token";
    }
    if (stage < STAGE_JAR_RETURNED) {
      return "putting-things-right-talking-to-the-sphinx-after-being-told-to-return-the-jar";
    }
    return null;
  }

  function selectTownHighPriestVariant(player, stage) {
    if (stage <= STAGE_TALK_SPHINX) return "city-of-the-dead-talking-to-the-high-priest";
    if (stage === STAGE_TALK_HIGH_PRIEST) {
      return "figuring-out-what-on-gielinor-is-going-on-talking-to-the-high-priest-after-receiving-the-sphinx-s-token";
    }
    if (stage < STAGE_JAR_RETURNED) {
      return "putting-things-right-talking-to-the-high-priest-after-being-told-to-return-the-jar";
    }
    if (stage === STAGE_JAR_RETURNED) {
      initEmbalmerNeeds(player);
      setStage(player, STAGE_PREPARE);
      return "putting-things-right-informing-the-high-priest-of-the-jar-s-return";
    }
    if (stage === STAGE_PREPARE) {
      return "ceremony-preparations-talking-to-the-high-priest-after-being-asked-to-help-with-the-ceremony";
    }
    if (stage === STAGE_FINISH) {
      return "finishing-up-speaking-with-the-high-priest-at-the-temple";
    }
    return null;
  }

  function selectPriestVariant(npcId, player, stage) {
    if (stage >= STAGE_FINISH) {
      return "the-devourer-revealed-talking-to-a-priest-in-the-temple-after-saving-the-ceremony";
    }
    if (stage === STAGE_JAR_RETURNED) {
      return "putting-things-right-talking-to-a-priest-after-returning-the-jar";
    }
    if (stage === STAGE_PREPARE) {
      return "ceremony-preparations-talking-to-a-priest-by-a-gate";
    }
    if (stage === STAGE_TALK_HIGH_PRIEST) {
      return "figuring-out-what-on-gielinor-is-going-on-talking-to-a-priest-after-receiving-the-sphinx-s-token";
    }
    if (stage >= STAGE_SOPHANEM && stage < STAGE_JAR_RETURNED) {
      return npcId === GATE_PRIEST_NPC_ID
        ? "city-of-the-dead-talking-to-a-priest-talking-to-a-priest-by-a-gate"
        : "city-of-the-dead-talking-to-a-priest-talking-to-a-priest-in-the-temple";
    }
    return null;
  }

  function selectEmbalmerVariant(player, stage) {
    if (stage >= STAGE_SOPHANEM && stage < STAGE_JAR_RETURNED) {
      return "city-of-the-dead-talking-to-the-embalmer";
    }
    if (stage !== STAGE_PREPARE) return null;
    initEmbalmerNeeds(player);
    if (!hasBit(player, BIT_EMBALMER_MET)) {
      setBit(player, BIT_EMBALMER_MET);
      return "ceremony-preparations-aiding-the-embalmer";
    }
    if (hasBit(player, BIT_SYMBOL_GIVEN) && !needsEmbalmerItems(player)) {
      return "ceremony-preparations-talking-to-the-embalmer-after-aiding-both-him-and-the-carpenter";
    }
    if (!needsEmbalmerItems(player)) {
      return "ceremony-preparations-aiding-the-embalmer-talking-to-the-embalmer-after-handing-in-all-the-items-and-before-aiding-the-carpenter";
    }
    return "ceremony-preparations-aiding-the-embalmer-talking-to-the-embalmer-again";
  }

  function selectCarpenterVariant(player, stage) {
    if (stage >= STAGE_SOPHANEM && stage < STAGE_JAR_RETURNED) {
      return "city-of-the-dead-talking-to-the-carpenter";
    }
    if (stage !== STAGE_PREPARE) return null;
    if (hasBit(player, BIT_SYMBOL_GIVEN)) {
      return "ceremony-preparations-talking-to-the-carpenter-after-aiding-both-him-and-the-embalmer";
    }
    if (hasBit(player, BIT_CARPENTER_LOGS)) {
      return needsEmbalmerItems(player)
        ? "ceremony-preparations-aiding-the-carpenter-talking-to-the-carpenter-after-handing-in-the-logs-and-before-aiding-the-embalmer"
        : "ceremony-preparations-aiding-the-carpenter-talking-to-the-carpenter-after-handing-in-the-logs-and-after-aiding-the-embalmer";
    }
    if (!hasBit(player, BIT_CARPENTER_MET)) {
      setBit(player, BIT_CARPENTER_MET);
      return "ceremony-preparations-aiding-the-carpenter";
    }
    return "ceremony-preparations-aiding-the-carpenter-talking-to-the-carpenter-again";
  }

  function selectJexVariant(player, stage) {
    if (stage < STAGE_SOPHANEM || stage >= STAGE_JAR_RETURNED) return null;
    // Once the jar is stolen, the quest variant's "lesser gods" choice is a
    // cross-page reference to Transcript:Jex, which this page cannot resolve.
    // Let the indexed Jex transcript play instead; it has the same greeting and
    // the working explanation with its follow-up menu.
    if (stage >= STAGE_FLASHBACK_2) return null;
    return "city-of-the-dead-talking-to-jex";
  }

  // ==========================================================================
  // Conditions
  // ==========================================================================

  function answerCondition({ npcId, player, stepId }) {
    if (!OWNED_NPC_IDS.has(npcId)) return null;
    switch (stepId) {
      case "pnKe_x":
      case "ptRhnS":
        return hasSupplies(player);
      case "aP6wOy":
      case "3ZYnCf":
        return !hasSupplies(player);
      case "SB19GE":
        return hasCatFollower(player);
      case "lrOe_5":
        return !hasCatFollower(player);
      case "X5AziL":
      case "CHEt9f":
        return wearingGhostspeak(player);
      case "CBPOsk":
      case "HFDnfW":
        return !wearingGhostspeak(player);
      case "Pd5RL1":
        return insideCity(player);
      case "49Xo0U":
      case "D-HbGr":
      case "CFMl8w":
      case "4fMYHu":
      case "pr4swa":
      case "ibGGn2":
      case "jDxKab":
        return hasCat(player);
      case "DNzgqI":
      case "WbhXk3":
      case "yO0q7C":
      case "Ivtofg":
      case "RH5k1y":
      case "WlWWGQ":
        return !hasCat(player);
      case "UfkEmo":
        return hasBit(player, BIT_CAT_LOST);
      case "wJoAYB":
        return !hasBit(player, BIT_RIDDLE_SEEN);
      case "cOkgIB":
        return hasBit(player, BIT_RIDDLE_SEEN);
      case "i6RE2X":
        return !held(player, SPHINX_TOKEN_ITEM_ID);
      case "eXmHe5":
      case "Obm1lw":
        return held(player, SPHINX_TOKEN_ITEM_ID);
      case "Q7PciU":
      case "GpRiuU":
      case "uh4uT6":
        return !hasAnyJar(player);
      case "e97WE_":
        return hasAnyJar(player);
      case "FipZzG":
        return held(player, BUCKET_OF_SAP_ITEM_ID);
      case "vtJH1G":
        return held(player, PILE_OF_SALT_ITEM_ID) || held(player, BAG_OF_SALT_ITEM_ID);
      case "3itQb0":
        return held(player, LINEN_ITEM_ID);
      case "f4YnBg":
        return hasBit(player, BIT_EMBALMER_GAVE);
      case "1DWXC3":
        return !held(player, BUCKET_OF_SALTWATER_ITEM_ID);
      case "vWEPUP":
        return held(player, BUCKET_OF_SALTWATER_ITEM_ID);
      case "YcBgrw":
        return !held(player, COINS_ITEM_ID, 30);
      case "vATPuD":
        return held(player, COINS_ITEM_ID, 30);
      case "St2Jxp":
        return hasBit(player, BIT_NEEDS_SAP) && held(player, BUCKET_OF_SAP_ITEM_ID);
      case "qwUTPR":
        return (
          hasBit(player, BIT_NEEDS_SALT) &&
          (held(player, PILE_OF_SALT_ITEM_ID) || held(player, BAG_OF_SALT_ITEM_ID))
        );
      case "WV7N7z":
        return hasBit(player, BIT_NEEDS_LINEN) && held(player, LINEN_ITEM_ID);
      case "OX3qHy":
        return !needsEmbalmerItems(player);
      case "A5ETbK":
        return hasBit(player, BIT_EMBALMER_GAVE) && needsEmbalmerItems(player);
      case "8yiKsL":
        return !hasBit(player, BIT_EMBALMER_GAVE) && needsEmbalmerItems(player);
      case "3WZub2":
        return !held(player, WILLOW_LOGS_ITEM_ID);
      case "kR3DQi":
      case "Tl8pfv":
        return held(player, WILLOW_LOGS_ITEM_ID);
      case "Hha-Jz":
        return !held(player, WILLOW_LOGS_ITEM_ID);
      case "l89Bzp":
        return held(player, HOLY_SYMBOL_ITEM_ID);
      case "--itYY":
        return !held(player, HOLY_SYMBOL_ITEM_ID);
      // Menu-option guards on the "embalmer again" menu.
      case "hYZphZ":
        return hasBit(player, BIT_NEEDS_SAP);
      case "HDW4Ru":
        return hasBit(player, BIT_NEEDS_SALT);
      case "VaetBI":
        return hasBit(player, BIT_NEEDS_LINEN);
      default:
        return null;
    }
  }

  // ==========================================================================
  // Dialogue hooks / actions
  // ==========================================================================

  function gertrudesCatComplete(player) {
    const request = { player, key: "gertrudes_cat", complete: undefined };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== START_HOOK || !WANDERER_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) === STAGE_NOT_STARTED) {
      if (!gertrudesCatComplete(player)) {
        player.sendMessage("You must complete Gertrude's Cat to start this quest.");
        return;
      }
      player.setAttribute(BITS_ATTRIBUTE, 0);
      player.setAttribute(JAR_ATTRIBUTE, "");
      setStage(player, STAGE_STARTED);
    }
  }

  function handleCondition({ player, npcId, stepId }) {
    if (!OWNED_NPC_IDS.has(npcId)) return;
    if (stepId === "wJoAYB") setBit(player, BIT_RIDDLE_SEEN);
  }

  function handleChoice({ player, npcId, option }) {
    if (!SPHINX_NPC_IDS.has(npcId)) return;
    const value = String(option ?? "").trim().toLowerCase();
    if (value === "9.") {
      setBit(player, BIT_RIDDLE_ANSWERED);
      clearBit(player, BIT_WRONG_PENDING);
      return;
    }
    if (value === "7." || value === "12." || value === "14.") {
      setBit(player, BIT_WRONG_PENDING);
      return;
    }
    if (value === "totally positive.") {
      if (hasBit(player, BIT_WRONG_PENDING)) loseCat(player);
      return;
    }
    if (value.startsWith("i don't know")) {
      clearBit(player, BIT_RIDDLE_ANSWERED);
      clearBit(player, BIT_WRONG_PENDING);
    }
  }

  function upToApparitionDefeat(steps) {
    const out = [];
    for (const step of steps) {
      if (step.id === "GO06qT") break;
      out.push(step);
    }
    return out;
  }

  function onlyApparitionDefeat(steps) {
    return steps.filter((step) => step.id === "GO06qT");
  }

  function scheduleCityOfTheDead(player) {
    const play = () => playCutscene(player, NpcIdentifiers.KLENTER, "city-of-the-dead");
    if (!TaskManager || !CountdownTask) {
      play();
      return;
    }
    TaskManager.submit(new CountdownTask(player, 1, play));
  }

  function handleAction(event) {
    const { player, stepId } = event;
    switch (stepId) {
      // Starting out.
      case "bLiUSH":
        event.handled = true;
        if (held(player, TINDERBOX_ITEM_ID)) player.getInventory().deleteNumber(TINDERBOX_ITEM_ID, 1);
        return;
      case "V52ykg":
        event.handled = true;
        for (const itemId of WATERSKIN_FULL_ITEM_IDS) {
          if (held(player, itemId)) {
            player.getInventory().deleteNumber(itemId, 1);
            break;
          }
        }
        return;
      case "exQl3V":
        // The hypnotised player wakes up holding the stolen jar. Only the
        // starting conversation may hand it out.
        if (quest.getStage(player) !== STAGE_STARTED) return;
        rememberJar(player);
        grantJar(player);
        return;
      case "0pXftE":
        if (quest.getStage(player) !== STAGE_STARTED) return;
        event.handled = true;
        setStage(player, STAGE_SOPHANEM);
        teleport(player, SOPHANEM_WAKE);
        scheduleCityOfTheDead(player);
        return;

      // First flashback.
      case "ZzAs_W":
        if (quest.getStage(player) !== STAGE_FLASHBACK_1) return;
        event.handled = true;
        setStage(player, STAGE_SOPHANEM);
        teleport(player, SOPHANEM_WAKE);
        return;
      case "U696Aj":
        if (quest.getStage(player) !== STAGE_FIRST_MEMORY) return;
        event.handled = true;
        setStage(player, STAGE_TALK_SPHINX);
        teleport(player, SOPHANEM_WAKE);
        return;

      // Sphinx riddle.
      case "qojI7N":
        if (quest.getStage(player) !== STAGE_TALK_SPHINX) return;
        event.handled = true;
        loseCat(player);
        return;
      case "bnsTsz":
      case "rmgkdX":
        if (quest.getStage(player) !== STAGE_TALK_SPHINX) return;
        event.handled = true;
        loseCat(player);
        return;
      case "SqSxtA":
        if (quest.getStage(player) !== STAGE_TALK_SPHINX) return;
        if (!held(player, SPHINX_TOKEN_ITEM_ID)) player.getInventory().adds(SPHINX_TOKEN_ITEM_ID, 1);
        setStage(player, STAGE_TALK_HIGH_PRIEST);
        return;
      case "-btvsf":
        if (quest.getStage(player) !== STAGE_TALK_HIGH_PRIEST) return;
        if (!held(player, SPHINX_TOKEN_ITEM_ID)) player.getInventory().adds(SPHINX_TOKEN_ITEM_ID, 1);
        return;
      case "6qP-S3":
        if (quest.getStage(player) !== STAGE_TALK_HIGH_PRIEST) return;
        if (held(player, SPHINX_TOKEN_ITEM_ID)) player.getInventory().deleteNumber(SPHINX_TOKEN_ITEM_ID, 1);
        setStage(player, STAGE_FLASHBACK_2);
        return;
      case "rQcSO2":
        if (quest.getStage(player) >= STAGE_JAR_RETURNED) return;
        grantJar(player);
        return;

      // Returning the jar / pyramid entry.
      case "2cyI1G":
      case "4TL_gG":
        if (quest.getStage(player) >= STAGE_JAR_RETURNED) return;
        grantJar(player);
        return;
      case "zeRYgo":
      case "ZDfXBL":
        if (quest.getStage(player) !== STAGE_FLASHBACK_2 && quest.getStage(player) !== STAGE_JAR_HELD) return;
        event.handled = true;
        setBit(player, BIT_ENTERED_PYRAMID);
        teleport(player, PYRAMID_SOUTH);
        return;
      case "WIfuzl":
        if (quest.getStage(player) !== STAGE_RITUAL) return;
        event.handled = true;
        setBit(player, BIT_ENTERED_PYRAMID);
        teleport(player, PYRAMID_SOUTH);
        return;
      case "XVMTfp":
        event.handled = true;
        return;
      case "GO06qT":
        if (quest.getStage(player) !== STAGE_APPARITION) return;
        event.handled = true;
        setStage(player, STAGE_GUARDIAN_DEAD);
        player.sendMessage("(The player defeats the apparition.)");
        return;
      case "kIq4Pq":
        if (quest.getStage(player) !== STAGE_GUARDIAN_DEAD) return;
        rememberJar(player);
        grantJar(player);
        setStage(player, STAGE_JAR_HELD);
        return;
      case "w37dWs":
        if (quest.getStage(player) !== STAGE_JAR_HELD) return;
        event.handled = true;
        setStage(player, STAGE_FLASHBACK_2_END);
        teleport(player, PYRAMID_SOUTH);
        return;
      case "3yABi3":
        {
          if (quest.getStage(player) !== STAGE_RETURN_JAR && quest.getStage(player) !== STAGE_FLASHBACK_2_END) return;
          const jar = chosenJar(player);
          if (held(player, jar.itemId)) player.getInventory().deleteNumber(jar.itemId, 1);
          setStage(player, STAGE_JAR_RETURNED);
        }
        return;

      // Ceremony preparations. Every hand-in is owned by STAGE_PREPARE, so a
      // replayed or spoofed dialogue cannot skip a preparation step.
      case "wicewv":
      case "0cuTDj":
        if (quest.getStage(player) !== STAGE_PREPARE) return;
        if (held(player, BUCKET_OF_SAP_ITEM_ID)) player.getInventory().deleteNumber(BUCKET_OF_SAP_ITEM_ID, 1);
        clearBit(player, BIT_NEEDS_SAP);
        setBit(player, BIT_EMBALMER_MET | BIT_EMBALMER_GAVE);
        return;
      case "qpmBy3":
      case "vOXcKj":
        if (quest.getStage(player) !== STAGE_PREPARE) return;
        if (held(player, PILE_OF_SALT_ITEM_ID)) player.getInventory().deleteNumber(PILE_OF_SALT_ITEM_ID, 1);
        if (held(player, BAG_OF_SALT_ITEM_ID)) player.getInventory().deleteNumber(BAG_OF_SALT_ITEM_ID, 1);
        clearBit(player, BIT_NEEDS_SALT);
        setBit(player, BIT_EMBALMER_MET | BIT_EMBALMER_GAVE);
        return;
      case "YmyQBe":
      case "M83RRg":
        if (quest.getStage(player) !== STAGE_PREPARE) return;
        if (held(player, LINEN_ITEM_ID)) player.getInventory().deleteNumber(LINEN_ITEM_ID, 1);
        clearBit(player, BIT_NEEDS_LINEN);
        setBit(player, BIT_EMBALMER_MET | BIT_EMBALMER_GAVE);
        return;
      case "v-TFI2":
        if (quest.getStage(player) !== STAGE_PREPARE || !hasBit(player, BIT_NEEDS_SALT)) return;
        if (held(player, BUCKET_OF_SALTWATER_ITEM_ID)) player.getInventory().deleteNumber(BUCKET_OF_SALTWATER_ITEM_ID, 1);
        if (!held(player, PILE_OF_SALT_ITEM_ID)) player.getInventory().adds(PILE_OF_SALT_ITEM_ID, 1);
        return;
      case "uBXp8K":
        if (quest.getStage(player) !== STAGE_PREPARE || !hasBit(player, BIT_NEEDS_LINEN)) return;
        if (held(player, COINS_ITEM_ID, 30)) {
          player.getInventory().deleteNumber(COINS_ITEM_ID, 30);
          if (!held(player, LINEN_ITEM_ID)) player.getInventory().adds(LINEN_ITEM_ID, 1);
        }
        return;
      case "-BYp-2":
      case "T25MCO":
        if (quest.getStage(player) !== STAGE_PREPARE || hasBit(player, BIT_SYMBOL_GIVEN)) return;
        if (held(player, WILLOW_LOGS_ITEM_ID)) player.getInventory().deleteNumber(WILLOW_LOGS_ITEM_ID, 1);
        setBit(player, BIT_CARPENTER_MET | BIT_CARPENTER_LOGS);
        return;
      case "dCaTsh":
      case "XO50xP":
      case "agi1bx":
      case "FnTufS":
        if (quest.getStage(player) !== STAGE_PREPARE) return;
        if (!held(player, HOLY_SYMBOL_ITEM_ID)) player.getInventory().adds(HOLY_SYMBOL_ITEM_ID, 1);
        setBit(player, BIT_CARPENTER_MET | BIT_SYMBOL_GIVEN);
        if (!needsEmbalmerItems(player) && hasBit(player, BIT_EMBALMER_MET)) {
          setStage(player, STAGE_RITUAL);
        }
        return;

      // Third flashback / ceremony.
      case "aEUIIO":
        if (quest.getStage(player) !== STAGE_FLASHBACK_3) return;
        if (held(player, UNHOLY_SYMBOL_ITEM_ID)) player.getInventory().deleteNumber(UNHOLY_SYMBOL_ITEM_ID, 1);
        setStage(player, STAGE_FLASHBACK_3_END);
        teleport(player, PYRAMID_SOUTH);
        return;
      case "jqHLk2":
        if (quest.getStage(player) !== STAGE_FIGHT) return;
        event.handled = true;
        setStage(player, STAGE_SAVED);
        return;
      case "Ochbk1":
        // The ceremony High Priest's variant selection already advances SAVED to
        // FLASHBACK_4 before the transcript runs.
        if (quest.getStage(player) !== STAGE_SAVED && quest.getStage(player) !== STAGE_FLASHBACK_4) return;
        if (held(player, HOLY_SYMBOL_ITEM_ID)) player.getInventory().deleteNumber(HOLY_SYMBOL_ITEM_ID, 1);
        return;

      // Finishing up.
      case "Us0gTE":
        event.handled = true;
        return;
      case "6y5c1d":
        if (quest.getStage(player) !== STAGE_FINISH) return;
        event.handled = true;
        event.end = true;
        if (!quest.isComplete(player)) {
          clearQuestItems(player);
          syncVarbits(player);
          quest.complete(player);
        }
        return;
      default:
        return;
    }
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    const stage = quest.getStage(player);
    switch (objectId) {
      case ROCK_ENTRANCE_ID:
        if (stage < STAGE_SOPHANEM) return;
        event.handled = true;
        teleport(player, INSIDE_CITY);
        return;
      case HOLE_ID:
        if (stage < STAGE_SOPHANEM) return;
        event.handled = true;
        teleport(player, OUTSIDE_HOLE);
        return;
      case DOOR_PYRAMID_ID:
        handlePyramidDoor(event, player, stage);
        return;
      case PIT_SOUTH_ID:
      case PIT_NORTH_ID:
        handlePit(event, player, stage);
        return;
      case WEST_DOOR_ID:
        handleWestDoor(event, player, stage);
        return;
      case EAST_DOOR_ID:
        handleEastDoor(event, player, stage);
        return;
      case LADDER_ID:
        handleLadder(event, player, stage);
        return;
      case SUNTRAP_ID:
        if (stage !== STAGE_PREPARE) return;
        event.handled = true;
        playCutscene(player, NpcIdentifiers.EMBALMER, "ceremony-preparations-aiding-the-embalmer-using-the-suntrap");
        return;
      case WATER_EDGE_ID:
        if (stage !== STAGE_PREPARE || !held(player, BUCKET_ITEM_ID)) return;
        event.handled = true;
        player.getInventory().deleteNumber(BUCKET_ITEM_ID, 1);
        player.getInventory().adds(BUCKET_OF_SALTWATER_ITEM_ID, 1);
        player.sendMessage("You fill the bucket with salt water.");
        return;
      default:
        break;
    }
    const jar = JAR_BY_OBJECT.get(objectId);
    if (jar) handleJarInteraction(event, player, stage, jar);
  }

  function handlePyramidDoor(event, player, stage) {
    if (stage < STAGE_SOPHANEM) return;
    if (stage === STAGE_SOPHANEM) {
      event.handled = true;
      playCutscene(player, NpcIdentifiers.WANDERER_2, "figuring-out-what-on-gielinor-is-going-on-flashback-1-touching-the-door-of-klenter-s-pyramid");
      setStage(player, STAGE_FLASHBACK_1);
      teleport(player, PYRAMID_SOUTH);
      return;
    }
    if (stage === STAGE_FLASHBACK_1 || stage === STAGE_FIRST_MEMORY) {
      event.handled = true;
      teleport(player, PYRAMID_SOUTH);
      return;
    }
    if (stage < STAGE_FLASHBACK_2) {
      event.handled = true;
      playCutscene(player, NpcIdentifiers.WANDERER_2, "figuring-out-what-on-gielinor-is-going-on-trying-to-enter-the-pyramid-again");
      return;
    }
    if (quest.isComplete(player)) {
      event.handled = true;
      playCutscene(player, NpcIdentifiers.WANDERER_2, "finishing-up-trying-to-enter-the-pyramid-after-the-quest");
      return;
    }
    if (stage === STAGE_FLASHBACK_2 || stage === STAGE_JAR_HELD) {
      event.handled = true;
      const variant = hasBit(player, BIT_ENTERED_PYRAMID)
        ? "putting-things-right-entering-klenter-s-pyramid-entering-the-pyramid-again-after-leaving"
        : "putting-things-right-entering-klenter-s-pyramid";
      playCutscene(player, NpcIdentifiers.WANDERER_2, variant);
      return;
    }
    event.handled = true;
    setBit(player, BIT_ENTERED_PYRAMID);
    teleport(player, stage === STAGE_RITUAL ? PYRAMID_SOUTH : PYRAMID_NORTH);
  }

  function handlePit(event, player, stage) {
    event.handled = true;
    if (stage === STAGE_FLASHBACK_1) {
      teleport(player, PYRAMID_NORTH);
      setStage(player, STAGE_FIRST_MEMORY);
      return;
    }
    if (stage === STAGE_FLASHBACK_2) {
      playCutscene(player, NpcIdentifiers.WANDERER_2, "putting-things-right-flashback-2-jumping-over-the-pit");
      teleport(player, PYRAMID_NORTH);
      setStage(player, STAGE_JAR_ROOM);
      return;
    }
    if (stage === STAGE_JAR_HELD) {
      playCutscene(player, NpcIdentifiers.WANDERER_2, "putting-things-right-flashback-2-jumping-over-the-pit-leaving-through-the-western-hallway");
      teleport(player, PYRAMID_SOUTH);
      setStage(player, STAGE_FLASHBACK_2_END);
      return;
    }
    if (stage === STAGE_RITUAL) {
      // Refused before the jump: a drop would land on the far side. No capture of this: the wording is ours.
      if (!held(player, UNHOLY_SYMBOL_ITEM_ID) && player.getInventory().getFreeSlots() < 1) {
        player.sendMessage("You don't have enough inventory space to do that.");
        return;
      }
      playCutscene(player, NpcIdentifiers.WANDERER_2, "reconsecrating-the-tomb-flashback-3-jumping-over-the-pit-after-the-ceremony-has-begun");
      if (!held(player, UNHOLY_SYMBOL_ITEM_ID)) player.getInventory().adds(UNHOLY_SYMBOL_ITEM_ID, 1);
      teleport(player, PYRAMID_NORTH);
      setStage(player, STAGE_FLASHBACK_3);
      return;
    }
    if (stage === STAGE_FLASHBACK_3_END) {
      teleport(player, PYRAMID_NORTH);
      setStage(player, STAGE_EAST_ROOM);
      return;
    }
    // Only the jump gives a symbol and the sarcophagus needs one, so a lost one comes back here.
    // Crossing without one on a full bag is ours: the pit works both ways, so they can come back for it.
    if (stage === STAGE_FLASHBACK_3 && !held(player, UNHOLY_SYMBOL_ITEM_ID)) {
      if (player.getInventory().getFreeSlots() < 1) {
        player.sendMessage("You don't have enough inventory space to do that.");
      } else {
        player.getInventory().adds(UNHOLY_SYMBOL_ITEM_ID, 1);
      }
    }
    const location = player.getLocation();
    teleport(player, location.getY() <= 9194 ? PYRAMID_NORTH : PYRAMID_SOUTH);
  }

  function handleWestDoor(event, player, stage) {
    if (stage === STAGE_FIRST_MEMORY) {
      event.handled = true;
      playCutscene(player, NpcIdentifiers.WANDERER_2, "figuring-out-what-on-gielinor-is-going-on-flashback-1-touching-the-door-of-klenter-s-pyramid-solving-the-puzzle");
      return;
    }
    if (stage === STAGE_FLASHBACK_2_END) {
      event.handled = true;
      teleport(player, WEST_ROOM);
      setStage(player, STAGE_RETURN_JAR);
      return;
    }
    if (stage >= STAGE_JAR_ROOM && stage <= STAGE_JAR_HELD) {
      event.handled = true;
      teleport(player, WEST_ROOM);
      return;
    }
    if (stage === STAGE_FLASHBACK_3) {
      event.handled = true;
      teleport(player, WEST_ROOM);
    }
  }

  function handleEastDoor(event, player, stage) {
    if (stage === STAGE_FLASHBACK_3) {
      event.handled = true;
      teleport(player, EAST_ROOM);
      return;
    }
    if (stage === STAGE_EAST_ROOM) {
      event.handled = true;
      playCutscene(player, NpcIdentifiers.HIGH_PRIEST_2, "the-devourer-revealed-opening-the-door-to-the-eastern-chamber");
      trackNpc(player, "priest", { id: NpcIdentifiers.POSSESSED_PRIEST, x: PRIEST_SPAWN.x, y: PRIEST_SPAWN.y, z: PRIEST_SPAWN.z });
      trackNpc(player, "ceremonyPriest", { id: CEREMONY_HIGH_PRIEST_MULTI_NPC_ID, x: CEREMONY_PRIEST_SPAWN.x, y: CEREMONY_PRIEST_SPAWN.y, z: CEREMONY_PRIEST_SPAWN.z });
      teleport(player, EAST_ROOM);
      setStage(player, STAGE_FIGHT);
      return;
    }
    if (stage >= STAGE_FIGHT && stage <= STAGE_SAVED) {
      event.handled = true;
      if (stage === STAGE_FIGHT) {
        trackNpc(player, "priest", { id: NpcIdentifiers.POSSESSED_PRIEST, x: PRIEST_SPAWN.x, y: PRIEST_SPAWN.y, z: PRIEST_SPAWN.z });
        trackNpc(player, "ceremonyPriest", { id: CEREMONY_HIGH_PRIEST_MULTI_NPC_ID, x: CEREMONY_PRIEST_SPAWN.x, y: CEREMONY_PRIEST_SPAWN.y, z: CEREMONY_PRIEST_SPAWN.z });
      }
      teleport(player, EAST_ROOM);
    }
  }

  function handleLadder(event, player, stage) {
    event.handled = true;
    if (stage >= STAGE_SAVED) {
      removeOwnedNpcs(player, POSSESSED_PRIEST_NPC_IDS);
      removeOwnedNpcs(player, new Set([CEREMONY_HIGH_PRIEST_MULTI_NPC_ID]));
      const tracked = trackedNpcs.get(player);
      if (tracked) {
        delete tracked.priest;
        delete tracked.ceremonyPriest;
      }
    }
    if (stage === STAGE_FLASHBACK_1) {
      playCutscene(player, NpcIdentifiers.WANDERER_2, "figuring-out-what-on-gielinor-is-going-on-flashback-1-touching-the-door-of-klenter-s-pyramid-attempting-to-climb-up-the-ladder-during-the-flashback");
      return;
    }
    if (stage === STAGE_FLASHBACK_4) {
      playCutscene(player, NpcIdentifiers.ICTHLARIN, "the-devourer-revealed-flashback-4-leaving-the-ceremonial-room");
      teleport(player, SOPHANEM_WAKE);
      setStage(player, STAGE_FINISH);
      return;
    }
    teleport(player, SOPHANEM_WAKE);
  }

  function handleJarInteraction(event, player, stage, jar) {
    const chosen = chosenJar(player);
    if (stage === STAGE_JAR_ROOM) {
      event.handled = true;
      if (jar.key !== chosen.key) {
        playCutscene(player, NpcIdentifiers.WANDERER_2, "putting-things-right-flashback-2-jumping-over-the-pit-attempting-to-take-the-wrong-jar");
        return;
      }
      const spawn = {
        id: chosen.apparitionId,
        x: APPARITION_SPAWN.x,
        y: APPARITION_SPAWN.y,
        z: APPARITION_SPAWN.z,
      };
      trackNpc(player, "apparition", spawn);
      playCutscene(
        player,
        NpcIdentifiers.WANDERER_2,
        "putting-things-right-flashback-2-jumping-over-the-pit-attempting-to-take-the-correct-jar",
        upToApparitionDefeat
      );
      setStage(player, STAGE_APPARITION);
      return;
    }
    if (stage === STAGE_APPARITION) {
      event.handled = true;
      trackNpc(player, "apparition", {
        id: chosen.apparitionId,
        x: APPARITION_SPAWN.x,
        y: APPARITION_SPAWN.y,
        z: APPARITION_SPAWN.z,
      });
      player.sendMessage("You must defeat the apparition first.");
      return;
    }
    if (stage === STAGE_GUARDIAN_DEAD) {
      event.handled = true;
      if (jar.key !== chosen.key) {
        playCutscene(player, NpcIdentifiers.WANDERER_2, "putting-things-right-flashback-2-jumping-over-the-pit-attempting-to-take-the-wrong-jar");
        return;
      }
      playCutscene(player, NpcIdentifiers.WANDERER_2, "putting-things-right-flashback-2-jumping-over-the-pit-taking-the-jar-after-defeating-the-apparition");
      return;
    }
    if ((stage === STAGE_JAR_HELD || stage === STAGE_FLASHBACK_2_END || stage === STAGE_RETURN_JAR) && held(player, chosen.itemId)) {
      event.handled = true;
      if (jar.key !== chosen.key) {
        playCutscene(player, NpcIdentifiers.WANDERER_2, "putting-things-right-flashback-2-jumping-over-the-pit-attempting-to-take-the-wrong-jar");
        return;
      }
      if (stage === STAGE_RETURN_JAR || stage === STAGE_FLASHBACK_2_END) {
        playCutscene(player, NpcIdentifiers.WANDERER_2, "putting-things-right-returning-the-jar");
        return;
      }
      playCutscene(player, NpcIdentifiers.WANDERER_2, "putting-things-right-attempting-to-take-a-jar-again");
    }
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (itemId === UNHOLY_SYMBOL_ITEM_ID && objectId === SARCOPHAGUS_MULTI_ID) {
      if (quest.getStage(player) !== STAGE_FLASHBACK_3) return;
      event.handled = true;
      playCutscene(
        player,
        NpcIdentifiers.HIGH_PRIEST_2,
        "reconsecrating-the-tomb-flashback-3-jumping-over-the-pit-after-the-ceremony-has-begun-hiding-the-symbol-in-a-sarcophagus"
      );
      return;
    }
    if (itemId === BUCKET_OF_SALTWATER_ITEM_ID && objectId === SUNTRAP_ID) {
      if (quest.getStage(player) !== STAGE_PREPARE || !hasBit(player, BIT_NEEDS_SALT)) return;
      event.handled = true;
      playCutscene(player, NpcIdentifiers.EMBALMER, "ceremony-preparations-aiding-the-embalmer-using-the-suntrap");
    }
  }

  /**
   * The embalmer's sap is the one ceremony supply with no NPC to re-issue it:
   * the wiki route is a knife on an evergreen tree while carrying the bucket.
   * Hooking it makes a lost bucket of sap recoverable and consumes only the
   * empty bucket.
   */
  function handleKnifeOnTree(event) {
    const { player, itemId } = event;
    if (itemId !== KNIFE_ITEM_ID) return false;
    if (quest.getStage(player) !== STAGE_PREPARE || !hasBit(player, BIT_NEEDS_SAP)) return false;
    event.handled = true;
    if (held(player, BUCKET_OF_SAP_ITEM_ID)) {
      player.sendMessage("You already have a bucket of sap.");
      return true;
    }
    if (!held(player, BUCKET_ITEM_ID)) {
      player.sendMessage("You need a bucket to collect the tree sap.");
      return true;
    }
    player.getInventory().deleteNumber(BUCKET_ITEM_ID, 1);
    player.getInventory().adds(BUCKET_OF_SAP_ITEM_ID, 1);
    player.sendMessage("You cut the tree and allow some sap to drip into your bucket.");
    return true;
  }

  /** Cache-granted "Empty" on the quest buckets: the bucket itself is reusable. */
  function emptyCeremonyBucket(event) {
    const { player, itemId, option } = event;
    if (option !== "Empty") return false;
    if (itemId !== BUCKET_OF_SAP_ITEM_ID && itemId !== BUCKET_OF_SALTWATER_ITEM_ID) return false;
    event.handled = true;
    // Empty acts on the clicked bucket only; the player may carry several.
    player.getInventory().deleteNumber(itemId, 1);
    player.getInventory().adds(BUCKET_ITEM_ID, 1);
    player.sendMessage(itemId === BUCKET_OF_SAP_ITEM_ID ? "You empty the bucket of sap." : "You empty the bucket of salt water.");
    return true;
  }

  // ==========================================================================
  // NPC deaths
  // ==========================================================================

  function handleNpcDeath(event) {
    const killer = event.killer?.isPlayer?.() ? event.killer : null;
    if (!killer) return;
    const tracked = trackedNpcs.get(killer);
    if (tracked?.apparition && tracked.apparition === event.npc && APPARITION_NPC_IDS.has(event.npcId)) {
      delete tracked.apparition;
      removeOwnedNpcs(killer, APPARITION_NPC_IDS, event.npc);
      playCutscene(
        killer,
        NpcIdentifiers.WANDERER_2,
        "putting-things-right-flashback-2-jumping-over-the-pit-attempting-to-take-the-correct-jar",
        onlyApparitionDefeat
      );
      return;
    }
    if (tracked?.priest && tracked.priest === event.npc && POSSESSED_PRIEST_NPC_IDS.has(event.npcId)) {
      delete tracked.priest;
      removeOwnedNpcs(killer, POSSESSED_PRIEST_NPC_IDS, event.npc);
      playCutscene(killer, NpcIdentifiers.POSSESSED_PRIEST, "the-devourer-revealed-defeating-the-posessed-priest");
    }
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  function handleLogin({ player }) {
    const stage = quest.getStage(player);
    if (stage === STAGE_NOT_STARTED && bits(player) !== 0) {
      player.setAttribute(BITS_ATTRIBUTE, 0);
      player.setAttribute(JAR_ATTRIBUTE, "");
    }
    // Players who finished before the cleanup hook may still hold the jar or
    // unused ceremony supplies; a relog clears them like the final hand-in does.
    if (quest.isComplete(player)) clearQuestItems(player);
    syncVarbits(player);
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    clearAllTracked(player);
  }

  // ==========================================================================
  // Journal / reward
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I met a strange wanderer in the desert north of Sophanem who</str>",
        "<str>hypnotised me into stealing Klenter's burial jar. With the</str>",
        "<str>Sphinx's help I returned it and helped the priests protect</str>",
        "<str>their ceremony from the Devourer.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_FINISH) {
      return [
        "<str>I helped the priests defend Klenter's tomb from the Devourer.</str>",
        "",
        "I should speak to the <col=800000>High Priest</col> in Sophanem.",
      ];
    }
    if (stage >= STAGE_FLASHBACK_4) {
      return [
        "<str>I helped the priests defend Klenter's tomb from the Devourer.</str>",
        "",
        "I should leave the <col=800000>pyramid</col>.",
      ];
    }
    if (stage >= STAGE_SAVED) {
      return [
        "<str>I defeated the priest possessed by the Devourer.</str>",
        "",
        "I should speak to the <col=800000>High Priest</col> in the eastern chamber.",
      ];
    }
    if (stage >= STAGE_FIGHT) {
      return [
        "<str>A priest was possessed by the Devourer during the ceremony!</str>",
        "",
        "I must defeat the <col=800000>possessed priest</col>.",
      ];
    }
    if (stage >= STAGE_EAST_ROOM) {
      return [
        "<str>The ceremony has begun and the Devourer is coming.</str>",
        "",
        "I should jump the pit and enter the <col=800000>eastern chamber</col>.",
      ];
    }
    if (stage >= STAGE_FLASHBACK_3_END) {
      return [
        "<str>In the memory I hid the unholy symbol, then the flashback ended.</str>",
        "",
        "I should cross the <col=800000>pit</col> and warn the priests.",
      ];
    }
    if (stage >= STAGE_FLASHBACK_3) {
      return [
        "<str>I am reliving another memory. I must hide the unholy symbol</str>",
        "<str>in a sarcophagus in the eastern chamber.</str>",
      ];
    }
    if (stage >= STAGE_RITUAL) {
      return [
        "<str>The ceremony has started without me. I need my cat to get in.</str>",
        "",
        "I should enter <col=800000>Klenter's Pyramid</col> and cross the pit.",
      ];
    }
    if (stage >= STAGE_PREPARE) {
      return [
        "<str>The High Priest asked me to help prepare the ceremony.</str>",
        "",
        "I should help the <col=800000>embalmer</col> gather a bucket of sap,",
        "salt and linen, and bring <col=800000>willow logs</col> to the carpenter",
        "so he can make a <col=800000>holy symbol</col>.",
      ];
    }
    if (stage >= STAGE_JAR_RETURNED) {
      return [
        "<str>I returned Klenter's burial jar to the pyramid.</str>",
        "",
        "I should tell the <col=800000>High Priest</col> in Sophanem.",
      ];
    }
    if (stage >= STAGE_FLASHBACK_2_END) {
      return [
        "<str>In the memory I took the burial jar away from the guardian.</str>",
        "",
        "I should solve the puzzle again and put the",
        "<col=800000>burial jar</col> back where I found it.",
      ];
    }
    if (stage >= STAGE_JAR_HELD) {
      return [
        "<str>I defeated the guardian and took the burial jar.</str>",
        "",
        "I should leave the memory and return the <col=800000>burial jar</col>.",
      ];
    }
    if (stage >= STAGE_GUARDIAN_DEAD) {
      return [
        "<str>A ghostly apparition guards the canopic jars; I defeated it.</str>",
        "",
        "I should take the <col=800000>canopic jar</col> I came for.",
      ];
    }
    if (stage >= STAGE_APPARITION) {
      return [
        "<str>I tried to take a canopic jar and an apparition appeared!</str>",
        "",
        "I must defeat the <col=800000>apparition</col>.",
      ];
    }
    if (stage >= STAGE_JAR_ROOM) {
      return [
        "<str>I am reliving the theft. I must take the correct canopic jar</str>",
        "<str>from the western chamber.</str>",
      ];
    }
    if (stage >= STAGE_FLASHBACK_2) {
      return [
        "<str>The High Priest asked me to return Klenter's burial jar.</str>",
        "",
        "I should enter <col=800000>Klenter's Pyramid</col> with my cat",
        "and cross the pit.",
      ];
    }
    if (stage >= STAGE_TALK_HIGH_PRIEST) {
      return [
        "<str>The Sphinx gave me a token to show the High Priest.</str>",
        "",
        "I should speak to the <col=800000>High Priest</col> in Sophanem.",
      ];
    }
    if (stage >= STAGE_TALK_SPHINX) {
      return [
        "<str>I remember the wanderer hypnotised me. The Sphinx may help.</str>",
        "",
        "I should speak to the <col=800000>Sphinx</col> with my cat.",
      ];
    }
    if (stage >= STAGE_FIRST_MEMORY) {
      return [
        "<str>Another flashback began as I touched the pyramid door.</str>",
        "",
        "I should jump the <col=800000>pit</col> and solve the puzzle",
        "in the western chamber of the pyramid.",
      ];
    }
    if (stage >= STAGE_FLASHBACK_1) {
      return [
        "<str>Touching the pyramid door started a flashback.</str>",
        "",
        "I should make my way through <col=800000>Klenter's Pyramid</col>.",
      ];
    }
    if (stage >= STAGE_SOPHANEM) {
      return [
        "<str>The wanderer hypnotised me and I woke up in Sophanem.</str>",
        "",
        "I should touch the door of the <col=800000>pyramid</col> to",
        "remember what happened.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>The wanderer will show me a secret way into Sophanem.</str>",
        "",
        "I need to bring her a full <col=800000>waterskin</col> and a",
        "<col=800000>tinderbox</col>.",
      ];
    }
    return [
      "I can start this quest by talking to the <col=800000>wanderer</col>",
      "in the desert north of Sophanem.",
      "I will need a cat, a full waterskin and a tinderbox.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.THIEVING, 4500);
    skills.addExperiences(Skill.AGILITY, 4000);
    skills.addExperiences(Skill.WOODCUTTING, 4000);
    syncVarbits(player);
  }

  api.persistAttribute(BITS_ATTRIBUTE);
  api.persistAttribute(JAR_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "ictlharins_little_helper",
    name: "Icthlarin's Little Helper",
    varpId: VARP_ICS_MAIN,
    varbitId: VARBIT_ICS_LITTLE_VAR,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.THIEVING.getIndex(), amount: 4500, label: "Thieving" },
      { skillId: Skill.AGILITY.getIndex(), amount: 4000, label: "Agility" },
      { skillId: Skill.WOODCUTTING.getIndex(), amount: 4000, label: "Woodcutting" },
    ],
    rewardItemId: CATSPEAK_AMULET_ITEM_ID,
    rewardItemLabel: "Amulet of catspeak",
    otherRewards: ["Access to the city of Sophanem"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction("Sphinx", { "Talk-to": sphinxTalkTo });
  api.onNpcInteraction("High Priest", { "Talk-to": highPriestTalkTo });
  api.onNpcInteraction("Jex", { "Talk-to": jexTalkTo });
  api.onCustomEvent("door:toggle", handleDoorToggle);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject);
  api.onItemOnObject("Knife", SAP_TREE_OBJECT_NAME, handleKnifeOnTree);
  api.onItemAction("Bucket of sap", { Empty: emptyCeremonyBucket });
  api.onItemAction("Bucket of saltwater", { Empty: emptyCeremonyBucket });
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
