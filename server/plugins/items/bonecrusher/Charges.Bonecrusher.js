/**
 * Bonecrusher (https://oldschool.runescape.wiki/w/Bonecrusher), the hard Morytania diary's reward
 * from the ghost disciples (plugins/skills/ectofuntus/Disciples.Ectofuntus.js). Carried in the
 * inventory with charges and active, it crushes the bones a kill drops, one charge each, for half
 * their burying experience (all of it with the elite Morytania diary), and the Catacombs of
 * Kourend and a dragonbone necklace give back their Prayer restore as for burying. Bones dropped
 * noted and tertiary bones (long and curved) are left on the floor. See docs/prayer-bones.md.
 *
 * As captured (rsprox recordings 1857, 703, Leagues V; the item is the same on every world):
 * - An ectotoken used on it adds all of them, 25 charges each: synth 1413 and "The bonecrusher has
 *   2,125 charges. It is active and ready to crush bones."
 * - Check: "The bonecrusher has no charges. It can be charged with ectotokens." or the line above.
 * - Activity: "The bonecrusher has been deactivated, and will not crush bones now." with synth 974,
 *   or "The bonecrusher is active and ready to crush bones." with synth 975.
 * - It crushes as the loot lands, and every hundredth charge says "Your bonecrusher has 5,700
 *   charges left." Charges aren't sent to the client.
 * Not captured: Check while deactivated (the Activity line is used), and Uncharge, which the Wiki
 * says returns an ectotoken per 25 charges and keeps the rest; it answers with Check's line.
 */
const CHARGES_ATTRIBUTE = "bonecrusher:charges";
const INACTIVE_ATTRIBUTE = "bonecrusher:inactive";

const CHARGES_PER_TOKEN = 25;
const MAX_CHARGES = 2147483647; // charges_bonecrusher_quantity, bits 0-30 of varp 4675
const CHARGE_SOUND = 1413;
const DEACTIVATE_SOUND = 974;
const ACTIVATE_SOUND = 975;

let core = null;

const charges = (player) => Number(player.getAttribute(CHARGES_ATTRIBUTE)) || 0;
const active = (player) => !player.getAttribute(INACTIVE_ATTRIBUTE);
const format = (count) => count.toLocaleString("en-GB");

function setCharges(player, count) {
  player.setAttribute(CHARGES_ATTRIBUTE, count);
}

function status(player) {
  const count = charges(player);
  if (count <= 0) return "The bonecrusher has no charges. It can be charged with ectotokens.";
  return active(player)
    ? `The bonecrusher has ${format(count)} charges. It is active and ready to crush bones.`
    : `The bonecrusher has ${format(count)} charges. It has been deactivated, and will not crush bones now.`;
}

function check({ player }) {
  player.sendMessage(status(player));
}

function toggleActivity({ player }) {
  const activating = !active(player);
  player.setAttribute(INACTIVE_ATTRIBUTE, activating ? 0 : 1);
  player.sendMessage(activating
    ? "The bonecrusher is active and ready to crush bones."
    : "The bonecrusher has been deactivated, and will not crush bones now.");
  player.getPacketSender().sendSound(activating ? ACTIVATE_SOUND : DEACTIVATE_SOUND, 1, 0);
}

function uncharge({ player }) {
  const tokens = Math.floor(charges(player) / CHARGES_PER_TOKEN);
  const inventory = player.getInventory();
  if (tokens > 0 && inventory.getAddableAmount(new core.Item(core.ItemIdentifiers.ECTO_TOKEN, tokens)) >= tokens) {
    inventory.adds(core.ItemIdentifiers.ECTO_TOKEN, tokens);
    setCharges(player, charges(player) - tokens * CHARGES_PER_TOKEN);
  }
  player.sendMessage(status(player));
}

function charge({ player }) {
  const inventory = player.getInventory();
  const room = Math.ceil((MAX_CHARGES - charges(player)) / CHARGES_PER_TOKEN);
  const tokens = Math.min(inventory.getAmount(core.ItemIdentifiers.ECTO_TOKEN), room);
  if (tokens <= 0) return;
  inventory.deleteNumber(core.ItemIdentifiers.ECTO_TOKEN, tokens);
  setCharges(player, Math.min(MAX_CHARGES, charges(player) + tokens * CHARGES_PER_TOKEN));
  player.sendMessage(status(player));
  player.getPacketSender().sendSound(CHARGE_SOUND, 1, 0);
}

const WITHDRAWAL_CHARGES_ATTRIBUTE = "bonecrusher:withdrawal-charges";
const CONFIGURE_CHARGES_OP = 9; // bankmain item op, cache param 2257
const bankInteractions = new WeakMap();

function destroyed({ player, itemId }) {
  if (itemId !== core.ItemIdentifiers.BONECRUSHER) return;
  const tokens = Math.floor(charges(player) / CHARGES_PER_TOKEN);
  setCharges(player, 0);
  if (tokens > 0) core.ItemOnGroundManager.registers(player, new core.Item(core.ItemIdentifiers.ECTO_TOKEN, tokens));
}

function currentBankInteraction(saved) {
  return bankInteractions.get(saved.player) === saved && core.Bank.isOpen(saved.player) &&
    saved.player.getBank(saved.tab).getItems()[saved.slot] === saved.item &&
    saved.item.getId() === core.ItemIdentifiers.BONECRUSHER && saved.item.getAmount() > 0;
}

function configureCharges(event) {
  const { player, item, tab, slot, op } = event;
  if (op !== CONFIGURE_CHARGES_OP || item?.getId() !== core.ItemIdentifiers.BONECRUSHER) return;
  event.handled = true;
  if (!Number.isInteger(tab) || tab < 0 || tab >= core.Bank.BANK_SEARCH_TAB_INDEX || !Number.isInteger(slot) || slot < 0) return;
  const saved = { player, item, tab, slot };
  bankInteractions.set(player, saved);
  if (!currentBankInteraction(saved)) return;
  player.setEnteredAmountAction({
    acceptsZero: true,
    execute(amount) {
      if (!currentBankInteraction(saved) || !Number.isInteger(amount) || amount < 0 || amount > MAX_CHARGES) return;
      player.setAttribute(WITHDRAWAL_CHARGES_ATTRIBUTE, amount);
      bankInteractions.delete(player);
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(`Set withdrawal charges (0 - ${format(MAX_CHARGES)}; 0 disables):`);
}

function withdrawn({ player, items }) {
  if (!core.Bank.isOpen(player) || !Array.isArray(items) ||
      !items.some(item => item?.getId() === core.ItemIdentifiers.BONECRUSHER &&
        player.getInventory().getItems().includes(item))) return;
  const wanted = player.getAttribute(WITHDRAWAL_CHARGES_ATTRIBUTE);
  if (!Number.isInteger(wanted) || wanted <= charges(player) || wanted > MAX_CHARGES) return;
  let needed = Math.ceil((wanted - charges(player)) / CHARGES_PER_TOKEN);
  let consumed = 0;
  for (let tab = 0; tab < core.Bank.BANK_SEARCH_TAB_INDEX && needed > 0; tab++) {
    const bank = player.getBank(tab);
    const available = Math.min(needed, bank.getAmount(core.ItemIdentifiers.ECTO_TOKEN));
    if (available <= 0) continue;
    bank.delete(core.ItemIdentifiers.ECTO_TOKEN, available);
    needed -= available;
    consumed += available;
  }
  if (consumed > 0) setCharges(player, Math.min(MAX_CHARGES, charges(player) + consumed * CHARGES_PER_TOKEN));
}

module.exports = function registerCharges(api) {
  core = api.core;
  api.persistAttribute(CHARGES_ATTRIBUTE, 0);
  api.persistAttribute(INACTIVE_ATTRIBUTE, 0);
  api.persistAttribute(WITHDRAWAL_CHARGES_ATTRIBUTE, 0);
  api.onItemAction("Bonecrusher", { Check: check, Activity: toggleActivity, Uncharge: uncharge });
  api.onItemOnItem("Ecto-token", "Bonecrusher", charge);
  api.onCustomEvent("destroy-item:destroyed", destroyed);
  api.onCustomEvent(core.Bank.ITEM_OP_EVENT, configureCharges);
  api.onCustomEvent(core.Bank.WITHDRAWN_ITEMS_EVENT, withdrawn);
};
module.exports.charges = charges;
module.exports.active = active;
module.exports.setCharges = setCharges;
module.exports.format = format;
