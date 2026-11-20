/**
 * In Aid of the Myreque: the quest's state, as live keeps it (rsprox capture of a full playthrough,
 * revision 242, the user's own recording "In Aid of the Myreque"; docs/quests/in-aid-of-the-myreque).
 *
 * - The stage is varbit 1990 `myreque_2_quest` (varp 705 bits 0-8) and takes live's values, each
 *   set by the action the capture shows (`STAGE`).
 * - Everything else is a quest varbit in varps 704-706 (`VARBIT`). The cache's multilocs and
 *   multinpcs read them, so a repaired roof, an opened trapdoor or a recruited banker is per player,
 *   as on live. Their values are saved in one attribute and sent again at login.
 * - Saves from before the capture alignment kept other stage numbers and sub-flags in attributes;
 *   `migrate` maps them once (SAVE_VERSION).
 */

/** Varbit 1990 values, in live's order, with the action that sets each (capture ticks in the docs). */
const STAGE = Object.freeze({
  NOT_STARTED: 0,
  STARTED: 20, // Veliaf: "Exactly. Head down to Burgh de Rott..."
  FLORIN_TALKED: 30, // Florin's "attempting to enter" talk
  FOOD_PLACED: 40, // food used on the chest
  TOLD_INN: 60, // Florin: "Well, there's the inn..."
  WALL_CLIMBED: 70, // first Climb-over of the inn's broken wall
  RUBBLE_MINED: 80, // pickaxe on the collapsed wall rubble
  TRAPDOOR_OPEN: 90, // trapdoor opened
  CELLAR_ENTERED: 100, // climbed down into the cellar
  CELLAR_CLEARED: 110, // last of the 15 rubble scoops
  STORE_AGREED: 140, // Aurel: "Please can you fix the roof, then the walls..."
  ROOF_FIXED: 150,
  WALL_FIXED: 160,
  CRATE_GIVEN: 165,
  STORE_STOCKED: 170, // "Aurel quickly puts the stock out around the shop."
  BOOTH_FIXED: 180,
  BANK_WALL_FIXED: 190,
  BANKER: 200, // Cornelius recruited
  FURNACE_TOLD: 205, // a citizen asks for the furnace
  FURNACE_FIXED: 210, // chimney fixed (fuel is varbit 1980 only)
  FURNACE_LIT: 220, // the Castle Drakan scene starts
  GADDERANKS: 230, // the scene's last line: the blood tithe in the store
  FIGHT: 240, // the store fight
  VELIAF_ARRIVED: 250, // Gadderanks wounded; Veliaf comes in
  JUVINATES_DEAD: 260, // juvinate_deaths reaches 3
  GADDERANKS_DEAD: 280, // "Gadderanks passes away."
  HIDEOUT_TALK: 290, // Veliaf in the Hollows: "I'll see what I can dig up."
  MEMBERS_TOLD: 300, // first of Radigad or Polmafi told
  ESCORT: 310, // Ivan: "That's right. We should get going soon."
  IVAN_DELIVERED: 315, // Ivan's thanks outside Paterdomus
  DREZEL_TALKED: 320,
  DREZEL_IVANDIS: 330,
  DREZEL_NO_INFO: 340,
  LIBRARY_KEY: 350, // Drezel's key
  LIBRARY_OPEN: 360, // the library trapdoor opened
  BOOK_FOUND: 370, // The Sleeping Seven from its bookcase
  BOOK_READ: 375,
  TOMB_ENTERED: 380,
  MOULD: 390,
  ROD_MADE: 400,
  ROD_ENCHANTED: 410,
  ROD_BLESSED: 420, // dipped in the Salve
  COMPLETE: 430, // the rod given to Veliaf (DB table 0 column 19)
});

/** The quest's own varbits (cache gamevals), all saved per player. */
const VARBIT = Object.freeze({
  QUEST: 1990, // myreque_2_quest
  FOOD_PELT: 1969, // burghvillagerfoodpelt (varp 704 bits 0-1)
  INN_WALL: 1970, // burgh_inn_colapsed_wall: multiloc 12738
  INN_TRAPDOOR: 1971, // burgh_inn_trapdoor: multiloc 12743
  INN_RUBBLE: 1972, // burgh_inn_rubble_pile: scoops done (0-15)
  PLAQUE_READ: 1973, // burgh_wall_plaque_read
  STORE_ROOF: 1974, // burgh_store_roof: multiloc 12751
  STORE_WALL: 1975, // burgh_store_wall: multiloc 12752
  BANK_BOOTH: 1977, // burgh_bank_booth_open: multiloc 12759
  BANK_WALL: 1978, // burgh_bank_wall: multiloc 12760
  BANK_TELLER: 1979, // burgh_bank_teller: multinpcs 6214/6215
  FURNACE: 1980, // burgh_furnace_fix: multiloc 12805 (1 fixed, 2 fuelled, 3 lit)
  BLOOD_TITHE: 1981, // blood_tithe_visible: multinpcs 6216-6218, 4479
  TEMPLE_TRAPDOOR: 1982, // burgh_temple_trapdoor: multiloc 12762
  TOMB_BOARDS: 1983, // ivandis_tomb_boards: multiloc 12772
  STORE_STOCKED: 1984, // burgh_store_stocked: shelves and the town's fires
  IVAN_HELM: 1986, // burgh_ivan_armour_give_helm (1989 overlays 1986-1988)
  IVAN_LEGS: 1987,
  IVAN_BODY: 1988,
  CRATE_AXES: 1991, // burgh_axes_crate (1994 overlays 1991-1993)
  CRATE_FOOD: 1992,
  CRATE_TINDERBOXES: 1993,
  GADDERANKS_CHAT: 1995, // gadderanks_blood_tithe_chat
  VILLAGER_CHAT: 1996, // villager_blood_tithe_chat
  JUVINATE_CHAT: 1997, // juve_blood_tithe_chat
  JUVINATE_DEATHS: 1999, // juvinate_deaths (the store fight; Gadderanks counts)
  AMBUSH_DEATHS: 2000, // the swamp ambush
  ROUTE_TAKEN: 2001, // juvinate_ambush_routetaken
  IVAN_SICKLE: 2003,
  WARHAMMER_GIVEN: 2004, // gadderanks_warhammer_give
  IVAN_FOOD: 2005, // burgh_ivan_food_give
  RUBBLE_MESSAGE: 2006, // burgh_rubble_bucket_message
  HIDEOUT_NPCS: 10367, // route_hideout_npcs: the Canifis hideout's multinpcs 9620-9630
  VAMPYRE_AGGRESSION: 15488, // vampyre_aggression
  TEMPLE_TREK_NPCS: 1954, // templetrek_npcs_visible (set at completion)
});

const VARS_ATTRIBUTE = "in-aid-of-the-myreque:varbits";
const SAVE_VERSION_ATTRIBUTE = "in-aid-of-the-myreque:save-version";
const SAVE_VERSION = 2;

// Attributes the pre-capture plugin kept (read once by `migrate`, then cleared).
const LEGACY = Object.freeze({
  bits: "quest.in_aid_of_the_myreque.bits",
  axes: "quest.in_aid_of_the_myreque.crate.axes",
  fish: "quest.in_aid_of_the_myreque.crate.fish",
  fishType: "quest.in_aid_of_the_myreque.crate.fishtype",
  fishTypeSet: "quest.in_aid_of_the_myreque.fishtype.set",
  tinder: "quest.in_aid_of_the_myreque.crate.tinder",
  refused: "quest.in_aid_of_the_myreque.crate.refused",
  ivanFood: "quest.in_aid_of_the_myreque.ivan.food",
  encounter: "quest.in_aid_of_the_myreque.encounter",
  fight: "quest.in_aid_of_the_myreque.fight",
});
const LEGACY_BIT = Object.freeze({ MEMBERS_INFORMED: 1 << 5, IVAN_HELM: 1 << 6, IVAN_BODY: 1 << 7, IVAN_LEGS: 1 << 8, IVAN_SICKLE: 1 << 9 });

/** The pre-capture plugin's stage numbers, mapped onto live's. */
function migratedStage(old, bits) {
  if (old <= 0) return 0;
  const table = [
    [20, STAGE.STARTED], [30, STAGE.FOOD_PLACED], [50, STAGE.TOLD_INN], [60, STAGE.RUBBLE_MINED],
    [80, STAGE.TRAPDOOR_OPEN], [100, STAGE.CELLAR_CLEARED], [120, STAGE.STORE_AGREED], [150, STAGE.ROOF_FIXED],
    [160, STAGE.WALL_FIXED], [165, STAGE.CRATE_GIVEN], [170, STAGE.STORE_STOCKED], [180, STAGE.BOOTH_FIXED],
    [190, STAGE.BANK_WALL_FIXED], [200, STAGE.BANKER], [205, STAGE.FURNACE_FIXED], [210, STAGE.FURNACE_FIXED],
    [220, STAGE.GADDERANKS], [230, STAGE.GADDERANKS], [240, STAGE.GADDERANKS], [260, STAGE.JUVINATES_DEAD],
    [280, STAGE.GADDERANKS_DEAD], [290, STAGE.GADDERANKS_DEAD],
    [300, (bits & LEGACY_BIT.MEMBERS_INFORMED) ? STAGE.MEMBERS_TOLD : STAGE.HIDEOUT_TALK],
    [310, STAGE.MEMBERS_TOLD], [320, STAGE.IVAN_DELIVERED], [350, STAGE.LIBRARY_KEY], [360, STAGE.LIBRARY_OPEN],
    [370, STAGE.BOOK_READ], [380, STAGE.BOOK_READ], [390, STAGE.MOULD], [400, STAGE.ROD_ENCHANTED],
    [410, STAGE.ROD_BLESSED], [420, STAGE.COMPLETE],
  ];
  let mapped = 0;
  for (const [from, to] of table) if (old >= from) mapped = to;
  return mapped;
}

/**
 * The quest varbits a stage implies: what live had set by the time the stage was reached. Used to
 * bring a migrated save (or a test's checkpoint) in line; play itself sets each one on its action.
 */
function impliedVarbits(stage) {
  const vars = {};
  const at = (value, varbit, set) => { if (stage >= value) vars[varbit] = set; };
  at(STAGE.RUBBLE_MINED, VARBIT.INN_WALL, 1);
  at(STAGE.TRAPDOOR_OPEN, VARBIT.INN_TRAPDOOR, 1);
  at(STAGE.CELLAR_CLEARED, VARBIT.INN_RUBBLE, 15);
  at(STAGE.CELLAR_CLEARED, VARBIT.RUBBLE_MESSAGE, 1);
  at(STAGE.ROOF_FIXED, VARBIT.STORE_ROOF, 1);
  at(STAGE.WALL_FIXED, VARBIT.STORE_WALL, 1);
  at(STAGE.STORE_STOCKED, VARBIT.STORE_STOCKED, 1);
  at(STAGE.BOOTH_FIXED, VARBIT.BANK_BOOTH, 1);
  at(STAGE.BANK_WALL_FIXED, VARBIT.BANK_WALL, 1);
  at(STAGE.BANKER, VARBIT.BANK_TELLER, 1);
  at(STAGE.FURNACE_FIXED, VARBIT.FURNACE, 1);
  at(STAGE.FURNACE_LIT, VARBIT.FURNACE, 3);
  at(STAGE.GADDERANKS, VARBIT.BLOOD_TITHE, 1);
  at(STAGE.GADDERANKS, VARBIT.VAMPYRE_AGGRESSION, 1);
  at(STAGE.FIGHT, VARBIT.GADDERANKS_CHAT, 1);
  at(STAGE.FIGHT, VARBIT.VILLAGER_CHAT, 1);
  at(STAGE.FIGHT, VARBIT.JUVINATE_CHAT, 1);
  at(STAGE.GADDERANKS_DEAD, VARBIT.BLOOD_TITHE, 2);
  at(STAGE.GADDERANKS_DEAD, VARBIT.WARHAMMER_GIVEN, 1);
  at(STAGE.HIDEOUT_TALK, VARBIT.BLOOD_TITHE, 3);
  at(STAGE.IVAN_DELIVERED, VARBIT.HIDEOUT_NPCS, 1);
  at(STAGE.IVAN_DELIVERED, VARBIT.IVAN_HELM, 1);
  at(STAGE.IVAN_DELIVERED, VARBIT.IVAN_LEGS, 1);
  at(STAGE.IVAN_DELIVERED, VARBIT.IVAN_BODY, 1);
  at(STAGE.IVAN_DELIVERED, VARBIT.IVAN_SICKLE, 1);
  at(STAGE.LIBRARY_OPEN, VARBIT.TEMPLE_TRAPDOOR, 1);
  at(STAGE.TOMB_ENTERED, VARBIT.TOMB_BOARDS, 1);
  at(STAGE.COMPLETE, VARBIT.TEMPLE_TREK_NPCS, 1);
  return vars;
}

function createState(api, getQuest) {
  function vars(player) {
    const saved = player.getAttribute(VARS_ATTRIBUTE);
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  }

  /** A quest varbit's value for this player (the saved one; 1990 is the stage). */
  function get(player, varbit) {
    if (varbit === VARBIT.QUEST) return stage(player);
    return Number(vars(player)[varbit]) || 0;
  }

  /** Sets, saves and sends a quest varbit. */
  function set(player, varbit, value) {
    if (varbit === VARBIT.QUEST) throw new Error("set the stage through advance/setStage");
    const next = { ...vars(player) };
    if ((value | 0) === 0) delete next[varbit];
    else next[varbit] = value | 0;
    player.setAttribute(VARS_ATTRIBUTE, next);
    player.getPacketSender().sendVarbit(varbit, value | 0);
    player.setAttribute(SAVE_VERSION_ATTRIBUTE, SAVE_VERSION);
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
    api.emitCustomEvent("in-aid-of-the-myreque:stage", { player, stage: value });
  }

  /** Moves the stage forward only. Returns whether it moved. */
  function advance(player, value) {
    if (stage(player) >= value) return false;
    setStage(player, value);
    return true;
  }

  /** Sends every saved quest varbit again (login; the stage itself goes out with the quest varps). */
  function replay(player) {
    const sender = player.getPacketSender();
    for (const [varbit, value] of Object.entries(vars(player))) sender.sendVarbit(Number(varbit), value | 0);
  }

  /** Brings a save from before the capture alignment onto live's stages and varbits, once. */
  function migrate(player) {
    if ((Number(player.getAttribute(SAVE_VERSION_ATTRIBUTE)) || 0) >= SAVE_VERSION) return false;
    player.setAttribute(SAVE_VERSION_ATTRIBUTE, SAVE_VERSION);
    const old = stage(player);
    if (old <= 0) return false;
    const bits = Number(player.getAttribute(LEGACY.bits)) || 0;
    let mapped = migratedStage(old, bits);
    // The old plugin stayed at 390 once the rod was crafted; live's 400 is "rod made".
    if (mapped === STAGE.MOULD && api.core.Bank.owns(player, api.core.ItemIdentifiers.SILVTHRILL_ROD_2)) mapped = STAGE.ROD_MADE;
    const next = { ...impliedVarbits(mapped), ...vars(player) };
    if (old === 210) next[VARBIT.FURNACE] = 2;
    if (old >= 290 && mapped < STAGE.HIDEOUT_TALK) next[VARBIT.BLOOD_TITHE] = 3;
    if (old >= 380 && mapped < STAGE.TOMB_ENTERED) next[VARBIT.TOMB_BOARDS] = 1;
    if (mapped === STAGE.CRATE_GIVEN) {
      const number = (key) => Number(player.getAttribute(key)) || 0;
      if (number(LEGACY.axes)) next[VARBIT.CRATE_AXES] = Math.min(10, number(LEGACY.axes));
      if (number(LEGACY.fish)) next[VARBIT.CRATE_FOOD] = Math.min(10, number(LEGACY.fish));
      if (number(LEGACY.tinder)) next[VARBIT.CRATE_TINDERBOXES] = Math.min(3, number(LEGACY.tinder));
    }
    if (mapped >= STAGE.HIDEOUT_TALK && mapped < STAGE.IVAN_DELIVERED) {
      if (bits & LEGACY_BIT.IVAN_HELM) next[VARBIT.IVAN_HELM] = 1;
      if (bits & LEGACY_BIT.IVAN_LEGS) next[VARBIT.IVAN_LEGS] = 1;
      if (bits & LEGACY_BIT.IVAN_BODY) next[VARBIT.IVAN_BODY] = 1;
      if (bits & LEGACY_BIT.IVAN_SICKLE) next[VARBIT.IVAN_SICKLE] = 1;
      const food = Number(player.getAttribute(LEGACY.ivanFood)) || 0;
      if (food) next[VARBIT.IVAN_FOOD] = Math.min(15, food);
    }
    for (const key of Object.values(LEGACY)) player.setAttribute(key, 0);
    player.setAttribute(VARS_ATTRIBUTE, next);
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
    for (const key of Object.values(LEGACY)) api.persistAttribute(key, 0);
    api.onCustomEvent("quest:stage-changed", stageChanged);
  }

  return { STAGE, VARBIT, get, set, stage, setStage, advance, replay, migrate, checkpoint, own, register };
}

module.exports = { STAGE, VARBIT, createState, impliedVarbits, migratedStage, VARS_ATTRIBUTE, SAVE_VERSION_ATTRIBUTE };
