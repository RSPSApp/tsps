// Run after `yarn build`: node --test tests/venator-bow.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const VenatorBow = require('../plugins/items/VenatorBow.plugin');

const BOW = ItemIdentifiers.VENATOR_BOW;
const UNCHARGED = ItemIdentifiers.VENATOR_BOW_UNCHARGED_;

function location(x, y, z = 0) {
    return {
        getX: () => x,
        getY: () => y,
        getZ: () => z,
        getDistance: (other) => Math.max(Math.abs(other.getX() - x), Math.abs(other.getY() - y)),
    };
}

function npc(x, y, size = 1) {
    const entity = {
        isNpc: () => true,
        isPlayer: () => false,
        getAsNpc: () => ({ getSize: () => size }),
        getLocation: () => location(x, y),
    };
    return entity;
}

function bow(charges) {
    const meta = new Map([[VenatorBow._test.CHARGE_META_KEY, charges]]);
    let id = charges > 0 ? BOW : UNCHARGED;
    return {
        getId: () => id,
        setId: (next) => { id = next; },
        getMetaValue: (key) => meta.get(key),
        setMetaValue: (key, value) => meta.set(key, value),
    };
}

// One registration against a fake core; each shot resets what it records.
let multi = true;
let projectiles = [];
let sounds = [];
let rerolled = [];
let resolver;
class RangedCombatMethod {
    hits(character, target) {
        return [new PendingHit(character, target, this, 2)];
    }
    static projectileEnd(projectile, distance) {
        return projectile.delay + projectile.lengthAdjustment + projectile.stepMultiplier * distance;
    }
}
class PendingHit {
    constructor(attacker, target, method, delay) {
        Object.assign(this, { attacker, target, delay });
    }
    getDelay() {
        return this.delay;
    }
    getTarget() {
        return this.target;
    }
}
VenatorBow.register({
    emitCustomEvent: () => {},
    core: {
        Equipment,
        ItemIdentifiers,
        ItemAliases: { register: () => {} },
        RangedCombatMethod,
        PendingHit,
        Flag: { APPEARANCE: 0 },
        Misc: { getRandom: () => 0 },
        Sound: class { constructor(id) { this.id = id; } },
        Sounds: { sendSound: (_, sound) => sounds.push(sound.id) },
        WeaponProfiles: {
            ranged: () => ({ projectiles: [{ delay: 31, lengthAdjustment: 15, stepMultiplier: 2 }] }),
        },
        Projectile: {
            createProjectile: (source, target, id, start, end) => {
                const shot = { source, target, id, start, end };
                const projectile = {
                    withAngle: (angle) => Object.assign(shot, { angle }) && projectile,
                    withProgress: (progress) => Object.assign(shot, { progress }) && projectile,
                    sendProjectile: () => projectiles.push(shot),
                };
                return projectile;
            },
        },
        CombatPosition: require('../dist/game/content/combat/CombatPosition').CombatPosition,
        CombatFactory: {
            multiCombatBetween: () => multi,
            canAttackSecondaryTarget: (attacker, origin, candidate) => candidate !== attacker && candidate !== origin,
            applyStyleDamage: (_, max) => rerolled.push(max),
        },
        DamageFormulas: { calculateMaxRangedHit: () => 40 },
        Bank: { ITEM_OP_EVENT: 'bank:item-op' },
    },
    registerCombatMethodResolver: (r) => { resolver = r; },
    onItemAction: () => {},
    onItemOnItem: () => {},
    onCustomEvent: () => {},
});

function shoot(weapon, target, nearby) {
    projectiles = [];
    sounds = [];
    rerolled = [];
    const messages = [];
    const items = new Array(14).fill(null);
    items[Equipment.WEAPON_SLOT] = weapon;
    const player = {
        isPlayer: () => true,
        isNpc: () => false,
        getAsPlayer: () => player,
        getLocation: () => location(3200, 3200),
        getEquipment: () => ({ get: (slot) => items[slot], refreshItems: () => {} }),
        getInventory: () => ({ refreshItems: () => {} }),
        getUpdateFlag: () => ({ flag: () => {} }),
        getLocalNpcs: () => [target, ...nearby],
        getLocalPlayers: () => [],
        sendMessage: (message) => messages.push(message),
    };
    const method = resolver.resolve(player);
    if (!method) return { method, messages };
    return { method, hits: method.hits(player, target), messages };
}

test('a charged bow ricochets to the two nearest targets in multicombat', () => {
    const primary = npc(3201, 3200);
    const near = npc(3203, 3200);
    const next = npc(3204, 3200);
    const { hits } = shoot(bow(1000), primary, [next, near]);
    assert.deepEqual(hits.map((hit) => hit.getTarget()), [primary, near, next]);
    assert.deepEqual(rerolled, [26, 26], 'bounces max two-thirds of 40, rounded down');
    assert.deepEqual(sounds, [6672, 6735]);
});

test('bounces chain from the arrow landing, 15 cycles each, as captured', () => {
    const primary = npc(3201, 3200);
    const near = npc(3203, 3200);
    const next = npc(3204, 3200);
    const { hits } = shoot(bow(1000), primary, [near, next]);
    assert.deepEqual(projectiles.map(({ id, start, end, angle, progress }) => [id, start, end, angle, progress]),
        [[2007, 48, 63, 127, 0], [2007, 63, 78, 127, 0]]);
    assert.equal(projectiles[0].source, primary);
    assert.equal(projectiles[1].source, near);
    assert.deepEqual(hits.map((hit) => hit.getDelay()), [2, 2, 3], 'the first bounce lands with the arrow, the second a tick later');
});

test('the second bounce may return to the first target', () => {
    const primary = npc(3203, 3200);
    const only = npc(3205, 3200);
    const { hits } = shoot(bow(1000), primary, [only]);
    assert.deepEqual(hits.map((hit) => hit.getTarget()), [primary, only, primary]);
    assert.deepEqual(sounds, [6672, 6735]);
});

test('targets further than 2 tiles are out of reach, measured from any tile of a 2x2', () => {
    const primary = npc(3203, 3200, 2);
    assert.equal(shoot(bow(1000), primary, [npc(3207, 3200)]).hits.length, 1);
    assert.equal(shoot(bow(1000), primary, [npc(3206, 3200)]).hits.length, 3);
    assert.equal(VenatorBow._test.bounceDistance(npc(3200, 3200, 5), npc(3205, 3202)), 3,
        'a 5x5 searches from its centre tile');
});

test('no ricochet in single combat, but the attack still spends a charge', () => {
    multi = false;
    try {
        const weapon = bow(1000);
        const { hits } = shoot(weapon, npc(3203, 3200), [npc(3204, 3200)]);
        assert.equal(hits.length, 1);
        assert.equal(VenatorBow._test.charges(weapon), 999);
    } finally {
        multi = true;
    }
});

test('charge warnings at every 500, and at 100 and 50', () => {
    assert.deepEqual(shoot(bow(501), npc(3203, 3200), []).messages,
        ['Your venator bow has <col=ff0000>500 charges</col> remaining.']);
    assert.deepEqual(shoot(bow(101), npc(3203, 3200), []).messages,
        ['Your venator bow has <col=ff0000>100 charges</col> remaining.']);
    assert.deepEqual(shoot(bow(52), npc(3203, 3200), []).messages, []);
});

test('the last charge reverts the bow, which then shoots without ricochets', () => {
    const weapon = bow(1);
    shoot(weapon, npc(3203, 3200), []);
    assert.equal(weapon.getId(), UNCHARGED);
    assert.equal(shoot(weapon, npc(3203, 3200), []).method, null);
});


// Native inventory selection and dialogue continuation preserve the shard entitlement.
test('combining Venator shards conserves the input when the bow cannot fit', async (t) => {
    const path = require('node:path');
    const { CachePipeline } = require('../dist/game/cache/CachePipeline');
    const { PluginManager: PM } = require('../dist/plugins/PluginManager');
    const { Player } = require('../dist/game/entity/impl/player/Player');
    const { PlayerSession } = require('../dist/net/PlayerSession');
    const { ClientConnection } = require('../dist/net/NetworkBuilder');
    const { ItemActionPacketListener } = require('../dist/net/packet/impl/ItemActionPacketListener');
    const { StatementDialogue } = require('../dist/game/model/dialogues/entries/impl/StatementDialogue');
    const { OptionDialogue } = require('../dist/game/model/dialogues/entries/impl/OptionDialogue');
    const previousBots = process.env.DISABLE_PLAYER_BOTS;
    process.env.DISABLE_PLAYER_BOTS = '1';
    t.after(() => {
        PM.emitServerShutdown({});
        if (previousBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
        else process.env.DISABLE_PLAYER_BOTS = previousBots;
    });
    await CachePipeline.initialize(path.resolve(__dirname, '..'));
    PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
    const native = PM.getCoreApi();
    native.RegionManager.init();
    native.RegionManager.loadMapFiles(3222, 3218);
    PM.emitServerStartup({});
    const ids = native.ItemIdentifiers;
    const shard = ids.VENATOR_SHARD;
    const bow = ids.VENATOR_BOW_UNCHARGED_;
    assert.equal(shard, 27614, 'revision 241 venator_shard identifier');
    assert.equal(native.ItemDefinition.forId(shard).getName(), 'Venator shard');
    assert.equal(native.ItemDefinition.forId(shard).isStackable(), true);
    assert.equal(native.ItemDefinition.forId(bow).getName(), 'Venator bow (uncharged)');
    assert.equal(native.ItemDefinition.forId(bow).isStackable(), false);
    let combineOp;
    for (const op of [2, 3, 4, 6, 7]) {
        const action = ItemActionPacketListener.resolveInventoryWidgetAction(shard, op);
        if (action?.option === 'Combine') combineOp = op;
    }
    assert.ok(Number.isInteger(combineOp), 'Combine resolves from the actual inventory definition');
    let index = 6400;
    for (const mode of ['room', 'consumed-slot', 'split-consumed-slot', 'split-full-surplus', 'full-surplus', 'decline', 'insufficient']) {
        await t.test(mode, async (t) => {
            const channel = {
                kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
                send: () => true, close() {}, onData() {}, onError() {}, onClose() {},
            };
            const player = new Player(new PlayerSession(channel));
            player.setIndex(index++);
            player.setUsername(`shard_${mode}`);
            player.setRegistered(true);
            player.setLocation(new native.Location(3222, 3218));
            player.needsPlacement = false;
            const connection = new ClientConnection(channel);
            connection.player = player;
            const inv = player.getInventory();
            const send = async (packet) => {
                await connection.dispatch([packet]);
                connection.processTurnPackets();
            };
            t.after(() => {
                player.closeInterruptibleInterfaces();
                PM.emitPlayerLogout({ player, username: player.getUsername() });
                player.setRegistered(false);
                native.TaskManager.cancelTasks(player.getIndex());
                native.TaskManager.cancelTasks(player);
                native.TaskManager.process();
                for (const ground of native.World.getItems().filter(g => g.getOwner() === player.getUsername())) {
                    native.ItemOnGroundManager.deregister(ground);
                }
            });
            const owned = id => inv.getAmount(id) + player.getEquipment().getAmount(id)
                + player.getBanks().reduce((n, bank, tab) => n + (bank && tab !== native.Bank.BANK_SEARCH_TAB_INDEX ? bank.getAmount(id) : 0), 0)
                + native.World.getItems().filter(g => !g.isPendingRemoval() && g.getOwner() === player.getUsername()
                    && g.getPrivateArea() === player.getPrivateArea() && g.getItem().getId() === id)
                    .reduce((n, ground) => n + ground.getItem().getAmount(), 0);
            const snapshot = () => ({ shards: owned(shard), bows: owned(bow), free: inv.getFreeSlots() });
            const initial = mode === 'insufficient' ? 4 : mode === 'consumed-slot' ? 5 : 10;
            if (mode.startsWith('split-')) {
                const first = mode === 'split-consumed-slot' ? 3 : 7;
                inv.add(new native.Item(shard, first), false);
                const other = new native.Item(shard, initial - first);
                other.setMetaValue('test:separate-stack', true);
                inv.add(other, false);
                assert.equal(inv.getItems().filter(item => item.getId() === shard).length, 2);
            } else {
                inv.add(new native.Item(shard, initial), false);
            }
            const slots = mode === 'room' ? 1 : 0;
            while (inv.getFreeSlots() > slots) inv.add(new native.Item(ids.RAKE), false);
            assert.equal(inv.getFreeSlots(), slots);
            const before = snapshot();
            const slot = inv.getSlotForItemId(shard);
            await send({ type: 'widget_action', widgetId: 149 << 16, groupId: 149, childId: 0,
                buttonNum: combineOp, slot, itemId: shard });
            const dialogue = player.getDialogueManager();
            assert.ok(dialogue.getCurrent() instanceof StatementDialogue, 'real shard statement owns the continuation');
            assert.deepEqual(snapshot(), before, 'opening the warning never spends shards');
            if (mode !== 'insufficient') {
                assert.match(dialogue.getCurrent().getText(), /five venator shards/);
                const group = player.getPacketSender().getChatboxGroupId();
                assert.ok(group >= 0 && dialogue.canContinue((group << 16) | 4));
                await send({ type: 'dialogue_continue', widgetId: (group << 16) | 4, childIndex: -1 });
                assert.ok(dialogue.getCurrent() instanceof OptionDialogue, 'native warning reaches its real choice');
                assert.deepEqual(dialogue.getCurrent().getOptions(), ['Yes.', 'No.']);
                assert.deepEqual(snapshot(), before, 'choice is pending with untouched resources');
                await send({ type: 'dialogue_continue', widgetId: OptionDialogue.OPTIONS_WIDGET_ID,
                    childIndex: mode === 'decline' ? 2 : 1 });
            } else {
                assert.match(dialogue.getCurrent().getText(), /need one more/);
            }
            const after = snapshot();
            const details = JSON.stringify({ mode, before, after });
            assert.equal(after.shards + 5 * after.bows, before.shards + 5 * before.bows,
                `five shards or one bow must remain owned: ${details}`);
            const success = mode === 'room' || mode === 'consumed-slot' || mode === 'split-consumed-slot';
            assert.equal(after.shards, initial - (success ? 5 : 0), details);
            assert.equal(after.bows, success ? 1 : 0, details);
        });
    }
});

// Real charging, bank deposit, bank item operation and amount submission.
test('bank Configure-Charges conserves Venator essence when refund space is limited', async (t) => {
    const path = require('node:path');
    const { CachePipeline } = require('../dist/game/cache/CachePipeline');
    const { PluginManager: PM } = require('../dist/plugins/PluginManager');
    const { Player } = require('../dist/game/entity/impl/player/Player');
    const { PlayerSession } = require('../dist/net/PlayerSession');
    const { ClientConnection } = require('../dist/net/NetworkBuilder');
    const { MAX_STACK_AMOUNT: MAX } = require('../dist/game/model/container/StackType');
    const previousBots = process.env.DISABLE_PLAYER_BOTS;
    process.env.DISABLE_PLAYER_BOTS = '1';
    t.after(() => {
        PM.emitServerShutdown({});
        if (previousBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
        else process.env.DISABLE_PLAYER_BOTS = previousBots;
    });
    await CachePipeline.initialize(path.resolve(__dirname, '..'));
    PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
    const native = PM.getCoreApi(), ids = native.ItemIdentifiers, Bank = native.Bank;
    native.RegionManager.init(); native.RegionManager.loadMapFiles(3226, 3218);
    PM.emitServerStartup({});
    const essence = ids.ANCIENT_ESSENCE;
    assert.equal(native.ItemDefinition.forId(essence).getName(), 'Ancient essence');
    assert.equal(native.ItemDefinition.forId(essence).isStackable(), true);
    assert.equal(native.ItemDefinition.forId(ids.VENATOR_BOW).getName(), 'Venator bow');
    assert.equal(typeof native.CacheDefinitions.getItem(ids.VENATOR_BOW).params?.get(2257), 'number',
        'active charged bow has the bank Configure-Charges parameter');
    let index = 6600;
    for (const mode of ['room', 'exact', 'near', 'full']) await t.test(mode, async (t) => {
        const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
            send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
        const player = new Player(new PlayerSession(channel));
        player.setIndex(index++); player.setUsername(`bowrefund_${mode}`);
        player.setRegistered(true); player.setLocation(new native.Location(3226, 3218));
        player.needsPlacement = false;
        const connection = new ClientConnection(channel); connection.player = player;
        const inventory = player.getInventory();
        t.after(() => {
            player.closeInterruptibleInterfaces();
            PM.emitPlayerLogout({ player, username: player.getUsername() });
            player.setRegistered(false); native.TaskManager.cancelTasks(player.getIndex());
            native.TaskManager.cancelTasks(player); native.TaskManager.process();
            for (const ground of native.World.getItems().filter(g => g.getOwner() === player.getUsername())) {
                native.ItemOnGroundManager.deregister(ground);
            }
        });
        let turns = 0;
        const turn = () => {
            assert.ok(++turns <= 20, 'bounded native phase budget'); player.resetUpdating();
            native.World.processCycle = (native.World.processCycle + 1) & 0x7fffffff;
            native.TaskManager.process(); connection.processTurnPackets();
            const queue = player.getMovementQueue(); queue.beginCycle(); queue.processEntityPursuit();
            if (queue.hasPendingWork()) queue.process(); native.TaskManager.processWalkTo(player.getIndex());
        };
        const send = async packet => { await connection.dispatch([packet]); turn(); };
        const floor = id => native.World.getItems().filter(g => !g.isPendingRemoval()
            && g.getOwner() === player.getUsername() && g.getPrivateArea() === player.getPrivateArea()
            && g.getItem().getId() === id).reduce((n, g) => n + g.getItem().getAmount(), 0);
        const owned = id => inventory.getAmount(id) + player.getEquipment().getAmount(id)
            + player.getBanks().reduce((n, bank, tab) => n + (bank && tab !== Bank.BANK_SEARCH_TAB_INDEX ? bank.getAmount(id) : 0), 0)
            + floor(id);
        inventory.add(new native.Item(ids.VENATOR_BOW_UNCHARGED_), false);
        inventory.add(new native.Item(essence, mode === 'room' ? 1000 : MAX), false);
        const heldBow = inventory.getItems()[inventory.getSlotForItemId(ids.VENATOR_BOW_UNCHARGED_)];
        await send({ type: 'inventory_use_on', slot: inventory.getSlotForItemId(essence), itemId: essence,
            target: { kind: 'inventory', slot: inventory.getSlotForItemId(ids.VENATOR_BOW_UNCHARGED_),
                itemId: ids.VENATOR_BOW_UNCHARGED_ } });
        assert.ok(player.getEnteredAmountAction(), 'real essence-on-bow opens the amount prompt');
        assert.equal(VenatorBow._test.charges(heldBow), 0);
        await send({ type: 'dialogue_amount', amount: 100 });
        assert.equal(heldBow.getId(), ids.VENATOR_BOW);
        assert.equal(VenatorBow._test.charges(heldBow), 100, 'real charging producer');
        assert.equal(owned(essence), (mode === 'room' ? 1000 : MAX) - 100);
        const replenished = mode === 'near' ? 50 : mode === 'full' ? 100 : 0;
        if (replenished) {
            const at = player.getLocation();
            native.ItemOnGroundManager.registerLocation(player, new native.Item(essence, replenished), at.clone());
            assert.equal(floor(essence), replenished);
            await send({ type: 'ground_item_action', itemId: essence, x: at.getX(), y: at.getY(), option: 'Take', optionIndex: 3 });
            for (let wait = 0; wait < 4 && floor(essence) > 0; wait++) turn();
            assert.equal(floor(essence), 0, 'native pickup credited the full lawful top-up');
        }
        player.closeInterruptibleInterfaces();
        player.getBank(0).open(); assert.equal(Bank.isOpen(player), true);
        Bank.deposits(player, ids.VENATOR_BOW, inventory.getSlotForItemId(ids.VENATOR_BOW), 1);
        Bank.deposits(player, essence, inventory.getSlotForItemId(essence), inventory.getAmount(essence));
        assert.equal(inventory.getAmount(essence), 0); assert.equal(inventory.getAmount(ids.VENATOR_BOW), 0);
        const tab = Bank.getTabForItem(player, ids.VENATOR_BOW), bank = player.getBank(tab);
        assert.equal(tab, 0, 'both deposits use the first native bank tab');
        const slot = bank.getSlotForItemId(ids.VENATOR_BOW), bankedBow = bank.getItems()[slot];
        assert.equal(bankedBow.getAmount(), 1); assert.equal(VenatorBow._test.charges(bankedBow), 100);
        assert.equal(Bank.resolveDisplaySlot(player, slot)?.item, bankedBow, 'packet slot resolves the actual deposited bow');
        const bankEssence = player.getBank(Bank.getTabForItem(player, essence));
        const addable = bankEssence.getAddableAmount(new native.Item(essence, 100));
        assert.equal(addable, mode === 'near' ? 50 : mode === 'full' ? 0 : 100);
        const state = () => ({ mode, essence: owned(essence), charges: VenatorBow._test.charges(bankedBow),
            bankEssence: bankEssence.getAmount(essence), bows: owned(ids.VENATOR_BOW) + owned(ids.VENATOR_BOW_UNCHARGED_),
            bankOpen: Bank.isOpen(player) });
        const before = state();
        await send({ type: 'widget_action', widgetId: (Bank.MAIN_INTERFACE_ID << 16) | Bank.ITEMS_CHILD,
            groupId: Bank.MAIN_INTERFACE_ID, childId: Bank.ITEMS_CHILD, buttonNum: 9,
            slot, itemId: Bank.displayItemId(bankedBow) });
        assert.equal(player.getEnteredAmountAction()?.acceptsZero, true, 'actual bank item op admits zero charges');
        assert.deepEqual(state(), before, 'opening Configure-Charges leaves all stores unchanged');
        await send({ type: 'dialogue_amount', amount: 0 });
        const after = state(), details = JSON.stringify({ before, after, addable });
        assert.equal(after.essence + after.charges, before.essence + before.charges,
            'stored charges or returned essence must remain owned: ' + details);
        assert.equal(after.bows, 1, details);
        if (mode === 'room' || mode === 'exact') {
            assert.equal(after.charges, 0, details);
            assert.equal(after.essence, before.essence + 100, details);
        }
    });


    for (const mode of ['increase', 'decrease', 'withdraw-increase', 'replace-increase']) await t.test(mode, async (t) => {
        const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
            send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
        const player = new Player(new PlayerSession(channel));
        player.setIndex(index++); player.setUsername(`bowrefund_${mode}`);
        player.setRegistered(true); player.setLocation(new native.Location(3226, 3218));
        player.needsPlacement = false;
        const connection = new ClientConnection(channel); connection.player = player;
        const inventory = player.getInventory();
        t.after(() => {
            player.closeInterruptibleInterfaces();
            PM.emitPlayerLogout({ player, username: player.getUsername() });
            player.setRegistered(false); native.TaskManager.cancelTasks(player.getIndex());
            native.TaskManager.cancelTasks(player); native.TaskManager.process();
            for (const ground of native.World.getItems().filter(g => g.getOwner() === player.getUsername())) {
                native.ItemOnGroundManager.deregister(ground);
            }
        });
        let turns = 0;
        const turn = () => {
            assert.ok(++turns <= 20, 'bounded native phase budget'); player.resetUpdating();
            native.World.processCycle = (native.World.processCycle + 1) & 0x7fffffff;
            native.TaskManager.process(); connection.processTurnPackets();
            const queue = player.getMovementQueue(); queue.beginCycle(); queue.processEntityPursuit();
            if (queue.hasPendingWork()) queue.process(); native.TaskManager.processWalkTo(player.getIndex());
        };
        const send = async packet => { await connection.dispatch([packet]); turn(); };
        const floor = id => native.World.getItems().filter(g => !g.isPendingRemoval()
            && g.getOwner() === player.getUsername() && g.getPrivateArea() === player.getPrivateArea()
            && g.getItem().getId() === id).reduce((n, g) => n + g.getItem().getAmount(), 0);
        const owned = id => inventory.getAmount(id) + player.getEquipment().getAmount(id)
            + player.getBanks().reduce((n, bank, tab) => n + (bank && tab !== Bank.BANK_SEARCH_TAB_INDEX ? bank.getAmount(id) : 0), 0)
            + floor(id);
        inventory.add(new native.Item(ids.VENATOR_BOW_UNCHARGED_), false);
        inventory.add(new native.Item(essence, 1000), false);
        const heldBow = inventory.getItems()[inventory.getSlotForItemId(ids.VENATOR_BOW_UNCHARGED_)];
        await send({ type: 'inventory_use_on', slot: inventory.getSlotForItemId(essence), itemId: essence,
            target: { kind: 'inventory', slot: inventory.getSlotForItemId(ids.VENATOR_BOW_UNCHARGED_),
                itemId: ids.VENATOR_BOW_UNCHARGED_ } });
        assert.ok(player.getEnteredAmountAction(), 'real essence-on-bow opens the amount prompt');
        assert.equal(VenatorBow._test.charges(heldBow), 0);
        await send({ type: 'dialogue_amount', amount: 100 });
        assert.equal(heldBow.getId(), ids.VENATOR_BOW);
        assert.equal(VenatorBow._test.charges(heldBow), 100, 'real charging producer');
        assert.equal(owned(essence), (1000) - 100);
        player.closeInterruptibleInterfaces();
        player.getBank(0).open(); assert.equal(Bank.isOpen(player), true);
        Bank.deposits(player, ids.VENATOR_BOW, inventory.getSlotForItemId(ids.VENATOR_BOW), 1);
        Bank.deposits(player, essence, inventory.getSlotForItemId(essence), inventory.getAmount(essence));
        assert.equal(inventory.getAmount(essence), 0); assert.equal(inventory.getAmount(ids.VENATOR_BOW), 0);
        const tab = Bank.getTabForItem(player, ids.VENATOR_BOW), bank = player.getBank(tab);
        assert.equal(tab, 0, 'both deposits use the first native bank tab');
        const slot = bank.getSlotForItemId(ids.VENATOR_BOW), bankedBow = bank.getItems()[slot];
        assert.equal(bankedBow.getAmount(), 1); assert.equal(VenatorBow._test.charges(bankedBow), 100);
        assert.equal(Bank.resolveDisplaySlot(player, slot)?.item, bankedBow, 'packet slot resolves the actual deposited bow');
        const bankEssence = player.getBank(Bank.getTabForItem(player, essence));
        const addable = bankEssence.getAddableAmount(new native.Item(essence, 100));
        assert.equal(addable, 100);
        const totalCharges = () => [inventory, player.getEquipment(), ...player.getBanks().filter((bank, tab) => bank && tab !== Bank.BANK_SEARCH_TAB_INDEX)]
            .flatMap(container => container.getItems())
            .filter(item => item && [ids.VENATOR_BOW, ids.VENATOR_BOW_UNCHARGED_].includes(item.getId()) && item.getAmount() > 0)
            .reduce((sum, item) => sum + VenatorBow._test.charges(item) * item.getAmount(), 0);
        const state = () => ({ mode, essence: owned(essence), charges: totalCharges(),
            bows: owned(ids.VENATOR_BOW) + owned(ids.VENATOR_BOW_UNCHARGED_), bankOpen: Bank.isOpen(player) });
        const before = state();
        const resources = ({ essence, charges, bows }) => ({ essence, charges, bows });
        assert.deepEqual({ essence: before.essence, charges: before.charges, bows: before.bows, bankOpen: before.bankOpen },
            { essence: 900, charges: 100, bows: 1, bankOpen: true });
        await send({ type: 'widget_action', widgetId: (Bank.MAIN_INTERFACE_ID << 16) | Bank.ITEMS_CHILD,
            groupId: Bank.MAIN_INTERFACE_ID, childId: Bank.ITEMS_CHILD, buttonNum: 9,
            slot, itemId: Bank.displayItemId(bankedBow) });
        const action = player.getEnteredAmountAction();
        assert.equal(action?.acceptsZero, true, 'native Configure-Charges prompt accepts zero');
        assert.equal(player.getPacketSender().hasInputPrompt(), true);
        assert.deepEqual(state(), before, 'opening prompt does not change owned resources');
        if (mode === 'withdraw-increase' || mode === 'replace-increase') {
            await send({ type: 'widget_action', widgetId: (Bank.MAIN_INTERFACE_ID << 16) | Bank.ITEMS_CHILD,
                groupId: Bank.MAIN_INTERFACE_ID, childId: Bank.ITEMS_CHILD, buttonNum: 2, option: 'Withdraw-1',
                slot, itemId: Bank.displayItemId(bankedBow) });
            assert.equal(bank.getItems().includes(bankedBow) && bankedBow.getAmount() > 0, false, 'original bank object no longer live');
            const heldSlot = inventory.getSlotForItemId(ids.VENATOR_BOW);
            assert.ok(heldSlot >= 0, 'real withdrawal puts charged bow in inventory');
            const withdrawn = inventory.getItems()[heldSlot];
            assert.equal(VenatorBow._test.charges(withdrawn), 100);
            assert.deepEqual(resources(state()), resources(before), 'withdrawal preserves resources');
            // Cancellation is also safe: do not resurrect an action the server cleared.
            if (player.getEnteredAmountAction() !== action || !Bank.isOpen(player)) return;
            if (mode === 'replace-increase') {
                await send({ type: 'widget_action', widgetId: (Bank.SIDE_INTERFACE_ID << 16) | 3,
                    groupId: Bank.SIDE_INTERFACE_ID, childId: 3, buttonNum: 1, option: 'Deposit-1',
                    slot: heldSlot, itemId: ids.VENATOR_BOW });
                const liveSlot = bank.getSlotForItemId(ids.VENATOR_BOW);
                assert.ok(liveSlot >= 0, 'real deposit replaces banked bow');
                assert.notEqual(bank.getItems()[liveSlot], bankedBow, 'replacement is not the prompt object');
                assert.equal(VenatorBow._test.charges(bank.getItems()[liveSlot]), 100);
                assert.deepEqual(resources(state()), resources(before), 'replacement preserves resources');
                if (player.getEnteredAmountAction() !== action || !Bank.isOpen(player)) return;
            }
        }
        await send({ type: 'dialogue_amount', amount: mode === 'decrease' ? 0 : 200 });
        const after = state(), details = JSON.stringify({ before, after });
        assert.equal(after.essence + after.charges, before.essence + before.charges,
            'owned essence and stored charges must be conserved: ' + details);
        assert.equal(after.bows, 1, details);
        if (mode === 'withdraw-increase') {
            const live = inventory.getItems()[inventory.getSlotForItemId(ids.VENATOR_BOW)];
            assert.ok(live && live !== bankedBow, 'withdrawn instance remains owned');
            assert.equal(VenatorBow._test.charges(live), 100, 'withdrawn bow is unchanged');
            assert.equal(after.essence, before.essence, details);
        } else if (mode === 'replace-increase') {
            const live = bank.getItems()[bank.getSlotForItemId(ids.VENATOR_BOW)];
            assert.ok(live && live !== bankedBow, 'replacement instance remains owned');
            assert.equal(VenatorBow._test.charges(live), 100, 'replacement bow is unchanged');
            assert.equal(after.essence, before.essence, details);
        } else if (mode === 'increase') {
            assert.equal(after.essence, 800, details); assert.equal(after.charges, 200, details);
        } else if (mode === 'decrease') {
            assert.equal(after.essence, 1000, details); assert.equal(after.charges, 0, details);
        }
    });
});
