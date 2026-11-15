// Run after `yarn build`: node --test tests/npc-protection-prayers.test.cjs
// Wiki (Protection prayers): they "block all damage in most circumstances against NPCs", and the monsters that pray
// (Kalphite Queen, demonic gorillas, the Hunllef, Mezan ...) take nothing from the style they protect against. An
// NPC praying through PrayerHandler kept only the PvP 40% cut, so every such boss nulled its own hits. Real Player,
// real NPC, the real hit queue and impact pass.
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

let next = 9800;
function player(t, name) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setIndex(next++);
  p.setUsername(name);
  p.setRegistered(true);
  p.setLocation(new core.Location(3200 + (next % 50), 3210, 0));
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  p.setHitpoints(99);
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); p.getCombat().getHitQueue().clear(); });
  return p;
}

function npc(t) {
  const n = new NPC(core.NpcIdentifiers.MAN ?? 3106, new core.Location(3201, 3211, 0));
  n.setRegistered(true);
  n.setHitpoints(80);
  t.after(() => { n.setRegistered(false); n.getCombat().getHitQueue().clear(); });
  return n;
}

/** Queues a 10 hit on cycle 1000 and plays the victim's queue until it lands; returns the damage dealt. */
function landed(t, attacker, victim, { method = melee, delay = 0, bypass = false } = {}) {
  let cycle = 1000;
  t.mock.method(World, "getProcessCycle", () => cycle);
  const hit = new PendingHit(attacker, victim, method, { delay, damage: 10, rollAccuracy: false });
  if (bypass) hit.markProtectionBypassed();
  CombatFactory.addPendingHit(hit);
  const hp = victim.getHitpoints();
  for (let i = 0; i <= 4; i++) victim.getCombat().getHitQueue().process(cycle++);
  return hp - victim.getHitpoints();
}

test("an NPC praying Protect from Melee takes nothing from a player's melee hit, and shows the melee overhead", (t) => {
  const attacker = player(t, "npcprayhit");
  const target = npc(t);
  PrayerHandler.activatePrayerPrayerId(target, PrayerHandler.PROTECT_FROM_MELEE);
  assert.equal(target.getHeadIcon(), 0, "the Protect from Melee overhead");
  const xp = attacker.getSkillManager().getExperience(core.Skill.ATTACK) + attacker.getSkillManager().getExperience(core.Skill.STRENGTH)
    + attacker.getSkillManager().getExperience(core.Skill.DEFENCE);
  assert.equal(landed(t, attacker, target), 0, "blocked in full, not the PvP 40%");
  const after = attacker.getSkillManager().getExperience(core.Skill.ATTACK) + attacker.getSkillManager().getExperience(core.Skill.STRENGTH)
    + attacker.getSkillManager().getExperience(core.Skill.DEFENCE);
  assert.equal(after - xp, 0, "no combat XP for a blocked hit");
});

test("the NPC's prayer leaves other styles, prayer-piercing hits and a dropped prayer alone", (t) => {
  const attacker = player(t, "npcprayoff");
  const target = npc(t);
  PrayerHandler.activatePrayerPrayerId(target, PrayerHandler.PROTECT_FROM_MELEE);
  assert.equal(landed(t, attacker, target, { method: ranged, delay: 2 }), 10, "a ranged hit on a melee prayer: all of it");
  assert.equal(landed(t, attacker, target, { bypass: true }), 10, "a hit let through protection prayers: all of it");
  PrayerHandler.activatePrayerPrayerId(target, PrayerHandler.PROTECT_FROM_MISSILES);
  assert.equal(target.getHeadIcon(), 1, "switched to the missiles overhead");
  assert.equal(landed(t, attacker, target), 10, "switched to missiles: melee lands again");
  assert.equal(landed(t, attacker, target, { method: ranged, delay: 2 }), 0, "and ranged is blocked");
  PrayerHandler.deactivatePrayers(target);
  assert.equal(target.getHeadIcon(), -1, "no overhead once it stops praying");
  assert.equal(landed(t, attacker, target, { method: ranged, delay: 2 }), 10, "prayer off: the full hit");
});

test("player against player keeps the 40% cut", (t) => {
  const attacker = player(t, "pvpkeep");
  const victim = player(t, "pvpkeepv");
  PrayerHandler.activatePrayerPrayerId(victim, PrayerHandler.PROTECT_FROM_MELEE);
  assert.equal(landed(t, attacker, victim), 6);
  assert.equal(CombatFactory.protectionPrayerFactor(attacker, victim), 0.6);
  assert.equal(CombatFactory.protectionPrayerFactor(attacker, npc(t)), 0);
});
