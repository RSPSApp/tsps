/**
 * Vardorvis: what the units share - the plugin api, the data from plugins/bosses/data/vardorvis.json,
 * tick timing, the hit and graphic helpers, and the saved attributes.
 */
const fs = require("fs");
const path = require("path");

/** Set while the player is in the ritual site's instance, so a login there puts them outside. */
const INSIDE_ATTRIBUTE = "vardorvis:inside";
const KILLS_ATTRIBUTE = "vardorvis:kills";
const AWAKENED_KILLS_ATTRIBUTE = "vardorvis:awakened-kills";
const BEST_TICKS_ATTRIBUTE = "vardorvis:best-ticks";
const AWAKENED_BEST_TICKS_ATTRIBUTE = "vardorvis:awakened-best-ticks";

const CHUNK = 8;
const CYCLES_PER_TICK = 30;

let api = null;
let core = null;
let data = null;

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "vardorvis.json"), "utf8"));
}

/** Runs `action` `ticks` ticks from now (at least one). */
function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

const toWorld = ([x, y, z]) => new core.Location(x, y, z ?? 0);

/** A Direction id by name, as api.spawnNpc takes it. */
const facing = (name) => core.Direction[name].getId();

/** The instance's copy of a ritual site tile, for a session's area. */
function tile(area, [x, y, z]) {
  const { sourceChunkX, sourceChunkY } = data.instance;
  return area.tile(x - sourceChunkX * CHUNK, y - sourceChunkY * CHUNK, z ?? 0);
}

/** The ritual site tile an instance tile copies, as [x, y]. */
function siteTile(area, location) {
  const { sourceChunkX, sourceChunkY } = data.instance;
  return [
    location.getX() - area.getBaseX() + sourceChunkX * CHUNK,
    location.getY() - area.getBaseY() + sourceChunkY * CHUNK,
  ];
}

function graphic(id, { delay = 0, height = 0 } = {}) {
  const { Graphic } = core;
  const gfx = new Graphic(id);
  gfx.delay = delay;
  gfx.height = height;
  return gfx;
}

function sound(player, id, delay = 0) {
  if (id) player.getPacketSender().sendSoundEffect(id, 1, delay);
}

function areaSound(player, id, location, delay = 0) {
  if (id) player.getPacketSender().sendAreaSound(id, location.getX(), location.getY(), location.getZ(), 1, delay);
}

function protectedFrom(player, prayer) {
  const { PrayerHandler } = core;
  return PrayerHandler.isActivated(player, PrayerHandler[prayer]);
}

const styleMethods = new Map();

function styleMethod(style) {
  let method = styleMethods.get(style);
  if (!method) {
    const { CombatMethod, CombatType } = core;
    const type = { melee: CombatType.MELEE, ranged: CombatType.RANGED, magic: CombatType.MAGIC }[style];
    method = new (class extends CombatMethod {
      type() {
        return type;
      }

      hits() {
        return [];
      }
    })();
    styleMethods.set(style, method);
  }
  return method;
}

/**
 * A styled hit from the boss landing `delay` ticks from now, rolled like any NPC attack. The
 * protection prayer of its style leaves `prayerShare` of the damage; `accurate` skips the roll.
 */
function strike(npc, player, style, maxHit, delay, { prayer = null, prayerShare = 1, accurate = false, onApplied = null } = {}) {
  const { PendingHit, CombatFactory, World } = core;
  const hit = new PendingHit(npc, player, styleMethod(style), { delay, rollAccuracy: !accurate });
  CombatFactory.applyStyleDamage(hit, Math.max(0, Math.floor(maxHit)), { bypassProtectionPrayer: true });
  if (prayer && protectedFrom(player, prayer)) {
    for (const part of hit.getHits()) part.setDamage(Math.floor(part.getDamage() * prayerShare));
    hit.updateTotalDamage();
  }
  if (onApplied) for (const part of hit.getHits()) part.onApplied(onApplied);
  player.getCombat().getHitQueue().addPendingHit(hit, World.getProcessCycle() + Math.max(0, delay));
  return hit;
}

/** Damage no prayer or armour stops, with its own hitsplat when given. */
function damage(player, amount, splat = null, onApplied = null) {
  const { HitDamage, HitMask } = core;
  const value = Math.max(0, Math.floor(amount));
  const hit = new HitDamage(value, value > 0 ? HitMask.RED : HitMask.BLUE);
  if (splat != null) hit.setSplatTypes(splat, splat);
  if (onApplied) hit.onApplied(onApplied);
  player.getCombat().getHitQueue().addPendingDamage([hit]);
  return value;
}

/** The boss heals what a hit of his took, with the heal hitsplat (as captured). */
function lifesteal(npc, dealt) {
  const amount = Math.floor(Math.max(0, dealt) * data.boss.lifesteal);
  if (!npc?.isRegistered?.() || npc.getHitpoints() <= 0 || amount <= 0) return;
  npc.heal(amount);
  npc.showHitsplat?.(amount, { mine: data.boss.healSplat, others: data.boss.healSplat });
}

/** Whether the player has precise timing on (the "option_precise_timing" varbit). */
function preciseTiming(player) {
  const id = core?.CacheDefinitions?.getVarbitId?.("option_precise_timing");
  return Number.isInteger(id) && player?.getPacketSender?.()?.getVarbit?.(id) === 1;
}

/**
 * A fight's length as the kill messages print it: m:ss, or m:ss.cc with precise timing on
 * (rsprox 1156: "Fight duration: 0:35.40 (new personal best)").
 */
function formatTicks(ticks, precise = false) {
  const pad = (value) => String(value).padStart(2, "0");
  if (!precise) {
    const seconds = Math.round(ticks * 0.6);
    return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
  }
  const centis = Math.round(ticks * 60);
  return `${Math.floor(centis / 6000)}:${pad(Math.floor((centis % 6000) / 100))}.${pad(centis % 100)}`;
}

/** A filterable chat line (message type 105), as live sends the tendril escape. */
function spam(player, text) {
  const sender = player.getPacketSender?.();
  if (sender?.sendTypedMessage && core?.ChatType?.SPAM !== undefined) sender.sendTypedMessage(core.ChatType.SPAM, text);
  else player.sendMessage(text);
}

const count = (player, key) => Math.max(0, Math.trunc(Number(player.getAttribute(key)) || 0));

module.exports = {
  init, later, randomInt, pick, shuffle, toWorld, facing, tile, siteTile, graphic, sound, areaSound,
  protectedFrom, strike, damage, lifesteal, formatTicks, preciseTiming, spam, count,
  CYCLES_PER_TICK,
  INSIDE_ATTRIBUTE, KILLS_ATTRIBUTE, AWAKENED_KILLS_ATTRIBUTE, BEST_TICKS_ATTRIBUTE, AWAKENED_BEST_TICKS_ATTRIBUTE,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
};
