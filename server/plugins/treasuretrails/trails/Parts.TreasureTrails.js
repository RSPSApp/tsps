"use strict";

// Master's three-part steps (Wiki: "three cryptic clues in one step … When all three are obtained,
// they can be combined into either a new clue step, or the reward casket"; messages from live
// captures, rsprox.net). The clue reads three cryptics; each one solved hands over its torn part
// (part 1, 2 or 3 by its place on the clue); combining all three with the clue gives the next step.
// Some parts ask more of the player (data/master-parts.json): Robin, Ghommal and Wizard Cromperty
// want strong gear, Abbot Langley a negative prayer bonus, the Monk of Entrana a weapon or armour
// worn as one tries to sail, the Mage of Zamorak and Juna three god items, Sir Vyvin white plate,
// and Viggora a ring of visibility and ghostspeak, with Curse of the Empty Lord up to him and at the
// spot of the player's own ghost sequence (asked of the miniquest through its requirementEvent).
const Runtime = require("./Runtime.TreasureTrails");
const Dialogue = require("./Dialogue.TreasureTrails");
const { byName } = require("./Tiers.TreasureTrails");
const PASS = ["treasure-trails-master", "treasure-trails-master-with-inventory-space-available"];
const NO_SPACE = "Hey, I have something for you but you don't have any space for it!";
const HANDED = "You are handed a torn part of a clue scroll.";
const FOUND = "You find a torn part of a clue scroll.";
const ALREADY_FOUND = "You distinctly remember already finding a torn clue scroll part here and there isn't another one to take.";
const MISSING_PARTS = "I cannot combine the pieces without having all 3.";
const NO_CLUE = "You cannot see how to combine the 3 pieces without also carrying your clue scroll.";
const INSPECT = "There must be more parts to this. If I can combine them together...";
const NEW_CLUE = "You've obtained a new clue!";
const CASKET = "You've obtained a casket!";
// Juna is a loc; she speaks through her dummy NPC's head.
const JUNA_HEAD = "tog_juna_dummy";
let api;
let core;

const location = entity => ({ x: entity.getLocation().getX(), y: entity.getLocation().getY(), z: entity.getLocation().getZ() });
const distance = (a, b) => a.z === b.z ? Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) : Infinity;

function partIds() {
  return Runtime.TORN_PARTS.map(name => core.CacheDefinitions.getObjId(name));
}

/** Whether the player still has a trail's torn part, carried or banked (its token links it). */
function owns(player, trail, index) {
  const ours = item => item?.getId() === partIds()[index] && item.getMetaValue(Runtime.metaKey(trail.tier))?.token === trail.state.token;
  return player.getInventory().getItems().some(ours) || player.getBanks().some(bank => bank?.getItems().some(ours));
}

/** Whether a part can be solved: not found yet, or found and since lost (Wiki: a destroyed part is
 * "re-obtained" by solving it again). */
function open(player, trail, index) {
  return !trail.state.found?.[index] || !owns(player, trail, index);
}

/**
 * The part of a held three-part step that `matches`, open ones first; `open` says whether it can be
 * solved, or was found and is still owned.
 */
function partAt(player, matches) {
  let owned = null;
  for (const trail of Runtime.startedTrails(player)) {
    if (!Array.isArray(trail.state.parts)) continue;
    for (const [index, row] of trail.state.parts.entries()) {
      const step = Runtime.data(trail.tier).byRow.get(row);
      if (!step || !matches(step)) continue;
      if (open(player, trail, index)) return { trail, index, step, open: true };
      owned ??= { trail, index, step, open: false };
    }
  }
  return owned;
}

function openPart(player, matches) {
  const found = partAt(player, matches);
  return found?.open ? found : null;
}

/** The torn parts of a trail the player carries, by part number (its token and revision link them). */
function heldParts(player, trail) {
  return partIds().map(id => player.getInventory().getItems().findIndex(item => item && item.getId() === id &&
    item.getMetaValue(Runtime.metaKey(trail.tier))?.token === trail.state.token));
}

function wornIds(player) {
  return player.getEquipment().getItems().filter(item => item && item.getId() > 0).map(item => item.getId());
}

/** Whether the player meets a part's condition (data/master-parts.json, or its cache outfit). */
function meets(player, step, npc = null) {
  const rule = Runtime.MASTER_PARTS.conditions[step.key];
  if (!rule) return true;
  if (rule.requirementEvent) {
    const request = { player, npc, ready: false, here: false };
    api.emitCustomEvent(rule.requirementEvent, request);
    if (request.ready !== true || request.here !== true) return false;
  }
  if (rule.attack || rule.other) {
    core.BonusManager.update(player);
    const bonuses = player.getBonusManager();
    const value = rule.attack ? bonuses.getAttackBonus()[core.BonusManager[rule.attack]] : bonuses.getOtherBonus()[core.BonusManager[rule.other]];
    if (rule.min != null && value < rule.min) return false;
    if (rule.max != null && value > rule.max) return false;
  }
  if (rule.notWorn && wornIds(player).some(id => rule.notWorn.map(name => core.ItemIdentifiers[name]).includes(id))) return false;
  if (rule.wornAny) {
    const worn = player.getEquipment().getItems();
    if (!rule.wornAny.some(slot => worn[core.Equipment[slot]]?.getId() > 0)) return false;
  }
  const outfit = step.equipment ?? [];
  if (rule.outfitCount && outfit.filter(requirement => Runtime.wearing(player, requirement)).length < rule.outfitCount) return false;
  if (rule.outfit && !outfit.every(requirement => Runtime.wearing(player, requirement))) return false;
  return true;
}

/** A dig part's own requirement rows: items carried or worn (the Shadow Dungeon's ring of visibility). */
function carries(player, step) {
  const C = core.CacheDefinitions;
  const needed = step.requirements.map(row => C.getDbRow(row)).filter(row => C.getGamevals().allTables().get(row.tableId)?.name === "cluehelper_requirement_obj")
    .map(row => row.column(C.getDbColumn(row.tableId, "item")));
  const have = [...wornIds(player), ...player.getInventory().getItems().filter(item => item && item.getAmount() > 0).map(item => item.getId())];
  return needed.every(items => items.some(id => have.includes(id)));
}

/** Gives the part and marks it found; the clue keeps its revision, which links the parts to it. */
function give(player, found) {
  const current = Runtime.stillHeld(player, found.trail);
  if (!current || !open(player, current, found.index) || player.getInventory().getFreeSlots() < 1) return false;
  const state = { ...current.state, found: current.state.found.map((done, index) => done || index === found.index) };
  current.item.setMetaValue(Runtime.metaKey(current.tier), state);
  player.getInventory().forceAdd(player, new core.Item(partIds()[found.index], 1)
    .setMetaValue(Runtime.metaKey(current.tier), { version: 1, token: state.token, revision: state.revision }));
  player.getInventory().refreshItems();
  return true;
}

/** The NPC's own hand-over lines: those before the torn-part message, and after it. */
function handOverLines(steps) {
  const conditions = (steps ?? []).filter(step => step.type === "condition");
  const chosen = conditions.length ? conditions.find(step => !/full|no free|no room|no inventory|no space/i.test(step.text ?? ""))?.steps ?? steps : steps;
  const before = [], after = [];
  let handed = false;
  for (const step of chosen ?? []) {
    if (step.type === "message" && /torn/i.test(step.text ?? "")) handed = true;
    else if (typeof step.npc === "string") (handed ? after : before).push({ npc: step.npc });
  }
  return before.length || after.length ? { before, after } : { before: [{ npc: "Here you go." }], after: [] };
}

function speaker(npcId) {
  return npcId ?? core.CacheDefinitions.getNpcId(JUNA_HEAD);
}

function handOver(player, npc, npcId, found) {
  const rule = Runtime.MASTER_PARTS.conditions[found.step.key] ?? {};
  if (player.getInventory().getFreeSlots() < 1) {
    Dialogue.play(player, speaker(npcId), [{ npc: NO_SPACE }]);
    return;
  }
  const steps = npc ? (rule.pass ? Dialogue.transcript(player, npc, npcId, rule.pass) : PASS.map(variant => Dialogue.transcript(player, npc, npcId, variant)).find(Boolean)) : null;
  const { before, after } = handOverLines(steps);
  Dialogue.playHandOver(player, speaker(npcId), before, () => give(player, found), partIds()[found.index], HANDED, after);
}

function talk(event) {
  if (event.handled) return;
  const { player, npcId, npc } = event;
  const definition = event.definition ?? npc.getCurrentDefinition?.(player);
  const option = definition?.getActions?.()[event.clickType - 1];
  // The mysterious ghosts (Viggora) spell it "Talk-To" in the cache.
  if (!["talk-to", "take-boat"].includes(String(option ?? "").toLowerCase())) return;
  const found = openPart(player, step => step.target === "npc" && step.npcIds.includes(npcId));
  if (!found) return;
  if (!meets(player, found.step, npc)) {
    // Robin says why; the others carry on as they normally would.
    const rule = Runtime.MASTER_PARTS.conditions[found.step.key];
    if (!rule?.fail) return;
    event.handled = true;
    Dialogue.play(player, npcId, Dialogue.lines(Dialogue.transcript(player, npc, npcId, rule.fail)));
    return;
  }
  event.handled = true;
  handOver(player, npc, npcId, found);
}

/** Juna is a loc; her part is a talk to it. */
function search(event) {
  if (event.handled) return;
  const { player, objectId } = event;
  const found = openPart(player, step => step.target === "loc" && [...step.locIds, ...step.locIds.flatMap(id => core.CacheDefinitions.getObject(id)?.transforms ?? [])]
    .includes(objectId) && distance(event.location, step.location) <= 1);
  if (!found || !meets(player, found.step)) return;
  event.handled = true;
  handOver(player, null, null, found);
}

function dig(event) {
  const I = core.ItemIdentifiers;
  if (event.allow === false || !/\bdig\b/i.test(String(event.option)) || ![I.SPADE, I.EASTFLOOR_SPADE].includes(event.itemId)) return;
  const { player } = event;
  const found = partAt(player, step => step.target === "coord" && distance(location(player), step.location) === 0);
  if (!found) return;
  event.allow = false;
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId("human_dig") ?? 830));
  // Live captures: digging again while the part is still had.
  if (!found.open) { player.sendMessage(ALREADY_FOUND); return; }
  if (!carries(player, found.step)) return;
  if (player.getInventory().getFreeSlots() < 1) { player.getInventory().full(); return; }
  if (give(player, found)) Dialogue.itemBox(player, partIds()[found.index], FOUND);
}

/** The clue a torn part belongs to, if it is carried. */
function partTrail(event) {
  const token = event.player.getInventory().getItems()[event.slot]?.getMetaValue(Runtime.metaKey(byName.get("master")))?.token;
  return Runtime.trails(event.player).find(trail => trail.state.token === token) ?? null;
}

function combine(event) {
  const { player } = event;
  const trail = partTrail(event);
  if (!trail) { player.sendMessage(NO_CLUE); return true; }
  const slots = heldParts(player, trail);
  if (slots.some(slot => slot < 0)) { Dialogue.mesbox(player, MISSING_PARTS); return true; }
  for (const slot of slots) player.getInventory().deleteAtSlot(slot, 1);
  Runtime.advance(player, trail, Math.random, { clue: NEW_CLUE, casket: CASKET });
  return true;
}

function inspect(event) {
  Dialogue.itemBox(event.player, event.player.getInventory().getItems()[event.slot]?.getId(), INSPECT);
  return true;
}

module.exports = function attachParts(pluginApi) {
  api = pluginApi;
  core = api.core;
  api.onBeforeNpcInteraction(talk);
  api.onBeforeObjectInteraction(search);
  api.onCanUseItem(dig);
  for (const part of [1, 2, 3]) api.onItemAction(`Torn clue scroll (part ${part})`, { Combine: combine, Inspect: inspect });
};

Object.assign(module.exports, { talk, search, dig, combine, inspect, meets, handOverLines, partIds, NO_SPACE, HANDED, FOUND, ALREADY_FOUND, MISSING_PARTS, NO_CLUE, INSPECT });
