/**
 * Blast Furnace, under Keldagrim: ore put on the conveyor belt is smelted with half the coal and
 * the bars collected from the dispenser. The dwarves work the machinery for 72,000 coins an hour
 * from the coffer while the player is in the room, and smiths under level 60 also pay the foreman
 * 2,500 coins for ten minutes. Behaviour is the OSRS Wiki's and the dwarves' transcripts; the
 * belt and dispenser timings, ore limits and messages follow Offline_Scape's port
 * (docs/blast-furnace.md lists which).
 */
const { SMELTING_RECIPES } = require("../skills/Smithing.plugin");

/** The furnace room. */
const ROOM = { minX: 1934, maxX: 1959, minY: 4955, maxY: 4976, levels: [0] };

/** The coffer HUD (interface 474) in the toplevel's overlay_hud (161:8). */
const HUD = 474;
const OVERLAY_HUD_UID = (161 << 16) | 8;
const TEMPERATURE_GAUGE_INTERFACE = 30;

/** RuneLite VarbitID: the dispenser's state drives loc 9092's multiloc (9093-9096). */
const VARBIT_DISPENSER = 936;
const VARBIT_COINS_IN_COFFER = 5356;
const VARBIT_COFFER = 5357;
const DISPENSER_EMPTY = 0;
const DISPENSER_POURING = 1;
const DISPENSER_HOT = 2;
const DISPENSER_COOL = 3;
const BAR_DISPENSER = 9092;
const BAR_DISPENSER_TILE = [1940, 4963];

/** Wiki: 72,000 coins an hour, taken while the player is in the room. */
const COFFER_PER_TICK = 12;
const FREE_SMITHING_LEVEL = 60;
const FOREMAN_FEE = 2500;
const CHARM_FEE = 1250;
const FOREMAN_PERMIT_MS = 10 * 60 * 1000;
const FOREMAN_OK_LINE = "Okay, you can use the furnace for ten minutes.";

/** The pot holds 28 ore that makes bars, 254 of coal and of tin, and 28 of each bar. */
const PRIMARY_LIMIT = 28;
const SECONDARY_LIMIT = 254;
const BAR_LIMIT = 28;

/** Ore rides the belt a tile a tick and falls into the pot. */
const BELT_START = [1942, 4966];
const BELT_TILES = 3;
const ORE_FALL_ANIMATION = 2434;
/** Bars pour for 2 ticks, then stay molten for 16 before they cool. */
const POUR_TICKS = 2;
const COOL_TICKS = 16;
const LAVA_FLOW_ANIMATION = 2440;
const THROW_WATER_ANIMATION = 2450;
const FILL_ANIMATION = 832;
const GOLDSMITH_GAUNTLETS_BONUS_XP = 33.7;

/** The machinery the dwarves keep turning: the belt, its drive belts and the cogs. */
const BELT_ANIMATION = 2435;
const GEAR_ANIMATION = 2436;
const MACHINERY = [
  [9100, [1943, 4967], BELT_ANIMATION], [9101, [1943, 4966], BELT_ANIMATION], [9101, [1943, 4965], BELT_ANIMATION],
  [9102, [1944, 4967], GEAR_ANIMATION], [9107, [1944, 4965], GEAR_ANIMATION], [9104, [1945, 4967], GEAR_ANIMATION],
  [9108, [1945, 4965], GEAR_ANIMATION], [9106, [1945, 4966], GEAR_ANIMATION],
];

/** The stairs between Keldagrim and the furnace. */
const STAIRS = new Map([[9084, [1939, 4958]], [9138, [2931, 10196]]]);
const ANVIL_GATE = 9141;
const JORZIK_GATE_VARIANT = "sometimes-when-attempting-to-open-the-gate-to-the-anvils-with-less-than-60-smithing";

/** The foreman's coin conditions that guard the Ring of Charos(a) haggle rather than the full fee. */
const CHARM_COIN_CONDITION = "NCZ97a";

const STATE_ATTRIBUTE = "blast-furnace";

let core;
let pluginApi;
let ORES = [];
let BARS = [];
const inRoom = new Set();
/** Ore on its way down the belt: { player, npc, tiles }. */
const belt = [];
/** Ticks since each player's bars started pouring. */
const pouring = new Map();

function init(api) {
  pluginApi = api;
  core = api.core;
  const Items = core.ItemIdentifiers;
  const Npcs = core.NpcIdentifiers;
  // varbit: RuneLite VarbitID.BLAST_FURNACE_*; level: the bar the ore makes.
  ORES = [
    { item: Items.COAL, npc: Npcs.COL_00FFFF_COAL_COL, varbit: 949, level: 30 },
    { item: Items.TIN_ORE, npc: Npcs.COL_00FFFF_TIN_ORE_COL, varbit: 950, level: 1 },
    { item: Items.COPPER_ORE, npc: Npcs.COL_00FFFF_COPPER_ORE_COL, varbit: 959, level: 1, primary: true },
    { item: Items.IRON_ORE, npc: Npcs.COL_00FFFF_IRON_ORE_COL, varbit: 951, level: 15, primary: true },
    { item: Items.SILVER_ORE, npc: Npcs.COL_00FFFF_SILVER_ORE_COL, varbit: 956, level: 20, primary: true },
    { item: Items.GOLD_ORE, npc: Npcs.COL_00FFFF_GOLD_ORE_COL, varbit: 955, level: 40, primary: true },
    { item: Items.MITHRIL_ORE, npc: Npcs.COL_00FFFF_MITHRIL_ORE_COL, varbit: 952, level: 50, primary: true },
    { item: Items.ADAMANTITE_ORE, npc: Npcs.COL_00FFFF_ADAMANTITE_ORE_COL, varbit: 953, level: 70, primary: true },
    { item: Items.RUNITE_ORE, npc: Npcs.COL_00FFFF_RUNITE_ORE_COL, varbit: 954, level: 85, primary: true },
  ];
  const barVarbits = new Map([
    [Items.BRONZE_BAR, 941], [Items.IRON_BAR, 942], [Items.STEEL_BAR, 943], [Items.MITHRIL_BAR, 944],
    [Items.ADAMANTITE_BAR, 945], [Items.RUNITE_BAR, 946], [Items.GOLD_BAR, 947], [Items.SILVER_BAR, 948],
  ]);
  // Half the coal of a furnace, and iron never fails. Bars needing coal smelt first, so iron
  // ore with coal in the pot becomes steel.
  BARS = SMELTING_RECIPES
    .map((recipe) => ({
      ...recipe,
      varbit: barVarbits.get(recipe.barId),
      ingredients: recipe.ingredients.map(([id, amount]) => [id, id === Items.COAL ? amount / 2 : amount]),
    }))
    .sort((a, b) => usesCoal(b) - usesCoal(a));
}

function usesCoal(bar) {
  return bar.ingredients.some(([id]) => id === core.ItemIdentifiers.COAL) ? 1 : 0;
}

// --- The player's saved furnace: coffer, ore in the pot, bars in the dispenser, foreman's permit.

function stateOf(player) {
  let state = player.getAttribute(STATE_ATTRIBUTE);
  if (!state || typeof state !== "object") {
    state = {};
    player.setAttribute(STATE_ATTRIBUTE, state);
  }
  state.coffer ??= 0;
  state.ores ??= {};
  state.bars ??= {};
  state.permitUntil ??= 0;
  return state;
}

function smithingLevel(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.SMITHING);
}

function coins(player) {
  return player.getInventory().getAmount(core.ItemIdentifiers.COINS);
}

function equipped(player, slot) {
  return player.getEquipment().getItems()[slot]?.getId?.() ?? -1;
}

function dispenserState(player) {
  return player.getPacketSender().getVarbit(VARBIT_DISPENSER);
}

function setDispenser(player, value) {
  player.getPacketSender().sendVarbit(VARBIT_DISPENSER, value);
}

function syncCoffer(player) {
  const { coffer } = stateOf(player);
  player.getPacketSender().sendVarbit(VARBIT_COFFER, coffer).sendVarbit(VARBIT_COINS_IN_COFFER, coffer > 0 ? 1 : 0);
}

function syncContents(player) {
  const state = stateOf(player);
  const sender = player.getPacketSender();
  for (const ore of ORES) sender.sendVarbit(ore.varbit, state.ores[ore.item] ?? 0);
  for (const bar of BARS) sender.sendVarbit(bar.varbit, state.bars[bar.barId] ?? 0);
}

function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

function coinsStatement(player, text) {
  const { DialogueChainBuilder, ItemStatementDialogue } = core;
  player.getDialogueManager().startDialogues(
    new DialogueChainBuilder().add(new ItemStatementDialogue(0, core.ItemIdentifiers.COINS, text)),
  );
}

/** One page per four lines, as the reference's Check dialogues. */
function listPages(player, lines) {
  const { DialogueChainBuilder, StatementDialogue } = core;
  const chain = new DialogueChainBuilder();
  for (let i = 0; i < lines.length; i += 4) chain.add(new StatementDialogue(i / 4, lines.slice(i, i + 4).join("<br>")));
  player.getDialogueManager().startDialogues(chain);
}

function itemName(id) {
  return core.ItemDefinition.forId(id).getName();
}

// --- Entering and leaving the room.

function enterRoom({ player }) {
  inRoom.add(player);
  const state = stateOf(player);
  player.getPacketSender().sendSubInterface(OVERLAY_HUD_UID, HUD, 1);
  syncCoffer(player);
  syncContents(player);
  const hasBars = Object.values(state.bars).some((count) => count > 0);
  setDispenser(player, hasBars ? DISPENSER_COOL : DISPENSER_EMPTY);
  for (const [id, [x, y], animation] of MACHINERY) {
    const loc = core.MapObjects.get(id, new core.Location(x, y, 0), null);
    if (loc) player.getPacketSender().sendObjectAnimation(loc, new core.Animation(animation));
  }
  smelt(player);
}

function leaveRoom({ player }) {
  inRoom.delete(player);
  player.getPacketSender().closeSubInterface(OVERLAY_HUD_UID);
}

function logout({ player }) {
  inRoom.delete(player);
  pouring.delete(player);
  for (const ore of belt.filter((entry) => entry.player === player)) {
    if (ore.npc) pluginApi.removeNpc(ore.npc);
    belt.splice(belt.indexOf(ore), 1);
  }
}

function stairs({ player, objectId }) {
  const to = STAIRS.get(objectId);
  if (!to) return false;
  player.moveTo(new core.Location(to[0], to[1], 0));
}

function openAnvilGate({ player, objectId }) {
  if (objectId !== ANVIL_GATE || smithingLevel(player) >= FREE_SMITHING_LEVEL) return false;
  pluginApi.emitCustomEvent("npc-dialogue:start", {
    player, npcId: core.NpcIdentifiers.JORZIK, variant: JORZIK_GATE_VARIANT, handled: false,
  });
}

// --- The coffer.

function useCoffer({ player }) {
  if (stateOf(player).coffer === 0 && coins(player) === 0) {
    coinsStatement(player, "There are no coins in the coffer or your inventory.");
    return;
  }
  pluginApi.sendMultiChatboxPrompt(player, "Select an Option",
    "Deposit coins.", () => askAmount(player, "Deposit how many coins?", depositCoins),
    "Withdraw coins.", () => askAmount(player, "Withdraw how many coins?", withdrawCoins),
    "Cancel.", () => player.getPacketSender().sendInterfaceRemoval());
}

function askAmount(player, title, then) {
  player.getPacketSender().sendInterfaceRemoval();
  player.setEnteredAmountAction({ execute: (amount) => then(player, Math.floor(Number(amount))) });
  player.getPacketSender().sendEnterAmountPrompt(title);
}

function depositCoins(player, amount) {
  const count = Math.min(amount, coins(player));
  if (!(count > 0)) return;
  player.getInventory().deleteNumber(core.ItemIdentifiers.COINS, count);
  stateOf(player).coffer += count;
  syncCoffer(player);
}

function withdrawCoins(player, amount) {
  const state = stateOf(player);
  const count = Math.min(amount, state.coffer);
  if (!(count > 0)) return;
  if (coins(player) === 0 && player.getInventory().getFreeSlots() === 0) {
    player.sendMessage("You don't have enough inventory space.");
    return;
  }
  state.coffer -= count;
  player.getInventory().addItem(new core.Item(core.ItemIdentifiers.COINS, count));
  syncCoffer(player);
}

// --- The foreman's fee, through his transcript.

function foremanCondition({ player, npcId, text, stepId }) {
  if (npcId !== core.NpcIdentifiers.BLAST_FURNACE_FOREMAN) return null;
  const level = smithingLevel(player);
  const fee = stepId === CHARM_COIN_CONDITION ? CHARM_FEE : FOREMAN_FEE;
  const answers = {
    "If the player has at least 60 Smithing:": level >= FREE_SMITHING_LEVEL,
    "If the player has less than 60 Smithing:": level < FREE_SMITHING_LEVEL,
    "If the player has fewer than 2,500 coins on them:": coins(player) < FOREMAN_FEE,
    "If the player has 2,500 or more coins on them:": coins(player) >= FOREMAN_FEE,
    "If the player does not have enough coins:": coins(player) < fee,
    "If the player is wearing the Ring of Charos(a):":
      equipped(player, core.Equipment.RING_SLOT) === core.ItemIdentifiers.RING_OF_CHAROS_A_,
    // Chromium ingots (The Giant Dwarf's sequel content) are not in this server.
    "If the player has discovered how to smith chromium ingots:": false,
  };
  return Object.hasOwn(answers, text) ? answers[text] : null;
}

/** "Okay, you can use the furnace for ten minutes." is where the fee is paid. */
function foremanPaid(request) {
  const { player, npcId, text } = request;
  if (npcId !== core.NpcIdentifiers.BLAST_FURNACE_FOREMAN || !String(text).startsWith(FOREMAN_OK_LINE)) return;
  const fee = text.includes("four humans") ? CHARM_FEE : FOREMAN_FEE;
  if (coins(player) < fee) return;
  player.getInventory().deleteNumber(core.ItemIdentifiers.COINS, fee);
  stateOf(player).permitUntil = Date.now() + FOREMAN_PERMIT_MS;
}

function payForeman({ player, npc }) {
  pluginApi.emitCustomEvent("npc-dialogue:start", {
    player, npc, npcId: core.NpcIdentifiers.BLAST_FURNACE_FOREMAN, variant: "right-click-pay-option", handled: false,
  });
}

// --- The conveyor belt and the melting pot.

function primaryTotal(state) {
  return ORES.filter((ore) => ore.primary).reduce((sum, ore) => sum + (state.ores[ore.item] ?? 0), 0);
}

/** Puts every ore the player carries (or just `onlyItemId`) on the belt, up to the pot's limits. */
function putOre(player, onlyItemId = null) {
  const state = stateOf(player);
  if (state.coffer === 0) {
    coinsStatement(player, "You must put money in the coffer to pay the workers.");
    return;
  }
  if (smithingLevel(player) < FREE_SMITHING_LEVEL && Date.now() > state.permitUntil) {
    statement(player, "You must ask the foreman's permission before using the blast furnace.");
    return;
  }
  const inventory = player.getInventory();
  const ores = ORES.filter((ore) => (onlyItemId === null || ore.item === onlyItemId) && inventory.getAmount(ore.item) > 0);
  if (!ores.length) {
    statement(player, "You don't have any suitable ores to place onto the conveyor belt.");
    return;
  }
  let moved = false;
  let overflow = false;
  for (const ore of ores) {
    if (smithingLevel(player) < ore.level) {
      player.sendMessage(`You need to have level ${ore.level} smithing to put ${itemName(ore.item).toLowerCase()} on the conveyor belt.`);
      continue;
    }
    const held = inventory.getAmount(ore.item);
    const room = ore.primary ? PRIMARY_LIMIT - primaryTotal(state) : SECONDARY_LIMIT - (state.ores[ore.item] ?? 0);
    const count = Math.min(held, room);
    if (count < held) overflow = true;
    if (count <= 0) continue;
    inventory.deleteNumber(ore.item, count);
    state.ores[ore.item] = (state.ores[ore.item] ?? 0) + count;
    const npc = pluginApi.spawnNpc({ id: ore.npc, x: BELT_START[0], y: BELT_START[1], z: 0, wanderRadius: 0 });
    npc?.setScriptedMovement?.(true);
    belt.push({ player, npc, tiles: 0 });
    moved = true;
  }
  if (overflow) {
    statement(player, "You should make sure all your ore smelts before adding any more.");
  } else if (moved) {
    player.sendMessage("All your ore goes onto the conveyor belt.");
  }
}

function putOreOnBelt({ player }) {
  putOre(player);
}

function useOreOnBelt({ player, itemId }) {
  putOre(player, itemId);
}

function checkPot({ player }) {
  const { ores } = stateOf(player);
  listPages(player, ORES.map((ore) => `${itemName(ore.item)}: ${ores[ore.item] ?? 0}`));
}

function barXp(player, bar) {
  const Items = core.ItemIdentifiers;
  if (bar.barId !== Items.GOLD_BAR) return bar.xp;
  const gauntlets = [Items.GOLDSMITH_GAUNTLETS].includes(equipped(player, core.Equipment.HANDS_SLOT));
  const cape = [Items.SMITHING_CAPE, Items.SMITHING_CAPE_T_].includes(equipped(player, core.Equipment.CAPE_SLOT));
  return gauntlets || cape ? bar.xp + GOLDSMITH_GAUNTLETS_BONUS_XP : bar.xp;
}

/** Turns the pot's ore into bars, up to 28 of each in the dispenser, and pours them. */
function smelt(player) {
  const state = stateOf(player);
  let made = false;
  for (const bar of BARS) {
    const room = BAR_LIMIT - (state.bars[bar.barId] ?? 0);
    const count = Math.min(room, ...bar.ingredients.map(([id, amount]) => Math.floor((state.ores[id] ?? 0) / amount)));
    if (count <= 0) continue;
    for (const [id, amount] of bar.ingredients) state.ores[id] -= amount * count;
    state.bars[bar.barId] = (state.bars[bar.barId] ?? 0) + count;
    player.getSkillManager().addExperiences(core.Skill.SMITHING, barXp(player, bar) * count);
    made = true;
  }
  syncContents(player);
  if (!made) return;
  pouring.set(player, 0);
  setDispenser(player, DISPENSER_POURING);
  const dispenser = core.MapObjects.get(BAR_DISPENSER, new core.Location(...BAR_DISPENSER_TILE, 0), null);
  if (dispenser) player.getPacketSender().sendObjectAnimation(dispenser, new core.Animation(LAVA_FLOW_ANIMATION));
}

// --- The bar dispenser.

function wearsColdGloves(player) {
  const Items = core.ItemIdentifiers;
  return [Items.ICE_GLOVES, Items.SMITHS_GLOVES_I_].includes(equipped(player, core.Equipment.HANDS_SLOT));
}

function cool(player) {
  pouring.delete(player);
  setDispenser(player, DISPENSER_COOL);
}

function takeBars({ player }) {
  const state = stateOf(player);
  if (dispenserState(player) === DISPENSER_HOT) {
    if (!wearsColdGloves(player)) {
      statement(player, "The bars are still molten! You need to cool them down.");
      return;
    }
    cool(player);
  }
  const bars = BARS.filter((bar) => (state.bars[bar.barId] ?? 0) > 0).map((bar) => bar.barId);
  if (!bars.length) {
    setDispenser(player, DISPENSER_EMPTY);
    return;
  }
  if (player.getInventory().getFreeSlots() === 0) {
    player.sendMessage("You don't have enough inventory space.");
    return;
  }
  player.getPacketSender().sendCreationMenu(new core.CreationMenu("What would you like to take?", bars, {
    execute: (barId, amount) => take(player, barId, amount),
  }));
}

function take(player, barId, amount) {
  const state = stateOf(player);
  const count = Math.min(amount, state.bars[barId] ?? 0, player.getInventory().getFreeSlots());
  if (count <= 0) return;
  state.bars[barId] -= count;
  player.getInventory().addItem(new core.Item(barId, count));
  if (!Object.values(state.bars).some((left) => left > 0)) setDispenser(player, DISPENSER_EMPTY);
  // Ore held back by a full dispenser smelts now there's room.
  smelt(player);
}

function checkDispenser({ player }) {
  const { bars } = stateOf(player);
  listPages(player, BARS.map((bar) => `${bar.name}: ${bars[bar.barId] ?? 0}`));
}

/** Bucket of water on the dispenser (generic hook: the dispenser's base loc has no name). */
function coolWithWater(event) {
  const { player, objectId, itemId } = event;
  if (objectId !== BAR_DISPENSER || itemId !== core.ItemIdentifiers.BUCKET_OF_WATER) return;
  event.handled = true;
  if (dispenserState(player) !== DISPENSER_HOT) {
    player.sendMessage("Nothing interesting happens.");
    return;
  }
  player.performAnimation(new core.Animation(THROW_WATER_ANIMATION));
  player.getInventory().deleteNumber(core.ItemIdentifiers.BUCKET_OF_WATER, 1);
  player.getInventory().addItem(new core.Item(core.ItemIdentifiers.BUCKET, 1));
  cool(player);
}

function fillBucket({ player }) {
  const inventory = player.getInventory();
  const Items = core.ItemIdentifiers;
  if (!inventory.contains(Items.BUCKET)) {
    player.sendMessage("You need a bucket to fill.");
    return;
  }
  player.performAnimation(new core.Animation(FILL_ANIMATION));
  inventory.deleteNumber(Items.BUCKET, 1);
  inventory.addItem(new core.Item(Items.BUCKET_OF_WATER, 1));
  player.sendMessage("You fill the bucket from the sink.");
}

function readGauge({ player }) {
  player.getPacketSender().sendInterface(TEMPERATURE_GAUGE_INTERFACE);
}

// --- The furnace's clock: the coffer, the belt and the dispensers.

function tickBelt() {
  for (const ore of [...belt]) {
    ore.tiles++;
    if (ore.tiles <= BELT_TILES) {
      ore.npc?.moveTo(new core.Location(BELT_START[0], BELT_START[1] - ore.tiles, 0));
      if (ore.tiles === BELT_TILES) ore.npc?.performAnimation(new core.Animation(ORE_FALL_ANIMATION));
      continue;
    }
    if (ore.npc) pluginApi.removeNpc(ore.npc);
    belt.splice(belt.indexOf(ore), 1);
    if (!belt.some((other) => other.player === ore.player)) smelt(ore.player);
  }
}

function tickDispensers() {
  for (const [player, ticks] of pouring) {
    pouring.set(player, ticks + 1);
    if (ticks + 1 === POUR_TICKS) setDispenser(player, DISPENSER_HOT);
    if (ticks + 1 === POUR_TICKS + COOL_TICKS) cool(player);
  }
}

function tickCoffers() {
  for (const player of inRoom) {
    const state = stateOf(player);
    if (state.coffer === 0) continue;
    state.coffer = Math.max(0, state.coffer - COFFER_PER_TICK);
    syncCoffer(player);
  }
}

/** Dispensers before the belt, so bars poured this tick start counting next tick. */
function tick() {
  tickCoffers();
  tickDispensers();
  tickBelt();
}

function start() {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1); }
    execute() { tick(); }
  })());
}

module.exports = {
  name: "BlastFurnace",
  members: true,
  _test: { init, tick, stateOf, putOre, smelt, takeBars, take, foremanCondition, foremanPaid, enterRoom, coolWithWater },
  register(api) {
    init(api);
    api.persistAttribute(STATE_ATTRIBUTE);
    api.onServerStartup(start);
    api.onPlayerLogout(logout);
    api.onZoneEnter(ROOM, enterRoom);
    api.onZoneExit(ROOM, leaveRoom);
    api.onObjectInteraction("Stairs", { "Climb-down": stairs, "Climb-up": stairs });
    api.onObjectInteraction("Gate", { Open: openAnvilGate });
    api.onObjectInteraction("Coffer", { Use: useCoffer });
    api.onObjectInteraction("Conveyor belt", { "Put-ore-on": putOreOnBelt });
    api.onObjectInteraction("Melting Pot", { Check: checkPot });
    api.onObjectInteraction("Bar dispenser", { Take: takeBars, Check: checkDispenser });
    api.onObjectInteraction("Temperature gauge", { Read: readGauge });
    api.onObjectInteraction("Sink", { "Fill-bucket": fillBucket });
    api.onItemOnObject("Bucket", "Sink", fillBucket);
    for (const ore of ["Coal", "Tin ore", "Copper ore", "Iron ore", "Silver ore", "Gold ore", "Mithril ore", "Adamantite ore", "Runite ore"]) {
      api.onItemOnObject(ore, "Conveyor belt", useOreOnBelt, { noted: false });
    }
    api.onItemOnObject(coolWithWater);
    api.onNpcInteraction("Blast Furnace Foreman", { Pay: payForeman });
    api.onNpcDialogueCondition(foremanCondition);
    api.onCustomEvent("npc-dialogue:line", foremanPaid);
  },
};
