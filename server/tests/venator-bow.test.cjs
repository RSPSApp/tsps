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
