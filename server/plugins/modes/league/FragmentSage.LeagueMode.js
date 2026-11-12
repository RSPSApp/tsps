/**
 * Shattered Relics' three sets that give an item (data/league-shattered.json `sageEffects`; Wiki
 * /Fragments): Endless Knowledge (the Arcane grimoire, whose spellbook swap is its own unit in
 * leaguerelics, Leagues polish), Last Recall (the Crystal of memories) and Trailblazer (the
 * Portable waystone). A set's item (Fragments.setItem, the set struct's param 1471) is handed over
 * when the set becomes active and the character holds none (`league:fragments-changed`, and at
 * login). The crystal's Teleport-back returns to where the last teleport began (`teleport:landed`,
 * core); the waystone teleports to the league's waystones.
 */
const Common = require("./Common.LeagueMode");
const Fragments = require("./Fragments.LeagueMode");
const { data, isShattered } = require("./Shattered.LeagueMode");

/** Where the character's last teleport began, kept for the crystal. */
const RECALL_ATTRIBUTE = "league:last-recall";
/** Chatbox options a page: four places and "More...". */
const PAGE_SIZE = 5;

function effects() {
  return data.sageEffects;
}

function core() {
  return Common.core;
}

function itemName(itemId) {
  return core().ItemDefinition.forId(itemId)?.getName?.() ?? "an item";
}

// ---- The items, handed over ----

/**
 * Whether the character holds the item anywhere: inventory, worn, banked (not a placeholder), in
 * its grave or Death's Office (`gravestones:state`), or kept by an item-retrieval NPC after a
 * death (`item-retrieval:items`: Zulrah's priestess, Vorkath's Torfinn, the Voice of Yama, ...).
 */
function holds(player, itemId) {
  const containers = [player.getInventory(), player.getEquipment()];
  for (let tab = 0; tab < core().Bank.TOTAL_BANK_TABS; tab++) containers.push(player.getBank(tab));
  const held = (id, amount) => id === itemId && amount > 0;
  if (containers.some((container) => container?.getItems?.().some((item) => item && held(item.getId(), item.getAmount())))) return true;
  const storage = { player, grave: null, office: [] };
  Common.api.emitCustomEvent("gravestones:state", storage);
  if ([...(storage.grave?.items ?? []), ...(storage.office ?? [])].some((entry) => entry && held(entry.id, entry.amount))) return true;
  const retrieval = { player, items: [] };
  Common.api.emitCustomEvent("item-retrieval:items", retrieval);
  return retrieval.items.some((entry) => entry && held(entry.itemId, entry.amount));
}

/** Each active set's item, to a character who holds none: into the inventory, else the bank, else the floor. */
function grantItems({ player }) {
  if (!isShattered(player)) return;
  for (const set of effects().sets) {
    const itemId = Fragments.setItem(set);
    if (!itemId || Fragments.setTier(player, set) === 0 || holds(player, itemId)) continue;
    const item = new (core().Item)(itemId, 1);
    let message = data.messages.sageItem;
    if (player.getInventory().getAddableAmount(item) > 0) player.getInventory().add(item, true);
    else if (Common.bank(player, itemId, 1)) message = data.messages.sageItemBanked;
    else {
      player.getInventory().forceAdd(player, item);
      message = data.messages.sageItemFloor;
    }
    player.sendMessage(message.replace("{item}", itemName(itemId)));
  }
}

// ---- The Crystal of memories ----

function inBox(location, box) {
  const x = location.getX();
  const y = location.getY();
  const z = location.getZ();
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY && (box.z === undefined || z === box.z) && (box.minZ === undefined || z >= box.minZ);
}

/**
 * `teleport:landed`: a Shattered character remembers where a teleport began, unless in an instance or
 * a place the crystal can't return to. The crystal's own teleport counts too, so a second
 * Teleport-back returns to where the first was used.
 */
function rememberTeleport({ player, from, fromInstance }) {
  if (!isShattered(player) || fromInstance || !from || effects().noRecall.some((box) => inBox(from, box))) return;
  player.setAttribute(RECALL_ATTRIBUTE, { x: from.getX(), y: from.getY(), z: from.getZ() });
}

function recalled(player) {
  const saved = player.getAttribute(RECALL_ATTRIBUTE);
  return saved && Number.isInteger(saved.x) ? saved : null;
}

function teleport(player, location, wildernessLevel) {
  const { TeleportHandler, TeleportType } = core();
  if (!TeleportHandler.checkReqs(player, location, wildernessLevel)) return false;
  TeleportHandler.confirm(player, location, () => TeleportHandler.teleport(player, location, TeleportType.NORMAL, false), wildernessLevel);
  return true;
}

function teleportBack(event) {
  const { player } = event;
  if (!isShattered(player)) return false;
  const saved = recalled(player);
  if (!saved) player.sendMessage(data.messages.recallNothing);
  else teleport(player, new (core().Location)(saved.x, saved.y, saved.z), effects().crystal.wildernessLevel);
  return true;
}

function checkMemory(event) {
  const { player } = event;
  if (!isShattered(player)) return false;
  player.sendMessage(recalled(player) ? data.messages.recallMemory : data.messages.recallNothing);
  return true;
}

/** Save-memory: the league's crystal remembers on its own. */
function saveMemory(event) {
  if (!isShattered(event.player)) return false;
  event.player.sendMessage(data.messages.recallAutomatic);
  return true;
}

// ---- The Portable waystone ----

function questDone(player, key) {
  const quest = { player, key, complete: null };
  Common.api.emitCustomEvent("quest:is-complete", quest);
  return quest.complete === true;
}

function goToWaystone(player, place) {
  if (place.quest && !questDone(player, place.quest)) {
    player.sendMessage(data.messages.waystoneQuest.replace("{quest}", place.questName));
    return;
  }
  const [x, y, z] = place.tile;
  teleport(player, new (core().Location)(x, y, z), effects().waystone.wildernessLevel);
}

/** A paged chatbox menu of the waystones; "More..." shows the next page, the last page leads back to the first. */
function waystoneMenu(player, from = 0) {
  const places = effects().waystone.places;
  const room = PAGE_SIZE - 1;
  const page = places.slice(from, from + room);
  const options = page.flatMap((place) => [place.name, () => goToWaystone(player, place)]);
  const next = from + room < places.length ? from + room : 0;
  options.push(data.messages.waystoneMore, () => waystoneMenu(player, next));
  Common.api.sendMultiChatboxPrompt(player, data.messages.waystoneChoose, ...options);
}

function waystone(event) {
  if (!isShattered(event.player)) return false;
  waystoneMenu(event.player);
  return true;
}

module.exports = function attach(api) {
  api.persistAttribute(RECALL_ATTRIBUTE, null);
  api.onCustomEvent("league:fragments-changed", grantItems);
  api.onCustomEvent("league:login", grantItems);
  api.onCustomEvent("teleport:landed", rememberTeleport);
  api.onItemAction("Crystal of Echoes", { "Teleport-back": teleportBack, "Check-memories": checkMemory, "Save-memory": saveMemory });
  api.onItemAction("Portable waystone", { Teleport: waystone });
};

module.exports._test = { grantItems, holds, rememberTeleport, teleportBack, checkMemory, goToWaystone, waystoneMenu, RECALL_ATTRIBUTE };
