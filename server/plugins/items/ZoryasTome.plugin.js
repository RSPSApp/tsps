/**
 * Zorya's tome (https://oldschool.runescape.wiki/w/Zorya%27s_tome), The Fractured Archive's
 * unique. A two-handed powered tome with a built-in spell: base max hit 18, 3-tick attack speed,
 * 7 tiles (9 on Longrange), one charge a cast. Charged with 3 astral and 2 nature runes a charge,
 * up to 20,000; uncharging returns every rune. Charging, checking and uncharging mirror the
 * Sanguinesti staff (plugins/items/SanguinestiStaff.plugin.js).
 *
 * Special attack Zorya's flow (50%): 150% increased accuracy and 60% increased damage. If it hits,
 * the next three tome attacks get the same bonuses and come every 2 ticks (five if the special
 * is used again while that buff is running and also hits). The buff lasts 30 seconds and stays
 * through weapon switches. The Wiki leaves "increased" ambiguous; read here as x2.5 and x1.6
 * (estimate), and the five-attack rule as "used while the buff is active" (estimate).
 *
 * Ids from the cache gamevals: tfa_human_zorya_tome_attack (15139) / _special_attack (15140), with
 * _female versions (15146 / 15147), vfx_zorya_tome_proj (4427) / _special_proj (4428), _impact (4429) /
 * _special_impact (4430), caster spotanims _standard_spotanim (4433) / _spec_spotanim (4432), with
 * _female versions (4435 / 4434). The Wiki gives no projectile timings, so Sanguinesti's are reused (estimate).
 */
const { restricted, plainAmount, takePlain, PRESET_TEXT } = require("./PoweredStaff");

const MAX_CHARGES = 20000;
const ASTRAL_PER_CHARGE = 3;
const NATURE_PER_CHARGE = 2;
const CHARGES_META_KEY = "zoryas-tome-charges";
const BASE_MAX_HIT = 18;
const ATTACK_SPEED = 3;
const BUFFED_ATTACK_SPEED = 2;
const ATTACK_RANGE = 7;
const LONGRANGE_EXTRA = 2;
const SPECIAL_DRAIN = 50;
const ACCURACY_MULTIPLIER = 2.5;
const DAMAGE_MULTIPLIER = 1.6;
const BUFF_ATTACKS = 3;
const BUFF_ATTACKS_REPEATED = 5;
const BUFF_DURATION_MS = 30000;
const STANDARD = { ANIMATION: 15139, FEMALE_ANIMATION: 15146, START: 4433, FEMALE_START: 4435, PROJECTILE: 4427, END: 4429 };
const SPECIAL = { ANIMATION: 15140, FEMALE_ANIMATION: 15147, START: 4432, FEMALE_START: 4434, PROJECTILE: 4428, END: 4430 };

let core = null;
let TomeCombatMethod = null;
const spells = new WeakMap();
const spellKinds = new WeakMap();
/** Each player's flow buff: { attacks, expires }. */
const buffs = new WeakMap();
/** What each player's current cast is: "normal" | "buffed" | "special". */
const casts = new WeakMap();
/** Special hits, to start the buff when they land. */
const specialHits = new WeakSet();

function ids() {
  return core.ItemIdentifiers;
}

function weaponOf(player) {
  return player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT] ?? null;
}

function isTomeId(id) {
  return Number(id) === ids().ZORYAS_TOME || Number(id) === ids().ZORYAS_TOME_UNCHARGED_;
}

function wieldsTome(player, chargedOnly = false) {
  const id = Number(weaponOf(player)?.getId?.() ?? -1);
  return id === ids().ZORYAS_TOME || (!chargedOnly && id === ids().ZORYAS_TOME_UNCHARGED_);
}

function chargesOf(item) {
  return Math.max(0, Math.min(MAX_CHARGES, Math.floor(Number(item?.getMetaValue?.(CHARGES_META_KEY)) || 0)));
}

function buffAttacks(player) {
  const buff = buffs.get(player);
  return buff && buff.attacks > 0 && Date.now() < buff.expires ? buff.attacks : 0;
}

function spellFor(player) {
  const kind = casts.get(player) ?? "normal";
  let byKind = spells.get(player);
  if (!byKind) {
    byKind = new Map();
    spells.set(player, byKind);
  }
  let spell = byKind.get(kind);
  if (spell) return spell;
  const { CombatNormalSpell, Animation, Graphic, GraphicHeight, Projectile } = core;
  const gfx = kind === "special" ? SPECIAL : STANDARD;
  const female = () => player.getAppearance?.().isMale?.() === false;
  spell = new CombatNormalSpell({
    spellId: () => ids().ZORYAS_TOME,
    maximumHit: () => BASE_MAX_HIT,
    castAnimation: () => new Animation(female() ? gfx.FEMALE_ANIMATION : gfx.ANIMATION),
    startGraphic: () => new Graphic(female() ? gfx.FEMALE_START : gfx.START, GraphicHeight.HIGH),
    castProjectile: (cast, castOn) => Projectile.createProjectile(cast, castOn, gfx.PROJECTILE, 0, 20, 43, 31),
    endGraphic: () => new Graphic(gfx.END),
    baseExperience: () => 0,
    levelRequired: () => 1,
  });
  byKind.set(kind, spell);
  spellKinds.set(spell, kind);
  return spell;
}

/** Takes a charge; an emptied tome becomes the uncharged one. */
function useCharge(player) {
  const { Flag } = core;
  const tome = weaponOf(player);
  const left = chargesOf(tome) - 1;
  tome.setMetaValue(CHARGES_META_KEY, Math.max(0, left));
  if (left > 0) return;
  tome.setId(ids().ZORYAS_TOME_UNCHARGED_);
  player.getEquipment().refreshItems();
  player.getUpdateFlag().flag(Flag.APPEARANCE);
  player.sendMessage("Your Zorya's tome has run out of charges.");
}

/** Decides what this cast is, spending the special's energy or a buffed attack. */
function startCast(player) {
  if (player.isSpecialActivated?.() && player.getSpecialPercentage() >= SPECIAL_DRAIN) {
    core.CombatSpecial.drain(player, SPECIAL_DRAIN);
    casts.set(player, "special");
  } else if (buffAttacks(player) > 0) {
    buffs.get(player).attacks--;
    casts.set(player, "buffed");
  } else {
    casts.set(player, "normal");
  }
}

function tomeMethod() {
  if (TomeCombatMethod) return TomeCombatMethod;
  const { MagicCombatMethod, PendingHit } = core;

  TomeCombatMethod = new (class extends MagicCombatMethod {
    canAttack(character) {
      const player = character.getAsPlayer();
      if (!wieldsTome(player, true) || chargesOf(weaponOf(player)) <= 0) {
        player.sendMessage("Your Zorya's tome has no charges! You need to charge it with astral and nature runes.");
        player.getCombat().reset();
        return false;
      }
      // Its built-in spell is the only one it casts, whatever is selected or autocast.
      useCharge(player);
      startCast(player);
      player.getCombat().setCastSpell(spellFor(player));
      return true;
    }

    canPursue(character) {
      const player = character.getAsPlayer();
      return wieldsTome(player, true) && chargesOf(weaponOf(player)) > 0;
    }

    hits(character, target) {
      const spell = spellFor(character.getAsPlayer());
      const hit = new PendingHit(character, target, this, MagicCombatMethod.hitDelay(character, target, spell), true).setSpell(spell);
      spell.onHitCalc(hit);
      if (spellKinds.get(spell) === "special") specialHits.add(hit);
      return [hit];
    }

    attackSpeed(character) {
      return casts.get(character) === "buffed" ? BUFFED_ATTACK_SPEED : ATTACK_SPEED;
    }

    attackDistance(character) {
      const { FightStyle } = core;
      return ATTACK_RANGE + (character.getFightType?.()?.getStyle?.() === FightStyle.DEFENSIVE ? LONGRANGE_EXTRA : 0);
    }

    /** Keeps attacking: the tome casts on its own, unlike a single manual cast. */
    finished(character) {
      const combat = character.getCombat();
      combat.setPreviousCast(spellFor(character.getAsPlayer()));
      combat.setCastSpell(null);
    }
  })();
  return TomeCombatMethod;
}

function resolveTome(attacker) {
  if (!attacker?.isPlayer?.()) return null;
  return wieldsTome(attacker.getAsPlayer()) ? tomeMethod() : null;
}

/** Wiki: a landed special buffs the next three attacks, five when used again during the buff. */
function onHitResolved({ attacker, hit }) {
  if (!attacker?.isPlayer?.() || !hit || !specialHits.has(hit)) return;
  specialHits.delete(hit);
  if (!hit.isAccurate?.()) return;
  const repeated = buffAttacks(attacker) > 0;
  buffs.set(attacker, { attacks: repeated ? BUFF_ATTACKS_REPEATED : BUFF_ATTACKS, expires: Date.now() + BUFF_DURATION_MS });
}

function boosted(request) {
  const player = request.attacker;
  if (!player?.isPlayer?.() || !spellKinds.has(request.spell)) return false;
  const kind = spellKinds.get(request.spell);
  return kind === "special" || kind === "buffed";
}

function onMaxHit(request) {
  if (boosted(request)) request.maxHit = Math.floor(request.maxHit * DAMAGE_MULTIPLIER);
}

function onAttackRoll(request) {
  if (boosted(request)) request.attackRoll = Math.floor(request.attackRoll * ACCURACY_MULTIPLIER);
}

function setCharges(player, tome, value) {
  const clamped = Math.max(0, Math.min(MAX_CHARGES, Math.floor(value)));
  tome.setMetaValue(CHARGES_META_KEY, clamped);
  tome.setId(clamped > 0 ? ids().ZORYAS_TOME : ids().ZORYAS_TOME_UNCHARGED_);
  player.getInventory().refreshItems();
}

/** Three astral and two nature runes a charge, as many as the inventory affords (Wiki). */
function chargeTome(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const tome = isTomeId(usedItemId) ? usedItem : isTomeId(usedWithItemId) ? usedWithItem : null;
  if (!tome) return;
  const otherId = Number(tome === usedItem ? usedWithItemId : usedItemId);
  if (otherId !== ids().ASTRAL_RUNE && otherId !== ids().NATURE_RUNE) return;
  event.handled = true;
  const inventory = player.getInventory();
  // Preset copies never pay: Uncharge refunds plain runes, so they would come back tradeable.
  if (restricted(tome === usedItem ? usedWithItem : usedItem)) {
    player.sendMessage(PRESET_TEXT);
    return;
  }
  const current = chargesOf(tome);
  if (current >= MAX_CHARGES) {
    player.sendMessage("Your Zorya's tome is already fully charged.");
    return;
  }
  const batches = (count) => Math.min(
    Math.floor(count(ids().ASTRAL_RUNE) / ASTRAL_PER_CHARGE),
    Math.floor(count(ids().NATURE_RUNE) / NATURE_PER_CHARGE),
    MAX_CHARGES - current,
  );
  const affordable = batches((id) => plainAmount(inventory, id));
  if (affordable < 1 && batches((id) => inventory.getAmount(id)) >= 1) {
    player.sendMessage(PRESET_TEXT);
    return;
  }
  if (affordable < 1) {
    player.sendMessage("You need three astral runes and two nature runes for each charge.");
    return;
  }
  takePlain(inventory, ids().ASTRAL_RUNE, affordable * ASTRAL_PER_CHARGE);
  takePlain(inventory, ids().NATURE_RUNE, affordable * NATURE_PER_CHARGE);
  setCharges(player, tome, current + affordable);
  player.sendMessage(`You apply ${affordable.toLocaleString()} charge${affordable === 1 ? "" : "s"} to your Zorya's tome.`);
}

/** The cache's "Charge" option: like Sanguinesti's, the runes are used on the tome. */
function chargeOption({ player }) {
  player.sendMessage(`Use ${ASTRAL_PER_CHARGE} astral runes and ${NATURE_PER_CHARGE} nature runes a charge on the tome to charge it.`);
  return true;
}

function checkCharges({ player, item }) {
  player.sendMessage(`Your Zorya's tome has ${chargesOf(item).toLocaleString("en-US")} charges left.`);
  return true;
}

function refundsFit(inventory, refunds) {
  const items = inventory.getItems();
  const newStacks = refunds.filter((refund) => !items.some((held) =>
    held.getId() === refund.getId() && JSON.stringify(held.getMeta() ?? null) === JSON.stringify(refund.getMeta() ?? null)
  )).length;
  return newStacks <= inventory.getFreeSlots() && refunds.every((refund) =>
    inventory.getAddableAmount(refund) >= refund.getAmount()
  );
}

/** Wiki: uncharging returns every rune spent. */
function uncharge({ player, item }) {
  const { Item } = core;
  const charges = chargesOf(item);
  if (charges <= 0) {
    player.sendMessage("Your Zorya's tome has no charges to remove.");
    return true;
  }
  const inventory = player.getInventory();
  const refunds = [
    new Item(ids().ASTRAL_RUNE, charges * ASTRAL_PER_CHARGE),
    new Item(ids().NATURE_RUNE, charges * NATURE_PER_CHARGE),
  ];
  if (!refundsFit(inventory, refunds)) {
    player.sendMessage("Your inventory is too full to hold the runes.");
    return true;
  }
  for (const rune of refunds) inventory.addItem(rune);
  setCharges(player, item, 0);
  player.sendMessage(
    `You uncharge your Zorya's tome, regaining ${(charges * ASTRAL_PER_CHARGE).toLocaleString()} astral and ${(charges * NATURE_PER_CHARGE).toLocaleString()} nature runes.`
  );
  return true;
}

function flowSpecial() {
  return {
    id: "zoryas_tome",
    itemIds: [ids().ZORYAS_TOME],
    drainAmount: SPECIAL_DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    combatMethod: tomeMethod(),
  };
}

module.exports = {
  name: "ZoryasTome",
  members: true,
  register(api) {
    core = api.core;
    api.onItemAction("Zorya's tome", { Check: checkCharges, Charge: chargeOption, Uncharge: uncharge });
    api.onItemAction("Zorya's tome (uncharged)", { Charge: chargeOption });
    api.onItemOnItem(chargeTome, { noted: false });
    api.onCombatHitResolved(onHitResolved);
    api.onCustomEvent("combat:magic-max-hit", onMaxHit);
    api.onCustomEvent("combat:magic-attack-roll-modify", onAttackRoll);
    api.registerCombatMethodResolver({ resolve: resolveTome });
    api.registerCombatSpecial(flowSpecial());
  },
  _test: {
    chargesOf, setCharges, useCharge, chargeTome, checkCharges, uncharge, onHitResolved, onMaxHit, onAttackRoll,
    buffs, casts, specialHits, buffAttacks, MAX_CHARGES, CHARGES_META_KEY, BUFF_ATTACKS, BUFF_ATTACKS_REPEATED,
  },
};
