/**
 * Darkness of Hallowvale: the quest's state, as live keeps it (rsprox capture of a full playthrough,
 * revision 242, the user's own recording "Darkness of Hallowvale"; docs/quests/darkness-of-hallowvale).
 *
 * - The stage is varbit 2573 `myq3_main_quest` (varp 869 bits 0-8) and takes live's values, each set
 *   by the action the capture shows (`STAGE`). 320 is complete (cache DB row 22 column 19).
 * - Everything else is a quest varbit of varps 869/870 (`VARBIT`). The cache's multilocs and multinpcs
 *   read them, so a repaired boat, a kicked floorboard or an opened push wall is per player, as on
 *   live. Their values are saved in one attribute and sent again at login.
 * - Saves from before the capture alignment kept the old plugin's stage numbers and a bit field;
 *   `migrate` maps them once (SAVE_VERSION).
 */

/** Varbit 2573 values, in live's order, with the action that sets each (capture ticks in the docs). */
const STAGE = Object.freeze({
  NOT_STARTED: 0,
  STARTED: 10, // Veliaf: the continue of "Once you're in..." (t334)
  BOAT_FIXED: 20, // the boat's repair (t436)
  CHUTE_FIXED: 30, // the chute's repair (t463); pushing the boat keeps 30 (varbits 2585 = 2, 2587 = 1)
  BOAT_RIDE: 40, // the boat map 454 opens (t514)
  ARRIVED: 50, // the jump onto the dock rock (t533)
  WHISPERED: 52, // a citizen answers "(whisper) Do you know about the Myreque?" (t603)
  INSISTED: 54, // "...Go and talk to Old Man Ral..." (t736)
  RAL_INTRODUCED: 60, // "Can you introduce me to Old Man Ral?" chosen (t773)
  ROUTE_KNOWN: 65, // Ral: "Hmph. Myreque, eh?..." (t1158)
  LATCH_UNHOOKED: 70, // the knife on the hideout wall's latch (t2729)
  IN_HIDEOUT: 80, // down the hideout trapdoor (t2748)
  VERTIDA_MESSAGE: 90, // "Vertida gives you a message." (t2939)
  MESSAGE_DELIVERED: 100, // "You hand over the message to Veliaf." (t3181)
  SENT_TO_DREZEL: 110, // Veliaf, after "What do you want me to do?" (t3190)
  DREZEL_TALKED: 120, // Drezel, before "Ivan mentioned..." (t3460; bush varbit 2591 = 1)
  WEREWOLVES_SEEN: 130, // the bush cutscene's end (t3621; 2591 = 0)
  RUNES_GIVEN: 140, // Drezel's runes (t3717)
  ROALD_REFUSED: 150, // King Roald's mercenary-protocol line (t4020)
  ROALD_TELEPORT: 160, // Roald's teleport offer (t4167)
  BACK_AT_PATERDOMUS: 170, // Aeonisig's teleport lands (t4180)
  SENT_BACK: 180, // Veliaf: "We must inform the Sanguinesti order..." (t4611)
  SAFALAAN_DESCRIBED: 190, // Vertida: "He's very distinctive..." (t5999; 2592 = 1)
  SAFALAAN_MET: 195, // Safalaan: "Ah, Veliaf! Myreque prevail!..." (t6221)
  SKETCHING: 200, // Safalaan's charcoal and papyrus (t6409)
  NORTH_SKETCHED: 210, // sketch 1 made (t6493; 2592 = 2)
  WEST_SKETCHED: 220, // sketch 2 made, in the western cutscene (t6601)
  VANSTROM_ATTACKS: 230, // past Vanstrom's "Prepare to die!" (t6677)
  SARIUS_SAVED: 240, // past Vanstrom's "I take no orders..." (t6739; 2593 = 1)
  SARIUS_TALKED: 250, // Sarius' "And now be away..." (t6776; 2593 = 0)
  FIREPLACE_OPENED: 260, // the knife on the fireplace (t7070)
  MESSAGE_SHOWN: 270, // Sarius' message shown to Safalaan (t7252; 2576 = 1)
  TAPESTRY_SLASHED: 280, // t7408 (2594 = 1)
  STATUE_KEYED: 290, // the key in the statue (t7419; 2596 = 1)
  LAB_OPENED: 300, // the laboratory door's first opening (t7426)
  SEALED_MESSAGE: 310, // Safalaan's sealed message (t7644)
  COMPLETE: 320, // the sealed message to Veliaf (t7755)
});

/** The quest's own varbits (cache gamevals), all saved per player. */
const VARBIT = Object.freeze({
  QUEST: 2573, // myq3_main_quest
  MINE_PUNISHED: 2574, // myq3_vampyre_mine_punish
  SKETCHES_GIVEN: 2575, // myq3_sketches_given
  SARIUS_MESSAGE_GIVEN: 2576, // myq3_sarius_message_given
  ELECTRIC_SHOCK: 2577, // myq3_electric_shock
  GHETTO_DOOR: 2578, // myq3_agil_ghetto_locked_door
  TOME_XP: 2579, // myq3_tome_xp
  VAMP_HASSLE: 2580, // myq3_vamp_hassle
  VAMP_CONV_STEP: 2581, // myq3_vamp_conv_step
  CHAT_VALUE: 2582, // myq3_chat_value
  IGNORE_COUNT: 2583, // myq3_ignore_count
  RUNECASE_SEARCHED: 2584, // myq3_runecase_searched
  BOAT_BROKEN: 2585, // myq3_boat_broken: 0 broken, 1 fixed, 2 pushed
  CHUTE_BROKEN: 2586, // myq3_chute_broken: 1 fixed
  SEA_BOAT_VISIBLE: 2587, // myq3_sea_boat_visible
  MINE_CART: 2588, // myq3_sang_punish_mining_cart (ores in the cart, 0-15)
  WALL_FLOORBOARDS: 2589, // myq3_wall_floorboards_down
  HIDEOUT_TRAPDOOR: 2590, // myq3_hideout_trapdoor: 1 symbol pressed, 2 open
  BUSH: 2591, // myq3_hidden_limb_bush
  SAFALAAN_VISIBLE: 2592, // myq3_safalaan_visible: 1 on the wall, 2 after the north sketch
  SARIUS_VISIBLE: 2593, // myq3_sarius_visible
  TAPESTRY: 2594, // myq3_tapestry_state
  PORTRAIT: 2595, // myq3_statue_key_painting_state: 1 slashed with the key, 2 key taken
  STATUE: 2596, // myq3_statue_state
  TABLE_TRAPDOOR: 2597, // myq3_agil_table_trapdoor: 1 found, 2 open
  LADDERTOP_WALL: 2598, // myq3_agil_laddertop_wall: 1 top taken, 2 ladder fixed
  PUSHWALL_4: 2599, // myq3_agil_4_pushwall_multi
  PUSHWALL_6: 2600, // myq3_agil_6_pushwall_multi
  PUSHWALL_24: 2601, // myq3_agil_24_pushwall_multi
});

/**
 * Varbits that are not progress: live resets them (the hideout trapdoor shuts 10 ticks after the
 * climb, the hassle state goes at logout), so they are never saved.
 */
const TRANSIENT = new Set([VARBIT.HIDEOUT_TRAPDOOR, VARBIT.VAMP_HASSLE, VARBIT.VAMP_CONV_STEP, VARBIT.CHAT_VALUE]);

const VARS_ATTRIBUTE = "darkness-of-hallowvale:varbits";
const SAVE_VERSION_ATTRIBUTE = "darkness-of-hallowvale:save-version";
const SAVE_VERSION = 1;

// The pre-capture plugin's bit field (read once by `migrate`, then cleared).
const LEGACY_BITS_ATTRIBUTE = "quest.darkness_of_hallowvale.bits";
const LEGACY_BIT = Object.freeze({
  BOAT_FIXED: 1 << 0, CHUTE_FIXED: 1 << 1, BOAT_PUSHED: 1 << 2, FLOORBOARDS: 1 << 3, TAPESTRY: 1 << 4,
  RUNECASE: 1 << 5, LATCH: 1 << 6, DOOR_UNLOCKED: 1 << 9, STATUE: 1 << 10, LADDER_TOP: 1 << 12,
  LADDER_FIXED: 1 << 13, PUSH_WALL_1: 1 << 26, PUSH_WALL_2: 1 << 27, PUSH_WALL_3: 1 << 28,
});
const LEGACY_PORTRAIT_SHIFT = 16;

/** The pre-capture plugin's stage numbers (its 310 was complete), mapped onto live's. */
function migratedStage(old) {
  if (old <= 0) return 0;
  const table = [
    [10, STAGE.STARTED], [20, STAGE.BOAT_FIXED], [30, STAGE.CHUTE_FIXED], [50, STAGE.ARRIVED], [60, STAGE.RAL_INTRODUCED],
    [65, STAGE.ROUTE_KNOWN], [70, STAGE.LATCH_UNHOOKED], [80, STAGE.IN_HIDEOUT], [90, STAGE.VERTIDA_MESSAGE],
    [100, STAGE.SENT_TO_DREZEL], [110, STAGE.DREZEL_TALKED], [120, STAGE.WEREWOLVES_SEEN], [130, STAGE.RUNES_GIVEN],
    [140, STAGE.ROALD_REFUSED], [160, STAGE.BACK_AT_PATERDOMUS], [170, STAGE.SENT_BACK], [190, STAGE.SKETCHING],
    [200, STAGE.SKETCHING], [210, STAGE.NORTH_SKETCHED], [220, STAGE.WEST_SKETCHED], [240, STAGE.SARIUS_TALKED],
    [260, STAGE.MESSAGE_SHOWN], [280, STAGE.STATUE_KEYED], [290, STAGE.LAB_OPENED], [300, STAGE.SEALED_MESSAGE],
    [310, STAGE.COMPLETE],
  ];
  let mapped = 0;
  for (const [from, to] of table) if (old >= from) mapped = to;
  return mapped;
}

/**
 * The quest varbits a stage implies: what live had set by the time the stage was reached. Used to
 * bring a migrated save (or a test's checkpoint, or a ::quest jump) in line; play itself sets each one
 * on its action.
 */
function impliedVarbits(stage) {
  const vars = {};
  const at = (value, varbit, set) => { if (stage >= value) vars[varbit] = set; };
  at(STAGE.BOAT_FIXED, VARBIT.BOAT_BROKEN, 1);
  at(STAGE.CHUTE_FIXED, VARBIT.CHUTE_BROKEN, 1);
  at(STAGE.BOAT_RIDE, VARBIT.BOAT_BROKEN, 2);
  at(STAGE.BOAT_RIDE, VARBIT.SEA_BOAT_VISIBLE, 1);
  at(STAGE.WHISPERED, VARBIT.WALL_FLOORBOARDS, 1);
  at(STAGE.LATCH_UNHOOKED, VARBIT.PUSHWALL_4, 2);
  at(STAGE.LATCH_UNHOOKED, VARBIT.PUSHWALL_6, 2);
  at(STAGE.LATCH_UNHOOKED, VARBIT.PUSHWALL_24, 2);
  at(STAGE.LATCH_UNHOOKED, VARBIT.TABLE_TRAPDOOR, 2);
  at(STAGE.LATCH_UNHOOKED, VARBIT.GHETTO_DOOR, 1);
  at(STAGE.LATCH_UNHOOKED, VARBIT.LADDERTOP_WALL, 2);
  at(STAGE.DREZEL_TALKED, VARBIT.BUSH, 1);
  at(STAGE.WEREWOLVES_SEEN, VARBIT.BUSH, 0);
  at(STAGE.SAFALAAN_DESCRIBED, VARBIT.SAFALAAN_VISIBLE, 1);
  at(STAGE.NORTH_SKETCHED, VARBIT.SAFALAAN_VISIBLE, 2);
  at(STAGE.SARIUS_SAVED, VARBIT.SARIUS_VISIBLE, 1);
  at(STAGE.SARIUS_TALKED, VARBIT.SARIUS_VISIBLE, 0);
  at(STAGE.FIREPLACE_OPENED, VARBIT.PORTRAIT, 2);
  at(STAGE.MESSAGE_SHOWN, VARBIT.SKETCHES_GIVEN, 1);
  at(STAGE.MESSAGE_SHOWN, VARBIT.SARIUS_MESSAGE_GIVEN, 1);
  at(STAGE.TAPESTRY_SLASHED, VARBIT.TAPESTRY, 1);
  at(STAGE.STATUE_KEYED, VARBIT.STATUE, 1);
  for (const key of Object.keys(vars)) if (!vars[key]) delete vars[key];
  return vars;
}

/** The old bit field's sub-states, as live's varbits (only those still meaningful at `stage`). */
function legacyVarbits(bits, stage) {
  const vars = {};
  if (bits & LEGACY_BIT.BOAT_FIXED) vars[VARBIT.BOAT_BROKEN] = 1;
  if (bits & LEGACY_BIT.CHUTE_FIXED) vars[VARBIT.CHUTE_BROKEN] = 1;
  if (bits & LEGACY_BIT.BOAT_PUSHED) {
    vars[VARBIT.BOAT_BROKEN] = 2;
    vars[VARBIT.SEA_BOAT_VISIBLE] = 1;
  }
  if (bits & LEGACY_BIT.FLOORBOARDS) vars[VARBIT.WALL_FLOORBOARDS] = 1;
  if (bits & LEGACY_BIT.PUSH_WALL_1) vars[VARBIT.PUSHWALL_4] = 2;
  if (bits & LEGACY_BIT.PUSH_WALL_2) vars[VARBIT.PUSHWALL_6] = 2;
  if (bits & LEGACY_BIT.PUSH_WALL_3) vars[VARBIT.PUSHWALL_24] = 2;
  if (bits & LEGACY_BIT.DOOR_UNLOCKED) vars[VARBIT.GHETTO_DOOR] = 1;
  if (bits & LEGACY_BIT.LADDER_FIXED) vars[VARBIT.LADDERTOP_WALL] = 2;
  else if (bits & LEGACY_BIT.LADDER_TOP) vars[VARBIT.LADDERTOP_WALL] = 1;
  if (bits & LEGACY_BIT.RUNECASE) vars[VARBIT.RUNECASE_SEARCHED] = 1;
  if (stage < STAGE.COMPLETE) {
    if (bits & LEGACY_BIT.TAPESTRY) vars[VARBIT.TAPESTRY] = 1;
    if (bits & LEGACY_BIT.STATUE) vars[VARBIT.STATUE] = 1;
    const portrait = (bits >> LEGACY_PORTRAIT_SHIFT) & 0b11;
    if (portrait) vars[VARBIT.PORTRAIT] = portrait;
  }
  return vars;
}

function createState(api, getQuest) {
  function vars(player) {
    const saved = player.getAttribute(VARS_ATTRIBUTE);
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  }

  /** Values of the transient varbits this session (never saved). */
  const transient = new WeakMap();

  /** A quest varbit's value for this player (2573 is the stage). */
  function get(player, varbit) {
    if (varbit === VARBIT.QUEST) return stage(player);
    if (TRANSIENT.has(varbit)) return transient.get(player)?.[varbit] ?? 0;
    return Number(vars(player)[varbit]) || 0;
  }

  /** Sets and sends a quest varbit (and saves it, unless live resets it). */
  function set(player, varbit, value) {
    if (varbit === VARBIT.QUEST) throw new Error("set the stage through advance/setStage");
    if (TRANSIENT.has(varbit)) {
      const current = transient.get(player) ?? {};
      current[varbit] = value | 0;
      transient.set(player, current);
    } else {
      const next = { ...vars(player) };
      if ((value | 0) === 0) delete next[varbit];
      else next[varbit] = value | 0;
      player.setAttribute(VARS_ATTRIBUTE, next);
      player.setAttribute(SAVE_VERSION_ATTRIBUTE, SAVE_VERSION);
    }
    player.getPacketSender().sendVarbit(varbit, value | 0);
  }

  function stage(player) {
    return getQuest().getStage(player);
  }

  /** Stage changes made by this module (and migrate), so `stageChanged` can tell an outside jump. */
  const ownChange = new WeakSet();

  function setStage(player, value) {
    player.setAttribute(SAVE_VERSION_ATTRIBUTE, SAVE_VERSION);
    ownChange.add(player);
    try {
      getQuest().setStage(player, value);
    } finally {
      ownChange.delete(player);
    }
    api.emitCustomEvent("darkness-of-hallowvale:stage", { player, stage: value });
  }

  /** Moves the stage forward only. Returns whether it moved. */
  function advance(player, value) {
    if (stage(player) >= value) return false;
    setStage(player, value);
    return true;
  }

  /** Whether the stage is within [minimum, maximum]. */
  function within(player, minimum, maximum = minimum) {
    const value = stage(player);
    return value >= minimum && value <= maximum;
  }

  /** Sends every saved quest varbit again (login; the stage itself goes out with the quest varps). */
  function replay(player) {
    const sender = player.getPacketSender();
    for (const [varbit, value] of Object.entries(vars(player))) sender.sendVarbit(Number(varbit), value | 0);
  }

  /** Drops the session-only varbits (logout: live's 2580 1 -> 0 at t7796). */
  function clearTransient(player) {
    transient.delete(player);
  }

  /** Brings a save from before the capture alignment onto live's stages and varbits, once. */
  function migrate(player) {
    if ((Number(player.getAttribute(SAVE_VERSION_ATTRIBUTE)) || 0) >= SAVE_VERSION) return false;
    player.setAttribute(SAVE_VERSION_ATTRIBUTE, SAVE_VERSION);
    const old = stage(player);
    const bits = Number(player.getAttribute(LEGACY_BITS_ATTRIBUTE)) || 0;
    player.setAttribute(LEGACY_BITS_ATTRIBUTE, 0);
    if (old <= 0) return false;
    const mapped = migratedStage(old);
    player.setAttribute(VARS_ATTRIBUTE, { ...impliedVarbits(mapped), ...legacyVarbits(bits, mapped), ...vars(player) });
    if (mapped !== old) {
      ownChange.add(player);
      try { getQuest().setStage(player, mapped); } finally { ownChange.delete(player); }
    }
    return true;
  }

  /**
   * "quest:stage-changed" from outside this quest's own code (the ::quest command, a quest pack's
   * completion): the varbits become what live had by that stage, so the world matches the jump.
   */
  function stageChanged({ player, key, stage: value }) {
    if (key !== getQuest()?.key || !player || ownChange.has(player)) return;
    const next = impliedVarbits(value);
    const sender = player.getPacketSender();
    for (const varbit of Object.keys(vars(player))) if (!(varbit in next)) sender.sendVarbit(Number(varbit), 0);
    player.setAttribute(SAVE_VERSION_ATTRIBUTE, SAVE_VERSION);
    player.setAttribute(VARS_ATTRIBUTE, next);
    replay(player);
  }

  /** Runs a quest-runtime call that sets the stage (complete()) as this quest's own change. */
  function own(player, fn) {
    ownChange.add(player);
    try {
      return fn();
    } finally {
      ownChange.delete(player);
    }
  }

  /** Test/checkpoint helper: a stage with the varbits live had set by then. */
  function checkpoint(player, value) {
    player.setAttribute(VARS_ATTRIBUTE, impliedVarbits(value));
    setStage(player, value);
    replay(player);
  }

  function register() {
    api.persistAttribute(VARS_ATTRIBUTE, {});
    api.persistAttribute(SAVE_VERSION_ATTRIBUTE, 0);
    api.persistAttribute(LEGACY_BITS_ATTRIBUTE, 0);
    api.onCustomEvent("quest:stage-changed", stageChanged);
  }

  return {
    STAGE, VARBIT, get, set, stage, setStage, advance, within, replay, clearTransient, migrate, checkpoint, own,
    register,
  };
}

module.exports = {
  STAGE, VARBIT, TRANSIENT, createState, impliedVarbits, migratedStage, legacyVarbits, VARS_ATTRIBUTE,
  SAVE_VERSION_ATTRIBUTE, LEGACY_BITS_ATTRIBUTE,
};
