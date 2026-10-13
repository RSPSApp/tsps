/**
 * Blighted spell sacks (https://oldschool.runescape.wiki/w/Blighted_rune_sack) - the sacks
 * revenants drop and Justine's, the Soul Wars shop and Emir's Arena sell.
 *
 * A sack "functions like runes": carrying one lets the spells it covers be cast without any of
 * their runes, and one sack is spent per cast, whether or not the spell hits. Blighted is the
 * catch - they work only where players fight, which is the pvp-tagged ground (the Wilderness,
 * Ferox Enclave, the Revenant Caves and the Mage Arena bank inside it) plus the instanced
 * arenas named in data/blighted-sacks.json; the wiki's Soul Wars and Clan Wars brackets are
 * those arenas. Which spellbook is active and the Magic level still gate the cast, both already
 * checked by Spell.canCast, so the data lists spell ids only.
 *
 * Priority, per the user: the caster's own runes are what the spell asks for and are spent when
 * the inventory can pay them; a sack stands in only for a cost it cannot. The sack then replaces
 * the whole cost rather than topping it up, so a caster short of one rune pays a sack and keeps
 * the runes they were holding, never both.
 *
 * The swap goes through core's generic onSpellCost seam, which every cast path reads (the manual
 * click, autocast, the utility and Lunar self-casts, the bots' own "can I pay?" check), so one
 * answer covers them all. It is asked after core's rune bypasses, so a staff or a bot that
 * already clears the cost never spends a sack.
 *
 * The historical bind, snare and wave sacks (24609-24612) are empty cache slots - Poll 80
 * merged them into the entangle and surge sacks - so they carry no entry.
 */
const DATA = require("./data/blighted-sacks.json");

let core;
/** Cache name -> the item ids a player can actually hold, resolved from the cache once. */
let idsBySackName = null;
/** Arena areas that count, matched against Area.getName() since they are instanced. */
const allowedAreas = new Set(DATA.areas);

/** Engine spell id -> the cache name of the sack that pays its cost. */
const sackBySpell = new Map();
for (const sack of DATA.sacks) {
  for (const spell of sack.spells) {
    sackBySpell.set(spell.id, sack.item);
  }
}

/** An item's name, or undefined for a note, a placeholder or no item at all. */
function itemName(itemId) {
  if (!core?.CacheDefinitions.hasItem(itemId)) return undefined;
  const definition = core.CacheDefinitions.getItem(itemId);
  return definition && definition.noteTemplate < 0 && definition.placeholderTemplate < 0
    ? definition.name
    : undefined;
}

/**
 * Every id carrying each sack's cache name, so a renumbered cache still resolves and the
 * placeholder twins of a stackable sack (24608 for 24607, and the rest) are skipped: the
 * inventory only ever holds the stackable id a shop or drop hands out.
 */
function sackIds() {
  if (idsBySackName) return idsBySackName;
  const wanted = new Set(DATA.sacks.map((sack) => sack.item));
  idsBySackName = new Map();
  for (let id = 0; id < core.CacheDefinitions.getCounts().items; id++) {
    const name = itemName(id);
    if (!wanted.has(name)) continue;
    if (!idsBySackName.has(name)) idsBySackName.set(name, []);
    idsBySackName.get(name).push(id);
  }
  return idsBySackName;
}

/** Wiki (Blighted rune sack): usable "only in the Wilderness, Ferox Enclave, Mage Arena bank,
 * PvP worlds, Castle Wars, Clan Wars, and Soul Wars" - all pvp-tagged ground or a listed arena. */
function inBlightedZone(player) {
  if (core.Wilderness.isPvpArea(player.getLocation?.())) return true;
  const area = player.getArea?.();
  return area != null && allowedAreas.has(area.getName?.());
}

/** The sack of that family the caster holds, or undefined. Stackable, so any count is enough. */
function heldSack(player, name) {
  const inventory = player.getInventory();
  return (sackIds().get(name) ?? []).find((id) => inventory.getAmount(id) > 0);
}

/**
 * True when the inventory cannot pay the cost the spell asks for. Amounts are totalled per id
 * first: a spell can name the same rune twice, and core's own containsAllItem only asks whether
 * an id is present at all.
 */
function costUnpaid(player, items) {
  const required = new Map();
  for (const item of items) {
    const id = item.getId();
    required.set(id, (required.get(id) ?? 0) + item.getAmount());
  }
  const inventory = player.getInventory();
  for (const [id, amount] of required) {
    if (inventory.getAmount(id) < amount) return true;
  }
  return false;
}

/**
 * Pays a covered spell's whole cost with one carried sack, but only while the caster's own runes
 * cannot. Answering through onSpellCost - which every cast path reads - is what makes the manual
 * click, autocast, the utility and Lunar self-casts and the bots' "can I pay?" check all agree.
 */
function payWithSack(event) {
  const sack = sackBySpell.get(event.spellId);
  if (sack === undefined || !inBlightedZone(event.player)) return;
  // WHY [Prompt: "1. runes are consumed first"]: the caster's own runes pay whenever they can,
  // so a sack is the fallback for a cost the inventory cannot cover and never taxes both.
  if (!costUnpaid(event.player, event.items)) return;
  const held = heldSack(event.player, sack);
  if (held === undefined) return;
  event.cost = [new core.Item(held, 1)];
}

module.exports = {
  name: "BlightedSacks",
  members: true,
  _test: { payWithSack, inBlightedZone, sackIds, sackBySpell, costUnpaid },
  register(api) {
    core = api.core;
    api.onSpellCost(payWithSack);
  },
};
