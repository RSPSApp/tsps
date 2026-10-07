"use strict";

/**
 * The Gauntlet's weapons in combat (Wiki):
 * - crystal / corrupted halberd: a halberd that attacks every 4 ticks (not 7), reach 2;
 * - crystal / corrupted bow: no ammunition (the strength is on the bow), every 5 ticks, range 10;
 * - crystal / corrupted staff: a powered staff with a built-in spell, every 4 ticks, range 10,
 *   max hit 23 / 31 / 39 by tier regardless of level.
 *
 * The staff's cast is Near-Reality's: animation 1167, graphics 1719 / 1720 / 1721 (corrupted
 * 1722 / 1723 / 1724).
 */

const Shared = require("./GauntletShared");
const Items = require("./GauntletItems");

const HALBERDS = [...Items.MODES.regular.halberd, ...Items.MODES.corrupted.halberd];
const BOWS = [...Items.MODES.regular.bow, ...Items.MODES.corrupted.bow];
const STAFF_MAX_HITS = new Map([
  ...Items.MODES.regular.staff.map((id, tier) => [id, [23, 31, 39][tier]]),
  ...Items.MODES.corrupted.staff.map((id, tier) => [id, [23, 31, 39][tier]]),
]);
const CORRUPTED_STAFFS = new Set(Items.MODES.corrupted.staff);

const STAFF = {
  SPEED: 4,
  RANGE: 10,
  ANIMATION: 1167,
  GRAPHIC: { regular: { cast: 1719, travel: 1720, impact: 1721 }, corrupted: { cast: 1722, travel: 1723, impact: 1724 } },
  // Near-Reality's projectile: leaves after 23 client cycles, 10 more per tile.
  PROJECTILE: { DELAY: 23, LENGTH: 10, PER_TILE: 10, START_HEIGHT: 43, END_HEIGHT: 31 },
};

let StaffCombatMethod = null;
const spells = new WeakMap();

function weaponId(player) {
  return player.getEquipment().getItems()[Shared.core().Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
}

function travelCycles(from, to) {
  return STAFF.PROJECTILE.DELAY + STAFF.PROJECTILE.LENGTH + from.getLocation().getDistance(to.getLocation()) * STAFF.PROJECTILE.PER_TILE;
}

/** The staff's spell for a caster; its max hit and graphics follow the staff they hold. */
function spellFor(player) {
  let spell = spells.get(player);
  if (spell) return spell;
  const { CombatNormalSpell, Animation, Graphic, GraphicHeight, Projectile } = Shared.core();
  const graphics = () => STAFF.GRAPHIC[CORRUPTED_STAFFS.has(weaponId(player)) ? "corrupted" : "regular"];
  spell = new CombatNormalSpell({
    spellId: () => weaponId(player),
    maximumHit: () => STAFF_MAX_HITS.get(weaponId(player)) ?? 0,
    castAnimation: () => new Animation(STAFF.ANIMATION),
    startGraphic: () => new Graphic(graphics().cast, GraphicHeight.HIGH),
    castProjectile: (cast, castOn) => Projectile.createProjectile(cast, castOn, graphics().travel, STAFF.PROJECTILE.DELAY,
      travelCycles(cast, castOn), STAFF.PROJECTILE.START_HEIGHT, STAFF.PROJECTILE.END_HEIGHT),
    endGraphic: () => new Graphic(graphics().impact, GraphicHeight.MIDDLE),
    baseExperience: () => 0,
    levelRequired: () => 1,
  });
  spells.set(player, spell);
  return spell;
}

function staffMethod() {
  if (StaffCombatMethod) return StaffCombatMethod;
  const { MagicCombatMethod, PendingHit } = Shared.core();
  StaffCombatMethod = new (class extends MagicCombatMethod {
    canAttack(character) {
      const player = character.getAsPlayer();
      if (!STAFF_MAX_HITS.has(weaponId(player))) return false;
      // Its built-in spell is the only one it casts.
      player.getCombat().setCastSpell(spellFor(player));
      return true;
    }

    canPursue(character) {
      return STAFF_MAX_HITS.has(weaponId(character.getAsPlayer()));
    }

    hits(character, target) {
      const spell = spellFor(character.getAsPlayer());
      const delay = Math.max(1, Math.floor(travelCycles(character, target) / 30));
      const hit = new PendingHit(character, target, this, delay);
      spell.onHitCalc(hit);
      return [hit];
    }

    attackSpeed() {
      return STAFF.SPEED;
    }

    attackDistance() {
      return STAFF.RANGE;
    }

    /** Keeps casting, as a powered staff does. */
    finished(character) {
      const combat = character.getCombat();
      combat.setPreviousCast(spellFor(character.getAsPlayer()));
      combat.setCastSpell(null);
    }
  })();
  return StaffCombatMethod;
}

// ------------------------------------------------------------------ hooks

function resolveStaff(attacker) {
  if (!attacker?.isPlayer?.()) return null;
  return STAFF_MAX_HITS.has(weaponId(attacker.getAsPlayer())) ? staffMethod() : null;
}

function wieldsBow(player) {
  return BOWS.includes(weaponId(player));
}

/** The bows need no arrows and use none. */
const bowAmmo = {
  checkAmmo(player) {
    return wieldsBow(player) ? true : null;
  },
  decrementAmmo(player) {
    return wieldsBow(player);
  },
};

module.exports = function registerGauntletWeapons(api) {
  Shared.bind(api);
  api.registerWeaponProfile({ itemIds: HALBERDS, attackSpeed: 4, attackDistance: 2 });
  api.registerWeaponProfile({ itemIds: BOWS, attackSpeed: 5, attackDistance: 10, longRangeDistance: 10 });
  api.registerRangedAmmoHandler(bowAmmo);
  api.registerCombatMethodResolver({ resolve: resolveStaff });
};

module.exports.STAFF_MAX_HITS = STAFF_MAX_HITS;
module.exports.staffMethod = staffMethod;
