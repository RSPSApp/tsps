// Run after `yarn build`: node --test tests/scurrius-combat-achievements.test.cjs
// Scurrius' Combat Achievements beyond kill counts: Sit Rat, Perfect Scurrius and Efficient Pest Control.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const Common = require("../plugins/bosses/scurrius/Common.Scurrius");
const Fight = require("../plugins/bosses/scurrius/Fight.Scurrius");
const CombatAchievements = require("../plugins/bosses/scurrius/CombatAchievements.Scurrius");

const realCore = PluginManager.getCoreApi();
let cycle = 1000;
const core = { ...realCore, World: { getProcessCycle: () => cycle } };
const completed = [];
const hooks = {};
const api = new Proxy({
  core,
  emitCustomEvent: (name, payload) => {
    if (name === "combat-achievements:complete") completed.push([payload.player.name, payload.task]);
    else hooks[name]?.(payload);
  },
  onCustomEvent: (name, handler) => { hooks[name] = handler; },
}, { get: (target, key) => target[key] ?? (() => {}) });
Fight.attach(api);
CombatAchievements.attach(api);
const { onHitResolved, onNpcDeath } = CombatAchievements._test;
const { CombatType, PrayerHandler, ItemIdentifiers: I } = realCore;

const npc = (id) => ({ getId: () => id });
function player(name, { weapon = -1, prayers = [] } = {}) {
  const active = new Set(prayers);
  return {
    name,
    isPlayer: () => true,
    prayers: active,
    getEquipment: () => ({ get: () => ({ getId: () => weapon }) }),
    getPrayerActive: () => [...Array(30)].map((_, i) => active.has(i)),
  };
}
// PrayerHandler.isActivated reads the player's prayer state; the fakes keep it in a set.
const isActivated = PrayerHandler.isActivated;
PrayerHandler.isActivated = (p, prayer) => (p.prayers ? p.prayers.has(prayer) : isActivated(p, prayer));

const hit = (type, damage) => ({ getCombatType: () => type, getTotalDamage: () => damage });
const lands = (boss, target, type, damage = 0) => onHitResolved({ attacker: boss, target, hit: hit(type, damage) });
const tasks = (name) => completed.filter(([who]) => who === name).map(([, task]) => task);

test("Perfect Scurrius: blocked swipes and correctly prayed fur and bolts finish it in a private instance", () => {
  completed.length = 0;
  const boss = npc(Common.SOLO_ID);
  const me = player("me", { prayers: [PrayerHandler.PROTECT_FROM_MELEE] });
  lands(boss, me, CombatType.MELEE, 0);
  me.prayers = new Set([PrayerHandler.PROTECT_FROM_MISSILES]);
  lands(boss, me, CombatType.RANGED);
  me.prayers = new Set([PrayerHandler.PROTECT_FROM_MAGIC]);
  lands(boss, me, CombatType.MAGIC);
  onNpcDeath({ npc: boss, killer: me, damagers: [me] });
  assert.deepEqual(tasks("me"), ["Perfect Scurrius"]);
});

test("Perfect Scurrius fails on a damaging swipe, the rubble, or a fur ball or bolt prayed wrong", () => {
  completed.length = 0;
  const slips = [
    (boss, p) => lands(boss, p, CombatType.MELEE, 4),
    (boss, p) => api.emitCustomEvent("scurrius:rockfall-hit", { npc: boss, player: p, damage: 18 }),
    (boss, p) => { p.prayers = new Set([PrayerHandler.PROTECT_FROM_MAGIC]); lands(boss, p, CombatType.RANGED); },
    (boss, p) => { p.prayers = new Set([PrayerHandler.PROTECT_FROM_MISSILES]); lands(boss, p, CombatType.MAGIC, 0); },
  ];
  for (const [i, slip] of slips.entries()) {
    const boss = npc(Common.SOLO_ID);
    const p = player(`slip${i}`);
    slip(boss, p);
    onNpcDeath({ npc: boss, killer: p, damagers: [p] });
    assert.deepEqual(tasks(`slip${i}`), [], `slip ${i}`);
  }
});

test("the public Scurrius gives neither Perfect Scurrius nor Sit Rat", () => {
  completed.length = 0;
  const p = player("public", { weapon: I.BONE_MACE });
  onNpcDeath({ npc: npc(Common.PUBLIC_ID), killer: p, damagers: [p] });
  assert.deepEqual(tasks("public"), []);
});

/** A boss with hitpoints, and damage from `source` landing on it as Mobile.decrementHealth reports it. */
const bossWithHp = (id, hp) => ({ getId: () => id, hp, getHitpoints() { return this.hp; } });
function damage(boss, source, amount) {
  const lost = Math.min(boss.hp, amount);
  boss.hp -= lost;
  if (lost > 0) api.emitCustomEvent("combat:damage-applied", { target: boss, hit: { getSource: () => source, getHealthLost: () => lost } });
}

test("Sit Rat: the killing blow with a ratbane weapon in a private instance, on that hit", () => {
  completed.length = 0;
  const boss = bossWithHp(Common.SOLO_ID, 40);
  const killer = player("killer", { weapon: I.BONE_SHORTBOW });
  damage(boss, killer, 25);
  assert.deepEqual(tasks("killer"), [], "not before he is finished off");
  damage(boss, killer, 25);
  assert.deepEqual(tasks("killer"), ["Sit Rat"], "on the tick his hitpoints reach 0, before the death event");
  onNpcDeath({ npc: boss, killer, damagers: [killer] });
  assert.deepEqual(tasks("killer"), ["Sit Rat", "Perfect Scurrius"], "the death event doesn't award it again");

  const other = player("other", { weapon: I.ABYSSAL_WHIP });
  const second = bossWithHp(Common.SOLO_ID, 10);
  damage(second, other, 15);
  onNpcDeath({ npc: second, killer: other, damagers: [other] });
  assert.deepEqual(tasks("other"), ["Perfect Scurrius"]);
});

test("Sit Rat goes by the weapon of the killing hit, not the one held at the death event 5 ticks later", () => {
  completed.length = 0;
  // Whip kill, rat bone mace wielded during the death animation: no Sit Rat.
  const swapper = player("swapper", { weapon: I.ABYSSAL_WHIP });
  const boss = bossWithHp(Common.SOLO_ID, 20);
  damage(boss, swapper, 30);
  swapper.getEquipment = () => ({ get: () => ({ getId: () => I.BONE_MACE }) });
  onNpcDeath({ npc: boss, killer: swapper, damagers: [swapper] });
  assert.ok(!tasks("swapper").includes("Sit Rat"));

  // Rat bone mace kill, back to the whip before the death event: Sit Rat.
  const switcher = player("switcher", { weapon: I.BONE_MACE });
  const second = bossWithHp(Common.SOLO_ID, 20);
  damage(second, switcher, 30);
  switcher.getEquipment = () => ({ get: () => ({ getId: () => I.ABYSSAL_WHIP }) });
  onNpcDeath({ npc: second, killer: switcher, damagers: [switcher] });
  assert.ok(tasks("switcher").includes("Sit Rat"));

  // The public Scurrius never gives it, however he is finished off.
  const crowd = player("crowd", { weapon: I.BONE_MACE });
  damage(bossWithHp(Common.PUBLIC_ID, 5), crowd, 10);
  assert.deepEqual(tasks("crowd"), []);
});

test("Efficient Pest Control: six rats within 5 ticks, not six spread wider", () => {
  completed.length = 0;
  const slow = player("slow"), fast = player("fast");
  const rat = npc(Common.RAT_ID);
  for (let i = 0; i < 6; i++) { cycle = 2000 + i * 2; onNpcDeath({ npc: rat, killer: slow }); }
  assert.deepEqual(tasks("slow"), [], "one every other tick is too slow");
  for (let i = 0; i < 5; i++) { cycle = 3000 + i; onNpcDeath({ npc: rat, killer: fast }); }
  assert.deepEqual(tasks("fast"), [], "five is not enough");
  cycle = 3005;
  onNpcDeath({ npc: rat, killer: fast });
  assert.deepEqual(tasks("fast"), ["Efficient Pest Control"], "one a tick: ticks 0-5 are 3 seconds");
});
