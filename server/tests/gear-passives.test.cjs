// Run after `yarn build`: node --test tests/gear-passives.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const { Skill } = require('../dist/game/model/Skill');
const EquipmentEffects = require('../plugins/combat/EquipmentEffects.plugin');
const SlayerHelmet = require('../plugins/items/SlayerHelmet.plugin');

// Equipped items are looked up by name; give each test item an id and a name.
const NAMES = new Map();
let nextId = 90000;
function item(name) {
    const id = nextId++;
    NAMES.set(id, name);
    return id;
}
ItemDefinition.forId = (id) => ({ getName: () => NAMES.get(id) ?? '' });

/** A fake plugin api that keeps every modifier and passes custom events between plugins. */
function buildApi({ onTask = false } = {}) {
    const modifiers = {};
    const listeners = new Map();
    const register = (kind) => (modifier) => (modifiers[kind] ??= []).push(modifier);
    const api = {
        core: { ItemIdentifiers, Skill, Equipment, ItemDefinition },
        registerMeleeHitModifier: register('meleeHit'),
        registerRangedHitModifier: register('rangedHit'),
        registerMagicHitModifier: register('magicHit'),
        registerMagicDamageBonusModifier: register('magicDamageBonus'),
        registerMeleeAttackAccuracyModifier: register('meleeAccuracy'),
        registerRangedAttackAccuracyModifier: register('rangedAccuracy'),
        registerMagicAttackAccuracyModifier: register('magicAccuracy'),
        registerMeleeDefenseModifier: register('meleeDefence'),
        registerRangedDefenseModifier: register('rangedDefence'),
        registerMagicDefenseModifier: register('magicDefence'),
        registerIncomingDamageModifier: register('incomingDamage'),
        onCustomEvent: (name, handler) => listeners.set(name, [...(listeners.get(name) ?? []), handler]),
        emitCustomEvent: (name, payload) => {
            for (const handler of listeners.get(name) ?? []) handler(payload);
        },
        onItemOnItem: () => {},
        onItemAction: () => {},
        getCombatFactory: () => ({ fullDharoks: () => false }),
    };
    api.onCustomEvent('slayer:on-task', (request) => { request.onTask = onTask; });
    EquipmentEffects.register(api);
    SlayerHelmet.register(api);
    const apply = (kind, entity, value) => (modifiers[kind] ?? []).reduce((v, modifier) => modifier(entity, v), value);
    return { apply };
}

function npc(attributes) {
    const definition = { hasAttribute: (attribute) => attributes.includes(attribute) };
    return { isNpc: () => true, getAsNpc: () => ({ getCurrentDefinition: () => definition }) };
}

function player(worn, target) {
    const items = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
    for (const [slot, id] of Object.entries(worn)) items[slot] = { getId: () => id };
    const entity = {
        isPlayer: () => true,
        isNpc: () => false,
        getAsPlayer: () => entity,
        getEquipment: () => ({ getItems: () => items, get: (slot) => items[slot] }),
        getCombat: () => ({ getTarget: () => target }),
        getFightType: () => ({ getBonusType: () => 0 }),
    };
    return entity;
}

const SALVE_I = item('Salve amulet(i)');
const SALVE_EI = item('Salve amulet(ei)');
const SLAYER_HELM_I = item('Slayer helmet (i)');
const DHCB = item('Dragon hunter crossbow');
const DHL = item('Dragon hunter lance');
const SCORCHING_BOW = item('Scorching bow');
const ARCLIGHT = item('Arclight');
const TZHAAR_KET_OM = item('Tzhaar-ket-om');
const OBSIDIAN = [item('Obsidian helmet'), item('Obsidian platebody'), item('Obsidian platelegs')];
const BERSERKER_OR = item('Berserker necklace (or)');

test('salve amulet (i) boosts every style against undead only', () => {
    const { apply } = buildApi();
    const zombie = player({ [Equipment.AMULET_SLOT]: SALVE_I }, npc(['undead']));
    assert.equal(apply('meleeHit', zombie, 60), 70, '7/6');
    assert.equal(apply('rangedAccuracy', zombie, 60000), 70000);
    assert.equal(apply('magicAccuracy', zombie, 10000), 11500, '+15% magic accuracy');
    assert.equal(apply('magicDamageBonus', zombie, 100), 250, '+15% magic damage, in permille');

    const goblin = player({ [Equipment.AMULET_SLOT]: SALVE_I }, npc([]));
    assert.equal(apply('meleeHit', goblin, 60), 60);

    const ei = player({ [Equipment.AMULET_SLOT]: SALVE_EI }, npc(['undead']));
    assert.equal(apply('rangedHit', ei, 50), 60, '6/5');
});

test('a salve amulet wins over a slayer helmet on task', () => {
    const { apply } = buildApi({ onTask: true });
    const both = player(
        { [Equipment.AMULET_SLOT]: SALVE_I, [Equipment.HEAD_SLOT]: SLAYER_HELM_I },
        npc(['undead']),
    );
    assert.equal(apply('meleeHit', both, 60), 70, 'only the salve, not 7/6 twice');
    const helmOnly = player({ [Equipment.HEAD_SLOT]: SLAYER_HELM_I }, npc([]));
    assert.equal(apply('meleeHit', helmOnly, 60), 70);
    assert.equal(apply('rangedHit', helmOnly, 100), 115, '23/20');
});

test('dragon hunter crossbow damage adds to the imbued slayer helmet instead of multiplying', () => {
    const offTask = buildApi({ onTask: false });
    const shooter = player({ [Equipment.WEAPON_SLOT]: DHCB, [Equipment.HEAD_SLOT]: SLAYER_HELM_I }, npc(['dragon']));
    assert.equal(offTask.apply('rangedHit', shooter, 100), 125, '5/4 off task');
    assert.equal(offTask.apply('rangedAccuracy', shooter, 1000), 1300);

    const onTask = buildApi({ onTask: true });
    assert.equal(onTask.apply('rangedHit', shooter, 100), 140, '(23 + 5) / 20, not 115 * 5/4');

    const vsElvarg = player({ [Equipment.WEAPON_SLOT]: DHCB }, npc([]));
    assert.equal(offTask.apply('rangedHit', vsElvarg, 100), 100);
});

test('scorching bow: +30% against demons, its damage additive with the imbued slayer helmet', () => {
    const offTask = buildApi({ onTask: false });
    const archer = player({ [Equipment.WEAPON_SLOT]: SCORCHING_BOW, [Equipment.HEAD_SLOT]: SLAYER_HELM_I }, npc(['demon']));
    assert.equal(offTask.apply('rangedHit', archer, 100), 130, '+30% off task');
    assert.equal(offTask.apply('rangedAccuracy', archer, 1000), 1300);

    const onTask = buildApi({ onTask: true });
    assert.equal(onTask.apply('rangedHit', archer, 100), 145, '(23 + 6) / 20 (Wiki: 45%), not 115 * 1.3');

    const vsDragon = player({ [Equipment.WEAPON_SLOT]: SCORCHING_BOW }, npc(['dragon']));
    assert.equal(offTask.apply('rangedHit', vsDragon, 100), 100, 'nothing against a non-demon');
});

test('dragon hunter lance and Arclight', () => {
    const { apply } = buildApi();
    const lancer = player({ [Equipment.WEAPON_SLOT]: DHL }, npc(['dragon']));
    assert.equal(apply('meleeHit', lancer, 50), 60);
    const demonSlayer = player({ [Equipment.WEAPON_SLOT]: ARCLIGHT }, npc(['demon']));
    assert.equal(apply('meleeHit', demonSlayer, 30), 51, '+70%');
    assert.equal(apply('meleeAccuracy', demonSlayer, 1000), 1700);
});

test('obsidian set and berserker necklace (or) with a TzHaar weapon', () => {
    const { apply } = buildApi();
    const [helm, body, legs] = OBSIDIAN;
    const worn = {
        [Equipment.WEAPON_SLOT]: TZHAAR_KET_OM,
        [Equipment.HEAD_SLOT]: helm,
        [Equipment.BODY_SLOT]: body,
        [Equipment.LEG_SLOT]: legs,
        [Equipment.AMULET_SLOT]: BERSERKER_OR,
    };
    const fighter = player(worn, npc([]));
    assert.equal(apply('meleeAccuracy', fighter, 1000), 1100);
    assert.equal(apply('meleeHit', fighter, 40), 52, '(40 + 4) * 6/5');
    const necklaceOnly = player({ [Equipment.WEAPON_SLOT]: TZHAAR_KET_OM, [Equipment.AMULET_SLOT]: BERSERKER_OR }, npc([]));
    assert.equal(apply('meleeHit', necklaceOnly, 40), 48);
});

test('NPC definitions carry the Wiki monster attributes', () => {
    const { CachePipeline } = require('../dist/game/cache/CachePipeline');
    const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
    const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
    CachePipeline.initialize();
    new NpcDefinitionLoader().load();
    const vorkath = NpcDefinition.forId(8060);
    assert.ok(vorkath.hasAttribute('dragon') && vorkath.hasAttribute('undead'));
    assert.equal(NpcDefinition.forId(6349).hasAttribute('dragon'), false, 'Elvarg is not draconic');
    assert.ok(NpcDefinition.forId(2025).isDemon(), 'greater demon');
});
