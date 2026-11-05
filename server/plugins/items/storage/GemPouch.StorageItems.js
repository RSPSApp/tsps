/**
 * Gem pouch, satchel and tote (https://oldschool.runescape.wiki/w/Gem_containers): sewn at
 * Crafting 12, 39 and 81, holding 5, 10 and 20 of each uncut opal, jade and red topaz.
 *
 * From the sources: the cache's ops, the recipes, levels and XP, "any required component with
 * another" (Wiki, 3 June 2026) and mining gem rocks into an open one (Jagex's poll blog). Ours, with
 * no capture or transcript: every line here, that only mining fills an open one, and that an upgrade
 * comes out closed. Jagex's release notes say upgrades retain stored gems and lower tiers cannot be
 * acquired while a higher tier is owned. Equal-tier duplicates remain outside that stated rule.
 */
const Storage = require("./Common.StorageItems");

const NAMES = ["Gem pouch", "Open gem pouch", "Gem satchel", "Open gem satchel", "Gem tote", "Open gem tote"];
const TOTE_NAMES = ["Gem tote", "Open gem tote"];
const SATCHEL_NAMES = ["Gem satchel", "Open gem satchel"];
const SACK_NAMES = ["Gem sack", "Open gem sack"];
const TIERS = [["Gem pouch", "Open gem pouch"], SATCHEL_NAMES, TOTE_NAMES, SACK_NAMES];
const POUCH_HOLDS = 5;
const SATCHEL_HOLDS = 10;
const TOTE_HOLDS = 20;
const MESSAGE = {
  /** Ours (not captured). */
  NO_GEMS: "You have nothing suitable for storing in that.",
  /** Ours (not captured). */
  FULL: "It is too full to hold any more of those gems.",
  /** Ours (not captured). */
  EMPTY: "It is empty.",
};

let gems = null;

function gemIds() {
  gems ??= [...Storage.idsOf(Storage.DATA.semiPreciousGems)];
  return gems;
}

function holds(player) {
  const carried = Storage.carried(player, family);
  if (carried.some((item) => TOTE_NAMES.includes(Storage.nameOf(item)))) return TOTE_HOLDS;
  return carried.some((item) => SATCHEL_NAMES.includes(Storage.nameOf(item))) ? SATCHEL_HOLDS : POUCH_HOLDS;
}

const family = {
  key: "gem-pouch",
  names: NAMES,
  pairs: [["gem_pouch", "gem_pouch_open"], ["gem_satchel", "gem_satchel_open"], ["gem_tote", "gem_tote_open"]],
  openNames: ["Open gem pouch", "Open gem satchel", "Open gem tote"],
  accepts: (id) => gemIds().includes(id),
  room: (player, id, held) => holds(player) - (held.find((entry) => entry.id === id)?.amount ?? 0),
  gathers: (player, event) => event?.skill === Storage.core.Skill.MINING && Storage.hasOpen(player, family),
  bankEmpty: (player) => Storage.emptyToBank(player, family),
};

function fill({ player }) {
  const held = Storage.inventoryIds(player).filter(family.accepts);
  if (!held.length) {
    player.sendMessage(MESSAGE.NO_GEMS);
    return;
  }
  const moved = held.reduce((sum, id) => sum + Storage.fillFrom(player, family, id), 0);
  if (moved === 0) player.sendMessage(MESSAGE.FULL);
}

function check({ player }) {
  const counts = gemIds().map((id) => {
    const gem = Storage.itemName(id).replace(/^Uncut /, "");
    return `${gem.charAt(0).toUpperCase()}${gem.slice(1)}: ${Storage.amountOf(player, family, id)}`;
  });
  player.sendMessage(counts.join(" / "));
}

function empty({ player }) {
  if (Storage.core.Bank.isOpen(player)) {
    family.bankEmpty(player);
    return;
  }
  if (Storage.total(player, family) === 0) {
    player.sendMessage(MESSAGE.EMPTY);
    return;
  }
  Storage.emptyToInventory(player, family);
}

function toggle({ player, item }) {
  Storage.toggle(player, family, item);
}

// ------------------------------------------------------------------ Sewing

function recipes() {
  const { CacheDefinitions } = Storage.core;
  const id = (name) => CacheDefinitions.getObjId(name);
  return [
    { tier: 0, level: 12, xp: 25, product: id("gem_pouch"), bolt: id("bolt_of_linen"), pouches: [] },
    { tier: 1, level: 39, xp: 50, product: id("gem_satchel"), bolt: id("bolt_of_canvas"), pouches: [id("gem_pouch"), id("gem_pouch_open")] },
    { tier: 2, level: 81, xp: 200, product: id("gem_tote"), bolt: id("bolt_of_cotton"), pouches: [id("gem_satchel"), id("gem_satchel_open")] },
  ];
}

/** The recipe a pair of components means: one it names, or the one whose own parts are carried. */
function recipeFor(player, pair) {
  const { ItemIdentifiers: I } = Storage.core;
  const inventory = player.getInventory();
  const all = recipes();
  const shared = [I.NEEDLE, I.COSTUME_NEEDLE, I.THREAD, I.SILK];
  const owns = (recipe) => [recipe.bolt, ...recipe.pouches];
  if (!pair.every((id) => shared.includes(id) || all.some((recipe) => owns(recipe).includes(id)))) return null;
  const named = all.find((recipe) => pair.some((id) => owns(recipe).includes(id)));
  if (named) return named;
  return [...all].reverse().find((recipe) => inventory.contains(recipe.bolt)
    && (!recipe.pouches.length || recipe.pouches.some((id) => inventory.contains(id)))) ?? null;
}

function missingPart(player, recipe) {
  const { ItemIdentifiers: I } = Storage.core;
  const inventory = player.getInventory();
  const costume = inventory.contains(I.COSTUME_NEEDLE);
  if (!costume && !inventory.contains(I.NEEDLE)) return I.NEEDLE;
  if (!costume && !inventory.contains(I.THREAD)) return I.THREAD;
  if (!inventory.contains(I.SILK)) return I.SILK;
  if (!inventory.contains(recipe.bolt)) return recipe.bolt;
  if (recipe.pouches.length && !recipe.pouches.some((id) => inventory.contains(id))) return recipe.pouches[0];
  return null;
}

function sew(event) {
  if (event.handled) return;
  const { player, usedItemId, usedWithItemId } = event;
  if (usedItemId === usedWithItemId) return;
  // Jagex's 3 June 2026 update excludes needle and thread as a pair.
  const { NEEDLE, THREAD } = Storage.core.ItemIdentifiers;
  if ((usedItemId === NEEDLE && usedWithItemId === THREAD)
    || (usedItemId === THREAD && usedWithItemId === NEEDLE)) return;
  const recipe = recipeFor(player, [usedItemId, usedWithItemId]);
  if (!recipe) return;
  event.handled = true;
  const { core } = Storage;
  const { ItemIdentifiers: I } = core;
  const inventory = player.getInventory();
  const name = Storage.itemName(recipe.product).toLowerCase();
  if (player.getSkillManager().getCurrentLevel(core.Skill.CRAFTING) < recipe.level) {
    player.sendMessage(`You need a Crafting level of ${recipe.level} to make a ${name}.`);
    return;
  }
  const missing = missingPart(player, recipe);
  if (missing !== null) {
    player.sendMessage(`You need ${Storage.itemName(missing).toLowerCase()} to make a ${name}.`);
    return;
  }
  // The release notes disallow acquiring lower tiers, including when the higher one is banked.
  // A gem bag is a separate sack ingredient, not a tier of this family.
  if (TIERS.slice(recipe.tier + 1).some((names) => Storage.owns(player, { names }))) {
    player.sendMessage("You already own a higher-tier gem container.");
    return;
  }
  if (!inventory.contains(I.COSTUME_NEEDLE)) inventory.deleteNumber(I.THREAD, 1);
  inventory.deleteNumber(I.SILK, 1);
  inventory.deleteNumber(recipe.bolt, 1);
  const pouch = recipe.pouches.find((id) => inventory.contains(id));
  if (pouch !== undefined) inventory.deleteNumber(pouch, 1);
  inventory.adds(recipe.product, 1);
  player.getSkillManager().addExperiences(core.Skill.CRAFTING, recipe.xp);
  player.sendMessage(`You sew a ${name}.`);
}

module.exports = (api) => {
  Storage.register(family);
  for (const name of NAMES) {
    api.onItemAction(name, { Fill: fill, Open: toggle, Close: toggle, Check: check, Empty: empty });
  }
  api.onItemOnItem(sew, { noted: false });
};

Object.assign(module.exports, { NAMES, POUCH_HOLDS, SATCHEL_HOLDS, TOTE_HOLDS, MESSAGE });
