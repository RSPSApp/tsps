/**
 * Scurrius' Combat Achievements beyond his kill counts (Wiki: Scurrius/Combat Achievements):
 * - Sit Rat: finish him off in a private instance with a ratbane weapon (the rat bone mace,
 *   shortbow or staff, Fight's ratbaneIds) in hand. It is the weapon held when the killing hit
 *   lands, and the task completes then: on the tick his hitpoints reach 0, before the death
 *   animation (rsprox_transcripts/227/00083.txt, tick 21236), not at the death event 5 ticks on.
 * - Perfect Scurrius: kill him in a private instance without damage from Tail Swipe (his melee) or
 *   Falling Bricks (the rubble after a stomp), praying correctly as each Flying Fur (ranged) and
 *   Bolt of Electricity (magic) lands: Protect from Missiles or Protect from Magic. The landing is
 *   when the fight rolls them, so a late flick counts (Fight.distantHitLands).
 * - Efficient Pest Control: kill six of his giant rats within 3 seconds (5 ticks). One a tick is
 *   the most a player can kill, rat bone weapons having no attack delay against them, so the six
 *   deaths may span at most 5 ticks.
 * Each boss spawn is a new NPC (Lair.spawnBoss), so a fight's slips are kept by its NPC.
 */
const Common = require("./Common.Scurrius");
const Fight = require("./Fight.Scurrius");

const SIT_RAT = "Sit Rat";
const PERFECT = "Perfect Scurrius";
const PEST_CONTROL = "Efficient Pest Control";
const PEST_CONTROL_RATS = 6;
/** 3 seconds. */
const PEST_CONTROL_TICKS = 5;

let api = null;
let core = null;
/** Scurrius -> the players who were hit by a swipe or rubble, or let a fur ball or bolt land unprayed. */
const slips = new WeakMap();
/** Player -> the ticks their last rat kills died on, oldest first. */
const ratKills = new WeakMap();

function complete(player, task) {
  api.emitCustomEvent("combat-achievements:complete", { player, task });
}

function slip(npc, player) {
  if (!Common.isScurrius(npc) || !player?.isPlayer?.()) return;
  let players = slips.get(npc);
  if (!players) slips.set(npc, (players = new Set()));
  players.add(player);
}

/** His tail swipe that does damage, or a fur ball or bolt that lands without the right prayer. */
function onHitResolved({ attacker, target, hit }) {
  if (!Common.isScurrius(attacker) || !target?.isPlayer?.()) return;
  const { CombatType, PrayerHandler } = core;
  const type = hit?.getCombatType?.();
  if (type === CombatType.MELEE) {
    if (Number(hit.getTotalDamage?.() ?? 0) > 0) slip(attacker, target);
  } else if (type === CombatType.RANGED || type === CombatType.MAGIC) {
    const prayer = type === CombatType.RANGED ? PrayerHandler.PROTECT_FROM_MISSILES : PrayerHandler.PROTECT_FROM_MAGIC;
    if (!PrayerHandler.isActivated(target, prayer)) slip(attacker, target);
  }
}

/**
 * Damage taking a private Scurrius to 0 hitpoints (Mobile.decrementHealth, after his hitpoints
 * are set): the killing hit, the only one that can, since a dead NPC loses no more health.
 */
function onDamageApplied({ target, hit }) {
  if (!Common.isScurrius(target) || Common.isPublic(target) || !(target.getHitpoints?.() <= 0)) return;
  const killer = hit?.getSource?.();
  if (!killer?.isPlayer?.()) return;
  const weapon = killer.getEquipment?.()?.get(core.Equipment.WEAPON_SLOT)?.getId?.();
  if (Fight.ratbaneIds().has(weapon)) complete(killer, SIT_RAT);
}

/** The rubble landing on a player (Fight.stomp). */
function onRockfall({ npc, player }) {
  slip(npc, player);
}

function bossDied(npc, killer, damagers) {
  if (Common.isPublic(npc)) return;
  const failed = slips.get(npc);
  slips.delete(npc);
  const players = [...new Set([killer, ...(damagers ?? [])])].filter((player) => player?.isPlayer?.());
  for (const player of players) {
    if (!failed?.has(player)) complete(player, PERFECT);
  }
}

function ratDied(killer) {
  if (!killer?.isPlayer?.()) return;
  const now = core.World.getProcessCycle();
  const ticks = (ratKills.get(killer) ?? []).filter((tick) => now - tick <= PEST_CONTROL_TICKS);
  ticks.push(now);
  ratKills.set(killer, ticks.slice(-PEST_CONTROL_RATS));
  if (ticks.length >= PEST_CONTROL_RATS) complete(killer, PEST_CONTROL);
}

function onNpcDeath({ npc, killer, damagers }) {
  if (Common.isScurrius(npc)) bossDied(npc, killer, damagers);
  else if (Common.isRat(npc)) ratDied(killer);
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  api.onCombatHitResolved(onHitResolved);
  api.onNpcDeath(onNpcDeath);
  api.onCustomEvent("scurrius:rockfall-hit", onRockfall);
  api.onCustomEvent("combat:damage-applied", onDamageApplied);
}

module.exports = {
  attach,
  _test: { onHitResolved, onDamageApplied, onRockfall, onNpcDeath, slips, PEST_CONTROL_TICKS, PEST_CONTROL_RATS },
};
