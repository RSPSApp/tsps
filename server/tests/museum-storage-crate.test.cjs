// Varrock Museum storage crate: common finds for a random reward.
// From server/: node --test tests/museum-storage-crate.test.cjs
//
// Recorded in rsprox local 1000153 (arrowheads on the crate: the warning menu, then the reward
// in the find's slot); the reward table is the Wiki's (Storage crate).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { DialogueManager } = require("../dist/game/model/dialogues/DialogueManager");
const { OptionDialogue } = require("../dist/game/model/dialogues/entries/impl/OptionDialogue");
const { Item } = require("../dist/game/model/Item");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");

const StorageCrate = require("../plugins/world/museum/StorageCrate.Museum.js");
const Museum = require("../plugins/world/Museum.plugin.js");
const DATA = require("../plugins/world/data/museum-storage-crate.json");

const TITLE = "Finds placed in this crate cannot be retrieved.";
const PLACED = "You place the find into the crate with all the others and pick up your reward from the crate.";
const STATE = "museum:state";
const { ChatType } = PluginManager.getCoreApi();

let ids;
let hooks;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const obj = (name) => CacheDefinitions.getObjId(name);
  ids = {
    crate: CacheDefinitions.getLocId("vm_crate"),
    arrowheads: obj("vm_arrow_heads_inv"),
    jewellery: obj("vm_jewllery_inv"),
    pottery: obj("vm_pottery_inv"),
    vase: obj("vm_vase_inv"),
    oldCoin: obj("vm_saranthium_inv"),
    lamp: obj("vm_reward_digsite"),
    warning: CacheDefinitions.getVarbitId("vm_crate_warningdisabled"),
    pickup: CacheDefinitions.getSeqId("human_pickupfloor"),
    tinse: CacheDefinitions.getNpcId("vm_archaeologist6_npc_dummy"),
  };
  hooks = { named: new Map(), itemOnObject: [], login: [] };
  StorageCrate({
    core: PluginManager.getCoreApi(),
    onObjectInteraction: (name, actions) => hooks.named.set(name, actions),
    onItemOnObject: (itemName, objectName, fn) => hooks.itemOnObject.push({ itemName, objectName, fn }),
    onPlayerLogin: (fn) => hooks.login.push(fn),
  });
});

function makePlayer(items, attributes = {}) {
  const attrs = new Map(Object.entries(attributes));
  let chatbox = null;
  const player = { messages: [], spam: [], sounds: [], animations: [], varbits: [] };
  const sender = new Proxy({}, { get: (_target, key) => {
    if (key === "sendChatboxInterface") return (id) => { chatbox = id; return sender; };
    if (key === "isChatboxInterface") return (id) => chatbox === id;
    if (key === "sendInterfaceRemoval") return () => { chatbox = null; return sender; };
    if (key === "sendTypedMessage") return (type, text) => { if (type === ChatType.SPAM) player.spam.push(text); return sender; };
    if (key === "sendSound") return (id, _volume, delay) => { player.sounds.push([id, delay]); return sender; };
    if (key === "sendVarbit") return (id, value) => { player.varbits.push([id, value]); return sender; };
    return () => sender;
  } });
  Object.assign(player, {
    getPacketSender: () => sender,
    sendMessage(text) { player.messages.push(text); },
    performAnimation(animation) { player.animations.push(animation.getId()); },
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    attrs,
  });
  const manager = new DialogueManager(player);
  player.getDialogueManager = () => manager;
  const inventory = new Inventory(player);
  player.getInventory = () => inventory;
  items.forEach(([id, amount], slot) => { if (id != null) inventory.setItem(slot, new Item(id, amount ?? 1)); });
  return player;
}

function use(player, itemId, slot) {
  const event = { player, itemId, itemSlot: slot, objectId: ids.crate, handled: false };
  // The named overload: exact item and object names, handled unless the handler returns false.
  for (const hook of hooks.itemOnObject) {
    if (event.handled || CacheDefinitions.getItem(itemId).name !== hook.itemName || hook.objectName !== "Storage crate") continue;
    if (hook.fn(event) !== false) event.handled = true;
  }
  return event;
}

function menu(player) {
  const current = player.getDialogueManager().getCurrent();
  return current instanceof OptionDialogue ? { title: current.getTitle(), options: current.getOptions() } : null;
}

function choose(player, option) {
  return player.getDialogueManager().handleResume(OptionDialogue.OPTIONS_WIDGET_ID, option);
}

function idAt(player, slot) {
  return player.getInventory().getItems()[slot].getId();
}

const REWARD_IDS = new Set(DATA.rewards.map((entry) => entry.item));
const BOWL = 1923;

/** Runs `fn` with every roll landing on the table's bowl row (weights 19-39 of 195). */
function withBowls(fn) {
  const original = Math.random;
  Math.random = () => 25 / 195;
  try { fn(); } finally { Math.random = original; }
}

test("using a find opens the recorded warning menu, naming the used item", () => {
  const player = makePlayer([[ids.pottery], [ids.arrowheads]]);
  const event = use(player, ids.arrowheads, 1);
  assert.equal(event.handled, true);
  assert.deepEqual(menu(player), {
    title: TITLE,
    options: [
      "Place all your finds in the crate.",
      "Place that item in the crate: Arrowheads",
      "Place all your finds, and don't ask this again.",
      "Keep your items.",
    ],
  });
  assert.equal(idAt(player, 1), ids.arrowheads, "nothing is placed before the choice");
});

test("placing that item swaps only it for a reward in its own slot, with the recorded feedback", () => {
  const player = makePlayer([[ids.pottery], [ids.arrowheads], [null], [ids.vase]]);
  use(player, ids.arrowheads, 1);
  assert.equal(choose(player, 2), true);
  assert.equal(idAt(player, 0), ids.pottery);
  assert.ok(REWARD_IDS.has(idAt(player, 1)), "the reward lands in the find's slot");
  assert.equal(idAt(player, 3), ids.vase);
  assert.deepEqual(player.spam, [PLACED]);
  assert.deepEqual(player.animations, [ids.pickup]);
  assert.deepEqual(player.sounds, [[2739, 15]]);
  const thanks = player.getDialogueManager().getCurrent();
  assert.equal(thanks?.getText?.(), "Thanks for helping us out; we really do appreciate it.");
  assert.equal(thanks?.getNpcId?.(), ids.tinse);
});

test("placing all finds swaps every common find, and leaves display artefacts and other items", () => withBowls(() => {
  const player = makePlayer([[ids.pottery], [ids.jewellery], [ids.oldCoin], [ids.vase], [ids.arrowheads]]);
  use(player, ids.jewellery, 1);
  choose(player, 1);
  for (const slot of [0, 1, 3, 4]) assert.equal(idAt(player, slot), BOWL, `slot ${slot} rewarded in place`);
  assert.equal(idAt(player, 2), ids.oldCoin, "an old coin is for the display case, not the crate");
  assert.equal(player.spam.length, 1);
}));

test("keeping the items changes nothing", () => {
  const player = makePlayer([[ids.pottery]]);
  use(player, ids.pottery, 0);
  choose(player, 4);
  assert.equal(idAt(player, 0), ids.pottery);
  assert.deepEqual(player.spam, []);
  assert.equal(player.getDialogueManager().isActive(), false);
});

test("don't ask again sets vm_crate_warningdisabled, skips the menu next time and survives a login", () => withBowls(() => {
  const player = makePlayer([[ids.pottery], [ids.vase]]);
  use(player, ids.pottery, 0);
  choose(player, 3);
  assert.deepEqual(player.varbits, [[ids.warning, 1]]);
  assert.deepEqual([idAt(player, 0), idAt(player, 1)], [BOWL, BOWL]);
  const saved = player.attrs.get(STATE);
  assert.equal(saved.crateWarningDisabled, true);

  const next = makePlayer([[ids.arrowheads]], { [STATE]: saved });
  for (const fn of hooks.login) fn({ player: next });
  assert.deepEqual(next.varbits, [[ids.warning, 1]]);
  use(next, ids.arrowheads, 0);
  assert.equal(idAt(next, 0), BOWL, "placed without a menu");
  assert.deepEqual(next.spam, [PLACED]);
}));

test("the use hooks are named for the four finds on the Storage crate", () => {
  assert.deepEqual(hooks.itemOnObject.map((hook) => hook.objectName), Array(4).fill("Storage crate"));
  assert.deepEqual(hooks.itemOnObject.map((hook) => hook.itemName).sort(),
    [ids.arrowheads, ids.jewellery, ids.pottery, ids.vase].map((id) => CacheDefinitions.getItem(id).name).sort());
  const other = { player: makePlayer([[ids.pottery]]), itemId: ids.pottery, itemSlot: 0, objectId: ids.crate + 1, handled: false };
  assert.equal(hooks.itemOnObject.find((hook) => hook.itemName === "Pottery").fn(other), false, "other storage crates fall through");
});

test("Add finds opens the menu without the single-item line, and refuses with no finds", () => {
  const addFinds = hooks.named.get("Storage crate")["Add finds"];
  const player = makePlayer([[ids.arrowheads]]);
  assert.notEqual(addFinds({ player, objectId: ids.crate }), false);
  assert.deepEqual(menu(player).options, [
    "Place all your finds in the crate.",
    "Place all your finds, and don't ask this again.",
    "Keep your items.",
  ]);
  const empty = makePlayer([[995, 10]]);
  addFinds({ player: empty, objectId: ids.crate });
  assert.equal(menu(empty), null);
  assert.equal(empty.messages.length, 1);
  assert.equal(addFinds({ player: empty, objectId: ids.crate + 1 }), false, "other storage crates pass through");
});

test("a find moved away before the choice is not placed", () => {
  const player = makePlayer([[ids.arrowheads]]);
  use(player, ids.arrowheads, 0);
  player.getInventory().setItem(0, new Item(-1, 0));
  choose(player, 2);
  assert.deepEqual(player.spam, []);
  assert.equal(player.getDialogueManager().isActive(), false);
});

test("placing that item follows the used find when the inventory is rearranged", () => withBowls(() => {
  const player = makePlayer([[ids.pottery], [ids.arrowheads]]);
  use(player, ids.pottery, 0);
  player.getInventory().swap(0, 1); // the inventory-move packet, with the menu still open
  choose(player, 2);
  assert.equal(idAt(player, 0), ids.arrowheads, "the other find now in the old slot stays");
  assert.equal(idAt(player, 1), BOWL, "the pottery is the one placed");
}));

test("a reward that would overflow the carried stack keeps the find", () => {
  const original = Math.random;
  Math.random = () => 0; // coins, the table's minimum of 19
  try {
    const player = makePlayer([[995, 2147483647], [ids.arrowheads], [ids.pottery]]);
    use(player, ids.arrowheads, 1);
    choose(player, 1);
    assert.equal(player.getInventory().getAmount(995), 2147483647);
    assert.equal(idAt(player, 1), ids.arrowheads);
    assert.equal(idAt(player, 2), ids.pottery);
    assert.deepEqual(player.spam, []);
    assert.deepEqual(player.messages, ["You don't have enough inventory space."]);

    const nearly = makePlayer([[995, 2147483647 - 19], [ids.arrowheads], [ids.pottery]]);
    use(nearly, ids.arrowheads, 1);
    choose(nearly, 1);
    assert.equal(nearly.getInventory().getAmount(995), 2147483647, "the first reward fits exactly");
    assert.equal(idAt(nearly, 2), ids.pottery, "the second would overflow and stays");
    assert.deepEqual(nearly.spam, [PLACED]);
  } finally {
    Math.random = original;
  }
});

test("a stackable reward joins the stack already carried", () => {
  const original = Math.random;
  Math.random = () => 0; // the first row: coins, the table's minimum of 19
  try {
    const player = makePlayer([[995, 100], [ids.arrowheads]]);
    use(player, ids.arrowheads, 1);
    choose(player, 2);
    assert.equal(player.getInventory().getAmount(995), 119);
    assert.equal(idAt(player, 1), -1);
  } finally {
    Math.random = original;
  }
});

test("the reward table is the Wiki's 195 weights and rolls every row", () => {
  assert.equal(DATA.rewards.reduce((sum, entry) => sum + entry.weight, 0), 195);
  for (const entry of DATA.rewards) assert.equal(CacheDefinitions.getItem(entry.item).name, entry.name);
  let cumulative = 0;
  for (const entry of DATA.rewards) {
    const roll = StorageCrate.rollReward(() => (cumulative + 0.5) / 195);
    assert.equal(roll.itemId, entry.item);
    cumulative += entry.weight;
  }
  assert.deepEqual(StorageCrate.rollReward(() => 0.99999), { itemId: ids.lamp, amount: 1 });
  assert.deepEqual(StorageCrate.rollReward(() => 0), { itemId: 995, amount: 19 });
  const darts = DATA.rewards.find((entry) => entry.name === "Iron dart");
  assert.deepEqual([darts.min, darts.max], [1, 50]);
});

test("the crate's antique lamp rubs for 500 XP in a skill of 10 or more", () => {
  const events = [];
  const rub = {};
  Museum.register(new Proxy({
    core: PluginManager.getCoreApi(),
    onItemAction: (name, actions) => { if (name === "Antique lamp") Object.assign(rub, actions); },
    emitCustomEvent: (name, payload) => events.push([name, payload]),
    registerArea: () => {},
  }, { get: (target, key) => target[key] ?? (() => {}) }));
  const player = makePlayer([[ids.lamp]]);
  const item = player.getInventory().getItems()[0];
  assert.equal(rub.Rub({ player, itemId: ids.lamp, item, slot: 0 }), true);
  const [name, payload] = events.find(([key]) => key === "xpreward:open");
  assert.equal(name, "xpreward:open");
  assert.equal(payload.minLevel, 10);

  const skill = { getName: () => "Mining" };
  const gained = [];
  let xp = 0;
  player.getSkillManager = () => ({
    getMaxLevel: () => 10,
    getExperience: () => xp,
    addExperience: (_skill, amount) => { gained.push(amount); xp += amount; },
  });
  const granted = payload.onConfirm(skill, "Mining");
  assert.deepEqual(gained, [500]);
  assert.match(granted, /500 Mining experience/);
  assert.equal(player.getInventory().getAmount(ids.lamp), 0, "the lamp is used up");
});
