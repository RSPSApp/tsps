// node --test tests/wyson.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const Wyson = require('../plugins/npcs/Wyson.plugin');
const dialogues = require('../data/definitions/npc-dialogues.json');

const COINS = 995, WOAD_LEAF = 1793, WYSON = 5422;
const MOLE_CLAW = 7416, MOLE_SKIN = 7418, IMMACULATE_MOLE_SKIN = 33382;
const SEED_NEST = 22800, RING_NEST = 5074, EMPTY_NEST = 5075, NOTED_MOLE_CLAW = 7417;
class Item {
    constructor(id, amount = 1) { this.id = id; this.amount = amount; }
    getId() { return this.id; }
}
let condition, variant;
const actions = [];
const action = (event) => { for (const handler of actions) handler(event); };
Wyson.register({
    core: {
        Item,
        NpcIdentifiers: { WYSON_THE_GARDENER: WYSON },
        ItemIdentifiers: { COINS, WOAD_LEAF, MOLE_CLAW, MOLE_SKIN, IMMACULATE_MOLE_SKIN,
            BIRD_NEST_12: SEED_NEST, BIRD_NEST_5: RING_NEST, BIRD_NEST_6: EMPTY_NEST },
    },
    onNpcDialogueVariant: (handler) => { variant = handler; },
    onNpcDialogueCondition: (handler) => { condition = handler; },
    onCustomEvent: (name, handler) => { assert.equal(name, 'npc-dialogue:action'); actions.push(handler); },
});

/** A 28-slot inventory, ids by slot (null: empty). */
function slotted(ids) {
    const items = Array.from({ length: 28 }, (_, slot) => (ids[slot] ? new Item(ids[slot]) : null));
    const p = {
        messages: [],
        items,
        refreshed: 0,
        sendMessage(m) { this.messages.push(m); },
        ids: () => items.map((item) => item?.getId() ?? null),
        getInventory: () => ({
            getItems: () => items,
            getFreeSlots: () => items.filter((item) => !item).length,
            getAmount: (id) => items.filter((item) => item?.getId() === id).length,
            setItem: (slot, item) => { items[slot] = item; },
            add: (item) => { const slot = items.findIndex((each) => !each); if (slot >= 0) items[slot] = item; },
            refreshItems: () => { p.refreshed++; },
        }),
    };
    return p;
}

function player(coins, room = true) {
    const items = new Map([[COINS, coins]]);
    return {
        messages: [],
        items,
        sendMessage(m) { this.messages.push(m); },
        getInventory: () => ({
            getAmount: (id) => items.get(id) ?? 0,
            deleteNumber: (id, n) => items.set(id, (items.get(id) ?? 0) - n),
            adds: (id, n) => { if (room || id === COINS) items.set(id, (items.get(id) ?? 0) + n); },
        }),
    };
}
const pages = [{ page: 'Wyson the gardener' }];

test('the plugin answers the transcript\'s own condition texts and action ids', () => {
    const text = JSON.stringify(dialogues['Wyson the gardener']);
    for (const t of ["If the player has at least 15 coins:", "If the player doesn't have 15 coins:",
        "If the player has at least 20 coins:", "If the player doesn't have 20 coins:", '"bywQsQ"', '"F6m-S9"']) {
        assert.ok(text.includes(t), t);
    }
});

test('coin conditions', () => {
    const ask = (text, coins) => condition({ npcId: WYSON, pages, text, player: player(coins) });
    assert.equal(ask("If the player has at least 15 coins:", 15), true);
    assert.equal(ask("If the player doesn't have 15 coins:", 15), false);
    assert.equal(ask("If the player doesn't have 20 coins:", 19), true);
    assert.equal(ask("If the player has at least 20 coins:", 19), false);
    assert.equal(condition({ npcId: 1, pages, text: "If the player has at least 15 coins:", player: player(15) }), null);
});

test('one leaf for 15 coins, two for 20; full inventory refunds', () => {
    const p = player(40);
    action({ npcId: WYSON, pages, action: 'receive', stepId: 'bywQsQ', player: p });
    assert.deepEqual([p.items.get(COINS), p.items.get(WOAD_LEAF)], [25, 1]);
    action({ npcId: WYSON, pages, action: 'receive', stepId: 'F6m-S9', player: p });
    assert.deepEqual([p.items.get(COINS), p.items.get(WOAD_LEAF)], [5, 3]);

    const full = player(20, false);
    const event = { npcId: WYSON, pages, action: 'receive', stepId: 'F6m-S9', player: full };
    action(event);
    assert.equal(full.items.get(COINS), 20);
    assert.equal(event.end, true);
});

const MOLE_PARTS_VARIANT = 'standard-dialogue-talking-to-wyson-with-mole-parts-in-inventory';
const IMMACULATE_VARIANT = 'standard-dialogue-talking-to-wyson-with-immaculate-mole-skin-in-inventory';
const NESTS = new Set([SEED_NEST, RING_NEST, EMPTY_NEST]);

test('the transcript has the mole-part variants and their trade action ids', () => {
    const variants = dialogues['Wyson the gardener'].variants;
    for (const [name, id] of [[MOLE_PARTS_VARIANT, 'T0rsOq'], [IMMACULATE_VARIANT, 'XwNH58']]) {
        assert.ok(JSON.stringify(variants[name]).includes(`"${id}"`), name);
    }
});

test('mole parts in the inventory open with the trade; an immaculate skin with its own line', () => {
    const pick = (ids, npcId = WYSON) => variant({ npcId, player: slotted(ids) });
    assert.deepEqual(pick([MOLE_CLAW]), { page: 'Wyson the gardener', variant: MOLE_PARTS_VARIANT });
    assert.deepEqual(pick([COINS, MOLE_SKIN]), { page: 'Wyson the gardener', variant: MOLE_PARTS_VARIANT });
    assert.deepEqual(pick([MOLE_CLAW, IMMACULATE_MOLE_SKIN]), { page: 'Wyson the gardener', variant: IMMACULATE_VARIANT });
    assert.equal(pick([COINS]), null, 'no parts: his standard dialogue');
    assert.equal(pick([NOTED_MOLE_CLAW]), null, 'noted parts (nest boxes) are not traded');
    assert.equal(pick([MOLE_CLAW], 1), null, 'another NPC');
});

test('each claw or skin becomes a nest in its own slot', (t) => {
    const p = slotted([COINS, MOLE_CLAW, MOLE_SKIN, WOAD_LEAF, MOLE_SKIN]);
    const event = { npcId: WYSON, pages, stepId: 'T0rsOq', player: p };
    action(event);
    assert.equal(event.handled, true);
    const ids = p.ids();
    assert.deepEqual([ids[0], ids[3]], [COINS, WOAD_LEAF]);
    for (const slot of [1, 2, 4]) assert.ok(NESTS.has(ids[slot]), `slot ${slot}: ${ids[slot]}`);
    assert.equal(ids.filter((id) => id !== null).length, 5);
    assert.equal(p.refreshed, 1);
    assert.deepEqual(p.messages, []);
});

test('an immaculate skin gives five nests; without room for them it stays', () => {
    const p = slotted([IMMACULATE_MOLE_SKIN, MOLE_CLAW]);
    action({ npcId: WYSON, pages, stepId: 'XwNH58', player: p });
    assert.equal(p.ids().filter((id) => NESTS.has(id)).length, 6);
    assert.equal(p.getInventory().getAmount(IMMACULATE_MOLE_SKIN), 0);

    const full = slotted([IMMACULATE_MOLE_SKIN, MOLE_CLAW, ...Array(24).fill(COINS)]); // 2 free slots
    action({ npcId: WYSON, pages, stepId: 'XwNH58', player: full });
    assert.equal(full.ids()[0], IMMACULATE_MOLE_SKIN);
    assert.ok(NESTS.has(full.ids()[1]), 'the claw is still traded');
    assert.deepEqual(full.messages, ["You don't have enough inventory space."]);
});

test('nests roll 72% seeds, 20% ring, 8% empty', (t) => {
    const rolled = (random) => {
        t.mock.method(Math, 'random', () => random);
        const p = slotted([MOLE_CLAW]);
        action({ npcId: WYSON, pages, stepId: 'T0rsOq', player: p });
        t.mock.restoreAll();
        return p.ids()[0];
    };
    assert.equal(rolled(0), SEED_NEST);
    assert.equal(rolled(0.7199), SEED_NEST);
    assert.equal(rolled(0.72), RING_NEST);
    assert.equal(rolled(0.9199), RING_NEST);
    assert.equal(rolled(0.92), EMPTY_NEST);
    assert.equal(rolled(0.9999), EMPTY_NEST);
});

test('other action steps and NPCs are left alone', () => {
    const p = slotted([MOLE_CLAW]);
    const other = { npcId: WYSON, pages, stepId: 'zzzzzz', player: p };
    action(other);
    const notWyson = { npcId: 1, pages, stepId: 'T0rsOq', player: p };
    action(notWyson);
    assert.deepEqual([other.handled, notWyson.handled, p.ids()[0]], [undefined, undefined, MOLE_CLAW]);
});
