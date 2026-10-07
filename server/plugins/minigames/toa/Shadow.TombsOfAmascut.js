"use strict";

/**
 * Tumeken's shadow in combat. Wiki: a powered staff with a built-in spell that can't cast
 * others: max hit floor(Magic / 3) + 1, an attack every 5 ticks from 8 tiles (10 on Longrange),
 * one charge a cast. Its styles are the powered staff's (cache weapon category 24). Its passive triples the magic attack and magic damage bonuses of the worn gear
 * (damage capped at 100%), quadruples them inside the Tombs of Amascut, and it can't be used
 * against other players. Casting gives the usual damage-based Magic experience.
 *
 * The cast is OpenRune's: TOA_SOT_CAST_B (9493) with TUMEKENS_SHADOW_CASTING / _TRAVEL /
 * _IMPACT (2125-2127). Charging lives in Items.TombsOfAmascut.js.
 */

const Shared = require("./ToaShared");
const Items = require("./Items.TombsOfAmascut");

const ANIMATION_CAST = 9493;
const GRAPHIC = { CASTING: 2125, TRAVEL: 2126, IMPACT: 2127 };
const ATTACK_SPEED = 5;
const ATTACK_RANGE = 8;
const LONGRANGE_EXTRA = 2;
const MAX_MAGIC_DAMAGE = 100;
// The projectile (OpenRune's tumekens_shadow projanim, heights a quarter of theirs): it leaves
// after 56 client cycles and takes 16 more plus 10 a tile.
const PROJECTILE = { DELAY: 56, LENGTH: 16, PER_TILE: 10, START_HEIGHT: 62, END_HEIGHT: 31 };

const MAGIC_ATTACK = 3; // BonusManager.ATTACK_MAGIC
const MAGIC_DAMAGE = 12; // BonusManager.MAGIC_STRENGTH among the "other" bonuses

let ShadowCombatMethod = null;
/** Each caster's built-in spell: its max hit reads their Magic level. */
const spells = new WeakMap();

function ids() {
  return Shared.core().ItemIdentifiers;
}

function weaponOf(player) {
  return player.getEquipment().getItems()[Shared.core().Equipment.WEAPON_SLOT] ?? null;
}

function wieldsShadow(player, chargedOnly = false) {
  const id = weaponOf(player)?.getId?.();
  const I = ids();
  return id === I.TUMEKENS_SHADOW || (!chargedOnly && id === I.TUMEKENS_SHADOW_UNCHARGED_);
}

function chargesOf(item) {
  return Math.max(0, Number(item?.getMetaValue?.(Items.SHADOW_CHARGES_KEY)) || 0);
}

function travelCycles(from, to) {
  return PROJECTILE.DELAY + PROJECTILE.LENGTH + from.getLocation().getDistance(to.getLocation()) * PROJECTILE.PER_TILE;
}

function spellFor(player) {
  let spell = spells.get(player);
  if (spell) return spell;
  const { CombatNormalSpell, Animation, Graphic, GraphicHeight, Projectile, Skill } = Shared.core();
  spell = new CombatNormalSpell({
    spellId: () => ids().TUMEKENS_SHADOW,
    maximumHit: () => Math.floor(player.getSkillManager().getCurrentLevel(Skill.MAGIC) / 3) + 1,
    castAnimation: () => new Animation(ANIMATION_CAST),
    startGraphic: () => new Graphic(GRAPHIC.CASTING),
    castProjectile: (cast, castOn) => Projectile.createProjectile(cast, castOn, GRAPHIC.TRAVEL, PROJECTILE.DELAY,
      travelCycles(cast, castOn), PROJECTILE.START_HEIGHT, PROJECTILE.END_HEIGHT),
    endGraphic: () => new Graphic(GRAPHIC.IMPACT, GraphicHeight.HIGH),
    baseExperience: () => 0,
    levelRequired: () => 1,
  });
  spells.set(player, spell);
  return spell;
}

/** Takes a charge; an emptied staff becomes the uncharged one. */
function useCharge(player) {
  const { Flag } = Shared.core();
  const staff = weaponOf(player);
  const left = chargesOf(staff) - 1;
  staff.setMetaValue(Items.SHADOW_CHARGES_KEY, Math.max(0, left));
  if (left > 0) return;
  staff.setId(ids().TUMEKENS_SHADOW_UNCHARGED_);
  player.getEquipment().refreshItems();
  player.getUpdateFlag().flag(Flag.APPEARANCE);
  Shared.api().getBonusManager().update(player);
  player.sendMessage("Your Tumeken's shadow has run out of charges.");
}

function shadowMethod() {
  if (ShadowCombatMethod) return ShadowCombatMethod;
  const { MagicCombatMethod, PendingHit } = Shared.core();

  ShadowCombatMethod = new (class extends MagicCombatMethod {
    canAttack(character, target) {
      const player = character.getAsPlayer();
      if (target?.isPlayer?.()) {
        player.sendMessage("You can't use Tumeken's shadow against other players.");
        player.getCombat().reset();
        return false;
      }
      if (!wieldsShadow(player, true) || chargesOf(weaponOf(player)) <= 0) {
        player.sendMessage("Tumeken's shadow has no charges! You need to charge it with soul runes and chaos runes.");
        player.getCombat().reset();
        return false;
      }
      // Its built-in spell is the only one it casts, whatever is selected or autocast.
      player.getCombat().setCastSpell(spellFor(player));
      // The passive's multiplier depends on being in the tombs; refresh it for this cast.
      Shared.api().getBonusManager().update(player);
      useCharge(player);
      return true;
    }

    canPursue(character) {
      const player = character.getAsPlayer();
      return wieldsShadow(player, true) && chargesOf(weaponOf(player)) > 0;
    }

    hits(character, target) {
      const spell = spellFor(character.getAsPlayer());
      // The hit lands as the slow projectile arrives.
      const delay = Math.max(1, Math.floor(travelCycles(character, target) / 30));
      const hit = new PendingHit(character, target, this, delay);
      spell.onHitCalc(hit);
      return [hit];
    }

    attackSpeed() {
      return ATTACK_SPEED;
    }

    attackDistance(character) {
      const { FightStyle } = Shared.core();
      // Longrange is the powered staff's defensive style.
      return ATTACK_RANGE + (character.getFightType?.()?.getStyle?.() === FightStyle.DEFENSIVE ? LONGRANGE_EXTRA : 0);
    }

    /** Keeps attacking: the staff casts on its own, unlike a single manual cast. */
    finished(character) {
      const combat = character.getCombat();
      combat.setPreviousCast(spellFor(character.getAsPlayer()));
      combat.setCastSpell(null);
    }
  })();
  return ShadowCombatMethod;
}

// ------------------------------------------------------------------ hooks

function resolveShadow(attacker) {
  if (!attacker?.isPlayer?.()) return null;
  return wieldsShadow(attacker.getAsPlayer()) ? shadowMethod() : null;
}

/** The passive: worn magic attack and damage x3 (x4 in the tombs), damage capped at 100%. */
function shadowBonuses({ player, bonuses }) {
  if (!wieldsShadow(player, true)) return;
  const multiplier = Shared.inTombs(player.getLocation()) ? 4 : 3;
  bonuses[MAGIC_ATTACK] *= multiplier;
  bonuses[MAGIC_DAMAGE] = Math.min(MAX_MAGIC_DAMAGE, bonuses[MAGIC_DAMAGE] * multiplier);
}

module.exports = function registerTumekensShadow(api) {
  Shared.bind(api);
  api.registerCombatMethodResolver({ resolve: resolveShadow });
  api.registerBonusProvider({ apply: shadowBonuses });
};
