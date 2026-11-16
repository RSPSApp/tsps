/**
 * Hallowed Sepulchre: what the units share - the plugin api, the data from
 * plugins/minigames/data/hallowed-sepulchre.json, tick timing, the recorded fades, the timer HUD
 * and the chat helpers.
 */
const fs = require("fs");
const path = require("path");

const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const OVERLAY_HUD_UID = (161 << 16) | 8;
const FADE_CYCLES = 50;
const AGILITY_REQUIREMENTS_CONFIG = "HallowedSepulchre:agilityRequirements";

let api = null;
let core = null;
let data = null;
const seqIds = new Map();

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "hallowed-sepulchre.json"), "utf8"));
}

/**
 * Whether entering and each floor's stairs need the floor's Agility level (the Wiki's); world.json
 * pluginConfig `HallowedSepulchre:agilityRequirements` false lets any level through.
 */
function agilityRequired() {
  return api.getPluginConfig(AGILITY_REQUIREMENTS_CONFIG, true) !== false;
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
const key = (x, y, z) => `${x},${y},${z}`;

function varbit(player, name, value) {
  player.getPacketSender().sendVarbit(data.varbits[name], value);
}

/** A sequence id from its gameval name in `data.seqs`, or -1 if the cache lacks it. */
function seq(name) {
  if (!seqIds.has(name)) seqIds.set(name, core.CacheDefinitions.getSeqId(data.seqs[name] ?? name) ?? -1);
  return seqIds.get(name);
}

function animate(player, name, delay = 0) {
  const id = seq(name);
  player.performAnimation(new core.Animation(id, delay));
}

function graphic(player, name, height = 0, delay = 0) {
  player.performGraphic(new core.Graphic(data.spotanims[name], delay, height));
}

/** Fade to black (`out`) or back in, as live: fade_overlay with script 948. */
/** Returns the mount, so a delayed close can take down only this fade and never a replacement. */
function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  return player.getPacketSender().mountSubInterface(OVERLAY_ATMOSPHERE_UID, data.interfaces.fade, 1, {
    postScripts: [{ scriptId: data.scripts.fade, args }],
  });
}

/** The stairs' fade: fade_overlay with script 951 (fade_overlay_legacy). */
function legacyFade(player) {
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, data.interfaces.fade, 1, {
    postScripts: [{ scriptId: data.scripts.legacyFade, args: [] }],
  });
}

function closeFade(player) {
  player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID);
}

function minimap(player, off) {
  varbit(player, "minimap_state", off ? 2 : 0);
}

function openHud(player) {
  player.getPacketSender().sendSubInterface(OVERLAY_HUD_UID, data.interfaces.overlay, 1);
}

function closeHud(player) {
  player.getPacketSender().closeSubInterface(OVERLAY_HUD_UID);
}

function song(player, name) {
  player.getPacketSender().sendSong(data.songs[name]);
}

function jingle(player, name) {
  player.getPacketSender().sendJingle(data.jingles[name], 0);
}

function message(name, values = {}) {
  return String(data.messages[name]).replace(/\{(\w+)\}/g, (_, field) => String(values[field] ?? ""));
}

/** A filterable line, as live sends the obstacle lines. */
function spam(player, text) {
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text);
}

function xp(player, skill, amount) {
  if (amount > 0) player.getSkillManager().addExperience(core.Skill[skill], amount);
}

function level(player, skill) {
  return player.getSkillManager().getCurrentLevel(core.Skill[skill]);
}

/** A message box, then `onEnd` once it is continued. */
function box(player, text, onEnd = null) {
  const { ActionDialogue, DialogueChainBuilder, EndDialogue, StatementDialogue } = core;
  const builder = new DialogueChainBuilder().add(new StatementDialogue(0, text));
  builder.add(onEnd ? new ActionDialogue(1, { execute: () => then(player, onEnd) }) : new EndDialogue(1));
  player.getDialogueManager().startDialogues(builder);
}

function itemBox(player, itemId, text, onEnd = null) {
  const { ActionDialogue, DialogueChainBuilder, EndDialogue, ItemStatementDialogue } = core;
  const builder = new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text));
  builder.add(onEnd ? new ActionDialogue(1, { execute: () => then(player, onEnd) }) : new EndDialogue(1));
  player.getDialogueManager().startDialogues(builder);
}

function npcChat(player, npcId, text, onEnd = null) {
  const { ActionDialogue, DialogueChainBuilder, EndDialogue, NpcDialogue } = core;
  const builder = new DialogueChainBuilder().add(new NpcDialogue(0, npcId, text));
  builder.add(onEnd ? new ActionDialogue(1, { execute: () => then(player, onEnd) }) : new EndDialogue(1));
  player.getDialogueManager().startDialogues(builder);
}

/** A chatbox menu: options are [text, action] pairs. */
function menu(player, title, options) {
  api.sendMultiChatboxPrompt(player, title, ...options.flatMap(([text, action]) => [text, () => action()]));
}

function then(player, action) {
  closeChat(player);
  action();
}

function closeChat(player) {
  player.getDialogueManager().reset();
  player.getPacketSender().sendInterfaceRemoval();
}

const randomInt = (low, high) => low + Math.floor(Math.random() * (high - low + 1));
const randomOf = (list) => list[Math.floor(Math.random() * list.length)];

/** One of `entries` by weight: [value, weight] pairs. */
function weighted(entries) {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return entries[entries.length - 1]?.[0] ?? null;
}

/** "M:SS" for a number of game ticks, rounded to the second (rev 234). */
function formatTime(ticks) {
  const seconds = Math.round(ticks * 0.6);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A persisted object attribute (completions or personal bests per floor). */
function record(player, name) {
  const value = player.getAttribute(data.attributes[name]);
  return value && typeof value === "object" ? { ...value } : {};
}

module.exports = {
  init,
  agilityRequired,
  later,
  toLocation,
  key,
  varbit,
  seq,
  animate,
  graphic,
  fade,
  legacyFade,
  closeFade,
  minimap,
  openHud,
  closeHud,
  song,
  jingle,
  message,
  spam,
  xp,
  level,
  box,
  itemBox,
  npcChat,
  menu,
  closeChat,
  randomInt,
  randomOf,
  weighted,
  formatTime,
  record,
  get api() {
    return api;
  },
  get core() {
    return core;
  },
  get data() {
    return data;
  },
};
