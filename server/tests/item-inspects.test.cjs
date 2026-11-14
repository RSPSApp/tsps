// Inspect object boxes, from rsprox.net index recordings (rev 235): stormy key 856/3461/3457,
// fetid key 908, serrated key 936, barrel stand 3457/3461, bottled storm 937. A real Player and cache.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const ItemInspects = require("../plugins/items/ItemInspects.plugin");

const actions = new Map();
let core;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const api = PluginManager.createApi("ItemInspectsTest");
  ItemInspects.register(new Proxy(api, {
    get: (target, name) => name === "onItemAction"
      ? (item, options) => { actions.set(item, options); return target.onItemAction(item, options); }
      : target[name],
  }));
});

const obj = (gameval) => core.CacheDefinitions.getObjId(gameval);

function fixture() {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  const sent = { strings: [], items: [], messages: [], chatbox: [] };
  const sender = player.getPacketSender();
  const wrap = (name, fn) => { const real = sender[name].bind(sender); sender[name] = (...args) => { fn(...args); return real(...args); }; };
  wrap("sendString", (text, uid) => sent.strings.push([uid, text]));
  wrap("sendItemOnInterfaces", (uid, item, zoom) => sent.items.push([uid, item, zoom]));
  wrap("sendTypedMessage", (_type, text) => sent.messages.push(text));
  wrap("sendChatboxInterface", (group) => sent.chatbox.push(group));
  return { player, sent };
}

// The object box text as live sent it (if_settext objectbox:text), and the chat line.
const CAPTURED = {
  stormy_key: "As you inspect the key, a tingling sensation shoots up<br>your arm. You feel charged and ready to explore for<br>the lock it opens.",
  fetid_key: "As you inspect the key, an acrid aroma fills the air.<br>Hopefully it won't take too long to find what it opens.",
  serrated_key: "As you inspect the key you almost cut yourself on its<br>sharp edges. Whoever created it clearly didn't intend<br>for it to be used easily.",
  barrel_stand: "A collection of oak and steel of exquisite craftsmanship,<br>built to withstand the harsh conditions at sea. It can be<br>used to build a barrel stand on a boat.",
  bottled_storm: "The container shakes violently, thrumming with magical<br>energy. You reckon it might be useful for shipbuilding.",
};

test("each item's cache name is hooked with Inspect", () => {
  for (const gameval of Object.keys(CAPTURED)) {
    const name = core.ItemDefinition.forId(obj(gameval)).getName();
    assert.ok(actions.get(name)?.Inspect, `${gameval} (${name}) has no Inspect hook`);
  }
});

test("Inspect opens the object box with the item at zoom 400 and live's wrapped line, and the chat line", () => {
  for (const [gameval, text] of Object.entries(CAPTURED)) {
    const { player, sent } = fixture();
    const name = core.ItemDefinition.forId(obj(gameval)).getName();
    actions.get(name).Inspect({ player, itemId: obj(gameval), slot: 0 });
    assert.deepEqual(sent.chatbox, [193], gameval);
    assert.deepEqual(sent.items, [[(193 << 16) | 1, obj(gameval), 400]], gameval);
    assert.deepEqual(sent.strings, [[(193 << 16) | 2, text]], gameval);
    assert.deepEqual(sent.messages, [text.replace(/<br>/g, " ")], gameval);
  }
});

test("Inspect changes nothing in the inventory", () => {
  const { player } = fixture();
  player.getInventory().setItem(3, new core.Item(obj("stormy_key"), 1));
  actions.get("Stormy key").Inspect({ player, itemId: obj("stormy_key"), slot: 3 });
  assert.equal(player.getInventory().getItems()[3]?.getId(), obj("stormy_key"));
  assert.equal(player.getInventory().getAmount(obj("stormy_key")), 1);
});
