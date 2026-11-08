// Run after `yarn build`: node --test tests/protection-prayer-attack-tick.test.cjs
// Wiki (Prayer flicking): a protection prayer must be on "the tick your enemy attacks". It was read when the hit landed,
// so a delay-3 ranged hit was blocked by a prayer switched on after launch and went through one switched off after.
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

function landedAfter(t, attacker, victim, { before, between }) {
  let cycle = 1000;
  t.mock.method(World, "getProcessCycle", () => cycle);
  before();
  CombatFactory.addPendingHit(new PendingHit(attacker, victim, ranged, { delay: 3, damage: 10, rollAccuracy: false }));
  between();
  const hp = victim.getHitpoints();
  for (let i = 1; i <= 4; i++) { cycle++; victim.getCombat().getHitQueue().process(cycle); }
  return hp - victim.getHitpoints();
}

test("an NPC's delay-3 shot is protected by the prayer on when it attacked, not when it lands", (t) => {
  const npc = new NPC(core.NpcIdentifiers.MAN ?? 3106, new core.Location(3205, 3200, 0));
  npc.setRegistered(true);
  t.after(() => npc.setRegistered(false));
  const on = () => PrayerHandler.activatePrayerPrayerId(victim, PrayerHandler.PROTECT_FROM_MISSILES);
  const off = () => PrayerHandler.deactivatePrayer(victim, PrayerHandler.PROTECT_FROM_MISSILES);
  let victim = player(t, "flicklate", 3200);
  assert.equal(landedAfter(t, npc, victim, { before: off, between: on }), 10, "switched on after the attack: the full hit");
  victim = player(t, "flickearly", 3201);
  assert.equal(landedAfter(t, npc, victim, { before: on, between: off }), 0, "on when it attacked: blocked");
});

test("a protected PvP hit pays XP on what it deals", (t) => {
  const attacker = player(t, "pvpshooter", 3202);
  const victim = player(t, "pvpprayer", 3203);
  PrayerHandler.activatePrayerPrayerId(victim, PrayerHandler.PROTECT_FROM_MISSILES);
  const before = attacker.getSkillManager().getExperience(core.Skill.RANGED);
  const dealt = landedAfter(t, attacker, victim, { before() {}, between() {} });
  assert.equal(dealt, 6, "Protect from Missiles takes 40% off a player's hit");
  assert.equal(attacker.getSkillManager().getExperience(core.Skill.RANGED) - before, 24, "4 XP a damage dealt");
});
