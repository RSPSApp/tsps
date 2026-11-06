/**
 * Clue nests (OSRS Wiki): every log rolls each clue tier the player does not already own, at
 * 1 in floor(floor(base * CA) / (100 + Woodcutting) * tier modifier), where base is the tree's
 * beaver rate. The matching CA reward reduces base by 5%, and an imbued ring doubles nonbeginner
 * clue chances while chopping in the Wilderness; see Wiki: Clue nest (beginner) for its exception.
 * The woodcutting cape's nest bonus does not apply. Opening a nest gives the clue scroll and
 * an empty bird nest.
 */
let core = null;
let pluginApi = null;
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

function rollClueNests(player, tree) {
  if (!tree.petBase) {
    return;
  }
  const level = player.getSkillManager().getCurrentLevel(core.Skill.WOODCUTTING);
  const location = player.getLocation?.();
  const I = core.ItemIdentifiers;
  const rings = [I.RING_OF_WEALTH_I_, I.RING_OF_WEALTH_I1_, I.RING_OF_WEALTH_I2_,
    I.RING_OF_WEALTH_I3_, I.RING_OF_WEALTH_I4_, I.RING_OF_WEALTH_I5_, I.RING_OF_WEALTH_I1__2, I.RING_OF_WEALTH_I5__2];
  const wildernessRing = location && core.Wilderness?.isInLocation?.(location) &&
    core.Wilderness?.levelAt?.(location.getX(), location.getY()) > 0 &&
    rings.some(id => Number.isInteger(id) && player.getEquipment?.()?.contains?.(id));
  for (const tier of tiers) {
    // Content may make clue nests commoner ("treasure-trails:vessel-chance", a league relic): `multiplier` times.
    const boost = { player, vessel: "nest", tier: tier.name, multiplier: 1 };
    pluginApi?.emitCustomEvent?.("treasure-trails:vessel-chance", boost);
    if (boost.allowed === false) continue;
    const achievement = { player, tier: tier.name, currentThresholdMet: false };
    if (tier.name !== "beginner") pluginApi?.emitCustomEvent?.("combat-achievements:tier", achievement);
    const adjusted = achievement.currentThresholdMet === true ? Math.floor(tree.petBase * 95 / 100) : Math.floor(tree.petBase);
    const base = Math.floor((adjusted / (100 + level)) * tier.modifier);
    const chance = base < 1 ? base : Math.max(1, Math.floor(base / (boost.multiplier > 1 ? boost.multiplier : 1)));
    const ringMultiplier = wildernessRing && tier.name !== "beginner" ? 2 : 1;
    if (chance < 1 || Math.random() * chance >= ringMultiplier || ownsClue(player, tier)) {
      continue;
    }
    const reward = {player, itemId: tier.nestId, box: false};
    pluginApi?.emitCustomEvent?.("treasure-trails:clue-item", reward);
    if (reward.box) {
      player.getInventory().forceAdd(player, new core.Item(reward.itemId, 1));
      if (core.WorldDefinition.isMembersWorld()) core.ItemOnGroundManager.registers(player, new core.Item(core.ItemIdentifiers.BIRD_NEST_6, 1));
    } else core.ItemOnGroundManager.registers(player, new core.Item(tier.nestId, 1));
    player.sendMessage("<col=ff0000>A bird's nest falls out of the tree.");
  }
}

function openClueNest(event) {
  const request = {...event, handled: false};
  pluginApi?.emitCustomEvent?.("treasure-trails:open-vessel", request);
  if (request.handled) return true;
  const { player } = event;
  const tier = tiers.find((entry) => entry.nestId === event.itemId);
  if (!tier) {
    return false;
  }
  const inventory = player.getInventory();
  const item = inventory.getItems()[event.slot];
  if (item?.getId() !== tier.nestId || item.getAmount() < 1 || event.item && event.item !== item) return true;
  if (inventory.getFreeSlots() <= 0) {
    player.sendMessage("You need a free inventory space to open the bird's nest.");
    return true;
  }
  inventory.deleteAtSlot(event.slot, 1);
  inventory.adds(core.ItemIdentifiers.BIRD_NEST_6, 1);
  inventory.adds(tier.scrollId, 1);
  player.sendMessage("You take a clue scroll out of the bird's nest.");
  return true;
}

function attach(api) {
  pluginApi = api;
  core = api.core;
  tiers = buildTiers(core.ItemIdentifiers);
  for (const tier of tiers) {
    api.onItemAction(`Clue nest (${tier.name})`, { Open: openClueNest });
  }
}

module.exports = { attach, rollClueNests };
