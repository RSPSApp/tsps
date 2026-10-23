/**
 * Nex and the Ancient Prison: what the units share - the plugin api, plugins/bosses/data/nex.json,
 * the attribute keys, ancient essence (kept with the God Wars Dungeon's) and the packets every part
 * of the fight sends (shouts, sounds, projectiles, hits). See docs/nex.md.
 */
const fs = require("fs");
const path = require("path");
const GodWars = require("../godwars/Common.GodWars");

/** The Frozen Door unsealed for good with the frozen key. */
const UNLOCKED_ATTRIBUTE = "nex:frozen-door-unlocked";
const ALTAR_ATTRIBUTE = "nex:altar-used-at";
const KILLS_ATTRIBUTE = "nex:kills";
/** The fastest kill, in ticks. */
const BEST_ATTRIBUTE = "nex:best-ticks";
const DEATHS_ATTRIBUTE = "nex:deaths";
/** What a death in the chamber left in the reclaim chest: [[id, amount]]. */
const RECLAIM_ATTRIBUTE = "nex:reclaim";
/** "Yes, and don't ask again." on the private fight's warning (also varbit 13183). */
const SKIP_WARNING_ATTRIBUTE = "nex:skip-warning";
/** Set while in a private fight, so a login after a crash lands in the safe room. */
const INSTANCE_ATTRIBUTE = "nex:in-instance";

let api = null;
let core = null;
let data = null;

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "nex.json"), "utf8"));
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

const toLocation = ([x, y, z]) => new core.Location(x, y, z ?? 0);
const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const count = (player, key) => Math.max(0, Math.trunc(Number(player.getAttribute(key)) || 0));

function inBox(box, location) {
  const x = location.getX();
  const y = location.getY();
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY && (box.z === undefined || box.z === location.getZ());
}

function graphic(id, { delay = 0, height = 0 } = {}) {
  const gfx = new core.Graphic(id);
  gfx.delay = delay;
  gfx.height = height;
  return gfx;
}

function animation(id, delay = 0) {
  return new core.Animation(id, delay);
}

/** A sound for each player: [id, delay] pairs or bare ids. */
function sounds(players, list) {
  for (const player of players) {
    for (const entry of list) {
      const [id, delay] = Array.isArray(entry) ? entry : [entry, 0];
      player.getPacketSender().sendSoundEffect(id, 1, delay ?? 0);
    }
  }
}

/** A sound from a tile, as the capture's sound_area: [id, delay, range]. */
function areaSound(players, location, [id, delay = 0, range = 7]) {
  for (const player of players) {
    player.getPacketSender().sendAreaSound(id, location.getX(), location.getY(), location.getZ(), 1, delay, range);
  }
}

/** A map animation on a tile, for each player. */
function tileGraphic(players, location, id, options) {
  for (const player of players) player.getPacketSender().sendGraphic(graphic(id, options), location);
}

/**
 * A projectile from `from` to `to` (mobiles or tiles), as captured; returns the client cycles until
 * it lands. `spec.end` defaults to the captured 10 cycles a tile after `spec.start`.
 */
function projectile(from, to, spec) {
  const { Projectile, Location } = core;
  const tileOf = (thing) => (thing instanceof Location ? thing : Projectile.centreOf(thing));
  const start = spec.start ?? 0;
  const end = spec.end ?? Projectile.arrivalCycles(tileOf(from), tileOf(to), start);
  const lockon = to instanceof Location ? null : to;
  const area = (from instanceof Location ? null : from.getPrivateArea?.()) ?? (lockon?.getPrivateArea?.() ?? spec.area ?? null);
  const shot = new Projectile(tileOf(from), tileOf(to), lockon, spec.id, start, end, spec.startHeight ?? 0, spec.endHeight ?? 0, area)
    .withAngle(spec.angle ?? 16)
    .withProgress(spec.progress ?? 64);
  if (!(from instanceof Location)) shot.withSource(from);
  shot.sendProjectile();
  return end;
}

/** Ticks until a projectile `cycles` long lands. */
const landsIn = (cycles) => Math.max(1, Math.ceil(cycles / 30));

const styleMethods = new Map();

/** A combat method that only names a style, for hits the fight times itself. */
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

const PRAYERS = { melee: "PROTECT_FROM_MELEE", ranged: "PROTECT_FROM_MISSILES", magic: "PROTECT_FROM_MAGIC" };

/** Which style the player's active protection prayer stops, if any. */
function protectedStyle(player) {
  const { PrayerHandler } = core;
  for (const [style, prayer] of Object.entries(PRAYERS)) {
    if (PrayerHandler.isActivated(player, PrayerHandler[prayer])) return style;
  }
  return null;
}

/**
 * A styled hit from `npc`, landing `delay` ticks from now: rolled like an NPC attack, then the
 * protection prayer applied the fight's way (`prayed(protectedStyle)` returns the multiplier, read
 * as the hit lands). `landed(damage)` runs on the tick it lands.
 */
function strike(npc, player, style, maxHit, delay, { prayed = null, landed = null } = {}) {
  const { PendingHit, CombatFactory, World } = core;
  const hit = new PendingHit(npc, player, styleMethod(style), { delay, rollAccuracy: true });
  CombatFactory.applyStyleDamage(hit, Math.max(0, Math.floor(maxHit)), { bypassProtectionPrayer: true });
  const rolled = hit.getHits().map((part) => part.getDamage());
  const land = () => {
    if (!player.isRegistered() || player.getHitpoints() <= 0) return;
    const factor = prayed ? prayed(protectedStyle(player)) : 1;
    let total = 0;
    hit.getHits().forEach((part, index) => {
      part.setDamage(Math.floor(rolled[index] * factor));
      total += part.getDamage();
    });
    hit.updateTotalDamage();
    player.getCombat().getHitQueue().addPendingHit(hit, World.getProcessCycle());
    landed?.(total, hit.isAccurate());
  };
  if (delay <= 0) land();
  else later(delay, land);
  return hit;
}

/** Damage no prayer or armour stops (Wrath, the darkness, a shattered prison). */
function damage(target, amount) {
  const { HitDamage, HitMask } = core;
  if (!target || target.getHitpoints() <= 0) return;
  const value = Math.max(0, Math.floor(amount));
  target.getCombat().getHitQueue().addPendingDamage([new HitDamage(value, value > 0 ? HitMask.RED : HitMask.BLUE)]);
}

const HEAL_SPLAT = { mine: 6, others: 6 };

/** Healing up to `max`, shown as a heal hitsplat (type 6) as captured on Nex. */
function healNpc(npc, amount, max) {
  if (!npc || amount <= 0) return 0;
  const healed = Math.min(Math.floor(amount), Math.max(0, max - npc.getHitpoints()));
  if (healed <= 0) return 0;
  npc.setHitpoints(npc.getHitpoints() + healed);
  npc.showHitsplat(healed, HEAL_SPLAT);
  return healed;
}

/** Her shout: overhead, and in each player's chatbox as "Nex: ..." (captured as npc_say). */
function say(npc, players, text) {
  if (!npc) return;
  npc.forceChat(text);
  const name = npc.getCurrentDefinition?.()?.getName?.() ?? "Nex";
  for (const player of players) player.getPacketSender().sendTypedMessage(core.ChatType.NPC_SAY, text, name);
}

/** A message box, through the dialogue manager so "Click here to continue" closes it. */
function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue, EndDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text), new EndDialogue(1)));
}

/** Chebyshev distance from a tile to the nearest tile of a size x size body at `base`. */
function distanceToBody(tile, base, size) {
  const gap = (value, from) => Math.max(0, from - value, value - (from + size - 1));
  return Math.max(gap(tile.getX(), base.getX()), gap(tile.getY(), base.getY()));
}

/** The fade God Wars doors use: out, the move two ticks later, back in. */
function fadeMove(player, location) {
  const fade = (args) => player.getPacketSender().sendSubInterface((161 << 16) | 1, 174, 1, {
    postScripts: [{ scriptId: 948, args }],
  });
  player.getMovementQueue().reset();
  fade([0, 255, 0, 0, 50]);
  later(2, () => {
    if (!player.isRegistered()) return;
    player.moveTo(location);
    fade([0, 0, 0, 255, 50]);
  });
}

// ------------------------------------------------------------------ ancient essence

const ancient = () => GodWars.factionByKey("ancient");

function getEssence(player) {
  return GodWars.getEssence(player, ancient());
}

function setEssence(player, value) {
  GodWars.setEssence(player, ancient(), value);
}

/** Wiki ("God Wars Dungeon/God items"): what counts as Zarosian, by the cache's item name. */
function isZarosian(name) {
  const lower = String(name ?? "").toLowerCase();
  if (lower === "ancient hilt") return false;
  return data.prison.itemKeywords.some((keyword) =>
    keyword.endsWith(" ") ? lower.startsWith(keyword) : keyword.startsWith(" ") ? lower.endsWith(keyword) : lower === keyword);
}

function wearsZarosian(player) {
  const { ItemDefinition } = core;
  return player.getEquipment().getItems().some((item) =>
    item && item.getId() > 0 && isZarosian(ItemDefinition.forId(item.getId())?.getName?.()));
}

/** m:ss, as the kill message prints a fight's length. */
function formatTicks(ticks) {
  const seconds = Math.round(ticks * 0.6);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function isIronman(player) {
  const query = { player, mode: "none" };
  api.emitCustomEvent("ironman:mode", query);
  return query.mode !== "none";
}

module.exports = {
  init, later, toLocation, randomInt, pick, count, inBox, graphic, animation, sounds, areaSound, tileGraphic,
  projectile, landsIn, styleMethod, protectedStyle, strike, damage, healNpc, say, statement, distanceToBody,
  fadeMove, getEssence, setEssence, isZarosian, wearsZarosian, formatTicks, isIronman,
  UNLOCKED_ATTRIBUTE, ALTAR_ATTRIBUTE, KILLS_ATTRIBUTE, BEST_ATTRIBUTE, DEATHS_ATTRIBUTE, RECLAIM_ATTRIBUTE,
  SKIP_WARNING_ATTRIBUTE, INSTANCE_ATTRIBUTE,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
};
