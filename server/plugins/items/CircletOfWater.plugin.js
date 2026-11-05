/**
 * Circlet of water (docs/desert-heat.md): https://oldschool.runescape.wiki/w/Circlet_of_water
 *
 * Wiki: five water runes make one charge, up to 500,000; worn, each charge stands in for a drink
 * when the desert heat strikes. Uncharging returns every charge as water runes.
 *
 * Captures (rsprox): Charge and a water rune on the circlet both ask "How many charges would you
 * like to add? (0 - N)", then show an objectbox with the charged circlet. Uncharge asks to
 * confirm first. Worn, its charges show in varbit buff_water_circlet_charges.
 */
const MAX_CHARGES = 500000;
const RUNES_PER_CHARGE = 5;
const CHARGE_META_KEY = "circlet-of-water:charges";
/** buff_water_circlet_charges: the worn circlet's charges, 0 when none is worn. */
const WORN_CHARGES_VARBIT = 14191;
const PROTECT_MESSAGE = "Your circlet protects you from the desert heat.";

let core;
let circletId = -1;
let unchargedId = -1;
let waterRuneId = -1;

function isCirclet(id) {
  return id === circletId || id === unchargedId;
}

function charges(item) {
  const saved = Number(item?.getMetaValue?.(CHARGE_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

/** Stores the charges and swaps between the charged and uncharged circlet to match. */
function setCharges(item, amount) {
  const left = Math.max(0, Math.min(MAX_CHARGES, Math.floor(amount)));
  item.setMetaValue(CHARGE_META_KEY, left > 0 ? left : undefined);
  item.setId(left > 0 ? circletId : unchargedId);
}

function format(amount) {
  return amount.toLocaleString("en-US");
}

function wornCirclet(player) {
  const item = player.getEquipment().getItems()[core.Equipment.HEAD_SLOT];
  return isCirclet(item?.getId?.()) ? item : null;
}

function showWornCharges({ player }) {
  player.getPacketSender().sendVarbit(WORN_CHARGES_VARBIT, charges(wornCirclet(player)));
}

function itemStatement(player, itemId, text) {
  const { DialogueChainBuilder, ItemStatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text)));
}

function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

/** Captures (rsprox): the count prompt, then an objectbox with the charged circlet. */
function promptCharge(player, circlet) {
  const inventory = player.getInventory();
  const most = Math.min(MAX_CHARGES - charges(circlet), Math.floor(inventory.getAmount(waterRuneId) / RUNES_PER_CHARGE));
  if (most <= 0) {
    statement(player, "You need some water runes to charge your circlet.");
    return;
  }
  player.setEnteredAmountAction({
    execute(amount) {
      if (!inventory.getItems().includes(circlet)) return;
      const before = charges(circlet);
      const added = Math.min(Math.floor(Number(amount)), MAX_CHARGES - before,
        Math.floor(inventory.getAmount(waterRuneId) / RUNES_PER_CHARGE));
      if (!(added > 0)) return;
      inventory.deleteNumber(waterRuneId, added * RUNES_PER_CHARGE);
      setCharges(circlet, before + added);
      inventory.refreshItems();
      itemStatement(player, circletId, before > 0
        ? `You add ${format(added)} charges to your circlet. It now has ${format(charges(circlet))} charges.`
        : `You add ${format(added)} charges to your circlet.`);
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(`How many charges would you like to add? (0 - ${format(most)})`);
}

function charge({ player, item }) {
  promptCharge(player, item);
  return true;
}

function chargeWithRunes(event) {
  promptCharge(event.player, isCirclet(event.usedItemId) ? event.usedItem : event.usedWithItem);
  return true;
}

function check({ player, item }) {
  player.sendMessage(`Your circlet has ${format(charges(item))} charges left.`);
  return true;
}

/** The inventory can fill while the prompt is open, so Yes asks again. */
function refundFits(inventory, circlet) {
  const refund = new core.Item(waterRuneId, charges(circlet) * RUNES_PER_CHARGE);
  return inventory.getAddableAmount(refund) >= refund.getAmount();
}

function uncharge(player, circlet) {
  const inventory = player.getInventory();
  const amount = charges(circlet);
  if (!inventory.getItems().includes(circlet) || amount <= 0) return;
  if (!refundFits(inventory, circlet)) {
    statement(player, "You don't have enough room to uncharge your circlet.");
    return;
  }
  setCharges(circlet, 0);
  inventory.add(new core.Item(waterRuneId, amount * RUNES_PER_CHARGE));
  inventory.refreshItems();
  itemStatement(player, unchargedId,
    `You fully uncharge your circlet.<br>You regain ${format(amount * RUNES_PER_CHARGE)} water runes in the process.`);
}

/** Captures (rsprox): a full inventory is refused at once; otherwise "Yes." / "No." first. */
function confirmUncharge({ player, item }) {
  const inventory = player.getInventory();
  if (!refundFits(inventory, item)) {
    statement(player, "You don't have enough room to uncharge your circlet.");
    return true;
  }
  const { DialogueChainBuilder, OptionDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        if (Number(option) === 1) uncharge(player, item);
      },
    }, "Yes.", "No.").setTitle("Are you sure you want to fully uncharge your circlet?"),
  ));
  return true;
}

/** Desert heat asks first: a worn, charged circlet spends a charge instead of a drink. */
function protect(request) {
  const { player } = request;
  const circlet = wornCirclet(player);
  const left = charges(circlet);
  if (request.protected || left <= 0) return;
  request.protected = true;
  setCharges(circlet, left - 1);
  player.getEquipment().refreshItems();
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, PROTECT_MESSAGE);
}

module.exports = {
  name: "CircletOfWater",
  members: true,
  _test: { MAX_CHARGES, CHARGE_META_KEY, charges },
  register(api) {
    core = api.core;
    circletId = core.ItemIdentifiers.CIRCLET_OF_WATER;
    unchargedId = core.ItemIdentifiers.CIRCLET_OF_WATER_UNCHARGED_;
    waterRuneId = core.ItemIdentifiers.WATER_RUNE;
    api.onItemAction("Circlet of water", { Check: check, Charge: charge, Uncharge: confirmUncharge });
    api.onItemAction("Circlet of water (uncharged)", { Charge: charge });
    api.onItemOnItem("Water rune", "Circlet of water", chargeWithRunes, { noted: false });
    api.onItemOnItem("Water rune", "Circlet of water (uncharged)", chargeWithRunes, { noted: false });
    api.onCustomEvent("desert-heat:protect", protect);
    api.onCustomEvent("equipment:changed", showWornCharges);
    api.onPlayerLogin(showWornCharges);
  },
};
