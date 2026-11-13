/**
 * Kharedst's memoirs and Xeric's talisman teleports.
 *
 * Sources:
 * - Wiki Kharedst's Memoirs: Reminisce teleports to each page's city, one charge per
 *   teleport, 20 charges per page, five city pages, level 20 Wilderness limit; worn options
 *   are the five page names and Check.
 *   https://oldschool.runescape.wiki/w/Kharedst%27s_memoirs
 * - Wiki Book of the Dead (A Kingdom Divided): "offers the same teleports" as the memoirs, worn options the same
 *   five pages and Check, up to 250 charges, level 20 Wilderness limit. It shares the memoirs' charges here.
 *   https://oldschool.runescape.wiki/w/Book_of_the_Dead
 * - Wiki Xeric's talisman: Rub opens Lookout, Glade, Inferno, Heart and Honour (Honour needs an
 *   ancient tablet); worn options are those destinations and Check; one charge per teleport,
 *   one lizardman fang per charge, 1,000 maximum.
 *   https://oldschool.runescape.wiki/w/Xeric%27s_talisman
 * - Wiki Transcript:Xeric's talisman for the Check, charging and uncharging lines.
 * - rsprox captures: the Rub and Reminisce submenu entries (cache subops, in destination order)
 *   teleport straight to that destination (talisman 726, 3942; Book of the Dead 363, 3150).
 * - City and destination tiles: RuneLite TeleportLocationData.
 * - Cache: item gamevals and the kourend_diary_* teleport varbits (7917-7921).
 * - rsprox capture 363 (Book of the Dead): Check opens the objectbox with the book and its
 *   "memories remain" line (ticks 37, 3595); Read plays human_readbook and opens book 392 with
 *   every entry attached (ticks 494-507, also recordings 1441, 603, 3792).
 * - User capture 20261111T231757-5ab63b4 (rev 242, Kharedst's memoirs, no page attached, no charge):
 *   Read opens "Kharedst's Memoirs", where each missing entry is one page of its heading and red
 *   "This entry seems to be missing." lines; Reminisce's entries open the messagebox
 *   "Kharedst's Memoirs holds no charge.". The pages are in data/kharedsts-memoirs-pages.json.
 * - Ours: the Book of the Dead's no-charge line names that book; it always reads in full, with Tread
 *   Carefully, which the memoirs leave out (no capture reads fully attached memoirs).
 */
const { openBook } = require("../quests/QuestRuntime");
const BOOK = require("./data/kharedsts-memoirs-pages.json");
const MEMOIRS_ID = 21760;
const BOOK_OF_THE_DEAD_ID = 25818;
const BOOK_OF_THE_DEAD_MAX_CHARGES = 250;
const XERIC_TALISMAN_ID = 13393;
const XERIC_TALISMAN_INERT_ID = 13392;
/** raids_spellunlock_tablet, the Chambers of Xeric chest's ancient tablet. */
const ANCIENT_TABLET_ID = 21046;
/** Saved: an ancient tablet has been used on a talisman, worn or mounted (Wiki: Ancient tablet). */
const HONOUR_UNLOCKED_ATTRIBUTE = "xerics-talisman:honour-unlocked";
/** Wiki (Ancient tablet): using it on a talisman, and Inspect. */
const TABLET_USED_MESSAGE = "As the talisman and tablet are held together, a surge of power connects the two. After a brief moment, the tablet crumbles, and the talisman feels somehow different.";
const TABLET_INSPECT_MESSAGE = "You inspect the tablet, and sense a magical power, running your fingers over the inscriptions, they tingle as you get a feel for Xeric's power. He must have stored one of his best spells in this tablet, perhaps he has some sort of device which could utilise it?";
const MEMOIRS_CHARGES_ATTRIBUTE = "kharedst-memoirs:charges";
const MEMOIRS_CHARGED_PAGES_ATTRIBUTE = "kharedst-memoirs:charged-pages";
const XERIC_CHARGES_META = "xerics-talisman:charges";
const MEMOIRS_PAGES_ATTRIBUTE = "kharedst-memoirs:added-pages";
/** Wiki: 20 charges per attached page; live's Check with no page reads "0/0 memories remain.". */
const MEMOIRS_CHARGES_PER_PAGE = 20;
const XERIC_MAX_CHARGES = 1000;
const WILDERNESS_LEVEL = 20;
const PROMPT = "Where would you like to teleport to?";
const WORN_OPTION_PARAM = 451;
const READ_BOOK_SEQUENCE = "human_readbook";
const BOOK_TITLES = new Map([[BOOK_OF_THE_DEAD_ID, "The Book of the Dead"], [MEMOIRS_ID, "Kharedst's Memoirs"]]);
const BOOK_LINES = 15;
const LEFT_TEXT = 44;
const RIGHT_TEXT = 60;
/** The memoirs' last entry, from A Kingdom Divided; only the Book of the Dead is captured with it. */
const BOOK_OF_THE_DEAD_ONLY = new Set(["tread"]);
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
  // Recorded Honour landings (rsprox 230/02887 from a house, 236/03942 from the Grand Exchange) fall in
  // 1253-1257, 3562-3564; the mounted talisman uses the same tile.
  { key: "honour", label: "Xeric's Honour", tile: [1254, 3563, 0], needsHonour: true },
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

/** The book's capacity: 20 per attached page for the memoirs (up to 100), 250 for the Book of the Dead (Wiki). */
function maxCharges(item, player) {
  if (item?.getId?.() === BOOK_OF_THE_DEAD_ID) return BOOK_OF_THE_DEAD_MAX_CHARGES;
  return unlockedCities(player).length * MEMOIRS_CHARGES_PER_PAGE;
}

function memoirCharges(player, item) {
  const saved = Number(player.getAttribute(MEMOIRS_CHARGES_ATTRIBUTE));
  const pages = unlockedCities(player).length;
  if (!Number.isFinite(saved) || saved < 0) return pages * MEMOIRS_CHARGES_PER_PAGE;
  // Quest-owned page handlers only set their varbit; grant their new capacity once.
  const chargedPages = Number(player.getAttribute(MEMOIRS_CHARGED_PAGES_ATTRIBUTE) ?? pages);
  return Math.min(maxCharges(item, player), saved + Math.max(0, pages - chargedPages) * MEMOIRS_CHARGES_PER_PAGE);
}

function setMemoirCharges(player, item, amount) {
  const charges = Math.max(0, Math.min(maxCharges(item, player), amount));
  player.setAttribute(MEMOIRS_CHARGES_ATTRIBUTE, charges);
  player.setAttribute(MEMOIRS_CHARGED_PAGES_ATTRIBUTE, unlockedCities(player).length);
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  return charges;
}

function teleport(player, item, page) {
  const charges = memoirCharges(player, item);
  if (charges <= 0) {
    noCharge(player, item);
    return false;
  }
  if (!memoirPageUnlocked(player, page)) return false;
  const target = new core.Location(...page.tile);
  if (!core.TeleportHandler.checkReqs(player, target, WILDERNESS_LEVEL)) return false;
  core.TeleportHandler.confirm(player, target, (carried) => {
    if (memoirCharges(player, carried) <= 0) return;
    setMemoirCharges(player, carried, memoirCharges(player, carried) - 1);
    core.TeleportHandler.teleport(player, target, core.TeleportType.NORMAL, false, () => {
      api.emitCustomEvent("kharedst:teleported", { player, city: page.key });
    });
  }, WILDERNESS_LEVEL, { item });
  return true;
}

/** Live sends each box's text as a mesbox chat line first, line breaks as spaces (rsprox 363 tick 37). */
function mesbox(player, text) {
  player.getPacketSender().sendTypedMessage(core.ChatType.MESBOX, text.replace(/<br>/g, " "));
}

/** Live's messagebox when the book is empty (user capture 20261111T231757-5ab63b4). */
function noCharge(player, item) {
  const text = `${BOOK_TITLES.get(item?.getId?.()) ?? BOOK_TITLES.get(MEMOIRS_ID)} holds no charge.`;
  mesbox(player, text);
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
    new core.StatementDialogue(0, text),
  ));
}

function chooseCity(player, item) {
  if (memoirCharges(player, item) <= 0) {
    noCharge(player, item);
    return;
  }
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
  // A Reminisce submenu entry goes straight to its page's city (rsprox 363: subops 1-4 land in
  // Piscarilius, Shayzien, Lovakengj and Arceuus; 3150: subop 0 in Hosidius).
  const page = PAGE_BY_LABEL.get(option) ?? (option === "reminisce" ? PAGE_BY_LABEL.get(normalise(event.subOption)) : undefined);
  if (page) {
    event.handled = true;
    teleport(player, item, page);
    return;
  }
  if (option === "reminisce") {
    event.handled = true;
    chooseCity(player, item);
    return;
  }
  if (option === "check") {
    event.handled = true;
    checkMemoirs(player, item);
    return;
  }
  if (option === "read") {
    event.handled = true;
    readMemoirs(player, item);
  }
}

/** Live's objectbox line, the count in purple (rsprox 363: "33/250 memories remain."). */
function checkMemoirs(player, item) {
  const text = "On the inside of the cover a message is displayed in<br>dark ink. It reads: "
    + `<col=800080>${memoirCharges(player, item)}/${maxCharges(item, player)} memories remain.<col=800080>`;
  mesbox(player, text);
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
    new core.ItemStatementDialogue(0, item.getId(), text),
  ));
}

function readMemoirs(player, item) {
  const sequence = core.CacheDefinitions.getSeqId(READ_BOOK_SEQUENCE);
  if (sequence != null) player.performAnimation(new core.Animation(sequence));
  openBook(player, BOOK_TITLES.get(item.getId()), bookSpreads(player, item));
}

/** The book's pages run on: the dedication, then each entry in full when attached or as its one missing page. */
function bookPages(player, item) {
  const full = item.getId() === BOOK_OF_THE_DEAD_ID;
  const attached = new Set(unlockedCities(player).map((page) => page.key));
  const pages = [BOOK.dedication];
  for (const entry of BOOK.entries) {
    if (BOOK_OF_THE_DEAD_ONLY.has(entry.key)) {
      if (full) pages.push(...entry.pages);
    } else {
      pages.push(...(full || attached.has(entry.key) ? entry.pages : [entry.missing]));
    }
  }
  return pages;
}

/** Pairs the pages into book 392 spreads, keyed by text component. */
function bookSpreads(player, item) {
  const pages = bookPages(player, item);
  const spreads = [];
  for (let index = 0; index < pages.length; index += 2) {
    const spread = {};
    for (let line = 0; line < BOOK_LINES; line++) {
      spread[LEFT_TEXT + line] = pages[index][line] ?? "";
      spread[RIGHT_TEXT + line] = pages[index + 1]?.[line] ?? "";
    }
    spreads.push(spread);
  }
  return spreads;
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

/**
 * Whether the player has unlocked Xeric's Honour. Wiki (Xeric's talisman): "Players must use an ancient tablet on the
 * talisman before being able to teleport here." The mounted talisman asks here ("xerics-talisman:honour-unlocked").
 */
function honourUnlocked(player) {
  return player?.getAttribute?.(HONOUR_UNLOCKED_ATTRIBUTE) === true;
}

/**
 * Uses an ancient tablet from the player's inventory on a talisman. Wiki (Ancient tablet): it unlocks Honour "on all
 * subsequent talismans as well, including ones mounted in the player's PoH", and "the tablet crumbles". A second
 * tablet does nothing (ours: the Wiki doesn't say).
 */
/**
 * The unlock line as a mesbox chat line and a box showing the talisman and the tablet, as live sends the sibling Drakan's
 * medallion tablet (rsprox 235/03389.txt:54053-54068: message_game type=mesbox, then objectbox_double with both items).
 */
function tabletUsedBox(player, talismanId) {
  const { ChatType, DialogueChainBuilder, DoubleItemStatementDialogue } = core;
  player.getPacketSender().sendTypedMessage(ChatType.MESBOX, TABLET_USED_MESSAGE);
  const chain = new DialogueChainBuilder();
  chain.add(new DoubleItemStatementDialogue(0, talismanId, ANCIENT_TABLET_ID, TABLET_USED_MESSAGE));
  player.getDialogueManager().startDialogues(chain);
}

function unlockHonour(player, tabletSlot, talismanId = XERIC_TALISMAN_ID) {
  if (honourUnlocked(player)) {
    player.sendMessage("Nothing interesting happens.");
    return;
  }
  const inventory = player.getInventory();
  const slot = Number.isInteger(tabletSlot) && inventory.getItems()[tabletSlot]?.getId?.() === ANCIENT_TABLET_ID
    ? tabletSlot : inventory.getSlotForItemId(ANCIENT_TABLET_ID);
  if (slot < 0) return;
  inventory.deleteAtSlot(slot, 1, true);
  player.setAttribute(HONOUR_UNLOCKED_ATTRIBUTE, true);
  tabletUsedBox(player, talismanId);
}

/** Item on item: the tablet on a talisman, charged or inert. */
function useTabletOnTalisman(event) {
  if (event.handled) return;
  const ids = [event.usedItemId, event.usedWithItemId];
  if (!ids.includes(ANCIENT_TABLET_ID) || !ids.some((id) => id === XERIC_TALISMAN_ID || id === XERIC_TALISMAN_INERT_ID)) return;
  event.handled = true;
  const talismanId = ids.find((id) => id === XERIC_TALISMAN_ID || id === XERIC_TALISMAN_INERT_ID);
  unlockHonour(event.player, event.usedItemId === ANCIENT_TABLET_ID ? event.usedItemSlot : event.usedWithItemSlot, talismanId);
}

/** The mounted talisman's own tablet use ("xerics-talisman:unlock-honour" { player, handled }). */
function answerUnlockHonour(request) {
  if (!request?.player || request.handled) return;
  request.handled = true;
  unlockHonour(request.player);
}

function inspectTablet(event) {
  if (normalise(event.option) !== "inspect") return;
  event.handled = true;
  event.player.sendMessage(TABLET_INSPECT_MESSAGE);
}

function answerHonourUnlocked(request) {
  if (request?.player && request.unlocked !== true) request.unlocked = honourUnlocked(request.player);
}

function talismanDestination(player, name) {
  const destination = XERIC_BY_LABEL.get(normalise(name));
  return destination && (!destination.needsHonour || honourUnlocked(player)) ? destination : null;
}

function teleportWithTalisman(player, item, destination) {
  const charges = xericCharges(item);
  if (charges <= 0) {
    player.sendMessage("The talisman has no charges.");
    return false;
  }
  const target = new core.Location(...destination.tile);
  if (!core.TeleportHandler.checkReqs(player, target, WILDERNESS_LEVEL)) return false;
  core.TeleportHandler.confirm(player, target, (carried) => {
    if (xericCharges(carried) <= 0) return;
    // Spend before starting: Uncharge or equipping during the animation can move/change the item.
    setXericCharges(player, carried, xericCharges(carried) - 1);
    core.TeleportHandler.teleport(player, target, xericTeleportType(), false, () => {
      api.emitCustomEvent("xerics-talisman:teleported", { player, destination: destination.key });
    });
  }, WILDERNESS_LEVEL, { item });
  return true;
}

function chooseTalismanDestination(player, item) {
  const destinations = XERIC_DESTINATIONS.filter((destination) => !destination.needsHonour || honourUnlocked(player));
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
  if (option === "rub" && event.subOption) {
    // A Rub submenu entry teleports straight there, with no menu (rsprox 726: subop 2 lands at
    // Xeric's Inferno; 3942: subop 4 at Xeric's Honour).
    event.handled = true;
    const destination = talismanDestination(player, event.subOption);
    // Ours: a locked Honour entry does nothing, as its worn option does; no source shows a reply.
    if (destination) teleportWithTalisman(player, item, destination);
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
  if (event.itemId === MEMOIRS_ID || event.itemId === BOOK_OF_THE_DEAD_ID) memoirsAction(event);
  else if (event.itemId === XERIC_TALISMAN_ID) talismanAction(event);
  else if (event.itemId === ANCIENT_TABLET_ID) inspectTablet(event);
}

module.exports = {
  name: "KourendTravelItems",
  description: "Adds Kharedst's memoirs, the Book of the Dead and Xeric's talisman teleports to Kourend, with charges and Wilderness limits.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.persistAttribute(MEMOIRS_CHARGES_ATTRIBUTE, -1);
    api.persistAttribute(MEMOIRS_CHARGED_PAGES_ATTRIBUTE, 0);
    api.persistAttribute(MEMOIRS_PAGES_ATTRIBUTE, {});
    api.persistAttribute(HONOUR_UNLOCKED_ATTRIBUTE, false);
    api.onItemAction(onItemAction);
    api.onItemOnItem(addPage, { noted: false });
    api.onItemOnItem(chargeTalisman, { noted: false });
    api.onItemOnItem(useTabletOnTalisman, { noted: false });
    api.onPlayerLogin(syncPages);
    api.onCustomEvent("xerics-talisman:honour-unlocked", answerHonourUnlocked);
    api.onCustomEvent("xerics-talisman:unlock-honour", answerUnlockHonour);
  },
  _test: {
    MEMOIRS_PAGES, XERIC_DESTINATIONS, MEMOIRS_ID, BOOK_OF_THE_DEAD_ID, XERIC_TALISMAN_ID, XERIC_TALISMAN_INERT_ID,
    memoirCharges, setMemoirCharges, memoirPageUnlocked, unlockedCities, teleport, chooseCity,
    memoirsAction, checkMemoirs, readMemoirs, bookSpreads, addPage, xericCharges, setXericCharges, teleportWithTalisman, talismanAction,
    chooseTalismanDestination, chargeTalisman, checkTalisman, unchargeTalisman, talismanDestination,
  },
};
