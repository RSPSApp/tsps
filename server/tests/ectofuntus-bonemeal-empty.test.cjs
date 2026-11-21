const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Common = require("../plugins/skills/ectofuntus/Common.Ectofuntus");
const attachBonemeal = require("../plugins/skills/ectofuntus/Bonemeal.Ectofuntus");

let core;
const empties = new Map();
before(async () => {
  await CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  const api = {
    core,
    onItemAction(name, actions) {
      assert.equal(typeof actions.Empty, "function", `${name} registers Empty`);
      empties.set(name, actions.Empty);
    },
  };
  Common.init(api);
  attachBonemeal(api);
});

const obj = (name) => {
  const id = core.CacheDefinitions.getObjId(name);
  assert.ok(Number.isInteger(id), `missing cache item ${name}`);
  return id;
};

function player(meal, slot = 13) {
  const p = new Player(null);
  p.setUsername("BonemealEmpty");
  const packets = [];
  const sender = new Proxy({}, { get: (_, key) => (...args) => { packets.push([key, ...args]); return sender; } });
  p.getPacketSender = () => sender;
  const id = obj(meal);
  p.getInventory().setItem(slot, new core.Item(id, 1));
  return { p, packets, id, slot };
}

function emptyPot(h) {
  const name = core.CacheDefinitions.getItem(h.id).name;
  const handler = empties.get(name);
  assert.ok(handler, `no Empty for ${name}`);
  return handler({ player: h.p, itemId: h.id, slot: h.slot });
}

test("Empty on Big bonemeal leaves a pot in its slot, with synth 2584 and the captured spam line (rec 377)", () => {
  const h = player("pot_bonemeal_big");
  assert.equal(emptyPot(h), true);
  assert.equal(h.p.getInventory().getItems()[h.slot].getId(), core.ItemIdentifiers.POT);
  assert.equal(h.p.getInventory().getAmount(h.id), 0);
  assert.deepEqual(h.packets.find(([key]) => key === "sendSound").slice(1, 2), [2584]);
  const message = h.packets.find(([key]) => key === "sendTypedMessage");
  assert.equal(message[1], core.ChatType.SPAM);
  assert.equal(message[2], "You empty the pot of crushed big bones.");
});

test("every bonemeal in bones.json has Empty, naming its bones from the pot's name", () => {
  for (const meal of Common.bonemealObjs()) {
    const h = player(meal, 0);
    assert.equal(emptyPot(h), true, meal);
    assert.equal(h.p.getInventory().getItems()[0].getId(), core.ItemIdentifiers.POT, meal);
  }
  const text = (meal) => {
    const h = player(meal, 0);
    emptyPot(h);
    return h.packets.find(([key]) => key === "sendTypedMessage")[2];
  };
  assert.equal(text("pot_bonemeal"), "You empty the pot of crushed bones.");
  assert.equal(text("pot_bonemeal_dragon"), "You empty the pot of crushed dragon bones.");
  assert.equal(text("pot_bonemeal_babydragon"), "You empty the pot of crushed baby dragon bones.");
});

test("Empty does nothing when the clicked slot no longer holds the pot", () => {
  const h = player("pot_bonemeal_big", 5);
  h.p.getInventory().setItem(5, new core.Item(core.ItemIdentifiers.POT, 1));
  assert.equal(emptyPot(h), false);
  assert.equal(h.packets.length, 0);
});
