// Run after `yarn build`: node --test tests/forgotten-four-real-tables.test.cjs
// The imported duke_sucellus / the_leviathan / the_whisperer / vardorvis tables carry an ordered `reward_chain`.
// dt2-ordered-rewards covers the consumer with a synthetic boss; this rolls each REAL imported table through the
// REAL ForgottenFourRewards state plugin (a state_domain/provider mismatch or bad real data fails here).
// Persistence is a JSON clone of the saved attribute into a fresh Player, not real save/load. Not covered: bonus-drop
// quantity ranges, the tertiary/clue group, the perfect-kill flat rows, per-table rare multipliers.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const State = require('../plugins/npcs/ForgottenFourRewards.plugin');
const Drops = require('../plugins/npcs/NpcDrops.plugin');
const dump = require('../data/definitions/npc-drops.json');

const TABLES = ['duke_sucellus', 'the_leviathan', 'the_whisperer', 'vardorvis'];

before(() => CachePipeline.initialize(path.resolve(__dirname, '..')));

function fixture(t, saved, killCount = 0) {
    const player = new Player(null), handlers = new Map();
    const api = new Proxy({
        core: { CacheDefinitions: require('../dist/game/cache/CacheDefinitions').CacheDefinitions },
        persistAttribute() {}, getItemOnGroundManager: () => ({}),
        getPluginConfig: (_key, fallback) => fallback,
        onCustomEvent(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); },
        emitCustomEvent(name, event) { for (const fn of handlers.get(name) || []) fn(event); },
    }, { get: (target, key) => target[key] ?? (() => {}) });
    api.onCustomEvent('combat-achievements:count', (event) => { event.total = killCount; });
    State.register(api);
    Drops.register(api);
    Drops.__internals.loadDrops();
    if (saved) player.setAttribute(State.STATE_ATTRIBUTE, saved);
    let values = [];
    t.mock.method(Math, 'random', () => values.shift() ?? .99);
    const load = (id) => {
        const npcId = Number(Object.entries(dump.npcs).find(([, npc]) => npc.tables.includes(id))[0]);
        return Drops.__internals.tablesByNpc.get(npcId).find((table) => table.table_id === id);
    };
    return { player, load, roll(table, sequence) { values = [...sequence]; return Drops.__internals.rollTable(table, player, null); } };
}

const stages = (id) => dump.tables[id].reward_chain.stages;
const idsOf = (id) => {
    const [unique, orb, tablet, quartz] = stages(id);
    const supplies = stages(id)[4].entries[0];
    return { vestige: unique.entries[0], orb: orb.entries[0].item_id, tablet: tablet.entries[0].item_id, quartz: quartz.entries[0].item_id,
        tabletKey: tablet.eligibility.state_key, quartzKey: quartz.record_first_received.state_key, scaling: quartz.source_scaling,
        suppliesIds: [supplies.item_id, ...supplies.bonus_drops.map((row) => row.item_id)] };
};
const has = (rows, itemId) => rows.some((row) => row.itemId === itemId);
const saved = (player) => JSON.parse(JSON.stringify(player.getAttribute(State.STATE_ATTRIBUTE) ?? {}));

for (const id of TABLES) {
    test(`${id}: the real chain is ordered_exclusive in the forgotten_four domain with its five stages`, () => {
        const chain = dump.tables[id].reward_chain;
        assert.equal(chain.type, 'ordered_exclusive');
        assert.equal(chain.state_domain, 'forgotten_four');
        assert.deepEqual(chain.stages.map((stage) => stage.key), ['tradeable_uniques', 'orb', 'tablet', 'quartz', 'supplies']);
    });

    test(`${id}: every stage missing selects no chain reward and saves no state`, (t) => {
        const f = fixture(t), ids = idsOf(id);
        const rows = f.roll(f.load(id), []);
        for (const itemId of [ids.vestige.item_id, ids.orb, ids.tablet, ids.quartz]) assert.ok(!has(rows, itemId), `item ${itemId}`);
        assert.equal(saved(f.player)[id], undefined);
    });

    test(`${id}: a stage-0 hit cycles the vestige through a saved-state round trip across kills`, (t) => {
        const ids = idsOf(id), progress = ids.vestige.progression, key = progress.state_key;
        let carried = null;
        for (let kill = 1; kill < progress.hits; kill++) {
            const f = fixture(t, carried);
            const rows = f.roll(f.load(id), [0, 0]);
            assert.equal(rows.find((row) => row.itemId === progress.intermediate_item_id)?.amount, progress.intermediate_quantities[kill - 1], `kill ${kill}`);
            assert.ok(!has(rows, ids.vestige.item_id));
            carried = saved(f.player);
            assert.equal(carried[id][key], kill);
        }
        const last = fixture(t, carried);
        assert.ok(has(last.roll(last.load(id), [0, 0]), ids.vestige.item_id), 'the final hit is the vestige');
        assert.equal(saved(last.player)[id][key], 0);
    });

    test(`${id}: a stage-1 hit gives the orb and a stage-4 hit gives the supplies with every bonus drop`, (t) => {
        const ids = idsOf(id);
        const orb = fixture(t);
        assert.ok(has(orb.roll(orb.load(id), [.99, 0, 0]), ids.orb));
        const supplies = fixture(t);
        const rows = supplies.roll(supplies.load(id), [.99, .99, .99, .99, 0, 0]);
        for (const itemId of ids.suppliesIds) assert.ok(has(rows, itemId), `item ${itemId}`);
    });

    test(`${id}: the quartz uses the documented endpoint rate from the endpoint kill count, the base rate below it and after its first receipt`, (t) => {
        const { known_endpoint: endpoint, after_first_received: after } = idsOf(id).scaling, ids = idsOf(id);
        const base = dump.tables[id].reward_chain.stages[3];
        const probability = (rate) => rate.weight / rate.out_of;
        assert.ok(probability(endpoint) > probability(base) && probability(after) <= probability(base));
        // One draw between the base and endpoint chances: a hit only at the endpoint rate.
        const between = (probability(base) + probability(endpoint)) / 2;
        const roll = (f) => f.roll(f.load(id), [.99, .99, .99, between, 0]);
        const atEndpoint = fixture(t, null, endpoint.kill_count);
        assert.ok(has(roll(atEndpoint), ids.quartz), 'endpoint kill count: endpoint rate');
        assert.equal(saved(atEndpoint.player)[id][ids.quartzKey], true);
        const below = fixture(t, null, endpoint.kill_count - 1);
        assert.ok(!has(roll(below), ids.quartz), 'below the endpoint: base rate');
        const received = fixture(t, saved(atEndpoint.player), endpoint.kill_count);
        assert.ok(!has(roll(received), ids.quartz), 'after the first receipt: the after_first_received rate');
    });

    test(`${id}: the first tablet is recorded and skipped afterwards, so the next stage is reached`, (t) => {
        const ids = idsOf(id);
        const first = fixture(t);
        assert.ok(has(first.roll(first.load(id), [.99, .99, 0, 0]), ids.tablet));
        assert.equal(saved(first.player)[id][ids.tabletKey], true);
        const again = fixture(t, saved(first.player));
        const rows = again.roll(again.load(id), [.99, .99, 0, 0]);
        assert.ok(!has(rows, ids.tablet));
        assert.ok(has(rows, ids.quartz));
    });
}
