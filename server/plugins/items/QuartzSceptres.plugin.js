/**
 * The Desert Treasure II quartzes on the ancient sceptre (docs/quartz-sceptres.md).
 *
 * - Combine: rsprox capture 821 (rev 234) ticks 1641-1645, a blood quartz used on an ancient sceptre.
 *   A double item box with the quartz and the sceptre asks "Are you sure you wish to combine the Blood quartz
 *   and Ancient sceptre to create a Blood ancient sceptre?". After it, the menu "Combine the Blood quartz and
 *   Ancient sceptre?" offers "Yes." / "No.". Yes takes both, leaves the sceptre in the quartz's slot, and
 *   plays seq 10096 with spotanim 759 and synth 140. It then shows the new sceptre's item box, "You successfully
 *   combine the Blood quartz and Ancient sceptre to create a Blood ancient sceptre.". The Ice, Smoke and Shadow
 *   quartzes follow the same lines with their own names (Wiki: Ancient sceptre, Quartz upgrades).
 * - Dismantle: the Wiki says the process "can be reversed" and the cache gives each unlocked quartz sceptre a
 *   Dismantle option (Wiki: Blood ancient sceptre changes, "The regular, non-locked variant of the sceptre can
 *   now be dismantled to return the component items"). Nothing captures it. Ours: it needs one free slot, keeps
 *   the ancient sceptre in the old sceptre's slot, adds the quartz and says nothing; with a full inventory it
 *   says the Thammaron's sceptre line ("You don't have enough inventory space to dismantle your sceptre.").
 * - Ours: only the plain Ancient sceptre takes a quartz. The locked (l) sceptre has its own name and no capture.
 * - Desert Treasure II: the Wiki (Blood ancient sceptre) requires it. Like AncientRingCrafting, an unfinished quest
 *   leaves the pair unhandled ("Nothing interesting happens."); no capture shows a refusal line.
 */
const DESERT_TREASURE_II = "desert_treasure_ii";
const COMBINE_ANIMATION = 10096;
const COMBINE_GRAPHIC = 759;
const COMBINE_SOUND = 140;
const NO_SPACE = "You don't have enough inventory space to dismantle your sceptre.";

/** Quartz -> the sceptre it makes, by ItemIdentifiers name. */
const QUARTZES = [
  { quartz: "BLOOD_QUARTZ", sceptre: "BLOOD_ANCIENT_SCEPTRE_2", quartzName: "Blood quartz", sceptreName: "Blood ancient sceptre" },
  { quartz: "ICE_QUARTZ", sceptre: "ICE_ANCIENT_SCEPTRE_2", quartzName: "Ice quartz", sceptreName: "Ice ancient sceptre" },
  { quartz: "SMOKE_QUARTZ", sceptre: "SMOKE_ANCIENT_SCEPTRE_2", quartzName: "Smoke quartz", sceptreName: "Smoke ancient sceptre" },
  { quartz: "SHADOW_QUARTZ", sceptre: "SHADOW_ANCIENT_SCEPTRE_2", quartzName: "Shadow quartz", sceptreName: "Shadow ancient sceptre" },
];
const SCEPTRE_NAME = "Ancient sceptre";

let api;
let table = null;

function recipes() {
  if (table) return table;
  const { ItemIdentifiers: I } = api.core;
  table = QUARTZES.map((entry) => ({
    quartzId: I[entry.quartz],
    sceptreId: I[entry.sceptre],
    quartzName: entry.quartzName,
    sceptreName: entry.sceptreName,
  }));
  return table;
}

function baseSceptreId() {
  return api.core.ItemIdentifiers.ANCIENT_SCEPTRE;
}

function itemBox(player, text, items) {
  const { DialogueChainBuilder, ItemStatementDialogue, DoubleItemStatementDialogue, EndDialogue } = api.core;
  const chain = new DialogueChainBuilder();
  chain.add(items.length > 1
    ? new DoubleItemStatementDialogue(0, items[0], items[1], text)
    : new ItemStatementDialogue(0, items[0], text));
  chain.add(new EndDialogue(1));
  player.getDialogueManager().startDialogues(chain);
}

/** The slot holding `item` (the very Item the player clicked), else the first slot with `id`. */
function slotOf(inventory, item, id) {
  const items = inventory.getItems();
  const exact = item ? items.indexOf(item) : -1;
  if (exact >= 0 && items[exact]?.getId?.() === id) return exact;
  return items.findIndex((entry) => entry?.getId?.() === id && entry.getAmount() > 0);
}

/** `slot` if it still holds `id`, else the first slot with `id`. */
function heldSlot(inventory, slot, id) {
  const items = inventory.getItems();
  if (Number.isInteger(slot) && items[slot]?.getId?.() === id && items[slot].getAmount() > 0) return slot;
  return slotOf(inventory, null, id);
}

function completedDesertTreasureII(player) {
  const request = { player, key: DESERT_TREASURE_II, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** Capture 821 T1644: the clicked quartz's slot (7) takes the new sceptre, the clicked sceptre's slot (1) empties. */
function combineNow(player, recipe, clicked) {
  const { Item, Animation, Graphic } = api.core;
  const inventory = player.getInventory();
  const quartzSlot = heldSlot(inventory, clicked.quartzSlot, recipe.quartzId);
  const sceptreSlot = heldSlot(inventory, clicked.sceptreSlot, baseSceptreId());
  if (quartzSlot < 0 || sceptreSlot < 0) return;
  // deleteAtSlot leaves the slot's empty Item (id -1), not null, which other inventory code expects.
  inventory.deleteAtSlot(sceptreSlot, 1, false);
  inventory.setItem(quartzSlot, new Item(recipe.sceptreId, 1));
  inventory.refreshItems();
  player.performAnimation(new Animation(COMBINE_ANIMATION));
  player.performGraphic(new Graphic(COMBINE_GRAPHIC));
  player.getPacketSender().sendSoundEffect(COMBINE_SOUND, 1, 0, 255);
  itemBox(player, `You successfully combine the ${recipe.quartzName} and ${SCEPTRE_NAME} to create a ${recipe.sceptreName}.`,
    [recipe.sceptreId]);
}

function combine({ player, usedItemId, usedWithItemId, usedItemSlot, usedWithItemSlot }) {
  const base = baseSceptreId();
  const sceptreFirst = usedItemId === base;
  const quartzId = sceptreFirst ? usedWithItemId : usedItemId;
  const otherId = sceptreFirst ? usedItemId : usedWithItemId;
  const recipe = recipes().find((entry) => entry.quartzId === quartzId);
  if (!recipe || otherId !== base) return false;
  if (!completedDesertTreasureII(player)) return false;
  const clicked = sceptreFirst
    ? { sceptreSlot: usedItemSlot, quartzSlot: usedWithItemSlot }
    : { quartzSlot: usedItemSlot, sceptreSlot: usedWithItemSlot };
  const { DialogueChainBuilder, DoubleItemStatementDialogue, ActionDialogue } = api.core;
  const parts = `${recipe.quartzName} and ${SCEPTRE_NAME}`;
  const chain = new DialogueChainBuilder();
  chain.add(new DoubleItemStatementDialogue(0, recipe.quartzId, base,
    `Are you sure you wish to combine the ${parts} to create a ${recipe.sceptreName}?`));
  chain.add(new ActionDialogue(1, {
    execute: () => api.sendMultiChatboxPrompt(player, `Combine the ${parts}?`,
      "Yes.", () => combineNow(player, recipe, clicked),
      "No.", () => {}),
  }));
  player.getDialogueManager().startDialogues(chain);
  return true;
}

function dismantle({ player, itemId, item }) {
  const recipe = recipes().find((entry) => entry.sceptreId === itemId);
  if (!recipe) return false;
  const { Item } = api.core;
  const inventory = player.getInventory();
  const slot = slotOf(inventory, item, itemId);
  if (slot < 0) return true;
  if (inventory.getFreeSlots() < 1) {
    player.sendMessage(NO_SPACE);
    return true;
  }
  inventory.setItem(slot, new Item(baseSceptreId(), 1));
  inventory.add(new Item(recipe.quartzId, 1), false);
  inventory.refreshItems();
  return true;
}

module.exports = {
  name: "QuartzSceptres",
  description: "Desert Treasure II quartzes: combine a blood, ice, smoke or shadow quartz with the ancient sceptre, and dismantle the upgraded sceptre back.",
  members: true,
  _test: { recipes: () => recipes(), combine, dismantle, NO_SPACE },
  register(pluginApi) {
    api = pluginApi;
    for (const entry of QUARTZES) {
      api.onItemOnItem(entry.quartzName, SCEPTRE_NAME, combine, { noted: false });
      api.onItemAction(entry.sceptreName, { Dismantle: dismantle });
    }
  },
};
