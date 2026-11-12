/**
 * Volcanic Mine: what the units share - the plugin api, the data from
 * plugins/minigames/data/volcanic-mine.json, tick timing, the HUD varbits and the chat helpers.
 */
const fs = require("fs");
const path = require("path");

const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;

let api = null;
let core = null;
let data = null;

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "volcanic-mine.json"), "utf8"));
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

function seq(name) {
  return core.CacheDefinitions.getSeqId(data.seqs[name] ?? name) ?? -1;
}

function animate(entity, name, delay = 0) {
  const id = seq(name);
  if (id >= 0) entity.performAnimation(new core.Animation(id, delay));
}

function sound(player, name, delay = 0) {
  player.getPacketSender().sendSound(data.sounds[name], 1, delay);
}

function openHud(player) {
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, data.interfaces.hud, 1);
}

function closeHud(player) {
  player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID);
}

function song(player, name) {
  player.getPacketSender().sendSong(data.songs[name]);
}

function message(name, values = {}) {
  return String(data.messages[name]).replace(/\{(\w+)\}/g, (_, field) => String(values[field] ?? ""));
}

/** A filterable line, as live sends the mining lines. */
function spam(player, text) {
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text);
}

/**
 * Experience from the mine. Mining XP asks the prospector outfit for its bonus ("mining:xp-multiplier"):
 * the Wiki's Volcanic Mine page has 3.8 Mining XP a point, "3.895 with the prospector kit bonus".
 */
function xp(player, skill, amount) {
  if (!(amount > 0)) return;
  const request = { player, multiplier: 1 };
  if (skill === "MINING") api.emitCustomEvent("mining:xp-multiplier", request);
  player.getSkillManager().addExperience(core.Skill[skill], amount * request.multiplier);
}

function level(player, skill) {
  return player.getSkillManager().getCurrentLevel(core.Skill[skill]);
}

function maxLevel(player, skill) {
  return player.getSkillManager().getMaxLevel?.(core.Skill[skill]) ?? level(player, skill);
}

/** The best pickaxe the player can use, answered by the Mining plugin: { id, animation, attemptIntervalTicks, ... } or null. */
function bestPickaxe(player) {
  const request = { player, pickaxe: null };
  api.emitCustomEvent("mining:best-pickaxe", request);
  return request.pickaxe;
}

/** Ticks to the pickaxe's next roll, answered by the Mining plugin (dragon-tier pickaxes sometimes roll early). */
function rollInterval(pickaxe) {
  const request = { pickaxe, ticks: null };
  api.emitCustomEvent("mining:roll-interval", request);
  return request.ticks ?? pickaxe.attemptIntervalTicks;
}

/** A hit that lands this tick. */
function hurt(player, amount) {
  const { HitDamage, HitMask } = core;
  player.addTickHit(player.decrementHealth(new HitDamage(Math.max(0, amount | 0), HitMask.RED)));
}

/**
 * A chain of chatbox lines - ["npc", text] (Pete) or ["player", text] - then `onEnd` once the
 * last is continued.
 */
function chat(player, lines, onEnd = null) {
  const { ActionDialogue, DialogueChainBuilder, EndDialogue, NpcDialogue, PlayerDialogue } = core;
  const builder = new DialogueChainBuilder();
  let index = 0;
  for (const [who, text] of lines) {
    if (who === "npc") builder.add(new NpcDialogue(index++, data.npcs.pete, text));
    else builder.add(new PlayerDialogue(index++, text));
  }
  if (onEnd) builder.add(new ActionDialogue(index++, { execute: () => then(player, onEnd) }));
  else builder.add(new EndDialogue(index));
  player.getDialogueManager().startDialogues(builder);
}

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

module.exports = {
  init, later, toLocation, key, varbit, seq, animate, sound, openHud, closeHud, song, message, spam,
  xp, level, maxLevel, bestPickaxe, rollInterval, hurt, chat, box, itemBox, menu, closeChat, randomInt, weighted,
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
