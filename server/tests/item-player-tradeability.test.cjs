const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const { Item } = require('../dist/game/model/Item');
const Loader = require('../plugins/items/ItemDefinitionLoader.plugin');
const api = { log() {}, registerContentEndpoint() {}, onPlayerLogin() {} };
const changed = [12747, 28887, 28888, 34065, 34066];
let ge;
before(async () => {
    await CachePipeline.initialize();
    ge = changed.map(id => ItemDefinition.forId(id).isTradeable());
    Loader.register(api); // The actual plugin registration/load lifecycle, including generated source and overrides.
});

test('registered loading applies exact source policy and only verified source-noteable note inheritance', () => {
    for (const id of changed) assert.equal(new Item(id).isPlayerTradeable(), false, `source-untradeable ${id}`);
    assert.deepEqual(changed.map(id => ItemDefinition.forId(id).isTradeable()), ge, 'GE flags stay unchanged');
    assert.equal(new Item(12746).isPlayerTradeable(), true, 'explicit note-only No never propagates backward');
    for (const id of [8903, 8919, 2554, 2566, 2146]) assert.equal(new Item(id).isPlayerTradeable(), true);
    assert.equal(new Item(31368).isPlayerTradeable(), false, 'stale Wiki ID cannot make an actual placeholder tradeable');
    assert.equal(ItemDefinition.forId(999999999).isPlayerTradeable(), false, 'invalid ID remains unknown and refused');
});

test('world override precedence preserves instance metadata guards and reload removes stale overrides', () => {
    Loader._test.applyItemOverrides({ 34065: { tradeable: true }, 8903: { tradeable: false } });
    assert.equal(new Item(34065).isPlayerTradeable(), true);
    assert.equal(new Item(34065, 1, { untradeable: true }).isPlayerTradeable(), false);
    assert.equal(new Item(8903).isPlayerTradeable(), false);
    Loader.register(api);
    assert.equal(new Item(34065).isPlayerTradeable(), false, 'registration reloads source after clearing prior definitions');
    assert.equal(new Item(8903).isPlayerTradeable(), true);
});

test('source-No ordinary and noted items remain owner-only after reveal; source-Yes still transfers', () => {
    const { Player } = require('../dist/game/entity/impl/player/Player');
    const { PlayerSession } = require('../dist/net/PlayerSession');
    const { ItemOnGroundManager: Ground } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
    const { State } = require('../dist/game/entity/impl/grounditem/ItemOnGround');
    const { Location } = require('../dist/game/model/Location');
    const actor = name => {
        const channel = { kind: 'test', binaryTransport: true, isOpen: () => true, send: () => true,
            close() {}, onData() {}, onClose() {}, onError() {} };
        const session = new PlayerSession(channel), player = new Player(session); session.setPlayer(player);
        player.setUsername(name); player.setLocation(new Location(3222, 3218)); return player;
    };
    const owner = actor('PolicyOwner'), other = actor('PolicyOther');
    for (const id of [...changed, 8903]) {
        const pile = Ground.registerLocation(owner, new Item(id), owner.getLocation().clone());
        try {
            for (let tick = 0; tick < Ground.PUBLIC_REVEAL_DELAY; tick++) pile.process();
            assert.equal(pile.getState(), State.SEEN_BY_EVERYONE);
            assert.equal(Ground.canSee(owner, pile), true);
            assert.equal(Ground.transferToInventory(other, pile), id === 8903 ? 1 : 0, `other pickup ${id}`);
            if (id !== 8903) assert.equal(Ground.transferToInventory(owner, pile), 1, `owner pickup ${id}`);
        } finally { Ground.deregister(pile); }
    }
});

test('the registered NPC drop consumer keeps source-No lifetimes and existing source-Yes controls', () => {
    const handlers = new Map();
    const { Player } = require('../dist/game/entity/impl/player/Player');
    const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
    const { Location } = require('../dist/game/model/Location');
    const { World } = require('../dist/game/World');
    require('../plugins/npcs/NpcDrops.plugin').register(new Proxy({ core: {},
        getItemOnGroundManager: () => ItemOnGroundManager,
        onCustomEvent: (name, handler) => handlers.set(name, handler),
    }, { get: (target, key) => key in target ? target[key] : () => {} }));
    const player = new Player(null); player.setUsername('PolicyDrops');
    const location = new Location(3222, 3218);
    const ids = [...changed, 8903, 2146];
    const before = new Set(World.getItems());
    handlers.get('npc-drops:place')({ player, location, drops: ids.map(itemId => ({ itemId, amount: 1 })) });
    const piles = World.getItems().filter(pile => !before.has(pile));
    try {
        assert.equal(piles.length, ids.length);
        for (const pile of piles) assert.equal(pile.getDespawnDelay(), changed.includes(pile.getItem().getId()) ? 300 : 200);
    } finally { for (const pile of piles) ItemOnGroundManager.deregister(pile); }
});

test('custom definitions inherit sourced base policy unless their explicit tradeable property replaces it', () => {
    const rows = [60001, 60002, 60003].map(id => ({ id, baseItemId: 34065, objType: { name: 'Custom pack' } }));
    CacheDefinitions.registerCustomItems(rows);
    const inherited = ItemDefinition.registerCustom(60001, 34065);
    const allowed = ItemDefinition.registerCustom(60002, 34065, { tradeable: true });
    const refused = ItemDefinition.registerCustom(60003, 8903, { tradeable: false });
    assert.equal(inherited.isPlayerTradeable(), false);
    assert.equal(allowed.isPlayerTradeable(), true);
    assert.equal(refused.isPlayerTradeable(), false);
});
