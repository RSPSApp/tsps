// Fossil Island's Museum Camp fossil storage and cleaning bench (rsprox 231/00711-00712, 227/00073,
// 227/01843, 227/01862; Wiki).
// - Fossil Storage > Open: the crate over the inventory. Fossils, cleaned and not, go in from the side
//   panel (Deposit 1/5/10/All/X, or Deposit All), come out from the list (1/5/10/All/X, or Withdraw
//   All). Each type is its own count, up to 510, kept in its own varbit; every crate is the same store.
//   A fossil used on a crate goes in too (Wiki).
// - The cleaning bench starts as table parts (varbit fossil_bench 0): Build makes it (Wiki). A fossil
//   used on it, with the full archaeology kit, cleans every unidentified fossil carried, one every
//   6 ticks, with the brush or the rock pick.
const DATA = require("./data/fossil-storage.json");

/** fossil gameval -> its saved count, "fossil-storage:small-1" for fossil_small_1. */
const STORED_ATTRIBUTE = Object.freeze(Object.fromEntries(DATA.fossils.map((name) =>
  [name, `fossil-storage:${name.replace(/^fossil_/, "").replace(/_/g, "-")}`])));
const BENCH_BUILT_ATTRIBUTE = "fossil-storage:bench-built";
const HAS_KIT_EVENT = "archaeology:has-kit";
const BANK_PIN_GUARD_EVENT = "bank-pin:guard";
const BANK_PIN_FEATURE = "fossil-storage";
const INV_INIT_SCRIPT = 149; // interface_inv_init
const MAIN_MODAL_BACKGROUND_SCRIPT = 917; // toplevel_mainmodal_background
const OP1_TO_5 = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5);
const OP10 = 1 << 10;
const MODAL = 0;

let api;
const cleaning = new WeakMap();

const core = () => api.core;
const cache = () => core().CacheDefinitions;
const objId = (name) => cache().getObjId(name);
const locId = (name) => cache().getLocId(name);
const component = (name) => cache().getComponentId(name);
const varbitOf = (name) => cache().getVarbitId(`fossil_storage_${name.replace(/^fossil_/, "")}`);
const text = (key, values = {}) => DATA.messages[key].replace(/\{(\w+)\}/g, (_, name) => values[name]);
const nameOf = (id) => core().ItemDefinition.forId(id).getName();

/** gameval name -> item id, and back, for the 30 stored types. */
let types;
function fossilTypes() {
  if (types) return types;
  types = { byName: new Map(), byId: new Map() };
  for (const name of DATA.fossils) {
    const id = objId(name);
    types.byName.set(name, id);
    types.byId.set(id, name);
  }
  return types;
}

const stored = (player, name) => Number(player.getAttribute(STORED_ATTRIBUTE[name])) || 0;

function setStored(player, name, amount) {
  player.setAttribute(STORED_ATTRIBUTE[name], amount);
  player.getPacketSender().sendVarbit(varbitOf(name), amount);
}

const isOpen = (player) => player.getInterfaceId?.() === cache().getInterfaceId(DATA.storage);

// ---------------------------------------------------------------- the crate

/**
 * The Bank PIN guards the crate (Wiki: Bank_PIN, "Situations requiring a PIN"): with a PIN this
 * session hasn't entered, the keypad asks first and the crate opens once it's right.
 */
function pinLocked(player) {
  const request = { player, feature: BANK_PIN_FEATURE, resume: () => open({ player }) };
  api.emitCustomEvent(BANK_PIN_GUARD_EVENT, request);
  return request.locked === true;
}

/** As recorded: the crate as the main modal, its own inventory panel as the side modal. */
function open({ player }) {
  if (pinLocked(player)) return true;
  const sender = player.getPacketSender();
  const sideInv = component(DATA.components.sideInv);
  sender.sendInterfaceRemoval();
  for (const name of DATA.fossils) sender.sendVarbit(varbitOf(name), stored(player, name));
  sender.sendInterfaceScript(MAIN_MODAL_BACKGROUND_SCRIPT, [-1, -1]);
  sender.sendInterface(cache().getInterfaceId(DATA.storage));
  sender.sendSubInterface(component(DATA.sideModal), cache().getInterfaceId(DATA.side), MODAL);
  sender.sendInterfaceScript(INV_INIT_SCRIPT, [sideInv, cache().getInventoryId(DATA.inventory), 4, 7, 0, -1, "Deposit 1", "Deposit 5", "Deposit 10", "Deposit All", "Deposit X"]);
  sender.sendInterfaceFlagsRange(sideInv, 0, 27, OP1_TO_5 | OP10);
  sender.sendInterfaceFlagsRange(component(DATA.components.list), 0, DATA.fossils.length - 1, OP1_TO_5 | OP10);
  player.getInventory().refreshItems();
  return true;
}

/** Up to `wanted` of the inventory's `id` into the store, as far as its 510 allow. Returns the count stored. */
function store(player, id, wanted) {
  const name = fossilTypes().byId.get(id);
  if (!name) return 0;
  const inventory = player.getInventory();
  const amount = Math.min(wanted, inventory.getAmount(id), DATA.max - stored(player, name));
  if (amount <= 0) return 0;
  inventory.deleteNumber(id, amount);
  setStored(player, name, stored(player, name) + amount);
  return amount;
}

/** Up to `wanted` of a stored type into the inventory (one slot each: fossils don't stack). */
function take(player, name, wanted) {
  const id = fossilTypes().byName.get(name);
  const inventory = player.getInventory();
  const asked = Math.min(wanted, stored(player, name));
  const amount = asked > 0 ? inventory.getAddableAmount(new (core().Item)(id, asked)) : 0;
  if (amount <= 0) return 0;
  setStored(player, name, stored(player, name) - amount);
  inventory.add(new (core().Item)(id, amount));
  return amount;
}

function askAmount(player, then) {
  player.setEnteredAmountAction({ execute: (count) => then(Math.max(0, Math.floor(Number(count) || 0))) });
  player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
}

const opOf = (event) => event.opId ?? event.action;
const amountFor = (op) => (op === 4 ? Infinity : DATA.amounts[op] ?? 1);

function examine(player, id) {
  player.sendMessage(core().ItemDefinition.forId(id).getExamine?.() ?? "");
}

function depositOne(player, id, wanted) {
  const name = fossilTypes().byId.get(id);
  if (!name) return;
  const amount = store(player, id, wanted);
  player.getInventory().refreshItems();
  if (amount > 0) player.sendMessage(text("store", { name: nameOf(id), amount }));
  else if (stored(player, name) >= DATA.max) player.sendMessage(text("full"));
}

function clickSide(event) {
  const { player } = event;
  if (!isOpen(player)) return true;
  const item = player.getInventory().getItems()[event.slot ?? -1];
  if (!item || item.getId() <= 0) return true;
  const op = opOf(event);
  if (op === 10) examine(player, item.getId());
  else if (op === 5) askAmount(player, (amount) => depositOne(player, item.getId(), amount));
  else depositOne(player, item.getId(), amountFor(op));
  return true;
}

function withdrawOne(player, name, wanted) {
  if (pinLocked(player)) return;
  const amount = take(player, name, wanted);
  player.getInventory().refreshItems();
  if (amount > 0) player.sendMessage(text("withdraw", { name: nameOf(fossilTypes().byName.get(name)), amount }));
  else if (stored(player, name) > 0 && wanted > 0) player.sendMessage(text("noRoom"));
}

function clickList(event) {
  const { player } = event;
  if (!isOpen(player) || pinLocked(player)) return true;
  const name = DATA.fossils[event.slot ?? -1];
  if (!name || stored(player, name) <= 0) return true;
  const op = opOf(event);
  if (op === 10) examine(player, fossilTypes().byName.get(name));
  else if (op === 5) askAmount(player, (amount) => withdrawOne(player, name, amount));
  else withdrawOne(player, name, amountFor(op));
  return true;
}

/** Recorded: every fossil carried goes in, other things stay, and no message. */
function depositAll({ player }) {
  if (!isOpen(player)) return true;
  for (const id of fossilTypes().byId.keys()) store(player, id, Infinity);
  player.getInventory().refreshItems();
  return true;
}

/** Recorded: everything stored comes out, as far as the inventory takes it, and no message. */
function withdrawAll({ player }) {
  if (!isOpen(player) || pinLocked(player)) return true;
  for (const name of DATA.fossils) take(player, name, Infinity);
  player.getInventory().refreshItems();
  return true;
}

/** Wiki (14 October 2026): a fossil used on a crate goes in, without opening it. */
function fossilOnCrate(event) {
  if (!DATA.crates.map(locId).includes(event.object?.getId?.()) || !fossilTypes().byId.has(event.itemId)) return;
  event.handled = true;
  depositOne(event.player, event.itemId, Infinity);
}

// ---------------------------------------------------------------- the bench

const benchBuilt = (player) => Number(player.getAttribute(BENCH_BUILT_ATTRIBUTE)) === 1;

function sendBench(player) {
  player.getPacketSender().sendVarbit(cache().getVarbitId(DATA.benchBuilt), benchBuilt(player) ? 1 : 0);
}

/** Table parts > Build (Wiki): 5 planks, 5 nails and a hammer at 5 Construction, for 100 XP. */
const isBench = (object) => object?.getId?.() === locId(DATA.bench);

function buildBench({ player, object }) {
  if (!isBench(object)) return false;
  const { level, xp, planks, nails, plank, hammer, nailTypes } = DATA.build;
  const inventory = player.getInventory();
  const skills = player.getSkillManager();
  if (skills.getCurrentLevel(core().Skill.CONSTRUCTION) < level) {
    player.sendMessage(text("buildLevel"));
    return true;
  }
  const nailId = nailTypes.map(objId).find((id) => inventory.getAmount(id) >= nails);
  if (inventory.getAmount(objId(plank)) < planks || nailId == null || inventory.getAmount(objId(hammer)) <= 0) {
    player.sendMessage(text("buildItems"));
    return true;
  }
  inventory.deleteNumber(objId(plank), planks);
  inventory.deleteNumber(nailId, nails);
  inventory.refreshItems();
  skills.addExperiences(core().Skill.CONSTRUCTION, xp);
  player.setAttribute(BENCH_BUILT_ATTRIBUTE, 1);
  sendBench(player);
  player.sendMessage(text("built"));
  return true;
}

function hasKit(player) {
  const request = { player, hasKit: null };
  api.emitCustomEvent(HAS_KIT_EVENT, request);
  return request.hasKit === true;
}

function unidentified(player) {
  return player.getInventory().getItems().findIndex((item) => item && DATA.cleaning[fossilTypes().byId.get(item.getId())]);
}

/** One fossil: a random piece of its size, in its own slot, with a random tool (recorded). */
function cleanOne(player) {
  const slot = unidentified(player);
  if (slot < 0) return false;
  const inventory = player.getInventory();
  const sets = DATA.cleaning[fossilTypes().byId.get(inventory.getItems()[slot].getId())];
  const set = sets[Math.floor(Math.random() * sets.length)];
  const result = objId(set[Math.floor(Math.random() * set.length)]);
  const tool = DATA.tools[Math.floor(Math.random() * DATA.tools.length)];
  const { Animation, Graphic, Item } = core();
  inventory.setItem(slot, new Item(result, 1));
  inventory.refreshItems();
  player.performAnimation(new Animation(cache().getSeqId(tool.anim)));
  player.performGraphic(new Graphic(cache().getSpotanimId(tool.graphic)));
  player.getPacketSender().sendSoundEffect(tool.sound, 1, 0, 1);
  player.sendMessage(tool.message);
  return true;
}

/**
 * Every unidentified fossil in turn, the first the tick after, then one every 6 ticks. Keyed to the
 * player's index, so walking off, combat or a new use stops it, as for other skilling.
 */
function cleanAll(player, bench) {
  const { Task, TaskManager } = core();
  const run = {};
  cleaning.set(player, run);
  let wait = 1;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player.getIndex(), false); }
    execute() {
      if (cleaning.get(player) !== run || !player.isRegistered()) return void this.stop();
      if (--wait > 0) return;
      if (!player.getLocation().isWithinInteractionDistance(bench) || !hasKit(player) || !cleanOne(player)) return void this.stop();
      wait = DATA.cleanTicks;
    }
  })());
}

function fossilOnBench(event) {
  if (!isBench(event.object)) return;
  const { player, itemId } = event;
  if (!benchBuilt(player)) return;
  event.handled = true;
  if (!DATA.cleaning[fossilTypes().byId.get(itemId)]) return void player.sendMessage(text("nothing"));
  if (!hasKit(player)) {
    const { DialogueChainBuilder, StatementDialogue } = core();
    return void player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text("needKit"))));
  }
  cleanAll(player, event.object.getLocation());
}

/** One dispatcher for item-on-loc: a fossil on a crate, or on the bench. */
function itemOnFossilLoc(event) {
  if (event.handled) return;
  fossilOnCrate(event);
  if (!event.handled) fossilOnBench(event);
}

function useBench({ player }) {
  player.sendMessage(text("useOnBench"));
  return true;
}

function login({ player }) {
  for (const name of DATA.fossils) {
    const amount = stored(player, name);
    if (amount > 0) player.getPacketSender().sendVarbit(varbitOf(name), amount);
  }
  if (benchBuilt(player)) sendBench(player);
}

/** Every stored count and the bench start at 0. */
function persistFossilStorage() {
  for (const key of [...Object.values(STORED_ATTRIBUTE), BENCH_BUILT_ATTRIBUTE]) api.persistAttribute(key, 0);
}

module.exports = {
  name: "FossilStorage",
  description: "Fossil Island Museum Camp's fossil storage crates and the cleaning bench that cleans unidentified fossils.",
  members: true,
  DATA,
  STORED_ATTRIBUTE,
  BENCH_BUILT_ATTRIBUTE,
  register(pluginApi) {
    api = pluginApi;
    persistFossilStorage();
    api.onObjectInteraction("Fossil Storage", { Open: open });
    api.onObjectInteraction("Table parts", { Build: buildBench });
    api.onObjectInteraction("Fossil cleaning bench", { Use: useBench });
    api.onItemOnObject(itemOnFossilLoc);
    api.onInterfaceActionButton(component(DATA.components.sideInv), clickSide);
    api.onInterfaceActionButton(component(DATA.components.list), clickList);
    api.onInterfaceActionButton(component(DATA.components.depositAll), depositAll);
    api.onInterfaceActionButton(component(DATA.components.withdrawAll), withdrawAll);
    api.onPlayerLogin(login);
  },
};
