// Run after `yarn build`: node --test tests/npc-dialogues.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { pickVariant, aliasKeys, flatten } = require('../plugins/npcs/NpcDialogues.plugin');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/definitions/npc-dialogues.json'), 'utf8'));
const aliases = aliasKeys(data);
const talk = (name) => {
  const record = pickVariant(data[name]) ? data[name] : data[aliases.get(name)];
  return pickVariant(record);
};

test('a variant is chosen when the dump names no default', () => {
  assert.equal(pickVariant({ default: 'b', variants: { a: [{ npc: 'a' }], b: [{ npc: 'b' }] } })[0].npc, 'b');
  assert.equal(pickVariant({ default: null, variants: { 'overhead-x': [1], 'standard-y': [2] } })[0], 2);
  assert.equal(pickVariant({ default: null, variants: { 'if-poisoned': [3] } })[0], 3);
  // Overhead shouts are not a conversation; stay silent rather than yell at the player.
  assert.equal(pickVariant({ default: null, variants: { 'overhead-x': [1] } }), undefined);
  assert.equal(pickVariant(undefined), undefined);
  // Larran and Pox are variant-only records that used to resolve to nothing.
  for (const name of ['Larran', 'Pox', 'Emblem Trader', 'Ferox', 'Lisa']) assert.ok(talk(name)?.length, name);
});

test('cache names reach disambiguated wiki keys', () => {
  assert.equal(aliases.get('Hops'), 'Hops (Biohazard)');
  // A bare key wins when it is usable; "Guard" is overhead-only, so the alias takes over.
  assert.equal(pickVariant(data['Guard']), undefined);
  for (const name of ['Hops', 'Guard', 'Bartender', 'Wizard']) assert.ok(talk(name)?.length, name);
});

test('prose conditions take their first branch and dead jumps fall through', () => {
  const steps = flatten([
    { npc: 'hello' },
    { type: 'condition', text: 'If A:', steps: [{ npc: 'branch A' }, { type: 'jump', id: 'nowhere' }] },
    { type: 'condition', text: 'If B:', steps: [{ npc: 'branch B' }] },
    { npc: 'shared tail' },
  ]);
  assert.deepEqual(steps.map((step) => step.npc), ['hello', 'branch A', 'shared tail']);
  assert.deepEqual(flatten([{ type: 'condition', steps: [{ type: 'condition', steps: [{ npc: 'deep' }] }] }]),
    [{ npc: 'deep' }]);
  // Perdu opens on a condition, so the whole conversation used to be unreachable.
  assert.equal(flatten(talk('Perdu'))[0].npc,
    "It seems you're missing out on some valuable experience. Would you like it?");
});

test('a condition branch that continues reaches the next sibling check', () => {
  const steps = flatten([
    {
      type: 'condition', text: 'If high combat:', steps: [
        { npc: 'very strong' },
        {
          type: 'choice',
          options: [
            { text: 'no', steps: [{ player: 'no' }, { type: 'jump', reference: 'continues' }] },
            { text: 'yes', steps: [{ player: 'yes' }, { type: 'end' }] },
          ],
        },
      ],
    },
    { type: 'condition', text: "If no assignment:", steps: [{ npc: 'assigned' }] },
    { type: 'condition', text: 'If has assignment:', steps: [{ npc: 'still hunting' }] },
  ]);
  // The detour keeps its prompt, then falls through to the first following check.
  assert.deepEqual(steps.map((step) => step.npc).filter(Boolean), ['very strong', 'assigned']);
});

test('a slayer master assigns from a slugged action, not literal prose', () => {
  const steps = talk('Krystilia');
  const found = { action: false, tip: false, spoken: false };
  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.action === 'slayer_assignment') {
        found.action = true;
        assert.equal(node.target, 'Krystilia');
      }
      if (node.action === 'slayer_task_tip') found.tip = true;
      if (typeof node.npc === 'string' && node.npc.includes('Your new task is to kill')) found.spoken = true;
      walk(node.steps);
      for (const option of node.options ?? []) walk(option.steps);
    }
  };
  walk(steps);
  assert.ok(found.action, 'the assignment step carries the slug');
  assert.ok(found.tip, 'the task tip step carries the slug');
  // The placeholder line must not survive as something a player can read.
  assert.equal(found.spoken, false);
});
