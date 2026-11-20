/**
 * Sanguinesti staff (https://oldschool.runescape.wiki/w/Sanguinesti_staff).
 *
 * A powered staff with a built-in spell: max hit floor(Magic / 3), never below 6
 * (33 at 99 Magic), 4-tick attack speed, 7 tiles (9 on Longrange), one charge a
 * cast. It is charged with blood runes, two runes a charge, up to 20,000, and
 * uncharging returns every rune. A successful hit has a 1/5 chance to deal 8
 * extra damage and heal the caster for half the damage dealt. Uncharged, it
 * cannot cast. Charging, checking and uncharging mirror Tumeken's shadow
 * (plugins/items/TumekensShadow.plugin.js).
 *
 * The cast (rsprox 1696 ticks 640, 774, 778, 1063, 1073, 1413; 1698 ticks 4177, 4181, 4238, 4265): anim 1167,
 * casting spotanim 1540 (cache sanguinesti_staff_casting) at height 92 and a private shadow_cast (178); the
 * projectile 1539 (sanguinesti_staff_travel) leaves after 51 cycles at angle 16, progress 64, heights 23/15 (the
 * quarter-height unit packets use) and ends 46 cycles plus 10 a tile later, a tile being the distance to the
 * target's NEAREST tile (1696 ticks 774/778 from the east of the size-3 Balance Elemental end 86, 1063/1073 end 76,
 * 640 from the west 106). Like the tridents it times its own impact, sent with the cast and delayed to the
 * projectile's end: a hit is spotanim 1541 (sanguinesti_staff_impact) at height 60 (1696 ticks 640, 778, 1073;
 * 1698 4181, 4238), a hit with the life-leech proc spotanim 1542 (sanguinesti_staff_heal) at height 92 (1698
 * 4265; 1696 631, 1485, 1509), both with a range-10 area sound 1460, a miss spotanim 85 at height 124 and 227
 * (1696 774, 1063; 1698 4177). The Holy Sanguinesti staff's own graphics (cache *_justiciar, 1899-1901) are not captured, so it
 * casts with these too.
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
const CAST_GRAPHIC = { START: 1540, PROJECTILE: 1539, IMPACT: 1541, HEAL: 1542 };
const CAST_SOUND = 178; // shadow_cast
const IMPACT_SOUND = 1460; // contact_darkness_impact
const SPLASH_GRAPHIC = 85; // cache failedspell_impact
const SPLASH_SOUND = 227;
const CAST_HEIGHT = 92;
const IMPACT_HEIGHT = 60;
const HEAL_HEIGHT = 92;
const SPLASH_HEIGHT = 124;
const PROJECTILE = { START: 51, BASE: 46, PER_TILE: 10, START_HEIGHT: 23, END_HEIGHT: 15, ANGLE: 16, PROGRESS: 64 };

const { definePoweredStaff, restricted, plainAmount, takePlain, PRESET_TEXT, ticksFor } = require("./PoweredStaff");

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

/** Tiles from the caster to the target's nearest tile (a large target is not measured to its south-west corner). */
function edgeDistance(from, to) {
  const at = from.getLocation(), corner = to.getLocation();
  const size = Math.max(1, to.getSize?.() ?? 1);
  const dx = Math.max(0, corner.getX() - at.getX(), at.getX() - (corner.getX() + size - 1));
  const dy = Math.max(0, corner.getY() - at.getY(), at.getY() - (corner.getY() + size - 1));
  return Math.max(dx, dy);
}

function projectileEnd(from, to) {
  return PROJECTILE.BASE + Math.max(1, edgeDistance(from, to)) * PROJECTILE.PER_TILE;
}

function look({ Animation, Graphic, Projectile }) {
  return {
    castAnimation: () => new Animation(CAST_ANIMATION),
    startGraphic: () => new Graphic(CAST_GRAPHIC.START, 0, CAST_HEIGHT),
    castSound: () => CAST_SOUND,
    castProjectile: (cast, castOn) => Projectile.createProjectile(cast, castOn, CAST_GRAPHIC.PROJECTILE, PROJECTILE.START,
      projectileEnd(cast, castOn), PROJECTILE.START_HEIGHT, PROJECTILE.END_HEIGHT)
      .withAngle(PROJECTILE.ANGLE).withProgress(PROJECTILE.PROGRESS),
  };
}

/** Live sends the impact (or the splash) with the cast, delayed to the projectile's end. */
function impact(attacker, target, accurate, hit) {
  const end = projectileEnd(attacker, target);
  // The life-leech proc (rolled in onHitCalc, before this) shows the heal spiral instead of the plain impact.
  if (accurate && proccedHits.has(hit)) {
    return { graphic: new core.Graphic(CAST_GRAPHIC.HEAL, end, HEAL_HEIGHT), areaSound: { id: IMPACT_SOUND, delay: end } };
  }
  return accurate
    ? { graphic: new core.Graphic(CAST_GRAPHIC.IMPACT, end, IMPACT_HEIGHT), areaSound: { id: IMPACT_SOUND, delay: end } }
    : { graphic: new core.Graphic(SPLASH_GRAPHIC, end, SPLASH_HEIGHT), areaSound: { id: SPLASH_SOUND, delay: end } };
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
    hitDelay: (attacker, target) => ticksFor(projectileEnd(attacker, target)),
    impact,
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

/** Charge requests awaiting the amount typed into the prompt. */
const pendingCharges = new WeakMap();

/** How many charges the plain (unrestricted) blood runes in the inventory pay for, up to a full staff. */
function chargesAfforded(player, held) {
  return Math.min(
    Math.floor(plainAmount(player.getInventory(), ids().BLOOD_RUNE) / BLOOD_RUNES_PER_CHARGE),
    MAX_CHARGES - chargesOf(held),
  );
}

/** The staff is still the clicked item, in its slot, with the charges it had when asked. */
function ownsClickedStaff(player, request) {
  return player.getInventory().getItems?.()[request.slot] === request.item
    && request.item.getId() === request.itemId
    && chargesOf(request.item) === request.charges;
}

/**
 * Blood runes on the staff, or its Charge option, ask how many charges to apply, offering as many
 * as the inventory affords (rsprox local 1001250 tick 724 "(Up to 1,000)", local 1001295 tick 4817
 * "(Up to 17,728)"). Two blood runes a charge, up to 20,000 (Wiki, since 22 July 2026; the
 * recordings predate it and took three).
 */
function promptCharges(player, held, slot) {
  if (!Number.isInteger(slot) || player.getInventory().getItems?.()[slot] !== held) return false;
  if (chargesOf(held) >= MAX_CHARGES) {
    player.sendMessage("Your Sanguinesti staff is already fully charged.");
    return true;
  }
  const affordable = chargesAfforded(player, held);
  if (affordable < 1) {
    player.sendMessage("You need two blood runes for each charge.");
    return true;
  }
  const request = { player, item: held, itemId: held.getId(), slot, charges: chargesOf(held) };
  request.action = { acceptsZero: true, execute: (amount) => submitCharges(request, amount) };
  pendingCharges.set(player, request);
  player.setEnteredAmountAction(request.action);
  player.getPacketSender().sendEnterAmountPrompt(
    `How many charges do you want to apply? (Up to ${affordable.toLocaleString("en-US")})`);
  return true;
}

/**
 * The typed amount, clamped to what the runes still pay for (local 1001295 tick 4821: 435,567
 * typed applied the offered 17,728), shown in an objectbox with the charged staff (local 1001250
 * tick 727, local 1001295 tick 4821).
 */
function submitCharges(request, amount) {
  const { player, item } = request;
  if (pendingCharges.get(player) !== request || player.getEnteredAmountAction() !== request.action) return;
  pendingCharges.delete(player);
  if (!ownsClickedStaff(player, request) || !Number.isInteger(amount) || amount <= 0) return;
  const applied = Math.min(amount, chargesAfforded(player, item));
  if (applied < 1) return;
  takePlain(player.getInventory(), ids().BLOOD_RUNE, applied * BLOOD_RUNES_PER_CHARGE);
  setCharges(player, item, chargesOf(item) + applied);
  const { DialogueChainBuilder, ItemStatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, item.getId(),
    `You apply ${applied.toLocaleString("en-US")} charge${applied === 1 ? "" : "s"} to your Sanguinesti staff.`)));
}

function chargeStaff(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const held = isStaffId(usedItemId) ? usedItem : isStaffId(usedWithItemId) ? usedWithItem : null;
  if (!held) {
    return;
  }
  const runes = held === usedItem ? usedWithItem : usedItem;
  if (Number(runes?.getId?.()) !== ids().BLOOD_RUNE) {
    return;
  }
  if (restricted(runes)) {
    player.sendMessage(PRESET_TEXT);
    event.handled = true;
    return;
  }
  const slot = held === usedItem ? event.usedItemSlot : event.usedWithItemSlot;
  if (promptCharges(player, held, slot)) event.handled = true;
}

/**
 * The Charge option, on either version. Ours: Charge isn't recorded (local 1001250 tick 721 is op3,
 * Wield on the uncharged staff); it asks as using the runes does, as Tonalztics of Ralos' recorded
 * Charge does.
 */
function chargeOption({ player, item, slot }) {
  return promptCharges(player, item, slot);
}

/** rsprox 4151 tick 101, 4288 tick 26539. */
function checkCharges({ player, item }) {
  player.sendMessage(`Your Sanguinesti staff has ${chargesOf(item).toLocaleString("en-US")} charges remaining.`);
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
  const refund = new Item(runeId, charges * BLOOD_RUNES_PER_CHARGE);
  if (inventory.getAddableAmount(refund) < refund.getAmount()) {
    player.sendMessage("Your inventory is too full to hold the blood runes.");
    return true;
  }
  inventory.addItem(refund);
  setCharges(player, item, 0);
  player.sendMessage(
    `You uncharge your Sanguinesti staff, regaining ${(charges * BLOOD_RUNES_PER_CHARGE).toLocaleString()} blood runes.`
  );
  return true;
}

module.exports = {
  name: "SanguinestiStaff",
  description: "Adds the Sanguinesti staff: its built-in spell with its projectile and graphics, blood rune charging, uncharging and the chance to heal the caster.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = api.core;
    staff = defineStaff();

    api.onItemAction("Sanguinesti staff", { Check: checkCharges, Charge: chargeOption, Uncharge: uncharge });
    api.onItemAction("Sanguinesti staff (uncharged)", { Charge: chargeOption });
    api.onItemAction("Holy sanguinesti staff", { Check: checkCharges, Charge: chargeOption, Uncharge: uncharge });
    api.onItemAction("Holy sanguinesti staff (uncharged)", { Charge: chargeOption });
    api.onItemOnItem(chargeStaff, { noted: false });
    api.onCombatHitResolved(onHitResolved);
    api.registerCombatMethodResolver(staff.resolver);
    api.onCustomEvent("item:fill-charges", staff.fillCharges);
  },
  _test: {
    chargesOf,
    setCharges,
    applyLifeLeech,
    onHitResolved,
    useCharge: (player) => staff.useCharge(player),
    chargeStaff,
    chargeOption,
    pendingCharges,
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
