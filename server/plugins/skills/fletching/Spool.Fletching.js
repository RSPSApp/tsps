/**
 * The bow string spool (Wiki, Bow string spool): bow strings stored on the account, not the item,
 * so a lost spool keeps its strings. Bow strings or their notes used on it, or its Fill option,
 * add them; Empty takes them back as items or notes; a carried spool strings bows by itself, so an
 * inventory holds 27 bows instead of 14, and it fills with bow strings as they are spun from flax.
 *
 * Capacity: 250 strings, more for each spare spool used on it (500, 2,000, 5,000, 10,000 and
 * 100,000 at six spools). The client shows varbit bowstring_spool_charges on the buff bar while a
 * spool is carried (cache script 5923); bowstring_spool_size holds the spare spools added.
 * No capture covers the spool (it is newer than the recordings), so its messages are our own.
 */
const Shared = require("./Shared.Fletching");

const CHARGES_ATTRIBUTE = "fletching:spool-charges";
const SPARES_ATTRIBUTE = "fletching:spool-spares";
const CAPACITY_BY_SPARES = [250, 500, 2000, 5000, 10000, 100000];

let core = null;
let spoolId = null;
let bowStringId = null;
let notedBowStringId = null;

function charges(player) {
  return Number(player.getAttribute(CHARGES_ATTRIBUTE)) || 0;
}

function spares(player) {
  return Number(player.getAttribute(SPARES_ATTRIBUTE)) || 0;
}

function capacity(player) {
  return CAPACITY_BY_SPARES[Math.min(spares(player), CAPACITY_BY_SPARES.length - 1)];
}

/** The noted bow string, read once the item definitions are loaded. */
function notedBowString() {
  notedBowStringId ??= core.ItemDefinition.forId(bowStringId).getNoteId();
  return notedBowStringId;
}

function sendVarbits(player) {
  player.getPacketSender().sendVarbit(Shared.varbitId("bowstring_spool_charges"), charges(player));
  player.getPacketSender().sendVarbit(Shared.varbitId("bowstring_spool_size"), spares(player));
}

function setCharges(player, value) {
  player.setAttribute(CHARGES_ATTRIBUTE, value);
  sendVarbits(player);
}

function carriesSpool(player) {
  return player.getInventory().contains(spoolId);
}

/** The spool as a source of bow strings for stringing, while it is carried. */
const SOURCE = {
  count: (player) => (carriesSpool(player) ? charges(player) : 0),
  take(player, amount) {
    if (!carriesSpool(player)) return 0;
    const taken = Math.min(amount, charges(player));
    if (taken > 0) setCharges(player, charges(player) - taken);
    return taken;
  },
};

function checkSpool({ player }) {
  player.sendMessage(`Your spool holds ${charges(player)} / ${capacity(player)} bow strings.`);
}

/** Moves bow strings and their notes from the inventory onto the spool, up to its capacity. */
function fill(player) {
  const inventory = player.getInventory();
  let room = capacity(player) - charges(player);
  if (room <= 0) {
    player.sendMessage("Your spool can't hold any more bow strings.");
    return;
  }
  let added = 0;
  for (const id of [bowStringId, notedBowString()]) {
    const moved = Math.min(room, inventory.getAmount(id));
    if (moved <= 0) continue;
    inventory.deleteNumber(id, moved);
    room -= moved;
    added += moved;
  }
  if (added <= 0) {
    player.sendMessage("You don't have any bow strings to add to the spool.");
    return;
  }
  setCharges(player, charges(player) + added);
  player.sendMessage(`You add ${added} bow string${added === 1 ? "" : "s"} to the spool. It now holds ${charges(player)}.`);
}

function fillSpool({ player }) {
  fill(player);
}

function withdraw(player, noted) {
  const inventory = player.getInventory();
  const stored = charges(player);
  if (stored <= 0) {
    player.sendMessage("Your spool is empty.");
    return;
  }
  const amount = noted
    ? stored
    : Math.min(stored, inventory.getFreeSlots());
  if (amount <= 0 || (noted && inventory.getFreeSlots() <= 0 && !inventory.contains(notedBowString()))) {
    player.sendMessage("You don't have enough inventory space.");
    return;
  }
  inventory.addItem(new core.Item(noted ? notedBowString() : bowStringId, amount));
  setCharges(player, stored - amount);
  player.sendMessage(`You take ${amount} bow string${amount === 1 ? "" : "s"} off the spool.`);
}

function emptySpool({ player }) {
  const { DialogueChainBuilder, OptionDialogue } = core;
  if (charges(player) <= 0) {
    player.sendMessage("Your spool is empty.");
    return;
  }
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        if (Number(option) === 1) withdraw(player, false);
        if (Number(option) === 2) withdraw(player, true);
      },
    }, "Take them as bow strings.", "Take them as notes.", "Cancel.").setTitle("Empty the spool?"),
  ));
}

function stringsOnSpool(event) {
  fill(event.player);
  event.handled = true;
}

/** A spare spool used on a spool raises its capacity, up to six spools. */
function combineSpools(event) {
  const { player } = event;
  event.handled = true;
  if (player.getInventory().getAmount(spoolId) < 2) return;
  if (spares(player) >= CAPACITY_BY_SPARES.length - 1) {
    player.sendMessage("Your spool can't be made any bigger.");
    return;
  }
  player.getInventory().deleteNumber(spoolId, 1);
  player.setAttribute(SPARES_ATTRIBUTE, spares(player) + 1);
  sendVarbits(player);
  player.sendMessage(`You combine the spools. Your spool can now hold ${capacity(player)} bow strings.`);
}

/** "crafting:spun" { player, itemId, amount }: spun bow strings go onto a carried spool. */
function absorbSpun(event) {
  const { player, itemId, amount } = event;
  if (itemId !== bowStringId || !carriesSpool(player)) return;
  const stored = Math.min(amount, capacity(player) - charges(player), player.getInventory().getAmount(bowStringId));
  if (stored <= 0) return;
  player.getInventory().deleteNumber(bowStringId, stored);
  setCharges(player, charges(player) + stored);
}

function login({ player }) {
  sendVarbits(player);
}

function init(api) {
  core = api.core;
  spoolId = Shared.itemId("BOW_STRING_SPOOL");
  bowStringId = Shared.itemId("BOW_STRING");
  Shared.registerVirtualMaterial(bowStringId, SOURCE);
  Shared.addTriggerAlias(spoolId, bowStringId);
}

function attach(api) {
  api.persistAttribute(CHARGES_ATTRIBUTE, 0);
  api.persistAttribute(SPARES_ATTRIBUTE, 0);
  api.onPlayerLogin(login);
  api.onItemAction("Bow string spool", { Fill: fillSpool, Check: checkSpool, Empty: emptySpool });
  api.onItemOnItem("Bow string", "Bow string spool", stringsOnSpool);
  api.onItemOnItem("Bow string spool", "Bow string spool", combineSpools, { noted: false });
  api.onCustomEvent("crafting:spun", absorbSpun);
}

module.exports = { init, attach, CAPACITY_BY_SPARES, CHARGES_ATTRIBUTE };
