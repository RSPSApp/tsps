const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateActivities, readActivities } = require('../plugins/bots/brain/Editor.PlayerBots');

test('editor activities become manual brain definitions and round-trip', () => {
  const input = [{ id: 'custom_wood', repeat: true, actions: [
    { type: 'equipTool', tool: 'axe' },
    { type: 'interactObject', catalog: 'tree', tier: 'normal' },
    { type: 'dropItems', itemIds: [1511] },
  ] }];
  const compiled = validateActivities(input);
  assert.equal(compiled[0].manual, true);
  assert.equal(compiled[0].mode, 'custom_wood');
  assert.deepEqual(compiled[0].actions[1].until, { inventoryFull: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-editor-'));
  try {
    const file = path.join(dir, 'activities.json');
    assert.deepEqual(readActivities(file), []);
    fs.writeFileSync(file, JSON.stringify(compiled));
    assert.deepEqual(readActivities(file), compiled);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an empty activity list is valid after deleting the final bot routine', () => {
  assert.deepEqual(validateActivities([]), []);
});

test('mining and selling compile to existing brain actions', () => {
  const [activity] = validateActivities([{ id: 'custom_mine', repeat: true, actions: [
    { type: 'equipTool', tool: 'pickaxe' },
    { type: 'interactObject', catalog: 'rock', tier: 'copper' },
    { type: 'sellItems', itemIds: [436] },
  ] }]);
  assert.equal(activity.actions[1].option, 'Mine');
  assert.deepEqual(activity.actions[1].until, { inventoryFull: true });
  assert.equal(activity.actions[2].type, 'sellItems');
  assert.throws(() => validateActivities([{ id: 'custom_mine', repeat: true, actions: [{ type: 'interactObject', catalog: 'rock', tier: 'not_a_rock' }] }]), /invalid parameters/);
});

test('custom gathering accepts explicit locations and rejects incomplete entries', () => {
  const input = { id: 'custom_loc', repeat: true, actions: [{ type: 'interactObject', objectIds: [1276, 1278], option: 'Chop down' }] };
  const [result] = validateActivities([input]);
  assert.deepEqual(result.actions[0].objectIds, [1276, 1278]);
  assert.deepEqual(result.actions[0].until, { inventoryFull: true });
  assert.throws(() => validateActivities([{ ...input, actions: [{ ...input.actions[0], objectIds: [null] }] }]), /invalid parameters/);
  assert.throws(() => validateActivities([{ ...input, actions: [{ ...input.actions[0], option: '' }] }]), /invalid parameters/);
});

test('wait action uses elapsed brain time and resets when stopped', () => {
  const { createWaitAction } = require('../plugins/bots/brain/actions/Wait.PlayerBots');
  const wait = createWaitAction({ seconds: 2 });
  const ctx = { nowMs: 1000, player: {} };
  assert.equal(wait.update(ctx), 'running');
  ctx.nowMs = 2999;
  assert.equal(wait.update(ctx), 'running');
  ctx.nowMs = 3000;
  assert.equal(wait.update(ctx), 'success');
  wait.stop(ctx);
  ctx.nowMs = 4000;
  assert.equal(wait.update(ctx), 'running');
});

test('graph supports switch conditions and validates their data', () => {
  const graph = { nodes: [
    { id: 'start', kind: 'start', x: 0, y: 0 },
    { id: 'switch', kind: 'switch', x: 200, y: 0, cases: [
      { skill: { id: 'woodcutting', min: 30, max: 99 } }, { inventoryFull: true },
    ] },
    { id: 'a', kind: 'end', x: 400, y: -100 }, { id: 'b', kind: 'end', x: 400, y: 0 }, { id: 'fallback', kind: 'end', x: 400, y: 100 },
  ], edges: [
    { from: 'start', port: 'next', to: 'switch' }, { from: 'switch', port: 'case_0', to: 'a' }, { from: 'switch', port: 'case_1', to: 'b' }, { from: 'switch', port: 'default', to: 'fallback' },
  ] };
  const [saved] = validateActivities([{ id: 'custom_switch', repeat: false, graph }]);
  assert.equal(saved.graph.nodes[1].cases[0].skill.min, 30);
  assert.throws(() => validateActivities([{ id: 'custom_bad_condition', repeat: false, graph: { ...graph, nodes: graph.nodes.map(node => node.id === 'switch' ? { ...node, cases: [{ skill: { id: 'bogus', min: 1, max: 2 } }, { inventoryFull: true }] } : node) } }]), /Skill condition/);
});

test('tree and rock blocks accept exactly one explicit loc or a preset', () => {
  const tree = { type: 'interactObject', catalog: 'tree', tier: 'oak', objectIds: [1281] };
  const activity = { id: 'custom_tree', repeat: true, actions: [tree] };
  assert.deepEqual(validateActivities([activity])[0].actions[0].objectIds, [1281]);
  assert.throws(() => validateActivities([{ ...activity, actions: [{ ...tree, objectIds: [1281, 1282] }] }]), /invalid parameters/);
  assert.throws(() => validateActivities([{ ...activity, actions: [{ ...tree, objectIds: [null] }] }]), /invalid parameters/);
});

test('combat training options are normalized and bounded over the server preset', () => {
  const configured = { type: 'trainCombat', preset: 'default', styles: ['ranged', 'magic'], durationSeconds: { min: 45, max: 1800 }, food: 'MONKFISH', foodAmount: 24, maxFailedTargets: 12, spreadDistance: 300 };
  const [saved] = validateActivities([{ id: 'custom_train_options', repeat: true, actions: [configured] }]);
  assert.deepEqual(saved.actions[0], configured);
  for (const invalid of [
    { ...configured, styles: [] },
    { ...configured, styles: ['melee', 'melee'] },
    { ...configured, durationSeconds: { min: 900, max: 899 } },
    { ...configured, food: 'RAW_SHRIMP' },
    { ...configured, foodAmount: 29 },
    { ...configured, maxFailedTargets: 0 },
    { ...configured, spreadDistance: 5001 },
    { ...configured, surprise: true },
  ]) assert.throws(() => validateActivities([{ id: 'custom_train_options', repeat: true, actions: [invalid] }]), /invalid parameters/);
});

test('Wander radius and fishing bait amounts are configurable and bounded', () => {
  const input = { id: 'custom_roam_fish', repeat: false, actions: [
    { type: 'wander', walkRadius: 48, endpointLingerMs: 12000 },
    { type: 'fish', tool: 'FLY_FISHING_ROD', bait: 314, baitAmount: 1800 },
  ] };
  assert.deepEqual(validateActivities([input])[0].actions, input.actions);
  for (const invalid of [
    { type: 'wander', walkRadius: 0 }, { type: 'wander', walkRadius: 65 },
    { type: 'wander', endpointLingerMs: 60001 }, { type: 'fish', tool: 'NET', bait: 314, baitAmount: 0 },
    { type: 'fish', tool: 'NET', baitAmount: 300 },
  ]) assert.throws(() => validateActivities([{ ...input, actions: [invalid] }]), /invalid parameters/);
});

test('production blocks allow only supported tool and bar specifications', () => {
  const input = { id: 'custom_production', repeat: false, actions: [{ type: 'ensureItem', item: 'tinderbox' }, { type: 'lightFire' }, { type: 'cook' }, { type: 'smelt', bar: 'bronze bar' }] };
  assert.deepEqual(validateActivities([input])[0].actions, input.actions);
  assert.throws(() => validateActivities([{ ...input, actions: [{ type: 'ensureItem', item: 'dragon bones' }] }]), /invalid parameters/);
  assert.throws(() => validateActivities([{ ...input, actions: [{ type: 'smelt', bar: 'unknown' }] }]), /invalid parameters/);
});

test('conditional item branches are validated and retained', () => {
  const condition = { type: 'if', condition: { hasItem: { id: 1511, min: 1 } }, then: { type: 'bank', itemIds: [1511] }, else: null };
  const [activity] = validateActivities([{ id: 'custom_conditional', repeat: false, actions: [condition] }]);
  assert.deepEqual(activity.actions[0], condition);
  assert.throws(() => validateActivities([{ id: 'custom_conditional', repeat: false, actions: [{ ...condition, then: { type: 'if' } }] }]), /invalid parameters/);
});

test('rejects invalid IDs, duplicates and invalid actions', () => {
  const activity = { id: 'custom_test', repeat: false, actions: [{ type: 'walkTo', x: 1, y: 2, z: 0, radius: 3 }] };
  assert.throws(() => validateActivities([activity, activity]), /unique/);
  assert.throws(() => validateActivities([{ ...activity, id: 'roam' }]), /custom_/);
  assert.throws(() => validateActivities([{ ...activity, actions: [{ type: 'walkTo', x: null, y: 1, z: 0, radius: 3 }] }]), /invalid parameters/);
  assert.throws(() => validateActivities([{ ...activity, actions: [{ type: 'dropItems', itemIds: [null] }] }]), /invalid parameters/);
  assert.throws(() => validateActivities([{ ...activity, actions: [] }]), /1–50/);
});
