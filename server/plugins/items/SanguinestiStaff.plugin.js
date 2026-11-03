/**
 * Sanguinesti staff (https://oldschool.runescape.wiki/w/Sanguinesti_staff).
 *
 * A powered staff with a built-in spell: max hit floor(Magic / 3), never below 6
 * (33 at 99 Magic), 4-tick attack speed, 7 tiles (9 on Longrange), one charge a
 * cast. It is charged with blood runes, two runes a charge, up to 20,000, and
 * uncharging returns every rune. A successful hit has a 1/5 chance to deal 8
 * extra damage and heal the caster for half the damage dealt. Uncharged, it
 * cannot cast. Charging, checking and uncharging mirror Tumeken's shadow
 * (plugins/items/TumekensShadow.plugin.js); the cast reuses the trident
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

const { definePoweredStaff } = require("./PoweredStaff");

let core = null;
let api = null;
let staff = null;
/** Hits whose life leech proc already rolled, to heal when they land. */
const proccedHits = new WeakSet();

function ids() {
  return core.ItemIdentifiers;
}

function isStaffId(id) {
  return staff.isStaff(id);
}

function chargesOf(item) {
  return staff.chargesOf(item);
}

function baseMaxHit(player) {
  return Math.max(MIN_BASE_MAX_HIT, Math.floor(player.getSkillManager().getCurrentLevel(core.Skill.MAGIC) / 3));
}

function look({ Animation, Graphic, GraphicHeight, Projectile }) {
  return {
    castAnimation: () => new Animation(CAST_ANIMATION),
    startGraphic: () => new Graphic(CAST_GRAPHIC.START, GraphicHeight.HIGH),
    castProjectile: (cast, castOn) =>
      Projectile.createProjectile(cast, castOn, CAST_GRAPHIC.PROJECTILE, 0, 20, 43, 31),
    endGraphic: () => new Graphic(CAST_GRAPHIC.END),
  };
}

function defineStaff() {
  const I = ids();
  return definePoweredStaff(api, {
    name: "Sanguinesti staff",
    chargesKey: CHARGES_META_KEY,
    maxCharges: MAX_CHARGES,
    pairs: [
      [I.SANGUINESTI_STAFF, I.SANGUINESTI_STAFF_UNCHARGED_],
      [I.HOLY_SANGUINESTI_STAFF, I.HOLY_SANGUINESTI_STAFF_UNCHARGED_],
    ],
    maxHit: baseMaxHit,
    attackSpeed: ATTACK_SPEED,
    range: ATTACK_RANGE,
    spell: look,
    onHitCalc: applyLifeLeech,
    noChargesMessage: "Your Sanguinesti staff has no charges! You need to charge it with blood runes.",
    ranOutMessage: "Your Sanguinesti staff has run out of charges.",
  });
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

function setCharges(player, item, value) {
  staff.setCharges(item, value);
  player.getInventory?.().refreshItems?.();
}

/** Two blood runes a charge, as many as the inventory affords (Wiki). */
function chargeStaff(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const held = isStaffId(usedItemId) ? usedItem : isStaffId(usedWithItemId) ? usedWithItem : null;
  if (!held) {
    return;
  }
  const otherId = Number(held === usedItem ? usedWithItemId : usedItemId);
  if (otherId !== ids().BLOOD_RUNE) {
    return;
  }
  const inventory = player.getInventory();
  const current = chargesOf(held);
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
  setCharges(player, held, current + affordable);
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
  register(pluginApi) {
    api = pluginApi;
    core = api.core;
    staff = defineStaff();

    api.onItemAction("Sanguinesti staff", { Check: checkCharges, Uncharge: uncharge });
    api.onItemAction("Holy sanguinesti staff", { Check: checkCharges, Uncharge: uncharge });
    api.onItemOnItem(chargeStaff, { noted: false });
    api.onCombatHitResolved(onHitResolved);
    api.registerCombatMethodResolver(staff.resolver);
  },
  _test: {
    chargesOf,
    setCharges,
    applyLifeLeech,
    onHitResolved,
    useCharge: (player) => staff.useCharge(player),
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
