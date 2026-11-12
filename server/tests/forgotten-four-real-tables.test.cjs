// Run after `yarn build`: node --test tests/forgotten-four-real-tables.test.cjs
// The imported duke_sucellus / the_leviathan / the_whisperer / vardorvis tables carry an ordered `reward_chain`.
// dt2-ordered-rewards covers the consumer with a synthetic boss; this rolls each REAL imported table through the
// REAL ForgottenFourRewards state plugin (a state_domain/provider mismatch or bad real data fails here).
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
const GOLD_RING = 1635;

before(() => CachePipeline.initialize(path.resolve(__dirname, '..')));

function fixture(t, saved) {
    const player = new Player(null), handlers = new Map();
    const api = new Proxy({
        core: { CacheDefinitions: require('../dist/game/cache/CacheDefinitions').CacheDefinitions },
        persistAttribute() {}, getItemOnGroundManager: () => ({}),
        getPluginConfig: (_key, fallback) => fallback,
        onCustomEvent(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); },
        emitCustomEvent(name, event) { for (const fn of handlers.get(name) || []) fn(event); },
    }, { get: (target, key) => target[key] ?? (() => {}) });
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
    return { vestige: unique.entries[0], orb: orb.entries[0].item_id, tablet: tablet.entries[0].item_id, quartz: quartz.entries[0].item_id,
        tabletKey: tablet.eligibility.state_key };
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
        const ids = idsOf(id), key = ids.vestige.progression.state_key;
        const first = fixture(t);
        const kill1 = first.roll(first.load(id), [0, 0]);
        assert.equal(kill1.find((row) => row.itemId === GOLD_RING)?.amount, 1, 'first hit: one gold ring');
        assert.ok(!has(kill1, ids.vestige.item_id));
        assert.equal(saved(first.player)[id][key], 1);
        const second = fixture(t, saved(first.player));
        const kill2 = second.roll(second.load(id), [0, 0]);
        assert.equal(kill2.find((row) => row.itemId === GOLD_RING)?.amount, 2, 'second hit: two gold rings');
        assert.equal(saved(second.player)[id][key], 2);
        const third = fixture(t, saved(second.player));
        const kill3 = third.roll(third.load(id), [0, 0]);
        assert.ok(has(kill3, ids.vestige.item_id), 'third hit: the vestige');
        assert.equal(saved(third.player)[id][key], 0);
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
