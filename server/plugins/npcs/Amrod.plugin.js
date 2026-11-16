"use strict";

// Amrod's exchange: docs/amrod.md (rsprox captures and the OSRS Wiki).
const NPC_NAME = "Amrod";
const ACTION = "Chatbox trade interface opens for crystal seed exchanging.";
const MENU_TITLE = "How many do you wish to trade?";
const SEEDS = [
  ["CRYSTAL_TOOL_SEED", "Crystal tool seed", 100],
  ["CRYSTAL_WEAPON_SEED", "Crystal weapon seed", 10],
  ["CRYSTAL_ARMOUR_SEED", "Crystal armour seed", 250],
  ["ENHANCED_CRYSTAL_TELEPORT_SEED", "Enhanced crystal teleport seed", 150],
  ["ENHANCED_CRYSTAL_WEAPON_SEED", "Enhanced crystal weapon seed", 1500],
];
let api;
let core;

function exchange(player, seed, count) {
  const inventory = player.getInventory();
  const id = core.ItemIdentifiers[seed[0]];
  const shards = core.ItemIdentifiers.CRYSTAL_SHARD;
  if (!Number.isSafeInteger(count) || count < 1 || inventory.getAmount(id) < count) return;
  const total = count * seed[2];
  // Ours: abort if inventory changed while the confirmation was open or the shard stack is full.
  const plan = new core.Inventory(player).setItems(inventory.getCopiedItems());
  plan.deleted(id, count, false);
  if (plan.getAddableAmount(new core.Item(shards, total)) < total) return;
  inventory.deleteNumber(id, count);
  inventory.adds(shards, total);
  const noun = seed[1] + (count === 1 ? "" : "s");
  const picture = core.CacheDefinitions.getObjId("prif_crystal_shard_25");
  const text = `You trade in your ${noun} for<br>${total} crystal shards.`;
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.DoubleItemStatementDialogue(0, id, picture, text)));
}

function select(player, seed, requested) {
  const count = Math.min(Math.max(1, Math.trunc(requested) || 1), player.getInventory().getAmount(core.ItemIdentifiers[seed[0]]));
  // Ours: selecting a seed that is not held closes the menu without a transaction.
  if (count <= 0) return;
  api.sendMultiChatboxPrompt(player, `Trade ${count} x ${seed[1]} for ${count * seed[2]} crystal shards?`,
    "Yes.", () => exchange(player, seed, count), "No.", () => {});
}

function openMenu(player) {
  const items = SEEDS.map((seed) => core.ItemIdentifiers[seed[0]]);
  const inventory = player.getInventory();
  const maxAmount = Math.max(1, items.reduce((sum, id) => sum + inventory.getAmount(id), 0));
  player.getPacketSender().sendCreationMenu(new core.CreationMenu(MENU_TITLE, items, {
    execute(itemId, amount) {
      const seed = SEEDS.find((entry) => core.ItemIdentifiers[entry[0]] === itemId);
      if (seed) select(player, seed, amount);
    },
  }, { mode: 4, labels: SEEDS.map((seed) => seed[1]), maxAmount,
    lastAmount: maxAmount }));
}

function trade({ player }) {
  openMenu(player);
  return true;
}

function dialogueAction(event) {
  if (event.handled || event.text !== ACTION || event.npc?.getDefinition?.()?.getName?.() !== NPC_NAME) return;
  event.handled = true;
  event.end = true;
  const { player } = event;
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(1, player.getIndex(), false); }
    execute() {
      this.stop();
      if (player.isRegistered() && !player.getDialogueManager().isActive()) openMenu(player);
    }
  })());
}

function start(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

module.exports = {
  name: "Amrod",
  description: "Amrod exchanges unnoted crystal seeds for crystal shards in Prifddinas.",
  members: true,
  register(pluginApi) {
    start(pluginApi);
    api.onNpcInteraction(NPC_NAME, { Trade: trade });
    api.onCustomEvent("npc-dialogue:action", dialogueAction);
  },
};
