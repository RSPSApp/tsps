/**
 * The bone staff (Wiki: Bone staff; captured, docs/scurrius.md): a powered staff charged with chaos
 * runes, one a cast, up to 20,000; uncharging returns them all.
 * - Chaos runes on the staff ask "How many chaos runes do you wish to add? (0 - N)", N being what
 *   the inventory holds or the staff has room for; full: "Your Bone staff is already fully charged.".
 * - Check: "Your Bone staff has N charges remaining."; Uncharge: "You uncharge your Bone staff." in
 *   an item box, or "Your Bone staff has no charges to remove.".
 * - Its spell: max hit floor(Magic / 3) + 5, and the rat bone +10 (it can only attack rats), 4-tick
 *   attack speed, 8 tiles, 35 base experience. Captured cast: animation 393, graphic 2645, area sound
 *   7617, projectile 2647 (cycles 46 to 46 + 10 a tile, height 45 to 23, angle 10, progress 64), impact
 *   2646 (height 124), and "Your weapon has N charges remaining." with each cast.
 */
const Common = require("./Common.RatBoneWeapons");

const MAX_CHARGES = 20000;
const CHARGES_META_KEY = "bone-staff-charges";
const ATTACK_SPEED = 4;
const ATTACK_RANGE = 8;
const BASE_EXPERIENCE = 35;
const CAST = Object.freeze({ anim: 393, gfx: 2645, projectile: 2647, impact: 2646, sound: 7617 });
const PROJECTILE = Object.freeze({ start: 46, perTile: 10, startHeight: 45, endHeight: 23, angle: 10, progress: 64 });
const IMPACT_HEIGHT = 124;
const BUSY_VARBIT = 12393;

let api = null;
let core = null;
let StaffMethod = null;
const spells = new WeakMap();

function chargesOf(item) {
  return Math.max(0, Math.min(MAX_CHARGES, Math.floor(Number(item?.getMetaValue?.(CHARGES_META_KEY)) || 0)));
}

function setCharges(item, value) {
  item.setMetaValue(CHARGES_META_KEY, Math.max(0, Math.min(MAX_CHARGES, Math.floor(value))));
}

const isStaff = (item) => item?.getId?.() === core.ItemIdentifiers.BONE_STAFF;
const wieldsStaff = (player) => isStaff(Common.wielded(player));

function maxHit(player) {
  return Math.floor(player.getSkillManager().getCurrentLevel(core.Skill.MAGIC) / 3) + 5 + Common.RAT_MAX_HIT_BONUS;
}

function flightCycles(from, to) {
  return PROJECTILE.start + Math.max(1, from.getLocation().getDistance(to.getLocation())) * PROJECTILE.perTile;
}

function spellFor(player) {
  let spell = spells.get(player);
  if (spell) return spell;
  const { CombatNormalSpell, Animation, Graphic, Projectile } = core;
  spell = new CombatNormalSpell({
    spellId: () => core.ItemIdentifiers.BONE_STAFF,
    maximumHit: () => maxHit(player),
    castAnimation: () => new Animation(CAST.anim),
    startGraphic: () => new Graphic(CAST.gfx),
    castProjectile: (cast, castOn) => new Projectile(
      Projectile.centreOf(cast), castOn.getLocation(), castOn, CAST.projectile, PROJECTILE.start,
      flightCycles(cast, castOn), PROJECTILE.startHeight, PROJECTILE.endHeight, cast.getPrivateArea(),
    ).withSource(cast).withAngle(PROJECTILE.angle).withProgress(PROJECTILE.progress),
    endGraphic: () => new Graphic(CAST.impact, 0, IMPACT_HEIGHT),
    // Awarded on a successful hit by onHitResolved, not per cast like a spellbook spell's: the Wiki
    // gives the bone staff 35 base XP unlike other powered staves, but none on a splash.
    baseExperience: () => 0,
    levelRequired: () => 1,
  });
  spells.set(player, spell);
  return spell;
}

function useCharge(player) {
  const staff = Common.wielded(player);
  const left = chargesOf(staff) - 1;
  setCharges(staff, left);
  player.sendMessage(`Your weapon has ${Math.max(0, left).toLocaleString("en-US")} charges remaining.`);
}

function staffMethod() {
  if (StaffMethod) return StaffMethod;
  const { MagicCombatMethod, PendingHit } = core;
  StaffMethod = new (class extends MagicCombatMethod {
    canAttack(character) {
      const player = character.getAsPlayer();
      if (chargesOf(Common.wielded(player)) <= 0) {
        player.sendMessage("Your Bone staff has no charges left.");
        player.getCombat().reset();
        return false;
      }
      // The built-in spell is the only one it casts, whatever is selected or autocast.
      player.getCombat().setCastSpell(spellFor(player));
      const at = player.getLocation();
      player.getPacketSender().sendAreaSound(CAST.sound, at.getX(), at.getY(), at.getZ());
      useCharge(player);
      return true;
    }

    canPursue(character) {
      return chargesOf(Common.wielded(character.getAsPlayer())) > 0;
    }

    hits(character, target) {
      const spell = spellFor(character.getAsPlayer());
      const hit = new PendingHit(character, target, this, MagicCombatMethod.hitDelay(character, target, spell));
      spell.onHitCalc(hit);
      return [hit];
    }

    attackSpeed() {
      return ATTACK_SPEED;
    }

    attackDistance() {
      return ATTACK_RANGE;
    }

    finished(character) {
      const combat = character.getCombat();
      combat.setPreviousCast(spellFor(character.getAsPlayer()));
      combat.setCastSpell(null);
    }
  })();
  return StaffMethod;
}

/** Wiki: 35 base Magic experience on a successful hit. */
function onHitResolved({ attacker, hit }) {
  if (!attacker?.isPlayer?.() || !hit?.isAccurate?.() || hit.getCombatMethod?.() !== StaffMethod) return;
  attacker.getAsPlayer().getSkillManager().addExperience(core.Skill.MAGIC, BASE_EXPERIENCE, true);
}

function resolveStaff(attacker) {
  return attacker?.isPlayer?.() && wieldsStaff(attacker.getAsPlayer()) ? staffMethod() : null;
}

/** Chaos runes on the staff: how many to add, up to what the inventory holds and the staff has room for. */
function charge(event) {
  const I = core.ItemIdentifiers;
  const { player } = event;
  const ids = [Number(event.usedItemId), Number(event.usedWithItemId)];
  if (!ids.includes(I.BONE_STAFF) || !ids.includes(I.CHAOS_RUNE)) return;
  event.handled = true;
  const staff = isStaff(event.usedItem) ? event.usedItem : event.usedWithItem;
  const room = MAX_CHARGES - chargesOf(staff);
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
      const runes = Math.min(Math.max(0, Math.floor(Number(amount) || 0)), MAX_CHARGES - chargesOf(staff), player.getInventory().getAmount(I.CHAOS_RUNE));
      if (runes <= 0 || !player.getInventory().getItems().includes(staff)) return;
      player.getInventory().deleteNumber(I.CHAOS_RUNE, runes);
      setCharges(staff, chargesOf(staff) + runes);
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
  if (!inventory.contains(runeId) && inventory.getFreeSlots() < 1) {
    player.sendMessage("Your inventory is too full to hold the chaos runes.");
    return true;
  }
  inventory.addItem(new core.Item(runeId, charges));
  setCharges(item, 0);
  inventory.refreshItems();
  const { DialogueChainBuilder, ItemStatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, item.getId(), "You uncharge your Bone staff.")));
  return true;
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  api.onItemAction("Bone staff", { Check: check, Uncharge: uncharge });
  api.onItemOnItem(charge, { noted: false });
  api.registerCombatMethodResolver({ resolve: resolveStaff });
  api.onCombatHitResolved(onHitResolved);
}

module.exports = { attach, chargesOf, setCharges, _test: { MAX_CHARGES, CHARGES_META_KEY, maxHit, flightCycles, charge, check, uncharge, useCharge, resolveStaff } };
