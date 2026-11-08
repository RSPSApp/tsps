// Soulreaper axe (https://oldschool.runescape.wiki/w/Soulreaper_axe, after the 22 July 2026 update).
// Soul stacks: every attack with the axe, even a miss, adds a stack after its damage is rolled, up to
// five. Each adds 6% to the Strength level for the axe only, additively with Piety. With no attack for
// 50 ticks one stack is lost, then another every 50 ticks. Gaining one no longer costs hitpoints.
// Behead, the special, costs no energy and consumes every stack: per stack, +12% accuracy, +6% max hit
// and a minimum hit of 6% of the max. The stacks' Strength boost doesn't apply to it.
const ID = "soulreaper_axe";
const STACKS_ATTRIBUTE = "soulreaper-axe:soul-stacks";
const SOULREAPER_STACKS_VARP = 3784; // RuneLite VarPlayerID.SOULREAPER_STACKS
const MAX_STACKS = 5;
const STACK_STRENGTH_PERCENT = 6;
const DECAY_TICKS = 50;
const ACCURACY_PER_STACK = 0.12;
const DAMAGE_PER_STACK = 0.06;
// RuneLite AnimationID.ANCIENT_AXE_SPECIAL / SpotanimID.ANCIENT_AXE_SPECIAL_SPOTANIM (_ORN).
const BEHEAD_ANIMATION = 10173;
const BEHEAD_GRAPHIC = 2430;
const BEHEAD_GRAPHIC_ORNAMENT = 4008;

let core;
let axeIds = new Set();
const decayTasks = new WeakMap();

function stacks(player) {
  return Math.max(0, Math.min(MAX_STACKS, Number(player.getAttribute(STACKS_ATTRIBUTE)) || 0));
}

function setStacks(player, value) {
  player.setAttribute(STACKS_ATTRIBUTE, value);
  player.getPacketSender().sendConfig(SOULREAPER_STACKS_VARP, value);
}

function wieldsAxe(player) {
  return axeIds.has(player.getEquipment().get(core.Equipment.WEAPON_SLOT).getId());
}

function beheading(player) {
  return player.isSpecialActivated() && player.getCombatSpecial()?.getId() === ID;
}

/** Restarts the 50-tick countdown: each run of it without an attack loses one stack. Logout cancels it. */
function restartDecay(player) {
  decayTasks.get(player)?.stop();
  if (stacks(player) === 0) return;
  const task = new (class extends core.Task {
    constructor() { super(DECAY_TICKS, player, false); }
    execute() {
      const left = Math.max(0, stacks(player) - 1);
      setStacks(player, left);
      if (left === 0) this.stop();
    }
  })();
  decayTasks.set(player, task);
  core.TaskManager.submit(task);
}

/** After each roll of an axe attack: Behead consumes the stacks, any other attack adds one. */
function afterHitRolled({ attacker, combatType }) {
  if (!attacker?.isPlayer?.() || combatType !== core.CombatType.MELEE) return;
  const player = attacker.getAsPlayer();
  if (!wieldsAxe(player)) return;
  setStacks(player, beheading(player) ? 0 : Math.min(MAX_STACKS, stacks(player) + 1));
  restartDecay(player);
}

function soulStackStrength(entity, percent) {
  if (!entity?.isPlayer?.()) return percent;
  const player = entity.getAsPlayer();
  if (!wieldsAxe(player) || beheading(player)) return percent;
  return percent + stacks(player) * STACK_STRENGTH_PERCENT;
}

function beheadTraits(player) {
  const consumed = stacks(player);
  return {
    accuracyMultiplier: 1 + consumed * ACCURACY_PER_STACK,
    damageMultiplier: 1 + consumed * DAMAGE_PER_STACK,
    minimumDamageMultiplier: consumed * DAMAGE_PER_STACK,
  };
}

function resumeStacks({ player }) {
  player.getPacketSender().sendConfig(SOULREAPER_STACKS_VARP, stacks(player));
  restartDecay(player);
}

function buildSpecial(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod } = api.core;
  const animation = new Animation(BEHEAD_ANIMATION);
  const graphic = new Graphic(BEHEAD_GRAPHIC);
  const ornamentGraphic = new Graphic(BEHEAD_GRAPHIC_ORNAMENT);

  class BeheadCombatMethod extends MeleeCombatMethod {
    start(character) {
      const ornament = character.getEquipment().get(core.Equipment.WEAPON_SLOT).getId() === ItemIdentifiers.SOULREAPER_AXE_O_;
      character.performAnimation(animation);
      character.performGraphic(ornament ? ornamentGraphic : graphic);
      // Behead costs no energy, but it is a special attack performed ("combat-special:performed" rides on drain).
      CombatSpecial.drain(character, 0, false);
    }
  }

  return {
    id: ID,
    itemIds: [...axeIds],
    drainAmount: 0,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traitsFor: beheadTraits,
    combatMethod: new BeheadCombatMethod(),
  };
}

function registerSoulreaperAxeSpecialAttack(api) {
  core = api.core;
  const { ItemIdentifiers } = core;
  axeIds = new Set([ItemIdentifiers.SOULREAPER_AXE, ItemIdentifiers.SOULREAPER_AXE_2, ItemIdentifiers.SOULREAPER_AXE_O_]);
  api.persistAttribute(STACKS_ATTRIBUTE, 0);
  api.registerCombatSpecial(buildSpecial(api));
  api.registerMeleeStrengthPercentModifier(soulStackStrength);
  api.onCombatHitDamage(afterHitRolled);
  api.onPlayerLogin(resumeStacks);
}

module.exports = registerSoulreaperAxeSpecialAttack;
module.exports._test = { STACKS_ATTRIBUTE, stacks, beheadTraits, soulStackStrength, afterHitRolled };
