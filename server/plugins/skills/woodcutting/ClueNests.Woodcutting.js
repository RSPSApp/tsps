/**
 * Clue nests (OSRS Wiki): every log rolls each clue tier the player does not already own, at
 * 1 in floor(floor(base) / (100 + Woodcutting) * tier modifier), where base is the tree's beaver
 * rate. The woodcutting cape's nest bonus does not apply. Opening a nest gives the clue scroll and
 * an empty bird nest.
 */
let core = null;
let tiers = [];

function buildTiers(ids) {
  return [
    { name: "beginner", modifier: 0.2, nestId: ids.CLUE_NEST_BEGINNER_, scrollId: ids.CLUE_SCROLL_BEGINNER_ },
    { name: "easy", modifier: 1.7, nestId: ids.CLUE_NEST_EASY_, scrollId: ids.CLUE_SCROLL_EASY_ },
    { name: "medium", modifier: 2, nestId: ids.CLUE_NEST_MEDIUM_, scrollId: ids.CLUE_SCROLL_MEDIUM_ },
    { name: "hard", modifier: 3.3, nestId: ids.CLUE_NEST_HARD_, scrollId: ids.CLUE_SCROLL_HARD_ },
    { name: "elite", modifier: 10, nestId: ids.CLUE_NEST_ELITE_, scrollId: ids.CLUE_SCROLL_ELITE_ },
  ];
}

// OSRS allows one clue of each tier at a time, in any of its forms, carried or banked.
function ownsClue(player, tier) {
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

function rollClueNests(player, tree) {
  if (!tree.petBase) {
    return;
  }
  const level = player.getSkillManager().getCurrentLevel(core.Skill.WOODCUTTING);
  for (const tier of tiers) {
    const chance = Math.floor((Math.floor(tree.petBase) / (100 + level)) * tier.modifier);
    if (chance < 1 || Math.floor(Math.random() * chance) !== 0 || ownsClue(player, tier)) {
      continue;
    }
    core.ItemOnGroundManager.registers(player, new core.Item(tier.nestId, 1));
    player.sendMessage("<col=ff0000>A bird's nest falls out of the tree.");
  }
}

function openClueNest(event) {
  const { player } = event;
  const tier = tiers.find((entry) => entry.nestId === event.itemId);
  if (!tier) {
    return false;
  }
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() <= 0) {
    player.sendMessage("You need a free inventory space to open the bird's nest.");
    return true;
  }
  inventory.deleteNumber(tier.nestId, 1);
  inventory.adds(core.ItemIdentifiers.BIRD_NEST_6, 1);
  inventory.adds(tier.scrollId, 1);
  player.sendMessage("You take a clue scroll out of the bird's nest.");
  return true;
}

function attach(api) {
  core = api.core;
  tiers = buildTiers(core.ItemIdentifiers);
  for (const tier of tiers) {
    api.onItemAction(`Clue nest (${tier.name})`, { Open: openClueNest });
  }
}

module.exports = { attach, rollClueNests };
