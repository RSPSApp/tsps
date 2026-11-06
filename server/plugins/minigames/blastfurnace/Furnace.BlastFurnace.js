/**
 * Blast Furnace, under Keldagrim: ore put on the conveyor belt is smelted with half the coal and
 * the bars collected from the dispenser. Worlds tagged blast-furnace charge for dwarf operation;
 * other worlds use the shared stove/pump/pedals/repairs in Machinery.BlastFurnace.js. Smiths under base
 * level 60 also pay the foreman 2,500 coins for ten minutes. Behaviour comes from the OSRS Wiki
 * and transcripts; docs/blast-furnace.md distinguishes verified rules from timing estimates.
 */
const Smithing = require("../../skills/Smithing.plugin");
const Machinery = require("./Machinery.BlastFurnace");

/** The furnace room. */
const { ROOM } = Machinery;

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
const NICKEL_LIMIT = 14;
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
/** rsprox 3278; sound-effect archive 1051 exists in the active cache. */
const COOL_BARS_SOUND = 1051;
const FILL_ANIMATION = 832;
/** rsprox 3278: the sink's tap. */
const FILL_SOUND = 2609;
const GOLDSMITH_GAUNTLETS_BONUS_XP = 33.7;

/** The stairs between Keldagrim and the furnace. */
const FURNACE_ENTRANCE_STAIRS = 9084;
const STAIRS = new Map([[FURNACE_ENTRANCE_STAIRS, [1939, 4958]], [9138, [2931, 10196]]]);
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
/** Online conveyor NPCs; each load is also saved on its owner's furnace state. */
const belt = [];
/** Ticks since each player's bars started pouring. */
const pouring = new Map();

function init(api) {
  pluginApi = api;
  core = api.core;
  Machinery.init(api);
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
    { item: Items.LEAD_ORE, npc: core.CacheDefinitions.getNpcId("blast_furnace_lead_ore"),
      varbit: core.CacheDefinitions.getVarbitId("blast_furnace_lead_ore"), level: 25, primary: true },
    { item: Items.NICKEL_ORE, npc: core.CacheDefinitions.getNpcId("blast_furnace_nickel_ore"),
      varbit: core.CacheDefinitions.getVarbitId("blast_furnace_nickel_ore"), level: 74, primary: true },
  ];
  const barVarbits = new Map([
    [Items.BRONZE_BAR, 941], [Items.IRON_BAR, 942], [Items.STEEL_BAR, 943], [Items.MITHRIL_BAR, 944],
    [Items.ADAMANTITE_BAR, 945], [Items.RUNITE_BAR, 946], [Items.GOLD_BAR, 947], [Items.SILVER_BAR, 948],
    [Items.LEAD_BAR, core.CacheDefinitions.getVarbitId("blast_furnace_lead_bars")],
    [Items.CUPRONICKEL_BAR, core.CacheDefinitions.getVarbitId("blast_furnace_cupronickel_bars")],
  ]);
  // Half the coal of a furnace, and iron never fails. Bars needing coal smelt first, so iron
  // ore with coal in the pot becomes steel.
  Smithing.loadData(core);
  BARS = Smithing.SMELTING_RECIPES
    .filter((recipe) => barVarbits.has(recipe.barId))
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
  state.conveyor ??= [];
  state.bars ??= {};
  state.permitUntil ??= 0;
  return state;
}

function smithingLevel(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.SMITHING);
}

function freeSmithing(player) {
  return player.getSkillManager().getMaxLevel(core.Skill.SMITHING) >= FREE_SMITHING_LEVEL;
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

/** The chat's filterable spam channel, which the belt, sink and water lines use (rsprox captures). */
function spam(player, text) {
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text);
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
  Machinery.sync(player, true);
  for (const load of state.conveyor) {
    if (!belt.some((entry) => entry.player === player && entry.load === load)) spawnLoad(player, load);
  }
  const hasBars = Object.values(state.bars).some((count) => count > 0);
  setDispenser(player, hasBars ? DISPENSER_COOL : DISPENSER_EMPTY);
  smelt(player);
}

function leaveRoom({ player }) {
  inRoom.delete(player);
  Machinery.leave(player);
  player.getPacketSender().closeSubInterface(OVERLAY_HUD_UID);
}

function logout({ player }) {
  inRoom.delete(player);
  Machinery.leave(player);
  pouring.delete(player);
  const state = player.getAttribute(STATE_ATTRIBUTE);
  // Wiki: coal alone on the belt is lost on logout; mixed loads remain on the belt.
  if (state?.conveyor?.every((load) => load.item === core.ItemIdentifiers.COAL)) state.conveyor = [];
  for (const ore of belt.filter((entry) => entry.player === player)) {
    if (ore.npc) pluginApi.removeNpc(ore.npc);
    belt.splice(belt.indexOf(ore), 1);
  }
}

function stairs({ player, objectId }) {
  const to = STAIRS.get(objectId);
  if (!to) return false;
  if (objectId === FURNACE_ENTRANCE_STAIRS) {
    const request = { player, key: "giant_dwarf", started: false };
    pluginApi.emitCustomEvent("quest:is-started", request);
    if (request.started !== true) {
      player.sendMessage("You need to start The Giant Dwarf to enter Keldagrim.");
      return;
    }
  }
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
  // Other minigames' "Coffer" locs (Bounty Hunter) fall through to their own handlers.
  const location = player.getLocation();
  if (location.getX() < ROOM.minX || location.getX() > ROOM.maxX ||
      location.getY() < ROOM.minY || location.getY() > ROOM.maxY || location.getZ() !== 0) return false;
  // The Bank PIN guards this (Wiki: Bank_PIN); a locked PIN asks first, then reopens it.
  const pin = { player, feature: "blast-furnace-coffer", resume: () => useCoffer({ player }) };
  pluginApi.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked) return true;
  if (stateOf(player).coffer === 0 && coins(player) === 0) {
    coinsStatement(player, "There are no coins in the coffer or your inventory.");
    return;
  }
  pluginApi.sendMultiChatboxPrompt(player, "Select an option",
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
  const wanted = Math.min(amount, state.coffer);
  if (!(wanted > 0)) return;
  // What the coin stack can still hold; the coffer keeps the rest.
  const count = player.getInventory().getAddableAmount(new core.Item(core.ItemIdentifiers.COINS, wanted));
  if (count <= 0) {
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
  const level = player.getSkillManager().getMaxLevel(core.Skill.SMITHING);
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
  return ORES.filter((ore) => ore.primary).reduce((sum, ore) => sum + oreTotal(state, ore.item), 0);
}

function oreTotal(state, item) {
  return (state.ores[item] ?? 0) + state.conveyor.filter((load) => load.item === item)
    .reduce((sum, load) => sum + load.count, 0);
}

function spawnLoad(player, load) {
  const ore = ORES.find((ore) => ore.item === load.item);
  const npc = pluginApi.spawnNpc({ id: ore.npc, x: BELT_START[0], y: BELT_START[1] - load.tiles, z: 0, wanderRadius: 0 });
  npc?.setScriptedMovement?.(true);
  belt.push({ player, npc, load });
}

/** Puts every ore the player carries (or just `onlyItemId`) on the belt, up to the pot's limits. */
function putOre(player, onlyItemId = null) {
  const state = stateOf(player);
  if (Machinery.automated() && state.coffer === 0) {
    coinsStatement(player, "You must put money in the coffer to pay the workers.");
    return;
  }
  if (!freeSmithing(player) && Date.now() > state.permitUntil) {
    statement(player, "You must ask the foreman's permission before using the blast furnace.");
    return;
  }
  if (Object.values(state.bars).some((count) => count >= BAR_LIMIT)) {
    statement(player, "You should collect your bars before making any more.");
    return;
  }
  const inventory = player.getInventory();
  const ores = ORES.filter((ore) => (onlyItemId === null || ore.item === onlyItemId) &&
    inventory.getAmount(ore.item) > 0);
  if (!ores.length) {
    statement(player, "You don't have anything suitable for putting into the blast furnace.");
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
    const room = ore.primary ? PRIMARY_LIMIT - primaryTotal(state) : SECONDARY_LIMIT - oreTotal(state, ore.item);
    const limit = ore.item === core.ItemIdentifiers.NICKEL_ORE
      ? Math.min(room, NICKEL_LIMIT - oreTotal(state, ore.item)) : room;
    const count = Math.min(held, limit);
    if (count < held) overflow = true;
    if (count <= 0) continue;
    inventory.deleteNumber(ore.item, count);
    const load = { item: ore.item, count, tiles: 0 };
    state.conveyor.push(load);
    spawnLoad(player, load);
    moved = true;
  }
  if (overflow) {
    statement(player, "You should make sure all your ore smelts before adding any more.");
  } else if (moved) {
    spam(player, "All your ore goes onto the conveyor belt.");
  }
  if (moved) syncContents(player);
}

function putOreOnBelt({ player }) {
  // The Bank PIN guards this (Wiki: Bank_PIN); a locked PIN asks first, then reopens it.
  const pin = { player, feature: "blast-furnace-belt", resume: () => putOreOnBelt({ player }) };
  pluginApi.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked) return;
  putOre(player);
}

function useOreOnBelt({ player, itemId }) {
  if (core.ItemDefinition.forId(itemId).isNoted()) {
    statement(player, "There would be no point in smelting that.");
    return;
  }
  // The Bank PIN guards this (Wiki: Bank_PIN); a locked PIN asks first, then reopens it.
  const pin = { player, feature: "blast-furnace-belt", resume: () => useOreOnBelt({ player, itemId }) };
  pluginApi.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked) return;
  putOre(player, itemId);
}

function checkPot({ player }) {
  const { ores } = stateOf(player);
  // Prompt wording is ours; no live capture of this menu yet.
  pluginApi.sendMultiChatboxPrompt(player, "Melting pot",
    "Check contents.", () => listPages(player, ORES.map((ore) => `${itemName(ore.item)}: ${ores[ore.item] ?? 0}`)),
    "Empty the furnace.", () => pluginApi.sendMultiChatboxPrompt(player, "Destroy all ore in the furnace?",
      "Yes, destroy it.", () => emptyPot(player), "No.", () => {}),
    "Cancel.", () => player.getPacketSender().sendInterfaceRemoval());
}

function emptyPot(player) {
  stateOf(player).ores = {};
  stateOf(player).conveyor = [];
  for (const ore of [...belt]) {
    if (ore.player !== player) continue;
    if (ore.npc) pluginApi.removeNpc(ore.npc);
    belt.splice(belt.indexOf(ore), 1);
  }
  syncContents(player);
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
  if (stateOf(player).conveyor.length) return;
  if (!Machinery.canSmelt() || Machinery.automated() && stateOf(player).coffer === 0) return;
  const state = stateOf(player);
  let made = false;
  for (const bar of BARS) {
    const room = BAR_LIMIT - (state.bars[bar.barId] ?? 0);
    const count = Math.min(room, ...bar.ingredients.map(([id, amount]) => Math.floor((state.ores[id] ?? 0) / amount)));
    if (count <= 0) continue;
    // Catalyst is consumed for coal bars actually made, after the dispenser limit.
    const inventory = player.getInventory();
    const catalyst = usesCoal(bar) ? Math.min(count, inventory.getAmount(core.ItemIdentifiers.SMITHING_CATALYST)) : 0;
    if (catalyst) inventory.deleteNumber(core.ItemIdentifiers.SMITHING_CATALYST, catalyst);
    for (const [id, amount] of bar.ingredients) state.ores[id] -= amount * count;
    state.bars[bar.barId] = (state.bars[bar.barId] ?? 0) + count;
    player.getSkillManager().addExperiences(core.Skill.SMITHING, barXp(player, bar) * (count + catalyst));
    made = true;
  }
  if (!made) return;
  syncContents(player);
  Machinery.contribution();
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
  if (dispenserState(player) === DISPENSER_POURING) return;
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
    statement(player, "The dispenser doesn't contain any bars.");
    return;
  }
  if (player.getInventory().getFreeSlots() === 0) {
    player.sendMessage("You don't have enough inventory space.");
    return;
  }
  const maxAmount = Math.min(player.getInventory().getFreeSlots(), Math.max(...bars.map((id) => state.bars[id])));
  player.getPacketSender().sendCreationMenu(new core.CreationMenu("How many would you like to take?", bars, {
    execute: (barId, amount) => take(player, barId, amount),
  }, { mode: 17, maxAmount }));
}

function take(player, barId, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || dispenserState(player) === DISPENSER_POURING) return;
  if (dispenserState(player) === DISPENSER_HOT) {
    if (!wearsColdGloves(player)) return;
    cool(player);
  }
  const state = stateOf(player);
  const count = Math.min(amount, state.bars[barId] ?? 0, player.getInventory().getFreeSlots());
  if (count <= 0) return;
  state.bars[barId] -= count;
  player.getInventory().addItem(new core.Item(barId, count));
  syncContents(player);
  const name = itemName(barId).toLowerCase();
  statement(player, `You take ${count} ${count === 1 ? name : `${name}s`} from the dispenser.`);
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
  const recipients = [...new Set([player, ...inRoom])].filter((other) =>
    dispenserState(other) === DISPENSER_HOT &&
    other.getLocation().isWithinDistance(new core.Location(...BAR_DISPENSER_TILE, 0), 5));
  if (!recipients.length) {
    player.sendMessage("Nothing interesting happens.");
    return;
  }
  player.performAnimation(new core.Animation(THROW_WATER_ANIMATION));
  player.getInventory().deleteNumber(core.ItemIdentifiers.BUCKET_OF_WATER, 1);
  player.getInventory().addItem(new core.Item(core.ItemIdentifiers.BUCKET, 1));
  player.getPacketSender().sendSound(COOL_BARS_SOUND);
  spam(player, "You throw the water over the bars.");
  for (const recipient of recipients) cool(recipient);
}

function fillBucket({ player }) {
  const inventory = player.getInventory();
  const Items = core.ItemIdentifiers;
  if (!inventory.contains(Items.BUCKET)) {
    player.sendMessage("You need a bucket to fill.");
    return;
  }
  player.performAnimation(new core.Animation(FILL_ANIMATION));
  player.getPacketSender().sendSound(FILL_SOUND);
  inventory.deleteNumber(Items.BUCKET, 1);
  inventory.addItem(new core.Item(Items.BUCKET_OF_WATER, 1));
  spam(player, "You fill the bucket from the sink.");
}

function readGauge({ player }) {
  Machinery.contribute(player);
  player.getPacketSender().sendInterface(TEMPERATURE_GAUGE_INTERFACE);
}

// --- The furnace's clock: the coffer, the belt and the dispensers.

function tickBelt() {
  for (const ore of [...belt]) {
    if (!Machinery.beltRunning() || Machinery.automated() && stateOf(ore.player).coffer === 0) continue;
    ore.load.tiles++;
    if (ore.load.tiles <= BELT_TILES) {
      ore.npc?.moveTo(new core.Location(BELT_START[0], BELT_START[1] - ore.load.tiles, 0));
      if (ore.load.tiles === BELT_TILES) ore.npc?.performAnimation(new core.Animation(ORE_FALL_ANIMATION));
      continue;
    }
    if (ore.npc) pluginApi.removeNpc(ore.npc);
    belt.splice(belt.indexOf(ore), 1);
    const state = stateOf(ore.player);
    state.conveyor.splice(state.conveyor.indexOf(ore.load), 1);
    state.ores[ore.load.item] = (state.ores[ore.load.item] ?? 0) + ore.load.count;
    syncContents(ore.player);
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
  if (!Machinery.automated()) return;
  for (const player of inRoom) {
    const state = stateOf(player);
    if (state.coffer === 0) continue;
    state.coffer = Math.max(0, state.coffer - COFFER_PER_TICK);
    syncCoffer(player);
  }
}

/** Dispensers before the belt, so bars poured this tick start counting next tick. */
function tick() {
  Machinery.tick();
  tickCoffers();
  tickDispensers();
  tickBelt();
  for (const player of inRoom) {
    Machinery.sync(player);
    if (!Machinery.automated() && !belt.some((ore) => ore.player === player)) smelt(player);
  }
}

function registerArea() {
  class BlastFurnaceArea extends core.Area {
    postEnter(mobile) { if (mobile.isPlayer()) enterRoom({ player: mobile }); }
    postLeave(mobile, logout) { if (mobile.isPlayer()) leaveRoom({ player: mobile }); }
    canAttack(attacker, target) { return attacker.isPlayer() && target.isPlayer() ? false : null; }
  }
  pluginApi.registerArea(new BlastFurnaceArea([new core.Boundary(ROOM.minX, ROOM.maxX, ROOM.minY, ROOM.maxY, 0)]));
}

function start() {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1); }
    execute() { tick(); }
  })());
}

function attachFurnace(api) {
  init(api);
  Machinery.attach(api);
  registerArea();
  api.persistAttribute(STATE_ATTRIBUTE);
  api.onServerStartup(start);
  api.onPlayerLogout(logout);
  api.onObjectInteraction("Stairs", { "Climb-down": stairs, "Climb-up": stairs });
  api.onObjectInteraction("Gate", { Open: openAnvilGate });
  api.onObjectInteraction("Coffer", { Use: useCoffer });
  api.onObjectInteraction("Conveyor belt", { "Put-ore-on": putOreOnBelt });
  api.onObjectInteraction("Melting Pot", { Check: checkPot });
  api.onObjectInteraction("Bar dispenser", { Take: takeBars, Check: checkDispenser });
  api.onObjectInteraction("Temperature gauge", { Read: readGauge });
  api.onObjectInteraction("Sink", { "Fill-bucket": fillBucket });
  api.onItemOnObject("Bucket", "Sink", fillBucket);
  api.onItemOnObject("Coal", "Conveyor belt", useOreOnBelt);
  api.onItemOnObject("Tin ore", "Conveyor belt", useOreOnBelt);
  api.onItemOnObject("Copper ore", "Conveyor belt", useOreOnBelt);
  api.onItemOnObject("Iron ore", "Conveyor belt", useOreOnBelt);
  api.onItemOnObject("Silver ore", "Conveyor belt", useOreOnBelt);
  api.onItemOnObject("Gold ore", "Conveyor belt", useOreOnBelt);
  api.onItemOnObject("Mithril ore", "Conveyor belt", useOreOnBelt);
  api.onItemOnObject("Adamantite ore", "Conveyor belt", useOreOnBelt);
  api.onItemOnObject("Runite ore", "Conveyor belt", useOreOnBelt);
  api.onItemOnObject("Lead ore", "Conveyor belt", useOreOnBelt);
  api.onItemOnObject("Nickel ore", "Conveyor belt", useOreOnBelt);
  api.onItemOnObject(coolWithWater);
  api.onNpcInteraction("Blast Furnace Foreman", { Pay: payForeman });
  api.onNpcDialogueCondition(foremanCondition);
  api.onCustomEvent("npc-dialogue:line", foremanPaid);
}

module.exports = attachFurnace;
module.exports._test = { init, tick, stateOf, putOre, smelt, takeBars, take, fillBucket, foremanCondition, foremanPaid, enterRoom, leaveRoom, logout, coolWithWater, stairs, checkPot, useOreOnBelt };
