// Run after `yarn build`: node --test tests/protection-prayer-attack-tick.test.cjs
// Wiki (Prayer flicking): a protection prayer must be on "the tick your enemy attacks". It was read when the hit landed,
// so a delay-3 ranged hit was blocked by a prayer switched on after launch and went through one switched off after.
// NPCs go before players each tick, so an NPC's attack reads the prayer in the victim's own turn on that tick, after
// their clicks (rsprox captures: a prayer switched on the tick Scurrius swipes blocks it, 23 of 23, #4061).
// The XP of a protected hit is paid on what it deals. Real Players, the real queue and the real impact pass.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { World } = require("../dist/game/World");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { CombatMethod } = require("../dist/game/content/combat/method/CombatMethod");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { PendingHit } = require("../dist/game/content/combat/hit/PendingHit");
const { PrayerHandler } = require("../dist/game/content/PrayerHandler");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
});

const ranged = new (class extends CombatMethod { type() { return CombatType.RANGED; } hits() { return []; } })();
const melee = new (class extends CombatMethod { type() { return CombatType.MELEE; } hits() { return []; } })();

let next = 9700;
function player(t, name, x) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setIndex(next++);
  p.setUsername(name);
  p.setRegistered(true);
  p.setLocation(new core.Location(x, 3200, 0));
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  p.setHitpoints(99);
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); p.getCombat().getHitQueue().clear(); });
  return p;
}

/**
 * Queues a hit on cycle 1000, as an attacker's turn does, then plays the victim's own turns: `turn` runs as
 * their clicks on the attack tick (before their queue drains), `next` as their clicks on the tick after.
 */
function landed(t, attacker, victim, { method = ranged, delay = 3, before = () => {}, turn = () => {}, next = () => {} }) {
  let cycle = 1000;
  t.mock.method(World, "getProcessCycle", () => cycle);
  before();
  CombatFactory.addPendingHit(new PendingHit(attacker, victim, method, { delay, damage: 10, rollAccuracy: false }));
  const hp = victim.getHitpoints();
  turn();
  victim.getCombat().getHitQueue().process(cycle);
  for (let i = 1; i <= 4; i++) {
    cycle++;
    if (i === 1) next();
    victim.getCombat().getHitQueue().process(cycle);
  }
  return hp - victim.getHitpoints();
}

function npcAttacker(t) {
  const npc = new NPC(core.NpcIdentifiers.MAN ?? 3106, new core.Location(3205, 3200, 0));
  npc.setRegistered(true);
  t.after(() => npc.setRegistered(false));
  return npc;
}

const prayer = (victim, id) => ({
  on: () => PrayerHandler.activatePrayerPrayerId(victim, id),
  off: () => PrayerHandler.deactivatePrayer(victim, id),
});

test("an NPC's delay-3 shot is protected by the prayer on in the victim's turn on the attack tick, not when it lands", (t) => {
  const npc = npcAttacker(t);
  let victim = player(t, "flicklate", 3200);
  let p = prayer(victim, PrayerHandler.PROTECT_FROM_MISSILES);
  assert.equal(landed(t, npc, victim, { before: p.off, next: p.on }), 10, "switched on the tick after the attack: the full hit");
  victim = player(t, "flickearly", 3201);
  p = prayer(victim, PrayerHandler.PROTECT_FROM_MISSILES);
  assert.equal(landed(t, npc, victim, { before: p.on, next: p.off }), 0, "on through the attack tick, off before it lands: blocked");
  victim = player(t, "flicksame", 3202);
  p = prayer(victim, PrayerHandler.PROTECT_FROM_MISSILES);
  assert.equal(landed(t, npc, victim, { before: p.off, turn: p.on, next: p.off }), 0,
    "switched on in their turn on the attack tick (NPCs go first): blocked");
  victim = player(t, "flickoffsame", 3203);
  p = prayer(victim, PrayerHandler.PROTECT_FROM_MISSILES);
  assert.equal(landed(t, npc, victim, { before: p.on, turn: p.off }), 10, "switched off in their turn on the attack tick: the full hit");
});

test("an NPC's melee swing is blocked by a prayer switched on in the victim's turn on the swing's tick (#4061)", (t) => {
  const npc = npcAttacker(t);
  let victim = player(t, "lazyflick", 3204);
  let p = prayer(victim, PrayerHandler.PROTECT_FROM_MELEE);
  assert.equal(landed(t, npc, victim, { method: melee, delay: 0, before: p.off, turn: p.on, next: p.off }), 0, "lazy flick: blocked");
  victim = player(t, "noflick", 3205);
  p = prayer(victim, PrayerHandler.PROTECT_FROM_MELEE);
  assert.equal(landed(t, npc, victim, { method: melee, delay: 0, before: p.off, next: p.on }), 10, "a tick late: the full hit");
});

test("an NPC's hit queued after the victim's turn reads the prayer at once", (t) => {
  const npc = npcAttacker(t);
  const victim = player(t, "afterturn", 3206);
  const p = prayer(victim, PrayerHandler.PROTECT_FROM_MISSILES);
  let cycle = 1000;
  t.mock.method(World, "getProcessCycle", () => cycle);
  victim.getCombat().getHitQueue().process(cycle);
  p.on();
  CombatFactory.addPendingHit(new PendingHit(npc, victim, ranged, { delay: 3, damage: 10, rollAccuracy: false }));
  p.off();
  const hp = victim.getHitpoints();
  for (let i = 1; i <= 4; i++) { cycle++; victim.getCombat().getHitQueue().process(cycle); }
  assert.equal(hp - victim.getHitpoints(), 0, "on when the attack was queued, the victim's turn already over: blocked");
});

test("a protected PvP hit pays XP on what it deals", (t) => {
  const attacker = player(t, "pvpshooter", 3202);
  const victim = player(t, "pvpprayer", 3203);
  PrayerHandler.activatePrayerPrayerId(victim, PrayerHandler.PROTECT_FROM_MISSILES);
  const before = attacker.getSkillManager().getExperience(core.Skill.RANGED);
  const dealt = landed(t, attacker, victim, {});
  assert.equal(dealt, 6, "Protect from Missiles takes 40% off a player's hit");
  assert.equal(attacker.getSkillManager().getExperience(core.Skill.RANGED) - before, 24, "4 XP a damage dealt");
});
