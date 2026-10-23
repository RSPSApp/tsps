/**
 * Clue geodes (https://oldschool.runescape.wiki/w/Clue_geode): every successful mining action
 * rolls each clue tier the player does not already own, at
 * 1 in floor(floor(floor(base * 0.7) / (100 + Mining)) * tier modifier), where base is the rock's
 * rock golem base. Anything that emits "mining:success" with a petBase (rocks, crashed stars)
 * rolls them. Opening a geode gives the clue scroll.
 *
 * Capture: "You find a clue geode!" (spam). The text for opening one is not captured.
 */
let core = null;
let pluginApi = null;
let tiers = [];

function buildTiers(ids) {
  return [
    { name: "beginner", modifier: 0.2, geodeId: ids.CLUE_GEODE_BEGINNER_, scrollId: ids.CLUE_SCROLL_BEGINNER_ },
    { name: "easy", modifier: 1.7, geodeId: ids.CLUE_GEODE_EASY_, scrollId: ids.CLUE_SCROLL_EASY_ },
    { name: "medium", modifier: 2, geodeId: ids.CLUE_GEODE_MEDIUM_, scrollId: ids.CLUE_SCROLL_MEDIUM_ },
    { name: "hard", modifier: 3.3, geodeId: ids.CLUE_GEODE_HARD_, scrollId: ids.CLUE_SCROLL_HARD_ },
    { name: "elite", modifier: 10, geodeId: ids.CLUE_GEODE_ELITE_, scrollId: ids.CLUE_SCROLL_ELITE_ },
  ];
}

/** 1 in this many for one tier (Wiki formula; the visible Mining level). */
function geodeChance(petBase, miningLevel, modifier) {
  return Math.floor(Math.floor(Math.floor(petBase * 0.7) / (100 + miningLevel)) * modifier);
}

// OSRS allows one clue of each tier at a time, in any of its forms, carried or banked.
function ownsClue(player, tier) {
  const request = { player, tier: tier.name, allowed: null };
  pluginApi?.emitCustomEvent?.("treasure-trails:can-receive", request);
  if (typeof request.allowed === "boolean") return !request.allowed;
  const names = new Set(
    ["Clue scroll", "Clue bottle", "Clue nest", "Clue geode", "Scroll box"].map((form) => `${form} (${tier.name})`)
  );
  const contains = (container) =>
    container?.getItems?.().some(
      (item) => item?.getAmount() > 0 && names.has(core.ItemDefinition.forId(item.getId()).getName())
    );
  if (contains(player.getInventory())) {
    return true;
  }
  return Array.from({ length: core.Bank.TOTAL_BANK_TABS }, (_, tab) => player.getBank(tab)).some(contains);
}

function giveGeode(player, geodeId) {
  const request = {player, itemId: geodeId, box: false};
  pluginApi?.emitCustomEvent?.("treasure-trails:clue-item", request);
  geodeId = request.itemId;
  const inventory = player.getInventory();
  inventory.forceAdd(player, new core.Item(geodeId, 1));
  player.sendMessage("You find a clue geode!");
}

function rollClueGeodes({ player, skill, petBase }, random = Math.random) {
  if (!player || skill !== core.Skill.MINING || !(petBase > 0)) {
    return;
  }
  const level = player.getSkillManager().getCurrentLevel(core.Skill.MINING);
  for (const tier of tiers) {
    const chance = geodeChance(petBase, level, tier.modifier);
    if (chance < 1 || Math.floor(random() * chance) !== 0 || ownsClue(player, tier)) {
      continue;
    }
    giveGeode(player, tier.geodeId);
  }
}

function openClueGeode(event) {
  const request = {...event, handled: false};
  pluginApi?.emitCustomEvent?.("treasure-trails:open-vessel", request);
  if (request.handled) return true;
  const { player } = event;
  const tier = tiers.find((entry) => entry.geodeId === event.itemId);
  if (!tier) {
    return false;
  }
  const inventory = player.getInventory();
  const item = inventory.getItems()[event.slot];
  if (item?.getId() !== tier.geodeId || item.getAmount() < 1 || event.item && event.item !== item) return true;
  inventory.deleteAtSlot(event.slot, 1);
  inventory.adds(tier.scrollId, 1);
  player.sendMessage("You open the geode and find a clue scroll.");
  return true;
}

function attach(api) {
  pluginApi = api;
  core = api.core;
  tiers = buildTiers(core.ItemIdentifiers);
  for (const tier of tiers) {
    api.onItemAction(`Clue geode (${tier.name})`, { Open: openClueGeode });
  }
  api.onCustomEvent("mining:success", rollClueGeodes);
}

module.exports = { attach, rollClueGeodes, geodeChance };
