const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { TeleportHandler } = require("../../src/main/typescript/elvarg/game/model/teleportation/TeleportHandler");
const { TeleportType } = require("../../src/main/typescript/elvarg/game/model/teleportation/TeleportType");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { Wilderness } = require("../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Flag } = require("../../src/main/typescript/elvarg/game/model/Flag");
const { JEWELLERY, RING_OF_WEALTH_DESTINATIONS, DEFAULT_WILDERNESS_LEVEL, LOCKED_DESTINATION_MESSAGE, DIGSITE_PENDANT_UNLOCKS, visitedKourend, destinationUnlockDone } = require("./Teleports.Jewellery");
const { castRechargeDragonstone } = require("./RechargeDragonstone.Jewellery");

/** Item param holding a worn item's first equipment option (RuneLite: OC_ITEM_OP1). */
const WORN_OPTION_PARAM = 451;
/** Equipment clicks: op 1 removes the item, op 2 onwards are the worn options. */
const FIRST_WORN_OPTION_CLICK = 2;
/** The chatbox prompt shows at most five options; longer lists page on the last one. */
const PROMPT_PAGE_SIZE = 5;
const CHARGE_COLOUR = "7f007f";
// Charges left are spelled out: "Your ring of dueling has seven uses left." (rsprox captures).
const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

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
  const left = charges - 1;
  const count = piece.digits ? left : COUNT_WORDS[left] ?? left;
  return `Your ${piece.noun} has ${count} ${unit}s left.`;
}

/**
 * The container (inventory or equipment) and slot holding the item: this exact object, or
 * else a carried item with the id it had (moving it between the inventory and equipment
 * mid-teleport can replace the object).
 */
function findItem(player, item, itemId = item.getId()) {
  const containers = [player.getInventory(), player.getEquipment()];
  for (const container of containers) {
    const slot = container.getItems().indexOf(item);
    if (slot >= 0) return { container, slot, item };
  }
  for (const container of containers) {
    const slot = container.getItems().findIndex((other) => other?.getId() === itemId);
    if (slot >= 0) return { container, slot, item: container.getItems()[slot] };
  }
  return null;
}

/**
 * Uses one charge on arrival, swapping in the next item or crumbling the last one. `castId`
 * is the item's id when the teleport started.
 */
function useCharge(player, item, castId = item.getId()) {
  const location = findItem(player, item, castId);
  const entry = location ? JEWELLERY_BY_ITEM.get(location.item.getId()) : null;
  if (!entry || entry.charges <= 0) return;
  const { piece, charges } = entry;
  player.sendMessage(`<col=${CHARGE_COLOUR}>${chargeMessage(piece, charges)}</col>`);
  if (charges === Infinity) return;
  const nextId = nextItemId(piece, charges);
  const equipped = location.container === player.getEquipment();
  if (nextId != null) {
    location.item.setId(nextId);
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
  const tile = typeof destination.tile === "function" ? destination.tile(player, pluginApi) : destination.tile;
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
  if (destination.colosseumRank && !colosseumRankReached(player, destination.colosseumRank)) {
    statement(player, destination.lockedMessage);
    return;
  }
  // The refusal for a Kourend destination before Veos's trip is ours: the Wiki gives none.
  if ((destination.quest && !questComplete(player, destination.quest.key)) || (destination.kourend && !visitedKourend(player))
      || !destinationUnlockDone(player, destination)) {
    statement(player, LOCKED_DESTINATION_MESSAGE);
    return;
  }
  const target = destinationTile(player, destination);
  const wildernessLevel = piece.wildernessLevel ?? DEFAULT_WILDERNESS_LEVEL;
  if (!TeleportHandler.checkReqs(player, target, wildernessLevel)) {
    return;
  }
  const castId = item.getId();
  TeleportHandler.confirm(player, target, (carried) => TeleportHandler.teleport(player, target, TeleportType.NORMAL, false, () => {
    useCharge(player, carried, castId);
    pluginApi.emitCustomEvent("jewellery:teleport-arrival", { player, key: piece.key, label: destination.label });
  }), wildernessLevel, { item });
}

function questComplete(player, key) {
  const query = { player, key, complete: false };
  pluginApi.emitCustomEvent("quest:is-complete", query);
  return query.complete === true;
}

/** Whether the player has reached a Fortis Colosseum Glory title (the Colosseum plugin answers). */
function colosseumRankReached(player, rank) {
  const request = { player, rank, reached: false };
  pluginApi.emitCustomEvent("colosseum:has-rank", request);
  return request.reached === true;
}

function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = pluginApi.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
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
  const piece = JEWELLERY_BY_ITEM.get(item.getId())?.piece;
  // `menu` / `nowhereMenu`: the Rub menu's own text where the game words it differently from the label.
  const options = destinations.map((destination) => [destination.menu ?? destination.label, () => confirmAndTeleport(player, item, destination)]);
  if (includeNowhere) {
    options.push([piece?.nowhereMenu ?? "Nowhere", () => {}]);
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

/** Whether the click that reached here was the piece's Rub option, which rubs before a teleport. */
function rubbedOption(event, equipped) {
  const name = event.option ?? (equipped ? wornOptionName(event.itemId, event.clickType) : null);
  return normalise(name) === "rub";
}

/**
 * A submenu row, named by the option it was clicked under: the core resolves it from the cache
 * (PluginManager.itemActionSubOption, on the event as `subOption`), the inventory's own rows
 * from `subops` and a worn item's from its params. A row belongs to its option, so the slayer
 * ring's Teleport rows are destinations while its Rub rows are actions (Contact Master,
 * Partner, Open Log) — and a dueling ring's Rub rows are destinations. Reading the row's own
 * label keeps those apart: indexing one flat list with `subOpId` alone sent
 * Teleport > Slayer Tower into Rub's destination prompt (#6870).
 */
function submenuRow(event, entry, equipped) {
  const { player, item } = event;
  const { piece } = entry;
  const destination = destinationNamed(piece, event.subOption);
  if (destination) {
    // A Rub row rubs the piece first, as Rub does (rsprox 723, 3170); a Teleport row does not.
    if (piece.rubMessage && entry.charges > 0 && rubbedOption(event, equipped)) {
      player.sendMessage(piece.rubMessage);
    }
    confirmAndTeleport(player, item, destination);
    return true;
  }
  // Rub's rows here are actions (the cache's Contact Master, Partner, Open Log). None is built
  // yet (docs/slayer.md); answering the row keeps it from falling through to Rub's own
  // destination list, as the slayer helmet's Partner and Log do.
  return piece.actionRows?.includes(event.subOption) === true;
}

function handleJewelleryAction(event) {
  const entry = JEWELLERY_BY_ITEM.get(event.itemId);
  if (!entry || !event.item) return;
  const { player, item } = event;
  const { piece } = entry;
  const equipped = event.interfaceId === Equipment.INVENTORY_INTERFACE_ID;

  // A submenu row is answered by the option it sits under, never by its position in a list.
  if (event.subOption) {
    if (submenuRow(event, entry, equipped)) event.handled = true;
    return;
  }

  if (equipped) {
    const destination = equippedDestination(piece, event);
    if (!destination) return;
    event.handled = true;
    if (destination === "rub") rub(player, item);
    else confirmAndTeleport(player, item, destination);
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

/** Wiki (Transcript:Strange Machine): the line, in an item box with the pendant, for a Digsite pendant used on it. */
const MACHINE_BIND_LINE = "The necklace glows brightly. It seems to bind its magic to this place.";

/**
 * The Lithkren bind's varbit: rsprox_transcripts/227/910484.txt:406913 and 227/910630.txt:48595 send it 0 -> 1 with
 * the line; the Fossil Island binds (227/01843.txt:169569, 227/910263.txt:88218) send no varbit.
 */
const LITHKREN_REDIRECT_VARBIT = "lithkren_ruby_necklace_redirect";

function sendLithkrenRedirect(player) {
  const id = CacheDefinitions.getVarbitId(LITHKREN_REDIRECT_VARBIT);
  if (id == null || id < 0) return;
  player.getPacketSender().sendVarbit(id, player.getAttribute(DIGSITE_PENDANT_UNLOCKS.lithkren_necklace_enchanter) === true ? 1 : 0);
}

/**
 * A Digsite pendant (any charge) used on the House on the Hill's or the Lithkren Vault's Strange Machine binds that
 * destination for the player, and (Wiki: Digsite pendant) "Each teleport option can be unbound by using a pendant on
 * the machine again". All four recorded binds show the (5) pendant in the item box whichever pendant was used
 * (227/01843.txt:169542 with a (4), 227/910484.txt with a (3)). Ours: no charge is used, the Lithkren teleport still
 * needs Dragon Slayer II, and the unbind shows the same line: no unbind wording is recorded or on the Wiki.
 */
function pendantOnMachine(event) {
  if (event.handled || JEWELLERY_BY_ITEM.get(event.itemId)?.piece.key !== "digsite") return;
  const name = Object.keys(DIGSITE_PENDANT_UNLOCKS).find((gameval) => CacheDefinitions.getLocId(gameval) === event.objectId);
  if (!name) return;
  event.handled = true;
  const { player } = event;
  const key = DIGSITE_PENDANT_UNLOCKS[name];
  player.setAttribute(key, player.getAttribute(key) !== true);
  if (name === "lithkren_necklace_enchanter") sendLithkrenRedirect(player);
  const { DialogueChainBuilder, ItemStatementDialogue, ItemIdentifiers } = pluginApi.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new ItemStatementDialogue(0, ItemIdentifiers.DIGSITE_PENDANT_5_, MACHINE_BIND_LINE)));
}

/** Login resends a bound Lithkren's varbit (a fresh client starts at 0). */
function resendLithkrenRedirect({ player }) {
  if (player?.getAttribute(DIGSITE_PENDANT_UNLOCKS.lithkren_necklace_enchanter) === true) sendLithkrenRedirect(player);
}

function describeTeleports({ player, list }) {
  const { core } = pluginApi;
  // Publish the native source catalogue without making consumers import gameplay modules.
  for (const piece of [...JEWELLERY.filter(piece => !piece.destinationsFrom), { key: "wealth", noun: "Ring of wealth", destinations: RING_OF_WEALTH_DESTINATIONS }]) {
    const label = piece.key === "glory" ? "Amulet of glory" : String(piece.noun).replace(/[-_]/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
    for (const destination of piece.destinations) {
      const resolve = typeof destination.tile === "function" ? target => destination.tile(target, pluginApi) : undefined;
      list.push({path: ["Jewellery", label], key: destination.label, name: destination.label,
        tile: resolve ? resolve(player) : [...destination.tile], resolve});
    }
  }
  for (const piece of JEWELLERY) {
    const ids = [...(piece.destinationsFrom ? [piece.charged[0][0]] : []), ...(piece.eternal ?? [])];
    for (const id of ids) {
      const source = core.CacheDefinitions.getItem(id)?.name?.replace(/\s*\(t\d+\)/i, " (t)").replace(/\(\d+\)/g, "").trim();
      if (!source) continue;
      for (const destination of piece.destinations) {
        const resolve = typeof destination.tile === "function" ? target => destination.tile(target, pluginApi) : undefined;
        list.push({ path: ["Jewellery", source], key: destination.label, name: destination.label,
          tile: resolve ? resolve(player) : [...destination.tile], resolve });
      }
    }
  }
}

module.exports = {
  name: "Jewellery",
  description: "Runs charged and eternal jewellery such as dueling rings, games necklaces and glories: Rub and worn-option teleports, charge counts and Check messages.",
  members: true,
  register(api) {
    pluginApi = api;
    api.onCustomEvent("adminpanel:teleport-destinations", describeTeleports);
    BonusManager = api.getBonusManager();
    api.onItemAction(handleJewelleryAction);
    for (const key of Object.values(DIGSITE_PENDANT_UNLOCKS)) api.persistAttribute(key, false);
    api.onItemOnObject(pendantOnMachine);
    api.onPlayerLogin(resendLithkrenRedirect);
    require("./JewelleryPlaceholders")(api, JEWELLERY.map(piece => piece.charged.map(([id]) => id)));
    require("./Recharge.Jewellery")(api);
    api.onSpellCast(castRechargeDragonstone.bind(null, api));
  },
  _test: { describeTeleports, JEWELLERY_BY_ITEM, chargeMessage, nextItemId, useCharge, MACHINE_BIND_LINE },
};
