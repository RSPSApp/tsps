const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateSpawnSetup, applySpawnSetup } = require('../plugins/bots/runtime/SpawnSetup.PlayerBots');

function fakeCore() {
  const skills = [
    { key: 'ATTACK', name: 'Attack', getName() { return this.name; } }, { key: 'HITPOINTS', name: 'Hitpoints', getName() { return this.name; } },
  ];
  const Skill = Object.fromEntries(skills.map(skill => [skill.key, skill]));
  Skill.values = () => skills;
  class Item {
    constructor(id, amount = 1) { this.id = id; this.amount = amount; }
    getDefinition() { return { isStackable: () => this.id === 200 }; }
  }
  const definitions = new Map([[100, { wearPos: 3 }], [200, { wearPos: -1 }]]);
  const calls = [];
  return {
    calls,
    Skill,
    SkillManager: { getExperienceForLevel: level => level * 100 },
    CacheDefinitions: { getItem: id => definitions.get(id) ?? null },
    Item,
    BonusManager: { update: bot => calls.push(['bonus', bot]) },
    WeaponInterfaceManager: { assign: bot => calls.push(['weapon', bot]) },
    Flag: { APPEARANCE: 'appearance' },
  };
}

const setup = () => ({
  location: { x: 3222, y: 3218, z: 0 },
  skills: { attack: 30, hitpoints: 50 },
  inventory: [{ slot: 0, id: 200, amount: 100 }],
  equipment: [{ slot: 3, id: 100, amount: 1 }],
});

test('spawn setup validates skill ranges, cache items, equipment slots and stackability', () => {
  const core = fakeCore();
  assert.equal(validateSpawnSetup(setup(), core), null);
  assert.match(validateSpawnSetup({ ...setup(), skills: { unknown: 20 } }, core), /invalid starting skill/);
  assert.match(validateSpawnSetup({ ...setup(), skills: { attack: 100 } }, core), /invalid starting skill/);
  assert.match(validateSpawnSetup({ ...setup(), inventory: [{ slot: 0, id: 100, amount: 2 }] }, core), /not stackable/);
  assert.match(validateSpawnSetup({ ...setup(), equipment: [{ slot: 4, id: 100, amount: 1 }] }, core), /wrong equipment slot/);
  assert.match(validateSpawnSetup({ ...setup(), inventory: [{ slot: 28, id: 200, amount: 1 }] }, core), /invalid starting items/);
  assert.match(validateSpawnSetup({ ...setup(), inventory: [{ slot: 0, id: 999, amount: 1 }] }, core), /unknown item/);
});

test('spawn setup applies starting levels and items, then refreshes appearance and equipment bonuses', () => {
  const core = fakeCore();
  const bot = {
    getSkillManager: () => ({
      setMaxLevels: (...args) => { core.calls.push(['max', ...args]); return manager; },
      setCurrentLevel: (...args) => { core.calls.push(['current', ...args]); return manager; },
      setExperiences: (...args) => { core.calls.push(['xp', ...args]); return manager; },
    }),
    getInventory: () => ({ setItem: (...args) => core.calls.push(['inventory', ...args]) }),
    getEquipment: () => ({ setItem: (...args) => core.calls.push(['equipment', ...args]) }),
    getUpdateFlag: () => ({ flag: value => core.calls.push(['flag', value]) }),
  };
  const manager = bot.getSkillManager();
  applySpawnSetup(bot, setup(), core);
  assert.deepEqual(core.calls.filter(call => ['max', 'current', 'xp'].includes(call[0])).map(call => [call[0], call[1].key, call[2], call[3]]), [
    ['max', 'ATTACK', 30, false], ['current', 'ATTACK', 30, false], ['xp', 'ATTACK', 3000, false],
    ['max', 'HITPOINTS', 50, false], ['current', 'HITPOINTS', 50, false], ['xp', 'HITPOINTS', 5000, false],
  ]);
  const inventory = core.calls.find(call => call[0] === 'inventory');
  const equipment = core.calls.find(call => call[0] === 'equipment');
  assert.equal(inventory[1], 0); assert.deepEqual([inventory[2].id, inventory[2].amount], [200, 100]);
  assert.equal(equipment[1], 3); assert.deepEqual([equipment[2].id, equipment[2].amount], [100, 1]);
  assert.deepEqual(core.calls.filter(call => ['bonus', 'weapon', 'flag'].includes(call[0])).map(call => call[0]), ['bonus', 'weapon', 'flag']);
});
