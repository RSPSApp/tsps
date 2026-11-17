"use strict";

const { api, Animation, CacheDefinitions, ChatType, ItemDefinition } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");

// Bookcases (rsprox captures, cache scripts 7834-7843): Search opens poh_bookcase, which lists the
// books in enum 5210 and shows book i as found when bit i of varps 805, 261-266, 1037 (32 books
// each) is set. A click takes a copy: "You take: <col=ef1020>Name</col>" with
// poh_larder_examine, "You're already carrying a copy of that book." or "You have not found that
// book yet.". Remember successful acquisitions immediately; Search/login also migrate books
// already held by older saves. Wiki item pages gate the three quest books below on completion.
const INTERFACE = Ids.iface("poh_bookcase");
const BOOKS_COMPONENT = 5;
const BOOK_ACTION_FLAGS = (1 << 1) | (1 << 10); // Captured OP1 (Take/Check) and OP10 (Examine).
const BOOK_ENUM = 5210;
// The varps the bookcase's script reads the found books from, in its order.
const FOUND_VARPS = ["macro_bee_pos_1", "if1", "if2", "if3", "if4", "if5", "if6", "pattern_varp"].map(Ids.varp);
const FOUND_ATTRIBUTE = "construction:books-found";
const TAKE_BOOK = Ids.seq("poh_larder_examine");
// RSProx230/02922 tick1738; active242 sound index4 archive2582.
const TAKE_BOOK_SOUND = 2582;
const QUEST_BOOKS = new Map([
  [Ids.obj("digsitebook"), "the_dig_site"],
  [Ids.obj("grandtree_translationbook"), "grand_tree"],
  [Ids.obj("elemental_workshop_helm_book"), "elemental_workshop_ii"],
]);

let books = null;
let bookSlots = null;

/** Book slot -> item id, from the cache. */
function bookList() {
  books ??= [...CacheDefinitions.getEnumValues(BOOK_ENUM)].sort(([a], [b]) => a - b);
  return books;
}

function foundBooks(player) {
  return new Set(player.getAttribute(FOUND_ATTRIBUTE) ?? []);
}

function holds(player, itemId) {
  if (player.getInventory().getAmount(itemId) > 0) return true;
  return (player.getBanks?.() ?? []).some(bank => (bank?.getAmount?.(itemId) ?? 0) > 0);
}

function recordAcquired({ player, itemId, amount }) {
  if (!(amount > 0)) return;
  bookSlots ??= new Map(bookList().map(([slot, id]) => [id, slot]));
  const slot = bookSlots.get(itemId);
  if (slot == null) return;
  const found = foundBooks(player);
  if (found.has(slot)) return;
  found.add(slot);
  player.setAttribute(FOUND_ATTRIBUTE, [...found]);
}

/** GE stages collection on a copy, then publishes this receipt after committing its destination. */
function recordCollected({ player, itemId, amount, destination, container }) {
  if (!Number.isInteger(itemId) || !Number.isInteger(amount) || amount <= 0) return;
  const owned = destination === "inventory" ? container === player?.getInventory()
    : destination === "bank" && (player?.getBanks() ?? []).includes(container);
  if (!owned || (container?.getAmount(itemId) ?? 0) < amount) return;
  recordAcquired({ player, itemId, amount });
}

function canRecover(player, itemId) {
  const key = QUEST_BOOKS.get(itemId);
  if (!key) return true;
  const query = { player, key, complete: false };
  api.emitCustomEvent("quest:is-complete", query);
  return query.complete === true;
}

/** Books on the player or in their bank count as found from now on. */
function recordFound(player) {
  const found = foundBooks(player);
  for (const [slot, itemId] of bookList()) if (!found.has(slot) && holds(player, itemId)) found.add(slot);
  player.setAttribute(FOUND_ATTRIBUTE, [...found]);
  return found;
}

function login({ player }) {
  recordFound(player);
}

function sendFound(player, found) {
  FOUND_VARPS.forEach((varp, index) => {
    let value = 0;
    for (let bit = 0; bit < 32; bit++) if (found.has(index * 32 + bit)) value |= 1 << bit;
    player.getPacketSender().sendConfig(varp, value);
  });
}

function search(event) {
  const house = House.houseFor(event.player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  if (!furniture?.buildableKey.endsWith("_BOOKCASE")) return false;
  const found = recordFound(event.player);
  sendFound(event.player, new Set(bookList().filter(([slot, itemId]) => found.has(slot)
    && canRecover(event.player, itemId)).map(([slot]) => slot)));
  event.player.getPacketSender().sendInterface(INTERFACE);
  const lastSlot = bookList().at(-1)?.[0];
  if (lastSlot != null) event.player.getPacketSender().sendInterfaceFlagsRange(
    (INTERFACE << 16) | BOOKS_COMPONENT, 0, lastSlot, BOOK_ACTION_FLAGS);
  return true;
}

function interfaceClick(event) {
  if (event.groupId !== INTERFACE || event.childId !== BOOKS_COMPONENT) return;
  event.handled = true;
  const player = event.player;
  if (!House.houseFor(player)) return;
  const book = bookList().find(([slot]) => slot === event.slot);
  if (!book) return;
  const [slot, itemId] = book;
  if ((event.opId ?? event.action ?? 1) > 1) return player.sendMessage(ItemDefinition.forId(itemId)?.getExamine?.() ?? "It's a book.");
  if (!foundBooks(player).has(slot) || !canRecover(player, itemId)) return player.sendMessage("You have not found that book yet.");
  if (player.getInventory().contains(itemId)) return player.sendMessage("You're already carrying a copy of that book.");
  if (player.getInventory().getFreeSlots() === 0) return player.sendMessage("You don't have enough inventory space to do that.");
  player.getInventory().adds(itemId, 1);
  player.performAnimation(new Animation(TAKE_BOOK));
  player.getPacketSender().sendSoundEffect(TAKE_BOOK_SOUND, 1, 5, 1);
  player.getPacketSender().sendTypedMessage(ChatType.SPAM, `You take: <col=ef1020>${ItemDefinition.forId(itemId)?.getName?.() ?? "the book"}</col>`);
}

function attachBookcase(api) {
  api.persistAttribute(FOUND_ATTRIBUTE, []);
  api.onCustomEvent("inventory:acquired", recordAcquired);
  api.onCustomEvent("ge:offer-collected", recordCollected);
  api.onPlayerLogin(login);
  api.onObjectInteraction("Bookcase", { Search: search });
  api.onInterfaceActionClick(interfaceClick);
}

Object.assign(module.exports, { attachBookcase });
