"use strict";

// Cuisine preparation is available independently of tutorial progress.
// Only the recipes listed below are supported by this unit: the cocktails, and the easy-order batta and crunchies.
const Common = require("./Common.Cooking");
const MENU = "aluft_cooking";
const MENU_TYPE = "aluft_cooking_type";
const CHOSEN = "gnome_chosen_cuisine";
const OP1 = 1 << 1;
const MIXED_DRAGON_SHAKER = 9574;
const MIXED_DRAGON_POURED = 9575;
const MIXED_DRAGON_GARNISHED = 9576;
let cachedUi;
const sessions = new WeakMap();
const cuts = new WeakMap();

const COCKTAILS = [
  { selector: 0, level: 6, mixed: 9568, product: "fruit_blast", mix: [["pineapple", 1], ["lemon", 1], ["orange", 1]], finish: [["lemon_slices", 1]], finishXp: 20 },
  { selector: 1, level: 8, mixed: 9569, product: "pineapple_punch", mix: [["pineapple", 2], ["lemon", 1], ["orange", 1]], finish: [["lime_chunks", 1], ["pineapple_chunks", 1], ["orange_slices", 1]], finishXp: 40 },
  { selector: 2, level: 18, mixed: 9566, product: "wizard_blizzard", mix: [["vodka", 2], ["gin", 1], ["lime", 1], ["lemon", 1], ["orange", 1]], finish: [["pineapple_chunks", 1], ["lime_slices", 1]], finishXp: 80 },
  { selector: 3, level: 20, mixed: 9567, product: "sgg", mix: [["vodka", 1], ["lime", 3]], finish: [["lime_slices", 1], ["equa_leaves", 1]], finishXp: 90 },
  { selector: 4, level: 32, mixed: MIXED_DRAGON_SHAKER, poured: MIXED_DRAGON_POURED, product: "drunk_dragon", mix: [["vodka", 1], ["gin", 1], ["dwellberries", 1]] },
];
const BATTA = [
  { selector: 7, level: 25, result: 9478, ingredients: [["equa_leaves", 4], ["lime_chunks", 1], ["orange_chunks", 1], ["pineapple_chunks", 1]] },
  { selector: 8, level: 26, result: 9482, ingredients: [["equa_leaves", 1], ["toads_legs", 1], ["cheese", 1]], spice: true },
  { selector: 9, level: 27, result: 9480, ingredients: [["king_worm", 1], ["cheese", 1]], spice: true },
  { selector: 10, level: 30, result: 9485, ingredients: [["tomato", 2], ["dwellberries", 1], ["onion", 1], ["cheese", 1], ["cabbage", 1]] },
  { selector: 11, level: 29, result: 9483, ingredients: [["tomato", 1], ["cheese", 1]] }];
const CRUNCHY = [
  { selector: 16, level: 10, result: 9581, ingredients: [["toads_legs", 2]], spice: true },
  { selector: 17, level: 12, result: 9579, ingredients: [["equa_leaves", 2]], spice: true },
  { selector: 18, level: 14, result: 9583, ingredients: [["king_worm", 2], ["equa_leaves", 1]], spice: true },
  { selector: 19, level: 16, result: 9577, ingredients: [["chocolate_bar", 2]], spice: true },
];
const MENUS = [COCKTAILS.concat([null, null]), BATTA, CRUNCHY];
// The per-product Creation tables list Cooking 1 for these final garnish
// operations; the higher recipe levels apply to the earlier preparation.
const FINISH = [
  { source: 9582, ingredient: "equa_leaves", result: "toad_crunchies", xp: 40 },
  { source: 9578, ingredient: "chocolate_dust", result: "chocchip_crunchies", xp: 46 },
  { source: 9484, ingredient: "equa_leaves", result: "cheese+tom_batta", xp: 88 },
  { source: 9580, ingredient: "gnome_spice", result: "spicy_crunchies", xp: 42 },
  { source: 9584, ingredient: "gnome_spice", result: "worm_crunchies", xp: 44 },
  { source: 9479, ingredient: "gnome_spice", result: "fruit_batta", xp: 80 },
  { source: 9481, ingredient: "equa_leaves", result: "worm_batta", xp: 84 },
  { source: 9486, ingredient: "equa_leaves", result: "vegetable_batta", xp: 86 },
];

function id(value) { return typeof value === "number" ? value : Common.gameval("obj", value); }
function plain(item) { return !item.isPresetItem() && !item.isUntradeable() && !item.isUnbankable(); }
function alive(player) { return Common.core.WorldDefinition.isMembersWorld() && player.isRegistered() && player.getHitpoints() > 0; }

/**
 * Selected ingredients and results are normal, nonstackable cache items. Plan
 * actual plain slots and the entire output capacity before changing inventory.
 * Tools that are not transformed are checked separately and never consumed.
 */
function plan(player, inputs, outputs, preferred = []) {
  const inventory = player.getInventory(), items = inventory.getItems(), used = new Set(), slots = [];
  for (const [name, count] of inputs) {
    const itemId = id(name);
    if (new Common.core.Item(itemId, 1).getDefinition().isStackable()) return null;
    const required = preferred.filter((entry) => entry.id === itemId);
    if (required.length > count || required.some((entry) => items[entry.slot] !== entry.item
      || entry.item.getId() !== itemId || entry.item.getAmount() !== 1 || !plain(entry.item))) return null;
    const order = [...required.map((entry) => entry.slot), ...items.keys()];
    let remaining = count;
    for (const slot of order) {
      if (remaining <= 0) break;
      const item = items[slot];
      if (used.has(slot) || item?.getId() !== itemId || item.getAmount() !== 1 || !plain(item)) continue;
      used.add(slot); slots.push(slot); remaining--;
    }
    if (remaining) return null;
  }
  let needed = 0;
  for (const [name, count] of outputs) {
    if (new Common.core.Item(id(name), 1).getDefinition().isStackable()) return null;
    needed += count;
  }
  if (inventory.getFreeSlots() + slots.length < needed) return null;
  return { inventory, slots, outputs };
}

function apply(player, transaction, product, xp, kind) {
  const { inventory, slots, outputs } = transaction;
  for (const slot of slots) inventory.deleteAtSlot(slot, 1, false);
  for (const [name, count] of outputs) inventory.add(new Common.core.Item(id(name), count), false);
  inventory.refreshItems();
  Common.addXp(player, xp);
  if (kind) Common.api.emitCustomEvent("skills:produced", { player, skill: Common.core.Skill.COOKING,
    itemId: id(product), amount: outputs.find(([name]) => id(name) === id(product))?.[1] ?? 1, xp, kind });
}

function ui() {
  if (cachedUi) return cachedUi;
  const cache = Common.core.CacheDefinitions;
  const group = cache.getInterfaceId(MENU), click = cache.getComponentId(`${MENU}:cuisine_clickzone`);
  const create = cache.getComponentId(`${MENU}:confirmation`), type = cache.getVarbitId(MENU_TYPE);
  const chosen = cache.getVarbitId(CHOSEN), main = cache.getComponentId("toplevel_osrs_stretch:mainmodal");
  if (![group, click, create, type, chosen, main].every(Number.isInteger)) throw new Error("[Cooking] missing gnome cuisine interface definitions");
  return cachedUi = { group, click, create, type, chosen, main };
}
function valid(player, session) {
  return !!session && alive(player) && player.getInterfaceId() === ui().group
    && player.getPacketSender().getSubInterfaceAt(ui().main) === session.mount
    && player.getInventory().getItems()[session.slot] === session.item
    && session.item.getId() === session.source && plain(session.item);
}

function openMenu(event, type) {
  const { player, item, slot, itemId } = event;
  if (!alive(player) || player.isPlayerBot() || !plain(item) || player.getInventory().getItems()[slot] !== item) return;
  const ids = ui(), session = { type, item, slot, source: itemId, selected: null };
  sessions.delete(player);
  const sender = player.getPacketSender();
  sender.sendVarbit(ids.type, type);
  // The interface script needs a valid default selector even before the actor
  // selects a supported recipe; server state remains null until a real click.
  sender.sendVarbit(ids.chosen, [0, 7, 16][type]);
  const previousMount = sender.getSubInterfaceAt(ids.main);
  player.setInterfaceId(ids.group);
  // A synchronous interface:changed listener may have opened a different modal.
  if (player.getInterfaceId() !== ids.group || sender.getSubInterfaceAt(ids.main) !== previousMount) return;
  session.mount = sender.mountSubInterface(ids.main, ids.group, 0);
  // An interface-opened hook may have replaced our mount synchronously.
  if (sender.getSubInterfaceAt(ids.main) !== session.mount) return;
  sessions.set(player, session);
  sender.sendInterfaceFlagsRange(ids.click, 0, MENUS[type].length - 1, OP1);
}
function openCocktails(event) { openMenu(event, 0); }
function openBatta(event) { openMenu(event, 1); }
function openCrunchy(event) { openMenu(event, 2); }

function selectCuisine(event) {
  const { player, slot, action } = event, session = sessions.get(player);
  if (!valid(player, session) || action !== 1) return;
  event.handled = true;
  // Every displayed row transmits. Unsupported or invalid choices explicitly
  // clear old server state even though their local CS2 display still changes.
  session.selected = Number.isInteger(slot) ? MENUS[session.type][slot] ?? null : null;
  if (session.selected) player.getPacketSender().sendVarbit(ui().chosen, session.selected.selector);
}

function createCuisine(event) {
  const { player, action } = event, session = sessions.get(player);
  if (!valid(player, session) || action !== 1) return;
  event.handled = true;
  const recipe = session.selected;
  if (!recipe || Common.level(player) < recipe.level) return;
  if (recipe.spice && player.getInventory().getAmount(id("gnome_spice")) < 1) return;
  const ingredients = session.type === 0 ? recipe.mix : recipe.ingredients;
  const product = session.type === 0 ? recipe.mixed : recipe.result;
  const transaction = plan(player, [[session.source, 1], ...ingredients], [[product, 1]], [{ id: session.source, slot: session.slot, item: session.item }]);
  if (!transaction) return;
  sessions.delete(player);
  apply(player, transaction, product, session.type === 0 ? 30 : session.type === 1 ? 40 : 30, "make");
  const ids = ui(), sender = player.getPacketSender();
  if (sender.getSubInterfaceAt(ids.main) === session.mount) {
    const closed = sender.closeSubInterfaceMount(session.mount);
    if (closed && !sender.getSubInterfaceAt(ids.main) && player.getInterfaceId() === ids.group) player.setInterfaceId(-1);
  }
}

function pour(event) {
  const { player, item, itemId, slot } = event;
  const recipe = COCKTAILS.find((entry) => entry.mixed === itemId);
  if (!recipe || !alive(player) || !plain(item) || player.getInventory().getItems()[slot] !== item || Common.level(player) < recipe.level) return;
  const product = recipe.poured ?? recipe.product;
  const transaction = plan(player, [[itemId, 1], ["cocktail_glass_empty", 1], ...(recipe.finish ?? [])],
    [["cocktail_shaker", 1], [product, 1]], [{ id: itemId, slot, item }]);
  if (!transaction) return;
  apply(player, transaction, product, recipe.finishXp ?? 0, "make");
}

function garnishDragon(event) {
  const { player, item, itemId, slot } = event;
  if (itemId !== MIXED_DRAGON_POURED || !alive(player) || !plain(item)
      || player.getInventory().getItems()[slot] !== item || Common.level(player) < 32) return;
  const transaction = plan(player, [[itemId, 1], ["pineapple_chunks", 1], ["pot_of_cream", 1]],
    [[MIXED_DRAGON_GARNISHED, 1]], [{ id: itemId, slot, item }]);
  if (transaction) apply(player, transaction, MIXED_DRAGON_GARNISHED, 0, "make");
}

function emptyBurnt(event) {
  const { player, item, itemId, slot } = event;
  if (!alive(player) || !plain(item) || player.getInventory().getItems()[slot] !== item) return;
  const result = itemId === id("burnt_crunchies") ? "crunchy_tray"
    : itemId === id("burnt_batta") ? "batta_tin" : null;
  if (!result) return;
  const transaction = plan(player, [[itemId, 1]], [[result, 1]], [{ id: itemId, slot, item }]);
  if (transaction) apply(player, transaction, result, 0, null);
}

function interfaceClosed({ player, interfaceId }) {
  if (interfaceId !== ui().group) return;
  const session = sessions.get(player);
  // A previous close listener may have synchronously opened a new group 49.
  if (session && player.getPacketSender().getSubInterfaceAt(ui().main) !== session.mount) sessions.delete(player);
}
function clearPlayer({ player }) { sessions.delete(player); cuts.delete(player); }

const FRUIT = {
  pineapple: [["Dice", "pineapple_chunks", 1], ["Slice", "pineapple_ring", 4]],
  lemon: [["Dice", "lemon_chunks", 1], ["Slice", "lemon_slices", 1]],
  orange: [["Dice", "orange_chunks", 1], ["Slice", "orange_slices", 1]],
  lime: [["Dice", "lime_chunks", 1], ["Slice", "lime_slices", 1]],
};

function chooseCut(player, token, output, count) {
  if (cuts.get(player) !== token || !alive(player)) return;
  cuts.delete(player);
  const items = player.getInventory().getItems();
  if (items[token.fruit.slot] !== token.fruit.item || items[token.knife.slot] !== token.knife.item
      || token.knife.item.getId() !== token.knife.id) return;
  const transaction = plan(player, [[token.fruit.id, 1]], [[output, count]], [token.fruit]);
  if (!transaction) return;
  apply(player, transaction, output, 0, "make");
}

function useItems(event) {
  const { player, usedItem, usedItemId, usedItemSlot, usedWithItem, usedWithItemId, usedWithItemSlot } = event;
  if (!usedItem || !usedWithItem || !Number.isInteger(usedItemSlot) || !Number.isInteger(usedWithItemSlot)) return;
  if (!alive(player)) return;
  const pair = [{ id: usedItemId, item: usedItem, slot: usedItemSlot },
    { id: usedWithItemId, item: usedWithItem, slot: usedWithItemSlot }];
  const hasPair = (a, b) => pair.some((entry) => entry.id === id(a)) && pair.some((entry) => entry.id === id(b));
  const simple = hasPair("gianne_dough", "crunchy_tray") ? ["gianne_dough", "crunchy_tray", "raw_crunchies", 0]
    : hasPair("gianne_dough", "batta_tin") ? ["gianne_dough", "batta_tin", "raw_batta", 0] : null;
  const finish = FINISH.find((entry) => hasPair(entry.source, entry.ingredient));
  if (simple || finish) {
    event.handled = true;
    const inputs = simple ? [[simple[0], 1], [simple[1], 1]] : [[finish.source, 1], [finish.ingredient, 1]];
    const product = simple ? simple[2] : finish.result, xp = simple ? simple[3] : finish.xp;
    const transaction = plan(player, inputs, [[product, 1]], pair);
    if (transaction) apply(player, transaction, product, xp, "make");
    return;
  }
  const knife = pair.find((entry) => Common.knives().has(entry.id));
  if (!knife) return;
  const fruit = pair.find((entry) => entry !== knife && Object.keys(FRUIT).some((name) => id(name) === entry.id));
  if (!fruit || !plain(fruit.item)) return;
  const name = Object.keys(FRUIT).find((value) => id(value) === fruit.id), token = { fruit, knife };
  event.handled = true;
  cuts.set(player, token);
  const pairs = FRUIT[name].flatMap(([text, output, count]) => [text, () => chooseCut(player, token, output, count)]);
  if (!Common.api.sendMultiChatboxPrompt(player, "How would you like to cut the fruit?", ...pairs)) cuts.delete(player);
}

function interfaceAction(event) {
  if (!cachedUi || (event.buttonId >>> 16) !== cachedUi.group) return;
  const ids = ui();
  if (event.buttonId === ids.click) selectCuisine(event);
  else if (event.buttonId === ids.create) createCuisine(event);
}

function attach(api) {
  api.onItemAction("Cocktail shaker", { "Mix-cocktail": openCocktails });
  api.onItemAction("Half baked batta", { Prepare: openBatta });
  api.onItemAction("Half baked crunchy", { Prepare: openCrunchy });
  api.onItemAction("Mixed blast", { Pour: pour });
  api.onItemAction("Mixed punch", { Pour: pour });
  api.onItemAction("Mixed blizzard", { Pour: pour });
  api.onItemAction("Mixed sgg", { Pour: pour });
  api.onItemAction("Mixed dragon", { Pour: pour, "Add-ingreds": garnishDragon });
  api.onItemAction("Burnt crunchies", { "Empty Tray": emptyBurnt });
  api.onItemAction("Burnt batta", { "Empty Tin": emptyBurnt });
  api.onItemOnItem(useItems, { noted: false });
  api.onInterfaceActionClick(interfaceAction);
  api.onCustomEvent("interface:closed", interfaceClosed);
  api.onPlayerLogout(clearPlayer);
  api.onPlayerDisconnect(clearPlayer);
  api.onPlayerDeath(clearPlayer);
}

module.exports = attach;
