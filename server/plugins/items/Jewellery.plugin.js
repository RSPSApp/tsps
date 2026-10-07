const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { TeleportHandler } = require("../../src/main/typescript/elvarg/game/model/teleportation/TeleportHandler");
const { TeleportType } = require("../../src/main/typescript/elvarg/game/model/teleportation/TeleportType");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { Wilderness } = require("../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Flag } = require("../../src/main/typescript/elvarg/game/model/Flag");
const { JEWELLERY, DEFAULT_WILDERNESS_LEVEL } = require("./jewellery/teleportJewellery");
const QuestRuntime = require("../quests/QuestRuntime");

/** Item param holding a worn item's first equipment option (RuneLite: OC_ITEM_OP1). */
const WORN_OPTION_PARAM = 451;
/** Equipment clicks: op 1 removes the item, op 2 onwards are the worn options. */
const FIRST_WORN_OPTION_CLICK = 2;
/** The chatbox prompt shows at most five options; longer lists page on the last one. */
const PROMPT_PAGE_SIZE = 5;
const CHARGE_COLOUR = "7F00FF";
const FOUNTAIN_OF_RUNE_CHARGES = 6;
const FOUNTAIN_OF_HEROES_CHARGES = 4;

/**
 * itemId -> { piece, charges }. Eternal pieces have Infinity charges; uncharged
 * rechargeable pieces have 0, so rubbing them explains they need recharging.
 */
const JEWELLERY_BY_ITEM = new Map();
for (const piece of JEWELLERY) {
  for (const [itemId, charges] of piece.charged) {
    JEWELLERY_BY_ITEM.set(itemId, { piece, charges });
  }
  for (const itemId of piece.eternal ?? []) {
    JEWELLERY_BY_ITEM.set(itemId, { piece, charges: Infinity });
  }
  if (piece.rechargeable && !JEWELLERY_BY_ITEM.has(piece.spent)) {
    JEWELLERY_BY_ITEM.set(piece.spent, { piece, charges: 0 });
  }
}

let pluginApi;
let BonusManager;

function nextItemId(piece, charges) {
  if (charges === 1) return piece.spent;
  return piece.charged.find(([, remaining]) => remaining === charges - 1)?.[0] ?? piece.spent;
}

function chargeMessage(piece, charges) {
  const unit = piece.unit ?? "charge";
  if (charges === Infinity) {
    return "No charges were used since it holds unlimited charges.";
  }
  if (charges === 1) {
    return piece.lastChargeMessage;
  }
  if (charges === 2) {
    return `Your ${piece.noun} has one ${unit} left.`;
  }
  return `Your ${piece.noun} has ${charges - 1} ${unit}s left.`;
}

/** The container (inventory or equipment) and slot still holding this exact item. */
function findItem(player, item) {
  for (const container of [player.getInventory(), player.getEquipment()]) {
    const slot = container.getItems().indexOf(item);
    if (slot >= 0) return { container, slot };
  }
  return null;
}

/** Uses one charge on arrival, swapping in the next item or crumbling the last one. */
function useCharge(player, item) {
  const entry = JEWELLERY_BY_ITEM.get(item.getId());
  if (!entry) return;
  const { piece, charges } = entry;
  player.sendMessage(`<col=${CHARGE_COLOUR}>${chargeMessage(piece, charges)}</col>`);
  if (charges === Infinity) return;
  const location = findItem(player, item);
  if (!location) return;
  const nextId = nextItemId(piece, charges);
  const equipped = location.container === player.getEquipment();
  if (nextId != null) {
    item.setId(nextId);
  } else if (equipped) {
    location.container.setItem(location.slot, new Item(-1, 0));
  } else {
    location.container.deleteAtSlot(location.slot, 1, false);
  }
  location.container.refreshItems();
  if (equipped) {
    BonusManager.update(player);
    player.getUpdateFlag().flag(Flag.APPEARANCE);
  }
}

function destinationTile(player, destination) {
  const tile = typeof destination.tile === "function" ? destination.tile(player) : destination.tile;
  return new Location(tile[0], tile[1], tile[2] ?? 0);
}

function teleport(player, item, destination) {
  const entry = JEWELLERY_BY_ITEM.get(item.getId());
  if (!entry || !findItem(player, item)) return;
  const { piece } = entry;
  // A spent/uncharged piece must never teleport for free, whatever menu path
  // reached here (Rub already checks, the worn/right-click options did not).
  if (entry.charges <= 0) {
    player.sendMessage(piece.emptyMessage);
    return;
  }
  const target = destinationTile(player, destination);
  if (!TeleportHandler.checkReqs(player, target, piece.wildernessLevel ?? DEFAULT_WILDERNESS_LEVEL)) {
    return;
  }
  TeleportHandler.teleport(player, target, TeleportType.NORMAL, false, () => useCharge(player, item));
}

/** Burning amulet destinations are all in the Wilderness, so ask first. */
function confirmAndTeleport(player, item, destination) {
  const entry = JEWELLERY_BY_ITEM.get(item.getId());
  if (!entry?.piece.confirmWilderness) {
    teleport(player, item, destination);
    return;
  }
  const target = destinationTile(player, destination);
  const level = Wilderness.levelAt(target.getX(), target.getY());
  pluginApi.sendMultiChatboxPrompt(
    player,
    `That's in level ${level} Wilderness.`,
    `Okay, teleport to level ${level} Wilderness.`,
    () => teleport(player, item, destination),
    "No.",
    () => {},
  );
}

/** Shows the destination list, paging with "More..." when it does not fit. */
function promptDestinations(player, item, destinations, includeNowhere) {
  const options = destinations.map((destination) => [destination.label, () => confirmAndTeleport(player, item, destination)]);
  if (includeNowhere) {
    options.push(["Nowhere", () => {}]);
  }
  let page = options;
  if (options.length > PROMPT_PAGE_SIZE) {
    const shown = options.slice(0, PROMPT_PAGE_SIZE - 1);
    const rest = destinations.slice(PROMPT_PAGE_SIZE - 1);
    page = [...shown, ["More...", () => promptDestinations(player, item, rest, includeNowhere)]];
  }
  pluginApi.sendMultiChatboxPrompt(player, "Where would you like to teleport to?", ...page.flat());
}

function rub(player, item) {
  const entry = JEWELLERY_BY_ITEM.get(item.getId());
  if (entry.charges <= 0) {
    player.sendMessage(entry.piece.emptyMessage);
    return;
  }
  if (entry.piece.rubMessage) {
    player.sendMessage(entry.piece.rubMessage);
  }
  const { destinations } = entry.piece;
  if (destinations.length === 1) {
    confirmAndTeleport(player, item, destinations[0]);
    return;
  }
  promptDestinations(player, item, destinations, destinations.length < PROMPT_PAGE_SIZE);
}

function normalise(text) {
  return String(text ?? "").toLowerCase().replace(/^teleport to /, "").trim();
}

function destinationNamed(piece, name) {
  const wanted = normalise(name);
  if (!wanted) return null;
  return piece.destinations.find((destination) =>
    [destination.label, ...(destination.aliases ?? [])].some((label) => normalise(label) === wanted)) ?? null;
}

/** The worn option the player clicked, read from the item's cache params. */
function wornOptionName(itemId, clickType) {
  const index = clickType - FIRST_WORN_OPTION_CLICK;
  if (index < 0) return null;
  return CacheDefinitions.getItem(itemId)?.params?.get?.(WORN_OPTION_PARAM + index) ?? null;
}

/**
 * Equipped teleports: match the clicked worn option by name, falling back to its
 * position when the cache names a destination differently.
 */
function equippedDestination(piece, event) {
  const name = event.option ?? wornOptionName(event.itemId, event.clickType);
  const named = destinationNamed(piece, name);
  if (named) return named;
  if (name && piece.teleportOptions?.some((option) => normalise(option) === normalise(name))) {
    return "rub";
  }
  return name ? null : piece.destinations[event.clickType - FIRST_WORN_OPTION_CLICK] ?? null;
}

/**
 * A Rub submenu entry that is an action rather than a destination (the slayer ring's Check,
 * Teleport, Master, Partner and Log). Master, Partner and Log aren't built yet.
 */
function subOp(player, item, entry, action) {
  if (action === "teleport") {
    rub(player, item);
  } else if (action === "check") {
    player.sendMessage(checkMessage(entry.piece, entry.charges));
  } else {
    player.sendMessage("Nothing interesting happens.");
  }
}

/** How many charges a piece has now (guessed wording). */
function checkMessage(piece, charges) {
  const unit = piece.unit ?? "charge";
  if (charges === Infinity) return `Your ${piece.noun} has unlimited ${unit}s.`;
  return `Your ${piece.noun} has ${charges} ${unit}${charges === 1 ? "" : "s"} left.`;
}

function handleJewelleryAction(event) {
  const entry = JEWELLERY_BY_ITEM.get(event.itemId);
  if (!entry || !event.item) return;
  const { player, item } = event;
  const { piece } = entry;
  const equipped = event.interfaceId === Equipment.INVENTORY_INTERFACE_ID;

  if (equipped) {
    const destination = equippedDestination(piece, event);
    if (!destination) return;
    event.handled = true;
    if (destination === "rub") rub(player, item);
    else confirmAndTeleport(player, item, destination);
    return;
  }

  if (Number.isInteger(event.subOpId) && piece.subOps) {
    event.handled = true;
    subOp(player, item, entry, piece.subOps[event.subOpId - 1]);
    return;
  }

  if (Number.isInteger(event.subOpId)) {
    const destination = piece.destinations[event.subOpId - 1];
    if (destination) {
      event.handled = true;
      confirmAndTeleport(player, item, destination);
    }
    return;
  }

  const option = normalise(event.option);
  const named = destinationNamed(piece, option);
  if (named) {
    event.handled = true;
    confirmAndTeleport(player, item, named);
    return;
  }
  if ((piece.teleportOptions ?? ["Rub"]).some((teleportOption) => normalise(teleportOption) === option)) {
    event.handled = true;
    rub(player, item);
  }
}

function questComplete(player, name) {
  return QuestRuntime.getRegisteredQuests().find((quest) => quest.name === name)?.isComplete(player) ?? false;
}

/**
 * Using jewellery on the Fountain of Rune (6 charges), the Fountain of Heroes
 * (glory only, 4 charges) or the Legends' Guild totem pole (skills necklace and
 * combat bracelet, 6 charges) recharges every applicable piece carried or worn.
 */
function rechargeAtFountain(event) {
  const { player } = event;
  const { ObjectIdentifiers, ItemIdentifiers } = pluginApi.core;
  const rune = [ObjectIdentifiers.FOUNTAIN_OF_RUNE, ObjectIdentifiers.FOUNTAIN_OF_RUNE_2].includes(event.objectId);
  const heroes = [ObjectIdentifiers.FOUNTAIN_OF_HEROES, ObjectIdentifiers.FOUNTAIN_OF_HEROES_2].includes(event.objectId);
  const totem = [
    ObjectIdentifiers.TOTEM_POLE_2, ObjectIdentifiers.TOTEM_POLE_3, ObjectIdentifiers.TOTEM_POLE_4,
    ObjectIdentifiers.TOTEM_POLE_5, ObjectIdentifiers.TOTEM_POLE_7,
  ].includes(event.objectId);
  const used = JEWELLERY_BY_ITEM.get(event.itemId);
  if ((!rune && !heroes && !totem) || !used?.piece.recharge || used.charges === Infinity) return;
  const fits = (piece) => {
    if (!piece.recharge || !questComplete(player, piece.recharge.quest)) return false;
    if (totem) return piece.recharge.totem === true;
    if (piece.recharge.totem) return false;
    return rune || piece.recharge.heroes;
  };
  event.handled = true;
  if (!fits(used.piece)) {
    player.sendMessage("Nothing interesting happens.");
    return;
  }
  const target = totem || rune ? FOUNTAIN_OF_RUNE_CHARGES : FOUNTAIN_OF_HEROES_CHARGES;
  let eternal = false;
  for (const container of [player.getInventory(), player.getEquipment()]) {
    for (const item of container.getItems()) {
      const entry = item ? JEWELLERY_BY_ITEM.get(item.getId()) : null;
      if (!entry || entry.charges === Infinity || entry.charges >= target || !fits(entry.piece)) continue;
      const chance = rune ? entry.piece.recharge.eternalChance : 0;
      if (chance && Math.random() < 1 / chance) {
        item.setId(ItemIdentifiers.AMULET_OF_ETERNAL_GLORY);
        eternal = true;
      } else {
        item.setId(entry.piece.charged.find(([, charges]) => charges === target)[0]);
      }
    }
    container.refreshItems();
  }
  BonusManager.update(player);
  player.getUpdateFlag().flag(Flag.APPEARANCE);
  player.sendMessage(
    eternal
      ? "The power of the fountain is transferred into an amulet of eternal glory. It will now have unlimited charges."
      : totem
        ? "The totem pole recharges your jewellery."
        : "You feel a power emanating from the fountain as it recharges your jewellery."
  );
}

module.exports = {
  name: "Jewellery",
  register(api) {
    pluginApi = api;
    BonusManager = api.getBonusManager();
    api.onItemAction(handleJewelleryAction);
    api.onItemOnObject(rechargeAtFountain, { noted: false });
  },
  _test: { JEWELLERY_BY_ITEM, chargeMessage, nextItemId, useCharge },
};
