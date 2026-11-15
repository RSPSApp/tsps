/**
 * Disease (https://oldschool.runescape.wiki/w/Disease): varp `disease`, positive while diseased and
 * negative while immune, one step towards 0 every 30 ticks.
 *
 * Recorded (rsprox_transcripts/235/00944.txt ticks 3052-3659, 231/03034.txt, 227/910307.txt):
 * - "You have become diseased!" (game message) as the varp is set to the source's value (20, 40).
 * - Every 30 ticks the varp falls by 1, and on the next tick one skill drops by ceil(value / 5)
 *   with hitsplat 4 (20 -> 19: 4, 15 -> 14: 3, 5 -> 4: 1, 1 -> 0: 1); at 0 it ends with no line.
 * - A Sanfew serum takes 50 off and leaves -50 (39 -> -11 -> -50, 0 -> -50): fifteen minutes of
 *   immunity, which counts back up by 1 every 30 ticks.
 * Wiki: the drained skill is any but Hitpoints and Prayer, all equally likely; one already at 1
 * takes the damage on Hitpoints instead (so disease can kill). Reapplying resets it to the source's
 * value. An inoculation bracelet stops the drain and the damage, but does not cure. Death cures it.
 *
 *   "disease:inflict" { player, value }               diseases a player who isn't immune
 *   "disease:cure"    { player, amount?, immunity? }   takes `amount` off (all when absent); once
 *                                                     cured, leaves `immunity` steps of immunity
 *                                                     (sets `cured`)
 *   "disease:state"   { player } -> value             the varp's value (0 = neither)
 */
const DISEASE_ATTRIBUTE = "disease:value";
const STEP_TICKS = 30;
const STRENGTH_STEP = 5;
/** The cache's hitsplat 4 (unnamed), recorded on every disease drain. */
const DISEASE_SPLAT = 4;
const INOCULATION_BRACELET = "Inoculation bracelet";
const DISEASED_LINE = "You have become diseased!";

let core = null;
const tasks = new WeakMap();

function valueOf(player) {
  const value = Number(player.getAttribute(DISEASE_ATTRIBUTE) ?? 0);
  return Number.isSafeInteger(value) ? value : 0;
}

function set(player, value) {
  player.setAttribute(DISEASE_ATTRIBUTE, value);
  player.getPacketSender().sendConfig(core.CacheDefinitions.getVarpId("disease"), value);
  restart(player, value);
}

/** The 30-tick clock restarts whenever the varp is set (recorded: Sanfew at 1926, next step 1956). */
function restart(player, value) {
  tasks.get(player)?.stop();
  tasks.delete(player);
  if (value === 0) return;
  const task = new (class extends core.Task {
    constructor() {
      super(STEP_TICKS, player, false);
    }
    execute() {
      step(player, this);
    }
  })();
  tasks.set(player, task);
  core.TaskManager.submit(task);
}

function step(player, task) {
  if (tasks.get(player) !== task || !player.isRegistered?.()) {
    task.stop();
    return;
  }
  const value = valueOf(player);
  if (value === 0) {
    task.stop();
    tasks.delete(player);
    return;
  }
  const next = value > 0 ? value - 1 : value + 1;
  player.setAttribute(DISEASE_ATTRIBUTE, next);
  player.getPacketSender().sendConfig(core.CacheDefinitions.getVarpId("disease"), next);
  if (value > 0) later(player, 1, () => drain(player, Math.ceil(value / STRENGTH_STEP)));
  if (next === 0) {
    task.stop();
    tasks.delete(player);
  }
}

function later(player, ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(ticks, player, false);
    }
    execute() {
      this.stop();
      if (player.isRegistered?.() && player.getHitpoints() > 0) action();
    }
  })());
}

function wearsBracelet(player) {
  return player.getEquipment().getItems().some((item) => item && item.getId() > 0
    && core.CacheDefinitions.getItem(item.getId())?.name === INOCULATION_BRACELET);
}

/** One skill (not Hitpoints or Prayer) drops by `amount`; one at 1 passes it to Hitpoints. */
function drain(player, amount) {
  if (wearsBracelet(player)) {
    player.showHitsplat(0, { mine: DISEASE_SPLAT, others: DISEASE_SPLAT });
    return;
  }
  const { Skill, HitDamage, HitMask } = core;
  const skills = Skill.values().filter((skill) => skill !== Skill.HITPOINTS && skill !== Skill.PRAYER);
  const skill = skills[Math.floor(Math.random() * skills.length)];
  const manager = player.getSkillManager();
  const level = manager.getCurrentLevel(skill);
  if (level <= 1) {
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(amount, HitMask.RED).setSplatTypes(DISEASE_SPLAT, DISEASE_SPLAT)]);
    return;
  }
  manager.setCurrentLevel(skill, Math.max(1, level - amount), true);
  player.showHitsplat(amount, { mine: DISEASE_SPLAT, others: DISEASE_SPLAT });
}

function inflict({ player, value }) {
  const amount = Math.trunc(Number(value));
  if (!player?.isPlayer?.() || !(amount > 0) || valueOf(player) < 0) return;
  const was = valueOf(player);
  set(player, amount);
  if (was <= 0) player.sendMessage(DISEASED_LINE);
}

function cure(request) {
  const { player } = request ?? {};
  if (!player?.isPlayer?.()) return;
  const value = valueOf(player);
  const amount = request.amount == null ? Math.max(0, value) : Math.max(0, Math.trunc(Number(request.amount)) || 0);
  const immunity = Math.max(0, Math.trunc(Number(request.immunity)) || 0);
  const left = value > 0 ? value - amount : 0;
  request.cured = left <= 0;
  if (left > 0) set(player, left);
  // Immunity never shortens one already running.
  else if (immunity > 0) set(player, Math.min(value < 0 ? value : 0, -immunity));
  else if (value > 0) set(player, 0);
}

function state(request) {
  if (request?.player?.isPlayer?.()) request.value = valueOf(request.player);
}

/** Wiki: death and respawn cure disease, safe minigames included. Immunity is left as it was. */
function cureOnDeath({ player }) {
  if (player && valueOf(player) > 0) set(player, 0);
}

/** Wiki: the ornate rejuvenation pool cures disease (as Ferox Enclave's pool, -1). */
function poolRestored({ player, tier }) {
  if (player && tier >= 4) cure({ player, immunity: 1 });
}

function login({ player }) {
  const value = valueOf(player);
  if (value === 0) return;
  player.getPacketSender().sendConfig(core.CacheDefinitions.getVarpId("disease"), value);
  restart(player, value);
}

function logout({ player }) {
  tasks.get(player)?.stop();
  tasks.delete(player);
}

module.exports = {
  name: "Disease",
  description: "Disease: the disease varp, its skill drain every 18 seconds, its immunity, and the cures that end it.",
  members: true,
  register(api) {
    core = api.core;
    api.persistAttribute(DISEASE_ATTRIBUTE, 0);
    api.onCustomEvent("disease:inflict", inflict);
    api.onCustomEvent("disease:cure", cure);
    api.onCustomEvent("disease:state", state);
    api.onCustomEvent("rejuvenation-pool:restored", poolRestored);
    api.onPlayerDeath(cureOnDeath);
    api.onPlayerLogin(login);
    api.onPlayerLogout(logout);
  },
};
