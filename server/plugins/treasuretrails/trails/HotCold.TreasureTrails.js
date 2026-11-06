"use strict";

// Master hot/cold (Wiki "Strange device", Transcript:Jorral; messages from live captures,
// rsprox.net). "… a man called Jorral may have a clue." sends the player to Jorral, who hands over
// the master strange device; the clue then holds one of the cache's master hot/cold targets. Feeling
// the device tells the temperature, and hurts; digging inside the target's 9x9 square summons the
// row's fight, and digging again once it is beaten gives the next clue. The device is kept.
const Runtime = require("./Runtime.TreasureTrails");
const Dialogue = require("./Dialogue.TreasureTrails");
// The beginner device's bands and Feel lines are the master device's too (Wiki "Treasure Trails/Guide/Hot
// Cold", rsprox 236/3931).
const { reading } = require("../beginner/Runtime.BeginnerTreasureTrails");
const MAKING_HISTORY = "making_history";
const NO_HISTORY = "treasure-trails-master-when-player-has-not-completed-making-history";
const WITHOUT_DEVICE = "treasure-trails-master-when-player-does-not-have-a-strange-device-in-their-inventory";
const WITH_DEVICE = "treasure-trails-master-when-player-has-a-strange-device-in-their-inventory";
const NO_ROOM = "You should make some room for it before I can give you it.";
const HANDED = "Jorral hands you the strange device.";
const HURTS = "The power of the strange device hurts you in the process.";
const COOLS = "The strange device cools as you find your treasure.";
const INACTIVE = "The strange device is inactive.";
const NOT_YET = "This device won't function yet.";
// Wiki: "Each location has a 9x9 dig square", and each feel deals 3-8 damage.
const DIG_SQUARE = 4;
const DAMAGE = [3, 8];
let api;
let core;

const pick = (entries, random = Math.random) => entries[Math.floor(random() * entries.length)];
const location = entity => ({ x: entity.getLocation().getX(), y: entity.getLocation().getY(), z: entity.getLocation().getZ() });
const distance = (a, b) => a.z === b.z ? Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) : Infinity;

function device() {
  return core.CacheDefinitions.getObjId("master_device");
}

function holds(player, id) {
  return player.getInventory().getItems().some(item => item && item.getId() === id && item.getAmount() > 0);
}

function questComplete(player, key) {
  const request = { player, key, complete: null };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete !== false;
}

/** A transcript's spoken lines, taking the first answer of any choice and skipping its messages. */
function said(steps) {
  const spoken = [];
  for (const step of steps ?? []) {
    if (typeof step.npc === "string") spoken.push({ npc: step.npc });
    else if (typeof step.player === "string") spoken.push({ player: step.player });
    else if (step.type === "choice" && step.options?.length) spoken.push(...said(step.options[0].steps));
  }
  return spoken;
}

/** Master trails holding a hot/cold target, or about to (the Jorral step). */
function masterTrails(player) {
  return Runtime.trails(player).filter(trail => Runtime.data(trail.tier).oneItem);
}

/** The clue now points at a random master hot/cold target; it keeps one it already has. */
function aim(player, trail, random = Math.random) {
  const current = Runtime.stillHeld(player, trail);
  if (!current || current.state.hotcold) return;
  const target = pick(Runtime.data(current.tier).hotcold, random);
  current.item.setMetaValue(Runtime.metaKey(current.tier), { ...current.state, hotcold: target.row, previous: null });
  player.getInventory().refreshItems();
}

function talk(event) {
  if (event.handled) return;
  const { player, npcId, npc } = event;
  const definition = event.definition ?? npc.getCurrentDefinition?.(player);
  if (definition?.getActions?.()[event.clickType - 1] !== "Talk-to") return;
  const trail = Runtime.startedTrails(player).find(entry => Runtime.MASTER_PARTS.hotColdStarters.includes(entry.step.key) && entry.step.npcIds.includes(npcId));
  if (!trail) return;
  event.handled = true;
  if (!questComplete(player, MAKING_HISTORY)) {
    Dialogue.play(player, npcId, said(Dialogue.transcript(player, npc, npcId, NO_HISTORY)));
    return;
  }
  if (holds(player, device())) {
    Dialogue.play(player, npcId, said(Dialogue.transcript(player, npc, npcId, WITH_DEVICE)), () => aim(player, trail));
    return;
  }
  if (player.getInventory().getFreeSlots() < 1) {
    Dialogue.play(player, npcId, [{ npc: NO_ROOM }]);
    return;
  }
  Dialogue.play(player, npcId, said(Dialogue.transcript(player, npc, npcId, WITHOUT_DEVICE)), () => {
    if (!Runtime.stillHeld(player, trail) || holds(player, device()) || player.getInventory().getFreeSlots() < 1) return;
    player.getInventory().forceAdd(player, new core.Item(device(), 1));
    player.getInventory().refreshItems();
    aim(player, trail);
    Dialogue.itemBox(player, device(), HANDED);
  });
}

function feel(event, random = Math.random) {
  const { player } = event;
  if (event.itemId !== device()) return false;
  const trails = masterTrails(player);
  if (!trails.length) { player.sendMessage(NOT_YET); return true; }
  const trail = trails.find(entry => entry.state.hotcold != null);
  if (!trail) { Dialogue.mesbox(player, INACTIVE); return true; }
  const target = Runtime.data(trail.tier).byRow.get(trail.state.hotcold);
  const current = distance(location(player), target.location);
  player.sendMessage(reading(current, trail.state.previous));
  trail.item.setMetaValue(Runtime.metaKey(trail.tier), { ...trail.state, previous: current });
  player.getInventory().refreshItems();
  const damage = DAMAGE[0] + Math.floor(random() * (DAMAGE[1] - DAMAGE[0] + 1));
  player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, core.HitMask.RED)]);
  player.sendMessage(HURTS);
  return true;
}

function dig(event) {
  const I = core.ItemIdentifiers;
  if (event.allow === false || !/\bdig\b/i.test(String(event.option)) || ![I.SPADE, I.EASTFLOOR_SPADE].includes(event.itemId)) return;
  const { player } = event;
  const trail = masterTrails(player).find(entry => {
    const target = entry.state.hotcold != null && Runtime.data(entry.tier).byRow.get(entry.state.hotcold);
    return target && distance(location(player), target.location) <= DIG_SQUARE;
  });
  if (!trail) return;
  event.allow = false;
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId("human_dig") ?? 830));
  const target = Runtime.data(trail.tier).byRow.get(trail.state.hotcold);
  // Wiki: the dig summons the target's fight; dig again once it is beaten.
  if (target.encounter && trail.state.defeated !== true) {
    const fight = { ...trail, step: target };
    if (!Runtime.liveEncounter(player, fight)) Runtime.summon(player, fight);
    return;
  }
  player.sendMessage(COOLS);
  Runtime.advance(player, trail);
}

module.exports = function attachHotCold(pluginApi) {
  api = pluginApi;
  core = api.core;
  api.onBeforeNpcInteraction(talk);
  api.onItemAction("Strange device", { Feel: feel });
  api.onCanUseItem(dig);
};

Object.assign(module.exports, { talk, feel, dig, DIG_SQUARE, NOT_YET, INACTIVE, HURTS, COOLS });
