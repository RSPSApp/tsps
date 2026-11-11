/**
 * Phantom Muspah: what the units share - the plugin api, the data from
 * plugins/bosses/data/phantom-muspah.json, tick helpers, the lair's tiles, graphics, sounds and
 * the Muspah's overlay.
 */
const fs = require("fs");
const path = require("path");

/** Set while the player is in the lair's instance, so a login there puts them by the crevice. */
const INSIDE_ATTRIBUTE = "phantom-muspah:inside";
/** The player's own kill count and fastest kill (ticks). */
const KILLS_ATTRIBUTE = "phantom-muspah:kills";
const BEST_TICKS_ATTRIBUTE = "phantom-muspah:best-ticks";

const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const BUSY_VARBIT = 12393;
const MINIMAP_STATE_VARBIT = 6719;
const MINIMAP_OFF = 2;
/** settings_muspah_messages: All Settings "Disable Phantom Muspah messages". */
const MESSAGES_DISABLED_VARBIT = 14711;
const CHUNK = 8;

let api = null;
let core = null;
let data = null;
let arenaOffsets = null;

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "phantom-muspah.json"), "utf8"));
  arenaOffsets = null;
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
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ------------------------------------------------------------------ the lair's tiles

/** The lair's template square, as chunk coordinates. */
function sourceChunk() {
  const { sourceChunkX, sourceChunkY } = data.lair.instance;
  return { x: sourceChunkX, y: sourceChunkY };
}

/** An instance tile for a lair tile [x, y, z?]. */
function tileIn(area, [x, y, z]) {
  const source = sourceChunk();
  return area.tile(x - source.x * CHUNK, y - source.y * CHUNK, z ?? 0);
}

/** The lair tile [x, y, z] an instance tile copies. */
function lairTile(area, location) {
  const source = sourceChunk();
  return [
    location.getX() - area.getBaseX() + source.x * CHUNK,
    location.getY() - area.getBaseY() + source.y * CHUNK,
    location.getZ(),
  ];
}

/**
 * The arena's floor, as offsets from its centre: every tile the shockwave reaches, plus the
 * centre itself (data shockwave.map, from every captured shockwave).
 */
function arena() {
  if (arenaOffsets) return arenaOffsets;
  const { west, north, rows } = data.shockwave.map;
  const tiles = [];
  const kind = new Map();
  rows.forEach((row, line) => {
    for (let column = 0; column < row.length; column++) {
      const char = row[column];
      const dx = west + column;
      const dy = north - line;
      const inCentre = Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
      if (char === " " && !inCentre) continue;
      tiles.push([dx, dy]);
      if (char !== " ") kind.set(`${dx},${dy}`, char === "o" ? "bright" : "dark");
    }
  });
  arenaOffsets = { tiles, kind, keys: new Set(tiles.map(([dx, dy]) => `${dx},${dy}`)) };
  return arenaOffsets;
}

/** The lair tile [x, y] at an offset from the arena's centre. */
function fromCentre([dx, dy]) {
  const [cx, cy] = data.boss.centre;
  return [cx + dx, cy + dy];
}

/** Whether a lair tile [x, y] is on the arena's floor. */
function onArena([x, y]) {
  const [cx, cy] = data.boss.centre;
  return arena().keys.has(`${x - cx},${y - cy}`);
}

// ------------------------------------------------------------------ graphics and sounds

function graphic(id, { delay = 0, height = 0 } = {}) {
  const gfx = new core.Graphic(id);
  gfx.delay = delay;
  gfx.height = height;
  return gfx;
}

/** A map animation on an instance tile, for the player. */
function tileGraphic(player, location, id, options) {
  player.getPacketSender().sendGraphic(graphic(id, options), location);
}

function animate(mobile, id) {
  mobile.performAnimation(new core.Animation(id));
}

/** A sound for the player: an id, or [id, delay]. */
function sound(player, spec) {
  if (spec == null) return;
  const [id, delay] = Array.isArray(spec) ? spec : [spec, 0];
  player.getPacketSender().sendSoundEffect(id, 1, delay ?? 0);
}

function sounds(player, specs) {
  for (const spec of specs ?? []) sound(player, spec);
}

/** A sound heard around an instance tile. */
function areaSound(player, location, [id, delay], radius) {
  player.getPacketSender().sendAreaSound(id, location.getX(), location.getY(), location.getZ(), 1, delay ?? 0, radius ?? 0);
}

/** One of the fight's chat lines (darkness, prayer shield, corruption), unless the player turned them off. */
function fightMessage(player, text) {
  if (player.getPacketSender().getVarbit?.(MESSAGES_DISABLED_VARBIT) === 1) return;
  player.sendMessage(text);
}

// ------------------------------------------------------------------ the overlay and the trip

/** The Muspah's darkness overlay (interface 818), set to `value` with its fade script. */
function overlay(player, value) {
  const { interface: group, script } = data.overlay;
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, group, 1, {
    postScripts: [{ scriptId: script, args: [value] }],
  });
}

/** Just the overlay's fade, once it's open. */
function overlayFade(player, value) {
  player.getPacketSender().sendClientScript(data.overlay.script, value);
}

function closeOverlay(player) {
  player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID);
}

function fade(player, args) {
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, {
    postScripts: [{ scriptId: FADE_SCRIPT, args }],
  });
}

/**
 * The captured trip through the crevice: the fade out with `message` (no continue), the minimap
 * off a tick later, `move` two ticks in, then the fade back in with `message` again. The busy flag
 * and the minimap come back with it; `arrived` runs then.
 */
function travel(player, message, move, arrived) {
  const { fade: timing } = data.lair;
  const { StatementDialogue, DialogueChainBuilder, ActionDialogue } = core;
  const sender = player.getPacketSender();
  sender.sendVarbit(BUSY_VARBIT, 1);
  fade(player, timing.outArgs);
  StatementDialogue.send(player, message, false);
  later(timing.minimapTicks, () => player.isRegistered() && sender.sendVarbit(MINIMAP_STATE_VARBIT, MINIMAP_OFF));
  later(timing.moveTicks, () => player.isRegistered() && move());
  later(timing.inTicks, () => {
    if (!player.isRegistered()) return;
    sender.sendVarbit(MINIMAP_STATE_VARBIT, 0);
    sender.sendVarbit(BUSY_VARBIT, 0);
    fade(player, timing.inArgs);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new StatementDialogue(0, message),
      new ActionDialogue(1, { execute: () => sender.sendInterfaceRemoval() }),
    ));
    arrived?.();
  });
}

/** A track by its id: unlocked (with its message) and played. */
function playMusic(player, trackId) {
  api.emitCustomEvent("music:unlock-track", { player, trackId });
  player.getPacketSender().sendSong(trackId);
}

/** Whether the player can still be hit (not dying, not gone). */
const alive = (player) => player.isRegistered() && player.getHitpoints() > 0 && !player.isDyingReturn?.();

const count = (player, key) => Math.max(0, Math.trunc(Number(player.getAttribute(key)) || 0));

module.exports = {
  init, later, randomInt, pick, shuffle,
  tileIn, lairTile, arena, fromCentre, onArena,
  graphic, tileGraphic, animate, sound, sounds, areaSound,
  fightMessage, overlay, overlayFade, closeOverlay, travel, playMusic, count, alive,
  INSIDE_ATTRIBUTE, KILLS_ATTRIBUTE, BEST_TICKS_ATTRIBUTE, CHUNK,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
};
