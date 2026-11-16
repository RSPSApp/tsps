// Run after `yarn build`: node --test tests/akd-boss-protection-prayers.test.cjs
// Wiki (Protection prayers; Xamphur; Judge of Yama (A Kingdom Divided)): Xamphur uses Protect from Magic during the
// fight and the Judge Protect from Missiles and Magic simultaneously; the cache draws those overheads on their combat
// ids (headicons_prayer 2 and 6). They prayed nothing, so every style hurt them. Real engine: every plugin loaded, a
// real Player logging in at the fight's stage, the NPC the quest spawns, and real hits through the queue.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { World } = require("../dist/game/World");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { CombatMethod } = require("../dist/game/content/combat/method/CombatMethod");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { PendingHit } = require("../dist/game/content/combat/hit/PendingHit");
const { PrayerHandler } = require("../dist/game/content/PrayerHandler");

let core, next = 9650;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const akd = () => require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((q) => q.key === "a_kingdom_divided");
const method = (type) => new (class extends CombatMethod { type() { return type; } hits() { return []; } })();

function loggedInAt(t, stage, x, y, z) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("akdpray" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(x, y, z)); p.needsPlacement = false;
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  t.after(() => { core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  akd().setStage(p, stage);
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  return p;
}

function spawned(id, owner) {
  const npc = [...World.getNpcs()].find((n) => n?.getId?.() === id && n.isRegistered?.() !== false
    && n.getLocation().getDistance(owner.getLocation()) <= 12);
  assert.ok(npc, `the quest spawned NPC ${id}`);
  return npc;
}

/** A 10 hit of `type` from the player, queued and played until it lands; the damage dealt. */
function dealt(t, attacker, npc, type) {
  let cycle = 1000;
  t.mock.method(World, "getProcessCycle", () => cycle);
  npc.setHitpoints(200);
  CombatFactory.addPendingHit(new PendingHit(attacker, npc, method(type), { delay: 1, damage: 10, rollAccuracy: false }));
  const hp = npc.getHitpoints();
  for (let i = 0; i <= 3; i++) npc.getCombat().getHitQueue().process(cycle++);
  t.mock.restoreAll();
  return hp - npc.getHitpoints();
}

test("Xamphur prays Protect from Magic: magic does nothing, melee and ranged land", (t) => {
  const p = loggedInAt(t, 94, 3031, 5940, 0);
  const xamphur = spawned(10955, p);
  assert.equal(PrayerHandler.isActivated(xamphur, PrayerHandler.PROTECT_FROM_MAGIC), true);
  assert.equal(dealt(t, p, xamphur, CombatType.MAGIC), 0, "magic blocked");
  assert.equal(dealt(t, p, xamphur, CombatType.MELEE), 10);
  assert.equal(dealt(t, p, xamphur, CombatType.RANGED), 10);
});

test("the Judge of Yama prays Protect from Missiles and Magic at once: only melee hurts him", (t) => {
  const p = loggedInAt(t, 18, 1823, 3690, 0);
  const judge = spawned(10938, p);
  assert.equal(PrayerHandler.isActivated(judge, PrayerHandler.PROTECT_FROM_MISSILES), true);
  assert.equal(PrayerHandler.isActivated(judge, PrayerHandler.PROTECT_FROM_MAGIC), true);
  assert.equal(dealt(t, p, judge, CombatType.RANGED), 0, "ranged blocked");
  assert.equal(dealt(t, p, judge, CombatType.MAGIC), 0, "magic blocked");
  assert.equal(dealt(t, p, judge, CombatType.MELEE), 10, "melee lands");
});
