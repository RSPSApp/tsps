const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { HitQueue } = require('../dist/game/content/combat/hit/HitQueue');
const { HitDamage } = require('../dist/game/content/combat/hit/HitDamage');
const { HitMask } = require('../dist/game/content/combat/hit/HitMask');
const Common = require('../plugins/bosses/vardorvis/Common.Vardorvis');
const CombatAchievements = require('../plugins/bosses/vardorvis/CombatAchievements.Vardorvis');
const { Fight, attachFight } = require('../plugins/bosses/vardorvis/Fight.Vardorvis');
const Axes = require('../plugins/bosses/vardorvis/Axes.Vardorvis');
const Dash = require('../plugins/bosses/vardorvis/Dash.Vardorvis');
const Strangle = require('../plugins/bosses/vardorvis/Strangle.Vardorvis');
const Drops = require('../plugins/npcs/NpcDrops.plugin');
const dump = require('../data/definitions/npc-drops.json');

class Location {
    constructor(x = 1128, y = 3417, z = 0) { Object.assign(this, { x, y, z }); }
    getX() { return this.x; }
    getY() { return this.y; }
    getZ() { return this.z; }
    clone() { return new Location(this.x, this.y, this.z); }
    equals(other) { return this.x === other.x && this.y === other.y && this.z === other.z; }
}

// Only rendering, scheduling and the accuracy roll are doubled. Actual HitDamage and
// HitQueue apply damage, and the real drop roller queries the real fight's event hook.
function fixture({ awakened = false } = {}) {
    const listeners = new Map();
    const hooks = {};
    const tasks = [];
    const pending = [];
    const sender = new Proxy({}, { get: () => () => {} });
    const movement = { reset() {}, setBlockMovement() {} };
    const player = {
        hp: 1000, prayer: false, location: new Location(),
        isRegistered: () => true, isPlayer: () => false,
        getHitpoints() { return this.hp; },
        decrementHealth(hit) {
            hit.setDamage(Math.min(this.hp, hit.getDamage()));
            // Match Mobile's applied loss snapshot before reactive healing/death hooks.
            hit.setHealthLost(hit.getDamage());
            this.hp -= hit.getDamage();
            return hit;
        },
        addTickHit() {}, getPacketSender: () => sender,
        getLocation() { return this.location; },
        getMovementQueue: () => movement,
        sendMessage() {}, performAnimation() {}, performGraphicInSlot() {},
        getEquipment: () => ({ get: () => null, getItems: () => [] }),
    };
    const queue = new HitQueue(player);
    queue.addPendingHit = hit => pending.push(hit);
    player.getCombat = () => ({ getHitQueue: () => queue, reset() {} });
    const boss = {
        hp: awakened ? 1400 : 700,
        getHitpoints() { return this.hp; }, getMaxHitpoints: () => awakened ? 1400 : 700,
        getId: () => Common.data.npcs.boss, isRegistered: () => true,
        performAnimation() {}, setPositionToFace() {},
        getLocation: () => new Location(), getMovementQueue: () => movement,
        exactMove() {}, heal() {},
    };
    const api = {
        core: {
            HitDamage, HitMask, Location,
            Animation: class {}, Graphic: class {}, CombatMethod: class {}, CombatType: { MELEE: 'melee' },
            PendingHit: class {
                constructor() { this.parts = [new HitDamage(20, HitMask.RED)]; }
                getHits() { return this.parts; }
                updateTotalDamage() {}
            },
            CombatFactory: { applyStyleDamage() {} },
            PrayerHandler: { PROTECT_FROM_MELEE: 0, isActivated: p => p.prayer },
            World: { getProcessCycle: () => 0 },
            Task: class { stop() { this.stopped = true; } },
            TaskManager: { submit: task => tasks.push(task) },
        },
        persistAttribute() {}, registerNpcCombatMethodProvider() {}, registerCommand() {},
        getItemOnGroundManager: () => ({}),
        onCombatHitResolved: fn => { hooks.hitResolved = fn; },
        onNpcBeforeDeath: fn => { hooks.beforeDeath = fn; },
        onNpcDeath() {}, onPlayerLogin() {},
        onCustomEvent(name, fn) {
            if (!listeners.has(name)) listeners.set(name, []);
            listeners.get(name).push(fn);
        },
        emitCustomEvent(name, event) { for (const fn of listeners.get(name) || []) fn(event); },
        removeNpc() {}, log() {},
    };
    Common.init(api);
    attachFight(api);
    Drops.register(api);
    const session = {
        player, awakened, ended: false,
        area: { getBaseX: () => 1112, getBaseY: () => 3400 },
        tile: ([x, y, z]) => new Location(x, y, z),
    };
    const fight = new Fight(session, boss);
    session.fight = fight;
    boss.__vardorvisFight = fight;
    let cycle = 0;
    const apply = () => {
        for (const hit of pending.splice(0)) queue.addPendingDamage(hit.getHits());
        queue.process(++cycle);
    };
    const die = () => { boss.hp = 0; hooks.beforeDeath({ npc: boss }); };
    const context = (overrides = {}) => {
        const event = { player, npc: boss, context: { perfectKill: false, bountyTask: null }, ...overrides };
        api.emitCustomEvent('npc-drops:context', event);
        return event.context;
    };
    const loot = () => {
        const coal = dump.tables.vardorvis.entries.find(e => e.name === 'Coal' && e.quantity_alternatives);
        assert.ok(coal, 'canonical conditional Coal row');
        return Drops.__internals.rollTable({ entries: [{ ...coal, always: true }] }, player, boss)[0].amount;
    };
    return { player, boss, fight, session, api, hooks, tasks, pending, queue, apply, die, context, loot };
}

test('real NPC lethal damage freezes the fight before the delayed death event', async t => {
    const path = require('node:path');
    const { CachePipeline } = require('../dist/game/cache/CachePipeline');
    const { NPC } = require('../dist/game/entity/impl/npc/NPC');
    const { Location: RealLocation } = require('../dist/game/model/Location');
    const { PluginManager } = require('../dist/plugins/PluginManager');
    await CachePipeline.initialize(path.resolve(__dirname, '..'));
    const f = fixture();
    const boss = new NPC(Common.data.npcs.boss, new RealLocation(1128, 3417, 0));
    f.fight.boss = boss;
    boss.__vardorvisFight = f.fight;
    t.mock.method(PluginManager, 'emitNpcBeforeDeath', event => f.hooks.beforeDeath(event));
    const death = t.mock.method(PluginManager, 'emitNpcDeath', () => {});
    boss.setHitpoints(1);
    boss.decrementHealth(new HitDamage(1, HitMask.RED));
    assert.equal(f.fight.over, true, 'real lethal damage synchronously freezes the grade');
    assert.equal(death.mock.calls.length, 0, 'loot/death event has not happened yet');
    assert.equal(f.context({ npc: boss }).perfectKill, true);
    f.fight.recordDamage(10);
    assert.equal(f.context({ npc: boss }).perfectKill, true, 'later damage cannot rewrite the kill');
});

test('a flawless kill supplies perfect context to canonical loot, only after death', () => {
    const f = fixture();
    assert.equal(f.context().perfectKill, false);
    f.die();
    assert.equal(f.context().perfectKill, true);
    assert.equal(f.loot(), 195);
    assert.equal(f.context({ player: {} }).perfectKill, false);
    assert.equal(f.context({ npc: {} }).perfectKill, false);
    assert.equal(f.context({ npc: { __vardorvisFight: f.fight } }).perfectKill, false);
    assert.deepEqual(f.context({ context: { perfectKill: false, bountyTask: 'unchanged' } }),
        { perfectKill: true, bountyTask: 'unchanged' });
    f.session.ended = true;
    assert.equal(f.context().perfectKill, false);
});

test('protected melee chip remains perfect; unprotected applied melee loses bonus', () => {
    for (const prayer of [true, false]) {
        const f = fixture();
        f.player.prayer = prayer;
        f.fight.melee();
        f.apply();
        assert.ok(f.player.hp < 1000, 'the attack actually applied damage');
        f.die();
        assert.equal(f.context().perfectKill, prayer);
        assert.equal(f.loot(), prayer ? 195 : 130);
    }
});

test('melee grade uses the prayer that reduced the damage, even if prayer changes before impact', () => {
    for (const protectedAtRoll of [true, false]) {
        const f = fixture();
        f.player.prayer = protectedAtRoll;
        f.fight.melee();
        f.player.prayer = !protectedAtRoll;
        f.apply();
        f.die();
        assert.equal(f.loot(), protectedAtRoll ? 195 : 130);
    }
});

test('a discarded or zero melee hit cannot spoil a kill', () => {
    const f = fixture();
    f.fight.melee();
    for (const hit of f.pending) for (const part of hit.getHits()) part.setDamage(0);
    f.apply();
    f.fight.melee();
    for (const hit of f.pending.splice(0)) f.queue.addPendingDamage(hit.getHits());
    f.queue.clear();
    f.die();
    assert.equal(f.loot(), 195);
});

test('damage immunity and zero or cancelled special damage preserve the bonus', () => {
    for (const outcome of ['immune', 'zero', 'cancelled']) {
        const f = fixture();
        f.fight.axes.push({ at: [1128, 3417], struck: new Set(), step: 99, npc: { isRegistered: () => true } });
        Axes.process(f.fight);
        if (outcome === 'immune') f.player.decrementHealth = hit => hit;
        if (outcome === 'zero') for (const hit of f.pending) for (const part of hit.getHits()) part.setDamage(0);
        if (outcome === 'cancelled') {
            for (const hit of f.pending.splice(0)) f.queue.addPendingDamage(hit.getHits());
            f.queue.clear();
        }
        f.apply();
        assert.equal(f.player.hp, 1000);
        f.die();
        assert.equal(f.loot(), 195, outcome);
    }
});

test('axe damage invalidates even under Protect from Melee, including awakened', () => {
    for (const awakened of [false, true]) {
        const f = fixture({ awakened });
        f.player.prayer = true;
        f.fight.axes.push({ at: [1128, 3417], struck: new Set(), step: 99, npc: { isRegistered: () => true } });
        Axes.process(f.fight);
        f.apply();
        assert.equal(f.fight.perfectKill, false);
        f.die();
        assert.equal(f.loot(), 130);
    }
});

test('dash spikes and a failed strangle invalidate only when their damage applies', t => {
    t.mock.method(Common, 'randomInt', (min, max) => max);
    for (const special of [Dash, Strangle]) {
        const f = fixture();
        f.fight.strangles = 1;
        special.start(f.fight);
        for (let i = 0; i < 12; i++) {
            const due = f.fight.events.splice(0);
            for (const { action } of due) action();
        }
        assert.ok(f.queue.getQueuedDamage() > 0, 'special queued real damage');
        assert.equal(f.fight.perfectKill, true, 'queueing alone is not damage');
        f.apply();
        assert.equal(f.fight.perfectKill, false);
        f.die();
        assert.equal(f.loot(), 130);
    }
});

test('bleeding is attributed to its fight and cannot change a completed or replacement kill', () => {
    const f = fixture();
    Axes.startBleed(f.player, f.fight.awakened, f.fight);
    for (let i = 0; i < Common.data.axes.bleed.firstTicks; i++) f.tasks[0].execute();
    f.apply();
    f.die();
    assert.equal(f.loot(), 130);

    const clean = fixture();
    Axes.startBleed(clean.player, false, clean.fight);
    clean.die();
    for (let i = 0; i < Common.data.axes.bleed.firstTicks; i++) clean.tasks[0].execute();
    clean.apply();
    assert.equal(clean.loot(), 195, 'post-death bleed does not alter a frozen grade');
    const replacement = new Fight(clean.session, clean.boss);
    clean.session.fight = replacement;
    assert.equal(clean.context().perfectKill, false, 'old boss cannot answer for a replacement fight');
    assert.equal(replacement.perfectKill, true, 'each new fight begins clean');
});

test('ended, stopped and replaced fights ignore late damage', () => {
    for (const end of [f => { f.session.ended = true; }, f => { f.fight.stopped = true; }, f => { f.session.fight = {}; }]) {
        const f = fixture();
        f.fight.melee();
        end(f);
        f.apply();
        assert.equal(f.fight.perfectKill, true);
        f.die();
        assert.equal(f.context().perfectKill, false);
    }
});

test('the next fight and other players do not inherit a failed kill grade', () => {
    const first = fixture();
    first.fight.melee();
    first.apply();
    first.die();
    assert.equal(first.context().perfectKill, false);
    const nextBoss = { ...first.boss };
    const nextFight = new Fight(first.session, nextBoss);
    nextBoss.__vardorvisFight = nextFight;
    first.session.fight = nextFight;
    nextFight.fell();
    assert.equal(first.context({ npc: nextBoss }).perfectKill, true);
    assert.equal(first.context().perfectKill, false, 'previous NPC is no longer current');
    const other = fixture();
    other.die();
    assert.equal(other.context().perfectKill, true);
    assert.equal(first.context({ npc: other.boss }).perfectKill, false);
});

test('Perfect Vardorvis counts five flawless kills in the same site session', () => {
    const f = fixture();
    const completed = [];
    f.api.onCustomEvent('combat-achievements:complete', ({ task }) => completed.push(task));
    const kill = { player: f.player, boss: f.boss, awakened: false, session: f.session, axeEnrageTicks: 0, leftAxeCentre: false };

    for (let i = 1; i <= 4; i++) {
        CombatAchievements.judge({ ...kill, perfectKill: true }, 100);
        assert.equal(f.session.perfectKills, i);
        assert.equal(completed.includes('Perfect Vardorvis'), false, 'four flawless kills are not enough');
    }
    CombatAchievements.judge({ ...kill, perfectKill: false }, 100);
    assert.equal(f.session.perfectKills, 4, 'an imperfect kill does not advance the counter');
    CombatAchievements.judge({ ...kill, perfectKill: true }, 100);
    assert.equal(f.session.perfectKills, 5);
    assert.equal(completed.includes('Perfect Vardorvis'), true);
});

test('Axe Enthusiast tracks 300 enrage ticks and fails after leaving the centre 5x5', () => {
    const centre = (f) => {
        const [x, y] = Common.data.axes.centre;
        const { sourceChunkX, sourceChunkY } = Common.data.instance;
        const area = f.session.area;
        return new Location(area.getBaseX() + x - sourceChunkX * 8, area.getBaseY() + y - sourceChunkY * 8);
    };
    const completions = (f) => {
        const tasks = [];
        f.api.onCustomEvent('combat-achievements:complete', ({ task }) => tasks.push(task));
        return tasks;
    };

    const stayed = fixture();
    const stayedTasks = completions(stayed);
    stayed.player.location = centre(stayed);
    stayed.fight.engaged = true;
    stayed.fight.enraged = true;
    for (let i = 0; i < 300; i++) CombatAchievements.tick(stayed.fight);
    assert.equal(stayed.fight.axeEnrageTicks, 300);
    assert.equal(stayed.fight.leftAxeCentre, false);
    CombatAchievements.judge(stayed.fight, 100);
    assert.ok(stayedTasks.includes('Axe Enthusiast'));

    const left = fixture();
    const leftTasks = completions(left);
    const middle = centre(left);
    left.player.location = middle;
    left.fight.engaged = true;
    left.fight.enraged = true;
    for (let i = 0; i < 299; i++) CombatAchievements.tick(left.fight);
    left.player.location = new Location(middle.getX() + 3, middle.getY());
    CombatAchievements.tick(left.fight);
    assert.equal(left.fight.axeEnrageTicks, 300);
    assert.equal(left.fight.leftAxeCentre, true);
    CombatAchievements.judge(left.fight, 100);
    assert.equal(leftTasks.includes('Axe Enthusiast'), false);
});
