"use strict";

/**
 * Intelligence Gathering: the information board, Ginea's hand-in, and the gang meeting itself.
 *
 * https://oldschool.runescape.wiki/w/Intelligence_Gathering
 * https://oldschool.runescape.wiki/w/Information
 * https://oldschool.runescape.wiki/w/Transcript:Captain_Ginea
 *
 * The Wiki gives a 30-minute board cycle, a five-minute meeting (remaining gang members leave
 * five minutes after it starts), one gang boss and 4-10 gangsters, and a pin for every meeting
 * location; those pins and the board lines are data/gang-meetings.json. A boss always drops
 * Intelligence in the canonical npc-drops.json, so the drop is left to the ordinary drop table.
 * The board's position in the 30-minute cycle is not documented; the meeting starts on the
 * half-hour boundary and lasts five minutes. Gang members do not respawn after the meeting.
 */

const MEETINGS = require("./data/gang-meetings.json");

const GINEA = 6895;
const INFORMATION = 27230;
const GANG_MEETING_INFO = 13394;
const INTELLIGENCE = 13395;
const TRAINING_MANUAL = 13396;

const GANGSTERS = [6896, 6897, 6898, 6899];
const BOSS_FEMALE = [6900, 6901];
const BOSS_MALE = [6902, 6903];
const SLOT_MS = 30 * 60_000;
const MEETING_MS = 5 * 60_000;
const GANGSTER_MIN = 4;
const GANGSTER_MAX = 10;
const CHECK_TICKS = 20;
const SPAWN_OFFSETS = [
  [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2],
];

/** Transcript message step: "Captain Ginea exchanges your [x] intelligence documents...". */
const DELIVER_STEP = "Vefpv_";
const DELIVERING_VARIANT = "delivering-intelligence";

let api;
let core;
let current = null;
let bossType = null;

const isGinea = (npcId) => npcId === GINEA;

function pick(list, random) {
  return list[Math.floor(random() * list.length)];
}

/** The meeting in progress, or the next one, for a wall-clock instant. */
function status(now = Date.now()) {
  const slot = Math.floor(now / SLOT_MS);
  const startAt = slot * SLOT_MS;
  if (now < startAt + MEETING_MS) {
    return { active: true, slot, location: MEETINGS[slot % MEETINGS.length], startAt, endsAt: startAt + MEETING_MS };
  }
  const nextSlot = slot + 1;
  return {
    active: false,
    slot: nextSlot,
    location: MEETINGS[nextSlot % MEETINGS.length],
    startAt: nextSlot * SLOT_MS,
    minutes: Math.max(1, Math.ceil((nextSlot * SLOT_MS - now) / 60_000)),
  };
}

function statusLine(info) {
  if (info.active) return "We believe the meeting is in progress now.";
  if (info.minutes <= 1) return "The meeting is expected to start imminently.";
  return `The meeting is expected to start in ${info.minutes} minutes.`;
}

function removeNote(player) {
  const inventory = player.getInventory();
  const held = inventory.getAmount(GANG_MEETING_INFO);
  if (held > 0) inventory.deleteNumber(GANG_MEETING_INFO, held);
}

function checkBoard(event) {
  const { player } = event;
  if (event.objectId !== INFORMATION) return false;
  const info = status();
  removeNote(player);
  player.sendMessage(info.location.message);
  player.sendMessage(statusLine(info));
  const inventory = player.getInventory();
  if (inventory.isFull()) {
    inventory.full();
  } else {
    inventory.addItem(new core.Item(GANG_MEETING_INFO, 1));
    player.sendMessage("You take a note.");
  }
  event.handled = true;
  return true;
}

function spawn(info, random = Math.random) {
  if (!info?.location) return null;
  const members = [];
  const spawnOne = (id, offset) => {
    const [dx, dy] = SPAWN_OFFSETS[offset % SPAWN_OFFSETS.length];
    const npc = api.spawnNpc({
      id,
      x: info.location.x + dx,
      y: info.location.y + dy,
      z: info.location.z,
      wanderRadius: 2,
    });
    if (!npc) return;
    npc.__skipDefaultRespawn = true;
    members.push(npc);
  };
  const bossId = pick(bossType ?? BOSS_FEMALE, random);
  spawnOne(bossId, 0);
  const gangsters = GANGSTER_MIN + Math.floor(random() * (GANGSTER_MAX - GANGSTER_MIN + 1));
  for (let i = 0; i < gangsters; i++) spawnOne(pick(GANGSTERS, random), i + 1);
  current = { slot: info.slot, location: info.location, members };
  return current;
}

function despawn() {
  if (!current) return;
  for (const npc of current.members) api.removeNpc?.(npc);
  current = null;
}

/** Keeps the world's single meeting in step with the wall clock. */
function tick(now = Date.now(), random = Math.random) {
  const info = status(now);
  if (info.active) {
    if (!current || current.slot !== info.slot) {
      despawn();
      spawn(info, random);
    }
  } else if (current) {
    despawn();
  }
  return current;
}

/** Attacking any gang member turns the whole meeting on the attacker. */
function playerAttack({ player, target }) {
  if (!current || !target || !current.members.includes(target)) return;
  for (const member of current.members) {
    if (member === target || member.isDying?.() || member.getHitpoints?.() <= 0) continue;
    member.getCombat?.()?.setTarget?.(player);
  }
}

function held(player) {
  return player.getInventory().getAmount(INTELLIGENCE);
}

function deliveryText(count) {
  return `Captain Ginea exchanges your ${count} intelligence ${count === 1 ? "document" : "documents"}`
    + ` for ${count === 1 ? "a training manual" : "training manuals"}.`;
}

function onDialogueVariant(context) {
  if (!isGinea(context.npcId)) return null;
  return held(context.player) > 0 ? DELIVERING_VARIANT : null;
}

function onItemOnNpc(event) {
  if (event.handled || !isGinea(event.npcId) || event.itemId !== INTELLIGENCE) return;
  event.handled = true;
  api.emitCustomEvent("npc-dialogue:start", {
    player: event.player, npc: event.target, npcId: event.npcId, variant: DELIVERING_VARIANT, handled: false,
  });
}

function onDialogueAction(request) {
  if (!isGinea(request.npcId) || request.stepId !== DELIVER_STEP) return;
  const count = held(request.player);
  if (count <= 0) return;
  const inventory = request.player.getInventory();
  inventory.deleteNumber(INTELLIGENCE, count);
  for (let i = 0; i < count; i++) inventory.addItem(new core.Item(TRAINING_MANUAL, 1));
  request.player.sendMessage(deliveryText(count));
  request.handled = true;
  api.emitCustomEvent("intelligence-gathering:delivered", {
    player: request.player, npcId: request.npcId, count,
  });
}

function answerCondition({ npcId, text }) {
  if (npcId !== GINEA || typeof text !== "string") return null;
  const value = text.toLowerCase();
  const info = status();
  if (value.includes("no gang meetings active")) return false;
  if (value.includes("are gang meetings active")) return true;
  if (value.includes("meeting is in progress")) return info.active;
  if (value.includes("about to start")) return !info.active && info.minutes <= 1;
  if (value.includes("will start in about")) return !info.active && info.minutes > 1;
  return null;
}

function onDialogueLine(event) {
  if (event.npcId !== GINEA || typeof event.text !== "string") return;
  const info = status();
  if (event.text.includes("[in location]")) {
    event.text = info.location.message;
    return;
  }
  if (event.text.includes("[number]")) {
    event.text = `We believe the meeting will start in about ${info.minutes ?? 0} minutes.`;
  }
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  bossType = Math.random() < 0.5 ? BOSS_FEMALE : BOSS_MALE;
  pluginApi.onObjectInteraction("Information", { Check: checkBoard });
  pluginApi.onPlayerDealtDamage(playerAttack);
  pluginApi.onNpcDialogueVariant(onDialogueVariant);
  pluginApi.onNpcDialogueCondition(answerCondition);
  pluginApi.onCustomEvent("npc-dialogue:line", onDialogueLine);
  pluginApi.onItemOnNpc(onItemOnNpc);
  pluginApi.onCustomEvent("npc-dialogue:action", onDialogueAction);
  pluginApi.onServerShutdown(despawn);
  pluginApi.getTaskManager().submit(new (class GangMeetingTask extends core.Task {
    constructor() { super(CHECK_TICKS); }
    execute() { tick(); }
  })());
}

module.exports = {
  name: "IntelligenceGathering",
  members: true,
  register(pluginApi) {
    attach(pluginApi);
  },
  _test: {
    GINEA, INFORMATION, GANG_MEETING_INFO, INTELLIGENCE, TRAINING_MANUAL, GANGSTERS,
    BOSS_FEMALE, BOSS_MALE, SLOT_MS, MEETING_MS, DELIVER_STEP, DELIVERING_VARIANT, MEETINGS,
    isGinea, status, statusLine, checkBoard, spawn, despawn, tick, playerAttack,
    held, deliveryText, onDialogueVariant, onItemOnNpc, onDialogueAction, answerCondition, onDialogueLine,
    get current() { return current; },
    set bossType(value) { bossType = value; },
  },
};
