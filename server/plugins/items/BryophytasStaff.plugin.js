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
 */
const { restricted, plainAmount, takePlain, PRESET_TEXT } = require("./PoweredStaff");

const MAX_CHARGES = 1000;
const CHARGE_META_KEY = "bryophytas-staff:charges";
/** Wiki: "a 1/15 chance to save a single charge". */
const SAVE_CHANCE = 15;
const SAVE_MESSAGE = "Your staff saved you a nature rune.";

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
    // Ours: no capture of a full staff; the cap itself is the Wiki's.
    player.sendMessage(`Your Bryophyta's staff already has ${format(MAX_CHARGES)} charges.`);
    return true;
  }
  takePlain(inventory, natureRuneId, added);
  setCharges(staff, before + added);
  inventory.refreshItems();
  itemStatement(player, chargedId, `Your Bryophyta's staff now has ${format(charges(staff))} charges.`);
  return true;
}

/** Ours: no capture of Check; the wording follows the captured charge message. */
function check({ player, item }) {
  player.sendMessage(`Your Bryophyta's staff has ${format(charges(item))} charges.`);
  return true;
}

/** Rune source: the worn, charged staff pays a spell's nature runes, never part of them. */
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

module.exports = {
  name: "BryophytasStaff",
  description: "Bryophyta's staff: charged with up to 1,000 nature runes, Check, and worn it pays spells' nature runes with a 1/15 chance to save one.",
  _test: {
    MAX_CHARGES, CHARGE_META_KEY, SAVE_MESSAGE, charges, setCharges,
    setRandom(fn) { random = fn ?? Math.random; },
  },
  register(api) {
    core = api.core;
    chargedId = core.ItemIdentifiers.BRYOPHYTAS_STAFF;
    unchargedId = core.ItemIdentifiers.BRYOPHYTAS_STAFF_UNCHARGED_;
    natureRuneId = core.ItemIdentifiers.NATURE_RUNE;
    api.onItemAction("Bryophyta's staff", { Check: check });
    api.onItemAction("Bryophyta's staff (uncharged)", { Check: check });
    api.onItemOnItem("Nature rune", "Bryophyta's staff", chargeWithRunes, { noted: false });
    api.onItemOnItem("Nature rune", "Bryophyta's staff (uncharged)", chargeWithRunes, { noted: false });
    api.registerSpellRuneSource({ check: covers, consume: spend });
  },
};
