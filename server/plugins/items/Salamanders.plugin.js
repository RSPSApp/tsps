/**
 * Salamanders (OSRS Wiki: Salamander, Swamp lizard, Orange/Red/Black salamander): one weapon,
 * three styles. Every style burns one compatible tar. Scorch is slash, Flare ranged, Blaze magic
 * whose max hit is floor(0.5 + Magic * (64 + hidden bonus) / 640). The style buttons, speed and
 * reach come from the SALAMANDER interface and its WeaponProfile; this plugin picks the combat
 * method for the selected style and the Blaze spell.
 */
const BLAZE_MAGIC_BONUS_BY_ITEM = {
  SWAMP_LIZARD: 56,
  ORANGE_SALAMANDER: 59,
  RED_SALAMANDER: 77,
  BLACK_SALAMANDER: 92,
};
const TAR_PER_ATTACK = 1;
const ATTACK_GRAPHIC = 952; // cache: firebreath; rsprox 1607
const ATTACK_GRAPHIC_SLOT = 1;
const ATTACK_GRAPHIC_HEIGHT = 104;
const SCORCH_SOUND = 738;
const FLARE_SOUND = 736;
const BLAZE_SOUND = 740;
const ATTACK_SLASH = 1; // BonusManager.ATTACK_SLASH, the Scorch style's attack type
const ATTACK_MAGIC = 3; // BonusManager.ATTACK_MAGIC, the Blaze style's attack type
const BLAZE_ATTACK_RANGE = 1;
const BLAZE_SPELL_LEVEL = 1; // the wield requirement (Attack/Ranged/Magic) is the real gate

let core = null;
const TARS = ["GUAM_TAR", "MARRENTILL_TAR", "TARROMIN_TAR", "HARRALANDER_TAR"];
let BlazeCombatMethod = null;
let scorchCombatMethod = null;
let flareCombatMethod = null;
const blazeSpells = new WeakMap();

function weaponOf(player) {
  return player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
}

function hiddenBonus(player) {
  const id = Number(weaponOf(player)?.getId?.() ?? -1);
  return Object.entries(BLAZE_MAGIC_BONUS_BY_ITEM).find(([name]) => core.ItemIdentifiers[name] === id)?.[1];
}

/** Wiki: Hitmax = floor(0.5 + Magic * (64 + Bonus) / 640), Magic being the visible level. */
function blazeBaseMaxHit(magicLevel, bonus) {
  return Math.floor(0.5 + (magicLevel * (64 + bonus)) / 640);
}

function blazeSpell(player) {
  let spell = blazeSpells.get(player);
  if (spell) return spell;
  spell = new core.CombatNormalSpell({
    spellId: () => weaponOf(player).getId(),
    maximumHit: () =>
      blazeBaseMaxHit(player.getSkillManager().getCurrentLevel(core.Skill.MAGIC), hiddenBonus(player) ?? 0),
    castAnimation: () => core.Animation.DEFAULT_RESET_ANIMATION,
    startGraphic: () => undefined,
    castProjectile: () => undefined,
    endGraphic: () => undefined,
    baseExperience: () => 0,
    levelRequired: () => BLAZE_SPELL_LEVEL,
  });
  blazeSpells.set(player, spell);
  return spell;
}

function blazeMethod() {
  if (BlazeCombatMethod) return BlazeCombatMethod;
  const { MagicCombatMethod, PendingHit } = core;
  BlazeCombatMethod = new (class extends MagicCombatMethod {
    canAttack(character) {
      const player = character.getAsPlayer();
      if (hiddenBonus(player) === undefined || !hasTar(player)) return false;
      player.getCombat().setCastSpell(blazeSpell(player));
      return true;
    }

    canPursue(character) {
      return hiddenBonus(character.getAsPlayer()) !== undefined;
    }

    start(character, target) {
      super.start(character, target);
      playFlame(character, BLAZE_SOUND);
      decrementAmmo(character.getAsPlayer(), target.getLocation(), 1);
    }

    hits(character, target) {
      const spell = blazeSpell(character.getAsPlayer());
      const hit = new PendingHit(character, target, this, 0).setSpell(spell);
      spell.onHitCalc(hit);
      return [hit];
    }

    attackSpeed(character) {
      return character.getBaseAttackSpeed();
    }

    attackDistance() {
      return BLAZE_ATTACK_RANGE;
    }

    // Wiki: Blaze pays 2 Magic XP per damage and nothing to Defence, though it is a Defensive style.
    splitsDefensiveMagicExperience() {
      return false;
    }

    finished(character) {
      const combat = character.getCombat();
      combat.setPreviousCast(blazeSpell(character.getAsPlayer()));
      combat.setCastSpell(null);
    }
  })();
  return BlazeCombatMethod;
}

function resolveSalamander(attacker) {
  if (!attacker?.isPlayer?.()) return null;
  const player = attacker.getAsPlayer();
  if (hiddenBonus(player) === undefined) return null;
  const attackType = player.getFightType().getBonusType();
  if (attackType === ATTACK_SLASH) return scorchMethod();
  if (attackType === ATTACK_MAGIC) return blazeMethod();
  return flareMethod();
}

function hasTar(player, silent = false) {
  const expected = core.RangedWeapon.getFor(player)?.getAmmunitionData()[0];
  const ammo = player.getEquipment().get(core.Equipment.AMMUNITION_SLOT);
  if (ammo?.getAmount?.() > 0 && core.Ammunition.getForItem(ammo.getId()) === expected) return true;
  if (!silent) player.sendMessage("Your salamander needs its matching herb tar.");
  return false;
}

function playFlame(character, soundId) {
  character.performGraphicInSlot(ATTACK_GRAPHIC_SLOT, new core.Graphic(ATTACK_GRAPHIC, 0, ATTACK_GRAPHIC_HEIGHT));
  core.Sounds.sendSound(character, new core.Sound(soundId, 1, 0, 1));
}

function scorchMethod() {
  if (scorchCombatMethod) return scorchCombatMethod;
  scorchCombatMethod = new (class extends core.MeleeCombatMethod {
    canAttack(character) { return hasTar(character.getAsPlayer()); }
    canPursue(character) { return hasTar(character.getAsPlayer(), true); }
    start(character, target) {
      character.performAnimation(new core.Animation(character.getAttackAnim(target)));
      playFlame(character, SCORCH_SOUND);
      decrementAmmo(character.getAsPlayer(), target.getLocation(), 1);
    }
  })();
  return scorchCombatMethod;
}

function flareMethod() {
  if (flareCombatMethod) return flareCombatMethod;
  flareCombatMethod = new (class extends core.RangedCombatMethod {
    start(character, target) {
      character.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
      playFlame(character, FLARE_SOUND);
      decrementAmmo(character.getAsPlayer(), target.getLocation(), 1);
    }
    hits(character, target) { return [new core.PendingHit(character, target, this, 0)]; }
  })();
  return flareCombatMethod;
}

function checkAmmo(player, _amount, silent) {
  return hiddenBonus(player) === undefined ? null : hasTar(player, silent);
}

/** Every style burns its tar: no 20% break, nothing left on the floor, one per attack. */
function decrementAmmo(player, _position, amount) {
  if (hiddenBonus(player) === undefined) return false;
  const slot = core.Equipment.AMMUNITION_SLOT;
  const tar = player.getEquipment().get(slot);
  if (!TARS.some((name) => core.ItemIdentifiers[name] === Number(tar?.getId?.() ?? -1))) return false;
  tar.decrementAmountBy(Math.min(tar.getAmount(), amount * TAR_PER_ATTACK));
  if (tar.getAmount() <= 0) {
    player.sendMessage("You have run out of ammunition!");
    player.getEquipment().set(slot, new core.Item(-1));
  }
  player.getEquipment().refreshItems();
  return true;
}

module.exports = {
  name: "Salamanders",
  members: true,
  _test: { blazeBaseMaxHit, resolveSalamander, decrementAmmo, blazeSpell, BLAZE_MAGIC_BONUS_BY_ITEM },
  register(api) {
    core = api.core;
    api.registerCombatMethodResolver({ resolve: resolveSalamander });
    api.registerRangedAmmoHandler({ checkAmmo, decrementAmmo });
  },
};
