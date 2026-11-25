// Vardorvis against rsprox 1156 (rev 237, 21 normal kills and an awakened one) and 1703 (rev 226,
// the quest's fight on a normal world): docs/vardorvis.md.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const Common = require('../plugins/bosses/vardorvis/Common.Vardorvis');
const CombatAchievements = require('../plugins/bosses/vardorvis/CombatAchievements.Vardorvis');
const { Fight, spawnBoss } = require('../plugins/bosses/vardorvis/Fight.Vardorvis');
const Axes = require('../plugins/bosses/vardorvis/Axes.Vardorvis');
const Barrier = require('../plugins/bosses/vardorvis/Barrier.Vardorvis');
const Dash = require('../plugins/bosses/vardorvis/Dash.Vardorvis');
const Head = require('../plugins/bosses/vardorvis/Head.Vardorvis');
const Strangle = require('../plugins/bosses/vardorvis/Strangle.Vardorvis');

class Location {
    constructor(x = 1128, y = 3417, z = 0) { Object.assign(this, { x, y, z }); }
    getX() { return this.x; }
    getY() { return this.y; }
    getZ() { return this.z; }
    clone() { return new Location(this.x, this.y, this.z); }
    equals(other) { return this.x === other.x && this.y === other.y && this.z === other.z; }
}

function fixture({ awakened = false, hp } = {}) {
    const listeners = new Map();
    const buttons = [];
    const typed = [];
    const plain = [];
    const spawns = [];
    const removed = [];
    const tasks = [];
    const varbits = new Map();
    const sender = new Proxy({
        sendTypedMessage: (type, text) => typed.push({ type, text }),
        getVarbit: id => varbits.get(id) ?? 0,
    }, { get: (target, key) => target[key] ?? (() => {}) });
    const movement = { reset() {}, setBlockMovement() {} };
    const player = {
        location: new Location(1128, 3419),
        isRegistered: () => true, getHitpoints: () => 99,
        getPacketSender: () => sender, getLocation() { return this.location; },
        getMovementQueue: () => movement,
        getCombat: () => ({ getHitQueue: () => ({ addPendingDamage() {}, addPendingHit() {} }), reset() {} }),
        sendMessage: text => plain.push(text), performAnimation() {}, performGraphicInSlot() {},
    };
    const max = awakened ? 1400 : 700;
    const boss = {
        hp: hp ?? max,
        getHitpoints() { return this.hp; }, getMaxHitpoints: () => max,
        setMaxHitpoints() {}, setHitpoints(value) { this.hp = value; }, setMovementSteps() {}, setFlag() {},
        getDefinition: () => ({ getStats: () => [0, 0, 0, 0, 0] }), setCombatOverride() {},
        isRegistered: () => true, performAnimation() {}, setPositionToFace() {},
        getLocation: () => new Location(), getMovementQueue: () => movement,
        getCombat: () => ({ attack() {} }), exactMove() {},
    };
    const api = {
        core: {
            Location, Animation: class { constructor(id) { this.id = id; } }, Graphic: class {},
            ChatType: { SPAM: 105 },
            HitMask: { RED: 'red', BLUE: 'blue' },
            HitDamage: class { constructor(value) { this.value = value; } setSplatTypes() {} onApplied() {} },
            CacheDefinitions: { getVarbitId: name => (name === 'option_precise_timing' ? 9999 : null) },
            Direction: new Proxy({}, { get: (_, name) => ({ getId: () => name }) }),
            NPC: { WALK_THROUGH_ENTITIES_FLAG: 'walk' },
            World: { getProcessCycle: () => 0 },
            Task: class { stop() { this.stopped = true; } },
            TaskManager: { submit: task => tasks.push(task) },
        },
        onCustomEvent(name, fn) {
            if (!listeners.has(name)) listeners.set(name, []);
            listeners.get(name).push(fn);
        },
        emitCustomEvent(name, event) { for (const fn of listeners.get(name) || []) fn(event); },
        onInterfaceActionButton: (ids, fn) => buttons.push({ ids, fn }),
        removeNpc: npc => removed.push(npc),
    };
    Common.init(api);
    const failed = [];
    api.onCustomEvent('combat-achievements:failed', event => failed.push(event));
    const session = {
        player, awakened, ended: false,
        area: { getBaseX: () => 1112, getBaseY: () => 3400 },
        tile: ([x, y, z]) => new Location(x, y, z),
        spawn(id, tile, face) {
            if (id === Common.data.npcs.boss) return boss;
            const npc = { id, tile, face, anims: [], isRegistered: () => !removed.includes(npc),
                performAnimation(a) { this.anims.push(a.id); } };
            spawns.push(npc);
            return npc;
        },
    };
    const fight = new Fight(session, boss);
    session.fight = fight;
    boss.__vardorvisFight = fight;
    const runEvents = (ticks) => {
        for (let i = 0; i < ticks; i++) {
            fight.tick++;
            const due = fight.events.filter(e => e.tick <= fight.tick);
            fight.events = fight.events.filter(e => e.tick > fight.tick);
            for (const { action } of due) action();
        }
    };
    return { player, boss, fight, session, api, failed, typed, plain, spawns, removed, buttons, varbits, runEvents };
}

test('fight duration is m:ss, or m:ss.cc with precise timing on (rsprox 1156: 0:35.40)', () => {
    const f = fixture();
    assert.equal(Common.formatTicks(59), '0:35');
    assert.equal(Common.formatTicks(59, true), '0:35.40');
    assert.equal(Common.formatTicks(52, true), '0:31.20');
    assert.equal(Common.preciseTiming(f.player), false);
    f.varbits.set(9999, 1);
    assert.equal(Common.preciseTiming(f.player), true);
});

test('Perfect Vardorvis fails once a kill, at the first damage, awakened too', () => {
    for (const awakened of [false, true]) {
        const f = fixture({ awakened });
        f.fight.recordDamage(0);
        assert.equal(f.failed.length, 0, 'no damage, no failure');
        f.fight.recordDamage(12);
        f.fight.recordDamage(7);
        assert.deepEqual(f.failed.map(({ task, reason }) => [task, reason]),
            [['Perfect Vardorvis', 'You took damage from Vardorvis.']]);
        assert.equal(f.failed[0].player, f.player);
    }
});

test('Axe Enthusiast fails the first time the player leaves the middle 5x5, before the enrage too', () => {
    const f = fixture();
    const [cx, cy] = Common.data.axes.centre;
    f.fight.engaged = true;
    f.player.location = new Location(cx, cy);
    CombatAchievements.tick(f.fight);
    assert.equal(f.failed.length, 0);
    assert.equal(f.fight.axeEnrageTicks, 0, 'the timer only runs in the enrage');
    f.player.location = new Location(cx + 3, cy);
    CombatAchievements.tick(f.fight);
    CombatAchievements.tick(f.fight);
    assert.deepEqual(f.failed.map(({ task, reason }) => [task, reason]),
        [['Axe Enthusiast', 'You left the inner 25 tiles.']]);
    assert.equal(f.fight.leftAxeCentre, true);

    const awakened = fixture({ awakened: true });
    awakened.fight.engaged = true;
    awakened.player.location = new Location(cx + 4, cy);
    CombatAchievements.tick(awakened.fight);
    assert.equal(awakened.failed.length, 0, 'not an awakened task');
});

test('the dash comes 30 ticks in and every 30 after (25 awakened), above 570 hitpoints too', t => {
    const starts = [];
    t.mock.method(Dash, 'start', fight => starts.push(fight.tick));
    t.mock.method(Common, 'randomInt', (min, max) => max);
    for (const [awakened, every] of [[false, 30], [true, 25]]) {
        starts.length = 0;
        const f = fixture({ awakened });
        f.fight.inReach = () => true;
        f.fight.melee = () => {};
        assert.equal(f.fight.dashEvery(), every);
        f.fight.nextDash = f.fight.dashEvery();
        f.boss.hp = f.boss.getMaxHitpoints() - 70; // 90%: no strangle, axes head or below-570 rule
        for (f.fight.tick = 1; f.fight.tick <= 100; f.fight.tick += 5) f.fight.attackSlot();
        assert.deepEqual(starts, awakened ? [26, 51, 76] : [31, 61, 91]);
    }
});

test('awakened darts use twice the thresholds: one above 1,000, two above 260 (rsprox 1156)', () => {
    for (const [awakened, hp, darts] of [[true, 1078, 1], [true, 742, 2], [true, 420, 2], [true, 200, 3],
        [false, 650, 1], [false, 400, 2], [false, 100, 3]]) {
        const f = fixture({ awakened, hp });
        f.fight.tick = 10;
        Dash.start(f.fight);
        assert.equal(f.fight.nextAttack, 10 + darts, `${awakened ? 'awakened' : 'normal'} ${hp}`);
    }
});

test('the head waits 5 ticks after the axes (2 awakened or after a strangle) and rides a slash 60% of the time', t => {
    t.mock.method(Axes, 'throwSet', () => {});
    const gazes = [];
    t.mock.method(Head, 'gaze', fight => gazes.push(fight.tick));
    for (const [awakened, afterStrangle, ready] of [[false, false, 5], [true, false, 2], [false, true, 2], [true, true, 2]]) {
        const f = fixture({ awakened, hp: awakened ? 900 : 450 });
        f.fight.tick = 14;
        f.fight.afterStrangle = afterStrangle;
        f.fight.mayStrangle = () => false;
        f.fight.axeTime();
        assert.equal(f.fight.headReadyAt, 14 + ready);
    }
    const f = fixture({ hp: 450 });
    f.fight.inReach = () => true;
    f.fight.melee = () => {};
    f.fight.mayStrangle = () => false;
    f.fight.nextDash = Infinity;
    f.fight.headReadyAt = 19;
    let roll = 0.9;
    t.mock.method(Math, 'random', () => roll);
    f.fight.tick = 21;
    f.fight.attackSlot();
    assert.deepEqual(gazes, [], 'a missed roll leaves the head for a later slash');
    roll = 0.1;
    f.fight.tick = 26;
    f.fight.attackSlot();
    assert.deepEqual(gazes, [26]);
    assert.equal(f.fight.headReadyAt, Infinity, 'one head a set');
});

test('the axes follow 3 ticks after the strangle lets go, and the escape line is filterable', t => {
    t.mock.method(Math, 'random', () => 0);
    const f = fixture({ hp: 450 });
    Strangle.attachStrangle(f.api);
    f.fight.inReach = () => true;
    f.fight.tick = 16;
    f.fight.strangleQueued = true;
    f.fight.headReadyAt = 20;
    f.fight.attackSlot();
    assert.equal(f.fight.strangling, true);
    assert.equal(f.fight.axesDue, Infinity, 'the axes wait for the release');
    assert.equal(f.fight.headReadyAt, Infinity);
    f.runEvents(2); // he holds the player two ticks after rearing up
    const spores = f.fight.hold.spores;
    const { fn } = f.buttons[0];
    for (let i = 0; i < spores; i++) fn({ player: f.player, buttonId: (833 << 16) | Common.data.strangle.sporeComponents[i] });
    assert.equal(f.fight.strangling, false);
    assert.equal(f.fight.axesDue, f.fight.tick + 3);
    assert.deepEqual(f.typed, [{ type: 105, text: Common.data.strangle.escapeMessage }]);
    assert.equal(f.plain.includes(Common.data.strangle.escapeMessage), false);

    const tightened = fixture({ hp: 450 });
    tightened.fight.strangles = 1;
    Strangle.start(tightened.fight);
    tightened.runEvents(12);
    assert.equal(tightened.plain.includes(Common.data.strangle.tightenMessage), true);
    assert.equal(tightened.fight.axesDue, 2 + Common.data.strangle.windowTicks.normal + 3);
});

test('the head lockout line is red, as rev 237 sends it', () => {
    assert.equal(Common.data.head.lockMessage, "<col=ff3045>You've been injured and can't use protection prayers!</col>");
});

test('an axe prop rises with him, plays 10335 at eight ticks and goes two ticks after the first hit', t => {
    t.mock.method(Barrier, 'raise', () => {});
    const f = fixture();
    const session = { ...f.session, fight: null };
    spawnBoss(session);
    const prop = f.spawns.find(npc => npc.id === 12229);
    assert.ok(prop, 'prop spawned');
    assert.deepEqual(prop.tile, [1119, 3414, 0]);
    assert.equal(prop.face, 'SOUTH');
    const fight = session.fight;
    const step = () => {
        fight.tick++;
        const due = fight.events.filter(e => e.tick <= fight.tick);
        fight.events = fight.events.filter(e => e.tick > fight.tick);
        for (const { action } of due) action();
    };
    for (let i = 0; i < 7; i++) step();
    assert.deepEqual(prop.anims, []);
    step();
    assert.deepEqual(prop.anims, [10335]);
    fight.engage();
    step();
    assert.equal(f.removed.includes(prop), false);
    step();
    assert.equal(f.removed.includes(prop), true);
});
