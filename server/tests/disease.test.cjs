// Build first: node --test tests/disease.test.cjs
//
// Disease against the recordings (rsprox_transcripts/235/00944.txt ticks 3052-3659: varp 20 down to
// 0, one 30-tick step at a time, the drain ceil(value / 5) on the next tick; 231/03034.txt and
// 241/900122.txt: a Sanfew serum takes 50 off and leaves -50) and the Wiki (Disease, Relicym's balm).
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');

let core, c, DISEASE;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  c = core.CacheDefinitions;
  DISEASE = c.getVarpId('disease');
  require('../plugins/combat/Disease.plugin.js').register(PM.createApi('Disease'));
  require('../plugins/items/Potions.plugin.js').register(PM.createApi('Potions'));
});

function setup(name = 'diseaseqa') {
  const player = new Player(null), messages = [], splats = [];
  player.setUsername(name);
  player.getSession = () => ({ sendClientPacket: () => true });
  player.isRegistered = () => true;
  player.sendMessage = (text) => messages.push(text);
  const showHitsplat = player.showHitsplat.bind(player);
  player.showHitsplat = (damage, splat, health) => { splats.push([damage, splat.mine]); return showHitsplat(damage, splat, health); };
  for (const skill of core.Skill.values()) player.getSkillManager().setCurrentLevel(skill, 99, false).setMaxLevel(skill, 99, false);
  player.setHitpoints(99);
  const varp = () => player.getPacketSender().getConfig?.(DISEASE) ?? player.getAttribute('disease:value');
  return { player, messages, splats, varp, value: () => player.getAttribute('disease:value') ?? 0 };
}

const ticks = (n) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };
const emit = (name, payload) => (PM.emitCustomEvent(name, payload), payload);
const drained = (player) => core.Skill.values().reduce((sum, skill) => sum + 99 - player.getSkillManager().getCurrentLevel(skill), 0);

test('a disease steps down every 30 ticks and drains ceil(value / 5) the tick after, as recorded, then ends silently', () => {
  const f = setup();
  emit('disease:inflict', { player: f.player, value: 20 });
  assert.deepEqual(f.messages, ['You have become diseased!']);
  assert.equal(f.value(), 20);
  ticks(29);
  assert.equal(f.value(), 20);
  ticks(1);
  assert.equal(f.value(), 19, 'the varp steps at 30 ticks');
  assert.equal(drained(f.player), 0, 'the drain lands the tick after');
  ticks(1);
  assert.deepEqual(f.splats, [[4, 4]], 'hitsplat 4, 4 drained (20 -> 19)');
  assert.equal(drained(f.player), 4);
  assert.equal(f.player.getSkillManager().getCurrentLevel(core.Skill.HITPOINTS), 99, 'never Hitpoints while a skill can drop');
  assert.equal(f.player.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 99, 'never Prayer');
  ticks(30 * 19);
  assert.equal(f.value(), 0);
  // The recorded drains: 4 x5, 3 x5, 2 x5, 1 x5.
  assert.deepEqual(f.splats.map(([damage]) => damage), [4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1]);
  ticks(60);
  assert.equal(f.splats.length, 20, 'nothing after it wears off');
  assert.deepEqual(f.messages, ['You have become diseased!'], 'no line when it ends');
});

test('a skill already at 1 passes the drain to Hitpoints, which disease can take to 0', () => {
  const f = setup('diseasehp');
  for (const skill of core.Skill.values()) if (skill !== core.Skill.HITPOINTS && skill !== core.Skill.PRAYER) f.player.getSkillManager().setCurrentLevel(skill, 1, false);
  f.player.setHitpoints(3);
  emit('disease:inflict', { player: f.player, value: 20 });
  ticks(31);
  const queue = f.player.getCombat().getHitQueue();
  assert.deepEqual(queue.pendingDamage.map((hit) => [hit.getDamage(), hit.getSplatType(true)]), [[4, 4]], 'a 4 on Hitpoints, hitsplat 4');
  assert.deepEqual(f.splats, [], 'no skill drained');
  queue.process(core.World.getProcessCycle?.() ?? 0);
  assert.equal(f.player.getHitpoints(), 0, '4 damage on 3 Hitpoints');
});

test('Sanfew serum: 50 off and -50 left, so a new disease is refused for 50 steps; then it can take again', () => {
  const f = setup('diseasesanfew');
  emit('disease:inflict', { player: f.player, value: 40 });
  ticks(30);
  assert.equal(f.value(), 39);
  const sanfew = require('../plugins/items/Potions.plugin.js')._test.findPotionEntry(core.ItemIdentifiers.SANFEW_SERUM_4_).potion;
  sanfew.effect(f.player);
  assert.equal(f.value(), -50, 'recorded 39 -> -11 -> -50');
  ticks(1);
  assert.equal(drained(f.player), 8, 'the drain due from the 40 -> 39 step still lands');
  f.messages.length = 0;
  emit('disease:inflict', { player: f.player, value: 40 });
  assert.equal(f.value(), -50, 'immune');
  assert.deepEqual(f.messages, []);
  ticks(29);
  assert.equal(f.value(), -49, 'the clock restarted with the drink: 30 ticks after it');
  sanfew.effect(f.player);
  assert.equal(f.value(), -50, 'recorded -49 -> -99 -> -50');
  ticks(30 * 50);
  assert.equal(f.value(), 0);
  emit('disease:inflict', { player: f.player, value: 40 });
  assert.equal(f.value(), 40);
});

test("Sanfew serum leaves Slash Bash's 75 at 25, with no immunity (Wiki)", () => {
  const f = setup('diseasebash');
  emit('disease:inflict', { player: f.player, value: 75 });
  const result = emit('disease:cure', { player: f.player, amount: 50, immunity: 50 });
  assert.equal(result.cured, false);
  assert.equal(f.value(), 25);
});

test("Relicym's balm: three doses cure a 50, five Slash Bash's 75, and no immunity follows (Wiki)", () => {
  const balm = require('../plugins/items/Potions.plugin.js')._test.findPotionEntry(core.ItemIdentifiers.RELICYMS_BALM_4_).potion;
  const doses = (value) => {
    const f = setup(`balm${value}`);
    emit('disease:inflict', { player: f.player, value });
    let count = 0;
    while (f.value() > 0 && count < 10) { balm.effect(f.player); count++; }
    assert.equal(f.value(), 0, 'cured, not immune');
    return count;
  };
  assert.equal(doses(50), 3);
  assert.equal(doses(75), 5);
});

test('reapplying resets to the new value; death cures it; an inoculation bracelet stops the drain; it survives a relog', () => {
  const f = setup('diseasemisc');
  emit('disease:inflict', { player: f.player, value: 20 });
  ticks(60);
  emit('disease:inflict', { player: f.player, value: 40 });
  assert.equal(f.value(), 40);
  assert.equal(f.messages.length, 1, 'already diseased: no second line');
  f.player.getEquipment().setItem(core.Equipment.HANDS_SLOT, new core.Item(c.getObjId('jewl_bracelet_of_innoculation'), 1));
  const before = drained(f.player);
  ticks(31);
  assert.equal(drained(f.player), before, 'the bracelet stops the drain');
  assert.equal(f.splats.at(-1)[0], 0);
  PM.emitPlayerDeath({ player: f.player, killer: null, handled: false });
  assert.equal(f.value(), 0, 'death cures it');
  // A saved 30 comes back on login and keeps stepping.
  const again = setup('diseasemisc2');
  again.player.setAttribute('disease:value', 30);
  PM.emitPlayerLogin({ player: again.player, username: 'diseasemisc2' });
  assert.equal(emit('disease:state', { player: again.player }).value, 30);
  ticks(30);
  assert.equal(again.value(), 29);
});
