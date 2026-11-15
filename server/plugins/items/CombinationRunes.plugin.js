/**
 * Combination runes in spell costs (https://oldschool.runescape.wiki/w/Combination_rune): they
 * "simultaneously count as one of each type of the runes required to make them", and a cast "will
 * prioritise using those runes first, even while having sufficient runes otherwise". Aether runes
 * (https://oldschool.runescape.wiki/w/Aether_rune) "count as two separate runes: one cosmic rune and
 * one soul rune", so a spell needing either or both "will spend only one aether rune".
 *
 * `magic:spell-cost` gives the runes a cast still pays once staves and tomes have supplied theirs
 * (Spell.itemsToConsume, and the standard book's item spells in MagicOnItemPacketListener). This
 * rewrites that cost: the combination runes the player carries (inventory, or a rune source such as
 * the rune pouch) first pay both of their runes where the spell needs both, then either one, and
 * only the rest is left as plain runes.
 */

/** [combination rune, its two runes], by ItemIdentifiers name. */
const COMBINATIONS = Object.freeze([
  ["MIST_RUNE", "AIR_RUNE", "WATER_RUNE"],
  ["DUST_RUNE", "AIR_RUNE", "EARTH_RUNE"],
  ["MUD_RUNE", "WATER_RUNE", "EARTH_RUNE"],
  ["SMOKE_RUNE", "AIR_RUNE", "FIRE_RUNE"],
  ["STEAM_RUNE", "WATER_RUNE", "FIRE_RUNE"],
  ["LAVA_RUNE", "EARTH_RUNE", "FIRE_RUNE"],
  ["AETHER_RUNE", "COSMIC_RUNE", "SOUL_RUNE"],
]);

let core = null;

function combinations() {
  const I = core.ItemIdentifiers;
  return COMBINATIONS.map(([rune, first, second]) => ({ rune: I[rune], first: I[first], second: I[second] }));
}

function idOf(item) {
  return item?.getId?.() ?? item?.id;
}

/** How many of `runeId` the player can spend, up to `cap`: the inventory's, then a rune source's (rune pouch). */
function carried(player, runeId, cap) {
  const held = Math.min(cap, Math.max(0, player.getInventory().getAmount(runeId) | 0));
  for (let extra = cap - held; extra > 0; extra--) {
    if (core.PluginManager.checkSpellRuneSource(player, [new core.Item(runeId, extra)])) return held + extra;
  }
  return held;
}

/**
 * The cost with combination runes paying first: both runes where the spell needs both (across every
 * combination before any pays for one), then one. Non-runes and runes no combination makes stay as they are.
 */
function withCombinationRunes(player, items) {
  const need = new Map();
  for (const item of items) {
    const id = idOf(item);
    if (id == null) continue;
    need.set(id, (need.get(id) ?? 0) + item.getAmount());
  }
  const all = combinations().filter(({ first, second }) => (need.get(first) ?? 0) > 0 || (need.get(second) ?? 0) > 0);
  if (all.length === 0) return null;
  const spent = new Map();
  const left = new Map();
  for (const combo of all) {
    left.set(combo.rune, carried(player, combo.rune, Math.max(need.get(combo.first) ?? 0, need.get(combo.second) ?? 0)));
  }
  const spend = (combo, amount, ...runes) => {
    if (amount <= 0) return;
    left.set(combo.rune, left.get(combo.rune) - amount);
    spent.set(combo.rune, (spent.get(combo.rune) ?? 0) + amount);
    for (const rune of runes) need.set(rune, need.get(rune) - amount);
  };
  for (const combo of all) {
    spend(combo, Math.min(left.get(combo.rune), need.get(combo.first) ?? 0, need.get(combo.second) ?? 0), combo.first, combo.second);
  }
  for (const combo of all) {
    for (const rune of [combo.first, combo.second]) spend(combo, Math.min(left.get(combo.rune), need.get(rune) ?? 0), rune);
  }
  if (spent.size === 0) return null;
  const paid = [];
  const placed = new Set();
  for (const item of items) {
    const id = idOf(item);
    if (id == null || placed.has(id)) continue;
    placed.add(id);
    const amount = need.get(id);
    if (amount > 0) paid.push(amount === item.getAmount() ? item : new core.Item(id, amount));
  }
  for (const [rune, amount] of spent) paid.push(new core.Item(rune, amount));
  return paid;
}

/** `magic:spell-cost` { player, items }: combination runes pay first. */
function payWithCombinationRunes(cost) {
  if (!cost?.player || !Array.isArray(cost.items) || cost.items.length === 0) return;
  const paid = withCombinationRunes(cost.player, cost.items);
  if (paid) cost.items = paid;
}

module.exports = {
  name: "CombinationRunes",
  description: "Counts combination runes (mist, dust, mud, smoke, steam, lava) and aether runes as both of their runes in spell costs, spent before plain runes.",
  members: true,
  _test: { withCombinationRunes },
  register(api) {
    core = api.core;
    api.onCustomEvent("magic:spell-cost", payWithCombinationRunes);
  },
};
