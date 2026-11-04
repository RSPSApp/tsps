// Run after `yarn build`: node --test tests/silk-merchant.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
const SilkMerchant = require('../plugins/npcs/SilkMerchant.plugin');

const { SILK } = I;
const SILK_NOTE = I.SILK_2;
const MAX_STACK_AMOUNT = 0x7fffffff;

const listeners = [];
const variantHandlers = [];
const api = {
    onNpcDialogueVariant: (handler) => { variantHandlers.push(handler); },
    onCustomEvent: (name, handler) => { listeners.push([name, handler]); },
    emitCustomEvent: (name, request) => { for (const [key, handler] of listeners.filter(([n]) => n === name)) handler(request); },
    log: () => {},
};
SilkMerchant.register(api);

function container(entries = {}, capacity = 28) {
    const amounts = new Map(Object.entries(entries).map(([id, n]) => [Number(id), n]));
    const usedSlots = () => [...amounts].reduce((used, [id, amount]) =>
        used + (id === I.COINS ? (amount > 0 ? 1 : 0) : amount), 0);
    return {
        amounts,
        contains: (id) => (amounts.get(id) ?? 0) > 0,
        getAmount: (id) => amounts.get(id) ?? 0,
        getFreeSlots: () => capacity - usedSlots(),
        getAddableAmount: (item) => {
            const amount = item.getAmount();
            const held = amounts.get(item.getId()) ?? 0;
            if (item.getId() === I.COINS && held > 0) return Math.min(amount, MAX_STACK_AMOUNT - held);
            return capacity - usedSlots() > 0 ? Math.min(amount, MAX_STACK_AMOUNT) : 0;
        },
        adds: (id, n) => amounts.set(id, id === I.COINS
            ? Math.min(MAX_STACK_AMOUNT, (amounts.get(id) ?? 0) + n)
            : (amounts.get(id) ?? 0) + n),
        delete: (id, n) => amounts.set(id, (amounts.get(id) ?? 0) - n),
    };
}

function player({ inventory = {}, attributes = {}, privateArea = null } = {}) {
    const inv = container(inventory);
    const attrs = attributes;
    const values = new Map(Object.entries(attributes));
    return {
        inv,
        getInventory: () => inv,
        getPrivateArea: () => privateArea,
        getAttribute: (key) => values.get(key),
        setAttribute: (key, value) => values.set(key, value),
    };
}

const variantOf = (who, npcId = 8728) => variantHandlers[0]({ npcId, player: who });
const silkNpc = (x = 2656, y = 3301, z = 0, privateArea = null) => ({
    getLocation: () => ({ getX: () => x, getY: () => y, getZ: () => z }),
    getPrivateArea: () => privateArea,
});

/** A dialogue choice; returns what the player ends up with as the agreed price. */
function choose(who, option, npcId = 8728) {
    SilkMerchant._test.onDialogueChoice({ player: who, npcId, option });
    return who.getAttribute(SilkMerchant._test.AGREED_PRICE_ATTRIBUTE);
}

/** Dialogue reaches `text`; returns the attached after hook with the sale run. */
function tradeAt(who, text, npc = silkNpc(), npcId = 8728, runAfter = true) {
    const request = { player: who, npc, npcId, text };
    SilkMerchant._test.onDialogueLine(request);
    if (runAfter) request.after?.();
    return request.after;
}

test('the data file agrees: un-noted silk is bought, noted silk is refused', () => {
    assert.equal(variantOf(player()), null, 'nothing to sell: the standard without-silk transcript');
    assert.equal(variantOf(player({ inventory: { [SILK]: 3 } })), 'standard-dialogue-with-silk');
    assert.equal(variantOf(player({ inventory: { [SILK_NOTE]: 3 } })), 'standard-dialogue-with-only-noted-silk');
    assert.equal(variantOf(player({ inventory: { [SILK]: 1, [SILK_NOTE]: 3 } })), 'standard-dialogue-with-silk', 'real silk beats noted');
});

test('only the agreeing options set a price; walking away clears it', () => {
    const who = player();
    assert.equal(choose(who, '20 coins.'), 20);
    assert.equal(choose(who, '80 coins.'), 20, 'the counter offer is still pending');
    assert.equal(choose(who, 'Ok, 40 sounds good.'), 40);
    assert.equal(choose(who, "50, and that's my final price."), 50, "'80' bargaining can end at 50");
    assert.equal(choose(who, 'Ok, I guess 50 will do.'), 50, "'120' selling asks 50 first");
    assert.equal(choose(who, "I'll give it to you for 60."), 60, "the Wiki's 60-coins bargain");
    assert.equal(choose(who, 'No, that is not enough.'), null, 'walking away clears it');
});

test('a sale buys every silk and pays at the branch-final line', () => {
    const who = player({ inventory: { [SILK]: 7, [SILK_NOTE]: 2 } });
    assert.equal(tradeAt(who, 'Ok suits me.'), undefined, 'no price agreed, no sale');
    choose(who, '20 coins.');
    assert.notEqual(tradeAt(who, 'Ok suits me.'), undefined, "'20 coins.' -> 'Ok suits me.' pays");
    assert.equal(who.inv.getAmount(SILK), 0, 'every un-noted silk is bought');
    assert.equal(who.inv.getAmount(SILK_NOTE), 2, 'noted silk is not bought');
    assert.equal(who.inv.getAmount(I.COINS), 140, '7 x 20');

    const haggler = player({ inventory: { [SILK]: 3 } });
    choose(haggler, '80 coins.');
    assert.equal(tradeAt(haggler, 'Ok, 40 sounds good.'), undefined, 'the counter price is not settled yet');
    choose(haggler, 'Ok, 40 sounds good.');
    assert.notEqual(tradeAt(haggler, 'Ok, 40 sounds good.'), undefined);
    assert.equal(haggler.inv.getAmount(I.COINS), 120, '3 x 40');

    const bargainer = player({ inventory: { [SILK]: 1 } });
    choose(bargainer, "50, and that's my final price.");
    assert.notEqual(tradeAt(bargainer, 'Done.'), undefined, "'50, and that's my final price.' -> 'Done.' pays");
    assert.equal(bargainer.inv.getAmount(I.COINS), 50);
});

test('only the branch-final lines hand the silks over (regression: an opening line with no agreed price sold everything at once)', () => {
    const who = player({ inventory: { [SILK]: 3 } });
    for (const line of [
        'Hello. I have some fine silk from far away to sell to you.',
        'Ah I may be interested in that. What sort of price were you looking at per piece of silk?',
        "You'll never get that much for it. I'll be generous and give you 50 for it.",
    ]) {
        assert.equal(tradeAt(who, line), undefined, `'${line}' does not sell`);
    }
    assert.equal(who.inv.getAmount(SILK), 3, 'nothing was taken');
    assert.equal(who.inv.getAmount(I.COINS), 0, 'no empty coin stack appeared');
});

test('60-coins sales complete the easy Ardougne Diary task in the market only', () => {
    const diaryEvents = [];
    listeners.splice(0, listeners.length, ['diary:task', (request) => diaryEvents.push(request)]);
    const who = player({ inventory: { [SILK]: 1 } });
    choose(who, '120 coins.');
    choose(who, "I'll give it to you for 60.");
    tradeAt(who, 'You drive a hard bargain, but I guess that will have to do.');
    assert.deepEqual(
        diaryEvents.map((e) => `${e.diary}|${e.task}`),
        ['ardougne|sell-silk-to-silk-trader-in-ardougne-for-60-coin'],
    );
    const other = player({ inventory: { [SILK]: 1 } });
    choose(other, '120 coins.');
    choose(other, "I'll give it to you for 60.");
    tradeAt(other, 'You drive a hard bargain, but I guess that will have to do.', silkNpc(1625, 3682));
    assert.equal(other.inv.getAmount(I.COINS), 60, 'the Great Kourend merchant still buys silk');
    assert.equal(diaryEvents.length, 1, 'it just does not count for the Diary');
    const cheap = player({ inventory: { [SILK]: 1 } });
    choose(cheap, '20 coins.');
    tradeAt(cheap, 'Ok suits me.');
    assert.equal(diaryEvents.length, 1, '20-coins sales never complete the task');
});

test('the task requires a completed 60-coin sale and credits only once', () => {
    const diaryEvents = [];
    listeners.splice(0, listeners.length, ['diary:task', (request) => diaryEvents.push(request)]);

    const notedOnly = player({ inventory: { [SILK_NOTE]: 1 } });
    choose(notedOnly, '120 coins.');
    choose(notedOnly, "I'll give it to you for 60.");
    const noSilkCallback = tradeAt(notedOnly, 'You drive a hard bargain, but I guess that will have to do.');
    assert.equal(notedOnly.inv.getAmount(I.COINS), 0);
    assert.equal(diaryEvents.length, 0, 'noted silk cannot complete the task');
    noSilkCallback();
    assert.equal(diaryEvents.length, 0, 'a callback without a silk sale does not credit the task');

    const wrongPrice = player({ inventory: { [SILK]: 1 } });
    choose(wrongPrice, '20 coins.');
    assert.equal(tradeAt(wrongPrice, 'You drive a hard bargain, but I guess that will have to do.'), undefined);
    assert.equal(diaryEvents.length, 0, 'a final line at an unagreed price does not credit the task');

    const seller = player({ inventory: { [SILK]: 1 } });
    choose(seller, '120 coins.');
    choose(seller, "I'll give it to you for 60.");
    const completedSale = tradeAt(seller, 'You drive a hard bargain, but I guess that will have to do.');
    assert.equal(seller.inv.getAmount(I.COINS), 60);
    assert.equal(diaryEvents.length, 1);
    completedSale();
    assert.equal(seller.inv.getAmount(I.COINS), 60, 'replaying the callback does not repeat the sale');
    assert.equal(diaryEvents.length, 1, 'replaying the callback does not repeat task credit');

    const stale = player({ inventory: { [SILK]: 1 } });
    choose(stale, '120 coins.');
    choose(stale, "I'll give it to you for 60.");
    const staleCallback = tradeAt(stale, 'You drive a hard bargain, but I guess that will have to do.', silkNpc(), 8728, false);
    choose(stale, 'No, that is not enough.');
    stale.inv.adds(SILK, 1);
    staleCallback();
    assert.equal(stale.inv.getAmount(SILK), 2, 'a callback with a cleared agreement does not sell later silk');
    assert.equal(stale.inv.getAmount(I.COINS), 0);
    assert.equal(diaryEvents.length, 1, 'a stale callback does not credit the task');

    const renewed = player({ inventory: { [SILK]: 1 } });
    choose(renewed, '120 coins.');
    choose(renewed, "I'll give it to you for 60.");
    const oldAgreementCallback = tradeAt(renewed, 'You drive a hard bargain, but I guess that will have to do.', silkNpc(), 8728, false);
    choose(renewed, '120 coins.');
    choose(renewed, "I'll give it to you for 60.");
    oldAgreementCallback();
    assert.equal(renewed.inv.getAmount(SILK), 1, 'a callback cannot use a later agreement at the same price');
    assert.equal(renewed.inv.getAmount(I.COINS), 0);
    tradeAt(renewed, 'You drive a hard bargain, but I guess that will have to do.');
    assert.equal(renewed.inv.getAmount(SILK), 0, 'the renewed agreement can complete a new sale');
    assert.equal(renewed.inv.getAmount(I.COINS), 60);
    assert.equal(diaryEvents.length, 2);

    const acquiredLater = player();
    choose(acquiredLater, '120 coins.');
    choose(acquiredLater, "I'll give it to you for 60.");
    const emptyCallback = tradeAt(acquiredLater, 'You drive a hard bargain, but I guess that will have to do.', silkNpc(), 8728, false);
    emptyCallback();
    acquiredLater.inv.adds(SILK, 1);
    emptyCallback();
    assert.equal(acquiredLater.inv.getAmount(SILK), 1, 'a callback used without silk cannot sell silk acquired later');
    assert.equal(acquiredLater.inv.getAmount(I.COINS), 0);

    const cappedCoins = player({ inventory: { [SILK]: 1, [I.COINS]: MAX_STACK_AMOUNT - 59 } });
    choose(cappedCoins, '120 coins.');
    choose(cappedCoins, "I'll give it to you for 60.");
    tradeAt(cappedCoins, 'You drive a hard bargain, but I guess that will have to do.');
    assert.equal(cappedCoins.inv.getAmount(SILK), 1, 'silk remains when the full payout would overflow the coin stack');
    assert.equal(cappedCoins.inv.getAmount(I.COINS), MAX_STACK_AMOUNT - 59);
    assert.equal(diaryEvents.length, 2, 'an unpaid sale does not credit the task');

    const fullInventory = player({ inventory: { [SILK]: 28 } });
    choose(fullInventory, '120 coins.');
    choose(fullInventory, "I'll give it to you for 60.");
    tradeAt(fullInventory, 'You drive a hard bargain, but I guess that will have to do.');
    assert.equal(fullInventory.inv.getAmount(SILK), 0);
    assert.equal(fullInventory.inv.getAmount(I.COINS), 28 * 60, 'freed silk slots allow the payout stack');
    assert.equal(diaryEvents.length, 3, 'the fully paid sale credits the task');

    const wrongPlane = player({ inventory: { [SILK]: 1 } });
    choose(wrongPlane, '120 coins.');
    choose(wrongPlane, "I'll give it to you for 60.");
    tradeAt(wrongPlane, 'You drive a hard bargain, but I guess that will have to do.', silkNpc(2656, 3301, 1));
    assert.equal(wrongPlane.inv.getAmount(I.COINS), 60, 'the merchant still buys silk on another plane');
    assert.equal(diaryEvents.length, 3, 'another plane does not count for the task');

    const privatePlayer = player({ inventory: { [SILK]: 1 }, privateArea: {} });
    choose(privatePlayer, '120 coins.');
    choose(privatePlayer, "I'll give it to you for 60.");
    tradeAt(privatePlayer, 'You drive a hard bargain, but I guess that will have to do.');
    assert.equal(privatePlayer.inv.getAmount(I.COINS), 60);
    assert.equal(diaryEvents.length, 3, 'a sale in a private area does not count for the task');

    const privateMerchant = player({ inventory: { [SILK]: 1 } });
    choose(privateMerchant, '120 coins.');
    choose(privateMerchant, "I'll give it to you for 60.");
    tradeAt(privateMerchant, 'You drive a hard bargain, but I guess that will have to do.', silkNpc(2656, 3301, 0, {}));
    assert.equal(privateMerchant.inv.getAmount(I.COINS), 60);
    assert.equal(diaryEvents.length, 3, 'a private merchant does not count for the task');
});
