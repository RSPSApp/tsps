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

test("Sit Rat: the killing blow with a ratbane weapon in a private instance", () => {
  completed.length = 0;
  const boss = npc(Common.SOLO_ID);
  const killer = player("killer", { weapon: I.BONE_SHORTBOW });
  api.emitCustomEvent("scurrius:rockfall-hit", { npc: boss, player: killer, damage: 15 });
  onNpcDeath({ npc: boss, killer, damagers: [killer] });
  assert.deepEqual(tasks("killer"), ["Sit Rat"]);
  const other = player("other", { weapon: I.ABYSSAL_WHIP });
  const second = npc(Common.SOLO_ID);
  api.emitCustomEvent("scurrius:rockfall-hit", { npc: second, player: other, damage: 15 });
  onNpcDeath({ npc: second, killer: other, damagers: [other] });
  assert.deepEqual(tasks("other"), []);
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
