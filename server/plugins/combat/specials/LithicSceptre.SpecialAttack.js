/**
 * Explosive Shatter, the Lithic sceptre's special (Wiki: Lithic sceptre). It uses 5 Shatter stacks
 * and no special attack energy (the bar keeps restoring), and "deals 150% of the player's max hit as
 * magic damage and up to 75% as typeless damage to 12 enemies within 3 tiles", the typeless part
 * at least 10 (Wiki: Demonic Pacts League/Echo bosses and echo equipment). It needs exactly 5
 * stacks (fewer refuse it, more leave the rest) and Overly Draining does not block it.
 *
 * It fires as the bar is pressed, at the player's target, without waiting for or resetting the
 * attack timer. Fewer than 5 stacks: "You need 5 Shatter stacks to use that ability." and the
 * bar stays off. The look: human_lithic_sceptre_spec_01 and vfx_lithic_sceptre_shatter_human on
 * the player with synth sound 5042; area sound 11411 at the target's centre and
 * vfx_lithic_sceptre_shatter_02 on the 8 tiles round it, vfx_lithic_sceptre_shatter_03 on the 8
 * tiles 2 away, all 30 client cycles later; the damage lands the next tick.
 *
 * Ours, where the Wiki is silent: the 3 tiles are round the target, which counts as one of the 12;
 * the magic part is the built-in spell's roll scaled by 1.5, the typeless part a uniform roll from 0
 * to 75% of the spell's max hit, raised to 10, that never misses; it takes one of the sceptre's
 * charges like a cast; with no target in reach nothing happens and the stacks are kept. The
 * typeless part counts as a powered staff attack (Wiki): its max is the spell's own, which already
 * holds the crystal blessing's bonus.
 *
 * Stacks come from the LithicSceptre plugin: `lithic-sceptre:stacks` { player, stacks, consume, consumed }.
 */
const ID = "lithic_sceptre";
const STACKS_USED = 5;
const RADIUS = 3;
const MAX_TARGETS = 12;
const MAGIC_MULTIPLIER = 1.5;
const TYPELESS_FRACTION = 0.75;
const TYPELESS_MINIMUM = 10;
const HIT_DELAY = 1;
const EFFECT_DELAY = 30;
const CAST_SOUND = 5042;
const AREA_SOUND = 11411;
const AREA_SOUND_RADIUS = 15;
const NOT_ENOUGH_STACKS = `You need ${STACKS_USED} Shatter stacks to use that ability.`;
const ANIMATION = "human_lithic_sceptre_spec_01";
const PLAYER_GRAPHIC = "vfx_lithic_sceptre_shatter_human";
const RING_GRAPHICS = ["vfx_lithic_sceptre_shatter_02", "vfx_lithic_sceptre_shatter_03"];
const DIRECTIONS = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, -1], [-1, 1]];

let api = null;
let core = null;

function wieldsSceptre(player) {
  return player?.getEquipment?.()?.get?.(core.Equipment.WEAPON_SLOT)?.getId?.() === core.ItemIdentifiers.LITHIC_SCEPTRE;
}

function stacksOf(player, consume = 0) {
  const request = { player, stacks: 0, consume, consumed: false };
  api.emitCustomEvent("lithic-sceptre:stacks", request);
  return request;
}

function staffOf(player) {
  const request = { player, spell: null };
  api.emitCustomEvent("powered-staff:spell", request);
  return request.spell ? request : null;
}

/** Pressing the bar with fewer than 5 stacks. */
function specialDisabled(event) {
  const { player } = event;
  if (event.specialAttackId !== ID || !wieldsSceptre(player)) return;
  if (stacksOf(player).stacks >= STACKS_USED) return;
  event.disabled = true;
  event.message = NOT_ENOUGH_STACKS;
}

/** No energy, whatever prices specials (Overly Draining sets every cost to 100). */
function specialCost(request) {
  if (request?.specialId !== ID) return;
  request.cost = 0;
  request.allow = true;
}

/** The target's centre tile (its south-west tile for a size-1 NPC). */
function centreOf(target) {
  const at = target.getLocation();
  const half = Math.floor(Math.max(1, target.getSize?.() ?? 1) / 2);
  return new core.Location(at.getX() + half, at.getY() + half, at.getZ());
}

/** The target, alive and within the sceptre's reach. */
function reachable(player, staff, target) {
  if (!target || target.getHitpoints?.() <= 0 || target.isRegistered?.() === false) return false;
  if (target.getLocation().getZ() !== player.getLocation().getZ()) return false;
  const { distance } = require("../../items/PoweredStaff");
  return distance(player, target, core.CombatPosition) <= staff.attackDistance(player);
}

/** The target and up to 11 more attackable enemies within 3 tiles of it. */
function victims(player, target) {
  const found = [target];
  const candidates = target.isNpc?.() ? player.getLocalNpcs() : player.getLocalPlayers();
  for (const candidate of candidates ?? []) {
    if (found.length >= MAX_TARGETS) break;
    if (candidate === target || candidate.getHitpoints() <= 0) continue;
    if (!core.CombatFactory.canAttackSecondaryTarget(player, target, candidate, RADIUS)) continue;
    found.push(candidate);
  }
  return found;
}

function sendLook(player, target) {
  const { Animation, CacheDefinitions, Graphic, Sound, Sounds } = core;
  const animation = CacheDefinitions.getSeqId(ANIMATION);
  if (animation != null) player.performAnimation(new Animation(animation));
  const graphic = CacheDefinitions.getSpotanimId(PLAYER_GRAPHIC);
  if (graphic != null) player.performGraphic(new Graphic(graphic));
  Sounds.sendSound(player, new Sound(CAST_SOUND, 1, 0, 0));
  const centre = centreOf(target);
  Sounds.playAreaSound({
    soundId: AREA_SOUND, source: target, x: centre.getX(), y: centre.getY(), level: centre.getZ(),
    delay: EFFECT_DELAY, radius: AREA_SOUND_RADIUS,
  });
  const sender = player.getPacketSender();
  RING_GRAPHICS.forEach((name, ring) => {
    const id = CacheDefinitions.getSpotanimId(name);
    if (id == null) return;
    for (const [dx, dy] of DIRECTIONS) {
      const tile = new core.Location(centre.getX() + dx * (ring + 1), centre.getY() + dy * (ring + 1), centre.getZ());
      sender.sendGraphic(new Graphic(id, EFFECT_DELAY), tile);
    }
  });
}

/** The magic and typeless hits on one victim, rolled with the built-in spell selected. */
function hitsOn(player, victim, spell) {
  const { CombatFactory, DamageFormulas, PendingHit } = core;
  // The hit queue already counts an NPC's own tick (CombatFactory.hitProcessingDelay).
  const delay = Math.max(0, HIT_DELAY - CombatFactory.hitProcessingDelay({ getTarget: () => victim }));
  const magic = new PendingHit(player, victim, CombatFactory.MAGIC_COMBAT, {
    delay, damageMultiplier: MAGIC_MULTIPLIER, ordinary: true,
  }).setSpell(spell);
  const typelessMax = Math.floor(DamageFormulas.getMagicMaxhit(player, spell, victim) * TYPELESS_FRACTION);
  const typeless = Math.max(TYPELESS_MINIMUM, Math.floor(Math.random() * (typelessMax + 1)));
  const status = new PendingHit(player, victim, CombatFactory.MAGIC_COMBAT, {
    delay, statusDamage: true, damage: typeless, handleAfterHitEffects: false,
  });
  return [magic, status];
}

/** The press: fires at the target, or does nothing. */
function explode(player) {
  const staff = staffOf(player);
  const target = player.getCombat().getTarget();
  if (!staff || staff.charges <= 0 || !reachable(player, staff, target)) return [];
  if (!stacksOf(player, STACKS_USED).consumed) {
    player.sendMessage(NOT_ENOUGH_STACKS);
    return [];
  }
  staff.useCharge();
  sendLook(player, target);
  const combat = player.getCombat();
  const previous = combat.getCastSpell?.() ?? null;
  combat.setCastSpell(staff.spell);
  const hits = [];
  try {
    for (const victim of victims(player, target)) hits.push(...hitsOn(player, victim, staff.spell));
  } finally {
    combat.setCastSpell(previous);
  }
  for (const hit of hits) core.CombatFactory.addPendingHit(hit);
  return hits;
}

function buildSpecial() {
  const { MeleeCombatMethod } = core;

  // A utility special (CombatSpecial.activateUtility): start() runs on the press.
  class ExplosiveShatterMethod extends MeleeCombatMethod {
    start(character) {
      if (character?.isPlayer?.()) explode(character.getAsPlayer());
    }
  }

  return {
    id: ID,
    itemIds: [core.ItemIdentifiers.LITHIC_SCEPTRE],
    drainAmount: 0,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    combatMethod: new ExplosiveShatterMethod(),
  };
}

module.exports = function registerLithicSceptreSpecialAttack(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.registerCombatSpecial(buildSpecial());
  pluginApi.onSpecialAttackDisabled(specialDisabled);
  pluginApi.onCustomEvent("combat-special:cost", specialCost);
};

module.exports._test = {
  specialDisabled, specialCost, victims, explode, centreOf, ID, STACKS_USED, MAGIC_MULTIPLIER, TYPELESS_FRACTION, TYPELESS_MINIMUM, MAX_TARGETS, RADIUS, NOT_ENOUGH_STACKS,
};
