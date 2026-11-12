/**
 * Last Stand (https://oldschool.runescape.wiki/w/Last_Stand_(Raging_Echoes_League)), Raging
 * Echoes' tier 8 relic (the catalog's tier 6 copy is an alias): damage that would kill leaves the
 * player at 1 hitpoint, boosts Attack, Strength, Defence, Ranged and Magic to 255, draining 16 a
 * tick back to base + 15, and for 16 ticks no hit can finish them and nothing heals them above
 * 1 (food is refused; any other heal is undone on the next tick: ours, the Wiki names no means).
 * When the window closes they are healed by the damage their hits did as they landed in it, up to their max (ours:
 * the Wiki shows a bar and gives no formula). Once every three minutes or death.
 */
const Common = require("./Common.LeagueRelics");

/** When the relic may fire again (ms since the epoch); 0 when it may. */
const READY_AT_ATTRIBUTE = "league:last-stand-ready-at";
/**
 * Saved true while a stand's boosts are above where its drain ends: a save that no logout settles (a shutdown or
 * tick-error save, a crash after an autosave) is settled at the next login instead.
 */
const DRAINING_ATTRIBUTE = "league:last-stand-draining";

let api;
let core;
let effect;
let skills;

/** The open stands: player -> { until (cycle), dealt, boosted: Skill[] }. */
const stands = new WeakMap();

function active(player) {
  return Common.effectActive(player, effect);
}

function boostedSkills() {
  if (!skills) skills = effect.skills.map((name) => core.Skill[name]).filter(Boolean);
  return skills;
}

function standing(player) {
  const stand = stands.get(player);
  return stand && core.World.getProcessCycle() < stand.until ? stand : null;
}

/** One tick: the boosts fall 16 toward base + 15; the stand ends with its heal. */
function tick(player) {
  const stand = stands.get(player);
  if (!stand || !player.isRegistered()) return false;
  const manager = player.getSkillManager();
  // Nothing heals above 1 during the stand (the Wiki); a heal that slipped through is undone.
  if (core.World.getProcessCycle() < stand.until && player.getHitpoints() > 1) player.setHitpoints(1);
  let draining = false;
  for (const skill of stand.boosted) {
    const floor = manager.getMaxLevel(skill) + effect.drainFloorAboveBase;
    const level = manager.getCurrentLevel(skill);
    if (level <= floor) continue;
    manager.setCurrentLevel(skill, Math.max(floor, level - effect.drainPerTick), true);
    draining = true;
  }
  if (core.World.getProcessCycle() < stand.until) return true;
  if (stand.dealt > 0 && player.getHitpoints() > 0) player.heal(Math.min(stand.dealt, manager.getMaxLevel(core.Skill.HITPOINTS)));
  stand.dealt = 0;
  if (!draining) end(player);
  return draining;
}

function end(player) {
  stands.delete(player);
  if (player.getAttribute?.(DRAINING_ATTRIBUTE) === true) player.setAttribute(DRAINING_ATTRIBUTE, false);
}

/** The boosts settled to where the drain ends (base + 15). */
function settle(player) {
  const manager = player.getSkillManager();
  for (const skill of boostedSkills()) {
    const floor = manager.getMaxLevel(skill) + effect.drainFloorAboveBase;
    if (manager.getCurrentLevel(skill) > floor) manager.setCurrentLevel(skill, floor, true);
  }
  end(player);
}

function watch(player) {
  const task = new (class extends core.Task {
    constructor() {
      super(1, player, false);
    }

    execute() {
      if (!tick(player)) this.stop();
    }
  })();
  core.TaskManager.submit(task);
}

function begin(player, now) {
  const manager = player.getSkillManager();
  const boosted = boostedSkills();
  for (const skill of boosted) manager.setCurrentLevel(skill, effect.boostedLevel, true);
  stands.set(player, { until: core.World.getProcessCycle() + effect.windowTicks, dealt: 0, boosted });
  player.setAttribute(DRAINING_ATTRIBUTE, true);
  player.setAttribute(READY_AT_ATTRIBUTE, now + effect.cooldownMs);
  watch(player);
  api.emitCustomEvent("league:relic-triggered", { player, relic: effect.key });
}

function beforeDeath(event) {
  const { player } = event;
  if (event.preventDeath || !active(player)) return;
  if (standing(player)) {
    event.preventDeath = true;
    player.setHitpoints(1);
    return;
  }
  const now = Date.now();
  if (now < (Number(player.getAttribute(READY_AT_ATTRIBUTE)) || 0)) return;
  event.preventDeath = true;
  player.setHitpoints(1);
  begin(player, now);
}

/**
 * Each of the player's hits counts when it lands (HitDamage.onApplied), for the damage it did, and
 * only while a stand is open then: an impact cancelled before it lands (the target teleported)
 * counts nothing, a shot launched before the stand counts if it lands in it, one landing after
 * the window does not.
 */
function dealtDamage({ player, hit }) {
  if (!active(player)) return;
  for (const damage of hit?.getHits?.() ?? []) {
    damage?.onApplied?.((taken) => {
      const stand = standing(player);
      if (stand) stand.dealt += Math.max(0, Number(taken) || 0);
    });
  }
}

/** Food is refused during the stand (the Wiki: nothing raises the player above 1). */
function refuseFood(event) {
  if (!standing(event.player)) return;
  event.allow = false;
  event.player.sendMessage(Common.message("lastStandNoFood"));
}

/** The phoenix necklace asks without eating: no healing while standing. */
function necklaceEligible(event) {
  if (standing(event.player)) event.blocked = true;
}

/**
 * A logout mid-stand stops its drain task, and the save keeps current levels: the boosts are settled to where the
 * drain ends (base + 15) first, so nobody logs back in at 255.
 */
function settleOnLogout({ player }) {
  if (stands.has(player)) settle(player);
}

/** A save written mid-stand without a logout (shutdown, tick error) still holds the boosts: settled on entering. */
function settleOnLogin({ player }) {
  if (player?.getAttribute?.(DRAINING_ATTRIBUTE) === true && !stands.has(player)) settle(player);
}

/** A real death ends the cooldown (Wiki). */
function death({ player }) {
  if (Number(player?.getAttribute?.(READY_AT_ATTRIBUTE)) > 0) player.setAttribute(READY_AT_ATTRIBUTE, 0);
  if (player) end(player);
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  effect = Common.data.effects.lastStand;
  api.persistAttribute(READY_AT_ATTRIBUTE, 0);
  api.persistAttribute(DRAINING_ATTRIBUTE, false);
  api.onPlayerBeforeDeath(beforeDeath);
  api.onPlayerDealtDamage(dealtDamage);
  api.onCanEat(refuseFood);
  api.onCustomEvent("phoenix-necklace:eligible", necklaceEligible);
  api.onPlayerDeath(death);
  api.onPlayerLogout(settleOnLogout);
  api.onPlayerLogin(settleOnLogin);
};
