const { Equipment } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { BonusManager } = require("../../../src/main/typescript/elvarg/game/model/equipment/BonusManager");
const { ItemIdentifiers } = require("../../../src/main/typescript/elvarg/util/ItemIdentifiers");

// Wiki (22 July 2026 update): crush accuracy and damage are boosted by 0.5%
// for the great helm and 1% each for the hauberk and plateskirt. The old
// "tripled with the mace" effect was removed with that update.
const CRUSH_BONUS_BY_SLOT = new Map([
    [Equipment.HEAD_SLOT, ItemIdentifiers.INQUISITORS_GREAT_HELM],
    [Equipment.BODY_SLOT, ItemIdentifiers.INQUISITORS_HAUBERK],
    [Equipment.LEG_SLOT, ItemIdentifiers.INQUISITORS_PLATESKIRT],
]);
const CRUSH_BONUS = new Map([
    [ItemIdentifiers.INQUISITORS_GREAT_HELM, 0.005],
    [ItemIdentifiers.INQUISITORS_HAUBERK, 0.01],
    [ItemIdentifiers.INQUISITORS_PLATESKIRT, 0.01],
]);

function crushBonus(player) {
    const items = player.getEquipment().getItems();
    let bonus = 0;
    for (const [slot, itemId] of CRUSH_BONUS_BY_SLOT) {
        if (items[slot]?.getId?.() === itemId) {
            bonus += CRUSH_BONUS.get(itemId);
        }
    }
    return bonus;
}

function usingCrush(entity) {
    return entity?.isPlayer?.()
        && entity.getAsPlayer().getFightType?.()?.getBonusType?.() === BonusManager.ATTACK_CRUSH;
}

function applyInquisitorsDamage(entity, baseHit) {
    if (!usingCrush(entity)) return baseHit;
    const bonus = crushBonus(entity.getAsPlayer());
    return bonus > 0 ? baseHit * (1 + bonus) : baseHit;
}

function applyInquisitorsAccuracy(entity, value) {
    if (!usingCrush(entity)) return value;
    const bonus = crushBonus(entity.getAsPlayer());
    return bonus > 0 ? value * (1 + bonus) : value;
}

module.exports = function registerInquisitorsArmourEffects(api) {
    api.registerMeleeHitModifier(applyInquisitorsDamage);
    api.registerMeleeAttackAccuracyModifier(applyInquisitorsAccuracy);
};
