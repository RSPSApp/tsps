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
        getCombat: () => ({ getAutocastSpell: () => (autocasting ? {} : null), getSelectedSpell: () => null, getTarget: () => null }),
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
        attributes, graphics: [], animations: [], messages: [], freezes: [], prayer, energy, hitpoints: 99, registered: true,
        isPlayer: () => true, isNpc: () => false, isRegistered: () => player.registered, getAsPlayer: () => player,
        getHitpoints: () => player.hitpoints,
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
        caster.setAttribute('arceuus:mark-until', World.getProcessCycle() + 100);
        cast(spell, caster, target, true, 0.99);
        assert.equal(freezes.length, 2, 'the Mark makes 50% into 100%');
        target.setAttribute('arceuus:ward-until', World.getProcessCycle() + 100);
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
    plain.setAttribute('arceuus:mark-until', World.getProcessCycle() + 100);
    assert.deepEqual([spell.demonbaneAccuracyMultiplier(plain), spell.demonbaneDamageMultiplier(plain)], [1.4, 1.25]);
    const purging = arceuusPlayer({ weapon: 29594 });
    purging.setAttribute('arceuus:mark-until', World.getProcessCycle() + 100);
    assert.deepEqual([spell.demonbaneAccuracyMultiplier(purging), spell.demonbaneDamageMultiplier(purging)], [1.8, 1.5]);
    assert.equal(CombatSpells.UNDEAD_GRASP.demonbaneAccuracyMultiplier(plain), 1, 'not a demonbane spell');
});

test('demonbanes against a more vulnerable demon: the bonus scales with it (Wiki: void flares 200%)', () => {
    const { CombatSpells } = require('../dist/game/content/combat/magic/CombatSpells');
    const spell = CombatSpells.DARK_DEMONBANE;
    const flare = { getAttribute: (key) => (key === 'combat:demonbane-vulnerability' ? 2 : undefined) };
    const purging = arceuusPlayer({ weapon: 29594 });
    purging.setAttribute('arceuus:mark-until', World.getProcessCycle() + 100);
    purging.getCombat = () => ({ getTarget: () => flare });
    assert.deepEqual([spell.demonbaneAccuracyMultiplier(purging), spell.demonbaneDamageMultiplier(purging)], [2.6, 2]);
});

test('Mark of Darkness: 3 ticks per base Magic level (x5 with a purging staff), a warning 10 ticks before, then it fades (Wiki)', () => {
    const { ArceuusSpells } = require('../dist/game/content/combat/magic/ArceuusSpells');
    const { TaskManager } = require('../dist/game/task/TaskManager');
    const player = arceuusPlayer({ magic: 20 });
    const start = World.getProcessCycle();
    ArceuusSpells.placeMark(player);
    const ticks = player.getAttribute('arceuus:mark-until') - start;
    assert.ok(Math.abs(ticks - 60) < 1, `${ticks} ticks for level 20`);
    for (let i = 0; i < 50; i++) TaskManager.process();
    assert.deepEqual(player.messages, ['Your Mark of Darkness is about to run out.']);
    for (let i = 0; i < 10; i++) TaskManager.process();
    assert.deepEqual(player.messages.at(-1), 'Your Mark of Darkness has faded away.');
    assert.equal(player.graphics.at(-1), 1886);
    const purging = arceuusPlayer({ magic: 20, weapon: 29595 });
    ArceuusSpells.placeMark(purging);
    assert.equal(purging.getAttribute('arceuus:mark-until') - World.getProcessCycle(), 300, 'x5');
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
        player.setAttribute('arceuus:vile-vigour-cooldown', World.getProcessCycle() + 17); // as the cast's rune check sets it
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
        caster.setAttribute('arceuus:mark-until', World.getProcessCycle() + 100);
        ArceuusSpells.handleSpell(caster, 'Greater Corruption');
        const target = arceuusPlayer();
        withRandom(0.99, () => ArceuusSpells.applyCorruption(caster, target));
        assert.equal(target.graphics.at(-1), 1880, 'corrupted though the roll was high');
        caster.setAttribute('arceuus:corruption-cooldown', World.getProcessCycle() + 50); // as the cast's rune check sets it
        ArceuusSpells.handleSpell(caster, 'Lesser Corruption');
        assert.equal(caster.messages.at(-1), 'You can only cast corruption spells every 30 seconds.');
    } finally {
        Spell.prototype.canCast = canCast;
    }
});

function corruptionTask(t, total, marked) {
    const { ArceuusSpells } = require('../dist/game/content/combat/magic/ArceuusSpells');
    const { TaskManager } = require('../dist/game/task/TaskManager');
    const { Task } = require('../dist/game/task/Task');
    const tasks = [], caster = arceuusPlayer(), target = arceuusPlayer(), drains = [];
    let tick = 0;
    t.mock.method(TaskManager, 'submit', task => { task.setRunning(true); tasks.push(task); });
    const skills = target.getSkillManager();
    skills.decreaseCurrentLevel = (_skill, amount) => { target.prayer -= amount; drains.push([tick, amount]); };
    target.getSkillManager = () => skills;
    caster.setAttribute('arceuus:corruption', total);
    caster.setAttribute('arceuus:corruption-marked', marked);
    withRandom(0, () => ArceuusSpells.applyCorruption(caster, target));
    assert.equal(tasks.length, 1);
    const task = tasks[0];
    assert.ok(task instanceof Task, 'exercise the real scheduled task countdown and onTick');
    return { caster, target, task, drains, advance(count) { for (let i = 0; i < count; i++) { tick++; task.tick(); } } };
}

test('corruption drains retain their exact 5/10-tick schedule and amounts after the caster dies or leaves', t => {
    for (const [total, amounts] of [[6, [1,2,3]], [12, [2,4,6]]]) {
        for (const marked of [false, true]) {
            const h = corruptionTask(t, total, marked), interval = marked ? 5 : 10;
            h.caster.hitpoints = 0; h.caster.registered = false;
            h.advance(interval * 3 + 2);
            assert.deepEqual(h.drains, amounts.map((amount, index) => [interval * (index + 1), amount]));
            assert.equal(h.target.prayer, 50 - total);
            assert.equal(h.task.isRunning(), false, 'no fourth drain');
        }
    }
});

test('corruption cannot resume after target death and respawn between its drain ticks', t => {
    for (const marked of [false, true]) {
        const h = corruptionTask(t, 12, marked), interval = marked ? 5 : 10;
        h.advance(1); h.target.hitpoints = 0;
        h.advance(1); h.target.hitpoints = 99;
        h.advance(interval * 3);
        assert.deepEqual(h.drains, [], 'the dead tick ends this effect even if respawn precedes its first drain');
        assert.equal(h.task.isRunning(), false);
    }
});

test('corruption does not drain a target dead on the scheduled drain tick', t => {
    for (const marked of [false, true]) {
        const h = corruptionTask(t, 6, marked), interval = marked ? 5 : 10;
        h.advance(interval - 1); h.target.hitpoints = 0; h.advance(1);
        assert.deepEqual(h.drains, []);
        assert.equal(h.task.isRunning(), false);
    }
});

test('corruption cannot resume after its target unregisters and returns between drains', t => {
    const h = corruptionTask(t, 12, false);
    h.advance(10); h.target.registered = false;
    h.advance(1); h.target.registered = true; h.advance(30);
    assert.deepEqual(h.drains, [[10,2]]);
    assert.equal(h.task.isRunning(), false);
});

test('Ward nullifies an active corruption effect between drains', t => {
    const h = corruptionTask(t, 12, true);
    h.advance(1); h.target.setAttribute('arceuus:ward-until', Number.MAX_SAFE_INTEGER);
    h.advance(1); h.target.setAttribute('arceuus:ward-until', null); h.advance(20);
    assert.deepEqual(h.drains, []);
    assert.equal(h.task.isRunning(), false);
});

test('corruption refuses initially dead or unregistered targets without consuming the prepared spell', t => {
    const { ArceuusSpells } = require('../dist/game/content/combat/magic/ArceuusSpells');
    const { TaskManager } = require('../dist/game/task/TaskManager');
    const tasks = [];
    t.mock.method(TaskManager, 'submit', task => tasks.push(task));
    for (const invalid of ['dead', 'unregistered', 'warded']) {
        const caster = arceuusPlayer(), target = arceuusPlayer();
        caster.setAttribute('arceuus:corruption', 12); caster.setAttribute('arceuus:corruption-marked', true);
        if (invalid === 'dead') target.hitpoints = 0;
        else if (invalid === 'unregistered') target.registered = false;
        else target.setAttribute('arceuus:ward-until', Number.MAX_SAFE_INTEGER);
        withRandom(0, () => ArceuusSpells.applyCorruption(caster, target));
        assert.deepEqual(target.graphics, []);
        assert.equal(caster.getAttribute('arceuus:corruption'), 12);
        assert.equal(caster.getAttribute('arceuus:corruption-marked'), true);
    }
    assert.deepEqual(tasks, []);
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


test('magic impact effects use the launched spell after another spell has been cast', () => {
 const {MagicCombatMethod}=require('../dist/game/content/combat/method/impl/MagicCombatMethod');
 const {Sounds}=require('../dist/game/Sounds');const old=Sounds.sendSound,calls=[];Sounds.sendSound=()=>{};
 const launched={spellId:()=>-1,endGraphic:()=>null,impactSound:()=>null,finishCast:(a,t,accurate,damage)=>calls.push([accurate,damage])};
 const attacker={getHitpoints:()=>99,getCombat:()=>({getPreviousCast:()=>({finishCast:()=>assert.fail('a later spell cannot replace the launched bind')})})};
 const target={getHitpoints:()=>99};const hit={getAttacker:()=>attacker,getTarget:()=>target,isAccurate:()=>true,getTotalDamage:()=>7,getSpell:()=>launched,getSpellContext:()=>null};
 try{new MagicCombatMethod().handleAfterHitEffects(hit);assert.deepEqual(calls,[[true,7]]);hit.getSpell=()=>null;new MagicCombatMethod().handleAfterHitEffects(hit);assert.equal(calls.length,1);}finally{Sounds.sendSound=old;}
});

test('accurate combat spells expose a typed generic hit-effects event to plugins', () => {
    const { CombatSpells } = require('../dist/game/content/combat/magic/CombatSpells');
    const { PluginManager } = require('../dist/plugins/PluginManager');
    const emit = PluginManager.emitCustomEvent;
    const events = [];
    PluginManager.emitCustomEvent = (name, event) => events.push([name, event]);
    try {
        const attacker = {};
        const target = {};
        const hit = { isAccurate: () => true, getAttacker: () => attacker, getTarget: () => target, getTotalDamage: () => 9 };
        CombatSpells.FIRE_WAVE.onHitCalc(hit);
        assert.equal(events.length, 2);
        assert.equal(events[0][0], 'magic:hit-effects');
        assert.deepEqual(events[0][1], { attacker, target, spell: CombatSpells.FIRE_WAVE, hit, allowed: true, effectMultiplier: 1 });
        assert.equal(events[1][0], 'magic:hit-effects-applied');
        assert.equal(events[1][1], events[0][1], 'post-effect handlers see the final shared context');

        CombatSpells.FIRE_WAVE.onHitCalc({ ...hit, isAccurate: () => false });
        assert.equal(events.length, 2, 'misses do not trigger spell-specific effects');
    } finally {
        PluginManager.emitCustomEvent = emit;
    }
});

test('a combat cast pays its Wiki base XP once, at the XP rate: splashes pay the splash value, powered staves have none', (t) => {
    const { MagicCombatMethod } = require('../dist/game/content/combat/method/impl/MagicCombatMethod');
    const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
    const { CombatSpells } = require('../dist/game/content/combat/magic/CombatSpells');
    const { CombatType } = require('../dist/game/content/combat/CombatType');
    const { SkillManager } = require('../dist/game/content/skill/SkillManager');
    const { GameConstants } = require('../dist/game/GameConstants');
    const { Skill } = require('../dist/game/model/Skill');
    const { Sounds } = require('../dist/game/Sounds');
    t.mock.method(Sounds, 'sendSound', () => {});
    const rate = GameConstants.EXPERIENCE_MULTIPLIER;
    GameConstants.setExperienceRate(2);
    t.after(() => GameConstants.setExperienceRate(rate));

    const sender = new Proxy({}, { get: (_, name) => (name === 'then' ? undefined : () => sender) });
    const skills = new SkillManager({ getPacketSender: () => sender, getAttribute: () => undefined });
    let spell = null;
    const player = {
        isPlayer: () => true, isNpc: () => false, getAsPlayer: () => player, getSkillManager: () => skills,
        getCombat: () => ({ getSelectedSpell: () => spell, getCastSpell: () => spell, getPreviousCast: () => null }),
    };
    const hit = (accurate, damage) => ({
        getTotalDamage: () => damage, getSkills: () => [Skill.MAGIC.getIndex()], getCombatType: () => CombatType.MAGIC,
        isAccurate: () => accurate, getTarget: () => ({ isNpc: () => false }),
    });
    /** One cast and the hits it queues; returns the Magic XP gained. */
    const cast = (castSpell, ...hits) => {
        spell = castSpell;
        t.mock.method(castSpell, 'startCast', () => {});
        skills.setMaxLevel(Skill.MAGIC, 99).setExperience(Skill.MAGIC, 13_034_431);
        new MagicCombatMethod().start(player, {});
        // What hits() does once the main target is rolled; a second call (a special's extra
        // target) must not pay again.
        MagicCombatMethod.payBaseExperience(player, castSpell, hits[0].isAccurate());
        MagicCombatMethod.payBaseExperience(player, castSpell, hits[0].isAccurate());
        for (const queued of hits) CombatFactory.rewardExp(player, queued);
        return skills.getExperience(Skill.MAGIC) - 13_034_431;
    };

    assert.equal(cast(CombatSpells.WIND_STRIKE, hit(false, 0)), 11, 'a Wind Strike splash: 5.5 base only, doubled');
    assert.equal(cast(CombatSpells.WIND_STRIKE, hit(true, 2)), 11 + 8, '5.5 base + 2 per damage, doubled');
    assert.equal(cast(CombatSpells.ICE_BARRAGE, hit(true, 10), hit(true, 10)), 104 + 80, 'one 52 base for two targets');
    assert.equal(cast(CombatSpells.TRIDENT_OF_THE_SEAS, hit(true, 10)), 40, 'a powered staff: 2 per damage, no base');
    // Wiki: the binding spells and Tele Block pay less on a splash.
    assert.equal(cast(CombatSpells.ENTANGLE, hit(true, 0)), 178, 'Entangle hit: 89');
    assert.equal(cast(CombatSpells.ENTANGLE, hit(false, 0)), 140, 'Entangle splash: 70');
    assert.equal(cast(CombatSpells.BIND, hit(false, 0)), 60, 'Bind splash: 30');
    assert.equal(cast(CombatSpells.SNARE, hit(false, 0)), 120, 'Snare splash: 60');
    assert.equal(cast(CombatSpells.TELEBLOCK, hit(true, 0)), 190, 'Tele Block hit: 95');
    assert.equal(cast(CombatSpells.TELEBLOCK, hit(false, 0)), 168, 'Tele Block splash: 84');
});

test('tick stopwatch: gameplay delays are whole game cycles, and a fresh one has elapsed', () => {
    const { TickStopwatch } = require('../dist/util/TickStopwatch');
    const stopwatch = new TickStopwatch();
    assert.equal(stopwatch.elapsedTime(1800), true, 'never started: every delay has elapsed');
    stopwatch.reset();
    const start = World.getProcessCycle();
    assert.equal(stopwatch.elapsedTime(1800), false);
    World.processCycle = start + 2;
    assert.equal(stopwatch.elapsedTime(1800), false, 'two ticks are 1200ms');
    World.processCycle = start + 3;
    assert.equal(stopwatch.elapsed(), 1800);
    assert.equal(stopwatch.elapsedTime(1800), true, 'three ticks are 1800ms');
});
