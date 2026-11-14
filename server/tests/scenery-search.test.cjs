// node --test tests/scenery-search.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ScenerySearch = require('../plugins/objects/ScenerySearch.plugin');

const NEEDLE = 1733;
const SPADE = 952;
const JOURNAL_PAGE = 24686;
const ANCIENT_ARMOUR = 24688;
const HUMAN_DIG = 830;
const hooks = {};
const messages = [];
const added = [];
const damage = [];
const animations = [];
const sounds = [];
const dialogues = [];
let freeSlots = 1;
let held = [];

ScenerySearch.register({
    core: {
        ItemIdentifiers: { NEEDLE, SPADE, JOURNAL_PAGE, ANCIENT_ARMOUR },
        Animation: class { constructor(id) { this.id = id; } },
        CacheDefinitions: { getSeqId: (name) => (name === 'human_dig' ? HUMAN_DIG : null) },
        DialogueChainBuilder: class { constructor() { this.entries = []; } add(entry) { this.entries.push(entry); return this; } },
        StatementDialogue: class { constructor(index, text) { this.box = { text }; } },
        DoubleItemStatementDialogue: class { constructor(index, first, second, text) { this.box = { items: [first, second], text }; } },
        HitDamage: class { constructor(amount, mask) { this.amount = amount; this.mask = mask; } },
        HitMask: { RED: 1 },
    },
    onObjectInteraction: (name, actions) => { hooks[name] = actions; },
});

const player = {
    getInventory: () => ({ getFreeSlots: () => freeSlots, adds: (id, n) => added.push([id, n]), contains: (id) => held.includes(id) }),
    performAnimation: (animation) => animations.push(animation.id),
    getPacketSender: () => ({ sendSound: (id, loops, delay) => sounds.push([id, loops, delay]) }),
    getDialogueManager: () => ({ startDialogues: (chain) => dialogues.push(...chain.entries.map((entry) => entry.box)) }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => damage.push(...hits) }) }),
    sendMessage: (m) => messages.push(m),
};

function search(name, roll) {
    messages.length = 0;
    added.length = 0;
    damage.length = 0;
    animations.length = 0;
    sounds.length = 0;
    dialogues.length = 0;
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

test('the mud mound needs a spade, as live says in a mesbox (rsprox 231/00392 tick 7883)', () => {
    held = [];
    freeSlots = 28;
    search('Mud mound', 0.5);
    assert.deepEqual(dialogues, [{ text: 'You need a spade to do that.' }]);
    assert.deepEqual(added, []);
    assert.deepEqual(animations, []);
    assert.deepEqual(sounds, []);
});

test('digging the mud mound gives the journal page and the ancient armour (rsprox 231/00392 tick 8087)', () => {
    held = [SPADE];
    freeSlots = 28;
    search('Mud mound', 0.5);
    assert.deepEqual(animations, [HUMAN_DIG]);
    assert.deepEqual(sounds, [[1470, 1, 0]]);
    assert.deepEqual(added, [[JOURNAL_PAGE, 1], [ANCIENT_ARMOUR, 1]]);
    assert.deepEqual(dialogues, [{
        items: [JOURNAL_PAGE, ANCIENT_ARMOUR],
        text: 'You find an old journal page and some ancient armour<br>in the mud. You take them both.',
    }]);
    assert.deepEqual(messages, []);
});

test('the mud mound keeps both items back without two free slots', () => {
    held = [SPADE];
    freeSlots = 1;
    search('Mud mound', 0.5);
    assert.deepEqual(added, []);
    assert.deepEqual(animations, []);
    assert.deepEqual(messages, ["You don't have enough inventory space."]);
    freeSlots = 1;
    held = [];
});

test('runs after Quests so specific handlers keep their objects', () => {
    assert.deepEqual(ScenerySearch.dependsOn, ['Quests']);
    for (const name of ['Haystack', 'Hay bale', 'Hay bales', 'Crate', 'Crates', 'Box', 'Boxes', 'Mud mound']) {
        assert.equal(typeof hooks[name]?.Search, 'function', `${name} must register Search`);
    }
});
