"use strict";

const { randomUUID } = require("node:crypto");
const Data = require("./Data.BeginnerTreasureTrails");
const { TIERS, completedAttribute, sharedCompletedCount } = require("../trails/Tiers.TreasureTrails");
const TRAIL_META = "treasure-trails:beginner";
const COMPLETED_ATTRIBUTE = completedAttribute({ name: "beginner" });
const COUNT_VARBIT_NAME = "collection_clues_beginner_completed";
// The cache's collection log category name.
const CATEGORY_NAME = "Beginner Treasure Trails";
let api;
let core;
let catalogue;
const uris = new WeakMap();
const data = () => catalogue ??= Data.load(core);
const held = (player, id) => player.getInventory().getItems().some(item => item && item.getId() === id && item.getAmount() > 0);
const pick = (entries, random = Math.random) => entries[Math.floor(random() * entries.length)];
const location = player => ({ x: player.getLocation().getX(), y: player.getLocation().getY(), z: player.getLocation().getZ() });
const distance = (a, b) => a.z === b.z ? Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) : Infinity;

function length(random = Math.random) {
  const roll = random();
  return roll < 0.1 ? 1 : roll < 0.55 ? 2 : 3;
}

function newStep(state, random = Math.random) {
  const step = pick(data().steps, random);
  return { ...state, revision: state.revision + 1, row: step.row, task: null,
    hotcold: step.kind === "hotcold" ? pick(data().hotcold, random).row : null,
    previous: null, uriReady: false };
}

/** A new trail's length; content may set it within 1 to 3 ("treasure-trails:trail-length", a league relic). */
function lengthFor(player, random = Math.random) {
  const rolled = length(random);
  if (!player) return rolled;
  const request = { player, tier: "beginner", length: rolled, minimum: 1, maximum: 3 };
  api?.emitCustomEvent?.("treasure-trails:trail-length", request);
  return Number.isInteger(request.length) ? Math.max(1, Math.min(3, request.length)) : rolled;
}

function stateOf(item, player = null) {
  const current = item.getMetaValue(TRAIL_META);
  if (current?.version === 1 && data().byRow.has(current.row) && Number.isInteger(current.completed) && current.completed >= 0 &&
      [1, 2, 3].includes(current.length) && current.completed < current.length && typeof current.token === "string") return current;
  const state = newStep({ version: 1, token: randomUUID(), revision: 0, completed: 0, length: lengthFor(player) });
  item.setMetaValue(TRAIL_META, state);
  return state;
}

function trails(player, initialize = false) {
  return player.getInventory().getItems().flatMap((item, slot) => {
    if (!item || item.getId() !== data().scroll || item.getAmount() < 1) return [];
    const state = initialize ? stateOf(item, player) : item.getMetaValue(TRAIL_META);
    return state && data().byRow.has(state.row) ? [{ item, slot, state, step: data().byRow.get(state.row) }] : [];
  });
}

function stillHeld(player, snapshot) {
  return trails(player).find(trail => trail.state.token === snapshot.state.token && trail.state.revision === snapshot.state.revision);
}

function clicked(event, id) {
  const item = event.player.getInventory().getItems()[event.slot];
  return item && item.getId() === id && item.getAmount() > 0 && (!event.item || item === event.item) ? item : null;
}

function read(event) {
  const item = clicked(event, data().scroll);
  if (!item) return false;
  const state = stateOf(item, event.player);
  const step = data().byRow.get(state.row);
  const sender = event.player.getPacketSender();
  if (step.kind === "map") sender.sendInterface(step.interfaceId);
  else {
    const text = step.kind === "charlie" && state.task != null ? data().tasks.find(task => task.row === state.task)?.text : step.text;
    sender.sendInterface(data().textInterface);
    sender.sendString(step.kind === "anagram" ? `This anagram reveals<br>who to speak to next:<br><br>${text}` : text, (data().textInterface << 16) | 2);
  }
  return true;
}

function checkSteps(event) {
  const item = clicked(event, data().scroll);
  if (!item) return false;
  event.player.sendMessage(`You have completed ${stateOf(item, event.player).completed} steps on this beginner Treasure Trail.`);
  return true;
}

function dismissUri(player) {
  const active = uris.get(player);
  if (active) api.removeNpc(active.npc);
  uris.delete(player);
}

function advance(player, snapshot) {
  const trail = stillHeld(player, snapshot);
  if (!trail) return false;
  dismissUri(player);
  const completed = trail.state.completed + 1;
  if (completed >= trail.state.length) {
    // Exact-slot deletion matters when several generic scrolls are carried.
    player.getInventory().deleteAtSlot(trail.slot, 1);
    player.getInventory().adds(data().casket, 1);
    player.sendMessage("You've found a reward casket!");
  } else {
    trail.item.setMetaValue(TRAIL_META, newStep({ ...trail.state, completed }));
    player.getInventory().refreshItems();
    player.sendMessage("You've found another clue!");
  }
  return true;
}

function dialogue(player, npcId, lines, onEnd) {
  const chain = new core.DialogueChainBuilder();
  lines.forEach((text, index) => chain.add(new core.NpcDialogue(index, npcId, text)));
  if (onEnd) chain.add(new core.ActionDialogue(lines.length, { execute: onEnd }));
  chain.add(new core.EndDialogue(lines.length + 1));
  player.getDialogueManager().startDialogues(chain);
}

function talk(event) {
  if (event.handled) return;
  const { player, npcId, npc } = event;
  const definition = event.definition ?? npc.getCurrentDefinition?.(player);
  if (definition?.getActions?.()[event.clickType - 1] !== "Talk-to") return;
  if (npcId === data().uri) {
    const active = uris.get(player);
    if (!active || active.npc !== npc) return;
    const trail = stillHeld(player, active.trail);
    if (!trail || !emoteReady(player, trail.step)) { dismissUri(player); return; }
    event.handled = true;
    dialogue(player, npcId, ["Well done, you've completed the challenge!"], () => {
      const current = stillHeld(player, trail);
      if (uris.get(player)?.npc === npc && current && emoteReady(player, current.step)) advance(player, current);
    });
    return;
  }
  const trail = trails(player, true).find(entry => entry.step.npcIds.includes(npcId));
  if (!trail || !["anagram", "npc", "charlie", "hotcold"].includes(trail.step.kind)) return;
  event.handled = true;
  const nearNpc = () => distance(location(player), location(npc)) <= 3;
  if (trail.step.kind === "hotcold") {
    if (!held(player, data().device)) {
      if (player.getInventory().isFull()) { player.sendMessage("You need an inventory space for the strange device."); return; }
      player.getInventory().adds(data().device, 1);
    }
    dialogue(player, npcId, ["This strange device will help you find your treasure. Feel it as you move around; when it shakes, dig nearby."]);
    return;
  }
  if (trail.step.kind === "charlie") {
    let task = data().tasks.find(task => task.row === trail.state.task);
    if (!task) {
      task = pick(data().tasks);
      trail.item.setMetaValue(TRAIL_META, { ...trail.state, task: task.row, revision: trail.state.revision + 1 });
      dialogue(player, npcId, [task.text.replace("I need to give Charlie", "I really need").replace("I need to give", "I really need")]);
      return;
    }
    // Content may lift Charlie's item ("treasure-trails:requirement-waived", a league relic): he is thanked without it.
    const waiver = { player, kind: "charlie", waived: false };
    api?.emitCustomEvent?.("treasure-trails:requirement-waived", waiver);
    const waived = waiver.waived === true && !held(player, task.itemId);
    if (!waived && !held(player, task.itemId)) {
      dialogue(player, npcId, [task.text.replace("I need to give Charlie", "I still need").replace("I need to give", "I still need")]);
      return;
    }
    dialogue(player, npcId, ["Thank you so much!"], () => {
      if (!stillHeld(player, trail) || !nearNpc() || (!waived && !held(player, task.itemId))) return;
      if (!waived) player.getInventory().deleteNumber(task.itemId, 1);
      advance(player, trail);
    });
    return;
  }
  dialogue(player, npcId, ["Well done, you've found me!"], () => {
    if (nearNpc()) advance(player, trail);
  });
}

function dig(event) {
  if (event.allow === false || !/\bdig\b/i.test(String(event.option)) ||
      ![core.ItemIdentifiers.SPADE, core.ItemIdentifiers.EASTFLOOR_SPADE].includes(event.itemId)) return;
  const { player } = event;
  if (!held(player, event.itemId)) return;
  const trail = trails(player, true).find(trail => {
    if (trail.step.kind === "map") return distance(location(player), trail.step.location) === 0;
    if (trail.step.kind !== "hotcold") return false;
    const target = data().hotcold.find(target => target.row === trail.state.hotcold);
    return target && distance(location(player), target.location) <= 4;
  });
  if (!trail) return;
  event.allow = false;
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId("human_dig" ) ?? 830));
  advance(player, trail);
}

function emoteReady(player, step) {
  if (step.kind !== "emote" || distance(location(player), step.location) > step.radius) return false;
  const worn = player.getEquipment().getItems().filter(Boolean).map(item => item.getId());
  if (step.equipment.every(id => worn.includes(id))) return true;
  // Content may lift what the step asks to wear ("treasure-trails:requirement-waived", a league relic).
  const request = { player, kind: "emote", waived: false };
  if (step.equipment.length > 0) api?.emitCustomEvent?.("treasure-trails:requirement-waived", request);
  return request.waived === true;
}

function emote({ player, slot }) {
  const trail = trails(player, true).find(trail => trail.step.emote === slot && emoteReady(player, trail.step));
  if (!trail) return;
  dismissUri(player);
  const origin = player.getLocation();
  const region = api.getRegionManager();
  const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => new core.Location(origin.getX() + dx, origin.getY() + dy, origin.getZ()))
    .find(tile => !region.blocked(tile, player.getPrivateArea?.()) && region.canMovestart(origin, tile, 1, 1, player.getPrivateArea?.()));
  if (!spot) return;
  const npc = api.spawnNpc({ id: data().uri, x: spot.getX(), y: spot.getY(), z: spot.getZ(), owner: player, ownerOnly: true, wanderRadius: 0 });
  if (npc) uris.set(player, { npc, trail });
}

function temperature(distance) {
  return distance < 4 ? "visibly shaking" : distance < 30 ? "incredibly hot" : distance < 70 ? "very hot" :
    distance < 100 ? "hot" : distance < 150 ? "warm" : distance < 200 ? "cold" : distance < 500 ? "very cold" : "ice cold";
}

// Live OSRS's Feel lines (rsprox 235/1043, 236/3931, 227/1862; the same on the beginner and master devices):
// "The device is <temperature>." on the first feel, then the change against the last feel, and at the
// dig spot "... visibly shaking and burns to the touch." RuneLite's hot/cold solver reads these words
// (HotColdTemperature "The device is ", HotColdTemperatureChange "and warmer than" / "but colder than" /
// "and the same temperature as" ... " last time.").
const SHAKING = "The device is visibly shaking and burns to the touch. This must be the spot.";
function reading(current, previous) {
  const now = temperature(current);
  if (now === "visibly shaking") return SHAKING;
  const change = previous == null ? "" : current < previous ? ", and warmer than last time" :
    current > previous ? ", but colder than last time" : ", and the same temperature as last time";
  return `The device is ${now}${change}.`;
}

function feel(event) {
  if (event.itemId !== data().device || !clicked(event, data().device)) return false;
  const trail = trails(event.player, true).find(trail => trail.step.kind === "hotcold");
  if (!trail) { event.player.sendMessage("The strange device is inactive."); return true; }
  const target = data().hotcold.find(target => target.row === trail.state.hotcold);
  const current = distance(location(event.player), target.location);
  event.player.sendMessage(reading(current, trail.state.previous));
  trail.item.setMetaValue(TRAIL_META, { ...trail.state, previous: current });
  return true;
}

function restore({ player }) {
  const count = Number(player.getAttribute(COMPLETED_ATTRIBUTE)) || 0;
  const varbit = core.CacheDefinitions.getVarbitId(COUNT_VARBIT_NAME);
  if (varbit != null) player.getPacketSender().sendVarbit(varbit, count);
  const explore = core.CacheDefinitions.getVarbitId("emote_explore");
  if (explore != null) player.getPacketSender().sendVarbit(explore, count >= 600 ? 1 : 0);
}

function categoryCount(request) {
  // This saved-count query must also work on free worlds, where members trails do not load.
  if (request.category === "Shared Treasure Trail Rewards") {
    request.count = sharedCompletedCount(request.player);
    return;
  }
  if (request.category === CATEGORY_NAME) request.count = Number(request.player.getAttribute(COMPLETED_ATTRIBUTE)) || 0;
}

function canEmote(request) {
  if (request.sequence !== core.CacheDefinitions.getSeqId("emote_explore") && request.sequence !== core.CacheDefinitions.getSeqId("emote_explore_loop")) return;
  if ((Number(request.player.getAttribute(COMPLETED_ATTRIBUTE)) || 0) >= 600) return;
  request.allow = false;
  request.player.sendMessage("You need to complete 600 beginner Treasure Trails to perform Explore.");
}

function leave({ player }) { dismissUri(player); }

function close({ player }) { player.getPacketSender().sendInterfaceRemoval(); }

module.exports = function attachBeginnerTreasureTrails(pluginApi) {
  api = pluginApi;
  core = api.core;
  catalogue = null;
  api.persistAttribute(COMPLETED_ATTRIBUTE, 0);
  for (const tier of TIERS) api.persistAttribute(completedAttribute(tier), 0);
  api.onItemAction("Clue scroll (beginner)", { Read: read, "Check steps": checkSteps });
  api.onItemAction("Strange device", { Feel: feel });
  api.onBeforeNpcInteraction(talk);
  api.onCanUseItem(dig);
  api.onCustomEvent("player:emote", emote);
  api.onCustomEvent("player:can-emote", canEmote);
  api.onCustomEvent("collection-log:category-count", categoryCount);
  api.onPlayerLogin(restore);
  api.onPlayerLogout(leave);
  api.onPlayerDisconnect(leave);
  api.onInterfaceActionButton((203 << 16) | 1, close);
};

Object.assign(module.exports, { TRAIL_META, COMPLETED_ATTRIBUTE, data, trailLength: length, stateOf, trails, read, checkSteps, advance, talk, dig, emote, feel, temperature, reading, emoteReady, restore, categoryCount, canEmote });
