const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { __internals } = require('../plugins/npcs/NpcDrops.plugin');
const dump = require('../data/definitions/npc-drops.json');
const player = { getEquipment: () => ({ get: () => null, getItems: () => [] }) };

test('regenerated Hydra quantities exclude editor-only comments', () => {
    for (const id of ['hydra', 'colossal_hydra', 'bloodthirsty_hydra']) {
        const entry = dump.tables[id].entries.find(e => e.item_id === 22786 && e.always);
        assert.deepEqual(entry.quantity, [1, 1], id);
        assert.equal(entry.quantity_raw, undefined, id);
        const bones = __internals.rollTable({ entries: [entry] }, player, null);
        assert.equal(bones.length, 1);
        assert.equal(bones[0].amount, 1);
    }
});

test('the normal Zulrah scale roll reaches both documented endpoints', t => {
    const scales = dump.tables.zulrah.entries.find(e => e.item_id === 12934 && e.always);
    let random = 0;
    t.mock.method(Math, 'random', () => random);
    const amount = () => __internals.rollTable({ entries: [scales] }, player, null)[0].amount;
    assert.equal(amount(), 100, 'ordinary scale roll must not fall back to one');
    random = 0.999999;
    assert.equal(amount(), 299);
    assert.deepEqual(scales.quantity, [100, 299]);
    const additional = dump.tables.zulrah.entries.find(e => e.item_id === 12934 && !e.always);
    assert.deepEqual(additional.quantity, [500, 500], 'separate 500-scale outcome remains separate');
});
