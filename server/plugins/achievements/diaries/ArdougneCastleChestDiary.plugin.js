const DIARY = "ardougne";
const TASK = "steal-from-a-chest-in-ardougne-castle";
const CHEST_ID = 11739;
const CHEST_TILES = new Set(["2588,3291,1", "2588,3302,1"]);
const THIEVING_LEVEL = 72;
const THIEVING_XP = 500;
// Cache revision 241 places the "Old ruin entrance" (18270) on 2696,3283,0, which is clipped
// (getClipping 148770), so teleporting onto it leaves the player inside the scenery. Land on the
// walkable tile immediately east instead. The Wiki confirms the trap sends the player to the
// Witchaven Dungeon entrance but has no map of the exact OSRS landing tile (its talk page asks
// for one), so the precise tile remains an approximation.
const WITCHAVEN_DUNGEON_ENTRANCE = { x: 2697, y: 3283, z: 0 };

// Wiki pages report both 240 and 500 seconds, and do not establish whether both chests share a
// timer or each player has a timer. CHEST_COOLDOWN_MS is the server's adjustable policy setting.
// Its 500-second default avoids duplicate rewards; it does not claim OSRS uses a shared timer.
const CHEST_COOLDOWN_MS = 500_000;

let api;
const nextAvailableAt = new Map();
const busyChests = new Set();

function tileKey(location) {
  return `${location?.x},${location?.y},${location?.z}`;
}

function isChestLocation(location) {
  return CHEST_TILES.has(tileKey(location));
}

function alivePlayer(player) {
  return player?.isRegistered?.() === true && player.getHitpoints?.() > 0
    && !player.isDyingReturn?.() && player.getPrivateArea?.() === null;
}

function lootFor(core) {
  const ids = core.ItemIdentifiers;
  return [
    new core.Item(ids.COINS, 1000),
    new core.Item(ids.RAW_SHARK, 1),
    new core.Item(ids.ADAMANTITE_ORE, 1),
    new core.Item(ids.UNCUT_SAPPHIRE, 1),
  ];
}

function hasRoomForLoot(inventory, loot) {
  let requiredSlots = 0;
  for (const item of loot) {
    if (inventory.getAddableAmount(item) < item.getAmount()) return false;
    if (item.getDefinition().isStackable() && inventory.getAmount(item.getId()) > 0) continue;
    requiredSlots += item.getDefinition().isStackable() ? 1 : item.getAmount();
  }
  return inventory.getFreeSlots() >= requiredSlots;
}

function handleChest(event) {
  const { player, location } = event;
  if (event.objectId !== CHEST_ID || !isChestLocation(location)) return;

  // Claim every option on these exact placements before generic chest handlers can open them.
  event.handled = true;
  const option = String(event.option ?? "").trim().toLowerCase();
  if (option !== "search for traps") {
    if (option === "open") player.sendMessage("Opening this chest triggers its trap. The damage is not implemented. Search for traps instead.");
    return;
  }

  if (!alivePlayer(player)) return;
  if (player.getSkillManager().getCurrentLevel(api.core.Skill.THIEVING) < THIEVING_LEVEL) {
    player.sendMessage("You need a Thieving level of at least 72 to do this.");
    return;
  }

  const chestKey = tileKey(location);
  const now = Date.now();
  if (busyChests.has(chestKey)) return;
  if ((nextAvailableAt.get(chestKey) ?? 0) > now) {
    player.sendMessage("There's nothing left in the chest.");
    return;
  }

  const inventory = player.getInventory();
  const loot = lootFor(api.core);
  if (!hasRoomForLoot(inventory, loot)) {
    player.sendMessage("Not enough space in your inventory.");
    return;
  }

  busyChests.add(chestKey);
  try {
    // The preflight above and these synchronous adds form one inventory transaction. No cooldown,
    // XP, task credit, or teleport occurs unless every item fits.
    for (const item of loot) inventory.add(item, false);
    inventory.refreshItems();
    nextAvailableAt.set(chestKey, now + CHEST_COOLDOWN_MS);
    player.getSkillManager().addExperiences(api.core.Skill.THIEVING, THIEVING_XP);
    api.emitCustomEvent("thieving:success", {
      player, skill: api.core.Skill.THIEVING, method: "chest", target: "Ardougne Castle chest",
    });
    api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
    player.moveTo(new api.core.Location(
      WITCHAVEN_DUNGEON_ENTRANCE.x,
      WITCHAVEN_DUNGEON_ENTRANCE.y,
      WITCHAVEN_DUNGEON_ENTRANCE.z,
    ));
  } finally {
    busyChests.delete(chestKey);
  }
}

module.exports = {
  name: "ArdougneCastleChestDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(registry) {
    api = registry;
    api.onBeforeObjectInteraction(handleChest);
  },
  _test: {
    CHEST_COOLDOWN_MS,
    CHEST_ID,
    CHEST_TILES,
    TASK,
    THIEVING_LEVEL,
    THIEVING_XP,
    WITCHAVEN_DUNGEON_ENTRANCE,
    handleChest,
    isChestLocation,
    hasRoomForLoot,
    reset() {
      nextAvailableAt.clear();
      busyChests.clear();
    },
  },
};
