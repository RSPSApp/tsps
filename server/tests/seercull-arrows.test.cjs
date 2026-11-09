// Run after `yarn build`: node --test tests/seercull-arrows.test.cjs
//
// Wiki (Seercull): it fires arrows "up to Amethyst"; Wiki (Dragon arrow): "only usable with the dark bow, twisted bow,
// venator bow, scorching bow, and the 3rd Age bow". A real Player and its equipment.
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

function fires(t, weapon, ammo) {
  const p = new Player(new BotPlayerSession());
  p.setUsername("seercull");
  t.mock.method(p, "sendMessage", () => {});
  t.mock.method(p.getPacketSender(), "sendMessage", () => p.getPacketSender());
  p.getEquipment().setItem(Equipment.WEAPON_SLOT, new core.Item(weapon, 1));
  p.getEquipment().setItem(Equipment.AMMUNITION_SLOT, new core.Item(ammo, 50));
  CombatFactory.getMethod(p);
  return CombatFactory.checkAmmo(p, 1);
}

test("the Seercull fires amethyst arrows but not dragon arrows", (t) => {
  assert.equal(fires(t, I.SEERCULL, I.AMETHYST_ARROW), true);
  assert.equal(fires(t, I.SEERCULL, I.RUNE_ARROW), true);
  assert.equal(fires(t, I.SEERCULL, I.DRAGON_ARROW), false);
  assert.equal(fires(t, I.DARK_BOW, I.DRAGON_ARROW), true, "the dark bow still does");
});
