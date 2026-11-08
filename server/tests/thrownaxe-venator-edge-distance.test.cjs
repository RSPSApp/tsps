// Run after `yarn build`: node --test tests/thrownaxe-venator-edge-distance.test.cjs
// Ranged hits land by edge distance (RangedCombatMethod.landingDelays: the target's nearest tile). The rune thrownaxe's
// Chainhit spends its axe when its hit lands, and the venator bow's bounces start when its arrow lands; both used the
// south-west tile's distance, which on a large NPC is farther than the hit. Real engine: every plugin loaded, a real
// Player, a real size-5 NPC whose south-west tile is 9 away and whose nearest tile is 5.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function scene(t, weaponId, ammo) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9970); p.setUsername("edgethrower"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0)); p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(weaponId, 1));
  if (ammo) p.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, new core.Item(ammo, 100));
  const npc = core.NPC.create(core.NpcIdentifiers.KING_BLACK_DRAGON, new core.Location(3191, 3191, 0));
  assert.equal(npc.getSize(), 5);
  assert.equal(core.CombatPosition.edgeDistance(p, npc), 5);
  assert.equal(core.CombatPosition.projectileDistance(p, npc), 9);
  return { p, npc };
}

test("Chainhit spends its axe on the tick its hit lands on a large NPC", (t) => {
  const { p, npc } = scene(t, core.ItemIdentifiers.RUNE_THROWNAXE);
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.RUNE_THROWNAXE, 50));
  p.setSpecialPercentage?.(100);
  const delays = [];
  t.mock.method(core.CombatFactory, "decrementAmmo", (_player, _at, _amount, delay) => { delays.push(delay); return true; });
  const method = core.CombatSpecial.getById("rune_thrownaxe").getCombatMethod();
  method.start(p, npc);
  const hit = method.hits(p, npc)[0];
  assert.deepEqual(delays, [hit.getDelay() + 1], "the axe goes as the hit lands (+1 for an NPC's processing order)");
});

test("the venator bow's bounces start from where its arrow lands on a large NPC", (t) => {
  const Venator = require("../plugins/items/VenatorBow.plugin");
  const { p, npc } = scene(t, core.ItemIdentifiers.VENATOR_BOW, core.ItemIdentifiers.DRAGON_ARROW);
  const profile = core.WeaponProfiles.ranged(p).projectiles?.[0];
  assert.ok(profile, "the bow's arrow projectile");
  assert.equal(Venator._test.arrowEndCycle(p, npc), core.RangedCombatMethod.projectileEnd(profile, core.CombatPosition.edgeDistance(p, npc)));
});
