// Run after `yarn build`: node --test tests/dye-mixing.test.cjs
// rsprox captures (227/00090 t5349, local 1000216 t511, 232/03198 t6731, 242/900302 t749): two primary dyes used on
// each other make the secondary one in the lower slot, empty the higher slot, play mixing_dyes_<pair> and send
// "You mix the two dyes and make a(n) <colour> one." Real Player, real cache, real item-on-item dispatch.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

let core, obj, seq;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  obj = (name) => core.CacheDefinitions.getObjId(name);
  seq = (name) => core.CacheDefinitions.getSeqId(name);
  // Goblin Diplomacy's own item-on-item hook goes first, as it once mixed orange dye itself.
  require("../plugins/quests/quests/GoblinDiplomacy.Quest")(PluginManager.createApi("GoblinDiplomacyTest"));
  require("../plugins/items/DyeMixing.plugin").register(PluginManager.createApi("DyeMixingTest"));
});

function player(slots) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("dyemixer");
  const messages = [];
  const animations = [];
  p.sendMessage = (text) => messages.push(["game", text]);
  const sender = p.getPacketSender();
  sender.sendTypedMessage = (type, text) => messages.push([type === core.ChatType.SPAM ? "spam" : String(type), text]);
  p.performAnimation = (animation) => animations.push(animation.getId());
  for (const [slot, name] of Object.entries(slots)) p.getInventory().setItem(Number(slot), new core.Item(obj(name), 1));
  return { p, messages, animations, at: (slot) => p.getInventory().getItems()[slot]?.getId?.() ?? -1 };
}

function use(p, usedSlot, targetSlot) {
  const items = p.getInventory().getItems();
  const event = {
    player: p, usedItem: items[usedSlot], usedWithItem: items[targetSlot],
    usedItemId: items[usedSlot].getId(), usedWithItemId: items[targetSlot].getId(),
    usedItemSlot: usedSlot, usedWithItemSlot: targetSlot, handled: false,
  };
  return PluginManager.emitItemOnItem(event);
}

for (const [used, target, result, sequence, line] of [
  ["yellowdye", "reddye", "orangedye", "mixing_dyes_red+yellow", "You mix the two dyes and make an orange one."],
  ["reddye", "yellowdye", "orangedye", "mixing_dyes_red+yellow", "You mix the two dyes and make an orange one."],
  ["bluedye", "yellowdye", "greendye", "mixing_dyes_blue+yellow", "You mix the two dyes and make a green one."],
  ["yellowdye", "bluedye", "greendye", "mixing_dyes_blue+yellow", "You mix the two dyes and make a green one."],
  ["reddye", "bluedye", "purpledye", "mixing_dyes_red+blue", "You mix the two dyes and make a purple one."],
  ["bluedye", "reddye", "purpledye", "mixing_dyes_red+blue", "You mix the two dyes and make a purple one."],
]) {
  test(`${used} on ${target} makes ${result} in the lower slot`, () => {
    const t = player({ 8: used, 7: target });
    assert.equal(use(t.p, 8, 7), true);
    assert.equal(t.at(7), obj(result), "the lower (target's) slot holds the new dye");
    assert.equal(t.at(8), -1, "the higher (used dye's) slot empties");
    assert.deepEqual(t.messages, [["spam", line]], "a spam-filtered line, as captured");
    assert.deepEqual(t.animations, [seq(sequence)]);
  });
}

test("a lower-slot dye used on a higher-slot one leaves the result in the used dye's slot (227/00090 t5348)", () => {
  // Captured: red in slot 7 used on yellow in slot 8; orange lands in 7 and 8 empties.
  const t = player({ 7: "reddye", 8: "yellowdye" });
  assert.equal(use(t.p, 7, 8), true);
  assert.deepEqual([t.at(7), t.at(8)], [obj("orangedye"), -1]);
});

test("two of the same dye, or a secondary dye, mix into nothing", () => {
  const t = player({ 0: "reddye", 1: "reddye", 2: "orangedye", 3: "bluedye" });
  assert.equal(use(t.p, 0, 1), false);
  assert.equal(use(t.p, 2, 3), false);
  assert.deepEqual([t.at(0), t.at(1), t.at(2), t.at(3)], [obj("reddye"), obj("reddye"), obj("orangedye"), obj("bluedye")]);
  assert.deepEqual(t.messages, []);
});

test("only the two clicked dyes are used; a spare dye stays", () => {
  const t = player({ 0: "reddye", 1: "reddye", 2: "yellowdye" });
  use(t.p, 2, 1);
  assert.deepEqual([t.at(0), t.at(1), t.at(2)], [obj("reddye"), obj("orangedye"), -1]);
  const u = player({ 0: "reddye", 1: "yellowdye", 2: "reddye" });
  use(u.p, 2, 1);
  assert.deepEqual([u.at(0), u.at(1), u.at(2)], [obj("reddye"), obj("orangedye"), -1]);
});
