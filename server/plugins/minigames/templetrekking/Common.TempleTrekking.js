/**
 * Temple Trekking: what the units share - the plugin api, the data from
 * plugins/minigames/data/temple-trekking.json, tick timing, the captured fade, the saved
 * attributes and the dialogue helpers.
 */
const fs = require("fs");
const path = require("path");

/** Points of each reward token the player holds, by token item id, oldest first. */
const TOKEN_POINTS_ATTRIBUTE = "temple-trekking:token-points";
/** The followers' shared backpack (Wiki: it serves every follower): [{ id, amount }]. */
const PACK_ATTRIBUTE = "temple-trekking:follower-pack";
/** Where a player who logs out mid-trek comes back: the trek's start. */
const RETURN_ATTRIBUTE = "temple-trekking:return";

const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;
const MINIMAP_OFF = 2;
const MINIMAP_TREK = 3;

/** Toplevel side tabs: live closes these while the map plays and reopens them in a room. */
const TOPLEVEL = 161;
const COMBAT_TAB = 76;
const MAGIC_TAB = 82;
const HIDDEN_TABS = [[77, 320], [78, 629], [79, 149], [80, 387], [81, 541], [87, 116], [88, 216]];

let api = null;
let core = null;
let data = null;
const npcIds = {};

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "temple-trekking.json"), "utf8"));
  for (const follower of data.followers) npcIds[follower.id] = follower;
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

function varbit(player, name, value) {
  player.getPacketSender().sendVarbit(data.varbits[name], value);
}

/** The follower varp as live sends it: the npc id over its index. */
function followerVarp(player, npc) {
  const value = npc ? ((npc.getId() << 16) | npc.getIndex()) : -1;
  player.getPacketSender().sendConfig(data.varps.followerNpc, value);
}

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, {
    postScripts: [{ scriptId: FADE_SCRIPT, args }],
  });
}

function closeFade(player) {
  player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID);
}

function minimap(player, state) {
  varbit(player, "minimap_state", state === "off" ? MINIMAP_OFF : state === "trek" ? MINIMAP_TREK : 0);
}

function sound(player, id) {
  player.getPacketSender().sendSound(id, 1, 0);
}

function jingle(player, name) {
  player.getPacketSender().sendJingle(data.jingles[name], 0);
}

function song(player, name) {
  player.getPacketSender().sendSong(data.songs[name]);
}

function hideTabs(player) {
  const sender = player.getPacketSender();
  for (const slot of [COMBAT_TAB, MAGIC_TAB, ...HIDDEN_TABS.map(([tab]) => tab)]) {
    sender.closeSubInterface((TOPLEVEL << 16) | slot);
  }
}

function restoreTabs(player) {
  const sender = player.getPacketSender();
  sender.sendTabInterface(0, 593);
  sender.sendTabInterface(6, player.getSpellbook().getInterfaceId());
  for (const [slot, group] of HIDDEN_TABS) sender.sendTabInterface(slot, group);
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function questComplete(player, key) {
  const request = { player, key, complete: null };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

const follower = (npcId) => npcIds[npcId] ?? null;

/**
 * A chain of chatbox lines: ["npc", npcId, text] or ["player", text], then `onEnd` (if any)
 * once the last is continued. Without `onEnd` the chatbox closes after the last line.
 */
function chat(player, lines, onEnd = null) {
  const { ActionDialogue, DialogueChainBuilder, EndDialogue, NpcDialogue, PlayerDialogue } = core;
  const builder = new DialogueChainBuilder();
  let index = 0;
  for (const line of lines) {
    if (line[0] === "npc") builder.add(new NpcDialogue(index++, line[1], line[2]));
    else builder.add(new PlayerDialogue(index++, line[1]));
  }
  if (onEnd) builder.add(new ActionDialogue(index++, { execute: () => then(player, onEnd) }));
  else builder.add(new EndDialogue(index));
  player.getDialogueManager().startDialogues(builder);
}

/** Closes the finished chat, then carries on (another chat, a choice or the map). */
function then(player, action) {
  closeChat(player);
  action();
}

/** A chatbox choice: options are [text, action] pairs. */
function choose(player, title, options) {
  api.sendMultiChatboxPrompt(player, title, ...options.flatMap(([text, action]) => [text, () => action()]));
}

function statement(player, text, onEnd = null) {
  const { ActionDialogue, DialogueChainBuilder, EndDialogue, StatementDialogue } = core;
  const builder = new DialogueChainBuilder().add(new StatementDialogue(0, text));
  builder.add(onEnd ? new ActionDialogue(1, { execute: () => then(player, onEnd) }) : new EndDialogue(1));
  player.getDialogueManager().startDialogues(builder);
}

function itemStatement(player, itemId, text, onEnd = null) {
  const { ActionDialogue, DialogueChainBuilder, EndDialogue, ItemStatementDialogue } = core;
  const builder = new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text));
  builder.add(onEnd ? new ActionDialogue(1, { execute: () => then(player, onEnd) }) : new EndDialogue(1));
  player.getDialogueManager().startDialogues(builder);
}

function closeChat(player) {
  player.getDialogueManager().reset();
  player.getPacketSender().sendInterfaceRemoval();
}

const randomInt = (low, high) => low + Math.floor(Math.random() * (high - low + 1));
const randomOf = (list) => list[Math.floor(Math.random() * list.length)];

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
  init,
  later,
  toLocation,
  varbit,
  followerVarp,
  fade,
  closeFade,
  minimap,
  sound,
  jingle,
  song,
  hideTabs,
  restoreTabs,
  questComplete,
  follower,
  chat,
  choose,
  statement,
  itemStatement,
  closeChat,
  randomInt,
  randomOf,
  weighted,
  TOKEN_POINTS_ATTRIBUTE,
  PACK_ATTRIBUTE,
  RETURN_ATTRIBUTE,
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
