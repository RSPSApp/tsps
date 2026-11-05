// node --test tests/scenery-search.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ScenerySearch = require('../plugins/objects/ScenerySearch.plugin');

const NEEDLE = 1733;
const hooks = {};
const messages = [];
const added = [];
const damage = [];
let freeSlots = 1;

ScenerySearch.register({
    core: {
        ItemIdentifiers: { NEEDLE },
        HitDamage: class { constructor(amount, mask) { this.amount = amount; this.mask = mask; } },
        HitMask: { RED: 1 },
    },
    onObjectInteraction: (name, actions) => { hooks[name] = actions; },
});

const player = {
    getInventory: () => ({ getFreeSlots: () => freeSlots, adds: (id, n) => added.push([id, n]) }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => damage.push(...hits) }) }),
    sendMessage: (m) => messages.push(m),
};

function search(name, roll) {
    messages.length = 0;
    added.length = 0;
    damage.length = 0;
    const original = Math.random;
    Math.random = () => roll;
    try {
        hooks[name].Search({ player, definition: { getName: () => name } });
    } finally {
        Math.random = original;
    }
}

test('haystacks give a needle 10% of the time and prick 2% of the time', () => {
    search('Haystack', 0.05);
    assert.deepEqual(added, [[NEEDLE, 1]]);
    assert.deepEqual(messages, ['Wow! A needle! Now what are the chances of finding that?']);

    search('Hay bale', 0.11);
    assert.equal(damage.length, 1);
    assert.equal(damage[0].amount, 1);
    assert.deepEqual(messages, ['You prick your finger on a needle.']);

    search('Hay bales', 0.5);
    assert.deepEqual(messages, ['You search the hay bales, but find nothing of interest.']);
});

test('a full inventory keeps the needle out', () => {
    freeSlots = 0;
    search('Haystack', 0.05);
    assert.deepEqual(added, []);
    assert.deepEqual(messages, ["You don't have enough inventory space."]);
    freeSlots = 1;
});

test('plain crates and boxes search and find nothing', () => {
    search('Crate', 0.99);
    assert.deepEqual(messages, ['You search the crate, but find nothing of interest.']);
    search('Boxes', 0.99);
    assert.deepEqual(messages, ['You search the boxes, but find nothing of interest.']);
});

test('runs after Quests so specific handlers keep their objects', () => {
    assert.deepEqual(ScenerySearch.dependsOn, ['Quests']);
    for (const name of ['Haystack', 'Hay bale', 'Hay bales', 'Crate', 'Crates', 'Box', 'Boxes']) {
        assert.equal(typeof hooks[name]?.Search, 'function', `${name} must register Search`);
    }
});
