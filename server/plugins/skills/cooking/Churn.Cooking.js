/**
 * Dairy churns: Churn (or milk, cream or butter used on a churn) opens "What would you like to
 * make?" with Cream, Butter and Cheese, and churns one item per cycle. Levels, XP, inputs and
 * cycle lengths are the Wiki's (Dairy churn, Pot of cream, Pat of butter, Cheese) in
 * plugins/skills/data/cooking.json; the menu, animation, butter line, slots and timing are from
 * rsprox captures (recordings 90 and 1105). See docs/cooking.md.
 */
const Common = require("./Common.Cooking");
const DATA = require("../data/cooking.json").churn;

/** The menu title and clientscript skillmulti_setup's first argument (rsprox captures 90, 1105). */
const MENU_TITLE = "What would you like to make?";
const MENU_MODE = 0;
/** Ours: no capture shows Churn with nothing to churn. */
const NOTHING_TO_CHURN_MESSAGE = "You have nothing to churn.";

let tables = null;

/** The churn data by cache id: inputs in the order a product prefers them, and each input's products. */
function churnData() {
  if (tables) return tables;
  const obj = (name) => Common.gameval("obj", name);
  const inputs = DATA.inputs.map((row) => ({ ...row, id: obj(row.input), returnId: row.returns ? obj(row.returns) : null }));
  const inputById = new Map(inputs.map((input) => [input.id, input]));
  const products = DATA.products.map((row) => ({
    ...row, input: inputById.get(obj(row.input)), productId: obj(row.product), seqId: Common.gameval("seq", row.seq),
  }));
  const productOrder = Object.keys(DATA.labels).map(obj);
  const labels = new Map(Object.entries(DATA.labels).map(([name, label]) => [obj(name), label]));
  tables = { inputs, products, productOrder, labels };
  return tables;
}

/**
 * Ours: each product is churned from the inputs carried, the most processed first (butter before
 * cream before milk), moving to the next when one runs out; `onlyInput` limits it to the item
 * used on the churn. Product to its rows, in that order.
 */
function choices(player, onlyInput = null) {
  const { inputs, products, productOrder } = churnData();
  const inventory = player.getInventory();
  const carried = inputs.filter((input) => (onlyInput === null || input.id === onlyInput) && inventory.getAmount(input.id) > 0);
  const chosen = new Map();
  for (const productId of productOrder) {
    const rows = carried.map((input) => products.find((product) => product.productId === productId && product.input === input)).filter(Boolean);
    if (rows.length > 0) chosen.set(productId, rows);
  }
  return chosen;
}

/** The first of these rows whose input the player still carries, or null. */
function nextRow(player, rows) {
  return rows.find((row) => player.getInventory().getAmount(row.input.id) > 0) ?? null;
}

function carriedFor(player, rows) {
  return rows.reduce((total, row) => total + player.getInventory().getAmount(row.input.id), 0);
}

/** "You churn your milk to make butter." (rsprox captures 90, 1105); the other pairs follow it (Ours). */
function churnMessage(row) {
  return `You churn your ${row.input.name} to make ${row.name}.`;
}

/**
 * One item: the product takes the input's slot and the milk's bucket a free one (rsprox capture
 * 90). Wiki: with no room, the product drops to the ground instead, and the bucket stays.
 */
function churnOne(player, row) {
  const { Item, ItemOnGroundManager, Skill } = Common.core;
  const inventory = player.getInventory();
  const slot = inventory.getSlotForItemId(row.input.id);
  if (slot < 0) return false;
  const product = new Item(row.productId, 1);
  if (row.input.returnId === null) {
    inventory.setItem(slot, product);
  } else if (inventory.getFreeSlots() > 0) {
    inventory.setItem(slot, product);
    inventory.addItem(new Item(row.input.returnId, 1));
  } else {
    inventory.setItem(slot, new Item(row.input.returnId, 1));
    ItemOnGroundManager.registers(player, product);
  }
  inventory.refreshItems();
  Common.spam(player, churnMessage(row));
  Common.addXp(player, row.xp);
  Common.api.emitCustomEvent("skills:produced", { player, skill: Skill.COOKING, itemId: row.productId, amount: 1, xp: row.xp, kind: "churn" });
  return true;
}

function playChurn(player, row) {
  player.performAnimation(new Common.core.Animation(row.seqId));
}

/**
 * Churns `amount`: the animation plays on the choice, the first item comes a cycle less a tick
 * later and each next one a full cycle after that, the animation starting again with each item
 * that has another after it (rsprox capture 90: butter 18 ticks after the choice, then 19).
 */
function start(player, rows, amount) {
  Common.core.TaskManager.cancelTasks(player.getIndex());
  let row = nextRow(player, rows);
  if (!row) return;
  let remaining = amount;
  let wait = row.ticks - 1;
  playChurn(player, row);
  Common.run(player, () => {
    if (--wait > 0) return true;
    const actions = Common.actionsPerCycle(player, "make");
    for (let done = 0; done < actions && remaining > 0; done++) {
      row = nextRow(player, rows);
      if (!row || !churnOne(player, row)) return false;
      remaining--;
    }
    row = nextRow(player, rows);
    if (remaining <= 0 || !row) return false;
    playChurn(player, row);
    wait = row.ticks;
    return true;
  });
}

/** Ours: no capture refuses a churn for level; the line is the one the item-on-item recipes use. */
function hasLevel(player, row) {
  if (Common.level(player) >= row.level) return true;
  const name = Common.core.ItemDefinition.forId(row.productId).getName().toLowerCase();
  Common.mesbox(player, `You need a Cooking level of ${row.level} to make ${Common.withArticle(name)}.`);
  return false;
}

/** Captured with one and two buckets of milk: the menu opens either way, on the most it can make. */
function offer(player, onlyInput = null) {
  const chosen = choices(player, onlyInput);
  if (chosen.size === 0) {
    player.sendMessage(NOTHING_TO_CHURN_MESSAGE);
    return;
  }
  const items = [...chosen.keys()];
  const most = Math.max(...[...chosen.values()].map((rows) => carriedFor(player, rows)));
  const { CreationMenu } = Common.core;
  player.getPacketSender().sendCreationMenu(new CreationMenu(MENU_TITLE, items, {
    execute: (itemId, amount) => {
      const rows = chosen.get(itemId);
      const row = rows && nextRow(player, rows);
      if (!row || !hasLevel(player, row)) return;
      const count = Math.min(amount, carriedFor(player, rows));
      if (count > 0) start(player, rows, count);
    },
  }, { mode: MENU_MODE, labels: items.map((id) => churnData().labels.get(id)), maxAmount: most, lastAmount: most }));
}

function isChurn(object) {
  return object?.getDefinition?.()?.getName?.() === "Dairy churn";
}

function churnClick(event) {
  offer(event.player);
}

function useOnChurn(event) {
  if (!isChurn(event.object)) return;
  if (!churnData().inputs.some((input) => input.id === event.itemId)) return;
  event.handled = true;
  offer(event.player, event.itemId);
}

module.exports = Object.assign(function attachChurn(api) {
  api.onObjectInteraction("Dairy churn", { Churn: churnClick });
  api.onItemOnObject(useOnChurn, { noted: false });
}, { _test: { churnData, choices, churnMessage, MENU_TITLE } });
