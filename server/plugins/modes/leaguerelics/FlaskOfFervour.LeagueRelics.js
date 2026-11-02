/**
 * Flask of Fervour (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic Pacts'
 * tier 8 relic. The flask (from the cache's relic struct), Activated: hitpoints, prayer and special
 * attack energy to full and poison cured (237/01164 clears the poison varp), with the recording's
 * line, animation, graphic and sound; for the next 2.4 seconds (four ticks) every hit on the
 * player is 0 (`combat:damage-apply`), and three explosions (1, 3 and 5 ticks after, 237/01158)
 * each deal 60% of the base Prayer level as a typeless hit to every attackable NPC within three
 * tiles, Yama spared, and 30% of it to every player there the area lets the owner fight (PvP),
 * each with the recording's impact graphics on the 8 lines out to three tiles. Then three minutes
 * of cooldown, a tick (0.6 seconds) shorter for every 10 damage one of the player's hits deals;
 * Activate or Check meanwhile says how long is left ("on cooldown for another N seconds!",
 * 237/01164), and its end says the flask is ready.
 * The buff bar's cooldown (varp league_relic_flask_of_fervour_cooldown, read against map_clock by
 * script4678) is the tick it ends on, as recorded (237/01158): the tick's map_clock + 301 on
 * Activate, each cut sent as it lands, and at login the current end (0 when ready).
 */
const Common = require("./Common.LeagueRelics");

/** When the flask may be used again (ms since the epoch); 0 when it may. */
const READY_AT_ATTRIBUTE = "league:flask-of-fervour-ready-at";
const TICK_MS = 600;
/** The 8 lines the impacts run along. */
const DIRECTIONS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];

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

/** The cooldown varp: the map_clock tick the cooldown ends on (live: the tick's clock + 301 on Activate), or 0 when ready. */
function sendCooldown(player) {
  const left = readyAt(player) - Date.now();
  const ends = left > 0 ? core.World.getProcessCycle() + Math.ceil(left / TICK_MS) + effect.cooldownVarpOffset : 0;
  player.getPacketSender().sendConfig(core.CacheDefinitions.getVarpId(effect.cooldownVarp), ends);
}

function login({ player }) {
  if (active(player)) sendCooldown(player);
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

function near(player, other) {
  const here = player.getLocation();
  return other.getLocation().getZ() === here.getZ() && other.getLocation().isWithinDistance(here, effect.radius);
}

function enemiesAround(player) {
  const { CombatFactory, CanAttackResponse, TimerKey } = core;
  return player.getLocalNpcs().filter((npc) => npc.getHitpoints() > 0 && near(player, npc)
    && !effect.spared.includes(npc.getDefinition?.()?.getName?.())
    && CombatFactory.validTarget(player, npc)
    && npc.getCurrentDefinition().isAttackable()
    && !npc.getTimers().has(TimerKey.ATTACK_IMMUNITY)
    && CombatFactory.canAttackByPolicy(player, npc) === CanAttackResponse.CAN_ATTACK);
}

/** Players within reach the area lets the owner fight (the Wilderness, PvP worlds). */
function playersAround(player) {
  const { CombatFactory, CanAttackResponse } = core;
  return (player.getLocalPlayers?.() ?? []).filter((other) => other !== player && other.getHitpoints() > 0 && near(player, other)
    && CombatFactory.validTarget(player, other)
    && CombatFactory.canAttackByPolicy(player, other) === CanAttackResponse.CAN_ATTACK);
}

/** The impact graphics: on the 8 lines out from the player's tile, one per tile out to the radius (237/01158). */
function impacts(player) {
  const { Graphic, Location } = core;
  const id = core.CacheDefinitions.getSpotanimId(effect.impact);
  const here = player.getLocation();
  for (const [dx, dy] of DIRECTIONS) {
    effect.impactDelays.forEach((delay, step) => {
      const at = new Location(here.getX() + dx * (step + 1), here.getY() + dy * (step + 1), here.getZ());
      player.getPacketSender().sendGlobalGraphic(new Graphic(id, delay), at);
    });
  }
}

/** One explosion's hit: the health it takes is the owner's damage, so a kill is theirs (its loot, its kill count). */
function strike(player, victim, damage) {
  if (damage <= 0) return;
  const hit = new core.HitDamage(damage, core.HitMask.RED).setSource(player)
    .onApplied((dealt) => victim.getCombat().addDamage(player, dealt));
  victim.getCombat().getHitQueue().addPendingDamage([hit]);
}

function explode(player) {
  const prayer = player.getSkillManager().getMaxLevel(core.Skill.PRAYER);
  impacts(player);
  for (const npc of enemiesAround(player)) strike(player, npc, Math.floor(prayer * effect.prayerFraction));
  for (const other of playersAround(player)) strike(player, other, Math.floor(prayer * effect.pvpPrayerFraction));
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
  sendCooldown(player);
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
      sendCooldown(player);
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
  api.onCustomEvent("league:login", login);
};

module.exports.READY_AT_ATTRIBUTE = READY_AT_ATTRIBUTE;
