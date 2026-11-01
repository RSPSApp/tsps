/**
 * Flask of Fervour (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic Pacts'
 * tier 8 relic. The flask (from the cache's relic struct), Activated: hitpoints, prayer and special
 * attack energy to full and poison cured (237/01164 clears the poison varp), with the recording's
 * line, animation, graphic and sound; for the next 2.4 seconds (four ticks) every hit on the
 * player is 0 (`combat:damage-apply`), and three explosions (ours: one every two ticks, from the
 * first) each deal 60% of the base Prayer level as a typeless hit to every attackable NPC within
 * three tiles, Yama spared. Then three minutes of cooldown, a tick (0.6 seconds) shorter for every
 * 10 damage one of the player's hits deals; Activate or Check meanwhile says how long is left
 * ("on cooldown for another N seconds!", 237/01164), and its end says the flask is ready.
 * Not here: the explosions on players in PvP (30%), the impact map graphics, and the cooldown
 * varp (league_relic_flask_of_fervour_cooldown: live sends it in map_clock ticks, which this
 * server does not keep).
 */
const Common = require("./Common.LeagueRelics");

/** When the flask may be used again (ms since the epoch); 0 when it may. */
const READY_AT_ATTRIBUTE = "league:flask-of-fervour-ready-at";
const TICK_MS = 600;

let api;
let core;
let effect;

/** Players untouchable until (ms since the epoch). */
const shielded = new WeakMap();
/** The pending "ready" task, per player, so a shortened cooldown restarts it. */
const readyTasks = new WeakMap();

function active(player) {
  return Common.effectActive(player, effect);
}

function readyAt(player) {
  return Number(player.getAttribute(READY_AT_ATTRIBUTE)) || 0;
}

function text(key, values = {}) {
  return effect.messages[key].replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
}

/** Says the time left; true while the flask is cooling down. */
function coolingDown(player) {
  const left = readyAt(player) - Date.now();
  if (left <= 0) return false;
  player.sendMessage(text("cooldown", { seconds: Math.ceil(left / 1000) }));
  return true;
}

function scheduleReady(player) {
  readyTasks.get(player)?.stop?.();
  const ticks = Math.max(1, Math.ceil((readyAt(player) - Date.now()) / TICK_MS));
  const task = new core.CountdownTask(player, ticks, () => {
    readyTasks.delete(player);
    if (readyAt(player) > Date.now()) return;
    player.setAttribute(READY_AT_ATTRIBUTE, 0);
    player.sendMessage(text("ready"));
  });
  readyTasks.set(player, task);
  core.TaskManager.submit(task);
}

function enemiesAround(player) {
  const { CombatFactory, CanAttackResponse, TimerKey } = core;
  const here = player.getLocation();
  return player.getLocalNpcs().filter((npc) => npc.getHitpoints() > 0
    && npc.getLocation().getZ() === here.getZ() && npc.getLocation().isWithinDistance(here, effect.radius)
    && !effect.spared.includes(npc.getDefinition?.()?.getName?.())
    && CombatFactory.validTarget(player, npc)
    && npc.getCurrentDefinition().isAttackable()
    && !npc.getTimers().has(TimerKey.ATTACK_IMMUNITY)
    && CombatFactory.canAttackByPolicy(player, npc) === CanAttackResponse.CAN_ATTACK);
}

function explode(player) {
  const { HitDamage, HitMask, Skill } = core;
  const damage = Math.floor(player.getSkillManager().getMaxLevel(Skill.PRAYER) * effect.prayerFraction);
  if (damage <= 0) return;
  for (const npc of enemiesAround(player)) {
    npc.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.RED).setSource(player)]);
  }
}

function activate(event) {
  const { player } = event;
  if (!active(player)) return false;
  event.handled = true;
  if (coolingDown(player)) return true;
  const { Skill, Animation, Graphic } = core;
  const skills = player.getSkillManager();
  player.setHitpoints(skills.getMaxLevel(Skill.HITPOINTS));
  skills.setCurrentLevel(Skill.PRAYER, skills.getMaxLevel(Skill.PRAYER), true);
  Common.restoreSpecial(player, 100);
  player.setPoisonDamage?.(0);
  player.performAnimation(new Animation(core.CacheDefinitions.getSeqId(effect.animation)));
  player.performGraphic(new Graphic(core.CacheDefinitions.getSpotanimId(effect.graphic)));
  player.getPacketSender().sendSound(effect.sound, 1, 0);
  player.sendMessage(text("used"));
  const now = Date.now();
  shielded.set(player, now + effect.immuneTicks * TICK_MS);
  for (const delay of effect.explosionTicks) {
    if (delay === 0) explode(player);
    else core.TaskManager.submit(new core.CountdownTask(player, delay, () => explode(player)));
  }
  player.setAttribute(READY_AT_ATTRIBUTE, now + effect.cooldownTicks * TICK_MS);
  scheduleReady(player);
  api.emitCustomEvent("league:relic-triggered", { player, relic: effect.key });
  return true;
}

function check(event) {
  const { player } = event;
  if (!active(player)) return false;
  event.handled = true;
  if (!coolingDown(player)) player.sendMessage(text("ready"));
  return true;
}

/** Every hit on the shielded player is 0. */
function damageApply({ target, hit }) {
  const until = target?.isPlayer?.() ? shielded.get(target) : undefined;
  if (until === undefined) return;
  if (Date.now() >= until) {
    shielded.delete(target);
    return;
  }
  hit.setDamage(0);
}

/** A tick off the cooldown for every 10 damage of one hit. */
function dealtDamage({ player, hit }) {
  if (!active(player) || readyAt(player) <= Date.now()) return;
  for (const damage of hit?.getHits?.() ?? []) {
    damage?.onApplied?.((taken) => {
      const cut = Math.floor((Number(taken) || 0) / 10) * effect.cooldownCutPerTenDamage * TICK_MS;
      if (cut <= 0 || readyAt(player) <= Date.now()) return;
      player.setAttribute(READY_AT_ATTRIBUTE, Math.max(Date.now(), readyAt(player) - cut));
      scheduleReady(player);
    });
  }
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  effect = Common.data.effects.flaskOfFervour;
  api.persistAttribute(READY_AT_ATTRIBUTE, 0);
  api.onItemAction(effect.toolName, { Activate: activate, Check: check });
  api.onCustomEvent("combat:damage-apply", damageApply);
  api.onPlayerDealtDamage(dealtDamage);
};

module.exports.READY_AT_ATTRIBUTE = READY_AT_ATTRIBUTE;
