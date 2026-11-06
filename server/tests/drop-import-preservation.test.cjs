const assert = require('node:assert/strict');
const { test } = require('node:test');
const dump = require('../data/definitions/npc-drops.json');
const subtables = require('../data/definitions/npc-drop-subtables.json');

test('the conditional-quantity import preserves upstream table identities and NPC variants', () => {
    // Exclude audited obsolete Wiki titles: five nonattackable cultists and the
    // old manta variant lose stale mappings; current encounters remain intact.
    assert.equal(Object.keys(dump.tables).length, 1105);
    assert.equal(Object.keys(dump.npcs).length, 3086);
    for (const id of [8058, 8060, 13686]) assert.ok(dump.npcs[id], `upstream variant ${id}`);
    for (const id of [8058, 8060, 13686]) assert.deepEqual(dump.npcs[id].tables, [], `quest variant ${id} has no normal boss loot`);
    for (const id of [8059, 8061, 13685]) assert.ok(dump.npcs[id].tables.length > 0, `post-quest variant ${id} retains its table`);
    assert.deepEqual(dump.tables.the_mimic.entries.map(entry => entry.item_id), [8782],
        'canonical NPC table keeps the plank; the existing Mimic handler owns casket rewards');
    assert.deepEqual(dump.tables.bandit_champion.entries.map(entry => entry.item_id), [526, 4600, 1331],
        'canonical conditional rows remain intact; the quest owns the two exclusive rewards');
    const occult = dump.tables.thermonuclear_smoke_devil.entries.find(e => e.item_id === 12002);
    assert.deepEqual([occult.weight, occult.out_of], [1, 350]);
});

test('Nex keeps both existing supply bundles and her 12-slot pool', () => {
    const table = dump.tables.nex;
    assert.equal(table.main_max_roll, 12);
    const pairs = table.entries.flatMap(entry => (entry.bonus_drops || []).map(bonus => [entry.item_id, bonus.item_id]));
    assert.deepEqual(pairs.sort((a, b) => a[0] - b[0]), [[385, 2434], [6685, 3024]]);
    assert.ok(!table.entries.some(entry => entry.item_id === 2434 || entry.item_id === 3024));
});

test('Vardorvis Coal uses source alternatives without changing its roll chance', () => {
    const coal = dump.tables.vardorvis.entries.find(entry => entry.item_id === 453);
    assert.deepEqual([coal.weight, coal.out_of], [8, 100]);
    assert.deepEqual(coal.quantity, [130, 130]);
    assert.equal(coal.quantity_selection, 'conditional');
    assert.deepEqual(coal.quantity_alternatives.map(alt => alt.quantity), [[130, 130], [195, 195]]);
    assert.equal(coal.quantity_alternatives[1].condition.type, 'perfect_kill');
});

test('the imported alternatives retain explicit conditions and unknown-distribution accounting', () => {
    const rows = Object.values(dump.tables).flatMap(table => [...(table.entries || []), ...(table.tertiary || [])]);
    const counts = {};
    for (const row of rows.filter(entry => entry.quantity_alternatives)) {
        const type = row.quantity_selection === 'unknown' ? 'unknown' : row.quantity_alternatives[1].condition.type;
        counts[type] = (counts[type] || 0) + 1;
        assert.ok(row.quantity_alternatives.every(alt => alt.quantity.every(Number.isInteger)));
        if (row.quantity_selection === 'conditional') {
            assert.ok(row.quantity_alternatives.slice(1).every(alt => alt.condition?.type));
        }
    }
    assert.deepEqual(counts, { perfect_kill: 99, bounty_task: 2, preferred_method: 3, unknown: 12 });
});

const GWD_REMAINDERS = {
    commander_zilyana: [330, '31.2/127', [[163, 3042], [6687, 3024]]],
    general_graardor: [336, '31.7/127', []],
    kril_tsutsaroth: [396, '36.7/127', [[145, 157], [3026, 189]]],
    kreearra: [480, '43.7/127', [[169, 163]]],
};

test('God Wars generals preserve exact source fractions in one exclusive pool', () => {
    for (const [id, [weight, published, expectedPairs]] of Object.entries(GWD_REMAINDERS)) {
        const table = dump.tables[id];
        assert.equal(table.main_max_roll, 1524, id);
        assert.deepEqual(table.entries.filter(entry => entry.shared_table)
            .map(entry => [entry.shared_table, entry.weight, entry.out_of]),
            [['gwdRareDrop', 96, 1524], ['gwdGem', 24, 1524]], id);
        const pool = table.entries.filter(entry => !entry.always && !entry.pre_roll && !entry.separate_roll);
        assert.equal(pool.reduce((sum, entry) => sum + entry.weight, 0), 1524, id);
        assert.ok(!table.entries.some(entry => entry.separate_roll || entry.pre_roll), `${id}: one exclusive main outcome`);
        assert.deepEqual(table.entries.filter(entry => entry.weight_basis)
            .map(entry => [entry.item_id, entry.weight, entry.out_of, entry.published_rarity]),
            [[995, weight, 1524, published]], id);
        assert.deepEqual(table.entries.flatMap(entry => (entry.bonus_drops || [])
            .map(bonus => [entry.item_id, bonus.item_id])).sort((a,b) => a[0]-b[0]), expectedPairs, id);
    }
    assert.deepEqual(Object.entries(dump.tables).filter(([id]) => !GWD_REMAINDERS[id])
        .flatMap(([id, table]) => table.entries.filter(entry => entry.weight_basis && entry.weight_basis !== 'conditional_group').map(() => id)), []);
    const conditionalTables = Object.entries(dump.tables)
        .filter(([, table]) => table.entries.some(entry => entry.weight_basis === 'conditional_group'))
        .map(([id]) => id);
    assert.deepEqual(conditionalTables, ['corporeal_beast'], 'only the imported conditional unique group');
});

test('God Wars unique outcomes do not also roll the main table independently', t => {
    const { Server } = require('../dist/Server');
    Server.installProductionPathResolver();
    const drops = require('../plugins/npcs/NpcDrops.plugin').__internals;
    drops.loadDrops();
    t.mock.method(Math, 'random', () => 0);
    for (const id of Object.keys(GWD_REMAINDERS)) {
        const npc = Object.values(dump.npcs).find(npc => npc.tables.includes(id));
        const loaded = drops.tablesByNpc.get(npc.npc_id).find(table => table.table_id === id);
        const mainOnly = { ...loaded, entries: loaded.entries.filter(entry => !entry.always), tertiary: [] };
        const rolled = drops.rollTable(mainOnly, {}, null);
        assert.equal(rolled.length, 1, `${id}: one unique, no simultaneous main/other unique`);
        assert.equal(rolled[0].itemId, mainOnly.entries[0].item_id, id);
    }
});

test('every slot of the God Wars variant tables lands identically with a ring of wealth', t => {
    const { Server } = require('../dist/Server');
    Server.installProductionPathResolver();
    const drops = require('../plugins/npcs/NpcDrops.plugin').__internals;
    const { isWearingRingOfWealth } = require('../plugins/items/RingOfWealth.plugin');
    const plain = { getEquipment: () => ({ get: () => null }) };
    const wealthy = { getEquipment: () => ({ get: () => ({ getId: () => 11980 }) }) };
    assert.ok(isWearingRingOfWealth(wealthy));
    drops.loadDrops();
    let value = 0;
    t.mock.method(Math, 'random', () => value);
    for (const key of ['gwdRareDrop', 'gwdGem', 'gwdMegaRare']) {
        assert.ok(subtables[key], key);
        const rows = drops.sharedTables.get(key);
        assert.equal(rows.length, subtables[key].entries.length, `${key}: no rows lost on load`);
        assert.equal(rows.reduce((sum, row) => sum + row.weight, 0), 128, key);
        assert.ok(rows.every(row => row.outOf === 128 && !row.nothing), key);
        for (let slot = 0; slot < 128; slot++) {
            value = (slot + 0.5) / 128;
            const rolled = drops.rollSharedTable(key, plain);
            assert.equal(rolled.length, 1, `${key} slot ${slot}`);
            assert.deepEqual(drops.rollSharedTable(key, wealthy), rolled, `${key} slot ${slot} with wealth`);
        }
    }
});
