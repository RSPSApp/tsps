// Run after `yarn build`: node --test tests/magic-stance-bonuses.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { World } = require('../dist/game/World');
const { AccuracyFormulasDpsCalc } = require('../dist/game/content/combat/formula/AccuracyFormulasDpsCalc');
const { FightType } = require('../dist/game/content/combat/FightType');
const { BonusManager } = require('../dist/game/model/equipment/BonusManager');

let cycle = 1;

/** A 99 Magic, 99 Defence player with no gear and no prayers. */
function caster(fightType, { autocasting = false } = {}) {
    World.processCycle = cycle++; // a fresh roll cache per case
    const player = {
        isPlayer: () => true,
        isNpc: () => false,
        getAsPlayer: () => player,
        isSpecialActivated: () => false,
        getPrayerActive: () => new Array(40).fill(false),
        getSkillManager: () => ({ getCurrentLevel: () => 99 }),
        getFightType: () => fightType,
        getCombat: () => ({ getAutocastSpell: () => (autocasting ? {} : null), getSelectedSpell: () => null }),
        getEquipment: () => ({ getItems: () => new Array(14).fill({ getId: () => -1 }) }),
        getBonusManager: () => ({
            getAttackBonus: () => [0, 0, 0, 0, 0],
            getDefenceBonus: () => [0, 0, 0, 0, 0],
        }),
    };
    return player;
}

const magicLevel = (player) => AccuracyFormulasDpsCalc.attackMagicRoll(player) / 64;
const magicDefenceLevel = (player) => AccuracyFormulasDpsCalc.defenseMagicRoll(player) / 64;

test('a powered staff on Accurate casts 2 levels more accurately', () => {
    assert.equal(FightType.POWERED_STAFF_ACCURATE.getBonusType(), BonusManager.ATTACK_MAGIC);
    assert.equal(magicLevel(caster(FightType.POWERED_STAFF_LONGRANGE)), 99 + 9);
    assert.equal(magicLevel(caster(FightType.POWERED_STAFF_ACCURATE)), 99 + 11);
    assert.equal(magicLevel(caster(FightType.STAFF_BASH, { autocasting: true })), 99 + 9,
        'a staff left on Bash gets nothing for spells');
});

test('autocasting gives no invisible Defence; Longrange gives 3', () => {
    assert.equal(AccuracyFormulasDpsCalc.effectiveDefenseLevel(caster(FightType.STAFF_FOCUS)), 99 + 3 + 8);
    assert.equal(
        AccuracyFormulasDpsCalc.effectiveDefenseLevel(caster(FightType.STAFF_FOCUS, { autocasting: true })),
        99 + 8,
    );
    assert.equal(AccuracyFormulasDpsCalc.effectiveDefenseLevel(caster(FightType.POWERED_STAFF_LONGRANGE)), 99 + 3 + 8);
});

test('magic defence takes 70% Magic and 30% Defence, each rounded down, plus the stance', () => {
    // floor(99 * 0.7) + floor(99 * 0.3) + 8 = 69 + 29 + 8
    assert.equal(magicDefenceLevel(caster(FightType.STAFF_BASH, { autocasting: true })), 106);
    assert.equal(magicDefenceLevel(caster(FightType.POWERED_STAFF_LONGRANGE)), 109);
});

test('the autocast selector gets the spellbook\'s list: the Slayer\'s staff\'s own on standard, Arceuus on Arceuus', () => {
    const { Autocasting } = require('../dist/game/content/combat/magic/Autocasting');
    const { MagicSpellbook } = require('../dist/game/model/MagicSpellbook');
    const { CombatSpells } = require('../dist/game/content/combat/magic/CombatSpells');
    const { ItemIdentifiers: Items } = require('../dist/util/ItemIdentifiers');
    // Varp 664 (cache scripts 2098/243): -1 standard, 4170 the Slayer's staff, 9013 Arceuus.
    assert.equal(Autocasting.selectorList(MagicSpellbook.NORMAL, Items.STAFF_OF_FIRE), -1);
    assert.equal(Autocasting.selectorList(MagicSpellbook.NORMAL, Items.SLAYERS_STAFF), 4170);
    assert.equal(Autocasting.selectorList(MagicSpellbook.NORMAL, Items.SLAYERS_STAFF_E_), 4170, 'the (e) has no entry of its own');
    assert.equal(Autocasting.selectorList(MagicSpellbook.ARCEUUS, Items.SLAYERS_STAFF), 9013);
    assert.equal(Autocasting.selectorList(MagicSpellbook.ARCEUUS, Items.SLAYERS_STAFF_E_), 9013);
    assert.equal(Autocasting.selectorList(MagicSpellbook.ANCIENT, Items.ANCIENT_STAFF), Items.ANCIENT_STAFF);
    // Wiki (Autocast): who may autocast Arceuus spells.
    for (const name of ["Slayer's staff", "Slayer's staff (e)", "Skull sceptre (i)", "Ahrim's staff 75", "Kodai wand", "Toxic staff of the dead"]) {
        assert.ok(Autocasting.canAutocastArceuus(name), name);
    }
    for (const name of ['Staff of fire', 'Ancient staff', 'Trident of the seas']) assert.ok(!Autocasting.canAutocastArceuus(name), name);
    // The selector's Arceuus slots: 53-55 the top row (demonbanes), 56-58 the bottom (grasps),
    // as cache script 4133 lays them out, enum 1986's icons and the Wiki's picture show.
    assert.deepEqual([53, 54, 55, 56, 57, 58].map((slot) => Autocasting.autocastSpell(slot)), [
        CombatSpells.INFERIOR_DEMONBANE, CombatSpells.SUPERIOR_DEMONBANE, CombatSpells.DARK_DEMONBANE,
        CombatSpells.GHOSTLY_GRASP, CombatSpells.SKELETAL_GRASP, CombatSpells.UNDEAD_GRASP,
    ]);
    // Each slot's icon in cache enum 1986 is that spell's own id.
    assert.deepEqual([53, 54, 55, 56, 57, 58].map((slot) => Autocasting.autocastSpell(slot).spellId()),
        [20398, 20399, 20400, 21826, 21829, 21832]);
});

test('the Slayer\'s staff (e) is a staff, as the plain one is', () => {
    const { CachePipeline } = require('../dist/game/cache/CachePipeline');
    const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
    const { WeaponInterfaces } = require('../dist/game/content/combat/WeaponInterfaces');
    const { ItemIdentifiers: Items } = require('../dist/util/ItemIdentifiers');
    CachePipeline.initialize();
    require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
    assert.equal(ItemDefinition.forId(Items.SLAYERS_STAFF_E_).getWeaponInterface(), WeaponInterfaces.STAFF);
    assert.equal(ItemDefinition.forId(Items.SLAYERS_STAFF).getWeaponInterface(), WeaponInterfaces.STAFF);
});

// ------------------------------------------------------------------ Arceuus spells

function arceuusPlayer({ magic = 99, prayer = 50, energy = 40, weapon = -1 } = {}) {
    const attributes = new Map();
    const player = {
        attributes, graphics: [], animations: [], messages: [], freezes: [], prayer, energy,
        isPlayer: () => true, isNpc: () => false, isRegistered: () => true, getAsPlayer: () => player,
        getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
        performGraphic: (graphic) => player.graphics.push(graphic?.getId?.() ?? null),
        performAnimation: (animation) => player.animations.push(animation.getId()),
        sendMessage: (message) => player.messages.push(message),
        getEquipment: () => ({ getWeapon: () => ({ getId: () => weapon }) }),
        getSkillManager: () => ({
            getMaxLevel: () => magic,
            getCurrentLevel: (skill) => (skill === 5 ? player.prayer : magic),
            decreaseCurrentLevel: (skill, amount) => { player.prayer -= amount; },
            addExperiences: () => {},
        }),
        getRunEnergy: () => player.energy,
        setRunEnergy: (value) => { player.energy = value; },
        getPacketSender: () => ({ sendRunEnergy() {} }),
    };
    return player;
}

function withRandom(value, fn) {
    const random = Math.random;
    Math.random = () => value;
    try { return fn(); } finally { Math.random = random; }
}

test('grasps: the bind is rolled at the cast (doubled by the Mark) and shown 30 cycles on; it takes hold when the hit lands (Wiki, capture)', () => {
    const { CombatSpells } = require('../dist/game/content/combat/magic/CombatSpells');
    const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
    const freezes = [];
    const freeze = CombatFactory.freeze;
    CombatFactory.freeze = (target, seconds) => freezes.push(seconds);
    const delays = [];
    const cast = (spell, caster, target, accurate, random) => {
        target.performGraphic = (graphic) => { target.graphics.push(graphic?.getId?.() ?? null); delays.push(graphic?.delay ?? graphic?.getDelay?.()); };
        const hit = { isAccurate: () => accurate, getAttacker: () => caster, getTarget: () => target, getTotalDamage: () => 5 };
        withRandom(random, () => spell.onHitCalc(hit));
        spell.finishCast(caster, target, accurate, 5);
    };
    try {
        const spell = CombatSpells.UNDEAD_GRASP;
        assert.equal(spell.castAnimation().getId(), 8972);
        assert.equal(spell.startGraphic().getId(), 1862);
        const caster = arceuusPlayer();
        const target = arceuusPlayer();
        cast(spell, caster, target, true, 0.49);
        assert.deepEqual([target.graphics.at(-1), delays.at(-1), freezes.at(-1)], [1863, 30, 4 * 0.6], '50%: bound for 4 ticks, the bind graphic 30 cycles on');
        cast(spell, caster, target, true, 0.51);
        assert.deepEqual([target.graphics.at(-1), freezes.length], [1864, 1], 'not bound: the plain impact');
        caster.setAttribute('arceuus:mark-until', Date.now() + 60_000);
        cast(spell, caster, target, true, 0.99);
        assert.equal(freezes.length, 2, 'the Mark makes 50% into 100%');
        target.setAttribute('arceuus:ward-until', Date.now() + 60_000);
        cast(CombatSpells.GHOSTLY_GRASP, caster, target, true, 0);
        assert.equal(freezes.at(-1), 0.6, 'warded: 1 tick');
        const missed = arceuusPlayer();
        cast(spell, caster, missed, false, 0);
        assert.deepEqual([missed.graphics, freezes.length], [[], 3], 'a splash: no grasp graphic, no bind');
    } finally {
        CombatFactory.freeze = freeze;
    }
});

test('grasps land after 1 tick and demonbanes after 2, whatever the distance (Wiki: Hit delay)', () => {
    const { CombatSpells } = require('../dist/game/content/combat/magic/CombatSpells');
    for (const grasp of [CombatSpells.GHOSTLY_GRASP, CombatSpells.SKELETAL_GRASP, CombatSpells.UNDEAD_GRASP]) assert.equal(grasp.hitDelay(), 1);
    for (const demonbane of [CombatSpells.INFERIOR_DEMONBANE, CombatSpells.SUPERIOR_DEMONBANE, CombatSpells.DARK_DEMONBANE]) assert.equal(demonbane.hitDelay(), 2);
    assert.equal(CombatSpells.FIRE_STRIKE.hitDelay(), null, 'other spells keep the usual delay');
});

test('demonbanes: +20% accuracy, +40% and +25% damage with the Mark, doubled with a purging staff (Wiki)', () => {
    const { CombatSpells } = require('../dist/game/content/combat/magic/CombatSpells');
    const spell = CombatSpells.DARK_DEMONBANE;
    assert.deepEqual([spell.castAnimation().getId(), spell.startGraphic().getId(), spell.endGraphic().getId()], [8977, 1869, 1870]);
    const plain = arceuusPlayer();
    assert.deepEqual([spell.demonbaneAccuracyMultiplier(plain), spell.demonbaneDamageMultiplier(plain)], [1.2, 1]);
    plain.setAttribute('arceuus:mark-until', Date.now() + 60_000);
    assert.deepEqual([spell.demonbaneAccuracyMultiplier(plain), spell.demonbaneDamageMultiplier(plain)], [1.4, 1.25]);
    const purging = arceuusPlayer({ weapon: 29594 });
    purging.setAttribute('arceuus:mark-until', Date.now() + 60_000);
    assert.deepEqual([spell.demonbaneAccuracyMultiplier(purging), spell.demonbaneDamageMultiplier(purging)], [1.8, 1.5]);
    assert.equal(CombatSpells.UNDEAD_GRASP.demonbaneAccuracyMultiplier(plain), 1, 'not a demonbane spell');
});

test('Mark of Darkness: 3 ticks per base Magic level (x5 with a purging staff), a warning 10 ticks before, then it fades (Wiki)', () => {
    const { ArceuusSpells } = require('../dist/game/content/combat/magic/ArceuusSpells');
    const { TaskManager } = require('../dist/game/task/TaskManager');
    const player = arceuusPlayer({ magic: 20 });
    const start = Date.now();
    ArceuusSpells.placeMark(player);
    const ticks = (player.getAttribute('arceuus:mark-until') - start) / 600;
    assert.ok(Math.abs(ticks - 60) < 1, `${ticks} ticks for level 20`);
    for (let i = 0; i < 50; i++) TaskManager.process();
    assert.deepEqual(player.messages, ['Your Mark of Darkness is about to run out.']);
    for (let i = 0; i < 10; i++) TaskManager.process();
    assert.deepEqual(player.messages.at(-1), 'Your Mark of Darkness has faded away.');
    assert.equal(player.graphics.at(-1), 1886);
    const purging = arceuusPlayer({ magic: 20, weapon: 29595 });
    ArceuusSpells.placeMark(purging);
    assert.ok(Math.abs((purging.getAttribute('arceuus:mark-until') - Date.now()) / 600 - 300) < 1, 'x5');
});

test('Vile Vigour spends only the prayer that fills run energy; Death Charge restores once per cast (Wiki)', () => {
    const { ArceuusSpells } = require('../dist/game/content/combat/magic/ArceuusSpells');
    const { Spell } = require('../dist/game/content/combat/magic/Spell');
    const canCast = Spell.prototype.canCast;
    Spell.prototype.canCast = () => true;
    try {
        const player = arceuusPlayer({ prayer: 50, energy: 80 });
        ArceuusSpells.handleSpell(player, 'Vile Vigour');
        assert.deepEqual([player.energy, player.prayer], [100, 30], '20 prayer for 20% energy');
        assert.deepEqual(player.animations, [8978]);
        assert.deepEqual(player.graphics, [1876]);
        ArceuusSpells.handleSpell(player, 'Vile Vigour');
        assert.equal(player.messages.at(-1), "You're already at maximum run energy.");
        player.energy = 10;
        player.setAttribute('arceuus:vile-vigour-cooldown', Date.now() + 10_200); // as the cast's rune check sets it
        ArceuusSpells.handleSpell(player, 'Vile Vigour');
        assert.equal(player.messages.at(-1), 'You can only cast Vile Vigour every 10 seconds.');

        const killer = arceuusPlayer();
        ArceuusSpells.handleSpell(killer, 'Death Charge');
        assert.equal(ArceuusSpells.useDeathCharge(killer), true);
        assert.equal(ArceuusSpells.useDeathCharge(killer), false, 'once per cast');
        assert.equal(killer.graphics.at(-1), 1855);
    } finally {
        Spell.prototype.canCast = canCast;
    }
});

test('corruption: certain with the Mark at casting (50% without), with its hit graphic (Wiki)', () => {
    const { ArceuusSpells } = require('../dist/game/content/combat/magic/ArceuusSpells');
    const { Spell } = require('../dist/game/content/combat/magic/Spell');
    const canCast = Spell.prototype.canCast;
    Spell.prototype.canCast = () => true;
    try {
        const caster = arceuusPlayer();
        caster.setAttribute('arceuus:mark-until', Date.now() + 60_000);
        ArceuusSpells.handleSpell(caster, 'Greater Corruption');
        const target = arceuusPlayer();
        withRandom(0.99, () => ArceuusSpells.applyCorruption(caster, target));
        assert.equal(target.graphics.at(-1), 1880, 'corrupted though the roll was high');
        caster.setAttribute('arceuus:corruption-cooldown', Date.now() + 30_000); // as the cast's rune check sets it
        ArceuusSpells.handleSpell(caster, 'Lesser Corruption');
        assert.equal(caster.messages.at(-1), 'You can only cast corruption spells every 30 seconds.');
    } finally {
        Spell.prototype.canCast = canCast;
    }
});

test("a manual cast keeps its cast animation: the combat reset after it doesn't replace it", () => {
    const { Combat } = require('../dist/game/content/combat/Combat');
    const { MagicCombatMethod } = require('../dist/game/content/combat/method/impl/MagicCombatMethod');
    const animations = [];
    const character = {
        isPlayer: () => true, isNpc: () => false,
        getAsPlayer: () => ({ getPacketSender: () => ({ sendConfig() {} }) }),
        setMobileInteraction() {}, setPositionToFace() {},
        performAnimation: (animation) => animations.push(animation.getId()),
        getMovementQueue: () => ({ reset() {} }),
    };
    const combat = new Combat(character);
    character.getCombat = () => combat;
    combat.target = {};
    combat.setAutocastSpell?.(null);
    const cast = { id: 'dark demonbane' };
    combat.setCastSpell?.(cast);
    new MagicCombatMethod().finished(character, {});
    assert.deepEqual(animations, [], 'no reset animation after a manual cast');
    combat.target = {};
    combat.reset();
    assert.deepEqual(animations, [65535], 'an ordinary reset still stops the animation');
});
