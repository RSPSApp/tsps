// Run after `yarn build`: node --test tests/area-attacks-target-zone.test.cjs
// Wiki (Multicombat area): whether an area attack reaches more than its target depends on the zone the target stands
// in, not the attacker's: a player on a single-way tile still hits several opponents standing in multi. Real engine:
// every plugin loaded, a real Player and real NPCs on the real single/multi border at 3278/3279,3156.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const { World } = require("../dist/game/World");

let core;
let I;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const SINGLE = [3275, 3156];
const MULTI = [3279, 3156];
const MULTI_BESIDE = [3280, 3156];
const SINGLE_BESIDE = [3277, 3156];

let next = 9610;
function scene(t, weapon, amount, at, targetAt, bystanderAt) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("zone" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(at[0], at[1], 0)); p.needsPlacement = false;
  t.after(() => { core.TaskManager.cancelTasks(p.getIndex()); p.setRegistered(false); });
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(weapon, amount));
  core.WeaponInterfaceManager.assign(p);
  const target = core.NPC.create(core.NpcIdentifiers.GIANT_BAT, new core.Location(targetAt[0], targetAt[1], 0));
  const bystander = core.NPC.create(core.NpcIdentifiers.GIANT_BAT, new core.Location(bystanderAt[0], bystanderAt[1], 0));
  for (const npc of [target, bystander]) {
    World.getNpcs().add(npc, true);
    t.after(() => World.getNpcs().remove(npc));
  }
  t.mock.method(p, "getLocalNpcs", () => new Map([[1, target], [2, bystander]]));
  t.mock.method(core.PendingHit.prototype, "isAccurate", () => true);
  return { p, target, bystander };
}

const struck = (hits) => new Set(hits.map((hit) => hit.getTarget()));

test("the border tiles: the attacker's tile is single-way, the target's and the bystander's multi", (t) => {
  const { p, target, bystander } = scene(t, I.RED_CHINCHOMPA_2, 100, SINGLE, MULTI, MULTI_BESIDE);
  assert.deepEqual([AreaManager.inMulti(p), AreaManager.inMulti(target), AreaManager.inMulti(bystander)], [false, true, true]);
  assert.equal(core.CombatFactory.areaAttackSpreads(p, target), true, "the target's zone decides");
  assert.equal(core.CombatFactory.areaAttackSpreads(target, p), false, "a target in single-way: no spread");
});

test("a chinchompa thrown from a single-way tile at a target in multi hits the bystander too", (t) => {
  const { p, target, bystander } = scene(t, I.RED_CHINCHOMPA_2, 100, SINGLE, MULTI, MULTI_BESIDE);
  const method = core.CombatFactory.getMethod(p);
  const hits = method.hits(p, target);
  assert.ok(struck(hits).has(bystander), "the blast reaches the bystander in multi");
});

test("a chinchompa thrown from multi at a target in single-way hits the target only", (t) => {
  const { p, target } = scene(t, I.RED_CHINCHOMPA_2, 100, MULTI, SINGLE_BESIDE, SINGLE);
  const hits = core.CombatFactory.getMethod(p).hits(p, target);
  assert.deepEqual([...struck(hits)], [target]);
});

test("Chainhit from a single-way tile at a target in multi bounces to the bystander", (t) => {
  const { p, target, bystander } = scene(t, I.RUNE_THROWNAXE, 50, SINGLE, MULTI, MULTI_BESIDE);
  p.setSpecialPercentage(100);
  const method = core.CombatSpecial.getById("rune_thrownaxe").getCombatMethod();
  const hits = method.hits(p, target);
  assert.ok(struck(hits).has(bystander), "the axe bounces on in multi");
});
