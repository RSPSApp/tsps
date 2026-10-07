"use strict";

function addDefinition(api, { definitions }) {
  definitions.push({ id: api.core.NpcIdentifiers.DR_JEKYLL, kind: "jekyll",
    greeting: "Please help me", talk: talk.bind(null, api) });
}

function talk(api, active, { valid, serve }) {
  const I = api.core.ItemIdentifiers;
  // Ascending Herblore order: highest clean, unnoted herb is requested each talk.
  const exchanges = [
    [I.GUAM_LEAF, I.STRENGTH_POTION_4_, "guam leaf"],
    [I.MARRENTILL, I.ANTIPOISON_4_, "marrentill"],
    [I.TARROMIN, I.ATTACK_POTION_4_, "tarromin"],
    [I.HARRALANDER, I.RESTORE_POTION_4_, "harralander"],
    [I.RANARR_WEED, I.ENERGY_POTION_4_, "ranarr weed"],
    [I.TOADFLAX, I.DEFENCE_POTION_4_, "toadflax"],
    [I.IRIT_LEAF, I.AGILITY_POTION_4_, "irit leaf"],
    [I.AVANTOE, I.SUPER_ATTACK_4_, "avantoe"],
    [I.KWUARM, I.SUPER_ENERGY_4_, "kwuarm"],
    [I.SNAPDRAGON, I.SUPER_STRENGTH_4_, "snapdragon"],
    [I.CADANTINE, I.SUPER_RESTORE_4_, "cadantine"],
    [I.LANTADYME, I.SUPER_DEFENCE_4_, "lantadyme"],
    [I.DWARF_WEED, I.MAGIC_POTION_4_, "dwarf weed"],
    [I.TORSTOL, I.STAMINA_POTION_4_, "torstol"],
  ];
  const player = active.player, inventory = player.getInventory();
  const exchange = exchanges.reverse().find(([id]) => inventory.containsNumber(id));
  const request = {};
  active.prompt = request;
  const current = () => active.prompt === request && valid(active, player);
  const fallback = () => {
    if (current() && serve(active, [I.STRENGTH_POTION_2_])) player.sendMessage("Dr Jekyll gives you a strength potion.");
  };
  if (!exchange) { fallback(); return; }
  const [herbId, potionId, name] = exchange;
  const slot = inventory.getItems().findIndex(item => item?.getId() === herbId && item.getAmount() > 0);
  const herb = inventory.get(slot);
  api.sendMultiChatboxPrompt(player, `Give Dr Jekyll your ${name} for a potion?`,
    "Give him the herb", () => {
      if (!current()) return;
      if (inventory.get(slot) !== herb || herb.getId() !== herbId || herb.getAmount() !== 1) {
        player.sendMessage("Your herb has moved. Talk to Dr Jekyll again.");
        return;
      }
      if (serve(active, [potionId], { slot, item: herb })) player.sendMessage("Dr Jekyll trades your herb for a potion.");
    },
    "Keep my herb", fallback);
}

module.exports = { addDefinition };
