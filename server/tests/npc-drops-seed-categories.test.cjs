// Source-level (no build): node --test tests/npc-drops-seed-categories.test.cjs
// Wiki (Drop table, "General seed drop table"): CombatCalculation = CombatLevel * 10; a random number
// below it picks which of six subtables rolls, each with its own denominator. The dump carries them as
// `categories`; the random upper bound is treated as exclusive (random(n) is 0..n-1).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const Seed = require('../plugins/npcs/SeedCategories.NpcDrops');
const subtables = require('../data/definitions/npc-drop-subtables.json');
const dump = require('../data/definitions/npc-drops.json');

const seed = subtables.seed;
const names = category => category.entries.map(entry => entry.name);

test('the imported general seed table is the six Wiki subtables and is accepted by the loader check', () => {
    assert.ok(Seed.validCategories(seed));
    assert.equal(seed.combat_level_multiplier, 10);
    assert.deepEqual(seed.categories.map(c => [c.minimum, c.maximum_exclusive ?? null, c.entries.length]),
        [[0, 485, 8], [485, 728, 7], [728, 850, 5], [850, 947, 6], [947, 995, 14], [995, null, 4]]);
});

test('each category keeps its own denominator (1008 / 1000 / 1100), never one merged pool', () => {
    const denominators = seed.categories.map(c => [...new Set(c.entries.map(e => Number(e.rarity_raw.split('/')[1])))]);
    assert.deepEqual(denominators, [[1008], [1000], [1000], [1000], [1000], [1100]]);
    for (const category of seed.categories) {
        const total = category.entries.reduce((sum, e) => sum + Number(e.rarity_raw.split('/')[0]), 0);
        assert.ok(total <= Number(category.entries[0].rarity_raw.split('/')[1]), 'weights fit the denominator');
    }
    assert.deepEqual(names(seed.categories[0]).slice(0, 2), ['Potato seed', 'Onion seed']);
    assert.ok(names(seed.categories[5]).includes('Mushroom spore'));
});

test('44 rows still reference the shared seed table', () => {
    const rows = Object.values(dump.tables).flatMap(t => t.entries).filter(e => e.shared_table === 'seed');
    assert.equal(rows.length, 44);
});

// roll -> the value `randomInt(bound)` returns; records the bound it was asked for.
const pick = (level, roll) => {
    let bound;
    const category = Seed.select(seed.categories, seed.combat_level_multiplier, level, b => { bound = b; return roll; });
    return { first: category.entries[0].name, bound };
};

test('the random upper bound is combat level * 10 and category edges are minimum-inclusive, maximum-exclusive', () => {
    assert.equal(pick(100, 0).bound, 1000);
    const edges = [[0, 'Potato seed'], [484, 'Potato seed'], [485, 'Barley seed'], [727, 'Barley seed'],
        [728, 'Marigold seed'], [849, 'Marigold seed'], [850, 'Redberry seed'], [946, 'Redberry seed'],
        [947, 'Guam seed'], [994, 'Guam seed'], [995, 'Mushroom spore'], [9999, 'Mushroom spore']];
    for (const [roll, first] of edges) assert.equal(pick(1000, roll).first, first, `roll ${roll}`);
});

test('a combat level of 48 or less can only reach the allotment seeds', () => {
    for (const level of [1, 2, 24, 48]) {
        for (let roll = 0; roll < level * 10; roll++) assert.equal(pick(level, roll).first, 'Potato seed', `level ${level} roll ${roll}`);
    }
    assert.equal(pick(49, 485 - 1).first, 'Potato seed');
});

test('a combat level of 100 spans several categories', () => {
    const reached = new Set();
    for (let roll = 0; roll < 1000; roll++) reached.add(pick(100, roll).first);
    assert.deepEqual([...reached], ['Potato seed', 'Barley seed', 'Marigold seed', 'Redberry seed', 'Guam seed', 'Mushroom spore']);
});

test('an unknown combat level rolls the lowest category instead of a rarer one', () => {
    for (const level of [null, undefined, 0, -5, NaN, 12.5, '40']) {
        let asked = false;
        const category = Seed.select(seed.categories, 10, level, () => { asked = true; return 9999; });
        assert.equal(category.entries[0].name, 'Potato seed', String(level));
        assert.equal(asked, false);
    }
});

test('malformed category data is rejected, so the flat rows keep rolling', () => {
    const bad = [
        { ...seed, categories: [] },
        { ...seed, combat_level_multiplier: 0 },
        { ...seed, categories: seed.categories.map((c, i) => (i === 1 ? { ...c, minimum: 400 } : c)) },
        { ...seed, categories: seed.categories.map((c, i) => (i === 5 ? { ...c, maximum_exclusive: 2000 } : c)) },
        { ...seed, categories: seed.categories.slice(0, 3) },
    ];
    for (const table of bad) assert.equal(Seed.validCategories(table), false);
    assert.equal(Seed.validCategories({ entries: [{}] }), false);
});
