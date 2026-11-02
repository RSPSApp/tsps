"use strict";

/**
 * What the Death's Office units share: the api, cache ids (by gameval name), the office data,
 * Death's chathead lines, and the player's death storage, asked of the Gravestones plugin.
 */
const DATA = require("../data/deaths-office.json");

let pluginApi = null;
const ID = {};

const COMPONENT_NAMES = {
  officeItems: "death_office:items",
  officeTake1: "death_office:1",
  officeTake5: "death_office:5",
  officeTakeX: "death_office:x",
  officeTakeAll: "death_office:all",
  officeTakeEverything: "death_office:takeall",
  portalBackground: "overlay_portal:background",
  portalForeground: "overlay_portal:foreground",
  overlayAtmosphere: "toplevel_osrs_stretch:overlay_atmosphere",
  mainModal: "toplevel_osrs_stretch:mainmodal",
  sideModal: "toplevel_osrs_stretch:sidemodal",
  cofferDisplay: "death_coffer:display",
  cofferPortal: "death_coffer:portal",
  coffer1: "death_coffer:1",
  coffer5: "death_coffer:5",
  cofferX: "death_coffer:x",
  cofferAll: "death_coffer:all",
  cofferConfirm: "death_coffer:confirm",
  cofferSideItems: "death_coffer_side:items",
};
const COMPONENT = {};

/** The varps the office and Coffer interfaces' scripts draw from, by gameval name. */
const VARP_NAMES = ["if1", "if2", "if3", "if4"];
const VARP = {};

/** overlay_portal (2893) and overlay_portal_remove (2894): the portal's swirl over the screen. */
const SCRIPT = { overlayPortal: 2893, overlayPortalRemove: 2894, mainModalOpen: 2524, mainModalBackground: 917, invInit: 149 };
/** As captured: the portal's model, colour and sound, and Death's payment sound. */
const PORTAL = { model: 39504, colour: 4128927, sound: 3952 };
const PAYMENT_SOUND = 2115;
const PAYMENT_SOUND_DELAY = 10;
const OVERLAY = 1;
const MODAL = 0;
const OP1 = 1 << 1;
const OP10 = 1 << 10;

/** Chathead moods; the animation's 1-4 is the line count, as live (chatbored2 on two lines). */
const MOOD = { neutral: 588, happy: 567, quiz: 554, bored: 562, shifty: 592, laugh: 605, sad: 610, angry: 614 };
const LINE_WIDTH = 53;

function bind(api) {
  pluginApi = api;
  const { CacheDefinitions } = api.core;
  for (const name of VARP_NAMES) VARP[name] = CacheDefinitions.getVarpId(name);
  ID.death = CacheDefinitions.getNpcId("death_office_death");
  ID.exitPortal = CacheDefinitions.getLocId("death_office_exitportal");
  ID.cofferLoc = CacheDefinitions.getLocId("death_coffer_access");
  for (const [key, name] of Object.entries(COMPONENT_NAMES)) COMPONENT[key] = CacheDefinitions.getComponentId(name);
  ID.officeInterface = COMPONENT.officeItems >>> 16;
  ID.portalInterface = COMPONENT.portalBackground >>> 16;
  ID.cofferInterface = COMPONENT.cofferDisplay >>> 16;
  ID.cofferSideInterface = COMPONENT.cofferSideItems >>> 16;
}

function api() {
  return pluginApi;
}

function core() {
  return pluginApi.core;
}

function location([x, y, z = 0]) {
  return new (core().Location)(x, y, z);
}

function later(key, ticks, action) {
  const { Task, TaskManager } = core();
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), key, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

function sound(player, id, delay = 0) {
  player.getPacketSender().sendSoundEffect(id, 1, delay, 255);
}

function formatCoins(amount) {
  return Math.trunc(amount).toLocaleString("en-US");
}

// ---------------------------------------------------------------- the player's death storage

/** The Gravestones plugin's answer: grave, office, coffer, style, metDeath, inTutorial, ironman. */
function state(player) {
  const query = { player };
  pluginApi.emitCustomEvent("gravestones:state", query);
  return query;
}

function payFee(player, amount) {
  const request = { player, amount, office: true, source: null, message: null };
  pluginApi.emitCustomEvent("gravestones:pay-fee", request);
  return request;
}

function adjustCoffer(player, amount) {
  const request = { player, amount, ok: false };
  pluginApi.emitCustomEvent("gravestones:coffer-adjust", request);
  return request.ok;
}

// ---------------------------------------------------------------- dialogue

let ChatLines = null;

/**
 * Death's lines (chat_left) and the player's (chat_right), with the chathead mood the capture
 * showed; otherwise the core dialogue entries.
 */
function chatLineClasses() {
  if (ChatLines) return ChatLines;
  const { NpcDialogue, PlayerDialogue, NpcDefinition, Misc } = core();
  const mood = (name, text) => MOOD[name] + Math.min(4, Math.max(1, Misc.wrapText(text, LINE_WIDTH).length)) - 1;
  const show = (player, group, head, name, entry) => {
    const uid = (child) => (group << 16) | child;
    const sender = player.getPacketSender().sendChatboxInterface(group);
    head(sender, uid(2));
    sender.sendInterfaceAnimation(uid(2), mood(entry.mood, entry.getText())).sendString(name, uid(4));
    entry.constructor.sendChatText(player, entry.getText(), uid(6), uid(5));
  };
  class DeathLine extends NpcDialogue {
    constructor(index, mood, text) {
      super(index, ID.death, text);
      this.mood = mood;
    }

    send(player) {
      show(player, 231, (sender, head) => sender.sendNpcHeadOnInterface(ID.death, head), NpcDefinition.forId(ID.death).getName(), this);
    }
  }
  class PlayerLine extends PlayerDialogue {
    constructor(index, mood, text) {
      super(index, text);
      this.mood = mood;
    }

    send(player) {
      show(player, 217, (sender, head) => sender.sendPlayerHeadOnInterface(head), player.getDisplayName(), this);
    }
  }
  ChatLines = { DeathLine, PlayerLine };
  return ChatLines;
}

/**
 * Plays `steps` in the chatbox, then runs `then` (an options prompt, an interface). A step is
 * `{ npc: text, mood }`, `{ player: text, mood }`, `{ statement: text }` or
 * `{ item: id, text }`.
 */
function talk(player, steps, then = null) {
  const { DialogueChainBuilder, StatementDialogue, ItemStatementDialogue, ActionDialogue, EndDialogue } = core();
  const { DeathLine, PlayerLine } = chatLineClasses();
  const builder = new DialogueChainBuilder();
  let index = 0;
  for (const step of steps) {
    if (step.npc) builder.add(new DeathLine(index++, step.mood ?? "neutral", step.npc));
    else if (step.player) builder.add(new PlayerLine(index++, step.mood ?? "neutral", step.player));
    else if (step.statement) builder.add(new StatementDialogue(index++, step.statement));
    else if (step.item) builder.add(new ItemStatementDialogue(index++, step.item, step.text));
  }
  // An action only ever ends a chain: anywhere else it stalls the client.
  if (then) builder.add(new ActionDialogue(index++, { execute: () => then() }));
  else builder.add(new EndDialogue(index));
  player.getDialogueManager().startDialogues(builder);
}

/** The chatmenu: choose(player, "Select an option", ["Yes.", onYes], ["No.", onNo]). */
function choose(player, title, ...options) {
  pluginApi.sendMultiChatboxPrompt(player, title, ...options.flatMap(([text, action]) => [text, () => action()]));
}

module.exports = {
  DATA, ID, COMPONENT, VARP, SCRIPT, PORTAL, PAYMENT_SOUND, PAYMENT_SOUND_DELAY, OVERLAY, MODAL, OP1, OP10,
  bind, api, core, location, later, sound, formatCoins, state, payFee, adjustCoffer, talk, choose,
};
