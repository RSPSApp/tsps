"use strict";

/**
 * Tumeken's shadow (https://oldschool.runescape.wiki/w/Tumeken%27s_shadow).
 *
 * A powered staff with a built-in spell that can't cast others: max hit floor(Magic / 3) + 1,
 * an attack every 5 ticks from 8 tiles (10 on Longrange), one charge a cast. Its styles are the
 * powered staff's (cache weapon category 24). Its passive triples the magic attack and magic
 * damage bonuses of the worn gear (damage capped at 100%), quadruples them inside the Tombs of
 * Amascut, and it can't be used against other players. Casting gives the usual damage-based
 * Magic experience.
 *
 * Charged with two soul runes and five chaos runes a charge, up to 20,000; uncharging returns
 * every rune.
 *
 * The cast (rsprox captures): TOA_SOT_CAST_B (9493) with TUMEKENS_SHADOW_CASTING / _TRAVEL /
 * _IMPACT (2125-2127) and sound 6410.
 *
 * Whether the player is in the tombs is the raid's to answer: it emits
 * `toa:in-tombs` { player, inside: false } and the Tombs of Amascut plugin sets `inside`.
 */

const CHARGES_KEY = "tumekens-shadow-charges";
const MAX_CHARGES = 20000;
const SOULS_PER_CHARGE = 2;
const CHAOS_PER_CHARGE = 5;
const INVENTORY_TOO_FULL = "Your inventory is too full to hold the runes.";

const ANIMATION_CAST = 9493;
const GRAPHIC = { CASTING: 2125, TRAVEL: 2126, IMPACT: 2127 };
const ATTACK_SPEED = 5;
const ATTACK_RANGE = 8;
const LONGRANGE_EXTRA = 2;
const MAX_MAGIC_DAMAGE = 100;
const SOUND_CAST = 6410;
// Captures 1846, 1885, 3285, 3299, 3340: a `sound_area id=1460 range=10` at the target in 672 casts.
const SOUND_IMPACT = 1460;
// The projectile (rsprox captures): it leaves after 56 client cycles and takes 16 more plus 10 a
// tile, with angle 32 and progress 40. Heights are sent times four (248 and 124; captured 250, 124).
const PROJECTILE = { DELAY: 56, LENGTH: 16, PER_TILE: 10, START_HEIGHT: 62, END_HEIGHT: 31, ANGLE: 32, PROGRESS: 40 };

const MAGIC_ATTACK = 3; // BonusManager.ATTACK_MAGIC
const MAGIC_DAMAGE = 12; // BonusManager.MAGIC_STRENGTH among the "other" bonuses

const { definePoweredStaff, distance } = require("./PoweredStaff");

let api = null;
let staff = null;

function core() {
  return api.core;
}

function ids() {
  return core().ItemIdentifiers;
}

function plural(amount, word) {
  return `${amount.toLocaleString()} ${word}${amount === 1 ? "" : "s"}`;
}

function wieldsShadow(player, chargedOnly = false) {
  return staff.wields(player, chargedOnly);
}

function chargesOf(item) {
  return staff.chargesOf(item);
}

function inTombs(player) {
  const query = { player, inside: false };
  api.emitCustomEvent("toa:in-tombs", query);
  return query.inside === true;
}

// ------------------------------------------------------------------ combat

function travelCycles(from, to) {
  return PROJECTILE.DELAY + PROJECTILE.LENGTH + distance(from, to, core().CombatPosition) * PROJECTILE.PER_TILE;
}

function look({ Animation, Graphic, GraphicHeight, Projectile }) {
  return {
    castAnimation: () => new Animation(ANIMATION_CAST),
    startGraphic: () => new Graphic(GRAPHIC.CASTING),
    castProjectile: (cast, castOn) => Projectile.createProjectile(cast, castOn, GRAPHIC.TRAVEL, PROJECTILE.DELAY,
      travelCycles(cast, castOn), PROJECTILE.START_HEIGHT, PROJECTILE.END_HEIGHT)
      .withAngle(PROJECTILE.ANGLE).withProgress(PROJECTILE.PROGRESS),
    castSound: () => SOUND_CAST,
    impactSound: () => SOUND_IMPACT,
    endGraphic: () => new Graphic(GRAPHIC.IMPACT, GraphicHeight.HIGH),
  };
}

/** Not against players; the passive depends on being in the tombs, so it is refreshed for the cast. */
function canAttack(player, target) {
  if (target?.isPlayer?.()) {
    player.sendMessage("You can't use Tumeken's shadow against other players.");
    return false;
  }
  api.getBonusManager().update(player);
  return true;
}

function defineShadow() {
  const I = ids();
  return definePoweredStaff(api, {
    name: "Tumeken's shadow",
    chargesKey: CHARGES_KEY,
    maxCharges: MAX_CHARGES,
    pairs: [[I.TUMEKENS_SHADOW, I.TUMEKENS_SHADOW_UNCHARGED_]],
    maxHit: (player) => Math.floor(player.getSkillManager().getCurrentLevel(core().Skill.MAGIC) / 3) + 1,
    attackSpeed: ATTACK_SPEED,
    range: ATTACK_RANGE,
    spell: look,
    // The hit lands as the slow projectile arrives.
    hitDelay: (attacker, target) => Math.max(1, Math.floor(travelCycles(attacker, target) / 30)),
    canAttack,
    emptied: (player) => api.getBonusManager().update(player),
    noChargesMessage: "Tumeken's shadow has no charges! You need to charge it with soul runes and chaos runes.",
    ranOutMessage: "Your Tumeken's shadow has run out of charges.",
  });
}

/** The passive: worn magic attack and damage x3 (x4 in the tombs), damage capped at 100%. */
function shadowBonuses({ player, bonuses }) {
  if (!wieldsShadow(player, true)) return;
  const multiplier = inTombs(player) ? 4 : 3;
  bonuses[MAGIC_ATTACK] *= multiplier;
  bonuses[MAGIC_DAMAGE] = Math.min(MAX_MAGIC_DAMAGE, bonuses[MAGIC_DAMAGE] * multiplier);
}

// ------------------------------------------------------------------ charges

function setCharges(player, item, charges) {
  staff.setCharges(item, charges);
  player.getInventory().refreshItems();
}

/** Two soul runes and five chaos runes a charge, as many as the inventory affords. */
function chargeShadow(event) {
  const { player } = event;
  const I = ids();
  const shadowIds = [I.TUMEKENS_SHADOW, I.TUMEKENS_SHADOW_UNCHARGED_];
  const shadow = shadowIds.includes(event.usedItemId) ? event.usedItem : event.usedWithItem;
  if (!shadow) return false;
  const inventory = player.getInventory();
  const current = chargesOf(shadow);
  if (current >= MAX_CHARGES) {
    player.sendMessage("Your Tumeken's shadow is already fully charged.");
    return true;
  }
  const affordable = Math.min(
    Math.floor(inventory.getAmount(I.SOUL_RUNE) / SOULS_PER_CHARGE),
    Math.floor(inventory.getAmount(I.CHAOS_RUNE) / CHAOS_PER_CHARGE),
    MAX_CHARGES - current,
  );
  if (affordable < 1) {
    player.sendMessage("You need two soul runes and five chaos runes for each charge.");
    return true;
  }
  inventory.deleteNumber(I.SOUL_RUNE, affordable * SOULS_PER_CHARGE);
  inventory.deleteNumber(I.CHAOS_RUNE, affordable * CHAOS_PER_CHARGE);
  setCharges(player, shadow, current + affordable);
  player.sendMessage(current === 0
    ? `You apply ${plural(affordable, "charge")} to your Tumeken's shadow.`
    : `You apply an additional ${plural(affordable, "charge")} to your Tumeken's shadow. It now has ${plural(current + affordable, "charge")} in total.`);
  return true;
}

function checkShadow({ player, item }) {
  player.sendMessage(`Your Tumeken's shadow has ${plural(chargesOf(item), "charge")} remaining.`);
  return true;
}

/**
 * Whether the whole refund fits. Runes stack only onto the same metadata, so a preset stack isn't
 * room, and each new stack needs a slot of its own.
 */
function refundFits(inventory, charges) {
  const { Item } = core();
  const I = ids();
  const refund = [new Item(I.SOUL_RUNE, charges * SOULS_PER_CHARGE), new Item(I.CHAOS_RUNE, charges * CHAOS_PER_CHARGE)];
  const meta = (item) => JSON.stringify(item.getMeta() ?? null);
  const hasStack = (rune) => inventory.getValidItems().some((item) => item.getId() === rune.getId() && meta(item) === meta(rune));
  return inventory.getFreeSlots() >= refund.filter((rune) => !hasStack(rune)).length
    && refund.every((rune) => inventory.getAddableAmount(rune) >= rune.getAmount());
}

function unchargeShadow({ player, item }) {
  const { Item } = core();
  const I = ids();
  const charges = chargesOf(item);
  if (charges <= 0) {
    player.sendMessage("Your Tumeken's shadow has no charges to remove.");
    return true;
  }
  const inventory = player.getInventory();
  if (!refundFits(inventory, charges)) {
    player.sendMessage(INVENTORY_TOO_FULL);
    return true;
  }
  const staffId = item.getId();
  api.sendMultiChatboxPrompt(player, "Uncharge all the charges from your staff?", "Yes.", () => {
    // The prompt can sit open while the items change. Wielding clones the staff, and a removed
    // object keeps its charges, so only the object still carried can pay.
    const carried = [inventory, player.getEquipment()].some((container) => container.getItems().includes(item));
    const left = chargesOf(item);
    if (!carried || item.getId() !== staffId || left <= 0) return;
    if (!refundFits(inventory, left)) {
      player.sendMessage(INVENTORY_TOO_FULL);
      return;
    }
    inventory.addItem(new Item(I.SOUL_RUNE, left * SOULS_PER_CHARGE));
    inventory.addItem(new Item(I.CHAOS_RUNE, left * CHAOS_PER_CHARGE));
    setCharges(player, item, 0);
    player.sendMessage(`You uncharge your Tumeken's shadow, regaining ${plural(left * SOULS_PER_CHARGE, "soul rune")} and ${plural(left * CHAOS_PER_CHARGE, "chaos rune")} in the process.`);
  }, "No.", () => {});
  return true;
}

module.exports = {
  name: "TumekensShadow",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    staff = defineShadow();
    pluginApi.registerCombatMethodResolver(staff.resolver);
    pluginApi.registerBonusProvider({ apply: shadowBonuses });
    for (const rune of ["Soul rune", "Chaos rune"]) {
      pluginApi.onItemOnItem(rune, "Tumeken's shadow", chargeShadow);
      pluginApi.onItemOnItem(rune, "Tumeken's shadow (uncharged)", chargeShadow);
    }
    pluginApi.onItemAction("Tumeken's shadow", { Check: checkShadow, Uncharge: unchargeShadow });
  },
  /** Where a staff keeps its charges (::maxgear fills it). */
  CHARGES_KEY,
};
