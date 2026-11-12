// Run after `yarn build`: node --test tests/destroy-item-prompts.test.cjs
//
// The destroy prompt (confirmdestroy, 584): each item's own note and question from
// plugins/interface/data/destroy-notes.json, and "destroy-item:confirm", which lets another option
// (Uncharge, Dismantle) ask on the same prompt.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { PacketSender } = require("../dist/net/packet/PacketSender");
const { Item } = require("../dist/game/model/Item");
const DestroyItem = require("../plugins/interface/DestroyItem.plugin");
const NOTES = require("../plugins/interface/data/destroy-notes.json").items;

const CONFIRM_BUTTON = 584 << 16;
const DEFAULT_QUESTION = "Are you sure you want to destroy this item?";
let core;
const hooks = { buttons: [], events: new Map(), dropPolicy: null };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  core = PluginManager.getCoreApi();
  DestroyItem.register({
    core: { ...core, PluginManager: { emitItemDropPolicy() {} } },
    onItemDropPolicy: (handler) => { hooks.dropPolicy = handler; },
    onInterfaceActionButton: (_, handler) => hooks.buttons.push(handler),
    onCustomEvent: (name, handler) => hooks.events.set(name, handler),
    emitCustomEvent: (name, payload) => hooks.events.get(name)?.(payload),
  });
});

const obj = (name) => core.CacheDefinitions.getObjId(name);

/** A player with a real PacketSender, so closing the prompt resets DestroyItem's pending item. */
function player(items) {
  const slots = [...items];
  while (slots.length < 28) slots.push(null);
  const attributes = new Map();
  const scripts = [];
  const p = {
    scripts,
    messages: [],
    getInventory: () => ({
      getItems: () => slots,
      deleteAtSlot: (slot) => { slots[slot] = null; },
    }),
    sendMessage: (message) => p.messages.push(message),
    getAttribute: (key) => attributes.get(key) ?? -1,
    setAttribute: (key, value) => attributes.set(key, value),
    getInterfaceId: () => -1,
    setInterfaceId: () => {},
    setStatus: () => {},
    getEnteredAmountAction: () => null,
    setEnteredAmountAction: () => {},
    setEnteredSyntaxAction: () => {},
    getDialogueManager: () => ({ reset: () => {} }),
    setCreationMenu: () => {},
    setSearchingBank: () => {},
    setTeleportInterfaceOpen: () => {},
    getAppearance: () => ({ setCanChangeAppearance: () => {} }),
    getFrameUpdater: () => ({ clearGroup: () => {} }),
    getSession: () => ({ sendClientPacket: () => true }),
  };
  const sender = new PacketSender(p);
  const sendClientScript = sender.sendClientScript.bind(sender);
  sender.sendClientScript = (id, ...args) => { scripts.push([id, ...args]); return sendClientScript(id, ...args); };
  p.getPacketSender = () => sender;
  return p;
}

function destroy(p, slot) {
  const item = p.getInventory().getItems()[slot];
  const event = { player: p, item, itemId: item.getId(), slot, dropToGround: false, handled: false };
  hooks.dropPolicy(event);
  return event;
}

function press(p, action) {
  const event = { player: p, action, buttonId: CONFIRM_BUTTON };
  for (const handler of hooks.buttons) if (handler(event) !== false) return true;
  return false;
}

test("every listed item is a cache obj that can't be dropped, so its Destroy shows its note", () => {
  for (const name of Object.keys(NOTES)) {
    const id = obj(name);
    assert.ok(Number.isInteger(id), `${name} is an obj gameval`);
    assert.equal(new Item(id, 1).isDropable(), false, `${name} asks before it is destroyed`);
  }
});

test("Destroy sends the item's own note, its own question where it has one, and ours for an unlisted item", () => {
  const helm = new Item(obj("ironman_helm"), 1);
  const tears = new Item(obj("fossil_glistening_tear"), 25);
  const unlisted = new Item(obj("looting_bag"), 1);
  const p = player([helm, tears, unlisted]);
  for (const slot of [0, 1, 2]) assert.equal(destroy(p, slot).handled, true);
  assert.deepEqual(p.scripts.map((script) => script.slice(1)), [
    [helm.getId(), 1, DEFAULT_QUESTION, "You can obtain another helmet from the Iron tutor in Lumbridge."],
    [tears.getId(), 25, "Destroy the entire stack?", "You will have to gather more tears underwater around Fossil Island."],
    [unlisted.getId(), 1, DEFAULT_QUESTION, "This item will be destroyed permanently."],
  ]);
});

test("destroy-item:confirm asks with the given question and note; only Yes runs the action", () => {
  const sceptre = new Item(obj("wild_cave_accursed_charged"), 1);
  for (const [action, ran] of [[1, true], [0, false]]) {
    const p = player([null, sceptre]);
    const confirmed = [];
    const request = { player: p, item: sceptre, slot: 1, question: "Q?", note: "N.", confirm: (who, item) => confirmed.push([who, item]) };
    hooks.events.get("destroy-item:confirm")(request);
    assert.equal(request.opened, true);
    assert.deepEqual(p.scripts.at(-1), [814, sceptre.getId(), 1, "Q?", "N."]);
    assert.equal(press(p, action), true);
    assert.deepEqual(confirmed, ran ? [[p, sceptre]] : []);
    assert.equal(p.getInventory().getItems()[1], sceptre, "the prompt itself destroys nothing");
    assert.equal(press(p, 1), false, "the prompt is closed");
  }
});

test("destroy-item:confirm replaces a pending Destroy, and a moved item cancels it", () => {
  const helm = new Item(obj("ironman_helm"), 1);
  const sceptre = new Item(obj("wild_cave_accursed_charged"), 1);
  const p = player([helm, sceptre]);
  destroy(p, 0);
  const confirmed = [];
  hooks.events.get("destroy-item:confirm")({ player: p, item: sceptre, slot: 1, question: "Q?", note: "N.", confirm: () => confirmed.push(1) });
  // Moved to another slot while the prompt is open.
  const slots = p.getInventory().getItems();
  [slots[1], slots[2]] = [null, sceptre];
  assert.equal(press(p, 1), true);
  assert.deepEqual(confirmed, []);
  assert.equal(slots[0], helm, "Yes did not destroy the helm Destroy named");
});
