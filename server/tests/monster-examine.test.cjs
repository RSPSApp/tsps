const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildDrops, groupRows, splitRows, MAX_ROWS } = require('../plugins/interface/monsterexamine/Drops.MonsterExamine');
const names = id => `Item ${id}`;

test('compact chances and meaningful rules leave ordinary item descriptions blank', () => {
  const result = buildDrops({ table: { main_max_roll: 1000000000, entries: [
    { item_id: 1, weight: 500000000, section: 'Runes and ammunition', quantity: [1, 1] },
    { item_id: 2, weight: 233333333, quantity: [1, 1] },
    { item_id: 3, weight: 10000, quantity: [1, 1] },
    { item_id: 4, weight: 1, quantity: [1, 1] },
    { item_id: 5, weight: 100000000, quantity: [1, 1], notes: ['Requires a perfect kill.'] },
  ] } }, names);
  const row = id => result.rows.find(row => row.icon === id);
  assert.match(row(1).panel.rate, /\[1\/2\].*50%/);
  assert.doesNotMatch(row(1).panel.rate, /~|<br>/);
  assert.match(row(2).panel.rate, /23\.33%/);
  assert.match(row(3).panel.rate, /0\.001%/);
  assert.match(row(4).panel.rate, /<lt>0\.001%/);
  assert.equal(row(1).panel.source, '');
  assert.equal(row(1).panel.rules, '');
  assert.match(row(5).panel.rules, /Requires a perfect kill/);
  assert.match(row(5).panel.source, /perfect kill/);
});

test('effective source rows retain quantities, guaranteed drops, shared chains, tertiary and conditional rewards without mutation', (t) => {
  const source = { table: { main_max_roll: 128, rolls: 2, entries: [
    { item_id: 1, always: true, quantity: [1, 1] },
    { item_id: 2, weight: 2, out_of: 999, quantity: [10, 20], noted: true },
    { shared_table: 'herbs', weight: 1, out_of: 128, roll_count_weights: [{ rolls: 3, weight: 1 }] },
    { item_id: 3, weight: 1, out_of: 128, quantity_alternatives: [{ quantity: [2, 4] }, { quantity: [6, 8] }], notes: ['Perfect kill'] },
  ], tertiary: [{ item_id: 4, weight: 1, out_of: 1, quantity: [1, 1] }],
  reward_chain: { stages: [{ entries: [{ item_id: 5, quantity: [1, 1], progression: { intermediate_item_id: 6, intermediate_quantities: [1, 2] } }] }] } },
  shared: { herbs: [{ ref: 'nested', weight: 1, outOf: 2 }], nested: [{ itemId: 7, quantity: [1, 1], weight: 1, outOf: 4 }] } };
  const before = JSON.stringify(source);
  t.mock.method(Math, 'random', () => { throw new Error('no rolls'); });
  const result = buildDrops(source, names);
  assert.equal(JSON.stringify(source), before);
  assert.match(result.rows.find(row => row.icon === 1).detail, /Always/);
  assert.match(result.rows.find(row => row.icon === 2).detail, /10-20 noted.*1\/64/);
  assert.match(result.rows.find(row => row.icon === 3).detail, /2-8 varies.*Conditional/);
  assert.match(result.rows.find(row => row.icon === 4).detail, /Conditional/);
  assert.match(result.rows.find(row => row.icon === 5).detail, /Unknown rate/);
  assert.ok(result.rows.some(row => row.icon === 6));
  assert.match(result.rows.find(row => row.icon === 7).detail, /Conditional/);
  assert.match(result.rows.find(row => row.icon === 1).panel.rate, /80df91.*\[1\/1\] 100%/);
  assert.match(result.rows.find(row => row.icon === 2).panel.rate, /1\/64.*1.563%/);
  assert.match(result.rows.find(row => row.icon === 2).panel.quantity, /10-20.*noted/);
  assert.match(result.rows.find(row => row.icon === 3).panel.source, /Perfect kill.*Amount varies/);
  assert.match(result.rows.find(row => row.icon === 5).panel.rate, /Progress-based/);
  const grouped = groupRows(result.rows);
  assert.deepEqual(grouped.filter(row => row.header).map(row => row.name.split(' (')[0]),
    ['Guaranteed', 'Shared tables', 'Tertiary rolls', 'Conditional rewards']);
  assert.equal(new Set(grouped.map(row => row.id)).size, grouped.length, 'headers never collide with item IDs');
  assert.equal(grouped.filter(row => !row.header && !row.expandable).length, result.rows.length);
  assert.match(result.note, /2 main rolls/);
});

test('missing tables, shared sources and cycles stay honest and bounded', () => {
  assert.match(buildDrops(null, names).note, /unavailable/);
  const cyclic = buildDrops({ table: { entries: [{ shared_table: 'loop' }] }, shared: { loop: [{ ref: 'loop' }] } }, names);
  assert.match(cyclic.note, /capped/);
  const missing = buildDrops({ table: { entries: [{ shared_table: 'absent' }] } }, names);
  assert.match(missing.note, /missing/);
});

test('duplicate amounts collapse with a combined main-roll chance, while distinct item categories have no total rate', () => {
  const dump = require('../data/definitions/npc-drops.json');
  const result = buildDrops({ table: dump.tables.guard }, names);
  const grouped = groupRows(result.rows);
  const coins = grouped.find(row => row.expandable && row.icon === 995);
  assert.ok(coins, 'duplicate coin amounts have a dropdown');
  assert.equal(coins.collapsed, true);
  assert.match(coins.panel.rate, /48.44%/);
  assert.equal(coins.panel.quantity, '1-30 (8.05 avg)');
  assert.match(coins.panel.info, /range per successful drop: 1-30/);
  assert.equal(grouped.filter(row => row.parentId === coins.id).length, 7);
  const runes = grouped.find(row => row.expandable && /Runes/.test(row.name));
  assert.ok(runes, 'five or more distinct runes form a category');
  assert.equal(runes.panel.rate, '', 'different items do not get a combined category chance');
  assert.equal(runes.panel.quantity, '', 'different items do not get an aggregate amount range');
  const key = result.rows.find(row => row.icon === 2832);
  assert.match(key.panel.rate, /When eligible/);
  assert.doesNotMatch(key.panel.rate, /100%/);
  assert.match(key.panel.source, /clue scroll/i);
  assert.match(key.panel.info, /Ardougne knight/);
  for (const field of ['source', 'rules', 'info']) {
    assert.doesNotMatch(key.panel[field], /The source gives 1\/1|not a guaranteed drop from every kill/);
    assert.match(key.panel[field], /clue scroll/i, 'the actual condition remains available in every explanation');
  }
});

test('unrelated rolls of the same item never get a summed chance', () => {
  const rows = buildDrops({ table: { entries: [
    { item_id: 995, name: 'Coins', quantity: [1, 1], separate_roll: true, weight: 1, out_of: 4 },
    { item_id: 995, name: 'Coins', quantity: [5, 5], separate_roll: true, weight: 1, out_of: 8 },
  ] } }, names).rows;
  const coins = groupRows(rows).find(row => row.expandable);
  assert.ok(coins);
  assert.doesNotMatch(coins.panel.rate, /%/);
  assert.equal(coins.panel.quantity, '', 'independent rolls have no combined per-drop range or average');
  assert.match(coins.panel.info, /separate|different/i);
});

test('duplicate items in different source sections are emitted once, and notes remain bounded and safe', () => {
  const source = { table: { main_max_roll: 128, entries: [
    { item_id: 995, name: 'Coins', section: 'Coins', quantity: [1, 1], weight: 20 },
    { item_id: 995, name: 'Coins', section: 'Other', quantity: [5, 5], weight: 1 },
    ...Array.from({ length: 6 }, (_, index) => ({ item_id: index, name: `Item ${index}`, section: 'Other', weight: 1,
      notes: Array.from({ length: 50 }, () => '<img=1>' + 'Condition '.repeat(100)) })),
  ] } };
  const grouped = groupRows(buildDrops(source, names).rows);
  assert.equal(new Set(grouped.map(row => row.id)).size, grouped.length);
  assert.equal(grouped.filter(row => !row.header && !row.expandable).length, 8);
  assert.ok(grouped.every(row => !row.panel || Buffer.byteLength(JSON.stringify(row)) < 38000));
  assert.ok(grouped.every(row => !row.panel?.info?.includes('<img=')));
});

test('large tables fit bounded socket text parts, with no gameplay markup from item names', () => {
  const rows = Array.from({ length: MAX_ROWS + 50 }, (_, index) => ({ item_id: index, name: '<img=1>Item<foo>' + index,
    quantity: [1, 100], weight: 1, out_of: 128 }));
  const result = buildDrops({ table: { entries: rows } }, names);
  assert.equal(result.rows.length, MAX_ROWS);
  assert.ok(result.rows.every(row => !/[<>]/.test(row.name)));
  assert.match(result.note, /capped/);
  const parts = splitRows(groupRows(result.rows));
  assert.ok(parts.length <= 4);
  assert.equal(parts.flat().filter(row => !row.header && !row.expandable).length, MAX_ROWS);
  assert.ok(parts.every(part => Buffer.byteLength(JSON.stringify(part), 'utf8') < 38000));
});

test('shared table ancestry fences off identical items and nested table rewards', () => {
  const source = { table: { main_max_roll: 100, entries: [
    { item_id: 561, name: 'Nature rune', quantity: [10, 10], weight: 20 },
    { item_id: 561, name: 'Nature rune', quantity: [20, 20], weight: 10 },
    { shared_table: 'rareDrop', weight: 5 },
  ] }, shared: {
    rareDrop: [{ itemId: 561, name: 'Nature rune', quantity: [50, 50], weight: 1, outOf: 4,
      bonus_drops: [{ item_id: 314, name: 'Feather', quantity: [1, 1] }] },
      { ref: 'gem', weight: 1, outOf: 4 }],
    gem: [{ itemId: 1601, name: 'Diamond', quantity: [1, 1], weight: 1, outOf: 2 }],
  } };
  const rows = groupRows(buildDrops(source, names).rows);
  const rare = rows.find(row => row.expandable && row.name === 'Rare drop table');
  assert.ok(rare, 'a shared source always has its own folder');
  const gem = rows.find(row => row.expandable && row.name === 'Gem table');
  assert.equal(gem.parentId, rare.id);
  assert.equal(rows.find(row => row.icon === 1601 && !row.expandable).parentId, gem.id);
  assert.equal(rows.find(row => row.icon === 314 && !row.expandable).parentId, rare.id, 'conditional bundled rewards stay in their shared source folder');
  const direct = rows.find(row => row.expandable && row.icon === 561);
  assert.match(direct.panel.rate, /30%/);
  assert.match(direct.panel.quantity, /13.33/);
  assert.match(direct.panel.quantity, /^10-20 /, 'shared-table amounts never broaden an ordinary duplicate range');
  assert.equal(rows.filter(row => row.parentId === direct.id).length, 2);
  assert.equal(rows.find(row => row.icon === 561 && !row.expandable && row.parentId !== direct.id).parentId, rare.id);
});

test('duplicate averages weight uniform quantity means by probability and exclude uncertain amounts', () => {
  const entries = [
    { item_id: 995, name: 'Coins', quantity: [2, 6], weight: 3 },
    { item_id: 995, name: 'Coins', quantity: [10, 10], weight: 1 },
  ];
  const project = () => groupRows(buildDrops({ table: { main_max_roll: 8, entries } }, names).rows).find(row => row.expandable);
  assert.match(project().panel.quantity, /5.5/);
  assert.equal(project().panel.quantity, '2-10 (5.5 avg)');
  assert.match(project().panel.info, /per successful drop/i);
  entries[1].quantity_alternatives = [{ quantity: [10, 10] }, { quantity: [100, 100] }];
  entries[0].quantity_alternatives = [{ quantity: [2, 6] }];
  assert.doesNotMatch(project().panel.quantity, /avg|5.5/);
  assert.match(project().panel.info, /amount.*conditions|distribution/i);
});

test('conditional amounts and unknown quantities do not acquire unsupported group statistics', () => {
  for (const extra of [{ location_requirement: { place: 'wilderness' } },
    { quest_requirement: { key: 'quest', mode: 'started' } }, { roll_group: 'bonus' },
    { quantity_selection: 'unknown' }, { quantity_alternatives: [{ quantity: [100, 200] }] }]) {
    const entries = [{ item_id: 995, name: 'Coins', quantity: [1, 3], weight: 3, ...extra },
      { item_id: 995, name: 'Coins', quantity: [10, 20], weight: 1, ...extra }];
    const folder = groupRows(buildDrops({ table: { main_max_roll: 8, entries } }, names).rows).find(row => row.expandable);
    assert.equal(folder.panel.quantity, '', JSON.stringify(extra));
    assert.equal(folder.panel.rate, '', 'conditional outcomes retain their individual rates');
  }
  const entries = [{ item_id: 995, quantity_raw: 'depends on level', weight: 3 },
    { item_id: 995, quantity: [10, 20], weight: 1 }];
  const folder = groupRows(buildDrops({ table: { main_max_roll: 8, entries } }, names).rows).find(row => row.expandable);
  assert.equal(folder.panel.quantity, '', 'a partial numeric range must not hide an unknown quantity');
  entries[0] = { item_id: 995, quantity: [1000, 2000], weight: 0 };
  const zeroWeight = groupRows(buildDrops({ table: { main_max_roll: 8, entries } }, names).rows).find(row => row.expandable);
  assert.equal(zeroWeight.panel.quantity, '', 'an unreachable outcome must not inflate the displayed range');
});

test('clues form a semantic folder without hiding unrelated tertiary rewards', () => {
  const tertiary = [
    ...['Clue scroll (hard)', 'Clue scroll (elite)', 'Clue bottle (hard)', 'Clue geode (hard)', 'Clue nest (hard)']
      .map((name, index) => ({ item_id: 100 + index, name, quantity: [1, 1], weight: 1, out_of: 100 })),
    { item_id: 11941, name: 'Looting bag', quantity: [1, 1], weight: 1, out_of: 30 },
    { item_id: 13501, name: 'Ensouled hellhound head', quantity: [1, 1], weight: 1, out_of: 40 },
  ];
  const rows = groupRows(buildDrops({ table: { tertiary } }, names).rows);
  const clues = rows.find(row => row.expandable && row.name === 'Clues');
  assert.ok(clues);
  assert.equal(rows.filter(row => row.parentId === clues.id).length, 5);
  assert.equal(rows.find(row => row.icon === 11941).parentId, undefined);
  assert.equal(rows.find(row => row.icon === 13501).parentId, undefined);
  assert.equal(clues.panel.rate, '');
});
