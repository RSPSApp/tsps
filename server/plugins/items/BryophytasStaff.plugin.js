/**
 * Bryophyta's staff (docs/bryophytas-staff.md): https://oldschool.runescape.wiki/w/Bryophyta%27s_staff
 *
 * Wiki: charged with up to 1,000 nature runes; worn, it acts as if the player held that many nature runes, and a
 * spell paid from it has a 1/15 chance to save one charge ("Your staff saved you a nature rune.", one rune however
 * many the spell costs).
 *
 * rsprox captures (local 1000564, tick 31098-31099): a nature rune used on the uncharged staff takes every nature
 * rune held (31) at once, with no amount prompt, turns it into the charged staff in the same slot and opens an
 * objectbox showing the charged staff: "Your Bryophyta's staff now has 31 charges.".
 *
 * Bank Configure-Charges (Wiki: "Players can configure the charges while the weapon is in their bank by right-clicking
 * on Configure-Charges"; the charged staff carries cache param 2257): live's shared prompt and shortfall line are the
 * captured toxic blowpipe's and crystal pickaxe's (rsprox_transcripts/229/911020.txt, ticks 41-45): "How many charges
 * would you like the item to have on withdrawal? (0 - 16,383)", and on withdrawal the item is charged from the bank
 * up to that amount, as far as the bank's resources go, with "<col=ff3045>You did not have enough resources to charge
 * your Toxic blowpipe up to 16383." when they run short. Ours: the amount is kept per player, a withdrawal only tops
 * up (never takes charges off), and only the charged staff (the form with the param) is topped up.
 * Not modelled: Uncharge (the Wiki: the nature runes are not returned; no capture of its prompt or reply) and the
 * Ultimate Ironman death rule.
 */
const { restricted, plainAmount, takePlain, PRESET_TEXT } = require("./PoweredStaff");

const MAX_CHARGES = 1000;
const CHARGE_META_KEY = "bryophytas-staff:charges";
/** Wiki: "a 1/15 chance to save a single charge". */
const SAVE_CHANCE = 15;
const SAVE_MESSAGE = "Your staff saved you a nature rune.";

const WITHDRAWAL_CHARGES_ATTRIBUTE = "bryophytas-staff:withdrawal-charges";
const CONFIGURE_CHARGES_OP = 9; // bankmain item op, cache param 2257

let core;
let chargedId = -1;
let unchargedId = -1;
let natureRuneId = -1;
let random = Math.random;

function isStaff(id) {
  return id === chargedId || id === unchargedId;
}

/** Only the charged staff holds charges: stale metadata on another form counts for nothing. */
function charges(item) {
  if (item?.getId?.() !== chargedId) return 0;
  const saved = Number(item.getMetaValue?.(CHARGE_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

/** Stores the charges and swaps between the charged and uncharged staff to match. Ours: the last charge spent
 * turns it back into the uncharged staff, as every other charge-holding form here does. */
function setCharges(item, amount) {
  const left = Math.max(0, Math.min(MAX_CHARGES, Math.floor(amount)));
  item.setMetaValue(CHARGE_META_KEY, left > 0 ? left : undefined);
  item.setId(left > 0 ? chargedId : unchargedId);
}

function format(amount) {
  return amount.toLocaleString("en-US");
}

function wornStaff(player) {
  const item = player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  return item?.getId?.() === chargedId ? item : null;
}

function itemStatement(player, itemId, text) {
  const { DialogueChainBuilder, ItemStatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text)));
}

function chargeWithRunes(event) {
  const { player } = event;
  const staff = isStaff(event.usedItemId) ? event.usedItem : event.usedWithItem;
  const runes = staff === event.usedItem ? event.usedWithItem : event.usedItem;
  if (restricted(runes)) {
    player.sendMessage(PRESET_TEXT);
    return true;
  }
  const inventory = player.getInventory();
  const before = charges(staff);
  const added = Math.min(MAX_CHARGES - before, plainAmount(inventory, natureRuneId));
  if (added <= 0) {
    // Ours: no capture of a full Bryophyta's staff; worded as the captured full bone staff (rsprox 2152, tick 4158).
    player.sendMessage("Your Bryophyta's staff is already fully charged.");
    return true;
  }
  takePlain(inventory, natureRuneId, added);
  setCharges(staff, before + added);
  inventory.refreshItems();
  itemStatement(player, chargedId, `Your Bryophyta's staff now has ${format(charges(staff))} charges.`);
  return true;
}

/** Ours: no capture of this Check; worded as the captured charged staves' ("Your Bone staff has 1,000 charges
 * remaining.", rsprox 2152 tick 2826; Sanguinesti staff, rsprox 1696 tick 1077). */
function check({ player, item }) {
  player.sendMessage(`Your Bryophyta's staff has ${format(charges(item))} charges remaining.`);
  return true;
}

/** Rune source: the worn, charged staff pays a spell's nature runes, never part of them. Ours: it pays before the
 * rune pouch (this file loads before RunePouch.plugin.js; tests/bryophytas-staff.test.cjs pins the order). */
function covers(player, missingItems) {
  const left = charges(wornStaff(player));
  return left > 0 && missingItems.every((item) => item.getId() === natureRuneId && item.getAmount() <= left);
}

function spend(player, missingItems) {
  if (!covers(player, missingItems)) return;
  const staff = wornStaff(player);
  const cost = missingItems.reduce((total, item) => total + item.getAmount(), 0);
  const saved = Math.floor(random() * SAVE_CHANCE) === 0;
  setCharges(staff, charges(staff) - (saved ? cost - 1 : cost));
  player.getEquipment().refreshItems();
  if (saved) player.sendMessage(SAVE_MESSAGE);
}

// ------------------------------------------------------------------ bank

function liveBankSlot(player, item) {
  const { Bank } = core;
  return Bank.isOpen(player) && item.getId() === chargedId && item.getAmount() === 1 &&
    player.getBanks().some((bank, tab) => tab !== Bank.BANK_SEARCH_TAB_INDEX && bank?.getItems().includes(item));
}

/** Configure-Charges on the banked staff: how many charges a withdrawn staff is topped up to. */
function bankItemOp(event) {
  const { player, item } = event;
  if (event.op !== CONFIGURE_CHARGES_OP || item?.getId?.() !== chargedId) return;
  event.handled = true;
  if (!liveBankSlot(player, item)) return;
  player.setEnteredAmountAction({
    acceptsZero: true,
    execute(amount) {
      if (!liveBankSlot(player, item) || !Number.isInteger(amount) || amount < 0) return;
      player.setAttribute(WITHDRAWAL_CHARGES_ATTRIBUTE, Math.min(MAX_CHARGES, amount));
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(`How many charges would you like the item to have on withdrawal? (0 - ${format(MAX_CHARGES)})`);
}

/** Takes up to `wanted` nature runes from the bank's tabs (not the search tab); returns how many it took. */
function takeBankedRunes(player, wanted) {
  const { Bank } = core;
  let taken = 0;
  for (let tab = 0; tab < Bank.BANK_SEARCH_TAB_INDEX && taken < wanted; tab++) {
    const bank = player.getBank(tab);
    const amount = Math.min(wanted - taken, bank?.getAmount(natureRuneId) ?? 0);
    if (amount <= 0) continue;
    bank.delete(natureRuneId, amount);
    taken += amount;
  }
  return taken;
}

/** A withdrawn charged staff is charged from the banked nature runes up to the configured amount. */
function withdrawn({ player, items }) {
  const target = Math.min(MAX_CHARGES, Number(player.getAttribute(WITHDRAWAL_CHARGES_ATTRIBUTE)) || 0);
  if (target <= 0 || !Array.isArray(items) || !core.Bank.isOpen(player)) return;
  let changed = false;
  for (const staff of items) {
    if (staff?.getId?.() !== chargedId || !player.getInventory().getItems().includes(staff)) continue;
    const before = charges(staff);
    if (before >= target) continue;
    const taken = takeBankedRunes(player, target - before);
    if (taken > 0) {
      setCharges(staff, before + taken);
      changed = true;
    }
    if (before + taken < target) {
      player.sendMessage(`<col=ff3045>You did not have enough resources to charge your Bryophyta's staff up to ${target}.`);
    }
  }
  if (changed) player.getInventory().refreshItems();
}

module.exports = {
  name: "BryophytasStaff",
  description: "Bryophyta's staff: charged with up to 1,000 nature runes, Check, bank Configure-Charges, and worn it pays spells' nature runes with a 1/15 chance to save one.",
  _test: {
    MAX_CHARGES, CHARGE_META_KEY, SAVE_MESSAGE, WITHDRAWAL_CHARGES_ATTRIBUTE, charges, setCharges,
    setRandom(fn) { random = fn ?? Math.random; },
  },
  register(api) {
    core = api.core;
    chargedId = core.ItemIdentifiers.BRYOPHYTAS_STAFF;
    unchargedId = core.ItemIdentifiers.BRYOPHYTAS_STAFF_UNCHARGED_;
    natureRuneId = core.ItemIdentifiers.NATURE_RUNE;
    api.persistAttribute(WITHDRAWAL_CHARGES_ATTRIBUTE, 0);
    api.onItemAction("Bryophyta's staff", { Check: check });
    api.onItemAction("Bryophyta's staff (uncharged)", { Check: check });
    api.onItemOnItem("Nature rune", "Bryophyta's staff", chargeWithRunes, { noted: false });
    api.onItemOnItem("Nature rune", "Bryophyta's staff (uncharged)", chargeWithRunes, { noted: false });
    api.registerSpellRuneSource({ check: covers, consume: spend });
    api.onCustomEvent(core.Bank.ITEM_OP_EVENT, bankItemOp);
    api.onCustomEvent(core.Bank.WITHDRAWN_ITEMS_EVENT, withdrawn);
  },
};
