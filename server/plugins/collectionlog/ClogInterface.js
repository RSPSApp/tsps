/**
 * The collection log (621) and its overview (908), as captured: both open in the floater; every
 * category shows through varp 2048 (its count), varbit 6906, the collection_transmit inventory
 * (the obtained items packed into slots 0..n, in category order) and collection_draw (7797);
 * typing in the search sends one collection_delayed_transmit (4100) per obtained item.
 */
const Data = require("./ClogData");
const Progress = require("./ClogProgress");

const COLLECTION = 621;
const OVERVIEW = 908;
const FLOATER_UID = (161 << 16) | 18;
const OVERLAY = 1;
const LAST_TAB_VARBIT = 6905;
const LAST_CATEGORY_VARBIT = 6906;
const SCRIPT_DRAW = 7797;
const SCRIPT_SEARCH_ITEM = 4100;
const SCRIPT_RESTORE_INPUT = 2158;
const OP1 = 1 << 1;
const CLOSE = 1;
const BURGER = 73;
/** The burger menu's view switch: "Overview" in the log, "View Log" in the overview. */
const BURGER_SWITCH_VIEW = 12;
const KEYS_FIRST = 42;
const KEYS_LAST = 70;
const SEARCH_BUTTON = 75;
const SEARCH_TOGGLE = 76;
const SEARCH_RESULTS = 84;
const OVERVIEW_BURGER = 7;
const OVERVIEW_CLOSE = 9;
const COLLECTION_TRANSMIT = 620;
const OVERVIEW_LATEST = 21;
const OVERVIEW_SECTIONS = 22;
const TAB_ATTRIBUTE = "clog.tab";
const CATEGORY_ATTRIBUTE = "clog.category";

/** Per tab (cache tab index): its tab button and the components collection_draw is given. */
const TAB_COMPONENTS = [
  { button: 4, container: 10, background: 11, text: 12, scrollbar: 13 },
  { button: 5, container: 14, background: 15, text: 16, scrollbar: 23 },
  { button: 6, container: 24, background: 32, text: 33, scrollbar: 25 },
  { button: 7, container: 26, background: 27, text: 36, scrollbar: 28 },
  { button: 8, container: 29, background: 34, text: 35, scrollbar: 30 },
];

const uid = (group, child) => (group << 16) | child;

function currentTab(player) {
  return Data.tabs()[Number(player.getAttribute(TAB_ATTRIBUTE)) || 0] ?? Data.tabs()[0];
}

function currentCategory(player, tab) {
  return Data.categoryByKey(tab, Number(player.getAttribute(CATEGORY_ATTRIBUTE)) || 0) ?? tab.categories[0];
}

/** The category's obtained items, packed from slot 0 in category order (as captured). */
function categoryInventory(player, category) {
  const items = Progress.items(player);
  const owned = category.items.filter((id) => Number(items[id]) > 0);
  const capacity = Data.load().maxCategorySize;
  const slots = Array.from({ length: capacity }, (_, slot) => ({
    slot, itemId: owned[slot] ?? -1, quantity: owned[slot] === undefined ? 0 : Number(items[owned[slot]]),
  }));
  return { [COLLECTION_TRANSMIT]: { capacity, slots } };
}

/**
 * collection_draw, carrying the category's items on the same packet: the script reads each
 * item's count as it draws (and bakes it into "Check"), so they must already be there.
 */
function draw(player, tab, category) {
  const parts = TAB_COMPONENTS[tab.index];
  player.getPacketSender().sendInterfaceScript(SCRIPT_DRAW, [
    tab.index, uid(COLLECTION, parts.container), uid(COLLECTION, parts.background),
    uid(COLLECTION, parts.text), uid(COLLECTION, parts.scrollbar), tab.struct, category.key,
  ], undefined, undefined, categoryInventory(player, category));
}

function sendTabFlags(player, tab) {
  player.getPacketSender().sendInterfaceFlagsRange(uid(COLLECTION, TAB_COMPONENTS[tab.index].background), 0, tab.maxKey, OP1);
}

function showCategory(player, tab, category) {
  const sender = player.getPacketSender();
  sender.sendConfig(Progress.VARP.CATEGORY_COUNT, Progress.categoryCount(player, category));
  sender.sendVarbit(LAST_CATEGORY_VARBIT, category.key);
  player.setAttribute(CATEGORY_ATTRIBUTE, category.key);
  draw(player, tab, category);
}

function open(player) {
  const sender = player.getPacketSender();
  const tab = currentTab(player);
  const category = currentCategory(player, tab);
  sender.sendVarbit(LAST_TAB_VARBIT, tab.index);
  sender.sendConfig(Progress.VARP.CATEGORY_COUNT, Progress.categoryCount(player, category));
  sender.sendVarbit(LAST_CATEGORY_VARBIT, category.key);
  sender.sendSubInterface(FLOATER_UID, COLLECTION, OVERLAY);
  sender.sendInterfaceFlagsRange(uid(COLLECTION, BURGER), 10, 12, OP1);
  for (let key = KEYS_FIRST; key <= KEYS_LAST; key++) sender.sendInterfaceFlagsRange(uid(COLLECTION, key), -1, -1, OP1);
  sender.sendInterfaceFlagsRange(uid(COLLECTION, SEARCH_TOGGLE), -1, -1, OP1);
  sender.sendInterfaceFlagsRange(uid(COLLECTION, SEARCH_BUTTON), -1, -1, OP1);
  sendTabFlags(player, tab);
  draw(player, tab, category);
}

function close(player, group) {
  const sender = player.getPacketSender();
  sender.closeInterface(group);
  sender.sendInterfaceScript(SCRIPT_RESTORE_INPUT);
}

function selectTab(player, index) {
  const tab = Data.tabs()[index];
  if (!tab) return;
  player.setAttribute(TAB_ATTRIBUTE, tab.index);
  const category = tab.categories[0];
  const sender = player.getPacketSender();
  sender.sendConfig(Progress.VARP.CATEGORY_COUNT, Progress.categoryCount(player, category));
  sender.sendVarbit(LAST_CATEGORY_VARBIT, category.key);
  sender.sendVarbit(LAST_TAB_VARBIT, tab.index);
  player.setAttribute(CATEGORY_ATTRIBUTE, category.key);
  sendTabFlags(player, tab);
  draw(player, tab, category);
}

/** Typing in the search: every obtained item, per category it is in, by global category order. */
function sendSearch(player) {
  const sender = player.getPacketSender();
  const items = Progress.items(player);
  sender.sendInterfaceFlagsRange(uid(COLLECTION, SEARCH_RESULTS), 0, Data.load().categoryTotal, OP1);
  for (const tab of Data.tabs()) {
    for (const category of tab.categories) {
      for (const itemId of category.items) {
        if (Number(items[itemId]) > 0) {
          sender.sendInterfaceScript(SCRIPT_SEARCH_ITEM, [itemId, Number(items[itemId]), Data.globalIndex(category), category.struct]);
        }
      }
    }
  }
}

function openOverview(player) {
  close(player, COLLECTION);
  const sender = player.getPacketSender();
  sender.sendSubInterface(FLOATER_UID, OVERVIEW, OVERLAY);
  sender.sendInterfaceFlagsRange(uid(OVERVIEW, OVERVIEW_BURGER), 10, 12, OP1);
  sender.sendInterfaceFlagsRange(uid(OVERVIEW, OVERVIEW_SECTIONS), 0, 4, OP1);
  sender.sendInterfaceFlagsRange(uid(OVERVIEW, OVERVIEW_LATEST), 0, 0, OP1);
}

function click(event) {
  const buttonId = Number(event.buttonId ?? 0);
  const group = event.groupId ?? (buttonId >>> 16);
  const child = event.childId ?? (buttonId & 0xffff);
  const slot = Number(event.slot ?? event.action);
  const { player } = event;
  if (group === OVERVIEW) {
    if (child === OVERVIEW_SECTIONS && Data.tabs()[slot]) {
      player.setAttribute(TAB_ATTRIBUTE, slot);
      player.getPacketSender().sendVarbit(LAST_TAB_VARBIT, slot);
      close(player, OVERVIEW);
      open(player);
    } else if (child === OVERVIEW_BURGER && slot === BURGER_SWITCH_VIEW) {
      close(player, OVERVIEW);
      open(player);
    } else if (child === OVERVIEW_CLOSE) {
      close(player, OVERVIEW);
    } else {
      return;
    }
    event.handled = true;
    return;
  }
  if (group !== COLLECTION) return;
  const tabIndex = TAB_COMPONENTS.findIndex((parts) => parts.button === child);
  if (tabIndex >= 0) {
    selectTab(player, tabIndex);
  } else if (child === CLOSE) {
    close(player, COLLECTION);
  } else if (child === BURGER && slot === BURGER_SWITCH_VIEW) {
    openOverview(player);
  } else if (child >= KEYS_FIRST && child <= KEYS_LAST) {
    sendSearch(player);
  } else {
    const tab = currentTab(player);
    if (child !== TAB_COMPONENTS[tab.index].background) return;
    const category = Data.categoryByKey(tab, slot);
    if (category) showCategory(player, tab, category);
  }
  event.handled = true;
}

module.exports = { COLLECTION, OVERVIEW, TAB_COMPONENTS, TAB_ATTRIBUTE, CATEGORY_ATTRIBUTE, open, click, selectTab, showCategory, sendSearch };
