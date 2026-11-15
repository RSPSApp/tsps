/**
 * The Sage (data/league-shattered.json `sage`): Shattered Relics' Leagues Tutor at Catherby, which
 * a world running the league spawns. Talk-to plays its transcript; its "Do I have any League items
 * to collect?" and its Collect-items option hand over the items the character's quest packs let it
 * claim (Wiki /Unlocks), each it owns none of. Fragments can be swapped near it (Fragments).
 *
 *   nearSage(player)   whether the character stands within `sage.nearDistance` of the Sage
 */
const Common = require("./Common.LeagueMode");
const Unlocks = require("./Unlocks.LeagueMode");
const { data, isShattered } = require("./Shattered.LeagueMode");

function config() {
  return data.sage;
}

function isSage(npcId) {
  return Number(npcId) === config().npc;
}

/** Carried, worn or banked; a bank placeholder (amount 0) isn't owning it. */
function owns(player, itemId) {
  return Common.core.Bank.owns(player, itemId);
}

/**
 * What the Sage owes: per item its unlocked packs (prerequisites included) let it claim and it owns
 * none of, the ids it can be (one, or the choice an inner list gives).
 */
function owed(player) {
  const choices = new Map();
  for (const name of Unlocks.unlocked(player).quests) {
    for (const entry of config().items[name] ?? []) {
      const ids = [].concat(entry);
      if (!ids.some((id) => owns(player, id))) choices.set(ids.join(), ids);
    }
  }
  return [...choices.values()];
}

function itemName(id) {
  return Common.core.ItemDefinition.forId(id)?.getName?.() ?? String(id);
}

function receive(player, id) {
  player.getInventory().adds(id, 1);
  player.sendMessage(data.messages.sageReceive.replace("{item}", itemName(id)));
}

function say(player, text) {
  const { DialogueChainBuilder, NpcDialogue } = Common.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, config().npc, text)));
}

/** A choice of one (the crystal shield or bow): a menu of their names. */
function offerChoice(player, ids) {
  const { DialogueChainBuilder, OptionDialogue } = Common.core;
  const manager = player.getDialogueManager();
  let chosen = false;
  const menu = new OptionDialogue(0, { executeOption: (option) => {
    if (chosen || manager.getCurrent() !== menu) return;
    const id = ids[option - 1];
    if (id === undefined) return;
    chosen = true;
    player.getPacketSender().sendInterfaceRemoval();
    // Owned since the menu opened (a second conversation): nothing more is owed.
    if (!owed(player).some((entry) => entry.join() === ids.join())) return;
    if (player.getInventory().getFreeSlots() > 0) receive(player, id);
    else player.sendMessage(data.messages.sageInventoryFull);
  } }, ...ids.map(itemName));
  manager.startDialogues(new DialogueChainBuilder().add(menu));
}

/** Hands over what is owed, as far as the inventory goes; a choice comes last, as a menu. Answers whether anything was owed. */
function collect(player) {
  const items = owed(player);
  if (items.length === 0) return false;
  const inventory = player.getInventory();
  for (const ids of items.filter((entry) => entry.length === 1)) {
    if (inventory.getFreeSlots() < 1) {
      player.sendMessage(data.messages.sageInventoryFull);
      return true;
    }
    receive(player, ids[0]);
  }
  const choice = items.find((entry) => entry.length > 1);
  if (!choice) return true;
  if (inventory.getFreeSlots() < 1) player.sendMessage(data.messages.sageInventoryFull);
  else offerChoice(player, choice);
  return true;
}

/** Collect-items: the items, or the Sage's line when nothing is owed. */
function collectItems({ player, npcId }) {
  if (!isSage(npcId) || !isShattered(player)) return false;
  if (!collect(player)) say(player, data.messages.sageNothing);
  return true;
}

/** The transcript's two conditions on "Do I have any League items to collect?". */
function condition({ player, npcId, text }) {
  if (!isSage(npcId) || !isShattered(player)) return null;
  const { nothing, owed: some } = config().conditions;
  if (text === nothing) return owed(player).length === 0;
  if (text === some) return owed(player).length > 0;
  return null;
}

/** "You receive an item from the Sage.": the items, and the conversation ends (or becomes the choice menu). */
function collectAction(event) {
  if (!isSage(event.npcId) || event.text !== config().collectAction || !isShattered(event.player)) return;
  event.handled = true;
  event.end = true;
  collect(event.player);
}

/** The Sage the character can see (a local NPC), within `nearDistance` on its plane. */
function nearSage(player) {
  const location = player.getLocation();
  const list = player.getLocalNpcs?.();
  const npcs = Array.isArray(list) ? list : list ? [...list.values()] : [];
  return npcs.some((npc) => isSage(npc?.getId?.()) && npc.isRegistered?.() !== false
    && npc.getLocation().getZ() === location.getZ() && location.getDistance(npc.getLocation()) <= config().nearDistance);
}

/** A world running Shattered Relics has the Sage at Catherby. */
function spawn() {
  if (Common.worldLeague() !== data.league) return;
  const [x, y, z] = config().spawn;
  Common.api.spawnNpc({ id: config().npc, x, y, z, wanderRadius: 0 });
}

module.exports = function attach(api) {
  api.onServerStartup(spawn);
  api.onNpcInteraction("The Sage", { "Collect-items": collectItems });
  api.onNpcDialogueCondition(condition);
  api.onCustomEvent("npc-dialogue:action", collectAction);
};

module.exports.nearSage = nearSage;
module.exports._test = { owed, collect, spawn };
