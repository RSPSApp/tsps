"use strict";

/**
 * Accursed sceptre (docs/powered-staves.md; https://oldschool.runescape.wiki/w/Accursed_sceptre,
 * https://oldschool.runescape.wiki/w/Thammaron%27s_sceptre).
 *
 * Wiki: a powered staff casting every 4 ticks from 7 tiles (9 on Longrange), max hit
 * floor(Magic / 3) - 6, 70 Magic. Revenant ether powers it: the first 1,000 are a deposit that
 * activates it, then up to 16,000 more are charges, one a cast. Emptied, it keeps the deposit
 * and stays activated. Uncharging returns every ether, deposit included. Its Swap option turns it
 * into the (a) version, which autocasts spellbook spells instead of casting a built-in one. Either
 * version, charged, gives 50% more magic accuracy and damage against NPCs in the Wilderness, at a
 * charge an attack. Its special, Condemn, is plugins/combat/specials/AccursedSceptre.SpecialAttack.js.
 *
 * rsprox (captures 1703, 3126, 3994, 4096, 4101): ether on the sceptre asks "How many ether would
 * you like to add? (0 - N)" (with the busy varbit); "You use 1,000 ether to activate the weapon."
 * and "You add a further N revenant ether to your weapon, giving it a total of N charges." for an
 * unactivated one, "You add N revenant ether to your weapon, giving it a total of N charges."
 * after; Check: "Your sceptre has N charges left powering it."; empty: "There is not enough
 * revenant ether left powering your sceptre.". No capture shows its built-in spell; it uses the
 * powered staff cast (human_castwave_staff_walkmerge, 11430) and Thammaron's projectile
 * (spells_thammaron01_travel01, 2340), the sceptre it is made from. Dismantle (not captured)
 * splits an unactivated one back into Thammaron's sceptre and the Skull of Vet'ion.
 */

const { definePoweredStaff } = require("./PoweredStaff");

const CHARGES_KEY = "accursed-sceptre-charges";
const MAX_CHARGES = 16000;
const ACTIVATION_ETHER = 1000;
const ATTACK_SPEED = 4;
const ATTACK_RANGE = 7;
const LEVEL_REQUIRED = 70;
const MAX_HIT_OFFSET = -6;
const WILDERNESS_MULTIPLIER = 1.5;
const BUSY_VARBIT = 12393; // cache gameval busy

const CAST_ANIMATION = 11430; // human_castwave_staff_walkmerge
const PROJECTILE_GRAPHIC = 2340; // spells_thammaron01_travel01
const CAST_SOUND = 178;

let api = null;
let core = null;
/** The sceptre (built-in spell) and its (a) version (spellbook autocast); both hold ether. */
let sceptre = null;
let autocasting = null;

function ids() {
  return core.ItemIdentifiers;
}

function format(amount) {
  return amount.toLocaleString("en-US");
}

function variantOf(id) {
  if (sceptre.isStaff(id)) return sceptre;
  if (autocasting.isStaff(id)) return autocasting;
  return null;
}

// ------------------------------------------------------------------ combat

function maxHit(player) {
  return Math.max(0, Math.floor(player.getSkillManager().getCurrentLevel(core.Skill.MAGIC) / 3) + MAX_HIT_OFFSET);
}

function look({ Animation, Projectile }) {
  return {
    castAnimation: () => new Animation(CAST_ANIMATION),
    castSound: () => CAST_SOUND,
    castProjectile: (cast, castOn) => Projectile.createProjectile(cast, castOn, PROJECTILE_GRAPHIC, 0, 20, 43, 31),
  };
}

function config(pairs, specialId) {
  return {
    name: "Accursed sceptre",
    chargesKey: CHARGES_KEY,
    maxCharges: MAX_CHARGES,
    pairs,
    maxHit,
    attackSpeed: ATTACK_SPEED,
    range: ATTACK_RANGE,
    levelRequired: LEVEL_REQUIRED,
    spell: look,
    specialId,
    // The deposit stays: an emptied sceptre is still activated.
    swapWhenEmpty: false,
    chargeUsed: paid,
    noChargesMessage: "There is not enough revenant ether left powering your sceptre.",
  };
}

/** The tick each player last paid a charge on: that attack keeps the passive it paid for. */
const paidOn = new WeakMap();

/** A charge was spent (a cast, Condemn, or a spellbook cast with the passive). */
function paid(player) {
  paidOn.set(player, core.World.getProcessCycle());
}

/**
 * The worn, activated sceptre (either version) when its Wilderness passive applies to this target:
 * while it holds a charge, or for the attack that has just paid its last one (paid before its roll).
 */
function passiveStaff(attacker, target) {
  if (!attacker?.isPlayer?.() || !target?.isNpc?.()) return null;
  const player = attacker.getAsPlayer();
  const staff = [sceptre, autocasting].find((s) => s.wields(player, true));
  if (!staff) return null;
  const charged = staff.chargesOf(staff.weaponOf(player)) > 0 || paidOn.get(player) === core.World.getProcessCycle();
  if (!charged) return null;
  return core.Wilderness.isInLocation(target.getLocation()) ? staff : null;
}

/** Wiki: 50% more magic damage against NPCs in the Wilderness. */
function boostMaxHit(request) {
  if (passiveStaff(request.attacker, request.target)) {
    request.maxHit = Math.floor(request.maxHit * WILDERNESS_MULTIPLIER);
  }
}

/** Wiki: and 50% more magic accuracy. */
function boostAccuracy(request) {
  if (passiveStaff(request.attacker, request.target)) {
    request.attackRoll = Math.floor(request.attackRoll * WILDERNESS_MULTIPLIER);
  }
}

/** A spellbook cast with the passive spends a charge, as the built-in spell's own does. */
function spellCast({ player }) {
  const target = player?.getCombat?.()?.getTarget?.();
  const staff = passiveStaff(player, target);
  // A charge already paid this tick (Condemn's, the built-in spell's) covers this attack too.
  if (staff && paidOn.get(player) !== core.World.getProcessCycle()) staff.useCharge(player);
}

function resolveSceptre(attacker) {
  return sceptre.resolver.resolve(attacker);
}

function answerSpell(request) {
  sceptre.answerSpell(request);
  autocasting.answerSpell(request);
}

// ------------------------------------------------------------------ charges

function isActivated(item) {
  const staff = variantOf(item?.getId?.());
  return Boolean(staff?.isCharged(item.getId()));
}

function chargeSceptre(player, item) {
  const staff = variantOf(item.getId());
  const inventory = player.getInventory();
  const ether = inventory.getAmount(ids().REVENANT_ETHER);
  const activated = isActivated(item);
  const deposit = activated ? 0 : ACTIVATION_ETHER;
  if (ether < deposit) {
    player.sendMessage(`You need ${format(ACTIVATION_ETHER)} revenant ether to activate the weapon.`);
    return true;
  }
  const most = Math.min(ether - deposit, MAX_CHARGES - staff.chargesOf(item));
  if (activated && most <= 0) {
    player.sendMessage("Your sceptre cannot hold any more ether.");
    return true;
  }
  const sender = player.getPacketSender();
  sender.sendVarbit(BUSY_VARBIT, 1);
  player.setEnteredAmountAction({
    acceptsZero: true,
    execute: (amount) => {
      sender.sendVarbit(BUSY_VARBIT, 0);
      addEther(player, item, amount);
    },
  });
  sender.sendEnterAmountPrompt(`How many ether would you like to add? (0 - ${format(Math.max(0, most))})`);
  return true;
}

function addEther(player, item, amount) {
  const inventory = player.getInventory();
  if (!inventory.getItems().includes(item)) return;
  const staff = variantOf(item.getId());
  const activated = isActivated(item);
  const deposit = activated ? 0 : ACTIVATION_ETHER;
  const ether = inventory.getAmount(ids().REVENANT_ETHER);
  const current = staff.chargesOf(item);
  const added = Math.max(0, Math.min(Math.floor(Number(amount) || 0), ether - deposit, MAX_CHARGES - current));
  if (ether < deposit || (activated && added <= 0)) return;
  inventory.deleteNumber(ids().REVENANT_ETHER, deposit + added);
  if (!activated) {
    item.setId(staff.chargedByUncharged.get(item.getId()));
    player.sendMessage(`You use ${format(ACTIVATION_ETHER)} ether to activate the weapon.`);
  }
  staff.setCharges(item, current + added);
  inventory.refreshItems();
  if (added > 0) {
    player.sendMessage(activated
      ? `You add ${format(added)} revenant ether to your weapon, giving it a total of ${format(current + added)} charges.`
      : `You add a further ${format(added)} revenant ether to your weapon, giving it a total of ${format(current + added)} charges.`);
  }
}

function chargeWithEther(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const item = variantOf(usedItemId) ? usedItem : variantOf(usedWithItemId) ? usedWithItem : null;
  const other = Number(item === usedItem ? usedWithItemId : usedItemId);
  if (!item || other !== ids().REVENANT_ETHER) return;
  event.handled = chargeSceptre(player, item);
}

function checkCharges({ player, item }) {
  player.sendMessage(`Your sceptre has ${format(variantOf(item.getId()).chargesOf(item))} charges left powering it.`);
  return true;
}

/** Wiki: every ether comes back, the activation deposit included. */
function uncharge({ player, item }) {
  const staff = variantOf(item.getId());
  if (!isActivated(item)) return false;
  const inventory = player.getInventory();
  const etherId = ids().REVENANT_ETHER;
  if (!inventory.contains(etherId) && inventory.getFreeSlots() < 1) {
    player.sendMessage("You don't have enough inventory space to uncharge your sceptre.");
    return true;
  }
  const returned = staff.chargesOf(item) + ACTIVATION_ETHER;
  inventory.addItem(new core.Item(etherId, returned));
  staff.setCharges(item, 0);
  item.setId(staff.unchargedByCharged.get(item.getId()));
  inventory.refreshItems();
  player.sendMessage(`You uncharge your sceptre, regaining ${format(returned)} revenant ether.`);
  return true;
}

/** Swap: the sceptre and its (a) version, charges kept. */
function swap({ player, item }) {
  const I = ids();
  const pairs = new Map([
    [I.ACCURSED_SCEPTRE, I.ACCURSED_SCEPTRE_A_], [I.ACCURSED_SCEPTRE_A_, I.ACCURSED_SCEPTRE],
    [I.ACCURSED_SCEPTRE_U_, I.ACCURSED_SCEPTRE_AU_], [I.ACCURSED_SCEPTRE_AU_, I.ACCURSED_SCEPTRE_U_],
  ]);
  const next = pairs.get(item?.getId?.());
  if (next === undefined) return false;
  item.setId(next);
  refresh(player);
  return true;
}

/** Swap works worn too: the equipment and appearance follow. */
function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

/**
 * Wiki: the accursed sceptre is Thammaron's sceptre and the Skull of Vet'ion, "and this process is
 * reversible". Dismantle, on the unactivated sceptre, gives both back (the (au) one Thammaron's (au)).
 */
function dismantle({ player, item }) {
  const I = ids();
  const thammarons = new Map([[I.ACCURSED_SCEPTRE_U_, I.THAMMARONS_SCEPTRE_U_], [I.ACCURSED_SCEPTRE_AU_, I.THAMMARONS_SCEPTRE_AU_]]).get(item?.getId?.());
  if (thammarons === undefined) return false;
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() < 1) {
    player.sendMessage("You don't have enough inventory space to do that.");
    return true;
  }
  item.setId(thammarons);
  inventory.addItem(new core.Item(I.SKULL_OF_VETION, 1));
  inventory.refreshItems();
  player.sendMessage("You remove the Skull of Vet'ion from the sceptre.");
  return true;
}

function defineSceptres() {
  const I = ids();
  sceptre = definePoweredStaff(api, config([[I.ACCURSED_SCEPTRE, I.ACCURSED_SCEPTRE_U_]], "accursed_sceptre"));
  autocasting = definePoweredStaff(api, config([[I.ACCURSED_SCEPTRE_A_, I.ACCURSED_SCEPTRE_AU_]], "accursed_sceptre"));
}

module.exports = {
  name: "AccursedSceptre",
  members: true,
  _test: {
    CHARGES_KEY, MAX_CHARGES, ACTIVATION_ETHER,
    get sceptre() { return sceptre; },
    get autocasting() { return autocasting; },
    maxHit, chargeSceptre, addEther, chargeWithEther, checkCharges, uncharge, swap, boostMaxHit, boostAccuracy, spellCast, dismantle,
    resolveSceptre,
  },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    defineSceptres();
    pluginApi.registerCombatMethodResolver({ resolve: resolveSceptre });
    pluginApi.onCustomEvent("powered-staff:spell", answerSpell);
    pluginApi.onCustomEvent("combat:magic-max-hit", boostMaxHit);
    pluginApi.onCustomEvent("combat:magic-attack-roll-modify", boostAccuracy);
    pluginApi.onCustomEvent("magic:cast-committed", spellCast);
    for (const name of ["Accursed sceptre", "Accursed sceptre (a)"]) {
      pluginApi.onItemAction(name, { Check: checkCharges, Swap: swap, Uncharge: uncharge });
    }
    for (const name of ["Accursed sceptre (u)", "Accursed sceptre (au)"]) {
      pluginApi.onItemAction(name, { Swap: swap, Dismantle: dismantle });
    }
    pluginApi.onItemOnItem(chargeWithEther, { noted: false });
  },
};
