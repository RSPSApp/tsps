// Run after `yarn build`: node --test tests/spell-cast-animations.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

// Issue #733: Bind looked wrong because the unarmed cast played over a wielded staff.
test('combat spells cast their OSRS animation, and the staff variant while a staff is wielded', (t) => {
    const { CombatSpells } = require('../dist/game/content/combat/magic/CombatSpells');
    const castAnimation = (spell, staff) => {
        let played = -1;
        const caster = {
            isNpc: () => false, isPlayer: () => true,
            getAsPlayer: () => ({ getEquipment: () => ({ hasStaffEquipped: () => staff }) }),
            performAnimation: (animation) => { played = animation.getId(); },
            performGraphic: () => {},
        };
        t.mock.method(spell, 'castProjectile', () => null);
        spell.startCast(caster, {});
        return played;
    };
    const expected = {
        BIND: [710, 1161], SNARE: [710, 1161], ENTANGLE: [710, 1161],
        WIND_STRIKE: [711, 1162], FIRE_BLAST: [711, 1162], CONFUSE: [716, 1163], WEAKEN: [717, 1164],
        CURSE: [718, 1165], VULNERABILITY: [718, 1165], CRUMBLE_UNDEAD: [724, 1166], FIRE_WAVE: [727, 1167],
        ENFEEBLE: [728, 1168], STUN: [729, 1169], TELEBLOCK: [1819, 1820], FIRE_SURGE: [7855, 7855],
    };
    for (const [name, [unarmed, staffed]] of Object.entries(expected)) {
        assert.equal(castAnimation(CombatSpells[name], false), unarmed, `${name} unarmed`);
        assert.equal(castAnimation(CombatSpells[name], true), staffed, `${name} with a staff`);
        // Casts outside combat (the POH elemental balance) pick the same animation.
        const wielder = { isPlayer: () => true, getAsPlayer: () => ({ getEquipment: () => ({ hasStaffEquipped: () => true }) }) };
        assert.equal(CombatSpells[name].castAnimationFor(wielder).getId(), staffed, `${name} castAnimationFor`);
    }
});
