// Run after `yarn build`: node --test tests/teleport-tablet-destinations.test.cjs
// Every teleport tablet and scroll in the cache goes somewhere, and the Varrock, Camelot and
// Watchtower tablets' own options follow docs/teleport-tablets.md.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { PluginManager } = require('../dist/plugins/PluginManager');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { TeleportHandler } = require('../dist/game/model/teleportation/TeleportHandler');
const { TeleportType } = require('../dist/game/model/teleportation/TeleportType');
const { ItemIdentifiers: Items } = require('../dist/util/ItemIdentifiers');
const SpellTeleports = require('../plugins/combat/SpellTeleports.plugin');

// Tablets and scrolls that other plugins handle, or that aren't teleports anyone can use yet.
const ELSEWHERE = new Set([
    'teleport to house',        // Construction, through construction:house-tablet
    'teleport to boat',         // Sailing
    'revenant cave teleport',   // Revenant caves
    'target teleport',          // Bounty Hunter target
    'deadman teleport tablet',  // Deadman mode
    'volcanic mine teleport',   // not yet: no landing tile from a capture or RuneLite
    'guthixian temple teleport', // not yet: no landing tile from a capture or RuneLite
]);

let useTablet;
let castAlternate;
let prompt;
let diaries;
const casts = [];
const teleports = [];
const tabletIds = new Map();

before(async () => {
    const { CachePipeline } = require('../dist/game/cache/CachePipeline');
    await CachePipeline.initialize(path.resolve(__dirname, '..'));
    SpellTeleports.register({
        core: PluginManager.getCoreApi(),
        persistAttribute: () => {},
        onItemAction: (handler) => { useTablet = handler; },
        onPlayerLogin: () => {},
        onSpellCast: (handler) => { castAlternate = handler; },
        onInterfaceActionClick: () => {},
        sendMultiChatboxPrompt: (player, title, ...pairs) => { prompt = { title, pairs }; return true; },
        emitCustomEvent: (name, request) => {
            if (name === 'diary:is-complete') request.complete = diaries.has(`${request.diary} ${request.tier}`);
        },
    });
    TeleportHandler.checkReqs = () => true;
    const { SpellTeleports: Spells } = PluginManager.getCoreApi();
    Spells.handleSelf = (player, name, destination) => {
        casts.push({ name, tile: destination && [destination.getX(), destination.getY(), destination.getZ()] });
        return true;
    };
    TeleportHandler.teleport = (player, destination, type) => teleports.push({ destination, type });
    for (let id = 0; id < CacheDefinitions.getCounts().items; id++) {
        const item = CacheDefinitions.getItem(id);
        const name = item?.name?.toLowerCase() ?? '';
        const ops = (item?.inventoryActions ?? []).map((op) => op?.toLowerCase());
        if (!/teleport/.test(name) || item.noteTemplate >= 0 || item.placeholderTemplate >= 0) continue;
        const op = ops.includes('break') ? 'break' : ops.includes('teleport') ? 'teleport' : null;
        if (op && !tabletIds.has(name)) tabletIds.set(name, { id, op });
    }
});

function playerWith(itemId) {
    const messages = [];
    const attributes = new Map();
    const varbits = [];
    const inventory = new Map([[itemId, 1]]);
    return {
        messages, varbits, inventory,
        sendMessage: (message) => messages.push(message),
        getAttribute: (key) => attributes.get(key),
        setAttribute: (key, value) => attributes.set(key, value),
        getPacketSender: () => ({ sendVarbit: (id, value) => varbits.push([id, value]) }),
        getInventory: () => ({
            contains: (id) => (inventory.get(id) ?? 0) > 0,
            deleteNumber: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) - amount),
            adds: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) + amount),
        }),
    };
}

function use(name, option, player) {
    const { id } = tabletIds.get(name);
    player ??= playerWith(id);
    teleports.length = 0;
    const event = { player, itemId: id, option, handled: false };
    useTablet(event);
    const [teleport] = teleports;
    return { event, player, teleport, tile: teleport && [teleport.destination.getX(), teleport.destination.getY(), teleport.destination.getZ()] };
}

test('every teleport tablet and scroll in the cache has a destination', () => {
    assert.ok(tabletIds.size > 60, `found ${tabletIds.size} tablets and scrolls`);
    const missing = [];
    for (const [name, { op }] of tabletIds) {
        if (ELSEWHERE.has(name)) continue;
        const { event, teleport } = use(name, op);
        if (!event.handled || !teleport) missing.push(name);
        else assert.equal(teleport.type, op === 'teleport' ? TeleportType.TELE_SCROLL : TeleportType.TELE_TAB, name);
    }
    assert.deepEqual(missing, []);
});

test('Arceuus and Lunar tablets land where their spells do; Ape Atoll is the Arceuus tablet', () => {
    diaries = new Set();
    assert.deepEqual(use('barrows teleport', 'break').tile, [3565, 3315, 0]);
    assert.deepEqual(use('moonclan teleport', 'break').tile, [2113, 3917, 0]);
    assert.deepEqual(use('ape atoll teleport', 'break').tile, [2770, 9100, 0]);
});

test('a scroll is used up on the click, a tablet as it is absorbed', () => {
    const scroll = use('spider cave teleport', 'teleport');
    assert.equal(scroll.player.inventory.get(tabletIds.get('spider cave teleport').id), 0);
    const tablet = use('varrock teleport', 'break');
    assert.equal(tablet.player.inventory.get(tabletIds.get('varrock teleport').id), 1, 'kept until tick 2');
});

test('the Grand Exchange option needs the medium Varrock Diary', () => {
    diaries = new Set();
    const refused = use('varrock teleport', 'grand exchange');
    assert.equal(refused.event.handled, true);
    assert.equal(refused.teleport, undefined);
    assert.deepEqual(refused.player.messages, ['You must complete the medium, hard or elite tier of the Varrock achievement diary to use this feature.']);

    diaries = new Set(['varrock medium']);
    assert.deepEqual(use('varrock teleport', 'grand exchange').tile, [3165, 3477, 0]);
    assert.deepEqual(use('varrock teleport', 'varrock').tile, [3213, 3424, 0]);
});

test('Toggle makes Break go to the alternate, and sets the varbit the spell reads', () => {
    diaries = new Set(['kandarin hard']);
    const { player } = use('camelot teleport', 'toggle');
    assert.deepEqual(player.varbits, [[CacheDefinitions.getVarbitId('seers_camelot_teleport'), 1]]);
    assert.deepEqual(use('camelot teleport', 'break', player).tile, [2726, 3486, 0]);
    assert.deepEqual(use('camelot teleport', 'camelot', player).tile, [2757, 3478, 0]);

    use('camelot teleport', 'toggle', player);
    assert.deepEqual(player.varbits.at(-1), [CacheDefinitions.getVarbitId('seers_camelot_teleport'), 0]);
    assert.deepEqual(use('camelot teleport', 'break', player).tile, [2757, 3478, 0]);
});

test('Revert turns a redirected tablet back into a Teleport to house tablet', () => {
    const { event, player } = use('yanille teleport', 'revert');
    assert.equal(event.handled, true);
    assert.equal(player.inventory.get(tabletIds.get('yanille teleport').id), 0);
    assert.equal(player.inventory.get(Items.TELEPORT_TO_HOUSE), 1);
});

/** Clicks an option on a spell, as NetworkBuilder emits it; unhandled means the usual cast. */
function cast(spell, opId, player) {
    player ??= playerWith(-1);
    casts.length = 0;
    prompt = undefined;
    const event = { player, spellName: spell, spellWidget: -1, spellItemId: -1, opId, handled: false };
    castAlternate(event);
    return { event, player, cast: casts[0] };
}

test('the spell alternate option needs the diary; Cast still goes to the town', () => {
    diaries = new Set();
    const refused = cast('Varrock Teleport', 2);
    assert.equal(refused.event.handled, true);
    assert.equal(refused.cast, undefined);
    assert.deepEqual(refused.player.messages, ['You must complete the medium, hard or elite tier of the Varrock achievement diary to use this feature.']);
    assert.equal(cast('Varrock Teleport', 1).event.handled, false, 'Cast is the usual cast');

    diaries = new Set(['varrock medium', 'kandarin hard', 'ardougne hard']);
    assert.deepEqual(cast('Varrock Teleport', 2).cast.tile, [3165, 3477, 0]);
    assert.deepEqual(cast('Camelot Teleport', 2).cast.tile, [2726, 3486, 0]);
    assert.deepEqual(cast('Watchtower Teleport', 2).cast.tile, [2583, 3095, 0]);
    assert.equal(cast('Watchtower Teleport', 3).event.handled, false);
});

test('Configure asks as in the capture, and the choice is shared with the tablets', () => {
    diaries = new Set(['varrock medium']);
    const { player } = cast('Varrock Teleport', 10);
    assert.equal(prompt.title, 'Spellbook/portal default: Varrock');
    assert.deepEqual(prompt.pairs.filter((entry) => typeof entry === 'string'), ['Change to the Grand Exchange.', 'Cancel.']);
    prompt.pairs[1](player, 0, prompt.pairs[0]);
    assert.deepEqual(player.messages, ['Your default option is now the Grand Exchange teleport.']);
    assert.deepEqual(player.varbits, [[CacheDefinitions.getVarbitId('varrock_ge_teleport'), 1]]);
    player.inventory.set(tabletIds.get('varrock teleport').id, 1);
    assert.deepEqual(use('varrock teleport', 'break', player).tile, [3165, 3477, 0]);

    cast('Varrock Teleport', 10, player);
    assert.equal(prompt.title, 'Spellbook/portal default: Grand Exchange');
    prompt.pairs[1](player, 0, prompt.pairs[0]);
    assert.equal(player.messages.at(-1), 'Your default option is now the central Varrock teleport.');
    assert.deepEqual(player.varbits.at(-1), [CacheDefinitions.getVarbitId('varrock_ge_teleport'), 0]);
});
