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
});

test('required policy readiness survives actual plugin failures and publishes only complete reloads', async t => {
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    const { GameConstants } = require('../dist/game/GameConstants');
    const { PluginManager } = require('../dist/plugins/PluginManager');
    const { Player } = require('../dist/game/entity/impl/player/Player');
    const { PlayerSession } = require('../dist/net/PlayerSession');
    const { ClientConnection } = require('../dist/net/NetworkBuilder');
    const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
    let serial = 0;
    function actor() {
        const channel = { kind: 'test', binaryTransport: true, isOpen: () => true, send: () => true,
            close() {}, onData() {}, onClose() {}, onError() {} };
        const session = new PlayerSession(channel), player = new Player(session); session.setPlayer(player);
        player.setUsername('policy' + ++serial); player.setIndex(serial); player.setRegistered(true);
        const connection = new ClientConnection(channel); connection.player = player;
        return { player, session, connection };
    }
    async function offered(id) {
        const a = actor(), b = actor();
        try {
            a.player.getInventory().adds(id, 1);
            a.player.getTrading().requestTrade(b.player); b.player.getTrading().requestTrade(a.player);
            const raw = Buffer.alloc(11); raw[0] = 180; raw[1] = 9; raw[2] = 0;
            raw.writeUInt16BE(a.player.getInventory().getSlotForItemId(id), 3);
            raw.writeInt32BE(1, 5); raw.writeUInt16BE(id, 9);
            await a.connection.dispatch(decodeClientPackets(raw)); a.connection.processTurnPackets();
            return a.player.getTrading().getContainer().getAmount(id);
        } finally {
            a.player.getTrading().closeTrade();
            for (const f of [a, b]) { PluginManager.getCoreApi().TaskManager.cancelTasks(f.player);
                f.player.setRegistered(false); f.session.flushPackets(); }
        }
    }
    assert.equal(await offered(34065), 0, 'cold uninitialized policy cannot permit cache fallback');
    assert.equal(await offered(8903), 0, 'readiness gates every player-trade classification until successful loading');
    assert.equal(new Item(995).isTradeable(), true, 'cold readiness does not change Exchange policy');
    const original = GameConstants.DEFINITIONS_DIRECTORY;
    const canonical = fs.readFileSync(path.join(original, 'item-player-tradeability.json'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trade-policy-lifecycle-'));
    const policy = path.join(dir, 'item-player-tradeability.json');
    const overrides = path.join(dir, 'item-overrides.json'), custom = path.join(dir, 'custom-items.json');
    fs.copyFileSync(path.join(original, 'item-gameplay.json'), path.join(dir, 'item-gameplay.json'));
    let logs = 0;
    function register(expectSuccess) {
        const previousError = console.error, previousLog = console.log;
        console.error = () => logs++; console.log = () => {};
        let result;
        try { result = PluginManager.registerPluginCandidate({ plugin: Loader, pluginName: 'PolicyLifecycle',
            pluginPath: path.resolve('plugins/items/ItemDefinitionLoader.plugin.js'), dependsOn: [] }); }
        finally { console.error = previousError; console.log = previousLog; }
        assert.equal(result !== null, expectSuccess, 'actual plugin manager catches failed candidate initialization');
    }
    GameConstants.DEFINITIONS_DIRECTORY = dir;
    try {
        for (const bad of [null, '{broken', JSON.stringify({ schema: 1, input_sha256: 'a'.repeat(64),
            rows: [{ id: 34065, name: 'Shark lure pack', playerTradeable: 'No', noteable: true }] })]) {
            if (bad === null) { if (fs.existsSync(policy)) fs.unlinkSync(policy); }
            else fs.writeFileSync(policy, bad);
            register(false);
            assert.equal(await offered(34065), 0, 'cold missing/corrupt/invalid source stays closed after swallowed failure');
        }
        fs.writeFileSync(policy, JSON.stringify({ schema: 1, input_sha256: 'a'.repeat(64), rows: [] }));
        register(true);
        assert.equal(await offered(34065), 1, 'successfully loaded valid unknown document intentionally retains cache fallback');
        fs.writeFileSync(policy, canonical); register(true);
        assert.equal(await offered(34065), 0); assert.equal(await offered(8903), 1);
        fs.writeFileSync(overrides, JSON.stringify({ 995: { value: 7 }, 8903: { tradeable: false } }));
        register(true);
        const stableMap = ItemDefinition.definitions, stableCoin = ItemDefinition.forId(995);
        for (const bad of [null, '{broken', JSON.stringify({ ...JSON.parse(canonical),
            rows: [...JSON.parse(canonical).rows, { id: 60010, name: 'Bad later row', playerTradeable: 'No' }] })]) {
            if (bad === null) fs.unlinkSync(policy); else fs.writeFileSync(policy, bad);
            register(false);
            assert.equal(ItemDefinition.definitions, stableMap, 'failed validation cannot clear the last successful map');
            assert.equal(ItemDefinition.forId(995), stableCoin);
            assert.equal(stableCoin.getValue(), 7); assert.equal(await offered(8903), 0, 'valid world override survives failure');
            assert.equal(await offered(34065), 0);
        }
        fs.writeFileSync(policy, JSON.stringify({ schema: 1, input_sha256: 'a'.repeat(64), rows: [] }));
        fs.writeFileSync(custom, JSON.stringify([{ id: 60010, objType: { name: 'Bad custom' }, itemDef: { tradeable: 'invalid' } }]));
        register(false); // Valid policy, but failure after candidate definition/source construction and before publication.
        assert.equal(ItemDefinition.definitions, stableMap);
        assert.equal(ItemDefinition.forId(995), stableCoin); assert.equal(stableCoin.getValue(), 7);
        assert.equal(await offered(34065), 0, 'late full-loader failure cannot publish valid-unknown fallback');
        fs.unlinkSync(custom); fs.unlinkSync(overrides); fs.writeFileSync(policy, canonical); register(true);
        assert.equal(await offered(34065), 0); assert.equal(await offered(8903), 1, 'successful restoration removes old override');
        assert.notEqual(ItemDefinition.forId(995).getValue(), 7);
        assert.equal(logs, 7, 'all seven expected initialization failures traversed the real PluginManager catch');
    } finally {
        GameConstants.DEFINITIONS_DIRECTORY = original; Loader.register(api);
        assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
        assert.ok(path.basename(dir).startsWith('trade-policy-lifecycle-'));
        fs.rmSync(dir, { recursive: true, force: true });
    }
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
