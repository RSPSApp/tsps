/**
 * Biohazard (members).
 *
 * The words come from the "Biohazard" transcript page. Elena, Jerico, Omart,
 * Kilron, King Lathas, the Chemist, Julie, Guidor, the three couriers, Nurse
 * Sarah and the mourners are all indexed, so this plugin selects the variant by
 * stage, answers the prose conditions and completes the quest through the
 * transcript's own action on King Lathas.
 *
 * Stages (varp 68): 1 started, 2 spoken to Jerico, 3 used bird feed, 4 released
 * pigeons, 5 climbed the wall, 6 poisoned the stew, 7 found the distillator,
 * 10 given the distillator, 12 spoken to the chemist, 14 found Guidor's secret,
 * 15 reported to Elena, 16 complete.
 *
 * Quest-local world edits: Jerico's and Sarah's cupboards, the watchtower
 * distraction, the pigeon cage, the Mourner fence/cauldron, the HQ doors and
 * crate, the Varrock bedroom door and guard search, the courier vial hand-offs
 * and the Ormart/Kilron wall crossings.
 */
module.exports = function registerBiohazardQuest(api) {
  const {
    Skill, Equipment, Location, GameObject, ObjectManager,
    ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const ELENA_NPC_IDS = new Set([
    NpcIdentifiers.ELENA, // 1102
    NpcIdentifiers.ELENA_2, // 4257
    NpcIdentifiers.ELENA_3,
    NpcIdentifiers.ELENA_4,
    NpcIdentifiers.ELENA_5,
    NpcIdentifiers.ELENA_6,
    NpcIdentifiers.ELENA_7,
    NpcIdentifiers.ELENA_8,
    NpcIdentifiers.ELENA_9,
    NpcIdentifiers.ELENA_10,
    NpcIdentifiers.ELENA_11,
  ]);
  const JERICO_NPC_ID = NpcIdentifiers.JERICO; // 1145
  const OMART_NPC_IDS = new Set([
    NpcIdentifiers.OMART,
    NpcIdentifiers.OMART_2,
    NpcIdentifiers.OMART_3,
    NpcIdentifiers.OMART_4,
  ]);
  const KILRON_NPC_IDS = new Set([
    NpcIdentifiers.KILRON,
    NpcIdentifiers.KILRON_2,
    NpcIdentifiers.KILRON_4,
  ]);
  const KING_LATHAS_NPC_IDS = new Set([
    NpcIdentifiers.KING_LATHAS,
    NpcIdentifiers.KING_LATHAS_2,
    NpcIdentifiers.KING_LATHAS_3,
    NpcIdentifiers.KING_LATHAS_4,
  ]);
  const CHEMIST_NPC_ID = NpcIdentifiers.CHEMIST; // 1146
  const JULIE_NPC_ID = NpcIdentifiers.JULIE; // 1109
  const GUIDOR_NPC_ID = NpcIdentifiers.GUIDOR; // 1110
  const NURSE_SARAH_NPC_ID = NpcIdentifiers.NURSE_SARAH; // 1152
  const COURIER_NPC_IDS = new Set([
    NpcIdentifiers.DA_VINCI,
    NpcIdentifiers.DA_VINCI_2,
    NpcIdentifiers.CHANCY,
    NpcIdentifiers.CHANCY_2,
    NpcIdentifiers.HOPS,
    NpcIdentifiers.HOPS_2,
  ]);
  const MOURNER_NPC_IDS = new Set([
    NpcIdentifiers.MOURNER_9,
    NpcIdentifiers.MOURNER_10,
    NpcIdentifiers.MOURNER_11,
    NpcIdentifiers.MOURNER_12,
    NpcIdentifiers.MOURNER_13,
    NpcIdentifiers.MOURNER_15,
    NpcIdentifiers.MOURNER_16,
  ]);

  const VARP_BIOHAZARD = 68;
  const VARBIT_FREE_CLOTHES = 9106;
  const ARDOUGNE_WALL_DOOR_IDS = new Set([
    ObjectIdentifiers.ARDOUGNE_WALL_DOOR,
    ObjectIdentifiers.ARDOUGNE_WALL_DOOR_2,
  ]);

  // Cache placements used by the helper route. Multi-locs 37328/37327 resolve
  // by varp 68 to Watchtower (35947) and Cauldron (35945).
  const JERICO_CUPBOARD_CLOSED_ID = 2056;
  const JERICO_CUPBOARD_OPEN_ID = 2057;
  const SARAH_CUPBOARD_CLOSED_ID = 2062;
  const SARAH_CUPBOARD_OPEN_ID = 2063;
  const WATCHTOWER_OBJECT_ID = 37328;
  const CAULDRON_OBJECT_ID = 37327;
  const MOURNER_FENCE_OBJECT_ID = 2068;
  const MOURNER_HQ_DOOR_ID = 2036;
  const MOURNER_CAGE_GATE_IDS = new Set([2058, 2060]);
  const MOURNER_CRATE_ID = 2064;
  const BEDROOM_DOOR_CLOSED_ID = 2032;
  const BEDROOM_DOOR_OPEN_ID = 2033;
  /** Guidor's bedroom door, the only "Bedroom door" in south-east Varrock. */
  const GUIDOR_BEDROOM_DOOR = { x: 3282, y: 3382 };

  const FREE_GOWN_ATTRIBUTE = "biohazard:free-gown-given";
  const GIVEN_VIALS_ATTRIBUTE = "biohazard:given-vials";
  /** Refunded wrong-vial transactions, one entry per failed courier hand-over. */
  const CHANCY_REFUND_ATTRIBUTE = "biohazard:chancy-refunds";
  // Imported Biohazard message EYYSjv from Elena's lost-items capacity branch.
  const ELENA_CAPACITY_MESSAGE = "Elena tries to give you some items but you don't have enough room for them.";

  const WEST_ARDOUGNE_LANDING = new Location(2554, 3266, 0);
  const EAST_ARDOUGNE_LANDING = new Location(2560, 3266, 0);
  const WATCHTOWER_TILE = { x: 2562, y: 3301 };
  const MOURNER_YARD = { minX: 2542, maxX: 2555, minY: 3328, maxY: 3333 };
  const VARROCK_SOUTH_EAST_ZONE = { minX: 3265, maxX: 3287, minY: 3376, maxY: 3407 };


  const STAGE_STARTED = 1;
  const STAGE_SPOKEN_TO_JERICO = 2;
  const STAGE_USED_BIRD_FEED = 3;
  const STAGE_RELEASED_PIGEONS = 4;
  const STAGE_CLIMBED_LADDER = 5;
  const STAGE_POISONED_STEW = 6;
  const STAGE_FOUND_DISTILLATOR = 7;
  const STAGE_GIVEN_DISTILLATOR = 10;
  const STAGE_SPOKEN_TO_CHEMIST = 12;
  const STAGE_FOUND_SECRET = 14;
  const STAGE_REPORTED_TO_ELENA = 15;
  const STAGE_COMPLETE = 16;

  const DISTILLATOR_ITEM_ID = ItemIdentifiers.DISTILLATOR;
  const BIRD_FEED_ITEM_ID = ItemIdentifiers.BIRD_FEED;
  const PIGEON_CAGE_ITEM_ID = ItemIdentifiers.PIGEON_CAGE;
  const PIGEON_CAGE_EMPTY_ITEM_ID = ItemIdentifiers.PIGEON_CAGE_2;
  const ROTTEN_APPLE_ITEM_ID = ItemIdentifiers.ROTTEN_APPLE;
  const PRIEST_GOWN_TOP_ITEM_ID = ItemIdentifiers.PRIEST_GOWN;
  const PRIEST_GOWN_BOTTOM_ITEM_ID = ItemIdentifiers.PRIEST_GOWN_3;
  const MOURNER_KEY_ITEM_ID = ItemIdentifiers.KEY_2;
  /** Biohazard's own "has the key" condition step ids (Chemist/Guidor's cell door). */
  const BIOHAZARD_KEY_CONDITION_IDS = new Set(["21-b0A", "3MJwAD"]);
  const MEDICAL_GOWN_ITEM_ID = ItemIdentifiers.MEDICAL_GOWN;
  const GAS_MASK_ITEM_ID = ItemIdentifiers.GAS_MASK;
  const PLAGUE_SAMPLE_ITEM_ID = ItemIdentifiers.PLAGUE_SAMPLE;
  const TOUCH_PAPER_ITEM_ID = ItemIdentifiers.TOUCH_PAPER;
  const ETHENEA_ITEM_ID = ItemIdentifiers.ETHENEA;
  const LIQUID_HONEY_ITEM_ID = ItemIdentifiers.LIQUID_HONEY;
  const SULPHURIC_BROLINE_ITEM_ID = ItemIdentifiers.SULPHURIC_BROLINE;
  const COINS_ITEM_ID = ItemIdentifiers.COINS;

  const START_HOOK = "quest:biohazard:start";
  const COMPLETE_ACTION_ID = "vxKtyO";

  const ASYFF_NPC_ID = NpcIdentifiers.ASYFF; // 2887
  /**
   * The Combat Training Camp guards and its entrance gate in West Ardougne.
   * King Lathas only opens the camp once Biohazard is done, so the guards use
   * the imported refusal and the gate stays locked until then.
   */
  const CAMP_GUARD_NPC_IDS = new Set([1111, 1112, 1113]);
  const CAMP_GATE_IDS = new Set([2039, 2041]);
  /** The only placements of those gate ids: the camp entrance at 2517/2518,3356. */
  const CAMP_GATE_TILES = new Set(["2517,3356", "2518,3356"]);
  /** The imported message text of the camp's locked gate (ulBzsB). */
  const CAMP_LOCKED_MESSAGE = "The gates are locked.";
  /**
   * Eagles' Peak stages where its eagle costume (or a spare) is still
   * outstanding: met Nikolaus (4) and disguise made (5). Asyff is shared.
   */
  const EAGLES_PEAK_COSTUME_STAGES = new Set([4, 5]);
  const GUARD_NPC_ID = NpcIdentifiers.GUARD_19; // 1147, Guard (East Varrock)
  /** The sickest mourner upstairs (spawned 9230, content id 9008); drops the key. */
  const SICKEST_MOURNER_NPC_ID = NpcIdentifiers.MOURNER_14; // 9008
  const GUARD_VIAL_MESSAGE_IDS = new Map([
    ["FXDpRm", ETHENEA_ITEM_ID],
    ["vIH9dQ", LIQUID_HONEY_ITEM_ID],
    ["A8JLmw", SULPHURIC_BROLINE_ITEM_ID],
  ]);
  const RIMMINGTON_COURIERS = new Map([
    [NpcIdentifiers.DA_VINCI, { role: "da-vinci", vial: ETHENEA_ITEM_ID, suffix: "ethenea" }],
    [NpcIdentifiers.CHANCY, { role: "chancy", vial: LIQUID_HONEY_ITEM_ID, suffix: "honey" }],
    [NpcIdentifiers.HOPS, { role: "hops", vial: SULPHURIC_BROLINE_ITEM_ID, suffix: "broline" }],
  ]);
  const VARROCK_COURIERS = new Map([
    [NpcIdentifiers.DA_VINCI_2, { role: "da-vinci", vial: ETHENEA_ITEM_ID, suffix: "ethenea" }],
    [NpcIdentifiers.CHANCY_2, { role: "chancy", vial: LIQUID_HONEY_ITEM_ID, suffix: "honey" }],
    [NpcIdentifiers.HOPS_2, { role: "hops", vial: SULPHURIC_BROLINE_ITEM_ID, suffix: "broline" }],
  ]);

  let quest;

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const hasAllVials = (player) =>
    held(player, ETHENEA_ITEM_ID) &&
    held(player, LIQUID_HONEY_ITEM_ID) &&
    held(player, SULPHURIC_BROLINE_ITEM_ID);
  const hasAllItems = (player) =>
    hasAllVials(player) && held(player, TOUCH_PAPER_ITEM_ID) && held(player, PLAGUE_SAMPLE_ITEM_ID);

  const wornId = (player, slot) => player.getEquipment().get(slot)?.getId?.();
  const wearingGasMask = (player) => wornId(player, Equipment.HEAD_SLOT) === GAS_MASK_ITEM_ID;
  const wearingMedicalGown = (player) => wornId(player, Equipment.BODY_SLOT) === MEDICAL_GOWN_ITEM_ID;
  const wearingPriestGown = (player) =>
    wornId(player, Equipment.BODY_SLOT) === PRIEST_GOWN_TOP_ITEM_ID &&
    wornId(player, Equipment.LEG_SLOT) === PRIEST_GOWN_BOTTOM_ITEM_ID;

  const freeSlots = (player) => player.getInventory().getFreeSlots();

  function plagueCityComplete(player) {
    // Asked through the shared quest registry so Plague City's own completion
    // value (currently 29) stays owned by its plugin.
    const request = { player, key: "plague_city", complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  /**
   * Eagles' Peak's internal stage, asked through the shared quest registry so
   * the other quest keeps ownership of its own progress values.
   */
  function eaglesPeakStage(player) {
    const request = { player, key: "eagles_peak", stage: null };
    api.emitCustomEvent("quest:get-stage", request);
    return Number(request.stage) || 0;
  }

  function hasElenaLoan(player) {
    const courierVials = courierHeldVials(player);
    return held(player, PLAGUE_SAMPLE_ITEM_ID) &&
      [ETHENEA_ITEM_ID, LIQUID_HONEY_ITEM_ID, SULPHURIC_BROLINE_ITEM_ID]
        .every((itemId) => held(player, itemId) || courierVials.has(itemId));
  }

  /** Elena's sample/vials that are neither held nor already with a courier. */
  function elenaMissingItems(player) {
    const courierVials = courierHeldVials(player);
    return [PLAGUE_SAMPLE_ITEM_ID, ETHENEA_ITEM_ID, LIQUID_HONEY_ITEM_ID, SULPHURIC_BROLINE_ITEM_ID]
      .filter((itemId) => !held(player, itemId) && !courierVials.has(itemId));
  }

  /** Adds each missing item only when the bag can hold all of them. */
  function giveMissingItems(player, itemIds, fullMessage) {
    const missing = itemIds.filter((itemId) => !held(player, itemId));
    if (!missing.length) return true;
    if (freeSlots(player) < missing.length) {
      if (fullMessage) player.sendMessage(fullMessage);
      return false;
    }
    for (const itemId of missing) player.getInventory().adds(itemId, 1);
    return true;
  }

  function givePriestGown(player) {
    if (Number(player.getAttribute(FREE_GOWN_ATTRIBUTE)) === 1) return false;
    const missing = [PRIEST_GOWN_TOP_ITEM_ID, PRIEST_GOWN_BOTTOM_ITEM_ID].filter((itemId) => !held(player, itemId));
    if (freeSlots(player) < missing.length) return false;
    for (const itemId of missing) player.getInventory().adds(itemId, 1);
    player.setAttribute(FREE_GOWN_ATTRIBUTE, 1);
    player.getPacketSender().sendVarbit(VARBIT_FREE_CLOTHES, 1);
    return true;
  }

  function givenVials(player) {
    const map = new Map();
    for (const part of String(player.getAttribute(GIVEN_VIALS_ATTRIBUTE) ?? "").split(",")) {
      const [role, raw] = part.split(":");
      const vial = Number(raw);
      if (role && Number.isInteger(vial) && vial > 0) map.set(role, vial);
    }
    return map;
  }

  function saveGivenVials(player, map) {
    player.setAttribute(GIVEN_VIALS_ATTRIBUTE, [...map].map(([role, vial]) => `${role}:${vial}`).join(","));
  }

  /** Vials a courier will actually return (correct role/vial pairing). */
  function courierHeldVials(player) {
    const heldByCourier = new Set();
    for (const [role, vial] of givenVials(player)) {
      const courier = [...RIMMINGTON_COURIERS.values()].find((entry) => entry.role === role);
      if (courier?.vial === vial) heldByCourier.add(vial);
    }
    return heldByCourier;
  }

  /**
   * A wrong vial is consumed by its Varrock courier (sold, painted or drunk), so
   * its role record is no longer a pending hand-off. Once Elena's recovery has
   * supplied that role's real vial, drop only the failed record so the
   * Rimmington courier can accept the replacement; correct pending loans stay.
   * The failed transaction ends with it, so its refund can be paid again.
   */
  function clearResolvedFailedReservations(player) {
    const given = givenVials(player);
    const refunds = refundedTransactions(player);
    let changed = false;
    for (const [role, vial] of given) {
      const courier = [...RIMMINGTON_COURIERS.values()].find((entry) => entry.role === role);
      if (courier && vial !== courier.vial && held(player, courier.vial)) {
        given.delete(role);
        refunds.delete(`${role}:${vial}`);
        changed = true;
      }
    }
    if (changed) {
      saveGivenVials(player, given);
      saveRefundedTransactions(player, refunds);
    }
  }

  /** Wrong-vial transactions already paid out, one "role:vial" entry each. */
  function refundedTransactions(player) {
    return new Set(String(player.getAttribute(CHANCY_REFUND_ATTRIBUTE) ?? "").split(",").filter(Boolean));
  }

  function saveRefundedTransactions(player, refunds) {
    player.setAttribute(CHANCY_REFUND_ATTRIBUTE, [...refunds].join(","));
  }

  function giveCoins(player, amount) {
    const inventory = player.getInventory();
    if (held(player, COINS_ITEM_ID)) {
      inventory.adds(COINS_ITEM_ID, amount);
      return true;
    }
    if (freeSlots(player) < 1) {
      player.sendMessage("You need a free inventory space to take the coins.");
      return false;
    }
    inventory.adds(COINS_ITEM_ID, amount);
    return true;
  }

  function vialFromText(text) {
    const value = String(text).toLowerCase();
    if (value.includes("ethenea")) return ETHENEA_ITEM_ID;
    if (value.includes("liquid honey")) return LIQUID_HONEY_ITEM_ID;
    if (value.includes("sulphuric broline")) return SULPHURIC_BROLINE_ITEM_ID;
    return null;
  }

  function replaceObject(object, newId, face = object.getFace()) {
    const location = object.getLocation();
    ObjectManager.deregister(object, true);
    ObjectManager.register(
      new GameObject(
        newId,
        new Location(location.getX(), location.getY(), location.getZ()),
        object.getType(),
        face,
        object.getPrivateArea() ?? null
      ),
      true
    );
  }

  function inMournerYard(location) {
    const x = location?.getX?.() ?? location?.x ?? 0;
    const y = location?.getY?.() ?? location?.y ?? 0;
    return x >= MOURNER_YARD.minX && x <= MOURNER_YARD.maxX && y >= MOURNER_YARD.minY && y <= MOURNER_YARD.maxY;
  }

  function nearWatchtower(player) {
    const location = player.getLocation?.();
    if (!location) return false;
    const x = location.getX?.() ?? location.x ?? 0;
    const y = location.getY?.() ?? location.y ?? 0;
    return Math.max(Math.abs(x - WATCHTOWER_TILE.x), Math.abs(y - WATCHTOWER_TILE.y)) <= 5;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return ["<str>I uncovered the Ardougne plague hoax.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }
    if (stage >= STAGE_REPORTED_TO_ELENA) {
      return ["Elena told me to report the conspiracy to <col=800000>King Lathas</col>."];
    }
    if (stage >= STAGE_FOUND_SECRET) {
      return ["Guidor proved there is no plague.", "I should tell <col=800000>Elena</col> immediately."];
    }
    if (stage >= STAGE_SPOKEN_TO_CHEMIST) {
      return [
        "The three couriers can smuggle Elena's reagents to Varrock.",
        "I must collect them at the <col=800000>Dancing Donkey Inn</col> and see Guidor.",
      ];
    }
    if (stage >= STAGE_GIVEN_DISTILLATOR) {
      return ["Take Elena's plague sample to the <col=800000>Chemist</col> in Rimmington."];
    }
    if (stage >= STAGE_FOUND_DISTILLATOR) {
      return ["I found Elena's distillator and should return it to her."];
    }
    if (stage >= STAGE_POISONED_STEW) {
      return [
        "The mourners are ill. I need a <col=800000>medical gown</col>",
        "and must search their upstairs crates for the distillator.",
      ];
    }
    if (stage >= STAGE_CLIMBED_LADDER) {
      return ["I crossed into West Ardougne.", "A rotten apple might spoil the mourners' stew."];
    }
    if (stage >= STAGE_RELEASED_PIGEONS) {
      return ["The watchtower guards are distracted. Speak to <col=800000>Omart</col> now."];
    }
    if (stage >= STAGE_USED_BIRD_FEED) {
      return ["Release Jerico's <col=800000>pigeons</col> beside the watchtower."];
    }
    if (stage >= STAGE_SPOKEN_TO_JERICO) {
      return ["Use <col=800000>bird feed</col> and pigeons to distract the watchtower."];
    }
    if (stage >= STAGE_STARTED) {
      return ["Speak to <col=800000>Jerico</col> near the East Ardougne chapel."];
    }
    return ["Speak to <col=800000>Elena</col> after completing Plague City."];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.THIEVING, 1250);
  }

  function elenaVariant(stage, player) {
    if (stage >= STAGE_COMPLETE) return "return-to-ardougne-talking-to-elena-after-finishing-the-quest";
    if (stage === STAGE_REPORTED_TO_ELENA) {
      return "return-to-ardougne-talking-to-elena-after-talking-to-guidor-talking-to-elena-again-before-talking-to-the-king";
    }
    if (stage === STAGE_FOUND_SECRET) {
      quest.setStage(player, STAGE_REPORTED_TO_ELENA);
      return "return-to-ardougne-talking-to-elena-after-talking-to-guidor";
    }
    if (stage >= STAGE_GIVEN_DISTILLATOR) {
      return "delivering-the-samples-talking-to-elena-again-before-visiting-the-chemist";
    }
    if (stage >= STAGE_FOUND_DISTILLATOR) {
      if (held(player, DISTILLATOR_ITEM_ID)) {
        player.getInventory().deleteNumber(DISTILLATOR_ITEM_ID, 1);
        quest.setStage(player, STAGE_GIVEN_DISTILLATOR);
        return "delivering-the-samples-talking-to-elena-with-the-distillator";
      }
      return "infiltrating-the-mourner-hq-talking-to-elena-without-the-distillator";
    }
    if (stage >= STAGE_STARTED) {
      return "infiltrating-the-mourner-hq-talking-to-elena-without-the-distillator";
    }
    return "getting-started-talking-to-elena";
  }

  function jericoVariant(stage) {
    if (stage >= STAGE_CLIMBED_LADDER) return "infiltrating-the-mourner-hq-talking-to-jerico-after-entering-west-ardougne";
    if (stage >= STAGE_RELEASED_PIGEONS) return "getting-started-talking-to-jerico-after-freeing-the-birds";
    if (stage >= STAGE_USED_BIRD_FEED) return "getting-started-talking-to-jerico-after-talking-to-omart";
    if (stage >= STAGE_SPOKEN_TO_JERICO) return "getting-started-talking-to-jerico-again";
    return "getting-started-talking-to-jerico";
  }

  function omartVariant(stage) {
    if (stage >= STAGE_GIVEN_DISTILLATOR) return "delivering-the-samples-talking-to-omart-after-returning-the-distillator";
    if (stage >= STAGE_CLIMBED_LADDER) return "getting-started-talking-to-omart-after-entering-west-ardougne";
    if (stage >= STAGE_RELEASED_PIGEONS) return "getting-started-talking-to-omart-after-freeing-the-birds";
    if (stage >= STAGE_USED_BIRD_FEED) return "getting-started-talking-to-omart-talking-to-omart-again";
    return "getting-started-talking-to-omart";
  }

  function kingLathasVariant(stage) {
    // Underground Pass and Regicide continue Lathas's storyline after Biohazard;
    // once Biohazard is finished, defer so their selectors can answer.
    if (stage >= STAGE_COMPLETE) return null;
    if (stage >= STAGE_REPORTED_TO_ELENA) {
      return "return-to-ardougne-talking-to-king-lathas-after-talking-to-elena-about-the-plague";
    }
    return null;
  }

  function rimmingtonCourierVariant(stage, player, courier) {
    const base = `visiting-the-chemist-house-in-rimmington-talking-to-${courier.role}-in-rimmington`;
    if (givenVials(player).has(courier.role)) return `${base}-after-giving-him-a-vial`;
    return stage >= STAGE_SPOKEN_TO_CHEMIST
      ? `${base}-after-talking-to-the-chemist`
      : `${base}-before-talking-to-the-chemist`;
  }

  function varrockCourierVariant(stage, player, courier) {
    const base = `visiting-south-east-varrock-talking-to-${courier.role}-in-varrock`;
    if (stage < STAGE_SPOKEN_TO_CHEMIST) return `${base}-before-talking-to-the-chemist`;
    const vial = givenVials(player).get(courier.role);
    if (!vial) return `${base}-before-talking-to-the-chemist`;
    return vial === courier.vial
      ? `${base}-after-giving-him-${courier.suffix}`
      : `${base}-after-giving-him-the-wrong-vial`;
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (ELENA_NPC_IDS.has(npcId)) {
      // Plague City registers after this quest; keep Elena's own quest until
      // its prerequisite is finished, then Biohazard owns the start.
      if (stage < STAGE_STARTED && !plagueCityComplete(player)) return null;
      return elenaVariant(stage, player);
    }
    if (npcId === JERICO_NPC_ID) {
      if (stage === STAGE_STARTED) quest.setStage(player, STAGE_SPOKEN_TO_JERICO);
      return jericoVariant(stage);
    }
    if (OMART_NPC_IDS.has(npcId)) {
      // Crossing is an action at the end of the menu, not on opening it.
      return omartVariant(stage);
    }
    if (KILRON_NPC_IDS.has(npcId)) {
      if (stage < STAGE_CLIMBED_LADDER) return null;
      return "infiltrating-the-mourner-hq-talking-to-kilron";
    }
    if (KING_LATHAS_NPC_IDS.has(npcId)) return kingLathasVariant(stage);
    if (npcId === CHEMIST_NPC_ID) {
      // Regicide reuses the Rimmington chemist for bomb-making; let it own him
      // once that quest has started.
      if ((Number(player.getAttribute("quest.regicide.stage")) || 0) >= 1) return null;
      if (stage < STAGE_GIVEN_DISTILLATOR) return null;
      if (stage === STAGE_GIVEN_DISTILLATOR) {
        quest.setStage(player, STAGE_SPOKEN_TO_CHEMIST);
        return "visiting-the-chemist-house-in-rimmington-talking-to-chemist";
      }
      return "visiting-the-chemist-house-in-rimmington-talking-to-the-chemist-again";
    }
    if (npcId === JULIE_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return "return-to-ardougne-talking-to-julie-after-finishing-the-quest";
      if (stage >= STAGE_FOUND_SECRET) return "visiting-south-east-varrock-talking-to-julie-after-talking-to-guido";
      if (stage >= STAGE_SPOKEN_TO_CHEMIST) {
        return wearingPriestGown(player)
          ? "visiting-south-east-varrock-talking-to-julie-while-wearing-priest-gown-top-and-bottom"
          : "visiting-south-east-varrock-talking-to-julie-after-talking-to-the-chemist";
      }
      return "visiting-south-east-varrock-talking-to-julie-before-talking-to-the-chemist";
    }
    if (npcId === GUIDOR_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return "return-to-ardougne-talking-to-guidor-after-finishing-the-quest";
      if (stage >= STAGE_FOUND_SECRET) return "visiting-south-east-varrock-talking-to-guidor-again";
      if (stage < STAGE_SPOKEN_TO_CHEMIST) return null;
      if (!wearingPriestGown(player)) return null;
      return "visiting-south-east-varrock-talking-to-guidor";
    }
    if (npcId === ASYFF_NPC_ID) {
      if (stage < STAGE_SPOKEN_TO_CHEMIST || stage >= STAGE_FOUND_SECRET) return null;
      // Asyff is shared with Eagles' Peak. While its eagle costume (or a
      // spare) is still outstanding, that quest's own conversation answers so
      // the other route is not blocked.
      if (EAGLES_PEAK_COSTUME_STAGES.has(eaglesPeakStage(player))) return null;
      return Number(player.getAttribute(FREE_GOWN_ATTRIBUTE)) === 1
        ? null
        : "visiting-south-east-varrock-talking-to-asyff";
    }
    if (npcId === NURSE_SARAH_NPC_ID) {
      return stage >= STAGE_CLIMBED_LADDER ? "infiltrating-the-mourner-hq-talking-to-nurse-sarah" : null;
    }
    if (RIMMINGTON_COURIERS.has(npcId)) {
      return rimmingtonCourierVariant(stage, player, RIMMINGTON_COURIERS.get(npcId));
    }
    if (VARROCK_COURIERS.has(npcId)) {
      return varrockCourierVariant(stage, player, VARROCK_COURIERS.get(npcId));
    }
    if (MOURNER_NPC_IDS.has(npcId)) {
      if (stage < STAGE_CLIMBED_LADDER) return null;
      if (stage === STAGE_POISONED_STEW) {
        return "infiltrating-the-mourner-hq-talking-to-mourner-outside-mourner-headquarters-after-poisoning-the-stew";
      }
      return "infiltrating-the-mourner-hq-talking-to-mourner-outside-mourner-headquarters";
    }
    if (CAMP_GUARD_NPC_IDS.has(npcId)) {
      // The camp is King Lathas' reward for exposing the plague hoax, so the
      // guards use the imported refusal until Biohazard is complete.
      if (!quest.isComplete(player)) return "standard-dialogue-attempting-to-enter-the-camp-before-biohazard";
      return null;
    }
    return null;
  }

  function answerCondition({ player, text, stepId, pages }) {
    if (!pages?.some(({ page }) => page === "Biohazard")) return null;
    const value = String(text).toLowerCase();
    const inventory = player.getInventory();
    if (value.includes("no inventory space")) {
      // uk2LGd guards Elena's multi-item replacement; a partially free bag is
      // still too small when it cannot hold every missing sample/vial.
      if (stepId === "uk2LGd") return freeSlots(player) < elenaMissingItems(player).length;
      return inventory.isFull();
    }
    if (value.includes("already has bird feed")) return held(player, BIRD_FEED_ITEM_ID);
    if (value.includes("is not wearing a gas mask")) return !wearingGasMask(player);
    if (value.includes("not yet poisoned the stew or already has a medical gown")) {
      return quest.getStage(player) !== STAGE_POISONED_STEW || held(player, MEDICAL_GOWN_ITEM_ID);
    }
    // The Lost Tribe's chest uses the same "has the key" prose; only answer the
    // key conditions on this quest's own step ids.
    if (value.includes("has the key") || value.includes("does not have the key")) {
      if (!BIOHAZARD_KEY_CONDITION_IDS.has(stepId)) return null;
      const hasKey = held(player, MOURNER_KEY_ITEM_ID);
      return value.includes("does not have") ? !hasKey : hasKey;
    }
    if (value.includes("already has the distillator")) return held(player, DISTILLATOR_ITEM_ID);
    if (value.includes("has all the items")) return hasElenaLoan(player);
    if (value.includes("missing items")) return !hasElenaLoan(player);
    if (value.includes("still has the touch paper")) return held(player, TOUCH_PAPER_ITEM_ID);
    if (value.includes("does not have the touch paper")) return !held(player, TOUCH_PAPER_ITEM_ID);
    if (value.includes("does not have ethenea")) return !held(player, ETHENEA_ITEM_ID);
    if (value.includes("has ethenea")) return held(player, ETHENEA_ITEM_ID);
    if (value.includes("does not have liquid honey")) return !held(player, LIQUID_HONEY_ITEM_ID);
    if (value.includes("has liquid honey")) return held(player, LIQUID_HONEY_ITEM_ID);
    if (value.includes("does not have sulphuric broline")) return !held(player, SULPHURIC_BROLINE_ITEM_ID);
    if (value.includes("has sulphuric broline")) return held(player, SULPHURIC_BROLINE_ITEM_ID);
    if (value.includes("does not have all three vials")) return !hasAllVials(player);
    if (value.includes("does not have touch paper")) return !held(player, TOUCH_PAPER_ITEM_ID);
    if (value.includes("does not have the plague sample")) return !held(player, PLAGUE_SAMPLE_ITEM_ID);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!ELENA_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (!plagueCityComplete(player)) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  function handleGuidorLine({ player, npcId, text, pages }) {
    if (npcId !== GUIDOR_NPC_ID) return;
    if (!pages?.some(({ page }) => page === "Biohazard")) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_SPOKEN_TO_CHEMIST || stage >= STAGE_FOUND_SECRET) return;
    if (!wearingPriestGown(player) || !hasAllItems(player)) return;
    const value = String(text ?? "").toLowerCase();
    if (value.includes("this result can only mean one thing") && value.includes("there is no plague")) {
      for (const itemId of [PLAGUE_SAMPLE_ITEM_ID, ETHENEA_ITEM_ID, LIQUID_HONEY_ITEM_ID,
        SULPHURIC_BROLINE_ITEM_ID, TOUCH_PAPER_ITEM_ID]) {
        player.getInventory().deleteNumber(itemId, 1);
      }
      quest.setStage(player, STAGE_FOUND_SECRET);
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId, text } = event;
    if (!player) return;
    if (stepId === COMPLETE_ACTION_ID && KING_LATHAS_NPC_IDS.has(npcId)) {
      if (quest.getStage(player) >= STAGE_REPORTED_TO_ELENA && !quest.isComplete(player)) {
        quest.complete(player);
      }
      return;
    }
    if (OMART_NPC_IDS.has(npcId) && (stepId === "v1MvBF" || stepId === "3Xl8ZM")) {
      const stage = quest.getStage(player);
      if (stage === STAGE_RELEASED_PIGEONS) quest.setStage(player, STAGE_CLIMBED_LADDER);
      player.moveTo(WEST_ARDOUGNE_LANDING);
      return;
    }
    if (KILRON_NPC_IDS.has(npcId) && stepId === "PIRzeQ") {
      player.moveTo(EAST_ARDOUGNE_LANDING);
      return;
    }
    if (ELENA_NPC_IDS.has(npcId) && stepId === "Vpxjql") {
      // On success leave the canonical message unhandled so NpcDialogues renders
      // it once. On a capacity failure use Elena's imported capacity refusal and
      // stop the branch.
      if (!giveMissingItems(player, [PLAGUE_SAMPLE_ITEM_ID, ETHENEA_ITEM_ID, LIQUID_HONEY_ITEM_ID, SULPHURIC_BROLINE_ITEM_ID], ELENA_CAPACITY_MESSAGE)) {
        event.handled = true;
        event.end = true;
      }
      return;
    }
    if (ELENA_NPC_IDS.has(npcId) && stepId === "iL_fQb") {
      const missing = elenaMissingItems(player);
      if (!missing.length) {
        // The transcript's has-all-items branch owns this case.
        clearResolvedFailedReservations(player);
        event.handled = true;
        event.end = true;
        return;
      }
      if (!giveMissingItems(player, missing, ELENA_CAPACITY_MESSAGE)) {
        event.handled = true;
        event.end = true;
        return;
      }
      clearResolvedFailedReservations(player);
      return;
    }
    if (npcId === CHEMIST_NPC_ID && (stepId === "CQkuOd" || stepId === "9S8xcG")) {
      if (!giveMissingItems(player, [TOUCH_PAPER_ITEM_ID])) {
        event.handled = true;
        event.end = true;
      }
      return;
    }
    if (npcId === ASYFF_NPC_ID && stepId === "K6WP1U") {
      if (!givePriestGown(player)) {
        event.handled = true;
        event.end = true;
      }
      return;
    }
    const guardVial = GUARD_VIAL_MESSAGE_IDS.get(stepId);
    if (npcId === GUARD_NPC_ID && guardVial) {
      if (held(player, guardVial)) player.getInventory().deleteNumber(guardVial, 1);
      return;
    }
    if (stepId === "dzf0rc" || stepId === "D3bNsS") {
      event.handled = true;
      // One payment per failed courier transaction: the wrong vial that courier
      // swallowed. A later failed hand-over is a new transaction and pays again.
      const role = VARROCK_COURIERS.get(npcId)?.role ?? "chancy";
      const transaction = `${role}:${givenVials(player).get(role) ?? 0}`;
      const refunds = refundedTransactions(player);
      if (refunds.has(transaction)) return;
      if (giveCoins(player, 10)) {
        refunds.add(transaction);
        saveRefundedTransactions(player, refunds);
        player.sendMessage("You receive 10 coins.");
      }
      return;
    }
    const rimmington = RIMMINGTON_COURIERS.get(npcId);
    if (rimmington && /you give him the vial of/i.test(String(text ?? ""))) {
      const vial = vialFromText(text);
      if (vial && held(player, vial)) {
        player.getInventory().deleteNumber(vial, 1);
        const given = givenVials(player);
        given.set(rimmington.role, vial);
        saveGivenVials(player, given);
      }
      return;
    }
    const varrock = VARROCK_COURIERS.get(npcId);
    if (varrock && /he gives you the vial of/i.test(String(text ?? ""))) {
      const vial = vialFromText(text);
      const given = givenVials(player);
      if (vial && given.get(varrock.role) === vial && freeSlots(player) > 0) {
        player.getInventory().adds(vial, 1);
        given.delete(varrock.role);
        saveGivenVials(player, given);
      }
    }
  }

  function openCupboard(event) {
    const { objectId, object } = event;
    if (objectId === JERICO_CUPBOARD_CLOSED_ID) {
      event.handled = true;
      replaceObject(object, JERICO_CUPBOARD_OPEN_ID);
      return true;
    }
    if (objectId === SARAH_CUPBOARD_CLOSED_ID) {
      event.handled = true;
      replaceObject(object, SARAH_CUPBOARD_OPEN_ID);
      return true;
    }
    return false;
  }

  function shutCupboard(event) {
    const { objectId, object } = event;
    if (objectId === JERICO_CUPBOARD_OPEN_ID) {
      event.handled = true;
      replaceObject(object, JERICO_CUPBOARD_CLOSED_ID);
      return true;
    }
    if (objectId === SARAH_CUPBOARD_OPEN_ID) {
      event.handled = true;
      replaceObject(object, SARAH_CUPBOARD_CLOSED_ID);
      return true;
    }
    return false;
  }

  function searchCupboard(event) {
    const { player, objectId } = event;
    if (objectId === JERICO_CUPBOARD_OPEN_ID) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_SPOKEN_TO_JERICO) {
        player.sendMessage("The cupboard is full of bird feed.");
        return true;
      }
      if (held(player, BIRD_FEED_ITEM_ID)) {
        player.sendMessage("I don't need any more bird feed.");
        return true;
      }
      if (freeSlots(player) < 1) {
        player.sendMessage("You find some bird feed in the cupboard but you don't have enough room to take it.");
        return true;
      }
      player.getInventory().adds(BIRD_FEED_ITEM_ID, 1);
      player.sendMessage("The cupboard is full of bird feed.");
      return true;
    }
    if (objectId === SARAH_CUPBOARD_OPEN_ID) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_POISONED_STEW || held(player, MEDICAL_GOWN_ITEM_ID)) {
        player.sendMessage("You search the cupboard but you find nothing of interest.");
        return true;
      }
      if (freeSlots(player) < 1) {
        player.sendMessage("You find a medical gown in the cupboard but you don't have enough room to take it.");
        return true;
      }
      player.getInventory().adds(MEDICAL_GOWN_ITEM_ID, 1);
      player.sendMessage("You find a medical gown in the cupboard.");
      return true;
    }
    return false;
  }

  function investigateWatchtower(event) {
    if (event.objectId !== WATCHTOWER_OBJECT_ID) return false;
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_SPOKEN_TO_JERICO) return true;
    if (!held(player, BIRD_FEED_ITEM_ID) || !held(player, PIGEON_CAGE_ITEM_ID)) {
      player.sendMessage("You need bird feed and a pigeon cage to distract the watchtower.");
      return true;
    }
    player.getInventory().deleteNumber(BIRD_FEED_ITEM_ID, 1);
    quest.setStage(player, STAGE_USED_BIRD_FEED);
    player.sendMessage("You throw a handful of seeds onto the watchtower. The mourners do not seem to notice.");
    return true;
  }

  function openPigeonCage(event) {
    const { player, itemId } = event;
    if (itemId !== PIGEON_CAGE_ITEM_ID) return false;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_USED_BIRD_FEED || !nearWatchtower(player)) {
      player.sendMessage("The pigeons don't want to leave.");
      return true;
    }
    player.getInventory().deleteNumber(PIGEON_CAGE_ITEM_ID, 1);
    if (player.getInventory().getAmount(PIGEON_CAGE_EMPTY_ITEM_ID) === 0) {
      player.getInventory().adds(PIGEON_CAGE_EMPTY_ITEM_ID, 1);
    }
    quest.setStage(player, STAGE_RELEASED_PIGEONS);
    player.sendMessage("The pigeons fly towards the watchtower. The mourners frantically try to scare them away.");
    return true;
  }

  function squeezeFence(event) {
    if (event.objectId !== MOURNER_FENCE_OBJECT_ID || !event.location) return false;
    const x = event.location.getX?.() ?? event.location.x;
    const y = event.location.getY?.() ?? event.location.y;
    const z = event.location.getZ?.() ?? event.location.z;
    if (x !== 2541 || y !== 3331 || z !== 0) return false;
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) < STAGE_CLIMBED_LADDER) {
      player.sendMessage("You have no reason to enter the Mourner HQ yard yet.");
      return true;
    }
    const inside = inMournerYard(player.getLocation?.());
    player.moveTo(new Location(inside ? 2540 : 2542, 3331, 0));
    return true;
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (itemId !== ROTTEN_APPLE_ITEM_ID || objectId !== CAULDRON_OBJECT_ID) return;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_CLIMBED_LADDER) return;
    if (!held(player, ROTTEN_APPLE_ITEM_ID)) return;
    player.getInventory().deleteNumber(ROTTEN_APPLE_ITEM_ID, 1);
    quest.setStage(player, STAGE_POISONED_STEW);
    player.sendMessage("You place the rotten apple in the pot. It quickly dissolves into the stew.");
  }

  function openMournerDoor(event) {
    const { player, objectId, location } = event;
    if (objectId !== MOURNER_HQ_DOOR_ID || !location) return false;
    const z = location.getZ?.() ?? location.z;
    if (z !== 0) return false;
    if (quest.getStage(player) < STAGE_POISONED_STEW) {
      event.handled = true;
      player.sendMessage("The mourner guards will not let you in.");
      return true;
    }
    if (!wearingMedicalGown(player)) {
      event.handled = true;
      player.sendMessage("You need to be wearing a medical gown to enter the Mourner Headquarters.");
      return true;
    }
    return false;
  }

  function openCageGate(event) {
    if (!MOURNER_CAGE_GATE_IDS.has(event.objectId)) return false;
    const { player } = event;
    if (quest.getStage(player) < STAGE_POISONED_STEW) {
      event.handled = true;
      player.sendMessage("The gate is locked.");
      return true;
    }
    if (!held(player, MOURNER_KEY_ITEM_ID)) {
      event.handled = true;
      player.sendMessage("The gate is locked. You need a key.");
      return true;
    }
    return false;
  }

  function searchMournerCrate(event) {
    if (event.objectId !== MOURNER_CRATE_ID) return false;
    const { player } = event;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage < STAGE_POISONED_STEW || stage >= STAGE_GIVEN_DISTILLATOR || held(player, DISTILLATOR_ITEM_ID)) {
      player.sendMessage("You search the crate but find nothing of interest.");
      return true;
    }
    if (freeSlots(player) < 1) {
      player.sendMessage("You search the crate and find Elena's distillator but you don't have enough room to take it.");
      return true;
    }
    player.getInventory().adds(DISTILLATOR_ITEM_ID, 1);
    if (stage === STAGE_POISONED_STEW) quest.setStage(player, STAGE_FOUND_DISTILLATOR);
    player.sendMessage("You search the crate and find Elena's distillator.");
    return true;
  }

  function openBedroomDoor(event) {
    if (event.objectId !== BEDROOM_DOOR_CLOSED_ID) return false;
    const { player, object } = event;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage < STAGE_SPOKEN_TO_CHEMIST) {
      startTranscript(api, player, JULIE_NPC_ID, "Biohazard", "visiting-south-east-varrock-entering-guidor-s-room-before-talking-to-the-chemist");
      return true;
    }
    if (!wearingPriestGown(player)) {
      startTranscript(api, player, JULIE_NPC_ID, "Julie", "opening-bedroom-door-without-priest-gown-equipped");
      return true;
    }
    // Guidor's own entry conversation, then the door opens. In the priest gown
    // Julie accepts the priest; without it she refuses.
    if (isGuidorBedroomDoor(object)) {
      startTranscript(api, player, JULIE_NPC_ID, "Biohazard", "visiting-south-east-varrock-talking-to-julie-while-wearing-priest-gown-top-and-bottom");
    }
    // Open leaf swings one quarter turn from the closed wall face; copying the
    // closed face leaves the doorway clipped on its west->east approach.
    replaceObject(object, BEDROOM_DOOR_OPEN_ID, (object.getFace() + 1) & 3);
    return true;
  }

  function isGuidorBedroomDoor(object) {
    const location = object?.getLocation?.();
    const x = location?.getX?.() ?? location?.x;
    const y = location?.getY?.() ?? location?.y;
    return x === GUIDOR_BEDROOM_DOOR.x && y === GUIDOR_BEDROOM_DOOR.y;
  }

  function handleVarrockEnter({ player }) {
    const stage = quest.getStage(player);
    if (stage < STAGE_SPOKEN_TO_CHEMIST || stage >= STAGE_FOUND_SECRET) return;
    startTranscript(api, player, GUARD_NPC_ID, "Biohazard", "visiting-south-east-varrock-entering-south-east-varrock");
  }

  function handleVarrockExit({ player }) {
    const stage = quest.getStage(player);
    if (stage < STAGE_SPOKEN_TO_CHEMIST || stage >= STAGE_FOUND_SECRET) return;
    if (![ETHENEA_ITEM_ID, LIQUID_HONEY_ITEM_ID, SULPHURIC_BROLINE_ITEM_ID].some((itemId) => held(player, itemId))) return;
    // The canonical exit conversation, with its "Leave anyway?" choice.
    startTranscript(api, player, GUARD_NPC_ID, "Biohazard", "visiting-south-east-varrock-exiting-south-east-varrock-while-holding-the-vials");
  }

  /** The sickest mourner upstairs dies and drops the key: the canonical message. */
  function handleNpcDeath(event) {
    const { killer, npcId } = event ?? {};
    if (!killer || npcId !== SICKEST_MOURNER_NPC_ID) return;
    const stage = quest.getStage(killer);
    if (stage < STAGE_POISONED_STEW || stage >= STAGE_COMPLETE) return;
    startTranscript(api, killer, SICKEST_MOURNER_NPC_ID, "Biohazard", "infiltrating-the-mourner-hq-talking-to-sickest-mourner-upstairs-when-the-sickest-mourner-dies");
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    player.getPacketSender().sendVarbit(VARBIT_FREE_CLOTHES, Number(player.getAttribute(FREE_GOWN_ATTRIBUTE)) === 1 ? 1 : 0);
  }

  function handleBiohazardDoorToggle(event) {
    const { player, objectId, location } = event ?? {};
    if (!player) return false;
    if (ARDOUGNE_WALL_DOOR_IDS.has(objectId) && location) {
      // There are four locs in the West Ardougne gate; both id variants are used
      // on both rows. Leave every unrelated use of these cache ids untouched.
      const x = location.getX?.() ?? location.x;
      const y = location.getY?.() ?? location.y;
      const z = location.getZ?.() ?? location.z;
      if (x >= 2557 && x <= 2558 && y >= 3299 && y <= 3300 && z === 0 && !quest.isComplete(player)) {
        event.handled = true;
        player.sendMessage("The guards will not let you into West Ardougne until you have exposed the plague plot.");
        return true;
      }
    }
    // Doors.plugin owns the HQ door and cage gates; answer through its toggle
    // event so the gown/key checks run before it opens them.
    if (openMournerDoor(event)) return true;
    if (openCageGate(event)) return true;
    // The Combat Training Camp gate stays locked until Biohazard is complete.
    if (CAMP_GATE_IDS.has(objectId) && location) {
      const x = location.getX?.() ?? location.x;
      const y = location.getY?.() ?? location.y;
      const z = location.getZ?.() ?? location.z;
      if (CAMP_GATE_TILES.has(`${x},${y}`) && z === 0 && !quest.isComplete(player)) {
        event.handled = true;
        player.sendMessage(CAMP_LOCKED_MESSAGE);
        return true;
      }
    }
    return false;
  }

  quest = registerQuest(api, {
    key: "biohazard",
    name: "Biohazard",
    varpId: VARP_BIOHAZARD,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 3,
    xpRewards: [{ skillId: Skill.THIEVING.getIndex(), amount: 1250, label: "Thieving" }],
    otherRewards: [
      "Access to the Combat Training Camp",
      "Free passage through West Ardougne's gate",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(FREE_GOWN_ATTRIBUTE, 0);
  api.persistAttribute(GIVEN_VIALS_ATTRIBUTE, "");
  api.persistAttribute(CHANCY_REFUND_ATTRIBUTE, "");

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleGuidorLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("door:toggle", handleBiohazardDoorToggle);
  api.onNpcDeath(handleNpcDeath);
  api.onObjectInteraction("Cupboard", { Open: openCupboard, Search: searchCupboard, Shut: shutCupboard });
  api.onObjectInteraction("Watchtower", { Investigate: investigateWatchtower });
  api.onObjectInteraction("Fence", { "Squeeze-through": squeezeFence });
  api.onObjectInteraction("Door", { Open: openMournerDoor });
  api.onObjectInteraction("Gate", { Open: openCageGate });
  api.onObjectInteraction("Crate", { Search: searchMournerCrate });
  api.onObjectInteraction("Bedroom door", { Open: openBedroomDoor });
  api.onItemOnObject(handleItemOnObject);
  api.onItemAction("Pigeon cage", { Open: openPigeonCage });
  api.onZoneEnter(VARROCK_SOUTH_EAST_ZONE, handleVarrockEnter);
  api.onZoneExit(VARROCK_SOUTH_EAST_ZONE, handleVarrockExit);
  api.onPlayerLogin(handleLogin);
};
