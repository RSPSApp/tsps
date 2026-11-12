// Source-level (no build): node --test tests/npc-drops-roll-counts.test.cjs
// Wiki (Aberrant spectre / Drop table): the herb roll is made 1, 2 or 3 times (11/26, 11/26, 4/26). The dump carries it
// as `roll_count_weights` on the row; NpcDrops rolls the shared table that many times.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const RollCounts = require('../plugins/npcs/RollCounts.NpcDrops');
const dump = require('../data/definitions/npc-drops.json');

// This pins the import's 29 weighted rows (all herb) and the five unresolved-count ids (hydra, colossal_hydra, bloodthirsty_hydra,
// eagle_ray, butterfly_ray); a re-import that changes them must update this file.
const rows = Object.entries(dump.tables).flatMap(([id, table]) =>
    ['entries', 'tertiary'].flatMap(field => (table[field] ?? []).filter(entry => entry.roll_count_weights).map(entry => [id, entry])));

test('every roll_count_weights row in the import is a valid herb row', () => {
    assert.equal(rows.length, 29);
    for (const [id, entry] of rows) {
        assert.equal(entry.shared_table, 'herb', id);
        assert.ok(RollCounts.validRollCounts(entry.roll_count_weights), id);
    }
});

test('the draw walks the cumulative weights: 11/26 one roll, 11/26 two, 4/26 three', () => {
    const weights = [{ rolls: 1, weight: 11 }, { rolls: 2, weight: 11 }, { rolls: 3, weight: 4 }];
    const at = (value) => { let bound; const n = RollCounts.pick(weights, b => { bound = b; return value; }); return [n, bound]; };
    assert.deepEqual(at(0), [1, 26]);
    assert.deepEqual(at(10), [1, 26]);
    assert.deepEqual(at(11), [2, 26]);
    assert.deepEqual(at(21), [2, 26]);
    assert.deepEqual(at(22), [3, 26]);
    assert.deepEqual(at(25), [3, 26]);
});

test('the aberrant spectre row averages 45/26 rolls and the repugnant and deviant weights are 2 or 3 rolls', () => {
    const mean = (weights) => weights.reduce((sum, e) => sum + e.rolls * e.weight, 0) / weights.reduce((sum, e) => sum + e.weight, 0);
    const herb = (id) => dump.tables[id].entries.find(entry => entry.shared_table === 'herb').roll_count_weights;
    assert.ok(Math.abs(mean(herb('aberrant_spectre')) - 45 / 26) < 1e-12);
    for (const id of ['repugnant_spectre', 'deviant_spectre']) {
        assert.deepEqual(herb(id), [{ rolls: 2, weight: 29 }, { rolls: 3, weight: 17 }]);
        for (let value = 0; value < 46; value++) assert.ok([2, 3].includes(RollCounts.pick(herb(id), () => value)));
    }
});

test('the five rows with an unresolved roll count carry no weights and so roll once', () => {
    const unresolved = Object.entries(dump.tables).flatMap(([id, table]) => (table.entries ?? []).filter(entry => entry.unresolved_roll_count).map(entry => [id, entry]));
    assert.deepEqual(unresolved.map(([id]) => id).sort(), ['bloodthirsty_hydra', 'butterfly_ray', 'colossal_hydra', 'eagle_ray', 'hydra']);
    for (const [id, entry] of unresolved) assert.equal(RollCounts.pick(entry.roll_count_weights, () => 0), 1, id);
});

test('a row without usable weights rolls once', () => {
    for (const weights of [undefined, null, [], [{ rolls: 0, weight: 1 }], [{ rolls: 2, weight: 0 }], [{ rolls: 1.5, weight: 1 }], 'x']) {
        let asked = false;
        assert.equal(RollCounts.pick(weights, () => { asked = true; return 0; }), 1);
        assert.equal(asked, false);
    }
});
