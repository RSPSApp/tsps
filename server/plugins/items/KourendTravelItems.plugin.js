/**
 * Kharedst's memoirs and Xeric's talisman teleports.
 *
 * Sources:
 * - Wiki Kharedst's Memoirs: Reminisce teleports to each page's city, one charge per
 *   teleport, 20 charges per page, five city pages, level 20 Wilderness limit; worn options
 *   are the five page names and Check.
 *   https://oldschool.runescape.wiki/w/Kharedst%27s_memoirs
 * - Wiki Xeric's talisman: Rub opens Lookout, Glade, Inferno, Heart and Honour (Honour needs an
 *   ancient tablet); worn options are those destinations and Check; one charge per teleport,
 *   one lizardman fang per charge, 1,000 maximum.
 *   https://oldschool.runescape.wiki/w/Xeric%27s_talisman
 * - Wiki Transcript:Xeric's talisman for the Check, charging and uncharging lines.
 * - City and destination tiles: RuneLite TeleportLocationData.
 * - Cache: item gamevals and the kourend_diary_* teleport varbits (7917-7921).
 */
const MEMOIRS_ID = 21760;
const XERIC_TALISMAN_ID = 13393;
const XERIC_TALISMAN_INERT_ID = 13392;
const MEMOIRS_CHARGES_ATTRIBUTE = "kharedst-memoirs:charges";
const MEMOIRS_CHARGED_PAGES_ATTRIBUTE = "kharedst-memoirs:charged-pages";
const XERIC_CHARGES_META = "xerics-talisman:charges";
const MEMOIRS_PAGES_ATTRIBUTE = "kharedst-memoirs:added-pages";
const MEMOIRS_MAX_CHARGES = 100;
const XERIC_MAX_CHARGES = 1000;
const WILDERNESS_LEVEL = 20;
const PROMPT = "Where would you like to teleport to?";
const WORN_OPTION_PARAM = 451;
const FIRST_WORN_OPTION_CLICK = 2;

/**
 * The five memoir pages. Three pages are added here because their quests reward the page but
 * never wire it onto the book; Hosidius and Arceuus are owned by their quest plugins.
 */
const MEMOIRS_PAGES = [
  { key: "hosidius", label: "Lunch by the Lancalliums", itemId: 21762, varbit: "kourend_diary_hos_teleport", tile: [1713, 3612, 0], own: false },
  { key: "piscarilius", label: "The Fisher's Flute", itemId: 21764, varbit: "kourend_diary_pisc_teleport", tile: [1802, 3748, 0], own: true },
  { key: "shayzien", label: "History and Hearsay", itemId: 21766, varbit: "kourend_diary_shay_teleport", tile: [1478, 3576, 0], own: true },
  { key: "lovakengj", label: "Jewellery of Jubilation", itemId: 21768, varbit: "kourend_diary_lova_teleport", tile: [1544, 3762, 0], own: true },
  { key: "arceuus", label: "A Dark Disposition", itemId: 21770, varbit: "kourend_diary_arc_teleport", tile: [1680, 3746, 0], own: false },
];
const PAGE_BY_ITEM = new Map(MEMOIRS_PAGES.map((page) => [page.itemId, page]));
const PAGE_BY_LABEL = new Map(MEMOIRS_PAGES.map((page) => [normalise(page.label), page]));
const OWN_PAGES = MEMOIRS_PAGES.filter((page) => page.own);

/** RuneLite TeleportLocationData: Kharedst's Memoirs and Xeric's Talisman destinations. */
const XERIC_DESTINATIONS = [
  { key: "lookout", label: "Xeric's Lookout", tile: [1576, 3528, 0] },
  { key: "glade", label: "Xeric's Glade", tile: [1754, 3564, 0] },
  { key: "inferno", label: "Xeric's Inferno", tile: [1504, 3819, 0] },
  { key: "heart", label: "Xeric's Heart", tile: [1641, 3670, 0] },
  { key: "honour", label: "Xeric's Honour", tile: [1254, 3559, 0], needsHonour: true },
];
const XERIC_BY_LABEL = new Map(XERIC_DESTINATIONS.map((destination) => [normalise(destination.label), destination]));

let api = null;
let core = null;
let xericTeleport = null;

function normalise(text) {
  return String(text ?? "").toLowerCase().trim();
}

function varbit(name) {
  return core.CacheDefinitions.getVarbitId(name);
}

function pageRecord(player) {
  return player.getAttribute(MEMOIRS_PAGES_ATTRIBUTE) ?? {};
}

function memoirPageUnlocked(player, page) {
  const id = varbit(page.varbit);
  if (id != null && (player.getPacketSender().getVarbit?.(id) ?? 0) !== 0) return true;
  return page.own && pageRecord(player)[page.key] === true;
}

function unlockedCities(player) {
  return MEMOIRS_PAGES.filter((page) => memoirPageUnlocked(player, page));
}

function memoirsItem(event) {
  return event.usedItemId === MEMOIRS_ID ? event.usedItem : event.usedWithItem;
}

function memoirCharges(player, _item) {
  const saved = Number(player.getAttribute(MEMOIRS_CHARGES_ATTRIBUTE));
  const pages = unlockedCities(player).length;
  if (!Number.isFinite(saved) || saved < 0) return pages * 20;
  // Quest-owned page handlers only set their varbit; grant their new capacity once.
  const chargedPages = Number(player.getAttribute(MEMOIRS_CHARGED_PAGES_ATTRIBUTE) ?? pages);
  return Math.min(MEMOIRS_MAX_CHARGES, saved + Math.max(0, pages - chargedPages) * 20);
}

function setMemoirCharges(player, item, amount) {
  const charges = Math.max(0, Math.min(MEMOIRS_MAX_CHARGES, amount));
  player.setAttribute(MEMOIRS_CHARGES_ATTRIBUTE, charges);
  player.setAttribute(MEMOIRS_CHARGED_PAGES_ATTRIBUTE, unlockedCities(player).length);
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  return charges;
}

function teleport(player, item, page) {
  if (!memoirPageUnlocked(player, page)) return false;
  const charges = memoirCharges(player, item);
  if (charges <= 0) {
    player.sendMessage("Your book has no charges.");
    return false;
  }
  const target = new core.Location(...page.tile);
  if (!core.TeleportHandler.checkReqs(player, target, WILDERNESS_LEVEL)) return false;
  setMemoirCharges(player, item, charges - 1);
  core.TeleportHandler.teleport(player, target, core.TeleportType.NORMAL, false, () => {
    api.emitCustomEvent("kharedst:teleported", { player, city: page.key });
  });
  return true;
}

function chooseCity(player, item) {
  const cities = unlockedCities(player);
  if (!cities.length) return;
  api.sendMultiChatboxPrompt(player, PROMPT,
    ...cities.flatMap((city) => [city.label, () => teleport(player, item, city)]));
}

function wornOptionName(itemId, clickType) {
  const index = clickType - FIRST_WORN_OPTION_CLICK;
  if (index < 0) return null;
  return core.CacheDefinitions.getItem(itemId)?.params?.get?.(WORN_OPTION_PARAM + index) ?? null;
}

function memoirsAction(event) {
  const { player, item } = event;
  if (!item) return;
  const equipped = event.interfaceId === core.Equipment.INVENTORY_INTERFACE_ID;
  const option = normalise(event.option ?? (equipped ? wornOptionName(event.itemId, event.clickType) : null));
  if (!option) return;
  const page = PAGE_BY_LABEL.get(option);
  if (page) {
    event.handled = true;
    teleport(player, item, page);
    return;
  }
  if (option === "reminisce") {
    event.handled = true;
    chooseCity(player, item);
  }
}

/** These pages are rewarded by their quests but have no quest-owned attachment handler. */
function addPage(event) {
  if (event.handled) return;
  const { player, usedItemId, usedWithItemId } = event;
  const pair = new Set([usedItemId, usedWithItemId]);
  if (!pair.has(MEMOIRS_ID)) return;
  const page = PAGE_BY_ITEM.get(usedItemId) ?? PAGE_BY_ITEM.get(usedWithItemId);
  if (!page?.own || memoirPageUnlocked(player, page)) return;
  const item = memoirsItem(event);
  if (!item) return;
  event.handled = true;
  const current = memoirCharges(player, item);
  player.getInventory().deleteNumber(page.itemId, 1);
  player.setAttribute(MEMOIRS_PAGES_ATTRIBUTE, { ...pageRecord(player), [page.key]: true });
  const id = varbit(page.varbit);
  if (id != null) player.getPacketSender().sendVarbit(id, 1);
  setMemoirCharges(player, item, current + 20);
  player.sendMessage("You add an entry to Kharedst's Memoirs.");
}

function syncPages({ player }) {
  const pages = pageRecord(player);
  for (const page of OWN_PAGES) {
    if (pages[page.key] !== true) continue;
    const id = varbit(page.varbit);
    if (id != null) player.getPacketSender().sendVarbit(id, 1);
  }
}

function xericCharges(item) {
  return Math.max(0, Math.min(XERIC_MAX_CHARGES, Math.trunc(Number(item.getMetaValue(XERIC_CHARGES_META)) || 0)));
}

function setXericCharges(player, item, amount) {
  const charges = Math.max(0, Math.min(XERIC_MAX_CHARGES, amount));
  item.setMetaValue(XERIC_CHARGES_META, charges > 0 ? charges : undefined);
  item.setId(charges > 0 ? XERIC_TALISMAN_ID : XERIC_TALISMAN_INERT_ID);
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  return charges;
}

function xericTeleportType() {
  if (xericTeleport) return xericTeleport;
  const { Animation, Graphic, Priority, TeleportType } = core;
  xericTeleport = new TeleportType(3,
    new Animation(core.CacheDefinitions.getSeqId("arceuus_necromancy_anim"), Priority.HIGH),
    null, Animation.DEFAULT_RESET_ANIMATION,
    new Graphic(core.CacheDefinitions.getSpotanimId("xeric_teleport_spotanim"), Priority.HIGH),
    null, null);
  return xericTeleport;
}

function talismanDestination(_player, name) {
  const destination = XERIC_BY_LABEL.get(normalise(name));
  // The ancient tablet unlock for Honour is not implemented, so Honour stays unavailable.
  return destination && !destination.needsHonour ? destination : null;
}

function teleportWithTalisman(player, item, destination) {
  const charges = xericCharges(item);
  if (charges <= 0) {
    player.sendMessage("The talisman has no charges.");
    return false;
  }
  const target = new core.Location(...destination.tile);
  if (!core.TeleportHandler.checkReqs(player, target, WILDERNESS_LEVEL)) return false;
  // Spend before starting: Uncharge or equipping during the animation can move/change the item.
  setXericCharges(player, item, charges - 1);
  core.TeleportHandler.teleport(player, target, xericTeleportType(), false, () => {
    api.emitCustomEvent("xerics-talisman:teleported", { player, destination: destination.key });
  });
  return true;
}

function chooseTalismanDestination(player, item) {
  const destinations = XERIC_DESTINATIONS.filter((destination) => !destination.needsHonour);
  api.sendMultiChatboxPrompt(player, PROMPT,
    ...destinations.flatMap((destination) => [destination.label, () => teleportWithTalisman(player, item, destination)]));
}

function checkTalisman(player, item) {
  const charges = xericCharges(item);
  player.sendMessage(charges === 0 ? "The talisman has no charges."
    : charges === 1 ? "The talisman has one charge."
      : `The talisman has ${charges} charges.`);
}

function unchargeTalisman(player, item) {
  const charges = xericCharges(item);
  if (charges <= 0) return;
  const inventory = player.getInventory();
  const refund = new core.Item(core.ItemIdentifiers.LIZARDMAN_FANG, charges);
  const accepted = inventory.getAddableAmount(refund);
  if (accepted <= 0) {
    player.sendMessage("You need a free inventory slot to uncharge your talisman.");
    return;
  }
  inventory.addItem(new core.Item(core.ItemIdentifiers.LIZARDMAN_FANG, accepted));
  setXericCharges(player, item, charges - accepted);
  player.sendMessage(accepted === 1 ? "You remove a lizard fang from your talisman."
    : `You remove ${accepted} lizard fangs from your talisman.`);
}

function chargeTalisman(event) {
  if (event.handled) return;
  const pair = new Set([event.usedItemId, event.usedWithItemId]);
  if (!pair.has(core.ItemIdentifiers.LIZARDMAN_FANG)) return;
  const item = [event.usedItem, event.usedWithItem].find((entry) =>
    entry?.getId?.() === XERIC_TALISMAN_ID || entry?.getId?.() === XERIC_TALISMAN_INERT_ID);
  if (!item) return;
  event.handled = true;
  const { player } = event;
  const charges = xericCharges(item);
  if (charges >= XERIC_MAX_CHARGES) {
    player.sendMessage("The talisman is full.");
    return;
  }
  const fangs = player.getInventory().getAmount(core.ItemIdentifiers.LIZARDMAN_FANG);
  const used = Math.min(fangs, XERIC_MAX_CHARGES - charges);
  if (used <= 0) return;
  player.getInventory().deleteNumber(core.ItemIdentifiers.LIZARDMAN_FANG, used);
  const total = setXericCharges(player, item, charges + used);
  player.sendMessage(total >= XERIC_MAX_CHARGES ? "The talisman is full." : `Your talisman now has ${total} charges.`);
}

function talismanAction(event) {
  const { player, item } = event;
  if (!item || event.itemId !== XERIC_TALISMAN_ID) return;
  const equipped = event.interfaceId === core.Equipment.INVENTORY_INTERFACE_ID;
  const option = normalise(event.option ?? (equipped ? wornOptionName(event.itemId, event.clickType) : null));
  if (!option) return;
  if (option === "check") {
    event.handled = true;
    checkTalisman(player, item);
    return;
  }
  if (option === "uncharge") {
    event.handled = true;
    unchargeTalisman(player, item);
    return;
  }
  if (option === "rub") {
    event.handled = true;
    chooseTalismanDestination(player, item);
    return;
  }
  const destination = talismanDestination(player, option);
  if (destination) {
    event.handled = true;
    teleportWithTalisman(player, item, destination);
  }
}

function onItemAction(event) {
  if (event.itemId === MEMOIRS_ID) memoirsAction(event);
  else if (event.itemId === XERIC_TALISMAN_ID) talismanAction(event);
}

module.exports = {
  name: "KourendTravelItems",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.persistAttribute(MEMOIRS_CHARGES_ATTRIBUTE, -1);
    api.persistAttribute(MEMOIRS_CHARGED_PAGES_ATTRIBUTE, 0);
    api.persistAttribute(MEMOIRS_PAGES_ATTRIBUTE, {});
    api.onItemAction(onItemAction);
    api.onItemOnItem(addPage, { noted: false });
    api.onItemOnItem(chargeTalisman, { noted: false });
    api.onPlayerLogin(syncPages);
  },
  _test: {
    MEMOIRS_PAGES, XERIC_DESTINATIONS, MEMOIRS_ID, XERIC_TALISMAN_ID, XERIC_TALISMAN_INERT_ID,
    memoirCharges, setMemoirCharges, memoirPageUnlocked, unlockedCities, teleport, chooseCity,
    memoirsAction, addPage, xericCharges, setXericCharges, teleportWithTalisman, talismanAction,
    chooseTalismanDestination, chargeTalisman, checkTalisman, unchargeTalisman, talismanDestination,
  },
};
