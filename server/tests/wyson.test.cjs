// node --test tests/wyson.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const Wyson = require('../plugins/npcs/Wyson.plugin');
const dialogues = require('../data/definitions/npc-dialogues.json');

const COINS = 995, WOAD_LEAF = 1793, WYSON = 5422;
let condition, action;
Wyson.register({
    core: { NpcIdentifiers: { WYSON_THE_GARDENER: WYSON }, ItemIdentifiers: { COINS, WOAD_LEAF } },
    onNpcDialogueCondition: (handler) => { condition = handler; },
    onCustomEvent: (_name, handler) => { action = handler; },
});

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
