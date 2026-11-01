/**
 * Chronicle: https://oldschool.runescape.wiki/w/Chronicle (messages from Transcript:Chronicle).
 *
 * Teleports just outside the Champions' Guild for one charge. Teleport cards charge it, up to
 * 1,000, and noted cards can't. Charges belong to the player, as a lost book "retains its charges
 * if bought back".
 *
 * rsprox 3203 (rev 232): every card in the inventory charges at once, the standard teleport plays
 * (714, spotanim 111), and the charges left show in red on landing. The landing is any free tile
 * in the Wiki's 2-tile square on (3201,3355); it landed on (3202,3355) and (3199,3356). "The book's powers
 * do not work in the Wilderness." and "Your book has N charges left." are also from that capture;
 * where it disagrees with the Wiki's "You have N charges left in your book." on landing, it wins.
 */
const MAX_CHARGES = 1000;
const CHARGES_ATTRIBUTE = "chronicle:charges";
const LANDING_CENTRE = { x: 3201, y: 3355 };
const LANDING_RADIUS = 2;
const LANDING_ATTEMPTS = 16;
const LANDING_COLOUR = "ef1020";

let core;

function charges(player) {
  const saved = Number(player.getAttribute(CHARGES_ATTRIBUTE));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

function format(amount) {
  return amount.toLocaleString("en-US");
}

function chargeWithCards({ player }) {
  const before = charges(player);
  if (before >= MAX_CHARGES) {
    player.sendMessage(`Your book is fully charged! It has ${format(MAX_CHARGES)} charges already.`);
    return true;
  }
  const inventory = player.getInventory();
  const added = Math.min(inventory.getAmount(core.ItemIdentifiers.TELEPORT_CARD), MAX_CHARGES - before);
  if (added <= 0) return true;
  inventory.deleteNumber(core.ItemIdentifiers.TELEPORT_CARD, added);
  player.setAttribute(CHARGES_ATTRIBUTE, before + added);
  inventory.refreshItems();
  if (added > 1) {
    player.sendMessage(`You add ${format(added)} charges to your book. It now has ${format(before + added)} charges.`);
  } else if (before === 0) {
    player.sendMessage("You add a single charge to your book. It now has one charge.");
  } else {
    player.sendMessage(`You add a single charge to your book. It now has ${format(before + added)} charges.`);
  }
  return true;
}

function checkCharges({ player }) {
  const left = charges(player);
  if (left === 0) player.sendMessage("Your book has run out of charges.");
  else if (left === 1) player.sendMessage("You have one charge left in your book.");
  else player.sendMessage(`Your book has ${format(left)} charges left.`);
  return true;
}

function landingMessage(left) {
  if (left === 0) return "Your book has run out of charges.";
  if (left === 1) return "You have one charge left in your book.";
  return `Your book has ${format(left)} charges left.`;
}

/** The charge goes on landing, like the other charged teleports (RingOfElements, Jewellery). */
function land(player) {
  const left = Math.max(0, charges(player) - 1);
  player.setAttribute(CHARGES_ATTRIBUTE, left);
  player.sendMessage(`<col=${LANDING_COLOUR}>${landingMessage(left)}</col>`);
}

function landingTile() {
  const { Location, Misc, RegionManager } = core;
  for (let attempt = 0; attempt < LANDING_ATTEMPTS; attempt++) {
    const dx = Misc.getRandom(LANDING_RADIUS * 2) - LANDING_RADIUS;
    const dy = Misc.getRandom(LANDING_RADIUS * 2) - LANDING_RADIUS;
    const tile = new Location(LANDING_CENTRE.x + dx, LANDING_CENTRE.y + dy, 0);
    if (!RegionManager.blocked(tile, null)) return tile;
  }
  return new Location(LANDING_CENTRE.x, LANDING_CENTRE.y, 0);
}

function teleport({ player }) {
  const { TeleportHandler, TeleportType, Wilderness } = core;
  if (Wilderness.isIn(player)) {
    player.sendMessage("The book's powers do not work in the Wilderness.");
    return true;
  }
  if (charges(player) <= 0) {
    player.sendMessage("Your book does not have any charges. Purchase some Teleport Cards from Diango.");
    return true;
  }
  const destination = landingTile();
  if (TeleportHandler.checkReqs(player, destination)) {
    TeleportHandler.teleport(player, destination, TeleportType.NORMAL, false, () => land(player));
  }
  return true;
}

module.exports = {
  name: "Chronicle",
  _test: { MAX_CHARGES, CHARGES_ATTRIBUTE, LANDING_CENTRE, LANDING_RADIUS, charges, chargeWithCards, checkCharges, teleport },
  register(api) {
    core = api.core;
    api.persistAttribute(CHARGES_ATTRIBUTE, 0);
    api.onItemAction("Chronicle", { Teleport: teleport, "Check charges": checkCharges, "Check Charges": checkCharges });
    api.onItemOnItem("Teleport card", "Chronicle", chargeWithCards, { noted: false });
  },
};
