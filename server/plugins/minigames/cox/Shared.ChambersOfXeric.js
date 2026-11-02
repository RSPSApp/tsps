"use strict";

/**
 * Chambers of Xeric: ids, tiles, vars and helpers every unit uses.
 *
 * Cache: Mount Quidamortem's locs (recruiting boards 29776, the entrance 29777 at 1232,3573,
 * the bank chest and the private storage unit) and the raid interfaces' scripts.
 * Not on the Wiki (to check against a capture): the interface ids (499 recruiting board, 507 party,
 * 500 the in-raid party tab, 513 the points overlay), the varbits they read, and the raid's
 * own locs (steps, passages, holes, ropes, crystals).
 * Wiki: https://oldschool.runescape.wiki/w/Chambers_of_Xeric
 */

const state = { api: null, core: null };

function bind(api) {
  state.api = api;
  state.core = api.core;
}

function core() {
  return state.core;
}

function api() {
  return state.api;
}

/** Where leaving the raid puts you (not on the Wiki), at the foot of the entrance's steps. */
const OUTSIDE = { x: 1246, y: 3558, z: 0 };
/** Mount Quidamortem, around the entrance: party pages only reach players standing here. */
const MOUNT_QUIDAMORTEM = { minX: 1200, maxX: 1280, minY: 3540, maxY: 3600 };

const OBJECT = {
  RECRUITING_BOARD: 29776,
  ENTRANCE: 29777,
  /** The steps in the first room, back out to Mount Quidamortem. */
  STEPS: 29778,
  /** The first room's bank chest, and as it is once the raid has begun. */
  BANK_CHEST: 47420,
  BANK_CHEST_SHUT: 47419,
  /** The gaps between rooms. */
  PASSAGE: 29789,
  /** The hole down at a floor's end, and the rope back up at the next floor's start. */
  HOLES: [29734, 29735],
  ROPE: 29995,
  /** The crystal that blocks a room's exit until its encounter is done. */
  CRYSTAL: 30018,
};

const NPC = {
  CAPTAIN_RIMOR: 7595,
};

const INTERFACE = {
  RECRUITING_BOARD: 499,
  PARTY: 507,
  PARTY_TAB: 500,
  OVERLAY: 513,
  PRIVATE_STORAGE: 271,
  SHARED_STORAGE: 550,
  REWARDS: 539,
};

const VARBIT = {
  /** The party interface: whether you lead the party, Challenge Mode, your preferences. */
  PARTY_LEADER: 5428,
  CHALLENGE_MODE: 6385,
  PREFERRED_SIZE: 5433,
  PREFERRED_COMBAT: 5426,
  PREFERRED_TOTAL: 5427,
  /** rsprox captures 820, 843, 3389: the party's scale and map layout, as the page shows them. */
  SCALING: 9539,
  LAYOUT_POOL: 5408,
  REMEMBER_SCALING: 9541,
  REMEMBER_PARTY_TYPE: 3288,
  /** The in-raid tab: whether you lead it, how many are in, and the raid's stage. */
  TAB_LEADER: 5423,
  TAB_PLAYERS: 5424,
  STAGE: 5425,
  /** The points overlay's team total (the personal score is VARP.PERSONAL_POINTS). */
  TOTAL_POINTS: 5431,
  /** The party tab's scaled size (shown above the real one) and highest combat level. */
  SCALED_SIZE: 9540,
  HIGHEST_COMBAT: 12285,
  /** The raid's timer in ticks, and the chat-channel tab's icon while raiding. */
  TIMER: 6386,
  TAB_ICON: 5432,
  TAB_ICON_2: 8168,
  ENTERING: 5456,
};

const VARP = {
  /** The recruiting board: -1 when your chat-channel has no party, 0 when it has one. */
  BOARD_HAS_PARTY: 1427,
  RAID_STATE: 1431,
  /** raids_playerscore: the points overlay's personal score. */
  PERSONAL_POINTS: 4609,
};

const SCRIPT = {
  BOARD_ROW: 1566,
  PARTY_MEMBER: 1517,
  PARTY_HEADER: 1524,
  TAB_SIZE: 1547,
  TAB_MEMBER: 1548,
  TAB_KICKABLE: 1553,
  FADE_OUT: 1512,
  FADE_IN: 1513,
  FADE: 948,
};

/** The board lists 40 parties; the party page 100 raiders. */
const BOARD_ROWS = 40;
const MAX_RAIDERS = 100;
/** Points can't go past this (the overlay's varbit is 17 bits). */
const MAX_POINTS = 131071;

/** The skills the party page lists, in the order its script takes them. */
const PARTY_SKILLS = [
  "ATTACK", "STRENGTH", "RANGED", "MAGIC", "DEFENCE", "HITPOINTS", "PRAYER", "AGILITY", "HERBLORE",
  "THIEVING", "CRAFTING", "RUNECRAFTING", "MINING", "SMITHING", "FISHING", "COOKING", "FIREMAKING",
  "WOODCUTTING", "FLETCHING", "SLAYER", "FARMING", "CONSTRUCTION", "HUNTER",
];

/** rsprox captures: the party page's map layouts, in the order its menu and varbit have them. */
const LAYOUT_POOL = { SMALL: 0, LARGE: 1, FULL: 2 };
const LAYOUT_NAMES = ["Small", "Large", "Full"];

const ATTR = {
  /** What the player last set when making a party. */
  LAST_SCALING: "cox:last-scaling",
  LAST_LAYOUT: "cox:last-layout",
  /** Adverts used today: { day, used }. */
  ADVERTS: "cox:adverts",
  /** Has accepted the entrance's warning. */
  WARNED: "cox:warned",
  KILLS: "cox:kills",
  CHALLENGE_KILLS: "cox:challenge-kills",
  /** Set while inside, so a player logged out inside is put back outside on login. */
  INSIDE: "cox:inside",
};

/** rsprox captures: the points overlay (513) opens on toplevel_osrs_stretch:overlay_atmosphere. */
const OVERLAY_UID = (161 << 16) | 1;
const MAIN_MODAL_UID = (161 << 16) | 16;

const EVENT = { OP1: 1 << 1, OP2: 1 << 2, OP3: 1 << 3, OP4: 1 << 4, OP5: 1 << 5, CONTINUE: 1 << 0 };

/** Items that only exist inside the chambers and are dropped on leaving (unverified ranges). */
function isRaidItem(id) {
  if (id === 20899) return false; // the dark journal is kept
  return (id >= 20799 && id <= 20801) || (id >= 20853 && id <= 20996) || (id >= 21036 && id <= 21042);
}

function loc({ x, y, z = 0 }) {
  const { Location } = core();
  return new Location(x, y, z);
}

function inBox(location, box) {
  const x = location.getX();
  const y = location.getY();
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

function onMount(player) {
  return player.getLocation().getZ() === 0 && inBox(player.getLocation(), MOUNT_QUIDAMORTEM);
}

function cycle() {
  return core().World.getProcessCycle();
}

/** Runs `action` once after `ticks` game ticks, keyed to `key` so it can be cancelled with it. */
function later(key, ticks, action) {
  const { Task, TaskManager } = core();
  const task = new (class extends Task {
    constructor() {
      super(Math.max(0, ticks), key, ticks <= 0);
    }
    execute() {
      this.stop();
      action();
    }
  })();
  TaskManager.submit(task);
  return task;
}

/** Runs `action` every `ticks` ticks until it returns false, keyed to `key`. */
function repeat(key, ticks, action) {
  const { Task, TaskManager } = core();
  const task = new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), key, false);
    }
    execute() {
      if (action() === false) this.stop();
    }
  })();
  TaskManager.submit(task);
  return task;
}

function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue, EndDialogue } = core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, text),
    new EndDialogue(1),
  ));
}

/** A chatbox choice: options("Title?", "Yes.", onYes, "No.", onNo). */
function options(player, title, ...pairs) {
  const args = [];
  for (let i = 0; i < pairs.length; i += 2) args.push(pairs[i], pairs[i + 1] ?? (() => {}));
  api().sendMultiChatboxPrompt(player, title, ...args);
}

/** Pink game messages, as the raid sends them (not on the Wiki). */
function raidMessage(player, text) {
  player.sendMessage(`<col=ef20ff>${text}</col>`);
}

/** The raid overlay's own fade: out, run `action` a tick later, then back in (not on the Wiki). */
function fadeMove(player, action) {
  const sender = player.getPacketSender();
  sender.sendSubInterface(OVERLAY_UID, INTERFACE.OVERLAY, 1);
  sender.sendClientScript(SCRIPT.FADE_OUT);
  later(player, 1, () => {
    action();
    sender.sendClientScript(SCRIPT.FADE, 0, 255, 0, 0, 15);
    sender.sendClientScript(SCRIPT.FADE_IN);
  });
}

function sound(player, id, delay = 0) {
  player.getPacketSender().sendSound(id, 1, delay);
}

/** The chat-channel a player is in, from the friends chat plugin (or null). */
function channelOf(player) {
  const request = { player, channel: null, ranks: null };
  api().emitCustomEvent("friends-chat:channel", request);
  return request.channel ? { ...request.channel, ranks: request.ranks } : null;
}

/** A chat-channel by its key (its owner's name), or null if no one is in it. */
function channelByKey(key) {
  const request = { key, channel: null, ranks: null };
  api().emitCustomEvent("friends-chat:channel", request);
  return request.channel ? { ...request.channel, ranks: request.ranks } : null;
}

function joinChannel(player, owner) {
  const request = { player, owner, joined: false };
  api().emitCustomEvent("friends-chat:join", request);
  return request.joined;
}

function leaveChannel(player) {
  api().emitCustomEvent("friends-chat:leave", { player });
}

/**
 * A repeating skilling action, one per player: `step` runs every `interval` ticks (the first
 * after `first`) and returns false to stop. It stops when the player moves or starts another.
 */
function action(player, { first = 1, interval = 1, step, stop }) {
  player.__coxAction?.stop?.();
  const origin = player.getLocation().clone();
  let wait = first;
  const task = repeat(player, 1, () => {
    if (task !== player.__coxAction) return false;
    if (!player.getLocation().equals(origin) || !player.isRegistered?.()) return finish();
    if (--wait > 0) return true;
    wait = interval;
    if (step() === false) return finish();
    return true;
  });
  player.__coxAction = task;
  function finish() {
    if (player.__coxAction === task) player.__coxAction = null;
    stop?.();
    return false;
  }
  return task;
}

function stopAction(player) {
  player.__coxAction?.stop?.();
  player.__coxAction = null;
}

function level(player, skill) {
  return player.getSkillManager().getCurrentLevel(core().Skill[skill]);
}

function baseLevel(player, skill) {
  return player.getSkillManager().getMaxLevel(core().Skill[skill]);
}

function addXp(player, skill, xp) {
  player.getSkillManager().addExperiences(core().Skill[skill], xp);
}

function has(player, id, amount = 1) {
  return player.getInventory().getAmount(id) >= amount;
}

function wielding(player, id) {
  const { Equipment } = core();
  return player.getEquipment().getItems()[Equipment.WEAPON_SLOT]?.getId?.() === id;
}

/** Into the inventory, or on the floor under the player if it is full. */
function give(player, id, amount = 1) {
  const { Item, ItemDefinition, ItemOnGroundManager } = core();
  const inventory = player.getInventory();
  const stackable = ItemDefinition.forId(id)?.isStackable?.() === true;
  if (stackable ? inventory.contains(id) || inventory.getFreeSlots() > 0 : inventory.getFreeSlots() >= amount) {
    inventory.add(new Item(id, amount), true);
    return;
  }
  ItemOnGroundManager.registerLocation(player, new Item(id, amount), player.getLocation().clone());
}

function animate(player, id) {
  player.performAnimation(new (core().Animation)(id));
}

/** The best axe the player can use, held or carried: { id, animation }. */
const AXES = [
  { id: 13241, level: 61, animation: 2117 }, { id: 6739, level: 61, animation: 2846 },
  { id: 1359, level: 41, animation: 867 }, { id: 1357, level: 31, animation: 869 },
  { id: 1355, level: 21, animation: 871 }, { id: 1361, level: 6, animation: 873 },
  { id: 1353, level: 6, animation: 875 }, { id: 1349, level: 1, animation: 877 }, { id: 1351, level: 1, animation: 879 },
];

function axeOf(player) {
  const woodcutting = level(player, "WOODCUTTING");
  return AXES.find((axe) => woodcutting >= axe.level && (has(player, axe.id) || wielding(player, axe.id))) ?? null;
}

/**
 * Object clicks by id: `handler(event)` gets `event.option`, the clicked option's name, and
 * returns false when it doesn't handle the click.
 */
function onObjectIds(api, ids, handler) {
  const wanted = new Set(ids);
  api.onObjectInteraction(function raidObjectClick(event) {
    if (event.handled || !wanted.has(event.objectId)) return;
    event.option = event.definition?.getInteractions?.()?.[event.clickType - 1] ?? event.definition?.actions?.[event.clickType - 1] ?? "";
    if (handler(event) !== false) event.handled = true;
  });
}

/** Swaps a raid object (a template loc or one spawned before) for another id; returns the new one. */
function replaceObject(map, object, id) {
  const { GameObject, ObjectManager } = core();
  ObjectManager.deregister(object, true);
  map.detach?.(object);
  const next = new GameObject(id, object.getLocation().clone(), object.getType(), object.getFace(), map);
  ObjectManager.register(next, true);
  return next;
}

function random(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomOf(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** A graphic with an explicit delay (client cycles) and height. */
function gfx(id, { delay = 0, height = 0 } = {}) {
  const { Graphic } = core();
  const graphic = new Graphic(id);
  graphic.delay = delay;
  graphic.height = height;
  return graphic;
}

/** Heals an NPC with the heal hitsplat (6) live OSRS shows. */
function healSplat(npc, amount) {
  if (!npc || amount <= 0) return;
  npc.heal(amount);
  npc.showHitsplat?.(amount, { mine: 6, others: 6 });
}

/** A sound played at a tile (sound_area), heard by every given viewer within `range` tiles of it. */
function areaSound(viewers, id, location, { loops = 1, delay = 0, range = 10 } = {}) {
  for (const viewer of viewers) {
    viewer.getPacketSender().sendAreaSound(id, location.getX(), location.getY(), location.getZ(), loops, delay, range);
  }
}

/** A graphic on a tile, shown to every given viewer. */
function graphicAt(viewers, id, location, options) {
  for (const viewer of viewers) viewer.getPacketSender().sendGlobalGraphic(gfx(id, options), location);
}

/** Unblockable damage. */
function damage(target, amount) {
  const { HitDamage, HitMask } = core();
  if (!target || amount <= 0 || target.getHitpoints() <= 0) return;
  target.getCombat().getHitQueue().addPendingDamage([new HitDamage(Math.trunc(amount), HitMask.RED)]);
}

function isProtected(player, style) {
  const { PrayerHandler } = core();
  const prayer = style === "magic" ? PrayerHandler.PROTECT_FROM_MAGIC
    : style === "ranged" ? PrayerHandler.PROTECT_FROM_MISSILES
      : PrayerHandler.PROTECT_FROM_MELEE;
  return PrayerHandler.isActivated(player, prayer);
}

/**
 * A projectile between two tiles or actors, seen inside `area`. Returns the landing time in
 * game ticks, to line damage up with it.
 */
function projectile(area, from, to, id, { delay = 0, duration = 30, perTile = 5, startHeight = 43, endHeight = 0 } = {}) {
  const { Projectile } = core();
  const start = from.getLocation ? Projectile.centreOf(from) : from;
  const end = to.getLocation ? Projectile.centreOf(to) : to;
  const lockon = to.getLocation ? to : null;
  const speed = delay + duration + start.getDistance(end) * perTile;
  new Projectile(start, end, lockon, id, delay, speed, startHeight, endHeight, area).sendProjectile();
  return Math.ceil(speed / 30);
}

/** Moves an NPC in a straight line to a tile, whatever the map blocks there. */
function walkStraight(npc, location) {
  npc.setFlag("movement:ignore-clipping");
  const movement = npc.getMovementQueue();
  movement.setBlockMovement?.(false);
  movement.reset();
  movement.addSteps(location);
}

const styleMethods = new Map();

function styleMethod(style) {
  let method = styleMethods.get(style);
  if (!method) {
    const { CombatMethod, CombatType } = core();
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
 * An NPC's attack in one style on a player, landing `delay` ticks from now: accuracy rolls as
 * normal, damage up to `maxHit`; the matching protection prayer lets `prayerMultiplier` through
 * (none by default), and `prayable: false` ignores prayer.
 */
function strike(npc, player, style, maxHit, delay, { prayable = true, prayerMultiplier = 0 } = {}) {
  const { PendingHit, CombatFactory } = core();
  const hit = new PendingHit(npc, player, styleMethod(style), delay);
  CombatFactory.applyStyleDamage(hit, maxHit, { bypassProtectionPrayer: true });
  if (prayable && isProtected(player, style)) {
    for (const part of hit.getHits()) part.setDamage(Math.floor(part.getDamage() * prayerMultiplier));
    hit.updateTotalDamage();
  }
  player.getCombat().getHitQueue().addPendingHit(hit, cycle() + Math.max(0, delay));
  return hit;
}

/**
 * Walks a player tile by tile (one a tick, through anything) to `destination` with a walk
 * animation, as the Agility plugin crosses tightropes; then `done()`.
 */
function balanceWalk(player, destination, walkAnimation, done) {
  const { Flag, Direction, Location } = core();
  const setRender = (id) => {
    player.setSkillAnimation(id);
    player.getUpdateFlag().flag(Flag.APPEARANCE);
  };
  player.getMovementQueue().reset();
  setRender(walkAnimation);
  player.__coxBalancing = true;
  repeat(player, 1, () => {
    const at = player.getLocation();
    const dx = Math.sign(destination.getX() - at.getX());
    const dy = Math.sign(destination.getY() - at.getY());
    if ((dx === 0 && dy === 0) || !player.isRegistered?.() || player.getHitpoints() <= 0) {
      setRender(-1);
      player.__coxBalancing = false;
      done?.();
      return false;
    }
    player.setLocation(new Location(at.getX() + dx, at.getY() + dy, at.getZ()));
    player.setWalkingDirection(Direction.fromDeltas(dx, dy));
    player.getMovementQueue().handleRegionChange();
    return true;
  });
}

/** Crossing a 2x2 fire at a room's way in (Tekton's, Vasa's): onto its other side. */
function crossFire(player, object) {
  const { Location } = core();
  const at = object.getLocation();
  const centreX = at.getX() + 0.5;
  const centreY = at.getY() + 0.5;
  const px = player.getLocation().getX();
  const py = player.getLocation().getY();
  const horizontal = Math.abs(px - centreX) > Math.abs(py - centreY);
  const destination = horizontal
    ? new Location(px < centreX ? at.getX() + 2 : at.getX() - 1, py, at.getZ())
    : new Location(px, py < centreY ? at.getY() + 2 : at.getY() - 1, at.getZ());
  balanceWalk(player, destination, -1, null);
}

/** The best pickaxe the player can use, held or carried: { id, animation }. */
const PICKAXES = [
  { id: 23680, level: 71, animation: 8347 }, { id: 13243, level: 61, animation: 4482 }, { id: 11920, level: 61, animation: 7139 },
  { id: 1275, level: 41, animation: 624 }, { id: 1271, level: 31, animation: 628 }, { id: 1273, level: 21, animation: 629 },
  { id: 12297, level: 11, animation: 3873 }, { id: 1269, level: 6, animation: 627 }, { id: 1267, level: 1, animation: 626 },
  { id: 1265, level: 1, animation: 625 },
];

function pickaxeOf(player) {
  const mining = level(player, "MINING");
  return PICKAXES.find((pickaxe) => mining >= pickaxe.level && (has(player, pickaxe.id) || wielding(player, pickaxe.id))) ?? null;
}

function formatTicks(ticks) {
  const seconds = Math.floor((Math.max(0, ticks) * 600) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const secs = seconds % 60;
  const pad = (value) => String(value).padStart(2, "0");
  // rsprox captures: "9:03", no leading zero.
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

function displayName(player) {
  return player.getUsername();
}

module.exports = {
  bind, core, api,
  OUTSIDE, MOUNT_QUIDAMORTEM, OBJECT, NPC, INTERFACE, VARBIT, VARP, SCRIPT, BOARD_ROWS, MAX_RAIDERS,
  MAX_POINTS, PARTY_SKILLS, ATTR, OVERLAY_UID, MAIN_MODAL_UID, EVENT,
  LAYOUT_POOL, LAYOUT_NAMES, isRaidItem, loc, inBox, onMount, cycle, later, repeat, statement, options, raidMessage, fadeMove, sound,
  channelOf, channelByKey, joinChannel, leaveChannel, formatTicks, displayName,
  balanceWalk, crossFire, random, randomOf, shuffle, gfx, graphicAt, areaSound, healSplat, damage, isProtected, projectile, walkStraight, styleMethod, strike,
  onObjectIds, replaceObject, action, stopAction, level, baseLevel, addXp, has, wielding, give, animate, axeOf, pickaxeOf, PICKAXES,
};
