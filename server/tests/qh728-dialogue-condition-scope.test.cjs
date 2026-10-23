// QH-728: Sins condition ownership must be keyed by its real Sins step ids.
// From server/: node --test tests/qh728-dialogue-condition-scope.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const S = core.Skill;

const PREREQS = new Set(['vampyre_slayer', 'taste_of_hope']);

// Real registration order from Quests.plugin.js: Sins before Ascent and Client.
require('../plugins/quests/quests/SinsOfTheFather.Quest')(PluginManager.createApi('SinsOfTheFather'));
require('../plugins/quests/quests/AscentOfArceuus.Quest')(PluginManager.createApi('AscentOfArceuus'));
require('../plugins/quests/quests/ClientOfKourend.Quest')(PluginManager.createApi('ClientOfKourend'));
PluginManager.createApi('FixturePrereqs').onCustomEvent('quest:is-complete', (request) => {
  if (PREREQS.has(request.key)) request.complete = true;
});

const sinsHook = PluginManager.npcDialogueConditionHooks.find((hook) => hook.pluginName === 'SinsOfTheFather').handler;

function player({ client = 5, skills = {}, items = [] } = {}) {
  const attributes = new Map([['quest.client_of_kourend.stage', client]]);
  const inventory = new Map();
  for (const [id, amount] of items) inventory.set(id, amount);
  return {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({ getAmount: (id) => inventory.get(id) ?? 0 }),
    getSkillManager: () => ({ getMaxLevel: (skill) => skills[skill] ?? 99 }),
  };
}

function ask(p, stepId, text = '') {
  const event = { player: p, npcId: core.NpcIdentifiers.MORI, stepId, text };
  return { direct: sinsHook(event), global: PluginManager.emitNpcDialogueCondition(event) };
}

const ascMissing = 'If the player does not have the requirements to start the quest:';
const ascHas = 'If the player has the requirements to start the quest:';

test('Sins no longer captures Ascent Mori requirement prose', () => {
  const qualified = player({ client: 5 });
  assert.deepEqual(ask(qualified, 'N4RBsP', ascMissing), { direct: null, global: false });
  assert.deepEqual(ask(qualified, '1lc8lO', ascHas), { direct: null, global: true });

  const unqualified = player({ client: 0 });
  assert.deepEqual(ask(unqualified, 'N4RBsP', ascMissing), { direct: null, global: true });
  assert.deepEqual(ask(unqualified, '1lc8lO', ascHas), { direct: null, global: false });
});

test('foreign vyre-disguise prose is not answered by Sins', () => {
  const disguised = player({ items: [
    [I.VYRE_NOBLE_TOP_UNSCENTED_, 1], [I.VYRE_NOBLE_LEGS_UNSCENTED_, 1], [I.VYRE_NOBLE_SHOES_UNSCENTED_, 1],
  ] });
  assert.deepEqual(ask(disguised, 'mGuA5m', 'If the player is wearing a Vyre disguise:'), { direct: null, global: null });
  assert.deepEqual(ask(disguised, 'des9dJ', "If the player isn't wearing a Vyre disguise:"), { direct: null, global: null });
});

test('Sins own requirements, combat, disguise, flail and coin branches still answer', () => {
  const qualified = player();
  assert.deepEqual(ask(qualified, '7D8z_N'), { direct: false, global: false });
  assert.deepEqual(ask(qualified, 'S4umqc'), { direct: true, global: true });

  const unqualified = player({ skills: { [S.WOODCUTTING]: 1 } });
  assert.deepEqual(ask(unqualified, '7D8z_N'), { direct: true, global: true });
  assert.deepEqual(ask(unqualified, 'S4umqc'), { direct: false, global: false });

  assert.equal(ask(qualified, 'SGj1He').global, false);
  const lowCombat = player({ skills: {
    [S.ATTACK]: 50, [S.STRENGTH]: 50, [S.DEFENCE]: 50, [S.HITPOINTS]: 50,
    [S.PRAYER]: 43, [S.RANGED]: 50, [S.MAGIC]: 50,
  } });
  assert.equal(ask(lowCombat, 'SGj1He').global, true);

  assert.deepEqual(ask(qualified, 'Y7Eh4F'), { direct: false, global: false });
  assert.deepEqual(ask(qualified, 'CIrOJv'), { direct: true, global: true });
  assert.deepEqual(ask(qualified, 'kqP6AE'), { direct: false, global: false });
  assert.deepEqual(ask(qualified, 'pl5f2L'), { direct: true, global: true });
  assert.deepEqual(ask(qualified, 'svlKBi'), { direct: true, global: true });
  assert.deepEqual(ask(qualified, 'z2xhAs'), { direct: false, global: false });

  const equipped = player({ items: [
    [I.VYRE_NOBLE_TOP_UNSCENTED_, 1], [I.VYRE_NOBLE_LEGS_UNSCENTED_, 1], [I.VYRE_NOBLE_SHOES_UNSCENTED_, 1],
    [I.BLISTERWOOD_FLAIL, 1], [I.COINS, 40000],
  ] });
  assert.deepEqual(ask(equipped, 'Y7Eh4F'), { direct: true, global: true });
  assert.deepEqual(ask(equipped, 'CIrOJv'), { direct: false, global: false });
  assert.deepEqual(ask(equipped, 'kqP6AE'), { direct: true, global: true });
  assert.deepEqual(ask(equipped, 'pl5f2L'), { direct: false, global: false });
  assert.deepEqual(ask(equipped, 'svlKBi'), { direct: false, global: false });
  assert.deepEqual(ask(equipped, 'z2xhAs'), { direct: true, global: true });
});

test('unknown condition ids stay null for Sins', () => {
  const p = player();
  assert.equal(ask(p, 'not-a-sins-step', ascMissing).direct, null);
});
