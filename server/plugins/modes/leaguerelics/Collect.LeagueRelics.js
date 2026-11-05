/**
 * The Leagues Tutor's Collect-items (a cache-read league with a `tutor`, Demonic Pacts), as recorded
 * (237/01098, 1107): the player asks "Do I have any League items to collect?" (chatquiz1); on
 * Continue the item box "You receive some items from the Tutor." and the items into the inventory.
 * What is owed: each item the character's relics hand out (the Reloaded pick's too) that it owns
 * none of, carried, worn or banked; as many as the inventory takes. Ours (unrecorded): the lines
 * when nothing is owed and when the inventory is too full for the rest.
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
  return player.getInventory().contains(itemId) || player.getEquipment().contains(itemId)
    || player.getBanks().some((bank, tab) => tab !== Common.core.Bank.BANK_SEARCH_TAB_INDEX && bank?.getAmount?.(itemId) > 0);
}

/** The relic items the character owns none of, each once. */
function owed(player, type) {
  const ids = heldRelics(player, type).flatMap((relic) => Unlock.grantedItems(relic));
  return [...new Set(ids)].filter((id) => !owns(player, id));
}

/** Hands over what fits, then the recorded item box, or ours when nothing is owed. */
function handOver(player, type) {
  const items = owed(player, type);
  const { DialogueChainBuilder, NpcDialogue, StatementDialogue, ItemStatementDialogue, CacheDefinitions } = Common.core;
  const manager = player.getDialogueManager();
  if (items.length === 0) {
    const tutor = player.getInteractingMobile?.();
    const npcId = tutor?.getId?.() ?? CacheDefinitions.getNpcId("league_6_tutor");
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

/** Collect-items: the recorded question, then the items on Continue. */
function collectItems({ player }) {
  const type = Common.leagueOf(player);
  if (type === null || !Common.cacheLeague(type)?.tutor) return false;
  const { DialogueChainBuilder, PlayerDialogue, ActionDialogue, CacheDefinitions } = Common.core;
  const chathead = CacheDefinitions.getSeqId("chatquiz1") ?? undefined;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new PlayerDialogue(0, Common.message("collectAsk", {}, type), chathead))
    .add(new ActionDialogue(1, { execute: () => handOver(player, type) })));
  return true;
}

module.exports = function attach(api) {
  api.onNpcInteraction("Leagues Tutor", { "Collect-items": collectItems });
};

Object.assign(module.exports, { owed });
