// Run after `yarn build`: node --test tests/hit-queue.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { HitQueue } = require('../dist/game/content/combat/hit/HitQueue');
const { HitDamage } = require('../dist/game/content/combat/hit/HitDamage');
const { HitMask } = require('../dist/game/content/combat/hit/HitMask');

function buildTarget(hp) {
    const shown = [];
    const target = {
        hp,
        shown,
        isRegistered: () => true,
        isPlayer: () => false,
        getHitpoints: () => target.hp,
        decrementHealth: (hit) => {
            if (target.hp <= 0) hit.setDamage(0);
            hit.setDamage(Math.min(hit.getDamage(), target.hp));
            // Mobile records the applied loss before reactive setHitpoints/death hooks.
            hit.setHealthLost(hit.getDamage());
            target.hp -= hit.getDamage();
            return hit;
        },
        addTickHit: (hit) => shown.push(hit.getDamage()),
    };
    return target;
}

const hits = (...damage) => damage.map((value) => new HitDamage(value, HitMask.RED));

test('every hit due on a tick lands on that tick', () => {
    const target = buildTarget(120);
    const queue = new HitQueue(target);
    queue.addPendingDamage(hits(10, 10, 10, 10, 10, 10, 10, 10, 10, 10));
    queue.process(1);
    assert.equal(target.hp, 20, 'ten 10s on one tick');
    assert.equal(target.shown.length, 10, 'all ten are sent; the client keeps four on screen');
    assert.equal(queue.hasPendingWork(), false, 'nothing carries over to the next tick');
});

test('hits after a lethal one take nothing more off', () => {
    const target = buildTarget(15);
    const queue = new HitQueue(target);
    queue.addPendingDamage(hits(10, 10, 10));
    queue.process(1);
    assert.equal(target.hp, 0);
    assert.deepEqual(target.shown, [10, 5, 0]);
});

// Wiki: Animation stall. "A full stall does not allow the player to move independently or
// perform actions. Hits are usually queued up on the player, and received only after the
// action is complete."
test('hits due during a full animation stall are kept until it releases', () => {
    const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
    const target = buildTarget(100);
    target.isPlayer = () => true;
    target.isUntargetable = () => false;
    const RELEASE = 7; // the cycle the stalled player is free again
    target.getCombat = () => ({ getIncomingHitCycle: () => RELEASE });

    const attacker = { isRegistered: () => true, getHitpoints: () => 50 };
    const swing = (damage) => ({
        getTarget: () => target,
        getAttacker: () => attacker,
        getTotalDamage: () => damage,
    });

    const landed = [];
    const executeHit = CombatFactory.executeHit;
    CombatFactory.executeHit = (hit) => landed.push(hit);
    try {
        const queue = new HitQueue(target);
        queue.addPendingHit(swing(9), 5); // due inside the window: waits for cycle 7
        queue.addPendingHit(swing(4), 6); // also inside it
        queue.addPendingHit(swing(3), 9); // already past it: keeps its own tick

        queue.process(5);
        queue.process(6);
        assert.deepEqual(landed, [], 'nothing lands while the animation still holds them');
        queue.process(7);
        assert.deepEqual(landed.map((hit) => hit.getTotalDamage()), [9, 4], 'the burst lands together');
        queue.process(9);
        assert.deepEqual(landed.map((hit) => hit.getTotalDamage()), [9, 4, 3]);
    } finally {
        CombatFactory.executeHit = executeHit;
    }
});

test('an unmoving target is not stalled, so an NPC takes its hits on the dot', () => {
    const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
    const target = buildTarget(100);
    target.isUntargetable = () => false;
    const attacker = { isRegistered: () => true, getHitpoints: () => 50 };
    const hit = { getTarget: () => target, getAttacker: () => attacker, getTotalDamage: () => 5 };

    const landed = [];
    const executeHit = CombatFactory.executeHit;
    CombatFactory.executeHit = (pending) => landed.push(pending);
    try {
        const queue = new HitQueue(target);
        queue.addPendingHit(hit, 5);
        queue.process(5);
        assert.equal(landed.length, 1, 'the monster is hit on the scheduled tick');
    } finally {
        CombatFactory.executeHit = executeHit;
    }
});

test('applied observers receive actual health lost, including overkill and zero hits', () => {
    const target = buildTarget(15);
    const queue = new HitQueue(target);
    const taken = [];
    queue.addPendingDamage(hits(10, 10, 10).map(hit => hit.onApplied(amount => taken.push(amount))));
    queue.process(1);
    queue.process(2);
    assert.deepEqual(taken, [10, 5, 0]);
});

test('a displayed hit that takes no health reports zero and discarded hits never report', () => {
    const target = buildTarget(100);
    target.decrementHealth = hit => hit; // Damage immunity may preserve a positive hitsplat.
    const queue = new HitQueue(target);
    const taken = [];
    queue.addPendingDamage([hits(25)[0].onApplied(amount => taken.push(amount))]);
    queue.process(1);
    assert.deepEqual(taken, [0]);
    queue.addPendingDamage([hits(25)[0].onApplied(amount => taken.push(amount))]);
    queue.clear();
    queue.process(2);
    assert.deepEqual(taken, [0]);
});

test('observers run once before reactive healing and cannot break the damage queue', t => {
    const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
    const target = buildTarget(100);
    const seen = [];
    t.mock.method(CombatFactory, 'handleRedemption', character => { character.hp += 20; });
    t.mock.method(console, 'error', () => {});
    const hit = hits(10)[0]
        .onApplied(amount => { seen.push([amount, target.hp]); throw new Error('observer failure'); })
        .onApplied(amount => seen.push([amount, target.hp]));
    const queue = new HitQueue(target);
    queue.addPendingDamage([hit, hit]);
    queue.process(1);
    assert.deepEqual(seen, [[10, 90], [10, 90]]);
    assert.equal(target.hp, 120);
    assert.equal(target.shown.length, 2);
    assert.equal(console.error.mock.calls.length, 1);
});

test('applied observers see actual HP loss once before reactive healing',t=>{
    const {CombatFactory}=require('../dist/game/content/combat/CombatFactory');
    const target=buildTarget(5),queue=new HitQueue(target),seen=[];
    t.mock.method(CombatFactory,'handleRedemption',()=>{target.hp+=2;});
    const hit=new HitDamage(10,HitMask.RED).onApplied(amount=>seen.push([amount,target.hp]));
    queue.addPendingDamage([hit]);queue.process(1);
    assert.deepEqual(seen,[[5,0]]);assert.equal(target.hp,2);
    hit.notifyApplied(10);assert.equal(seen.length,1);
});

test('a failing applied observer cannot suppress later observers or reactive healing',t=>{
    const {CombatFactory}=require('../dist/game/content/combat/CombatFactory');
    const target=buildTarget(5),queue=new HitQueue(target),seen=[];
    t.mock.method(console,'error',()=>{});
    t.mock.method(CombatFactory,'handleRedemption',()=>seen.push('healing'));
    queue.addPendingDamage([new HitDamage(2,HitMask.RED)
        .onApplied(()=>{throw new Error('observer fixture');}).onApplied(amount=>seen.push(amount))]);
    queue.process(1);assert.deepEqual(seen,[2,'healing']);
});

// Wiki: Animation stall. "Hits are usually queued up on the player, and received only after the
// action is complete." The window is decided by the animation the target is playing *when the hit
// comes due*, not by whether a stall happened to be armed when the attacker loosed it - a ranged
// shot is in the air across cycles, and content can stop a swing partway through.
test('a stall that begins after a hit is queued still holds that hit', () => {
    const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
    const target = buildTarget(100);
    target.isPlayer = () => true;
    target.isUntargetable = () => false;
    let hold = -1; // nothing holds the player the moment the shot is loosed
    target.getCombat = () => ({ getIncomingHitCycle: () => hold });

    const landed = [];
    const executeHit = CombatFactory.executeHit;
    CombatFactory.executeHit = (hit) => landed.push(hit);
    try {
        const swing = (damage) => ({
            getTarget: () => target,
            getAttacker: () => ({ isRegistered: () => true, getHitpoints: () => 50 }),
            getTotalDamage: () => damage,
        });
        const queue = new HitQueue(target);
        queue.addPendingHit(swing(7), 5); // the arrow is already in flight, due on cycle 5
        hold = 7; // on cycle 4 the target starts an animation that holds them until 7

        queue.process(5);
        queue.process(6);
        assert.deepEqual(landed, [], 'a hit already on its way waits for the stall');
        queue.process(7);
        assert.deepEqual(landed.map((hit) => hit.getTotalDamage()), [7],
            'it lands as the animation releases');
    } finally {
        CombatFactory.executeHit = executeHit;
    }
});

test('stopping the animation early releases the hits it was holding', () => {
    const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
    const target = buildTarget(100);
    target.isPlayer = () => true;
    target.isUntargetable = () => false;
    let hold = 12; // a full stall through cycle 12 at the moment the hit is queued
    target.getCombat = () => ({ getIncomingHitCycle: () => hold });

    const landed = [];
    const executeHit = CombatFactory.executeHit;
    CombatFactory.executeHit = (hit) => landed.push(hit);
    try {
        const swing = (damage) => ({
            getTarget: () => target,
            getAttacker: () => ({ isRegistered: () => true, getHitpoints: () => 50 }),
            getTotalDamage: () => damage,
        });
        const queue = new HitQueue(target);
        queue.addPendingHit(swing(4), 10); // due on 10, held behind the stall

        queue.process(10);
        assert.deepEqual(landed, [], 'held while the animation plays');
        hold = -1; // content stops the animation (a teleport, a death): Player.performAnimation
                   // passes the reset marker, which clears the stall it was measured from.
        queue.process(11);
        assert.deepEqual(landed.map((hit) => hit.getTotalDamage()), [4],
            'the held hit lands when the player is free, not on the deadline the stall once had');
    } finally {
        CombatFactory.executeHit = executeHit;
    }
});

// Phoenix necklace: the wiki says it clears the attacks pending on the player. A hit held by an
// animation stall is one of them, even when the necklace fires from the owner's own poison tick.
test('clearIncoming during a stalled drain also drops the held hits', () => {
    const target = buildTarget(100);
    target.isPlayer = () => true;
    target.getAsPlayer = () => ({ getHitpoints: () => 0 });
    target.getCombat = () => ({ getIncomingHitCycle: () => 9 });
    const other = { isRegistered: () => true };
    const queue = new HitQueue(target);
    const own = new HitDamage(5, HitMask.GREEN);
    const original = target.addTickHit;
    target.addTickHit = (hit) => { original(hit); queue.clearIncoming(); };
    queue.addPendingDamage([new HitDamage(30, HitMask.RED).setSource(other), own]);
    queue.process(5);
    assert.equal(target.hp, 95, 'only the sourceless poison landed');
    queue.process(9);
    assert.equal(target.hp, 95, 'the held hit never lands');
});
