// Run after `yarn build`: node --test tests/ranged-last-ammo.test.cjs
//
// rsprox_transcripts/227/00096.txt:101682-101707: the last arrow goes and the ammo slot clears with no line; the next
// attempt says "There is no ammo left in your quiver." A real Player and its equipment.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { BotPlayerSession } = require("../dist/net/BotPlayerSession");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");

let core, I;
before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  I = core.ItemIdentifiers;
});

test("the last arrow clears the ammo slot without a line", (t) => {
  const p = new Player(new BotPlayerSession());
  p.setUsername("lastarrow");
  const messages = [];
  t.mock.method(p, "sendMessage", (m) => messages.push(m));
  p.getEquipment().setItem(Equipment.WEAPON_SLOT, new core.Item(I.MAGIC_SHORTBOW, 1));
  p.getEquipment().setItem(Equipment.AMMUNITION_SLOT, new core.Item(I.RUNE_ARROW, 1));
  CombatFactory.getMethod(p);
  CombatFactory.decrementAmmo(p, null, 1);
  assert.equal(p.getEquipment().get(Equipment.AMMUNITION_SLOT).getId(), -1, "the slot clears");
  assert.ok(!messages.includes("You have run out of ammunition!"), messages.join(" | "));
});
