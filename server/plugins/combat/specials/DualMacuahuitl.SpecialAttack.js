// Dual macuahuitl: ordinary sequential accuracy, Blood Infusion, and the Bloodrager set.
let core;
let ordinary;
const swings = new WeakMap();
let building = null;

const DRAIN = 25;
const SELF_DAMAGE_FRACTION = 0.25;

function weaponIds() {
  const { ItemIdentifiers: ids } = core;
  return [ids.DUAL_MACUAHUITL, ids.DUAL_MACUAHUITL_4];
}

function hasFullBloodMoonArmour(player) {
  const { Equipment, ItemIdentifiers: ids } = core;
  const items = player.getEquipment().getItems();
  return [ids.BLOOD_MOON_HELM, ids.BLOOD_MOON_HELM_4, ids.BLOOD_MOON_HELM_BROKEN_, ids.BLOOD_MOON_HELM_6]
    .includes(items[Equipment.HEAD_SLOT].getId())
    && [ids.BLOOD_MOON_CHESTPLATE, ids.BLOOD_MOON_CHESTPLATE_4, ids.BLOOD_MOON_CHESTPLATE_BROKEN_, ids.BLOOD_MOON_CHESTPLATE_6]
      .includes(items[Equipment.BODY_SLOT].getId())
    && [ids.BLOOD_MOON_TASSETS, ids.BLOOD_MOON_TASSETS_4, ids.BLOOD_MOON_TASSETS_BROKEN_, ids.BLOOD_MOON_TASSETS_6]
      .includes(items[Equipment.LEG_SLOT].getId());
}

function usingWeapon(player) {
  return weaponIds().includes(player.getEquipment().get(core.Equipment.WEAPON_SLOT).getId());
}

// Keep event objects, not early copies of accuracy: subsequent damage hooks may change them.
function collectHitDamage(event) {
  if (building && event.attacker === building.attacker && event.target === building.target
      && event.hit?.getCombatMethod?.() === building.method) building.events.push(event);
}

function hits(character, target, method, special) {
  const { CombatFactory, PendingHit } = core;
  const current = swings.get(character);
  const context = { attacker: character, target, method, events: [] };
  const previous = building;
  building = context;
  let hit;
  try {
    // A cannon can prime the per-cycle normal accuracy roll before this special.
    // Bound the special's synchronous rolls so neither value crosses this swing.
    if (special) CombatFactory.clearHitRollCache(character);
    // NPC spacing is documented; PvP uses the general equipment-page wording as a
    // qualified project inference pending a player-target capture.
    hit = new PendingHit(character, target, method, {
      hitAmount: 2, hitDelays: [0, 1], hitMaximumSplitCount: 2,
      requireFirstAccurate: !special,
    });
  } finally {
    if (special) CombatFactory.clearHitRollCache(character);
    building = previous;
  }
  // Synchronous hooks may construct other hits before this constructor returns.
  if (current && current.target === target && current.method === method) {
    current.events = context.events.filter(event => event.hit === hit);
    current.hit = hit;
  }
  return [hit];
}

function attackStarted({ attacker, target, method }) {
  if (!attacker?.isPlayer?.()) return;
  const player = attacker.getAsPlayer();
  if (!usingWeapon(player)) {
    swings.delete(attacker); // A newer, different swing cannot inherit this weapon's proc.
    return;
  }
  swings.set(attacker, {
    target, method, fullSet: hasFullBloodMoonArmour(player),
    special: player.isSpecialActivated(), events: null, hit: null,
  });
}

function attackFinished({ attacker, target, method }) {
  const swing = swings.get(attacker);
  if (!swing || swing.target !== target || swing.method !== method || !swing.fullSet || !swing.events || !swing.hit) return;
  const events = swing.events;
  swing.events = null; // One proc per actual launched swing.
  if (!target.getCombat().getHitQueue().hasPendingHit(swing.hit)) return;
  let activate = false;
  for (const event of events) {
    if (event.accurate && (swing.special || Math.floor(Math.random() * 100) <= 32)) activate = true;
  }
  if (!activate) return;
  const combat = attacker.getCombat();
  const remaining = combat.getAttackDelay();
  if (remaining > 0) combat.setAttackDelay(remaining - 1);
}

function playerLogout({ player }) {
  swings.delete(player);
}

function resolveOrdinary(attacker) {
  if (!attacker?.isPlayer?.()) return null;
  const player = attacker.getAsPlayer();
  if (player.isSpecialActivated() || core.Autocasting.isActive(player) || !usingWeapon(player)) return null;
  ordinary ??= new (class extends core.MeleeCombatMethod {
    hits(character, target) { return hits(character, target, this, false); }
  })();
  return ordinary;
}

function buildSpecial() {
  const { CombatSpecial, Graphic, MeleeCombatMethod } = core;
  const specialVfx = new Graphic(2792);
  class DualMacuahuitlCombatMethod extends MeleeCombatMethod {
    canAttack(character, target) {
      return character.isPlayer() && hasFullBloodMoonArmour(character.getAsPlayer());
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performGraphic(specialVfx);
      if (!character.isPlayer()) return;
      const player = character.getAsPlayer();
      const selfDamage = Math.floor(player.getHitpoints() * SELF_DAMAGE_FRACTION);
      if (selfDamage > 0) player.setHitpoints(player.getHitpoints() - selfDamage);
    }

    hits(character, target) { return hits(character, target, this, true); }
  }

  return {
    id: "dual_macuahuitl",
    itemIds: weaponIds(),
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 2,
      hitDelayTicks: [0, 1],
      accuracyMultiplier: 1.25,
      damageMultiplier: 1.25,
    },
    combatMethod: new DualMacuahuitlCombatMethod(),
  };
}

module.exports = function registerDualMacuahuitlSpecialAttack(api) {
  core = api.core;
  api.onCombatHitDamage(collectHitDamage);
  api.onCustomEvent("combat:attack-started", attackStarted);
  api.onCustomEvent("combat:attack-finished", attackFinished);
  api.onPlayerLogout(playerLogout);
  api.registerCombatMethodResolver({ resolve: resolveOrdinary });
  api.registerCombatSpecial(buildSpecial());
};
