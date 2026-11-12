// Run after `yarn build`: node --test tests/degrime-herb-eligibility.test.cjs
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
let core, serial = 0;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3200, 3200);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));
function caster(t, herblore) {
  let open = true, onClose = () => {};
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => open, send: () => open, close() { open = false; onClose(); }, onData() {}, onError() {}, onClose(fn) { onClose = fn; } };
  const session = new PlayerSession(channel);
  const p = new Player(session); session.setPlayer(p);
  const conn = new ClientConnection(channel); conn.player = p;
  t.after(() => {
    const index = p.getIndex();
    try { channel.close(); } finally {
      try { if (core.World.getPlayers().get(index) === p) core.World.getPlayers().remove(p); } finally {
        for (const queue of [core.World.getAddPlayerQueue(), core.World.getRemovePlayerQueue()]) { let i; while ((i = queue.indexOf(p)) >= 0) queue.splice(i, 1); }
        core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(index);
      }
    }
    assert.equal(channel.isOpen(), false, 'CLEANUP: channel closed');
    assert.notEqual(core.World.getPlayers().get(index), p, 'CLEANUP: actor removed');
    assert.equal(core.TaskManager.hasActiveTask(p), false); assert.equal(core.TaskManager.hasActiveTask(index), false);
    assert.equal(core.World.getAddPlayerQueue().includes(p), false); assert.equal(core.World.getRemovePlayerQueue().includes(p), false);
  });
  p.setUsername(`degrime${++serial}`); p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  assert.notEqual(p.getLongUsername(), 0n, 'PRE: numeric login identity');
  p.setAttribute('bot-skip-persistence', true);
  assert.equal(core.World.getPlayers().add(p), true, 'PRE: world registration');
  const index = p.getIndex();
  assert.ok(index > 0, 'PRE: world assigned index');
  assert.equal(core.World.getPlayers().get(index), p, 'PRE: world owns actor');
  p.setLocation(new core.Location(3200, 3200, 0)); p.resetUpdating();
  p.setSpellbook(core.MagicSpellbook.ARCEUUS);
  const sm = p.getSkillManager();
  for (const [skill, level] of [[core.Skill.MAGIC, 70], [core.Skill.HERBLORE, herblore]]) {
    const xp = core.SkillManager.getExperienceForLevel(level);
    sm.setMaxLevels(skill, level, false).setExperiences(skill, xp, false).setCurrentLevel(skill, level, false);
    assert.equal(sm.getExperience(skill), xp, 'PRE: coherent XP');
    assert.equal(sm.getMaxLevel(skill), level, 'PRE: base level');
    assert.equal(sm.getCurrentLevel(skill), level, 'PRE: current level');
  }
  const q = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'a_kingdom_divided');
  assert.ok(q, 'PRE: AKD registered'); assert.equal(q.completionValue, 150, 'PRE: canonical completion');
  q.setStage(p, q.completionValue); assert.equal(q.isComplete(p), true, 'PRE: quest completed');
  assert.equal(p.busy(), false, 'PRE: placement complete');
  return { p, conn };
}
async function cast(f, includeGuam = true) {
  const spell = core.CacheDefinitions.getSpellByName('Degrime');
  assert.ok(spell && spell.widgetId, 'PRE: cache Degrime widget');
  const widgetId = spell.widgetId;
  assert.equal(core.CacheDefinitions.getSpellName(widgetId, -1), 'Degrime', 'PRE: decoded cache name');
  assert.equal(core.CacheDefinitions.isSpellWidgetGroup(widgetId >>> 16), true, 'PRE: spell widget group');
  for (const [id, name] of [[557, 'Earth rune'], [561, 'Nature rune'], [199, 'Grimy guam leaf'], [249, 'Guam leaf'], [219, 'Grimy torstol'], [269, 'Torstol']]) {
    const def = core.CacheDefinitions.getItem(id); assert.ok(def, `PRE: cache item ${id}`);
    assert.equal(def.name, name, `PRE: cache name ${id}`); assert.ok(def.noteTemplate < 0, `PRE: ordinary form ${id}`);
  }
  for (const [grimyId, clean, level] of [[199, 249, 3], [219, 269, 75]]) {
    const query = { grimyId, clean: null, level: null }; PM.emitCustomEvent('herblore:clean', query);
    assert.equal(query.clean, clean, 'PRE: canonical clean output'); assert.equal(query.level, level, 'PRE: canonical level');
  }
  for (const [id, n] of [[557, 4], [561, 2], ...(includeGuam ? [[199, 1]] : []), [219, 1]]) f.p.getInventory().add(new core.Item(id, n), false);
  for (const id of [557, 561, ...(includeGuam ? [199] : []), 219]) assert.ok(f.p.getInventory().getAmount(id) > 0, `PRE: item ${id}`);
  await f.conn.dispatch([{ type: 'widget_action', widgetId, groupId: widgetId >>> 16, childId: widgetId & 65535, slot: -1, buttonNum: 1 }]);
  const queued = f.conn.turnPackets.splice(0); assert.equal(queued.length, 1, 'PRE: queued decoded widget action');
  await f.conn.dispatch(queued, true); // same turn dispatch as processTurnPackets, awaited to surface errors
}
test('Degrime cleans only eligible herbs at Herblore 50', async t => {
  const f = caster(t, 50); await cast(f);
  assert.equal(f.p.getInventory().getAmount(249), 1, 'CONTROL: eligible guam cleaned');
  assert.equal(f.p.getInventory().getAmount(199), 0, 'CONTROL: grimy guam consumed');
  assert.equal(f.p.getInventory().getAmount(219), 1, 'TARGET: grimy torstol retained');
  assert.equal(f.p.getInventory().getAmount(269), 0, 'TARGET: torstol not cleaned');
  assert.deepEqual(f.p.getInventory().getValidItems().map(i => [i.getId(), i.getAmount()]).sort((a,b) => a[0]-b[0]), [[219, 1], [249, 1]], 'TARGET: entire inventory conserved');
});
test('Degrime cleans both herbs at Herblore 75', async t => {
  const f = caster(t, 75); await cast(f);
  assert.equal(f.p.getInventory().getAmount(249), 1, 'CONTROL: guam cleaned');
  assert.equal(f.p.getInventory().getAmount(269), 1, 'CONTROL: torstol cleaned');
  assert.equal(f.p.getInventory().getAmount(199), 0); assert.equal(f.p.getInventory().getAmount(219), 0);
  assert.deepEqual(f.p.getInventory().getValidItems().map(i => [i.getId(), i.getAmount()]).sort((a,b) => a[0]-b[0]), [[249, 1], [269, 1]], 'CONTROL: entire inventory conserved');
});

test('Degrime preserves runes and Magic XP when no herb is eligible', async t => {
  const f = caster(t, 50);
  const xp = f.p.getSkillManager().getExperience(core.Skill.MAGIC);
  await cast(f, false);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.MAGIC), xp, 'TARGET: Magic XP unchanged');
  assert.equal(f.p.getInventory().getAmount(557), 4, 'TARGET: earth runes unchanged');
  assert.equal(f.p.getInventory().getAmount(561), 2, 'TARGET: nature runes unchanged');
  assert.equal(f.p.getInventory().getAmount(219), 1, 'TARGET: grimy torstol unchanged');
  assert.equal(f.p.getInventory().getAmount(269), 0, 'TARGET: no clean torstol');
  assert.deepEqual(f.p.getInventory().getValidItems().map(i => [i.getId(), i.getAmount()]).sort((a,b) => a[0]-b[0]), [[219, 1], [557, 4], [561, 2]], 'TARGET: entire inventory unchanged');
});

test('Degrime cleans grimy huasca too, for half the Wiki cleaning XP of each herb (Wiki: Degrime, Herb)', async t => {
  const f = caster(t, 75);
  assert.equal(core.CacheDefinitions.getItem(30094).name, 'Grimy huasca', 'PRE: cache item 30094');
  f.p.getInventory().add(new core.Item(30094, 1), false);
  const before = f.p.getSkillManager().getExperience(core.Skill.HERBLORE);
  await cast(f);
  assert.equal(f.p.getInventory().getAmount(30094), 0, 'TARGET: grimy huasca consumed');
  assert.equal(f.p.getInventory().getAmount(30097), 1, 'TARGET: huasca cleaned');
  // Guam 2.5, torstol 15 and huasca 11.8 XP to clean (Wiki Herb), halved by Degrime.
  const gained = f.p.getSkillManager().getExperience(core.Skill.HERBLORE) - before;
  // 14.65 in all; the skill reads back whole experience (main's own map gave 1 + 9 = 10, and none for huasca).
  assert.equal(gained, Math.floor((2.5 + 15 + 11.8) / 2 * core.GameConstants.EXPERIENCE_MULTIPLIER), 'TARGET: half the Wiki cleaning XP');
});
