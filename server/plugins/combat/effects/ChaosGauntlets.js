const { Equipment } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../../../src/main/typescript/elvarg/util/ItemIdentifiers");

// Wiki: chaos gauntlets increase the maximum hit of bolt spells by 3.
// Spell ids come from CombatSpells (Wind 1572, Water 1163, Earth 1166, Fire 1169).
const BOLT_SPELL_IDS = new Set([1572, 1163, 1166, 1169]);
const BONUS_MAX_HIT = 3;

function applyChaosGauntlets(entity, baseHit) {
    if (!entity?.isPlayer?.()) return baseHit;
    const player = entity.getAsPlayer();
    if (player.getEquipment().getItems()[Equipment.HANDS_SLOT]?.getId?.() !== ItemIdentifiers.CHAOS_GAUNTLETS) {
        return baseHit;
    }
    const combat = player.getCombat();
    const spell = combat?.getCastSpell?.() ?? combat?.getSelectedSpell?.() ?? combat?.getPreviousCast?.();
    if (!BOLT_SPELL_IDS.has(spell?.spellId?.())) {
        return baseHit;
    }
    return baseHit + BONUS_MAX_HIT;
}

module.exports = function registerChaosGauntletsEffects(api) {
    api.registerMagicHitModifier(applyChaosGauntlets);
};
