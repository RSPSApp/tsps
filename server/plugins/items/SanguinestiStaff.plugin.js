/**
 * Sanguinesti staff (https://oldschool.runescape.wiki/w/Sanguinesti_staff).
 *
 * A powered staff with a built-in spell: max hit floor(Magic / 3), never below 6
 * (33 at 99 Magic), 4-tick attack speed, 7 tiles (9 on Longrange), one charge a
 * cast. It is charged with blood runes, two runes a charge, up to 20,000, and
 * uncharging returns every rune. A successful hit has a 1/5 chance to deal 8
 * extra damage and heal the caster for half the damage dealt. Uncharged, it
 * cannot cast. Charging, checking and uncharging mirror Tumeken's shadow
 * (plugins/minigames/toa/Items.TombsOfAmascut.js); the cast reuses the trident
 * of the swamp's animations and graphics, which the Wiki does not specify.
 */
const MAX_CHARGES = 20000;
const BLOOD_RUNES_PER_CHARGE = 2;
const CHARGES_META_KEY = "sanguinesti-staff-charges";
const HEAL_CHANCE = 1 / 5;
const LIFE_LEECH_DAMAGE = 8;
const MIN_BASE_MAX_HIT = 6;
const ATTACK_SPEED = 4;
const ATTACK_RANGE = 7;
const LONGRANGE_EXTRA = 2;
const CAST_ANIMATION = 1167;
const CAST_GRAPHIC = { START: 665, PROJECTILE: 1040, END: 1042 };

let core = null;
let chargedIds = new Set();
let unchargedByCharged = new Map();
let chargedByUncharged = new Map();
let SangCombatMethod = null;
/** Each caster's built-in spell: its max hit reads their Magic level. */
const spells = new WeakMap();
/** Hits whose life leech proc already rolled, to heal when they land. */
const proccedHits = new WeakSet();

function ids() {
  return core.ItemIdentifiers;
}

function weaponOf(player) {
  return player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT] ?? null;
}

function isStaffId(id) {
  const value = Number(id);
  return chargedIds.has(value) || chargedByUncharged.has(value);
}

function wieldsStaff(player, chargedOnly = false) {
  const id = Number(weaponOf(player)?.getId?.() ?? -1);
  return chargedIds.has(id) || (!chargedOnly && chargedByUncharged.has(id));
}

function chargesOf(item) {
  return Math.max(0, Math.min(MAX_CHARGES, Math.floor(Number(item?.getMetaValue?.(CHARGES_META_KEY)) || 0)));
}

function baseMaxHit(player) {
  return Math.max(MIN_BASE_MAX_HIT, Math.floor(player.getSkillManager().getCurrentLevel(core.Skill.MAGIC) / 3));
}

function spellFor(player) {
  let spell = spells.get(player);
  if (spell) return spell;
  const { CombatNormalSpell, Animation, Graphic, GraphicHeight, Projectile } = core;
  spell = new CombatNormalSpell({
    spellId: () => ids().SANGUINESTI_STAFF,
    maximumHit: () => baseMaxHit(player),
    castAnimation: () => new Animation(CAST_ANIMATION),
    startGraphic: () => new Graphic(CAST_GRAPHIC.START, GraphicHeight.HIGH),
    castProjectile: (cast, castOn) =>
      Projectile.createProjectile(cast, castOn, CAST_GRAPHIC.PROJECTILE, 0, 20, 43, 31),
    endGraphic: () => new Graphic(CAST_GRAPHIC.END),
    baseExperience: () => 0,
    levelRequired: () => 1,
  });
  spells.set(player, spell);
  return spell;
}

/** Wiki: a successful hit has a 1/5 chance to deal 8 more; the heal lands with the hit. */
function applyLifeLeech(hit) {
  if (!hit?.isAccurate?.() || Math.random() >= HEAL_CHANCE) {
    return false;
  }
  hit.setTotalDamage?.(Number(hit.getTotalDamage?.() ?? 0) + LIFE_LEECH_DAMAGE);
  proccedHits.add(hit);
  return true;
}

function onHitResolved({ attacker, hit }) {
  if (!attacker?.isPlayer?.() || !hit || !proccedHits.has(hit)) {
    return;
  }
  proccedHits.delete(hit);
  attacker.heal?.(Math.floor(Number(hit.getTotalDamage?.() ?? 0) / 2));
}

/** Takes a charge; an emptied staff becomes the uncharged one. */
function useCharge(player) {
  const { Flag } = core;
  const staff = weaponOf(player);
  const left = chargesOf(staff) - 1;
  staff.setMetaValue(CHARGES_META_KEY, Math.max(0, left));
  if (left > 0) return;
  staff.setId(unchargedByCharged.get(staff.getId()));
  player.getEquipment().refreshItems();
  player.getUpdateFlag().flag(Flag.APPEARANCE);
  player.sendMessage("Your Sanguinesti staff has run out of charges.");
}

function sangMethod() {
  if (SangCombatMethod) return SangCombatMethod;
  const { MagicCombatMethod, PendingHit } = core;

  SangCombatMethod = new (class extends MagicCombatMethod {
    canAttack(character, target) {
      const player = character.getAsPlayer();
      if (!wieldsStaff(player, true) || chargesOf(weaponOf(player)) <= 0) {
        player.sendMessage("Your Sanguinesti staff has no charges! You need to charge it with blood runes.");
        player.getCombat().reset();
        return false;
      }
      // Its built-in spell is the only one it casts, whatever is selected or autocast.
      player.getCombat().setCastSpell(spellFor(player));
      useCharge(player);
      return true;
    }

    canPursue(character) {
      const player = character.getAsPlayer();
      return wieldsStaff(player, true) && chargesOf(weaponOf(player)) > 0;
    }

    hits(character, target) {
      const spell = spellFor(character.getAsPlayer());
      // Wiki (Hit delay): powered staves land as spells do, by distance.
      const hit = new PendingHit(character, target, this, MagicCombatMethod.hitDelay(character, target, spell));
      spell.onHitCalc(hit);
      applyLifeLeech(hit);
      return [hit];
    }

    attackSpeed() {
      return ATTACK_SPEED;
    }

    attackDistance(character) {
      const { FightStyle } = core;
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
  return SangCombatMethod;
}

function resolveSang(attacker) {
  if (!attacker?.isPlayer?.()) return null;
  return wieldsStaff(attacker.getAsPlayer()) ? sangMethod() : null;
}

function setCharges(player, staff, value) {
  const clamped = Math.max(0, Math.min(MAX_CHARGES, Math.floor(value)));
  staff.setMetaValue(CHARGES_META_KEY, clamped);
  if (clamped > 0) {
    staff.setId(chargedByUncharged.get(staff.getId()) ?? staff.getId());
  } else {
    staff.setId(unchargedByCharged.get(staff.getId()) ?? staff.getId());
  }
  player.getInventory().refreshItems();
}

/** Two blood runes a charge, as many as the inventory affords (Wiki). */
function chargeStaff(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const staff = isStaffId(usedItemId) ? usedItem : isStaffId(usedWithItemId) ? usedWithItem : null;
  if (!staff) {
    return;
  }
  const otherId = Number(staff === usedItem ? usedWithItemId : usedItemId);
  if (otherId !== ids().BLOOD_RUNE) {
    return;
  }
  const inventory = player.getInventory();
  const current = chargesOf(staff);
  if (current >= MAX_CHARGES) {
    player.sendMessage("Your Sanguinesti staff is already fully charged.");
    event.handled = true;
    return;
  }
  const affordable = Math.min(
    Math.floor(inventory.getAmount(ids().BLOOD_RUNE) / BLOOD_RUNES_PER_CHARGE),
    MAX_CHARGES - current,
  );
  if (affordable < 1) {
    player.sendMessage("You need two blood runes for each charge.");
    event.handled = true;
    return;
  }
  inventory.deleteNumber(ids().BLOOD_RUNE, affordable * BLOOD_RUNES_PER_CHARGE);
  setCharges(player, staff, current + affordable);
  player.sendMessage(`You apply ${affordable.toLocaleString()} charge${affordable === 1 ? "" : "s"} to your Sanguinesti staff.`);
  event.handled = true;
}

function checkCharges({ player, item }) {
  player.sendMessage(`Your Sanguinesti staff has ${chargesOf(item).toLocaleString("en-US")} charges left.`);
  return true;
}

/** Wiki: uncharging returns every blood rune spent. */
function uncharge({ player, item }) {
  const { Item } = core;
  const charges = chargesOf(item);
  if (charges <= 0) {
    player.sendMessage("Your Sanguinesti staff has no charges to remove.");
    return true;
  }
  const inventory = player.getInventory();
  const runeId = ids().BLOOD_RUNE;
  const needed = inventory.contains(runeId) ? 0 : 1;
  if (inventory.getFreeSlots() < needed) {
    player.sendMessage("Your inventory is too full to hold the blood runes.");
    return true;
  }
  inventory.addItem(new Item(runeId, charges * BLOOD_RUNES_PER_CHARGE));
  setCharges(player, item, 0);
  player.sendMessage(
    `You uncharge your Sanguinesti staff, regaining ${(charges * BLOOD_RUNES_PER_CHARGE).toLocaleString()} blood runes.`
  );
  return true;
}

module.exports = {
  name: "SanguinestiStaff",
  members: true,
  register(api) {
    core = api.core;
    const I = core.ItemIdentifiers;
    unchargedByCharged = new Map([
      [I.SANGUINESTI_STAFF, I.SANGUINESTI_STAFF_UNCHARGED_],
      [I.HOLY_SANGUINESTI_STAFF, I.HOLY_SANGUINESTI_STAFF_UNCHARGED_],
    ]);
    chargedIds = new Set(unchargedByCharged.keys());
    chargedByUncharged = new Map([...unchargedByCharged].map(([charged, uncharged]) => [uncharged, charged]));

    api.onItemAction("Sanguinesti staff", { Check: checkCharges, Uncharge: uncharge });
    api.onItemAction("Holy sanguinesti staff", { Check: checkCharges, Uncharge: uncharge });
    api.onItemOnItem(chargeStaff, { noted: false });
    api.onCombatHitResolved(onHitResolved);
    api.registerCombatMethodResolver({ resolve: resolveSang });
  },
  _test: {
    chargesOf,
    setCharges,
    applyLifeLeech,
    onHitResolved,
    useCharge,
    chargeStaff,
    checkCharges,
    uncharge,
    baseMaxHit,
    MAX_CHARGES,
    BLOOD_RUNES_PER_CHARGE,
    HEAL_CHANCE,
    LIFE_LEECH_DAMAGE,
    CHARGES_META_KEY,
  },
};
