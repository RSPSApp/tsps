// Run after `yarn build`: node --test tests/direct-hits-boss-rules.test.cjs
//
// A thrall's attack, a ring of recoil and vengeance queue their hits straight to the target, past the
// NPC hit-modify hooks, so Nex and the Alchemical Hydra apply their rules to them as they land
// (`combat:damage-apply`). Wiki: Nex/Strategies ("all damage she receives will instead heal her"
// during a siphon; the dash is immune to "any hits"), Alchemical Hydra/Strategies (the shield
// "reduces incoming damage by 75%"), Thrall (its damage "counts as damage dealt by the player").
// Native fixture: every plugin loaded, a real Player and NPCs, the real thrall task and HitQueue.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { World } = require("../dist/game/World");
const { Misc } = require("../dist/util/Misc");
const { ArceuusThralls } = require("../dist/game/content/combat/magic/ArceuusThralls");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");

const NexCommon = require("../plugins/bosses/nex/Common.Nex");
const { Fight: NexFight } = require("../plugins/bosses/nex/Fight.Nex");
const HydraCommon = require("../plugins/bosses/alchemicalhydra/Common.AlchemicalHydra");
const { Fight: HydraFight } = require("../plugins/bosses/alchemicalhydra/Fight.AlchemicalHydra");

const HOME = [3222, 3218];
const GREATER_GHOST = 10880;
const THRALL_MAX = 3;
const NEX_HITPOINTS = 3400;

let core;
let next = 5800;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const at = (dx, dy) => new core.Location(HOME[0] + dx, HOME[1] + dy, 0);

function player(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("directhit" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(at(0, 0));
  p.needsPlacement = false;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return p;
}

function npc(t, id, hitpoints) {
  const n = core.NPC.create(id, at(2, 0));
  core.World.getNpcs().add(n);
  n.setRegistered(true);
  n.setNeedsPlacement?.(false);
  n.setHitpoints(hitpoints);
  t.after(() => core.World.getNpcs().remove(n));
  return n;
}

/** Summons a greater ghost that always rolls its max, targeting `target`, and registers it. */
function thrall(t, p, target, maxHit = THRALL_MAX) {
  t.mock.method(Misc, "getRandom", (max) => max);
  // A thrall lasts a tick per Magic level.
  p.getSkillManager().setCurrentLevel(core.Skill.MAGIC, 99, false);
  p.getCombat().setTarget(target);
  ArceuusThralls.summon(p, GREATER_GHOST, 0, maxHit, 6);
  const queue = World.getAddNPCQueue();
  while (queue.length > 0) {
    const ghost = queue.shift();
    core.World.getNpcs().add(ghost);
    ghost.setRegistered(true);
    t.after(() => core.World.getNpcs().remove(ghost));
  }
}

/** One game tick of the thrall's task, then `target`'s queued impacts. */
function ticks(target, count) {
  for (let i = 0; i < count; i++) {
    World.processCycle++;
    core.TaskManager.process();
    target.getCombat().getHitQueue().process(World.getProcessCycle());
  }
}

/** A Nex fight in its first (smoke) phase, as the fight's own state, on a real NPC. */
function nexFight(t, overrides = {}) {
  const boss = npc(t, NexCommon.data.npcs.nex, NEX_HITPOINTS);
  boss.setNpcTransformationId(NexCommon.data.npcs.nex);
  const fight = Object.create(NexFight.prototype);
  Object.assign(fight, {
    tick: 100, phaseIndex: 0, stage: "fighting", stopped: false, immuneUntil: 0, siphonUntil: 0,
    boss, contribution: new Map(), vulnerable: new Set(), reavers: [], events: [],
    record: { siphonHealed: false, hitBy: new Map(), coughing: new Set() },
    arena: { players: () => [] }, areaSound() {}, centre: () => null,
  }, overrides);
  boss.__nexFight = fight;
  t.after(() => { boss.__nexFight = null; });
  return { boss, fight };
}

test("Nex: a thrall's hit lands in full and is credited to its owner", (t) => {
  const p = player(t);
  const { boss, fight } = nexFight(t);
  thrall(t, p, boss);
  ticks(boss, 4);
  assert.equal(boss.getHitpoints(), NEX_HITPOINTS - THRALL_MAX);
  assert.equal(fight.contribution.get(p), THRALL_MAX);
});

test("Nex: during a siphon a thrall's hit heals her instead", (t) => {
  const p = player(t);
  const { boss, fight } = nexFight(t, { siphonUntil: Infinity });
  boss.setHitpoints(NEX_HITPOINTS - 50);
  thrall(t, p, boss);
  ticks(boss, 4);
  assert.equal(boss.getHitpoints(), NEX_HITPOINTS - 50 + THRALL_MAX);
  assert.equal(fight.record.siphonHealed, true);
  assert.equal(fight.contribution.get(p) ?? 0, 0);
});

test("Nex: a thrall's hit can't take her below the phase's floor", (t) => {
  const p = player(t);
  const floor = Math.floor(NEX_HITPOINTS * NexCommon.data.fight.phases[0].floor);
  const { boss } = nexFight(t);
  boss.setHitpoints(floor + 1);
  thrall(t, p, boss);
  ticks(boss, 4);
  assert.equal(boss.getHitpoints(), floor, "down to the floor");
  ticks(boss, 4);
  assert.equal(boss.getHitpoints(), floor, "and no further");
});

test("Nex: a thrall's hit on a vulnerable mage counts as its owner's share", (t) => {
  const p = player(t);
  const { fight } = nexFight(t);
  const mage = npc(t, NexCommon.data.npcs.mages.fumus, 350);
  mage.__nexFight = fight;
  mage.__nexMage = "fumus";
  fight.vulnerable.add("fumus");
  thrall(t, p, mage);
  ticks(mage, 4);
  assert.equal(mage.getHitpoints(), 350 - THRALL_MAX);
  assert.equal(fight.contribution.get(p), THRALL_MAX);
});

test("Nex: while she is immune a thrall's hit does nothing", (t) => {
  const p = player(t);
  const { boss } = nexFight(t, { immuneUntil: Infinity });
  thrall(t, p, boss);
  ticks(boss, 4);
  assert.equal(boss.getHitpoints(), NEX_HITPOINTS);
});

/** A Hydra in its serpentine phase, shielded unless told otherwise. */
function hydraFight(t, { shielded = true } = {}) {
  const hydra = npc(t, HydraCommon.ids.npcs.serpentine, 1100);
  const fight = new HydraFight({ players: () => [], contains: () => true }, hydra);
  fight.shielded = shielded;
  t.after(() => { hydra.__hydraFight = null; });
  return { hydra, fight };
}

test("Alchemical Hydra: its shield takes 75% off a thrall's hit, a recoil and vengeance", (t) => {
  const p = player(t);
  const { hydra } = hydraFight(t);
  thrall(t, p, hydra, 8);
  ticks(hydra, 4);
  assert.equal(hydra.getHitpoints(), 1100 - 2, "a thrall's 8 does 2");

  p.getEquipment().set(core.Equipment.RING_SLOT, new core.Item(core.ItemIdentifiers.RING_OF_RECOIL));
  CombatFactory.handleRecoil(p, hydra, 79); // 10% + 1 of 79: an 8 recoil
  ticks(hydra, 1);
  assert.equal(hydra.getHitpoints(), 1100 - 4, "a recoil's 8 does 2");

  CombatFactory.handleVengeance(p, hydra, 40); // 75% of 40: a 30 vengeance
  ticks(hydra, 1);
  assert.equal(hydra.getHitpoints(), 1100 - 4 - 7, "a vengeance's 30 does 7");
});

test("Alchemical Hydra: unshielded, a thrall's hit, a recoil and vengeance land in full", (t) => {
  const p = player(t);
  const { hydra } = hydraFight(t, { shielded: false });
  thrall(t, p, hydra, 8);
  ticks(hydra, 4);
  assert.equal(hydra.getHitpoints(), 1100 - 8);

  p.getEquipment().set(core.Equipment.RING_SLOT, new core.Item(core.ItemIdentifiers.RING_OF_RECOIL));
  CombatFactory.handleRecoil(p, hydra, 79);
  ticks(hydra, 1);
  assert.equal(hydra.getHitpoints(), 1100 - 16);

  CombatFactory.handleVengeance(p, hydra, 40);
  ticks(hydra, 1);
  assert.equal(hydra.getHitpoints(), 1100 - 16 - 30);
});
