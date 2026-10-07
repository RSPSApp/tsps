// Run after `yarn build`: node --test tests/pvp-damage-effects.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
const { PrayerHandler } = require('../dist/game/content/PrayerHandler');
const { Skill } = require('../dist/game/model/Skill');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const { DamageFormulas } = require('../dist/game/content/combat/formula/DamageFormulas');
const { registerRangedHitModifier } = require('../dist/game/content/combat/EquipmentEffects');
const { FightStyle } = require('../dist/game/content/combat/FightStyle');
const TwistedBow = require('../plugins/items/TwistedBow.plugin');

PrayerHandler.deactivatePrayers = (player) => player.getPrayerActive().fill(false);

function buildPlayer({ hp = 99, maxHp = 99, prayer = 99, ring = -1, prayers = [] } = {}) {
    const current = new Map([[Skill.HITPOINTS, hp], [Skill.PRAYER, prayer]]);
    const max = new Map([[Skill.HITPOINTS, maxHp], [Skill.PRAYER, prayer]]);
    const active = new Array(40).fill(false);
    for (const p of prayers) active[p] = true;
    const attributes = new Map();
    const messages = [];
    let ringItem = { getId: () => ring };
    const received = [];
    const player = {
        messages,
        received,
        isPlayer: () => true,
        getAsPlayer: () => player,
        getHitpoints: () => current.get(Skill.HITPOINTS),
        getPrayerActive: () => active,
        getSkillManager: () => ({
            getMaxLevel: (skill) => max.get(skill),
            getCurrentLevel: (skill) => current.get(skill),
            setCurrentLevels: (skill, value) => current.set(skill, value),
            decreaseCurrentLevel: (skill, amount, minimum) =>
                current.set(skill, Math.max(minimum, current.get(skill) - amount)),
        }),
        getEquipment: () => ({
            get: (slot) => (slot === Equipment.RING_SLOT ? ringItem : { getId: () => -1 }),
            set: (slot, item) => { if (slot === Equipment.RING_SLOT) ringItem = item; },
            refreshItems: () => {},
        }),
        getAttribute: (key) => attributes.get(key),
        setAttribute: (key, value) => attributes.set(key, value),
        sendMessage: (message) => messages.push(message),
        performGraphic: () => {},
        getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => received.push(...hits) }) }),
        prayer: () => current.get(Skill.PRAYER),
        ring: () => ringItem.getId(),
    };
    return player;
}

test('ring of recoil rebounds 10% + 1 of every damaging hit, rounded down', () => {
    assert.equal(CombatFactory.recoilDamage(0), 0);
    assert.equal(CombatFactory.recoilDamage(1), 1);
    assert.equal(CombatFactory.recoilDamage(9), 1);
    assert.equal(CombatFactory.recoilDamage(17), 2);
    assert.equal(CombatFactory.recoilDamage(50), 6);

    const player = buildPlayer({ ring: ItemIdentifiers.RING_OF_RECOIL });
    const attacker = buildPlayer();
    for (let i = 0; i < 10; i++) CombatFactory.handleRecoil(player, attacker, 17);
    assert.deepEqual(attacker.received.map((hit) => hit.getDamage()), new Array(10).fill(2), 'no random skips');
    assert.ok(attacker.received.every((hit) => hit.isReflected()));
});

test('a ring of recoil shatters after 40 damage, its last recoil dealing only what is left', () => {
    const player = buildPlayer({ ring: ItemIdentifiers.RING_OF_RECOIL });
    const attacker = buildPlayer();
    for (let i = 0; i < 6; i++) CombatFactory.handleRecoil(player, attacker, 60); // 7 each
    assert.deepEqual(attacker.received.map((hit) => hit.getDamage()), [7, 7, 7, 7, 7, 5]);
    assert.equal(player.ring(), -1);
    assert.match(player.messages.at(-1), /Ring of Recoil has shattered/);
    assert.equal(player.getAttribute(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE), 0, 'the next ring has 40 again');
});

test('core recoil is only the ring of recoil; a ring of suffering (r) recoils from its plugin', () => {
    assert.ok(CombatFactory.wearingRecoilRing(buildPlayer({ ring: ItemIdentifiers.RING_OF_RECOIL })));
    assert.equal(CombatFactory.wearingRecoilRing(buildPlayer({ ring: ItemIdentifiers.RING_OF_SUFFERING_RI_ })), false);
});

test('Redemption fires after the hit, under 10% HP, and never saves a lethal hit', () => {
    const low = buildPlayer({ hp: 9, prayer: 99, prayers: [PrayerHandler.REDEMPTION] });
    CombatFactory.handleRedemption(low);
    assert.equal(low.getHitpoints(), 9 + 24, 'heals floor(99 / 4)');
    assert.equal(low.prayer(), 0);
    assert.equal(PrayerHandler.isActivated(low, PrayerHandler.REDEMPTION), false);

    const healthy = buildPlayer({ hp: 10, prayers: [PrayerHandler.REDEMPTION] });
    CombatFactory.handleRedemption(healthy);
    assert.equal(healthy.getHitpoints(), 10, '10 of 99 is not below 10%');

    const dead = buildPlayer({ hp: 0, prayers: [PrayerHandler.REDEMPTION] });
    CombatFactory.handleRedemption(dead);
    assert.equal(dead.getHitpoints(), 0);
    assert.equal(dead.prayer(), 99);
});

test('Smite drains a quarter of the damage, rounded down', () => {
    const victim = buildPlayer({ prayer: 50 });
    CombatFactory.handleSmite(null, victim, 17);
    assert.equal(victim.prayer(), 46);
    CombatFactory.handleSmite(null, victim, 3);
    assert.equal(victim.prayer(), 46, 'hits under 4 drain nothing');
});

test('Twisted bow scales on an NPC\'s magic accuracy when it beats its Magic level', () => {
    const { getTwistedBowScaleValue, twistedBowDamagePercent, twistedBowAccuracyPercent } = TwistedBow._test;
    const zuk = {
        isPlayer: () => false,
        isNpc: () => true,
        getAsNpc: () => zuk,
        getCurrentDefinition: () => ({ getStats: () => [350, 0, 0, 0, 150, 0, 0, 550, 0, 0] }),
    };
    assert.equal(getTwistedBowScaleValue(zuk), 250, 'magic accuracy 550, capped at 250');
    assert.equal(twistedBowDamagePercent(250), 215);
    assert.equal(twistedBowAccuracyPercent(250), 140);

    const olm = {
        isPlayer: () => false,
        isNpc: () => true,
        getAsNpc: () => olm,
        getCurrentDefinition: () => ({
            getStats: () => [250, 0, 0, 0, 250, 0, 0, 400, 0, 0],
            hasAttribute: (attribute) => attribute === 'xerician',
        }),
    };
    assert.equal(getTwistedBowScaleValue(olm), 350, 'the Chambers of Xeric cap');
    assert.equal(twistedBowDamagePercent(350), 248);
});

test('ranged gear damage modifiers reach the ranged max hit', () => {
    const archer = {
        isPlayer: () => true,
        isNpc: () => false,
        getAsPlayer: () => archer,
        getPrayerActive: () => new Array(40).fill(false),
        getSkillManager: () => ({ getCurrentLevel: () => 99 }),
        getBonusManager: () => ({ getOtherBonus: () => [0, 100, 0, 0] }),
        getFightType: () => ({ getStyle: () => FightStyle.ACCURATE }),
        getEquipment: () => ({ getItems: () => new Array(14).fill({ getId: () => -1 }), get: () => ({ getId: () => -1 }) }),
        isSpecialActivated: () => false,
        getCombatSpecial: () => null,
    };
    const base = DamageFormulas.calculateMaxRangedHit(archer);
    registerRangedHitModifier((entity, maxHit) => (entity === archer ? maxHit * 2 : maxHit));
    assert.equal(DamageFormulas.calculateMaxRangedHit(archer), base * 2);
});
