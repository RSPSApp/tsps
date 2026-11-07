/**
 * The Arcane grimoire (https://oldschool.runescape.wiki/w/Arcane_grimoire), the item Superior
 * Sorcerer (Trailblazer Reloaded) and the Grimoire relic (Raging Echoes) grant: it switches to any
 * spellbook from the inventory or worn. Its cache options are Change Spellbook (a choice of the
 * other books), Previous Spellbook (back to the book the last change left) and Check Previous. The
 * swap is the altars' (`MagicSpellbook.changeSpellbook`: Lunar's 40 Defence, autocast cleared, the
 * tab). Like the altars and the magic cape it opens only unlocked books (the Trailblazer Reloaded
 * relics page: "providing players have unlocked them"; core SpellbookLocks). Any league character
 * holding one can use it: the item is untradeable and only a relic grants it, so no relic check is
 * made. Its Book of the Dead role (the resurrection spells' requirement) is not covered.
 */
const Common = require("./Common.LeagueRelics");

/** The spellbook (its key in the data) the last grimoire change left; unset until one. */
const PREVIOUS_SPELLBOOK_ATTRIBUTE = "league:grimoire-previous-spellbook";

let api;
let core;
let effect;

function text(key, values = {}) {
  return effect.messages[key].text.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
}

function bookByKey(key) {
  return effect.spellbooks.find((book) => book.key === key) ?? null;
}

function currentBook(player) {
  return effect.spellbooks.find((book) => core.MagicSpellbook[book.key] === player.getSpellbook()) ?? effect.spellbooks[0];
}

function previousBook(player) {
  return bookByKey(player.getAttribute(PREVIOUS_SPELLBOOK_ATTRIBUTE)) ?? null;
}

/** Refuses a main character; a league character holding the book is the only token it needs. */
function allowed(player) {
  if (Common.leagueOf(player) !== null) return true;
  player.sendMessage(text("notLeague"));
  return false;
}

/** The core swap; the book left is remembered for Previous Spellbook only when the book changed (not when refused, nor when already on it after an altar). */
function swap(player, book) {
  const locked = core.SpellbookLocks.spellbookLockedRefusal(player, core.MagicSpellbook[book.key]);
  if (locked) {
    player.sendMessage(locked);
    return;
  }
  const from = currentBook(player);
  const before = player.getSpellbook();
  core.MagicSpellbook.changeSpellbook(player, core.MagicSpellbook[book.key]);
  if (player.getSpellbook() !== before) player.setAttribute(PREVIOUS_SPELLBOOK_ATTRIBUTE, from.key);
}

function changeSpellbook({ player }) {
  if (!allowed(player)) return true;
  const current = currentBook(player);
  const pairs = effect.spellbooks.filter((book) => book !== current).flatMap((book) => [book.name, () => swap(player, book)]);
  api.sendMultiChatboxPrompt(player, text("choose"), ...pairs, text("cancel"), () => {});
  return true;
}

function previousSpellbook({ player }) {
  if (!allowed(player)) return true;
  const previous = previousBook(player);
  if (!previous) {
    player.sendMessage(text("noPrevious"));
    return true;
  }
  swap(player, previous);
  return true;
}

function checkPrevious({ player }) {
  if (!allowed(player)) return true;
  const previous = previousBook(player);
  player.sendMessage(previous ? text("checkPrevious", { book: previous.name }) : text("noPrevious"));
  return true;
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  effect = Common.data.effects.arcaneGrimoire;
  api.persistAttribute(PREVIOUS_SPELLBOOK_ATTRIBUTE);
  api.onItemAction(effect.item, {
    [effect.options.change]: changeSpellbook,
    [effect.options.previous]: previousSpellbook,
    [effect.options.check]: checkPrevious,
  });
};
