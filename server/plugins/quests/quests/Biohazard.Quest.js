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
 *
 * Scenes, boxes, timings and ids follow a full rsprox capture of the quest
 * (20261110T121228-5ab63b4, revision 242); see docs/quests/biohazard/README.md.
 * Every object action plays the transcript's own scene, and its {{tbox}} lines
 * are message boxes (with the Wiki's item pictures) while its {{mes}} lines are
 * chat, as the capture shows.
 */
module.exports = function registerBiohazardQuest(api) {
  const {
    Skill, Equipment, Location, GameObject, ObjectManager,
    ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");
  let obstacleRunnerReady = false;

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
  /** biohazard_met_julie: set as Julie asks for a priest at Guidor's door (capture tick 1070). */
  const VARBIT_MET_JULIE = 9105;
  const ARDOUGNE_WALL_DOOR_IDS = new Set([
    ObjectIdentifiers.ARDOUGNE_WALL_DOOR,
    ObjectIdentifiers.ARDOUGNE_WALL_DOOR_2,
    // The open leaves keep their Open option, so a gate someone else opened is guarded too.
    ObjectIdentifiers.ARDOUGNE_WALL_DOOR_3,
    ObjectIdentifiers.ARDOUGNE_WALL_DOOR_4,
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
  const MOURNER_HQ = { minX: 2542, maxX: 2557, minY: 3321, maxY: 3327 };
  const HQ_BACK_DOOR = { x: 2551, y: 3328, z: 0 };
  const HQ_DOOR_MOURNER_NPC_ID = NpcIdentifiers.MOURNER_12;
  const HQ_TRAPDOOR_ID = 8783;
  const HQ_TRAPDOOR = { x: 2542, y: 3327, z: 0 };
  const SICKEST_MOURNER_ATTACK_IDS = new Set(["DQWtoR", "MoUbVk", "PmbGHX"]);

  const MOURNER_CAGE_GATE_IDS = new Set([2058, 2060]);
  const MOURNER_CRATE_ID = 2064;
  const BEDROOM_DOOR_CLOSED_ID = 2032;
  const BEDROOM_DOOR_OPEN_ID = 2033;

  const FREE_GOWN_ATTRIBUTE = "biohazard:free-gown-given";
  const MET_JULIE_ATTRIBUTE = "biohazard:met-julie";
  const GIVEN_VIALS_ATTRIBUTE = "biohazard:given-vials";
  /** Refunded wrong-vial transactions, one entry per failed courier hand-over. */
  const CHANCY_REFUND_ATTRIBUTE = "biohazard:chancy-refunds";
  // Imported Biohazard message EYYSjv from Elena's lost-items capacity branch.
  const ELENA_CAPACITY_MESSAGE = "Elena tries to give you some items but you don't have enough room for them.";

  /** Where the rope ladder drops the player: capture ticks 258 (west) and 655 (east). */
  const WEST_ARDOUGNE_LANDING = new Location(2556, 3267, 0);
  const EAST_ARDOUGNE_LANDING = new Location(2559, 3267, 0);
  /**
   * The rope ladder scene (capture ticks 254-260 and 651-657): the throw box at T, the
   * ladder (bioladder 2065) replaces both Wall locs (bioladderwall 2066, the map's own) at
   * T+1, the player faces the near ladder tile at T+2, the climb box and
   * human_reachforladder at T+3, the landing at T+4, and the walls are back with the drop box
   * at T+6, when the helper turns north. The first two boxes have no continue.
   */
  const ROPE_LADDER_OBJECT_ID = 2065;
  const LADDER_WALL_OBJECT_ID = 2066;
  const LADDER_TILES = Object.freeze([[2558, 3267, 1], [2557, 3267, 3]]);
  const LADDER_BOX_TICKS = 3;
  const CLIMB_LADDER_ANIMATION = 828; // human_reachforladder
  const NORTH_ANGLE_TILE = [0, 1];
  /** Released pigeons: three biopigeon_launch projectiles to the watchtower (capture tick 205). */
  const PIGEON_LAUNCH_SPOTANIM = 72;
  const PIGEON_FLIGHTS = Object.freeze([
    { to: [2560, 3304], start: 5, end: 126, endHeight: 500 },
    { to: [2561, 3305], start: 15, end: 146, endHeight: 480 },
    { to: [2559, 3303], start: 25, end: 106, endHeight: 520 },
  ]);
  const PIGEON_START_HEIGHT = 64;
  const PIGEON_SLOPE = 20;
  const PIGEON_PROGRESS = 10;
  /** The release box shows five ticks without a continue, then again with one (ticks 205, 210). */
  const PIGEON_BOX_TICKS = 5;
  /** The yard fence squeeze: message, regicide_tightfit and a 76-cycle exact move (ticks 304, 331). */
  const SQUEEZE_ANIMATION = 1237;
  const SQUEEZE_CYCLES = 76;
  const SQUEEZE_TICKS = 3;
  /** Cupboards (ticks 73-76, 88-89, 384-387, 411-412): human_openchest / human_closechest. */
  const OPEN_CUPBOARD_ANIMATION = 536;
  const CLOSE_CUPBOARD_ANIMATION = 535;
  const CUPBOARD_OPEN_SOUND = 58; // cupboard_open, both cupboards opening and Jerico's closing
  const NURSE_CUPBOARD_CLOSE_SOUND = 60; // door_close
  /** Captured with its full stop (ticks 270, 275); the transcript's {{mes}} line has none. */
  const GAS_MASK_MESSAGE = "You should leave your gas mask on while you're in West Ardougne.";
  /**
   * West Ardougne inside its walls. Ours: the bounds are not captured; the wall line east
   * (x 2557-2558) is the one the ladder crosses.
   */
  const WEST_ARDOUGNE = { minX: 2460, maxX: 2556, minY: 3264, maxY: 3337 };
  /** South-east Varrock's gate (2050/2051), where the guard searches the player (tick 944). */
  const SOUTH_EAST_VARROCK_GATE_IDS = new Set([2050, 2051]);
  const SOUTH_EAST_VARROCK_GATE_X = 3264;
  const SOUTH_EAST_VARROCK_GATE_YS = new Set([3405, 3406]);
  const WATCHTOWER_TILE = { x: 2562, y: 3301 };
  const MOURNER_YARD = { minX: 2542, maxX: 2555, minY: 3328, maxY: 3333 };


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
    // Every coin must fit: a stack near the cap, or one with other metadata and no free slot, kept part or none.
    if (inventory.getAddableAmount(new api.core.Item(COINS_ITEM_ID, amount)) < amount) {
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

  /**
   * The transcript's {{mes}} lines, sent as chat; every other Biohazard message step is a
   * {{tbox}} and shows as a message box (capture: 229 messagebox, 193 objectbox, 11 double).
   */
  const CHAT_MESSAGE_IDS = new Set(["ObjHDu", "GvIvgu", "pJP40N", "Nidx7g", "qBP3ae", "m1Ysdw"]);
  /** The item pictures the Wiki's boxes carry (and the capture's if_setobject), by step id. */
  const BOX_ITEMS = new Map([
    ["4g3EY1", [ItemIdentifiers.SPADE]],
    ["tahENM", [BIRD_FEED_ITEM_ID]],
    ["MfnHaX", [BIRD_FEED_ITEM_ID]],
    ["s19b5i", [MEDICAL_GOWN_ITEM_ID]],
    ["sjfA7d", [MEDICAL_GOWN_ITEM_ID]],
    ["MDhZ7U", [MOURNER_KEY_ITEM_ID]],
    ["I3WJuP", [DISTILLATOR_ITEM_ID]],
    ["A6Q5pT", [DISTILLATOR_ITEM_ID]],
    ["Vpxjql", [PLAGUE_SAMPLE_ITEM_ID, SULPHURIC_BROLINE_ITEM_ID]],
    ["EYYSjv", [PLAGUE_SAMPLE_ITEM_ID, SULPHURIC_BROLINE_ITEM_ID]],
    ["iL_fQb", [PLAGUE_SAMPLE_ITEM_ID, SULPHURIC_BROLINE_ITEM_ID]],
    ["CQkuOd", [TOUCH_PAPER_ITEM_ID]],
    ["9S8xcG", [TOUCH_PAPER_ITEM_ID]],
    ["K6WP1U", [PRIEST_GOWN_TOP_ITEM_ID]],
  ]);
  /** Boxes shown without a continue while the scene plays (see the ladder and pigeon notes). */
  const HELD_BOXES = new Map([
    ["NoNFvc", { holdTicks: PIGEON_BOX_TICKS }],
    ...["9oMhpG", "vosgpt", "ROff35", "Op62O1", "FlwWvG", "jQrUuy"]
      .map((id) => [id, { holdTicks: LADDER_BOX_TICKS, advance: true }]),
  ]);

  function messageBox(stepId, text) {
    if (CHAT_MESSAGE_IDS.has(stepId)) return null;
    const items = BOX_ITEMS.get(stepId);
    if (items) return { items };
    // A courier's or the guard's vial ("You give him / He takes / He gives you the vial of ...").
    const vial = /the vial of/i.test(String(text ?? "")) ? vialFromText(text) : null;
    if (vial) return { items: [vial] };
    return { statement: true, ...(HELD_BOXES.get(stepId) ?? {}) };
  }

  function later(player, ticks, action) {
    api.core.TaskManager.submit(new api.core.CountdownTask(player, ticks, action));
  }

  function sendSound(player, soundId) {
    player.getPacketSender().sendSoundEffect(soundId, 1, 0);
  }

  function animate(player, animationId) {
    player.performAnimation(new api.core.Animation(animationId));
  }

  /** The rope ladder over the wall, or the two Wall locs it replaces. */
  function showRopeLadder(shown) {
    const [from, to] = shown ? [LADDER_WALL_OBJECT_ID, ROPE_LADDER_OBJECT_ID] : [ROPE_LADDER_OBJECT_ID, LADDER_WALL_OBJECT_ID];
    for (const [x, y, face] of LADDER_TILES) {
      const location = new Location(x, y, 0);
      const current = api.core.MapObjects.get(from, location);
      if (!current) continue;
      ObjectManager.deregister(current, true);
      ObjectManager.register(new GameObject(to, new Location(x, y, 0), 10, face, null), true);
    }
  }

  /** "... throws a rope ladder over the wall.": the ladder goes up and the player looks at it. */
  function throwRopeLadder(player, westbound) {
    later(player, 1, () => showRopeLadder(true));
    const [x, y] = westbound ? LADDER_TILES[0] : LADDER_TILES[1];
    later(player, 2, () => player.setPositionToFace(new Location(x, y, 0)));
    // The drop box puts the walls back; an interrupted scene must not leave the ladder up.
    later(player, LADDER_BOX_TICKS * 2, () => showRopeLadder(false));
  }

  /** "You climb up the rope ladder...": the climb, and the landing a tick later. */
  function climbRopeLadder(player, westbound) {
    animate(player, CLIMB_LADDER_ANIMATION);
    later(player, 1, () => {
      // Omart's first crossing counts once the player lands (the varp moves with the landing).
      if (westbound && quest.getStage(player) === STAGE_RELEASED_PIGEONS) quest.setStage(player, STAGE_CLIMBED_LADDER);
      player.moveTo(westbound ? WEST_ARDOUGNE_LANDING : EAST_ARDOUGNE_LANDING);
    });
  }

  /** "...and drop down on the other side.": the walls are back and the helper turns north. */
  function dropDownFromLadder(npc) {
    showRopeLadder(false);
    const at = npc?.getLocation?.();
    if (at) npc.setPositionToFace(new Location(at.getX() + NORTH_ANGLE_TILE[0], at.getY() + NORTH_ANGLE_TILE[1], at.getZ()));
  }

  const LADDER_THROWS = new Map([["9oMhpG", true], ["ROff35", true], ["FlwWvG", false]]);
  const LADDER_CLIMBS = new Map([["vosgpt", true], ["Op62O1", true], ["jQrUuy", false]]);
  const LADDER_DROPS = new Set(["v1MvBF", "3Xl8ZM", "PIRzeQ"]);

  /** Jerico's pigeons fly at the watchtower, seen by everyone nearby. */
  function launchPigeons(player) {
    const from = player.getLocation().clone();
    for (const flight of PIGEON_FLIGHTS) {
      const to = new Location(flight.to[0], flight.to[1], from.getZ());
      new api.core.Projectile(from, to, null, PIGEON_LAUNCH_SPOTANIM, flight.start, flight.end,
        PIGEON_START_HEIGHT / 4, flight.endHeight / 4, player.getPrivateArea?.() ?? null)
        .withAngle(PIGEON_SLOPE).withProgress(PIGEON_PROGRESS).sendProjectile();
    }
  }

  function inWestArdougne(player) {
    const at = player.getLocation();
    return at.getZ() === 0 && at.getX() >= WEST_ARDOUGNE.minX && at.getX() <= WEST_ARDOUGNE.maxX
      && at.getY() >= WEST_ARDOUGNE.minY && at.getY() <= WEST_ARDOUGNE.maxY;
  }

  function inMournerHq(player) {
    const at = player.getLocation();
    return at.getZ() <= 1 && at.getX() >= MOURNER_HQ.minX && at.getX() <= MOURNER_HQ.maxX
      && at.getY() >= MOURNER_HQ.minY && at.getY() <= MOURNER_HQ.maxY;
  }

  function inMournerYard(location) {
    const x = location?.getX?.() ?? location?.x ?? 0;
    const y = location?.getY?.() ?? location?.y ?? 0;
    return x >= MOURNER_YARD.minX && x <= MOURNER_YARD.maxX && y >= MOURNER_YARD.minY && y <= MOURNER_YARD.maxY;
  }

  function nearWatchtower(player) {
    const location = player.getLocation?.();
    if (!location || (location.getZ?.() ?? location.z ?? 0) !== 0) return false;
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
    return ["I can start this quest by talking to <col=800000>Elena</col> in her house in <col=800000>East Ardougne</col>."];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.THIEVING, 1250);
    // The cage key leaves the backpack as the quest completes (tick 1241).
    const keys = player.getInventory().getAmount(MOURNER_KEY_ITEM_ID);
    if (keys > 0) player.getInventory().deleteNumber(MOURNER_KEY_ITEM_ID, keys);
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
      // She takes it as she hands out the sample and vials (Vpxjql, capture tick 723).
      return held(player, DISTILLATOR_ITEM_ID)
        ? "delivering-the-samples-talking-to-elena-with-the-distillator"
        : "infiltrating-the-mourner-hq-talking-to-elena-without-the-distillator";
    }
    // Before the wall is crossed she points to Jerico (captured at stage 1, tick 29). Ours: the
    // same reminder until the crossing, as no capture covers stages 2-4.
    if (stage >= STAGE_STARTED && stage < STAGE_CLIMBED_LADDER) return "getting-started-talking-to-elena-again";
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
    if (npcId === SICKEST_MOURNER_NPC_ID) {
      if (stage < STAGE_POISONED_STEW) return null;
      return held(player, MOURNER_KEY_ITEM_ID) || stage >= STAGE_FOUND_DISTILLATOR
        ? "infiltrating-the-mourner-hq-talking-to-sickest-mourner-upstairs-talking-to-sickest-mourner-again-while-holding-the-key"
        : "infiltrating-the-mourner-hq-talking-to-sickest-mourner-upstairs";
    }
    if (MOURNER_NPC_IDS.has(npcId)) {
      if (stage < STAGE_CLIMBED_LADDER) return null;
      const at = player.getLocation();
      const inside = at.getZ() <= 1 && at.getX() >= MOURNER_HQ.minX && at.getX() <= MOURNER_HQ.maxX
        && at.getY() >= MOURNER_HQ.minY && at.getY() <= MOURNER_HQ.maxY;
      if (stage >= STAGE_POISONED_STEW && inside) {
        return stage >= STAGE_FOUND_DISTILLATOR || held(player, DISTILLATOR_ITEM_ID)
          ? "infiltrating-the-mourner-hq-talking-to-mourner-inside-mourner-headquarters-after-getting-distillator"
          : "infiltrating-the-mourner-hq-talking-to-mourner-inside-mourner-headquarters";
      }
      if (stage === STAGE_POISONED_STEW && wearingMedicalGown(player)) {
        return "infiltrating-the-mourner-hq-talking-to-mourner-outside-mourner-headquarters-while-wearing-gown";
      }
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
    // The pigeon cage's two branches, then the feed's (getting-started-opening-pigeon-cage,
    // getting-started-throwing-bird-feed).
    if (value.includes("in the wrong place or has not thrown the bird feed")) {
      return quest.getStage(player) !== STAGE_USED_BIRD_FEED || !nearWatchtower(player);
    }
    if (value.includes("has thrown the bird feed and is near the watchtower fence")) {
      return quest.getStage(player) === STAGE_USED_BIRD_FEED && nearWatchtower(player);
    }
    if (value.includes("is not near the watchtower fence")) return !nearWatchtower(player);
    if (value.includes("is near the fence")) return nearWatchtower(player);
    if (value.includes("is not wearing a gas mask")) return !wearingGasMask(player);
    if (value.includes("not yet poisoned the stew or already has a medical gown")) {
      // A gown lost after the stew can be found again, or the HQ would stay shut.
      return quest.getStage(player) < STAGE_POISONED_STEW || held(player, MEDICAL_GOWN_ITEM_ID);
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

  /** Lines the quest acts on: the feed, Julie's request, and the doors a conversation opens. */
  function handleLine(request) {
    const { player, text, pages } = request;
    if (!pages?.some(({ page }) => page === "Biohazard")) return;
    const value = String(text ?? "");
    if (value === "Mmm, bird feed! Now what could I do with that?") {
      // The feed arrives with the player's line, after the cupboard's box (tick 80).
      if (!held(player, BIRD_FEED_ITEM_ID) && freeSlots(player) > 0) player.getInventory().adds(BIRD_FEED_ITEM_ID, 1);
      return;
    }
    if (value === "Thank you, but I just want him to see a priest.") {
      player.setAttribute(MET_JULIE_ATTRIBUTE, 1);
      player.getPacketSender().sendVarbit(VARBIT_MET_JULIE, 1);
      return;
    }
    if (value === "You may now pass." || value === "You heard right. Head on in and see what you can do.") {
      if (pendingDoors.get(player)?.kind === "line") request.after = () => openPendingDoor(player);
      return;
    }
    handleGuidorLine(request);
  }

  function handleGuidorLine({ player, npcId, text }) {
    if (npcId !== GUIDOR_NPC_ID) return;
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
    if (!event?.player) return;
    const message = event.kind === "message" && event.pages?.some(({ page }) => page === "Biohazard");
    if (!(message && handleMessageStep(event))) handleQuestAction(event);
    if (!message || event.end || event.handled) return;
    const box = messageBox(event.stepId, event.text);
    if (box) event.box = box;
  }

  function handleQuestAction(event) {
    const { player, npcId, stepId, text } = event;
    if (npcId === SICKEST_MOURNER_NPC_ID && SICKEST_MOURNER_ATTACK_IDS.has(stepId)) {
      event.npc?.getCombat?.()?.attack(player);
      return;
    }
    if (stepId === COMPLETE_ACTION_ID && KING_LATHAS_NPC_IDS.has(npcId)) {
      if (quest.getStage(player) >= STAGE_REPORTED_TO_ELENA && !quest.isComplete(player)) {
        quest.complete(player);
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

  /**
   * Message steps the scenes act on; true when the step was one of them. The box each shows
   * is chosen afterwards (messageBox).
   */
  function handleMessageStep(event) {
    const { player, npc, npcId, stepId } = event;
    const stage = quest.getStage(player);
    const stop = () => { event.handled = true; event.end = true; return true; };
    if (LADDER_THROWS.has(stepId)) {
      throwRopeLadder(player, LADDER_THROWS.get(stepId));
      return true;
    }
    if (LADDER_CLIMBS.has(stepId)) {
      climbRopeLadder(player, LADDER_CLIMBS.get(stepId));
      return true;
    }
    if (LADDER_DROPS.has(stepId)) {
      dropDownFromLadder(npc);
      return true;
    }
    switch (stepId) {
      case "K9XBDO": // the feed lands on the watchtower
        if (stage !== STAGE_SPOKEN_TO_JERICO || !held(player, BIRD_FEED_ITEM_ID)) return stop();
        player.getInventory().deleteNumber(BIRD_FEED_ITEM_ID, 1);
        quest.setStage(player, STAGE_USED_BIRD_FEED);
        return true;
      case "NoNFvc": // the pigeons fly
        if (stage !== STAGE_USED_BIRD_FEED || !held(player, PIGEON_CAGE_ITEM_ID)) return stop();
        player.getInventory().deleteNumber(PIGEON_CAGE_ITEM_ID, 1);
        player.getInventory().adds(PIGEON_CAGE_EMPTY_ITEM_ID, 1);
        quest.setStage(player, STAGE_RELEASED_PIGEONS);
        launchPigeons(player);
        return true;
      case "fCdVDF": // the apple in the stew
        if (stage !== STAGE_CLIMBED_LADDER || !held(player, ROTTEN_APPLE_ITEM_ID)) return stop();
        player.getInventory().deleteNumber(ROTTEN_APPLE_ITEM_ID, 1);
        quest.setStage(player, STAGE_POISONED_STEW);
        return true;
      case "sjfA7d": // Nurse Sarah's cupboard
        if (freeSlots(player) < 1) return stop();
        player.getInventory().adds(MEDICAL_GOWN_ITEM_ID, 1);
        return true;
      case "A6Q5pT": // the distillator crate
        if (freeSlots(player) < 1) return stop();
        player.getInventory().adds(DISTILLATOR_ITEM_ID, 1);
        if (stage === STAGE_POISONED_STEW) quest.setStage(player, STAGE_FOUND_DISTILLATOR);
        return true;
      case "Vpxjql": { // Elena takes the distillator and hands out the sample and vials
        if (!ELENA_NPC_IDS.has(npcId)) return false;
        // The distillator left the backpack mid-conversation: nothing to test with.
        if (stage === STAGE_FOUND_DISTILLATOR && !held(player, DISTILLATOR_ITEM_ID)) return stop();
        const takes = stage === STAGE_FOUND_DISTILLATOR;
        if (takes) player.getInventory().deleteNumber(DISTILLATOR_ITEM_ID, 1);
        if (!giveMissingItems(player, [PLAGUE_SAMPLE_ITEM_ID, ETHENEA_ITEM_ID, LIQUID_HONEY_ITEM_ID, SULPHURIC_BROLINE_ITEM_ID], ELENA_CAPACITY_MESSAGE)) {
          if (takes) player.getInventory().adds(DISTILLATOR_ITEM_ID, 1);
          return stop();
        }
        if (takes) quest.setStage(player, STAGE_GIVEN_DISTILLATOR);
        return true;
      }
      default:
        return false;
    }
  }

  /**
   * Both quest cupboards: "You open the cupboard.", the reach and its sound a tick later, the
   * open loc the tick after (ticks 74-76, 385-387); closing is message, reach and sound at
   * once and the shut loc a tick later (ticks 88-89, 411-412).
   */
  function openCupboard(event) {
    const { player, objectId, object } = event;
    const openId = objectId === JERICO_CUPBOARD_CLOSED_ID ? JERICO_CUPBOARD_OPEN_ID
      : objectId === SARAH_CUPBOARD_CLOSED_ID ? SARAH_CUPBOARD_OPEN_ID : null;
    if (openId == null) return false;
    event.handled = true;
    player.sendMessage("You open the cupboard.");
    later(player, 1, () => {
      animate(player, OPEN_CUPBOARD_ANIMATION);
      sendSound(player, CUPBOARD_OPEN_SOUND);
    });
    later(player, 2, () => {
      if (api.core.MapObjects.get(objectId, object.getLocation())) replaceObject(object, openId);
    });
    return true;
  }

  function shutCupboard(event) {
    const { player, objectId, object } = event;
    const shutId = objectId === JERICO_CUPBOARD_OPEN_ID ? JERICO_CUPBOARD_CLOSED_ID
      : objectId === SARAH_CUPBOARD_OPEN_ID ? SARAH_CUPBOARD_CLOSED_ID : null;
    if (shutId == null) return false;
    event.handled = true;
    player.sendMessage("You close the cupboard.");
    animate(player, CLOSE_CUPBOARD_ANIMATION);
    sendSound(player, shutId === SARAH_CUPBOARD_CLOSED_ID ? NURSE_CUPBOARD_CLOSE_SOUND : CUPBOARD_OPEN_SOUND);
    later(player, 1, () => {
      if (api.core.MapObjects.get(objectId, object.getLocation())) replaceObject(object, shutId);
    });
    return true;
  }

  function searchCupboard(event) {
    const { player, objectId } = event;
    if (objectId === JERICO_CUPBOARD_OPEN_ID) {
      event.handled = true;
      // Ours: before Jerico has spoken of the pigeons the cupboard only shows its feed.
      const early = quest.getStage(player) < STAGE_SPOKEN_TO_JERICO;
      startTranscript(api, player, JERICO_NPC_ID, "Biohazard", "getting-started-searching-the-cupboard",
        early ? (steps) => steps.slice(0, 1) : undefined);
      return true;
    }
    if (objectId === SARAH_CUPBOARD_OPEN_ID) {
      event.handled = true;
      startTranscript(api, player, NURSE_SARAH_NPC_ID, "Biohazard", "infiltrating-the-mourner-hq-searching-cupboard-by-nurse-sarah");
      return true;
    }
    return false;
  }

  /**
   * Investigate (only at stage 2, the watchtower multiloc's one op) throws the feed, as
   * live does (tick 180); using the feed on it is the same throw. Ours: Investigate without
   * feed does nothing, as no source covers it.
   */
  function investigateWatchtower(event) {
    if (event.objectId !== WATCHTOWER_OBJECT_ID) return false;
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_SPOKEN_TO_JERICO || !held(player, BIRD_FEED_ITEM_ID)) return true;
    startTranscript(api, player, JERICO_NPC_ID, "Biohazard", "getting-started-throwing-bird-feed");
    return true;
  }

  function openPigeonCage(event) {
    const { player, itemId } = event;
    if (itemId !== PIGEON_CAGE_ITEM_ID) return false;
    event.handled = true;
    startTranscript(api, player, JERICO_NPC_ID, "Biohazard", "getting-started-opening-pigeon-cage");
    return true;
  }

  /** Ticks 304/331: the message, regicide_tightfit and a 76-cycle exact move across the fence. */
  function squeezeFence(event) {
    if (event.objectId !== MOURNER_FENCE_OBJECT_ID || !event.location) return false;
    const x = event.location.getX?.() ?? event.location.x;
    const y = event.location.getY?.() ?? event.location.y;
    const z = event.location.getZ?.() ?? event.location.z;
    if (x !== 2541 || y !== 3331 || z !== 0) return false;
    const { player } = event;
    event.handled = true;
    if (!obstacleRunnerReady) {
      ObstacleRunner.init(api);
      obstacleRunnerReady = true;
    }
    if (ObstacleRunner.isBusy(player)) return true;
    if (quest.getStage(player) < STAGE_CLIMBED_LADDER) {
      player.sendMessage("You have no reason to enter the Mourner HQ yard yet.");
      return true;
    }
    const inside = inMournerYard(player.getLocation?.());
    ObstacleRunner.run(event, [
      { msg: "You squeeze through the fence." },
      { move: [inside ? 2541 : 2542, 3331, 0], anim: SQUEEZE_ANIMATION, speed: [0, SQUEEZE_CYCLES], ticks: SQUEEZE_TICKS },
    ]);
    return true;
  }

  function inspectCauldron(event) {
    if (event.objectId !== CAULDRON_OBJECT_ID) return false;
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_CLIMBED_LADDER) return true;
    startTranscript(api, player, HQ_DOOR_MOURNER_NPC_ID, "Biohazard", held(player, ROTTEN_APPLE_ITEM_ID)
      ? "infiltrating-the-mourner-hq-using-rotten-apple-on-cauldron"
      : "infiltrating-the-mourner-hq-inspecting-cauldron");
    return true;
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    // The Wiki route uses bird feed on the watchtower fence; live Investigates it. Both play
    // the same throw, so the feed is spent once.
    if (itemId === BIRD_FEED_ITEM_ID && objectId === WATCHTOWER_OBJECT_ID) {
      investigateWatchtower(event);
      return;
    }
    if (itemId !== ROTTEN_APPLE_ITEM_ID || objectId !== CAULDRON_OBJECT_ID) return;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_CLIMBED_LADDER || !held(player, ROTTEN_APPLE_ITEM_ID)) return;
    startTranscript(api, player, HQ_DOOR_MOURNER_NPC_ID, "Biohazard", "infiltrating-the-mourner-hq-using-rotten-apple-on-cauldron");
  }

  /** Doors the quest opens once a conversation ends ("door:open" through Doors.plugin). */
  const pendingDoors = new WeakMap();
  /** A door opened for the quest, so its own door:toggle passes it to Doors. */
  const passingDoors = new WeakSet();

  function openPendingDoor(player) {
    const object = pendingDoors.get(player)?.object;
    pendingDoors.delete(player);
    if (!object || !player.isRegistered?.()) return;
    passingDoors.add(player);
    try {
      api.emitCustomEvent("door:open", { player, object, handled: false });
    } finally {
      passingDoors.delete(player);
    }
  }

  /**
   * The headquarters' front door is the mourner behind it (capture ticks 468-485): before the
   * stew he turns everyone away, after it he talks of food poisoning, and in the medical gown
   * at stage 6 he lets the "doctor" in once the conversation ends. Later, in the gown, it just
   * opens (tick 593). Leaving is never stopped.
   */
  function openMournerDoor(event) {
    const { player, objectId, location, object } = event;
    if (objectId !== MOURNER_HQ_DOOR_ID || !location) return false;
    if (passingDoors.has(player)) return false;
    const z = location.getZ?.() ?? location.z;
    if (z !== 0) return false;
    const x = location.getX?.() ?? location.x, y = location.getY?.() ?? location.y;
    if (x === HQ_BACK_DOOR.x && y === HQ_BACK_DOOR.y) {
      event.handled = true;
      const fromInside = player.getLocation().getY() < HQ_BACK_DOOR.y;
      startTranscript(api, player, HQ_DOOR_MOURNER_NPC_ID, "Biohazard", fromInside
        ? "infiltrating-the-mourner-hq-opening-back-door-of-the-mourner-headquarters-from-the-inside"
        : "infiltrating-the-mourner-hq-opening-back-door-of-the-mourner-headquarters");
      return true;
    }
    if (quest.isComplete(player) || inMournerHq(player)) return false;
    const stage = quest.getStage(player);
    if (stage >= STAGE_FOUND_DISTILLATOR && wearingMedicalGown(player)) return false;
    event.handled = true;
    let variant = "infiltrating-the-mourner-hq-talking-to-mourner-outside-mourner-headquarters";
    if (stage >= STAGE_POISONED_STEW) {
      variant = wearingMedicalGown(player)
        ? "infiltrating-the-mourner-hq-talking-to-mourner-outside-mourner-headquarters-while-wearing-gown"
        : "infiltrating-the-mourner-hq-talking-to-mourner-outside-mourner-headquarters-after-poisoning-the-stew";
    }
    if (object && wearingMedicalGown(player) && stage >= STAGE_POISONED_STEW) pendingDoors.set(player, { object, kind: "line" });
    else pendingDoors.delete(player);
    startTranscript(api, player, HQ_DOOR_MOURNER_NPC_ID, "Biohazard", variant);
    return true;
  }

  /** The upstairs cage: locked without the key; with it, going in shows its box (tick 557). */
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
    // The cage is east of the gate line (x 2551); leaving it opens silently (tick 580).
    if (player.getLocation().getX() <= 2551) {
      startTranscript(api, player, SICKEST_MOURNER_NPC_ID, "Biohazard", "infiltrating-the-mourner-hq-opening-the-gate-when-entering",
        (steps) => steps.slice(0, 1));
    }
    return false;
  }

  function searchMournerCrate(event) {
    if (event.objectId !== MOURNER_CRATE_ID) return false;
    const { player } = event;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage < STAGE_POISONED_STEW || stage >= STAGE_GIVEN_DISTILLATOR) {
      player.sendMessage("You search the crate but find nothing of interest.");
      return true;
    }
    startTranscript(api, player, SICKEST_MOURNER_NPC_ID, "Biohazard", "infiltrating-the-mourner-hq-searching-the-distillator-crate");
    return true;
  }

  /**
   * Guidor's door: before the chemist, the player's own refusal; after it Julie asks for a
   * priest (ticks 1064-1071, which set biohazard_met_julie); in both priest gown pieces it
   * opens without a word (tick 1077).
   */
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
      if (stage < STAGE_FOUND_SECRET) {
        startTranscript(api, player, JULIE_NPC_ID, "Biohazard", "visiting-south-east-varrock-entering-guidor-s-room-after-talking-to-the-chemist");
      } else {
        startTranscript(api, player, JULIE_NPC_ID, "Julie", "opening-bedroom-door-without-priest-gown-equipped");
      }
      return true;
    }
    // Open leaf swings one quarter turn from the closed wall face; copying the
    // closed face leaves the doorway clipped on its west->east approach.
    replaceObject(object, BEDROOM_DOOR_OPEN_ID, (object.getFace() + 1) & 3);
    return true;
  }

  function openHqTrapdoor(event) {
    const { player, objectId, location } = event;
    const at = location ?? event.object?.getLocation?.();
    if (objectId !== HQ_TRAPDOOR_ID || !at) return false;
    const x = at.getX?.() ?? at.x, y = at.getY?.() ?? at.y, z = at.getZ?.() ?? at.z;
    if (x !== HQ_TRAPDOOR.x || y !== HQ_TRAPDOOR.y || z !== HQ_TRAPDOOR.z) return false;
    // Only the Biohazard infiltration refuses the basement. Mourning's End Part I (which needs
    // Biohazard done) and Song of the Elves own this trapdoor afterwards.
    const stage = quest.getStage(player);
    if (stage < STAGE_POISONED_STEW || quest.isComplete(player)) return false;
    event.handled = true;
    startTranscript(api, player, HQ_DOOR_MOURNER_NPC_ID, "Biohazard",
      "infiltrating-the-mourner-hq-attempting-to-open-trapdoor-inside-mourner-headquarters");
    return true;
  }

  function atSouthEastVarrockGate(objectId, location) {
    if (!SOUTH_EAST_VARROCK_GATE_IDS.has(objectId) || !location) return false;
    const x = location.getX?.() ?? location.x, y = location.getY?.() ?? location.y, z = location.getZ?.() ?? location.z;
    return x === SOUTH_EAST_VARROCK_GATE_X && SOUTH_EAST_VARROCK_GATE_YS.has(y) && z === 0;
  }

  /**
   * South-east Varrock's gate while the vials matter (stages 12-13): going in, the guard
   * searches the player and opens it after "You may now pass." (ticks 944-959); coming out
   * with a vial, the player's warning and "Leave anyway?" (Yes opens it). Ours: the way out
   * is not captured; it uses the transcript at the same gate.
   */
  function openSouthEastVarrockGate(event) {
    const { player, objectId, location, object } = event;
    if (!atSouthEastVarrockGate(objectId, location) || passingDoors.has(player)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_SPOKEN_TO_CHEMIST || stage >= STAGE_FOUND_SECRET) return false;
    const entering = player.getLocation().getX() < SOUTH_EAST_VARROCK_GATE_X;
    if (!entering && ![ETHENEA_ITEM_ID, LIQUID_HONEY_ITEM_ID, SULPHURIC_BROLINE_ITEM_ID].some((itemId) => held(player, itemId))) return false;
    event.handled = true;
    pendingDoors.set(player, { object, kind: entering ? "line" : "choice" });
    startTranscript(api, player, GUARD_NPC_ID, "Biohazard", entering
      ? "visiting-south-east-varrock-entering-south-east-varrock"
      : "visiting-south-east-varrock-exiting-south-east-varrock-while-holding-the-vials");
    return true;
  }

  /** "Leave anyway?" at the gate: Yes walks out through it. */
  function handleChoice({ player, option, pages }) {
    if (!pages?.some(({ page }) => page === "Biohazard") || pendingDoors.get(player)?.kind !== "choice") return;
    if (option === "Yes.") openPendingDoor(player);
    else if (option === "No.") pendingDoors.delete(player);
  }

  /**
   * The sickest mourner's key goes straight into the backpack with its box (tick 543), so
   * the drop table's key (Mourner (boss): always, during the quest) is the quest's to give.
   * The Wiki: a full backpack drops it on the ground.
   */
  function keepKeyForQuest(event) {
    const { player, npcId, drops } = event ?? {};
    if (!player || npcId !== SICKEST_MOURNER_NPC_ID || !Array.isArray(drops)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_POISONED_STEW || stage >= STAGE_COMPLETE) return;
    for (let index = drops.length - 1; index >= 0; index--) {
      if (drops[index]?.itemId === MOURNER_KEY_ITEM_ID) drops.splice(index, 1);
    }
  }

  function handleNpcDeath(event) {
    const { killer, npcId, npc } = event ?? {};
    if (!killer || npcId !== SICKEST_MOURNER_NPC_ID) return;
    const stage = quest.getStage(killer);
    if (stage < STAGE_POISONED_STEW || stage >= STAGE_COMPLETE) return;
    if (freeSlots(killer) > 0) {
      killer.getInventory().adds(MOURNER_KEY_ITEM_ID, 1);
    } else {
      const at = npc?.getLocation?.() ?? killer.getLocation();
      api.getItemOnGroundManager().registerLocation(killer, new api.core.Item(MOURNER_KEY_ITEM_ID, 1), at.clone(), killer.getPrivateArea?.() ?? null);
    }
    startTranscript(api, killer, SICKEST_MOURNER_NPC_ID, "Biohazard", "infiltrating-the-mourner-hq-talking-to-sickest-mourner-upstairs-when-the-sickest-mourner-dies");
  }

  /** In West Ardougne the gas mask stays on (ticks 270, 275), and in the HQ the medical gown. */
  function keepQuestGearOn(player, slot) {
    const stage = quest.getStage(player);
    if (stage < STAGE_CLIMBED_LADDER || stage >= STAGE_COMPLETE) return true;
    if (slot === Equipment.HEAD_SLOT && wearingGasMask(player) && inWestArdougne(player)) {
      player.sendMessage(GAS_MASK_MESSAGE);
      return false;
    }
    if (slot === Equipment.BODY_SLOT && stage >= STAGE_POISONED_STEW && wearingMedicalGown(player) && inMournerHq(player)) {
      player.sendMessage("You should leave your medical gown on while you're in the Mourner Headquarters.");
      return false;
    }
    return true;
  }

  function refuseUnequip(event) {
    if (!keepQuestGearOn(event.player, event.slot)) event.allow = false;
  }

  function refuseEquipOver(event) {
    if (!keepQuestGearOn(event.player, event.slot)) event.allow = false;
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    player.getPacketSender().sendVarbit(VARBIT_FREE_CLOTHES, Number(player.getAttribute(FREE_GOWN_ATTRIBUTE)) === 1 ? 1 : 0);
    player.getPacketSender().sendVarbit(VARBIT_MET_JULIE, Number(player.getAttribute(MET_JULIE_ATTRIBUTE)) === 1 ? 1 : 0);
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
    // Doors.plugin owns the HQ door, the cage gates and south-east Varrock's gate; answer
    // through its toggle event so the quest's checks and scenes run before it opens them.
    if (openSouthEastVarrockGate(event)) return true;
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
  api.persistAttribute(MET_JULIE_ATTRIBUTE, 0);
  api.persistAttribute(GIVEN_VIALS_ATTRIBUTE, "");
  api.persistAttribute(CHANCY_REFUND_ATTRIBUTE, "");

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-drops:roll", keepKeyForQuest);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("door:toggle", handleBiohazardDoorToggle);
  api.onNpcDeath(handleNpcDeath);
  api.onObjectInteraction("Cupboard", { Open: openCupboard, Search: searchCupboard, Close: shutCupboard });
  api.onObjectInteraction("Watchtower", { Investigate: investigateWatchtower });
  api.onObjectInteraction("Cauldron", { Inspect: inspectCauldron });
  api.onObjectInteraction("Fence", { "Squeeze-through": squeezeFence });
  api.onObjectInteraction("Door", { Open: openMournerDoor });
  api.onObjectInteraction("Gate", { Open: openCageGate });
  api.onObjectInteraction("Crate", { Search: searchMournerCrate });
  api.onObjectInteraction("Bedroom door", { Open: openBedroomDoor });
  api.onObjectInteraction("Trapdoor", { Open: openHqTrapdoor });
  api.onItemOnObject(handleItemOnObject);
  api.onItemAction("Pigeon cage", { Open: openPigeonCage });
  api.onCanUnequip(refuseUnequip);
  api.onCanEquip(refuseEquipOver);
  api.onPlayerLogin(handleLogin);
};
