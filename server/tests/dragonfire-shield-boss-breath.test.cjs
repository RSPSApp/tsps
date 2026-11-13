// Run after `yarn build`: node --test tests/dragonfire-shield-boss-breath.test.cjs
// Wiki (Dragonfire shield): the worn shield "will absorb one charge per adult dragon dragonfire attack", so the King
// Black Dragon's and Vorkath's breaths charge it as Elvarg's do. Real engine: every plugin loaded, a real Player
// wearing an uncharged dragonfire shield, the bosses' own registered combat methods.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, Shield, VorkathShared, index = 9850;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
  Shield = require("../plugins/items/DragonfireShield.plugin")._test;
  VorkathShared = require("../plugins/bosses/vorkath/Shared.Vorkath");
});
after(() => PM.emitServerShutdown({}));

function wearer(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++); p.setUsername("dfs" + index); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(2272, 4695, 0));
  t.after(() => { core.TaskManager.cancelTasks(p.getIndex()); p.setRegistered(false); });
  const shield = new core.Item(core.ItemIdentifiers.DRAGONFIRE_SHIELD_2, 1);
  p.getEquipment().setItem(core.Equipment.SHIELD_SLOT, shield);
  const spam = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendTypedMessage", (type, text) => { spam.push(text); return sender; });
  return { p, spam, worn: () => p.getEquipment().get(core.Equipment.SHIELD_SLOT) };
}

test("the King Black Dragon's fiery breath charges a worn dragonfire shield", (t) => {
  const { p, spam, worn } = wearer(t);
  const kbd = core.NPC.create(core.NpcIdentifiers.KING_BLACK_DRAGON, new core.Location(2272, 4698, 0));
  const method = core.CombatFactory.getMethod(kbd);
  method.currentAttackType = core.CombatType.MAGIC;
  method.currentBreath = 0; // the fiery breath
  method.hits(kbd, p);
  assert.equal(worn().getId(), core.ItemIdentifiers.DRAGONFIRE_SHIELD, "the uncharged shield becomes the charged one");
  assert.equal(Shield.charges(worn()), 1);
  assert.ok(spam.includes("Your dragonfire shield glows more brightly."));
});

test("Vorkath's dragonfire breath charges a worn dragonfire shield when it lands", (t) => {
  const { p, spam, worn } = wearer(t);
  const vorkath = core.NPC.create(core.NpcIdentifiers.VORKATH_5, new core.Location(2269, 4062, 0));
  const method = core.CombatFactory.getMethod(vorkath);
  method.attack = VorkathShared.Attack.DRAGONFIRE;
  method.shotEnd = 60;
  const [hit] = method.hits(vorkath, p);
  assert.equal(Shield.charges(worn()), 0, "nothing until the breath lands");
  method.handleAfterHitEffects(hit);
  assert.equal(worn().getId(), core.ItemIdentifiers.DRAGONFIRE_SHIELD);
  assert.equal(Shield.charges(worn()), 1);
  assert.ok(spam.includes("Your dragonfire shield glows more brightly."));
});
