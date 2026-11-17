// Run after `yarn build`: node --test tests/mfwma-mother-protect-from-magic.test.cjs
// Wiki (Mother; Protection prayers): Mother protects against the last style used until the Fire of Domination is
// out, then only against Magic ("Once he has switched to Protect From Magic, you have successfully put out the fire").
// The fight here starts with the fire out, but spawned his Protect from Melee form praying nothing. Real engine: every
// plugin loaded, a real Player logging in at stage 170, the Mother the quest spawns, and real hits through the queue.
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

let core, next = 9670;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const mfwma = () => require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((q) => q.key === "making_friends_with_my_arm");
const method = (type) => new (class extends CombatMethod { type() { return type; } hits() { return []; } })();

function loggedInAt(t, stage, x, y, z) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("mfwma" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(x, y, z)); p.needsPlacement = false;
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  t.after(() => { core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  mfwma().setStage(p, stage);
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

test("with the fire out Mother is his Protect from Magic form: magic does nothing, melee and ranged land", (t) => {
  const p = loggedInAt(t, 170, 2873, 3934, 0);
  const mother = spawned(8430, p);
  assert.equal(PrayerHandler.isActivated(mother, PrayerHandler.PROTECT_FROM_MAGIC), true);
  assert.equal(!!PrayerHandler.isActivated(mother, PrayerHandler.PROTECT_FROM_MELEE), false);
  assert.equal(dealt(t, p, mother, CombatType.MAGIC), 0, "magic blocked");
  assert.equal(dealt(t, p, mother, CombatType.MELEE), 10);
  assert.equal(dealt(t, p, mother, CombatType.RANGED), 10);
});

test("killing that Mother finishes the fight", (t) => {
  const p = loggedInAt(t, 170, 2873, 3934, 0);
  const mother = spawned(8430, p);
  const at = mother.getLocation();
  PM.emitNpcDeath({ npc: mother, npcId: mother.getId(), killer: p, location: { x: at.getX(), y: at.getY(), z: at.getZ() } });
  assert.equal(mfwma().getStage(p), 175);
});
