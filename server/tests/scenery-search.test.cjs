// node --test tests/scenery-search.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ScenerySearch = require('../plugins/objects/ScenerySearch.plugin');

const NEEDLE = 1733;
const SPADE = 952;
const JOURNAL_PAGE = 24686;
const ANCIENT_ARMOUR = 24688;
const HUMAN_DIG = 830;
const HUMAN_PICKUPTABLE = 832;
const PICK_UP_ITEM = 2582;
const LOCS = { potato_crate: 15030, cabbage_crate: 15031 };
const OBJS = { potato: 1942, cabbage: 1965 };
const SEQS = { human_dig: HUMAN_DIG, human_pickuptable: HUMAN_PICKUPTABLE };
const tasks = [];
const prompts = [];
const hooks = {};
const messages = [];
const added = [];
const damage = [];
const animations = [];
const sounds = [];
const dialogues = [];
let freeSlots = 1;
let held = [];
const movement = {
    blocked: false, generation: 0,
    reset() { return this; },
    setBlockMovement(on) { this.blocked = on; this.generation++; return this; },
    getBlockMovementGeneration() { return this.generation; },
};

ScenerySearch.register({
    core: {
        ItemIdentifiers: { NEEDLE, SPADE, JOURNAL_PAGE, ANCIENT_ARMOUR },
        Animation: class { constructor(id) { this.id = id; } },
        CacheDefinitions: {
            getSeqId: (name) => SEQS[name] ?? null,
            getLocId: (name) => LOCS[name] ?? null,
            getObjId: (name) => OBJS[name] ?? null,
        },
        TaskManager: { submit: (task) => tasks.push(task) },
        Task: class { constructor(delay, key) { Object.assign(this, { delay, key }); } stop() { this.stopped = true; } },
        Sound: { PICK_UP_ITEM: { id: PICK_UP_ITEM } },
        Sounds: { sendSound: (_player, sound) => sounds.push(sound.id) },
        DialogueChainBuilder: class { constructor() { this.entries = []; } add(entry) { this.entries.push(entry); return this; } },
        StatementDialogue: class { constructor(index, text) { this.box = { text }; } },
        DoubleItemStatementDialogue: class { constructor(index, first, second, text) { this.box = { items: [first, second], text }; } },
        HitDamage: class { constructor(amount, mask) { this.amount = amount; this.mask = mask; } },
        HitMask: { RED: 1 },
    },
    onObjectInteraction: (name, actions) => { hooks[name] = actions; },
    sendMultiChatboxPrompt: (_player, title, ...options) => { prompts.push({ title, options }); return true; },
});

const player = {
    getInventory: () => ({ getFreeSlots: () => freeSlots, adds: (id, n) => added.push([id, n]), contains: (id) => held.includes(id) }),
    performAnimation: (animation) => animations.push(animation.id),
    getPacketSender: () => ({ sendSound: (id, loops, delay) => sounds.push([id, loops, delay]) }),
    getDialogueManager: () => ({ startDialogues: (chain) => dialogues.push(...chain.entries.map((entry) => entry.box)) }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => damage.push(...hits) }) }),
    sendMessage: (m) => messages.push(m),
    getIndex: () => 7,
    getMovementQueue: () => movement,
    isRegistered: () => true,
};

function search(name, roll, objectId) {
    tasks.length = 0;
    prompts.length = 0;
    messages.length = 0;
    added.length = 0;
    damage.length = 0;
    animations.length = 0;
    sounds.length = 0;
    dialogues.length = 0;
    const original = Math.random;
    Math.random = () => roll;
    try {
        hooks[name].Search({ player, objectId, definition: { getName: () => name } });
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

/** Runs the queued take question and answers it with `option` ("Yes." or "No."). */
function answer(option) {
    assert.equal(tasks.length, 1);
    tasks[0].execute();
    assert.equal(prompts.length, 1);
    const { options } = prompts[0];
    options[options.indexOf(option) + 1]();
}

test("Wydin's potato crate asks four ticks on and Yes gives a potato (rsprox 233/00465 ticks 7315-7321)", () => {
    search('Crate', 0.99, LOCS.potato_crate);
    assert.deepEqual(messages, ['There are a lot of potatoes in the crate.']);
    assert.equal(tasks[0].delay, 4);
    assert.equal(tasks[0].key, 7);
    assert.equal(movement.blocked, true, 'held still until the question');
    answer('Yes.');
    assert.equal(movement.blocked, false);
    assert.equal(prompts[0].title, 'Do you want to take a potato?');
    assert.deepEqual(prompts[0].options.filter((o) => typeof o === 'string'), ['Yes.', 'No.']);
    assert.deepEqual(added, [[OBJS.potato, 1]]);
    assert.deepEqual(messages, ['There are a lot of potatoes in the crate.', 'You take a potato.']);
    assert.deepEqual(animations, [HUMAN_PICKUPTABLE]);
    assert.deepEqual(sounds, [PICK_UP_ITEM]);
});

test("the cabbage crate gives a cabbage; No takes nothing (rsprox 233/00465 ticks 7398-7405)", () => {
    search('Crate', 0.99, LOCS.cabbage_crate);
    answer('Yes.');
    assert.equal(prompts[0].title, 'Do you want to take a cabbage?');
    assert.deepEqual(added, [[OBJS.cabbage, 1]]);
    assert.deepEqual(messages, ['There are a lot of cabbages in the crate.', 'You take a cabbage.']);
    search('Crate', 0.99, LOCS.cabbage_crate);
    answer('No.');
    assert.deepEqual(added, []);
    assert.deepEqual(messages, ['There are a lot of cabbages in the crate.']);
});

test('a full inventory gets the free-space line and no potato (rsprox 233/00465 tick 7357)', () => {
    freeSlots = 0;
    search('Crate', 0.99, LOCS.potato_crate);
    answer('Yes.');
    assert.deepEqual(added, []);
    assert.deepEqual(animations, []);
    assert.deepEqual(messages, ['There are a lot of potatoes in the crate.', 'You do not have enough free space to take a potato.']);
    freeSlots = 1;
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
