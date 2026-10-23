/**
 * Skillcape teleports (Wiki: Cape of Accomplishment; tiles and menus from rsprox captures).
 *
 * - Strength: Warriors' Guild. Crafting: Crafting Guild. Farming: Farming Guild. Fishing: Fishing
 *   Guild and Otto's Grotto. All unlimited.
 * - Hunter: the Hunter Guild once Guildmaster Apatura has enhanced the cape (it must be worn or
 *   carried when talking to him), and five teleports a day to the carnivorous or black
 *   chinchompa hunting areas ("You have # teleports remaining today.", varbit
 *   chinchompa_teleports). Its inventory Teleport asks "Which hunting location would you like
 *   to teleport to?".
 * - Construction: the player's house or any house portal. Its inventory Teleport opens the menu
 *   interface "House portal teleports"; Tele to POH goes straight home.
 * - Sailing: The Pandemonium and a moored boat (the Sailing plugin's "sailing:cape-teleport").
 *
 * Every teleport is the standard cast. The max cape reuses `goTo` for its own menus.
 */
const Capes = require("./Common.SkillCapes");

const HUNTER_GUILD_ATTRIBUTE = "skillcapes:hunter-guild-teleport";
const CHINCHOMPA_KEY = "chinchompa";
const CHINCHOMPA_VARBIT = "chinchompa_teleports";
const APATURA = "Guildmaster Apatura";
const APATURA_UPGRADE_VARIANT = "upgrading-a-skillcape";
const HUNTER_PROMPT = "Which hunting location would you like to teleport to?";
const HUNTER_CHOICES = ["Hunter Guild", "Carnivorous chinchompas (Feldip Hills)", "Black chinchompas (Wilderness)"];
const HOUSE_MENU_TITLE = "House portal teleports";
const HOUSE_CHOICES = ["Home", "Rimmington", "Taverley", "Pollnivneach", "Hosidius", "Aldarin", "Rellekka", "Brimhaven", "Yanille", "Prifddinas"];
const SAILING_CHOICES = ["Teleport to the Pandemonium", "Teleport boat to the Pandemonium", "Teleport to a boat", "Teleport to a boat (last one)"];
const NOT_AVAILABLE = "That isn't available yet.";

// The menu interface (187), opened through its script as the spirit trees do.
const MENU = 187;
const MENU_CHOICES = 3;
const MAIN_MODAL = (161 << 16) | 16;
const SCRIPT_MAINMODAL_OPEN = 2524;
const SCRIPT_MENU = 217;
const SCRIPT_RESTORE_INPUT = 2158;
const PAUSE_BUTTON = 1;
const MENU_SLOTS = 127;
const MENU_ATTRIBUTE = "skillcapes:menu";

let api;

/** "Carnivorous chinchompas (Feldip Hills)" -> "carnivorous chinchompas", with the cache's aliases. */
const ALIASES = new Map([
  ["feldip hills", "carnivorous chinchompas"],
  ["the pandemonium", "pandemonium"],
  ["teleport to the pandemonium", "pandemonium"],
  ["teleport boat to the pandemonium", "boat to pandemonium"],
  ["teleport boat", "boat to pandemonium"],
  ["teleport to a boat", "boat"],
  ["last boat", "last-boat"],
  ["tele to poh", "home"],
]);

function destinationKey(label) {
  const raw = String(label ?? "").toLowerCase();
  if (/last one|last boat/.test(raw)) return "last-boat";
  const key = raw.replace(/\(.*?\)/g, "").replace(/'/g, "").replace(/\s+/g, " ").trim();
  return ALIASES.get(key) ?? key;
}

function hunterGuildUnlocked(player) {
  return player.getAttribute(HUNTER_GUILD_ATTRIBUTE) === true;
}

function syncChinchompaVarbit(player) {
  const id = Capes.core.CacheDefinitions.getVarbitId(CHINCHOMPA_VARBIT);
  if (Number.isInteger(id)) player.getPacketSender().sendVarbit(id, Capes.dailyUses(player, CHINCHOMPA_KEY));
}

function chinchompaTeleport(player, tile) {
  const limit = Capes.DATA.chinchompaTeleportsPerDay;
  if (Capes.dailyUses(player, CHINCHOMPA_KEY) >= limit) {
    player.sendMessage("You have used all of your teleports for today.");
    return;
  }
  Capes.teleport(player, tile, () => {
    const used = Capes.useDaily(player, CHINCHOMPA_KEY);
    syncChinchompaVarbit(player);
    player.sendMessage(`You have ${limit - used} teleports remaining today.`);
  });
}

function teleportHome(player) {
  const request = { player, option: "inside", destination: null, onArrival: null };
  api.emitCustomEvent("construction:house-tablet", request);
  if (request.destination) Capes.teleport(player, request.destination, request.onArrival ?? undefined);
}

/** Teleports to a labelled destination; false when the label is no teleport. */
function goTo(player, label) {
  const key = destinationKey(label);
  const tile = Capes.DATA.teleports[key];
  if (key === "hunter guild") {
    if (!hunterGuildUnlocked(player)) {
      player.sendMessage("Guildmaster Apatura at the Hunter Guild needs to enhance your cape first.");
      return true;
    }
    Capes.teleport(player, tile);
    return true;
  }
  if (key === "carnivorous chinchompas" || key === "black chinchompas") {
    chinchompaTeleport(player, tile);
    return true;
  }
  if (tile) {
    Capes.teleport(player, tile);
    return true;
  }
  if (key === "home") {
    teleportHome(player);
    return true;
  }
  if (Capes.DATA.housePortals[key]) {
    Capes.teleport(player, Capes.DATA.housePortals[key]);
    return true;
  }
  if (key === "pandemonium" || key === "boat" || key === "last-boat" || key === "boat to pandemonium") {
    const request = { player, target: key, handled: false };
    api.emitCustomEvent("sailing:cape-teleport", request);
    if (!request.handled) player.sendMessage(NOT_AVAILABLE);
    return true;
  }
  if (key === "rename boat") {
    const request = { player, handled: false };
    api.emitCustomEvent("sailing:cape-rename-boat", request);
    if (!request.handled) player.sendMessage(NOT_AVAILABLE);
    return true;
  }
  return false;
}

function chooseFrom(player, title, labels) {
  const pairs = labels.flatMap((label) => [label, () => goTo(player, label)]);
  api.sendMultiChatboxPrompt(player, title, ...pairs);
}

/** The menu interface with a list of destinations (the house portals, the max cape's list). */
function openMenu(player, title, labels, onChoose = (label) => goTo(player, label)) {
  player.setAttribute(MENU_ATTRIBUTE, { labels });
  menuHandlers.set(player, onChoose);
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  player.setInterfaceId(MENU);
  sender.sendSubInterface(MAIN_MODAL, MENU, 0);
  sender.sendClientScript(SCRIPT_MENU, title, labels.join("|"), 1);
  sender.sendInterfaceFlagsRange((MENU << 16) | MENU_CHOICES, 0, MENU_SLOTS, PAUSE_BUTTON);
}

const menuHandlers = new WeakMap();

function chooseMenu(event) {
  const buttonId = Number(event.buttonId ?? 0);
  if ((event.groupId ?? (buttonId >>> 16)) !== MENU || (event.childId ?? (buttonId & 0xffff)) !== MENU_CHOICES) return;
  const { player } = event;
  const menu = player.getAttribute(MENU_ATTRIBUTE);
  const handler = menuHandlers.get(player);
  if (!menu || !handler) return;
  event.handled = true;
  closeMenu(player);
  const label = menu.labels[Number(event.action)];
  if (label) handler(label);
}

function closeMenu(player) {
  player.setAttribute(MENU_ATTRIBUTE, null);
  menuHandlers.delete(player);
  player.getPacketSender().closeSubInterface(MAIN_MODAL);
  player.getPacketSender().sendInterfaceScript(SCRIPT_RESTORE_INPUT);
  player.setInterfaceId(-1);
}

function menuClosed({ player, interfaceId }) {
  if (interfaceId !== MENU || !player.getAttribute(MENU_ATTRIBUTE)) return;
  player.setAttribute(MENU_ATTRIBUTE, null);
  menuHandlers.delete(player);
  player.getPacketSender().sendInterfaceScript(SCRIPT_RESTORE_INPUT);
}

/** One handler per cape option: worn and inventory names, a submenu entry taking precedence. */
const OPTIONS = {
  STRENGTH: { Teleport: "Warriors' Guild", "Warriors' Guild": "Warriors' Guild" },
  CRAFTING: { Teleport: "Crafting Guild" },
  FARMING: { Teleport: "Farming Guild" },
  FISHING: { "Fishing Guild": "Fishing Guild", "Otto's Grotto": "Otto's Grotto" },
  HUNTER: {
    Teleport: (player) => chooseFrom(player, HUNTER_PROMPT, HUNTER_CHOICES),
    "Hunter Guild": "Hunter Guild",
    "Carnivorous Chinchompas": "Carnivorous chinchompas",
    "Black Chinchompas": "Black chinchompas",
  },
  CONSTRUCTION: {
    Teleport: (player) => openMenu(player, HOUSE_MENU_TITLE, HOUSE_CHOICES),
    "Tele to POH": "Home",
  },
  SAILING: {
    Teleport: (player) => chooseFrom(player, "Select an option", SAILING_CHOICES),
    "Boat Teleport": (player) => chooseFrom(player, "Select an option", ["Teleport to a boat", "Teleport to a boat (last one)"]),
    "Rename boat": "Rename boat",
    "Rename Boat": "Rename boat",
  },
};

function capeTeleportAction(event) {
  const cape = Capes.CAPE_BY_ITEM.get(event.itemId);
  const options = cape && OPTIONS[cape.skillKey];
  if (!options) return;
  const { option, sub } = Capes.itemOption(event);
  const action = options[option];
  if (!action) return;
  event.handled = true;
  if (sub) goTo(event.player, sub);
  else if (typeof action === "function") action(event.player);
  else goTo(event.player, action);
}

// --- Guildmaster Apatura: enhancing a Hunter cape with the guild teleport -------------------

function carriesHunterCape(player) {
  return Capes.hasPerk(player, "HUNTER", true);
}

function apaturaVariant({ player, definition }) {
  if (definition?.getName?.() !== APATURA) return null;
  return carriesHunterCape(player) && !hunterGuildUnlocked(player) ? APATURA_UPGRADE_VARIANT : null;
}

function apaturaChoice({ player, definition, option }) {
  if (definition?.getName?.() !== APATURA || option !== "Yes please.") return;
  if (carriesHunterCape(player) && !hunterGuildUnlocked(player)) player.setAttribute(HUNTER_GUILD_ATTRIBUTE, true);
}

function syncOnLogin({ player }) {
  syncChinchompaVarbit(player);
}

module.exports = function attachTeleports(pluginApi) {
  api = pluginApi;
  api.persistAttribute(HUNTER_GUILD_ATTRIBUTE, false);
  api.onItemAction(capeTeleportAction);
  // A mounted cape (house cape hanger) runs its option as the item would: { player, itemId, option }.
  api.onCustomEvent("skillcape:operate", (request) => { if (!request.handled) capeTeleportAction(request); });
  api.onInterfaceActionClick(chooseMenu);
  api.onCustomEvent("interface:closed", menuClosed);
  api.onNpcDialogueVariant(apaturaVariant);
  api.onCustomEvent("npc-dialogue:choice", apaturaChoice);
  api.onPlayerLogin(syncOnLogin);
};

module.exports.goTo = goTo;
module.exports.openMenu = openMenu;
module.exports.chooseFrom = chooseFrom;
module.exports.HOUSE_MENU_TITLE = HOUSE_MENU_TITLE;
module.exports.HOUSE_CHOICES = HOUSE_CHOICES;
module.exports._test = { destinationKey, goTo, capeTeleportAction, apaturaVariant, apaturaChoice, HUNTER_GUILD_ATTRIBUTE };
