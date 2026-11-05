/**
 * The bone staff (Wiki: Bone staff; captured, docs/scurrius.md): a powered staff charged with chaos
 * runes, one a cast, up to 20,000; uncharging returns them all.
 * - Chaos runes on the staff ask "How many chaos runes do you wish to add? (0 - N)", N being what
 *   the inventory holds or the staff has room for; full: "Your Bone staff is already fully charged.".
 * - Check: "Your Bone staff has N charges remaining."; Uncharge: "You uncharge your Bone staff." in
 *   an item box, or "Your Bone staff has no charges to remove.".
 * - Its spell: max hit floor(Magic / 3) + 5, and the rat bone +10 (it can only attack rats), 4-tick
 *   attack speed, 8 tiles (10 on Longrange, Wiki: Attack range), 35 base experience. Captured cast:
 *   animation 393, graphic 2645, area sound 7617, projectile 2647 (cycles 46 to 46 + 10 a tile, height
 *   45 to 23, angle 10, progress 64), impact 2646 (height 124), and "Your weapon has N charges
 *   remaining." with each cast.
 */
const Common = require("./Common.RatBoneWeapons");
const { definePoweredStaff } = require("../PoweredStaff");

const MAX_CHARGES = 20000;
const CHARGES_META_KEY = "bone-staff-charges";
const ATTACK_SPEED = 4;
const ATTACK_RANGE = 8;
const LONGRANGE_EXTRA = 2;
const BASE_EXPERIENCE = 35;
const CAST = Object.freeze({ anim: 393, gfx: 2645, projectile: 2647, impact: 2646, sound: 7617 });
const PROJECTILE = Object.freeze({ start: 46, perTile: 10, startHeight: 45, endHeight: 23, angle: 10, progress: 64 });
const IMPACT_HEIGHT = 124;
const BUSY_VARBIT = 12393;

let api = null;
let core = null;
let staff = null;

function chargesOf(item) {
  return Math.max(0, Math.min(MAX_CHARGES, Math.floor(Number(item?.getMetaValue?.(CHARGES_META_KEY)) || 0)));
}

function setCharges(item, value) {
  item.setMetaValue(CHARGES_META_KEY, Math.max(0, Math.min(MAX_CHARGES, Math.floor(value))));
}

const isStaff = (item) => item?.getId?.() === core.ItemIdentifiers.BONE_STAFF;

function maxHit(player) {
  return Math.floor(player.getSkillManager().getCurrentLevel(core.Skill.MAGIC) / 3) + 5 + Common.RAT_MAX_HIT_BONUS;
}

function flightCycles(from, to) {
  return PROJECTILE.start + Math.max(1, core.CombatPosition.projectileDistance(from, to)) * PROJECTILE.perTile;
}

function look({ Animation, Graphic, Projectile }) {
  return {
    castAnimation: () => new Animation(CAST.anim),
    startGraphic: () => new Graphic(CAST.gfx),
    castProjectile: (cast, castOn) => new Projectile(
      Projectile.centreOf(cast), castOn.getLocation(), castOn, CAST.projectile, PROJECTILE.start,
      flightCycles(cast, castOn), PROJECTILE.startHeight, PROJECTILE.endHeight, cast.getPrivateArea(),
    ).withSource(cast).withAngle(PROJECTILE.angle).withProgress(PROJECTILE.progress),
    endGraphic: () => new Graphic(CAST.impact, 0, IMPACT_HEIGHT),
  };
}

/** The captured cast's area sound, at the caster. */
function castSound(player) {
  const at = player.getLocation();
  player.getPacketSender().sendAreaSound(CAST.sound, at.getX(), at.getY(), at.getZ());
  return true;
}

/** Each cast says what is left: "Your weapon has N charges remaining." */
function chargeUsed(player, item, left) {
  player.sendMessage(`Your weapon has ${left.toLocaleString("en-US")} charges remaining.`);
}

function defineStaff() {
  const id = core.ItemIdentifiers.BONE_STAFF;
  return definePoweredStaff(api, {
    name: "Bone staff",
    chargesKey: CHARGES_META_KEY,
    maxCharges: MAX_CHARGES,
    // It has no uncharged version: an empty bone staff is still a bone staff.
    pairs: [[id, id]],
    maxHit,
    attackSpeed: ATTACK_SPEED,
    range: ATTACK_RANGE,
    // Its 35 base experience is paid on a successful hit by onHitResolved, not per cast like a
    // spellbook spell's: the Wiki gives the bone staff 35 base XP unlike other powered staves, but
    // none on a splash.
    spell: look,
    canAttack: castSound,
    chargeUsed,
    noChargesMessage: "Your Bone staff has no charges left.",
  });
}

function useCharge(player) {
  staff.useCharge(player);
}

/** Wiki: 35 base Magic experience on a successful hit. */
function onHitResolved({ attacker, hit }) {
  if (!attacker?.isPlayer?.() || !hit?.isAccurate?.() || hit.getCombatMethod?.() !== staff.method()) return;
  attacker.getAsPlayer().getSkillManager().addExperience(core.Skill.MAGIC, BASE_EXPERIENCE, true);
}

function resolveStaff(attacker) {
  return staff.resolver.resolve(attacker);
}

/** Chaos runes on the staff: how many to add, up to what the inventory holds and the staff has room for. */
function charge(event) {
  const I = core.ItemIdentifiers;
  const { player } = event;
  const ids = [Number(event.usedItemId), Number(event.usedWithItemId)];
  if (!ids.includes(I.BONE_STAFF) || !ids.includes(I.CHAOS_RUNE)) return;
  event.handled = true;
  const held = isStaff(event.usedItem) ? event.usedItem : event.usedWithItem;
  const room = MAX_CHARGES - chargesOf(held);
  if (room <= 0) {
    player.sendMessage("Your Bone staff is already fully charged.");
    return;
  }
  const most = Math.min(room, player.getInventory().getAmount(I.CHAOS_RUNE));
  const sender = player.getPacketSender();
  sender.sendVarbit(BUSY_VARBIT, 1);
  player.setEnteredAmountAction({
    acceptsZero: true,
    execute: (amount) => {
      sender.sendVarbit(BUSY_VARBIT, 0);
      const runes = Math.min(Math.max(0, Math.floor(Number(amount) || 0)), MAX_CHARGES - chargesOf(held), player.getInventory().getAmount(I.CHAOS_RUNE));
      if (runes <= 0 || !player.getInventory().getItems().includes(held)) return;
      player.getInventory().deleteNumber(I.CHAOS_RUNE, runes);
      setCharges(held, chargesOf(held) + runes);
      player.getInventory().refreshItems();
    },
  });
  sender.sendEnterAmountPrompt(`How many chaos runes do you wish to add? (0 - ${most})`);
}

function check({ player, item }) {
  player.sendMessage(`Your Bone staff has ${chargesOf(item).toLocaleString("en-US")} charges remaining.`);
  return true;
}

function uncharge({ player, item }) {
  const charges = chargesOf(item);
  if (charges <= 0) {
    player.sendMessage("Your Bone staff has no charges to remove.");
    return true;
  }
  const inventory = player.getInventory();
  const runeId = core.ItemIdentifiers.CHAOS_RUNE;
  const refund = new core.Item(runeId, charges);
  if (inventory.getAddableAmount(refund) < charges) {
    player.sendMessage("Your inventory is too full to hold the chaos runes.");
    return true;
  }
  inventory.addItem(refund);
  setCharges(item, 0);
  inventory.refreshItems();
  const { DialogueChainBuilder, ItemStatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, item.getId(), "You uncharge your Bone staff.")));
  return true;
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  staff = defineStaff();
  api.onItemAction("Bone staff", { Check: check, Uncharge: uncharge });
  api.onItemOnItem(charge, { noted: false });
  api.registerCombatMethodResolver(staff.resolver);
  api.onCombatHitResolved(onHitResolved);
}

module.exports = { attach, chargesOf, setCharges, _test: { MAX_CHARGES, CHARGES_META_KEY, maxHit, flightCycles, charge, check, uncharge, useCharge, resolveStaff } };
