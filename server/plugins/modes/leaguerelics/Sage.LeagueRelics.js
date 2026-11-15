/**
 * Raging Echoes' tutor, the Sage (data/league-relics.json, league 5 `sage`): the Wiki's "The Sage (Raging
 * Echoes League)" stood in the Lumbridge Castle courtyard on League worlds and gave back the items the
 * character's relics hand out. A world running Raging Echoes spawns it; the cache's NPC (14144) has only
 * Talk-to (the Sage was removed in January 2025), so Collect-items is the first choice of Talk-to here,
 * the other being the Sage's own transcript. What is owed is Collect's `owed`: each item the character's
 * relics hand out that it owns none of, carried, worn or banked, as many as the inventory takes.
 */
const Common = require("./Common.LeagueRelics");
const Collect = require("./Collect.LeagueRelics");

const LEAGUE_TYPE_CONFIG = "league:type";

function config() {
  return Common.league(5)?.sage ?? null;
}

function isSage(npcId) {
  return config() !== null && Number(npcId) === config().npc;
}

/** The Raging Echoes character talking to the Sage (league 5 only). */
function eligible(player, npcId) {
  return isSage(npcId) && Common.leagueOf(player) === 5;
}

/** A world running Raging Echoes (plugin config `league:type` 5) has the Sage in Lumbridge. */
function spawn() {
  if (!config() || Number(Common.api.getPluginConfig(LEAGUE_TYPE_CONFIG, 0)) !== 5) return;
  const [x, y, z] = config().spawn;
  Common.api.spawnNpc({ id: config().npc, x, y, z, wanderRadius: 0 });
}

function say(player, text) {
  const { DialogueChainBuilder, NpcDialogue } = Common.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, config().npc, text)));
}

/** Hands over what is owed and fits, once each (a second ask finds the items owned). */
function handOver(player) {
  const { DialogueChainBuilder, StatementDialogue, ItemStatementDialogue } = Common.core;
  const messages = config().messages;
  const items = Collect.owed(player, 5);
  if (items.length === 0) return say(player, messages.nothing);
  const inventory = player.getInventory();
  const given = [];
  for (const id of items) {
    if (inventory.getFreeSlots() < 1) break;
    inventory.adds(id, 1);
    given.push(id);
  }
  const manager = player.getDialogueManager();
  if (given.length === 0) {
    manager.startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, messages.full)));
    return;
  }
  manager.startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, given[0], messages.received)));
  if (given.length < items.length) player.sendMessage(messages.full);
}

/** Talk-to: the collect question, or the Sage's own transcript. */
function talk({ player, npc, npcId }) {
  if (!eligible(player, npcId)) return false;
  const { DialogueChainBuilder, OptionDialogue } = Common.core;
  const manager = player.getDialogueManager();
  let chosen = false;
  const menu = new OptionDialogue(0, { executeOption: (option) => {
    if (chosen || manager.getCurrent() !== menu) return;
    chosen = true;
    if (option === 1) return handOver(player);
    player.getPacketSender().sendInterfaceRemoval();
    Common.api.emitCustomEvent("npc-dialogue:start", { player, npc, npcId, variant: "standard-dialogue", handled: false });
  } }, config().messages.ask, "Talk.");
  manager.startDialogues(new DialogueChainBuilder().add(menu));
  return true;
}

module.exports = function attach(api) {
  api.onServerStartup(spawn);
  api.onNpcInteraction("The Sage", { "Talk-to": talk });
};

Object.assign(module.exports, { isSage, spawn, handOver });
