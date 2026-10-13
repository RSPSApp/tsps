"use strict";

/**
 * Theatre of Blood: ids, tiles, the room table and small helpers every unit uses.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Theatre_of_Blood
 * docs/theatre-of-blood.md says where each value comes from. Rooms stay at their real cache
 * coordinates; each party gets one PrivateArea over the whole theatre (as Tombs of Amascut).
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

/** The theatre's map squares, every plane: the rooms and the Shadow Realm. */
const THEATRE = { minX: 3136, maxX: 3391, minY: 4224, maxY: 4479 };
const THEATRE_PLANES = [0, 1, 2, 3];
/** Ver Sinhaza, where parties form (a box round the town, estimate). */
const VER_SINHAZA = { minX: 3631, maxX: 3699, minY: 3198, maxY: 3239, z: 0 };
/** Where leaving the theatre puts you, outside its entrance (estimate). */
const OUTSIDE = { x: 3677, y: 3217, z: 0 };

const NPC = {
  VYRE_ORATOR: 8323,
  MYSTERIOUS_STRANGER: 8325,
};

const OBJECT = {
  ENTRANCE: 32653,
  NOTICE_BOARD: 32655,
  RETRIEVAL_CHEST: 32656,
  BARRIER: 32755,
  PASSAGE: 33113,
  XARPUS_DOOR: 32751,
  TREASURE_ROOM: 32738,
  ORATOR: 32756,
  ORATOR_SEATED: 32757,
  SUPPLY_CHEST: 32758,
  SUPPLY_CHEST_OPEN: 32759,
  TELEPORT_CRYSTAL: 32996,
};

const ITEM = {
  ESCAPE_CRYSTAL: 22517,
  DAWNBRINGER: 22516,
  COINS: 995,
};

const INTERFACE = {
  PARTY_INFORMATION: 50,
  PARTIES_OVERVIEW: 364,
  /** The party HUD (tob_hud), on overlay_atmosphere as captured. */
  PARTY_HUD: 28,
  SUPPLIES: 405,
};

const SCRIPT = {
  /** The HUD's five names. */
  HUD_NAMES: 2301,
  /** Fade (transparency, instant, text), red-portal fade (text), white fade (text). */
  FADE: 2306,
  FADE_RED: 2307,
  FADE_WHITE: 2308,
  /** Party information: a member's line (slot, text), an applicant's line, the footer. */
  PARTY_MEMBER: 2317,
  PARTY_APPLICANT: 2321,
  PARTY_FOOTER: 2323,
  /** The party list: one row (index, text). */
  PARTY_ROW: 2340,
};

const VARP = {
  /** -1 while not in a party, 0 in one (the list's "My party" button). */
  HAS_PARTY: 1740,
};

const VARBIT = {
  /** 0 no party, 1 in a lobby party, 2 in the theatre. */
  PARTY_STATE: 6440,
  /** The viewer's own slot, 1-5. */
  MY_SLOT: 6441,
  /** Each slot's state: 0 empty, 1-27 health, 30 dead, 31 elsewhere. */
  SLOT_BASE: 6442,
  /** The room's health bar: its kind, then current and maximum hitpoints over 10. */
  HEALTH_BAR: 6447,
  HEALTH_CURRENT: 6448,
  HEALTH_MAXIMUM: 6449,
  /** Supply points to spend at the chests (the supplies interface shows it). */
  SUPPLY_POINTS: 6460,
  /** The supplies interface: a stamina potion already bought here, and the last Buy-X amount. */
  SUPPLY_STAMINA_BOUGHT: 12271,
  SUPPLY_LAST_AMOUNT: 12272,
  /** The party list's Friends/Clan filter. */
  LIST_FILTER: 12988,
};

const HEALTH_BAR = { REMOVED: 0, REGULAR: 1, DISABLED: 2, CYAN: 3 };

const MAX_PARTY_SIZE = 5;
const MAX_APPLICANTS = 10;
/** Enum 1937: the party list's 45 rows, components 364:18-62. */
const LIST_ROWS = 45;
/** overlay_atmosphere, where the captures open the HUD (28). */
const OVERLAY_HUD_UID = (161 << 16) | 1;

/**
 * Wiki: bosses have 75% of their hitpoints for a team of three or fewer, 87.5% for four and
 * all of them for five. Normal mode only; Entry and Hard mode would add their own row.
 */
const MODES = {
  normal: { name: "Normal", tag: "(Normal Mode)", hitpoints: (size) => (size >= 5 ? 1 : size === 4 ? 0.875 : 0.75) },
};

/**
 * The rooms in order, each with its captured music track. Where a party arrives is captured for every room but Sotetseg's and
 * Verzik's (see docs/theatre-of-blood.md); the rest are estimates: the Vyre Orator loc, where
 * spectators stand and the jail tiles the dead wait on (mostly alcoves in the walls,
 * solid in the map). `entering` says which way through a barrier leads into the fight.
 */
const ROOMS = {
  MAIDEN: {
    key: "MAIDEN", name: "The Maiden of Sugadinti", wave: 1, next: "BLOAT",
    music: 570,
    entrance: { x: 3220, y: 4460, z: 0 },
    orator: { id: OBJECT.ORATOR, x: 3192, y: 4447, z: 0, type: 11, face: 0 },
    spectate: { x: 3190, y: 4453, z: 0 },
    entering: (barrier, at) => at.x > barrier.x,
    jails: [{ x: 3166, y: 4460 }, { x: 3167, y: 4460 }, { x: 3166, y: 4433, face: "N" }, { x: 3167, y: 4433, face: "N" }],
  },
  BLOAT: {
    key: "BLOAT", name: "The Pestilent Bloat", wave: 2, next: "NYLOCAS",
    music: 578,
    entrance: { x: 3322, y: 4448, z: 0 },
    orator: { id: OBJECT.ORATOR_SEATED, x: 3309, y: 4445, z: 0, type: 11, face: 2 },
    spectate: { x: 3304, y: 4434, z: 0 },
    entering: (barrier, at) => (barrier.face === 1 ? at.x > barrier.x : at.x < barrier.x),
    jails: [{ x: 3295, y: 4459 }, { x: 3296, y: 4459 }, { x: 3295, y: 4436 }, { x: 3296, y: 4436 }],
    chest: { x: 3269, y: 4449, face: 3 },
  },
  NYLOCAS: {
    key: "NYLOCAS", name: "The Nylocas", wave: 3, next: "SOTETSEG",
    music: 580,
    entrance: { x: 3295, y: 4283, z: 0 },
    orator: { id: OBJECT.ORATOR, x: 3296, y: 4262, z: 0, type: 11, face: 0 },
    spectate: { x: 3290, y: 4257, z: 0 },
    entering: (barrier, at) => at.y > barrier.y,
    jails: [{ x: 3290, y: 4257 }, { x: 3287, y: 4254 }, { x: 3287, y: 4243 }, { x: 3304, y: 4243 }],
  },
  SOTETSEG: {
    key: "SOTETSEG", name: "Sotetseg", wave: 4, next: "XARPUS",
    music: 584,
    entrance: { x: 3279, y: 4293, z: 0 },
    orator: { id: OBJECT.ORATOR, x: 3281, y: 4301, z: 0, type: 11, face: 1 },
    spectate: { x: 3272, y: 4301, z: 0 },
    entering: (barrier, at) => at.y < barrier.y,
    jails: [{ x: 3270, y: 4313 }, { x: 3270, y: 4314 }, { x: 3289, y: 4313 }, { x: 3289, y: 4314 }],
    chest: { x: 3281, y: 4293, face: 2 },
  },
  XARPUS: {
    key: "XARPUS", name: "Xarpus", wave: 5, next: "VERZIK",
    music: 567,
    entrance: { x: 3170, y: 4375, z: 1 },
    orator: { id: OBJECT.ORATOR, x: 3169, y: 4376, z: 1, type: 11, face: 2 },
    spectate: null,
    entering: (barrier, at) => (barrier.face === 2 ? at.y < barrier.y : at.y > barrier.y),
    jails: [
      { x: 3157, y: 4383, face: "E" }, { x: 3157, y: 4391, face: "E" },
      { x: 3183, y: 4383, face: "W" }, { x: 3183, y: 4387, face: "W" }, { x: 3183, y: 4391, face: "W" },
    ].map((jail) => ({ ...jail, z: 1 })),
  },
  VERZIK: {
    key: "VERZIK", name: "The Final Challenge", wave: 6, next: "REWARDS",
    music: 566,
    // (3168, 4298) is solid in this cache; the arena's floor starts at y 4303.
    entrance: { x: 3168, y: 4303, z: 0 },
    orator: null,
    spectate: { x: 3168, y: 4313, z: 0 },
    entering: () => false,
    jails: [{ x: 3157, y: 4325 }, { x: 3159, y: 4325 }, { x: 3161, y: 4325 }, { x: 3175, y: 4325 }, { x: 3177, y: 4325 }],
    /** Where Verzik's treasure room door appears once she's beaten (estimate). */
    exit: { id: OBJECT.TREASURE_ROOM, x: 3167, y: 4324, z: 0, type: 10, face: 0 },
  },
  REWARDS: {
    key: "REWARDS", name: "Verzik Vitur's Vault", wave: 7, next: null,
    music: 582,
    entrance: { x: 3237, y: 4307, z: 0 },
    orator: null,
    spectate: null,
    entering: () => false,
    jails: [],
  },
};
const ROOM_ORDER = ["MAIDEN", "BLOAT", "NYLOCAS", "SOTETSEG", "XARPUS", "VERZIK", "REWARDS"];

function loc(tile, z) {
  const { Location } = core();
  return new Location(tile.x, tile.y, z ?? tile.z ?? 0);
}

function tileOf(entity) {
  const location = entity.getLocation();
  return { x: location.getX(), y: location.getY(), z: location.getZ() };
}

function inBox(location, box) {
  const x = location.getX();
  const y = location.getY();
  if (box.z !== undefined && location.getZ() !== box.z) return false;
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

function inTheatre(location) {
  return inBox(location, THEATRE);
}

function inVerSinhaza(location) {
  return inBox(location, VER_SINHAZA);
}

function cycle() {
  return core().World.getProcessCycle();
}

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

function npcSay(player, npcId, text) {
  const { DialogueChainBuilder, NpcDialogue, EndDialogue } = core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, npcId, text),
    new EndDialogue(1),
  ));
}

/** A chatbox choice: options("Title?", "Yes.", onYes, "No.", onNo). */
function options(player, title, ...pairs) {
  const args = [];
  for (let i = 0; i < pairs.length; i += 2) args.push(pairs[i], pairs[i + 1] ?? (() => {}));
  api().sendMultiChatboxPrompt(player, title, ...args);
}

/** The HUD's fades (interface 28 must be open): to black and back, with a line of text. */
function fade(player, transparency, text = "", instant = 0) {
  player.getPacketSender().sendClientScript(SCRIPT.FADE, transparency, instant, text);
}

function fadeRed(player, text = "") {
  player.getPacketSender().sendClientScript(SCRIPT.FADE_RED, text);
}

/** Fades to red, moves the player two ticks later, then fades in with `text`. */
function fadeMove(player, text, action) {
  fadeRed(player, "");
  later(player, 2, () => {
    action();
    fade(player, 255, text);
  });
}

/** A direction id for an NPC's spawn facing (`spawn(..., { face })`), by name: "SOUTH", "EAST"... */
function facing(name) {
  return core().Direction[name].getId();
}

function displayName(player) {
  return player.getUsername();
}

/** "him" or "her", as the theatre's messages about another member say it. */
function objectPronoun(player) {
  return player.getAppearance?.()?.isMale?.() === false ? "her" : "him";
}

function formatTicks(ticks) {
  const seconds = Math.max(0, Math.floor(ticks * 0.6));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Hooks every option of the objects with these names or ids. The handler gets the event with
 * `option` set to the clicked option's label and returns false to let others handle it.
 */
function onObject(pluginApi, ids, handler) {
  const wanted = new Set([].concat(ids));
  pluginApi.onObjectInteraction((event) => {
    if (event.handled || !Number.isInteger(event.clickType)) return;
    const id = event.objectId ?? event.object?.getId?.();
    if (!wanted.has(id) && !wanted.has(event.definition?.getName?.())) return;
    event.option = event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "";
    if (handler(event) !== false) event.handled = true;
  });
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

/** A graphic with an explicit delay (client cycles) and height; Graphic's own overloads guess. */
function gfx(id, { delay = 0, height = 0 } = {}) {
  const { Graphic } = core();
  return Object.assign(new Graphic(id), { delay, height });
}

/** A graphic on a tile, for everyone in `area` who can see it. */
function graphicAt(area, id, tile, options = {}) {
  const location = tile.getX ? tile : loc(tile);
  for (const viewer of area.getPlayers()) {
    if (location.isViewableFrom?.(viewer.getLocation()) === false) continue;
    viewer.getPacketSender().sendGraphic(gfx(id, options), location);
  }
}

function sound(player, id, delay = 0) {
  player.getPacketSender().sendSound(id, 1, delay);
}

/** A sound from an NPC (or tile) for everyone in the raid who can see it. */
function areaSound(area, source, id, delay = 0) {
  const at = source.getLocation ? source.getLocation() : (source.getX ? source : loc(source));
  for (const viewer of area.getPlayers()) {
    if (at.isViewableFrom?.(viewer.getLocation()) === false) continue;
    sound(viewer, id, delay);
  }
}

/** Typeless damage, queued for the next hit processing. */
function damage(target, amount, mask = "RED") {
  const { HitDamage, HitMask } = core();
  if (!target || amount <= 0 || target.getHitpoints() <= 0) return;
  target.getCombat().getHitQueue().addPendingDamage([new HitDamage(Math.trunc(amount), HitMask[mask])]);
}

function heal(npc, amount) {
  if (!npc || amount <= 0 || npc.getHitpoints() <= 0) return;
  const max = npc.getMaxHitpoints?.() ?? npc.getHitpoints();
  npc.setHitpoints(Math.min(max, npc.getHitpoints() + Math.trunc(amount)));
}

/**
 * A projectile between actors or tiles, seen inside `area`. It leaves after `delay` client
 * cycles and lands `duration` + `perTile` x distance cycles later (between `minDuration` and `maxDuration`);
 * returns that in game ticks. `angle` and `progress` are the packet's arc and start offset.
 */
function projectile(area, from, to, id, { delay = 0, duration = 30, perTile = 5, minDuration = 0, maxDuration = Infinity, startHeight = 43, endHeight = 31, angle = 16, progress = 64 } = {}) {
  const { Projectile } = core();
  const start = from.getLocation ? Projectile.centreOf(from) : (from.getX ? from : loc(from));
  const end = to.getLocation ? Projectile.centreOf(to) : (to.getX ? to : loc(to));
  const lockon = to.getLocation ? to : null;
  const speed = delay + Math.min(maxDuration, Math.max(minDuration, duration + start.getDistance(end) * perTile));
  new Projectile(start, end, lockon, id, delay, speed, startHeight, endHeight, area)
    .withAngle(angle)
    .withProgress(progress)
    .sendProjectile();
  return Math.ceil(speed / 30);
}

/** Whether a line of sight runs from an NPC's footprint to a tile (or another actor). */
function lineOfSight(npc, target, area) {
  const { RegionManager } = core();
  const from = npc.getLocation();
  const to = target.getLocation ? target.getLocation() : target;
  const size = npc.getSize?.() ?? 1;
  const targetSize = target.getSize?.() ?? 1;
  return RegionManager.canProjectileAttackBounds(from, to, size, size, targetSize, targetSize, area ?? npc.getPrivateArea?.());
}

function floorFree(area, tile) {
  const { RegionManager } = core();
  const location = tile.getX ? tile : loc(tile);
  return !RegionManager.blocked(location, area);
}

/** Chebyshev distance from a tile to an actor's footprint (0 when on it). */
function distanceTo(actor, tile) {
  const at = actor.getLocation();
  const size = actor.getSize?.() ?? 1;
  const x = tile.getX ? tile.getX() : tile.x;
  const y = tile.getY ? tile.getY() : tile.y;
  const dx = x < at.getX() ? at.getX() - x : x > at.getX() + size - 1 ? x - (at.getX() + size - 1) : 0;
  const dy = y < at.getY() ? at.getY() - y : y > at.getY() + size - 1 ? y - (at.getY() + size - 1) : 0;
  return Math.max(dx, dy);
}

/** Whether a tile lies on an actor's footprint. */
function covers(actor, tile) {
  return distanceTo(actor, tile) === 0;
}

/**
 * Moves an NPC in a straight line to `tile` whatever the map holds: the scripted bosses'
 * clipping-free walks.
 */
function walkStraight(npc, tile) {
  const location = tile.getX ? tile : loc(tile);
  npc.setFlag?.("movement:ignore-clipping");
  const movement = npc.getMovementQueue();
  movement.setBlockMovement?.(false);
  movement.reset();
  movement.addSteps(location);
}

function frozen(entity) {
  const { TimerKey } = core();
  return !!entity.getTimers?.().has?.(TimerKey.FREEZE);
}

function isProtected(player, style) {
  const { PrayerHandler } = core();
  const prayer = style === "magic" ? PrayerHandler.PROTECT_FROM_MAGIC
    : style === "ranged" ? PrayerHandler.PROTECT_FROM_MISSILES : PrayerHandler.PROTECT_FROM_MELEE;
  return PrayerHandler.isActivated(player, prayer);
}

/** Back to full Defence after a drain (Bloat's stomp, each Sotetseg maze). */
function restoreDefence(npc) {
  const base = npc.getCurrentDefinition?.()?.getStats?.()?.[2];
  if (Number.isFinite(base)) npc.setDefenceLevel?.(base);
}

/** Hands a scripted raid NPC over to ordinary combat (an aggressive nylocas, Vasilias). */
function unscript(npc) {
  npc.__tobScripted = false;
  npc.setScriptedMovement?.(false);
  npc.setFlag?.("combat:no-retaliate", false);
  npc.setFlag?.("movement:ignore-clipping", false);
}

/**
 * The Dawnbringer never leaves Verzik's room: it's taken when her shield falls and from anyone
 * leaving the raid. True when it was in the player's hand.
 */
function removeDawnbringer(player) {
  const { Equipment, Item, Flag } = core();
  const id = ITEM.DAWNBRINGER;
  const inventory = player.getInventory();
  const carried = inventory.getAmount(id);
  if (carried > 0) inventory.delete(id, carried);
  const equipment = player.getEquipment();
  if (equipment.getItems()[Equipment.WEAPON_SLOT]?.getId() !== id) return false;
  equipment.setItem(Equipment.WEAPON_SLOT, new Item(-1, 0));
  equipment.refreshItems();
  const { EquipPacketListener } = core();
  EquipPacketListener.resetWeapon(player, true);
  player.getUpdateFlag().flag(Flag.APPEARANCE);
  return true;
}

module.exports = {
  removeDawnbringer, unscript, restoreDefence, random, randomOf, shuffle, gfx, graphicAt, sound, areaSound, damage, heal, projectile, lineOfSight, floorFree,
  distanceTo, covers, walkStraight, frozen, isProtected,
  bind, core, api,
  THEATRE, THEATRE_PLANES, VER_SINHAZA, OUTSIDE, NPC, OBJECT, ITEM, INTERFACE, SCRIPT, VARP, VARBIT,
  HEALTH_BAR, MAX_PARTY_SIZE, MAX_APPLICANTS, LIST_ROWS, OVERLAY_HUD_UID, MODES, ROOMS, ROOM_ORDER,
  loc, tileOf, inBox, inTheatre, inVerSinhaza, cycle, later, repeat, statement, npcSay, options,
  fade, fadeRed, fadeMove, facing, displayName, objectPronoun, formatTicks, onObject,
};
