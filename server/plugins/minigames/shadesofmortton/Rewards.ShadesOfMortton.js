/**
 * Silver chest rewards: the five OSRS Wiki Silver Chest pages, accessed 2026-11-17.
 * The published unconditional rates conflict; see docs/shades-silver-rewards.md.
 * Locks/scroll gates use their stated odds; remaining main weights are normalized.
 */
const Common = require("./Common.ShadesOfMortton");

const SWAMP_BOOK_RECEIVED = "shades-of-mortton:swamp-book-received";
const BLOOD_BOOK_RECEIVED = "shades-of-mortton:blood-book-received";
const SWAMP_BOOK_READ = "shades-of-mortton:swamp-book-read";
const BLOOD_BOOK_READ = "shades-of-mortton:blood-book-read";
const BOOKS = [
  { book: "shades_swamp_diary", scroll: "shades_swamp_scroll", received: SWAMP_BOOK_RECEIVED, read: SWAMP_BOOK_READ },
  { book: "shades_blood_diary", scroll: "shades_blood_scroll", received: BLOOD_BOOK_RECEIVED, read: BLOOD_BOOK_READ },
];
const COLOURS = ["bloodred", "brown", "crimson", "black", "purple"];

function owns(player, id) {
  const containers = [player.getInventory(), player.getEquipment?.()];
  for (let tab = 0; tab < Common.core.Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Common.core.Bank.BANK_SEARCH_TAB_INDEX) containers.push(player.getBank?.(tab));
  }
  return containers.some(container => (container?.getAmount?.(id) ?? 0) > 0);
}

function wearingWealth(player) {
  const ring = player.getEquipment?.()?.getItems?.()?.[Common.core.Equipment.RING_SLOT];
  const gameval = Common.core.CacheDefinitions.getObjNames().get(ring?.getId?.()) ?? "";
  return /^ring_of_wealth(?:_[1-5]|_i[1-5]?)?$/.test(gameval);
}

function canReceiveClue(player) {
  const request = { player, tier: "hard", allowed: null };
  Common.api.emitCustomEvent("treasure-trails:can-receive", request);
  return request.allowed !== false;
}

/** Relative main weights, NOT claimed as exact unconditional per-chest probabilities. */
function mainRows(colour, wealth, clueAllowed) {
  const index = COLOURS.indexOf(colour);
  if (index < 0) throw new Error("Unknown silver chest colour: " + colour);
  const quality = Math.min(4, index + (wealth ? 2 : 0));
  return Common.data.chests.loot.silver.items.flatMap(([name, min, max, baseWeight, noted]) => {
    if (name === "trail_clue_hard_map001" && !clueAllowed) return [];
    const weight = name === "fine_cloth" ? baseWeight + quality
      : name === "yew_logs" ? baseWeight * (5 - quality) / 5
      : name === "magic_logs" ? baseWeight * (5 - quality) / 5
      : baseWeight;
    return [{ id: Common.objId(name), min, max, weight, noted: noted === true }];
  });
}

function rollSilver(player, colour, random = Math.random) {
  const quality = COLOURS.indexOf(colour);
  if (quality < 0) throw new Error("Unknown silver chest colour: " + colour);
  const wealth = wearingWealth(player);
  if (random() < 1 / (63 - quality - (wealth ? 2 : 0))) {
    return { id: Common.objId("shades_lock_silver"), amount: 1 };
  }
  if (random() < 1 / (76 - quality - (wealth ? 2 : 0))) {
    const book = BOOKS[random() < 0.5 ? 0 : 1];
    // Receiving, not merely rolling, the first book commits this attribute in chest().
    return (player.getAttribute(book.received) === true || owns(player, Common.objId(book.book)))
      ? { id: Common.objId(book.scroll), amount: 1 }
      : { id: Common.objId(book.book), amount: 1, receivedAttribute: book.received };
  }
  const rows = mainRows(colour, wealth, canReceiveClue(player));
  let roll = random() * rows.reduce((sum, row) => sum + row.weight, 0);
  let selected = rows.at(-1);
  for (const row of rows) {
    roll -= row.weight;
    if (roll < 0) { selected = row; break; }
  }
  let id = selected.id;
  if (id === Common.objId("trail_clue_hard_map001")) {
    const request = { player, itemId: id, box: false };
    Common.api.emitCustomEvent("treasure-trails:clue-item", request);
    id = request.itemId;
  }
  return { id, amount: selected.min + Math.floor(random() * (selected.max - selected.min + 1)), noted: selected.noted };
}

/** The bag replaces swamp paste. Bank placeholders don't count as ownership. */
function rollSecondary(player, random = Math.random) {
  const id = Common.objId("flamtaer_bag");
  return !owns(player, id) && random() < 0.5 ? { id, amount: 1 } : null;
}

/** Reading each first book grants its associated scroll once; the book is retained. */
function readBook(event) {
  if (event.handled) return;
  const book = BOOKS.find(book => Common.objId(book.book) === event.itemId);
  if (!book || event.player.getInventory().getAmount(event.itemId) < 1) return;
  const player = event.player;
  if (player.getAttribute(book.read) === true) return;
  event.handled = true;
  const scroll = new Common.core.Item(Common.objId(book.scroll), 1);
  if (player.getInventory().getAddableAmount(scroll) < 1) {
    player.getInventory().full?.();
    return;
  }
  player.getInventory().add(scroll);
  player.setAttribute(book.read, true);
  player.setAttribute(book.received, true);
  player.sendMessage("As you open the ancient notes, a rough scroll falls out.");
  player.getInventory().refreshItems();
}

function attachRewards(api) {
  api.persistAttribute(SWAMP_BOOK_RECEIVED, false);
  api.persistAttribute(BLOOD_BOOK_RECEIVED, false);
  api.persistAttribute(SWAMP_BOOK_READ, false);
  api.persistAttribute(BLOOD_BOOK_READ, false);
  api.onItemAction("Tree wizards' journal", { Read: readBook });
  api.onItemAction("Bloody notes", { Read: readBook });
}

module.exports = { attachRewards, rollSilver, rollSecondary, mainRows, owns, wearingWealth, BOOKS };
