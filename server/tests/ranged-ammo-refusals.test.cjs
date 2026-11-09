// Run after `yarn build`: node --test tests/ranged-ammo-refusals.test.cjs
//
// The ammo refusals as recorded: a bow with an empty ammo slot, "There is no ammo left in your quiver."
// (rsprox_transcripts/229/02760.txt:7555, 227/00096.txt:101707); the wrong ammo, "You can't use that ammo with your
// bow." (227/00550.txt:395792) / "...with your crossbow." (230/00356.txt:8615). A real Player and its equipment.
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

function archer(t, weapon, ammo = null) {
  const p = new Player(new BotPlayerSession());
  p.setUsername("archer");
  const messages = [];
  t.mock.method(p, "sendMessage", (m) => messages.push(m));
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  p.getEquipment().setItem(Equipment.WEAPON_SLOT, new core.Item(weapon, 1));
  if (ammo) p.getEquipment().setItem(Equipment.AMMUNITION_SLOT, new core.Item(ammo, 50));
  CombatFactory.getMethod(p);
  return { p, messages };
}

test("an empty ammo slot: 'There is no ammo left in your quiver.'", (t) => {
  const { p, messages } = archer(t, I.MAGIC_SHORTBOW);
  assert.equal(CombatFactory.checkAmmo(p, 1), false);
  assert.deepEqual([...new Set(messages)], ["There is no ammo left in your quiver."]);
});

test("the wrong ammo: 'You can't use that ammo with your bow.' / '...crossbow.'", (t) => {
  const bow = archer(t, I.OAK_SHORTBOW, I.RUNE_ARROW);
  assert.equal(CombatFactory.checkAmmo(bow.p, 1), false);
  assert.deepEqual([...new Set(bow.messages)], ["You can't use that ammo with your bow."]);
  const crossbow = archer(t, I.BRONZE_CROSSBOW, I.RUNITE_BOLTS);
  assert.equal(CombatFactory.checkAmmo(crossbow.p, 1), false);
  assert.deepEqual([...new Set(crossbow.messages)], ["You can't use that ammo with your crossbow."]);
});

test("the right ammo still fires", (t) => {
  const { p, messages } = archer(t, I.MAGIC_SHORTBOW, I.RUNE_ARROW);
  assert.equal(CombatFactory.checkAmmo(p, 1), true);
  assert.deepEqual(messages, []);
});
