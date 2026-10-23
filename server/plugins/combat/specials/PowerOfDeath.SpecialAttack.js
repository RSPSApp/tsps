/**
 * Power of Death (https://oldschool.runescape.wiki/w/Staff_of_the_dead): 100% special energy halves
 * the damage of all melee hits against the user for one minute. Shared by the staff of the dead,
 * staff of light, staff of balance and toxic staff of the dead. The effect outlives unequipping the
 * staff but ends the moment the user takes damage without one, and a Rejuvenation pool clears it.
 * Recasting while active only restarts the minute; it does not stack with itself.
 */
const POWER_OF_DEATH_ATTRIBUTE = "power-of-death:until";
const DURATION_MS = 60 * 1000;
const DRAIN = 100;
const MESSAGE = "Spirits of deceased evildoers offer you their protection.";

let core = null;
const staffIds = new Set();
const hookedApis = new WeakSet();

function isActive(player) {
  return Number(player.getAttribute(POWER_OF_DEATH_ATTRIBUTE) ?? 0) > Date.now();
}

function clearPowerOfDeath(player) {
  player.setAttribute(POWER_OF_DEATH_ATTRIBUTE, null);
}

function halveMeleeDamage(entity, hitDamage, context = {}) {
  if (!entity?.isPlayer?.() || !(hitDamage?.getDamage?.() > 0)) {
    return;
  }
  const player = entity.getAsPlayer();
  if (!isActive(player)) {
    return;
  }
  const weaponId = player.getEquipment().get(core.Equipment.WEAPON_SLOT)?.getId?.();
  if (!staffIds.has(weaponId)) {
    clearPowerOfDeath(player);
    return;
  }
  if (context.type === core.CombatType.MELEE) {
    hitDamage.setDamage(Math.floor(hitDamage.getDamage() / 2));
  }
}

function clearOnRejuvenation({ player }) {
  clearPowerOfDeath(player);
}

/** Registers one staff's Power of Death; the first call also hooks the shared damage and pool events. */
module.exports = function registerPowerOfDeath(api, { id, itemId, animation, graphic }) {
  const { Animation, CombatMethod, CombatSpecial, CombatType, Graphic } = api.core;
  if (!hookedApis.has(api)) {
    hookedApis.add(api);
    core = api.core;
    api.registerIncomingDamageModifier(halveMeleeDamage);
    api.onCustomEvent("rejuvenation-pool:restored", clearOnRejuvenation);
  }
  staffIds.add(itemId);

  class PowerOfDeathCombatMethod extends CombatMethod {
    hits() {
      return null;
    }

    type() {
      return CombatType.MAGIC;
    }

    start(character) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(new Animation(animation));
      character.performGraphic(new Graphic(graphic));
      character.setAttribute(POWER_OF_DEATH_ATTRIBUTE, Date.now() + DURATION_MS);
      character.getAsPlayer().sendMessage(MESSAGE);
    }
  }

  api.registerCombatSpecial({
    id,
    itemIds: [itemId],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    combatMethod: new PowerOfDeathCombatMethod(),
  });
};

module.exports.POWER_OF_DEATH_ATTRIBUTE = POWER_OF_DEATH_ATTRIBUTE;
