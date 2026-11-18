/**
 * The Leagues Tutor's Collect-items (a cache-read league with a `tutor`, Demonic Pacts), as recorded
 * (237/01098, 1107): the player asks "Do I have any League items to collect?" (chatquiz1); on
 * Continue the item box "You receive some items from the Tutor." and the items into the inventory.
 * The Tutor offers missing starter supplies and items from chosen relics (including Reloaded).
 * Carried, equipped and banked items count as owned. The Talk-to transcript uses the same handover.
 */
const Common = require("./Common.LeagueRelics");
const Unlock = require("./Unlock.LeagueRelics");

/** The relics the character holds: one a chosen tier, and Reloaded's extra pick. */
function heldRelics(player, type) {
  const held = Object.entries(Common.chosen(player)).map(([tier, slot]) => Common.relic(type, Number(tier), slot));
  const extra = Common.reloadedPick(player, type);
  if (extra) held.push(extra);
  return held.filter(Boolean);
}

/** Carried, worn or banked; a bank placeholder (amount 0) isn't owning it. */
function owns(player, itemId) {
  return Common.core.Bank.owns(player, itemId);
}

/** Starter supplies and relic items the character owns none of, each once. */
function owed(player, type) {
  const supplies = Common.cacheLeague(type)?.tutor?.starterSupplies ?? [];
  const ids = supplies.map((name) => Common.core.CacheDefinitions.getObjId(name)).filter(Number.isInteger);
  ids.push(...heldRelics(player, type).flatMap((relic) => Unlock.grantedItems(relic)));
  return [...new Set(ids)].filter((id) => !owns(player, id));
}

/** Hands over what fits, then the recorded item box, or ours when nothing is owed. */
function handOver(player, type, npcId) {
  const items = owed(player, type);
  const { DialogueChainBuilder, NpcDialogue, StatementDialogue, ItemStatementDialogue } = Common.core;
  const manager = player.getDialogueManager();
  if (items.length === 0) {
    manager.startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, npcId, Common.message("collectNothing", {}, type))));
    return;
  }
  const inventory = player.getInventory();
  const given = [];
  for (const id of items) {
    if (inventory.getFreeSlots() < 1) break;
    inventory.adds(id, 1);
    given.push(id);
  }
  if (given.length === 0) {
    manager.startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, Common.message("collectFull", {}, type))));
    return;
  }
  manager.startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, given[0], Common.message("collectReceived", {}, type))));
  if (given.length < items.length) player.sendMessage(Common.message("collectFull", {}, type));
}

function tutorLeague(player, npcId) {
  const type = Common.leagueOf(player);
  const tutor = Common.cacheLeague(type)?.tutor;
  return tutor && npcId === Common.core.CacheDefinitions.getNpcId(tutor.npc) ? type : null;
}

/** Collect-items: the recorded question, then the items on Continue. */
function collectItems({ player, npcId }) {
  const type = tutorLeague(player, npcId);
  if (type === null) return false;
  const { DialogueChainBuilder, PlayerDialogue, ActionDialogue, CacheDefinitions } = Common.core;
  const chathead = CacheDefinitions.getSeqId("chatquiz1") ?? undefined;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new PlayerDialogue(0, Common.message("collectAsk", {}, type), chathead))
    .add(new ActionDialogue(1, { execute: () => handOver(player, type, npcId) })));
  return true;
}

function collectFromDialogue(event) {
  if (event.text !== "Player receives missing items") return;
  const type = tutorLeague(event.player, event.npcId);
  if (type === null) return;
  event.handled = true;
  handOver(event.player, type, event.npcId);
}

module.exports = function attach(api) {
  api.onNpcInteraction("Leagues Tutor", { "Collect-items": collectItems });
  api.onCustomEvent("npc-dialogue:action", collectFromDialogue);
};

Object.assign(module.exports, { owed });
