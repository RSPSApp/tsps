const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { TeleportHandler } = require("../../src/main/typescript/elvarg/game/model/teleportation/TeleportHandler");
const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");
const {
  createHotspotAnchorLocation,
  getEnabledWildernessHotspots,
} = require("../bots/behaviours/pvp/WildernessHotspotRegistry.js");

const HOME_TELEPORT_BUTTON_IDS = new Set([19210, 21741]);
const TRAINING_TELEPORT_BUTTON_IDS = new Set([1164, 13035, 30064]);
const PVP_TELEPORT_BUTTON_IDS = new Set([1170, 13053, 30083]);
const BOSS_MENU_BUTTON_IDS = new Set([7455, 13087, 30138]);
const BOSS_TELEPORT_BUTTON_IDS = new Set([
  28151, 28152, 28153, 28154,
  28155, 28156, 28157, 28158,
  28159,
]);
const PVP_DIALOGUE_OPTION_BUTTON_IDS = new Set([
  2494, 2495, 2496, 2497, 2498,
  2482, 2483, 2484, 2485,
]);
const ATTR_PVP_TELEPORT_PAGE = "teleports:pvp_page";
const ATTR_BOSS_TELEPORT_PAGE = "teleports:boss_page";
const ATTR_COUNT_DRAYNOR_PENDING_INSTANCE = "count_draynor:pending_instance";
const ATTR_ELVARG_PENDING_INSTANCE = "elvarg:pending_instance";
const DIALOGUE_OPTION_BUTTON_IDS = [2494, 2495, 2496, 2497, 2498, 2482, 2483, 2484, 2485];

// Approximate Chaos Temple surface location matching the current bot hotspot anchor.
const TRAINING_TELEPORT_DESTINATION = new Location(2955, 3816, 0);
// Count Draynor lives in Draynor Manor's basement (OSRS).
const COUNT_DRAYNOR_TELEPORT_DESTINATION = new Location(3077, 9772, 0);
// Deranged archaeologist lives at the south end of the Tar Swamp (3683, 3706);
// this tile south of him is walkable and connected, verified live.
const DERANGED_ARCHAEOLOGIST_TELEPORT_DESTINATION = new Location(3682, 3700, 0);
// Elvarg lives in the Crandor/Karamja dungeon lair (OSRS).
const ELVARG_TELEPORT_DESTINATION = new Location(2852, 9637, 0);
const BOSS_TELEPORT_DESTINATIONS = new Map([
  [28151, new Location(3290, 3847, 0)], // Callisto
  [28152, new Location(3261, 3927, 0)], // Chaos Elemental
  [28153, new Location(2979, 3846, 0)], // Chaos Fanatic
  [28154, new Location(2977, 3702, 0)], // Crazy Archaeologist
  [28155, new Location(3010, 3849, 0)], // King Black Dragon entrance
  [28156, new Location(3233, 10341, 0)], // Scorpia
  [28157, new Location(3332, 3734, 0)], // Venenatis
  [28158, new Location(3219, 3788, 0)], // Vet'ion
  [28159, COUNT_DRAYNOR_TELEPORT_DESTINATION], // Count Draynor
]);

function destinationMatches(destination, target) {
  return (
    destination &&
    target &&
    destination.getX?.() === target.getX?.() &&
    destination.getY?.() === target.getY?.() &&
    destination.getZ?.() === target.getZ?.()
  );
}

function setBossInstancePending(player, destination) {
  player.setAttribute(
    ATTR_COUNT_DRAYNOR_PENDING_INSTANCE,
    destinationMatches(destination, COUNT_DRAYNOR_TELEPORT_DESTINATION) === true
  );
  player.setAttribute(
    ATTR_ELVARG_PENDING_INSTANCE,
    destinationMatches(destination, ELVARG_TELEPORT_DESTINATION) === true
  );
}

function sendFiveOptionDialogue(player, title, options) {
  player.getPacketSender().sendString(title, 2493);
  for (let i = 0; i < 5; i++) {
    player.getPacketSender().sendString(options[i] ?? "", 2494 + i);
  }
  player.getPacketSender().sendChatboxInterface(2492);
}

function closeTeleportDialogue(player) {
  player.setAttribute(ATTR_PVP_TELEPORT_PAGE, null);
  player.setAttribute(ATTR_BOSS_TELEPORT_PAGE, null);
  player.getPacketSender().sendInterfaceRemoval();
}

function getDialoguePageIndex(player, attributeKey) {
  const raw = player.getAttribute(attributeKey);
  if (Number.isInteger(raw)) {
    return raw;
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }
  return null;
}

function getPvPTeleportPages() {
  const hotspotOrder = [
    "edge_ditch",
    "varrock_ditch",
    "revs_entrance",
    "green_drags_gate",
  ];
  const hotspotsById = new Map(
    getEnabledWildernessHotspots().map((hotspot) => [hotspot.id, hotspot])
  );
  const orderedHotspots = hotspotOrder
    .map((id) => hotspotsById.get(id))
    .filter(Boolean);

  return [
    {
      title: "PvP hotspots",
      options: [
        { label: "Edge Ditch", hotspot: orderedHotspots.find((h) => h.id === "edge_ditch") ?? null },
        { label: "Varrock Ditch (F2P)", hotspot: orderedHotspots.find((h) => h.id === "varrock_ditch") ?? null },
        { label: "Revs Entrance", hotspot: orderedHotspots.find((h) => h.id === "revs_entrance") ?? null },
        { label: "Green Dragons", hotspot: orderedHotspots.find((h) => h.id === "green_drags_gate") ?? null },
        { label: "More options", nextPage: 1 },
      ],
    },
    {
      title: "PvP hotspots",
      options: [
        { label: "Back", nextPage: 0 },
        { label: "Close", close: true },
        null,
        null,
        null,
      ],
    },
  ];
}

function openPvPTeleportDialogue(player, pageIndex = 0) {
  const pages = getPvPTeleportPages();
  const page = pages[pageIndex] ?? pages[0];
  player.setAttribute(ATTR_PVP_TELEPORT_PAGE, pageIndex);
  player.setAttribute(ATTR_BOSS_TELEPORT_PAGE, null);
  sendFiveOptionDialogue(
    player,
    page.title,
    page.options.map((option) => option?.label ?? "")
  );
}

function handlePvPTeleportOption(player, buttonId) {
  const pageIndex = getDialoguePageIndex(player, ATTR_PVP_TELEPORT_PAGE);
  if (!Number.isInteger(pageIndex)) {
    return false;
  }

  const optionIndex = DIALOGUE_OPTION_BUTTON_IDS.indexOf(Number(buttonId));
  if (optionIndex === -1) {
    return false;
  }

  const page = getPvPTeleportPages()[pageIndex];
  const option = page?.options?.[optionIndex];
  if (!option) {
    closeTeleportDialogue(player);
    return true;
  }

  if (option.close) {
    closeTeleportDialogue(player);
    return true;
  }

  if (Number.isInteger(option.nextPage)) {
    openPvPTeleportDialogue(player, option.nextPage);
    return true;
  }

  if (!option.hotspot) {
    closeTeleportDialogue(player);
    return true;
  }

  const destination = createHotspotAnchorLocation(option.hotspot);
  closeTeleportDialogue(player);
  if (!destination || !TeleportHandler.checkReqs(player, destination)) {
    setBossInstancePending(player, null);
    return true;
  }
  setBossInstancePending(player, destination);

  TeleportHandler.teleport(
    player,
    destination,
    player.getSpellbook().getTeleportType(),
    false
  );
  return true;
}

function getBossTeleportPages() {
  return [
    {
      title: "Boss teleports",
      options: [
        { label: "Callisto", destination: BOSS_TELEPORT_DESTINATIONS.get(28151) },
        { label: "Chaos Elemental", destination: BOSS_TELEPORT_DESTINATIONS.get(28152) },
        { label: "Chaos Fanatic", destination: BOSS_TELEPORT_DESTINATIONS.get(28153) },
        { label: "Crazy Archaeologist", destination: BOSS_TELEPORT_DESTINATIONS.get(28154) },
        { label: "More options", nextPage: 1 },
      ],
    },
    {
      title: "Boss teleports",
      options: [
        { label: "KBD", destination: BOSS_TELEPORT_DESTINATIONS.get(28155) },
        { label: "Scorpia", destination: BOSS_TELEPORT_DESTINATIONS.get(28156) },
        { label: "Venenatis", destination: BOSS_TELEPORT_DESTINATIONS.get(28157) },
        { label: "Vet'ion", destination: BOSS_TELEPORT_DESTINATIONS.get(28158) },
        { label: "More options", nextPage: 2 },
      ],
    },
    {
      title: "Boss teleports",
      options: [
        { label: "Count Draynor", destination: BOSS_TELEPORT_DESTINATIONS.get(28159) },
        { label: "Deranged Archaeologist", destination: DERANGED_ARCHAEOLOGIST_TELEPORT_DESTINATION },
        { label: "Elvarg", destination: ELVARG_TELEPORT_DESTINATION },
        { label: "Back", nextPage: 1 },
        { label: "Close", close: true },
      ],
    },
  ];
}

function openBossTeleportDialogue(player, pageIndex = 0) {
  const pages = getBossTeleportPages();
  const page = pages[pageIndex] ?? pages[0];
  player.setAttribute(ATTR_BOSS_TELEPORT_PAGE, pageIndex);
  player.setAttribute(ATTR_PVP_TELEPORT_PAGE, null);
  sendFiveOptionDialogue(
    player,
    page.title,
    page.options.map((option) => option?.label ?? "")
  );
}

function handleBossTeleportOption(player, buttonId) {
  const pageIndex = getDialoguePageIndex(player, ATTR_BOSS_TELEPORT_PAGE);
  if (!Number.isInteger(pageIndex)) {
    return false;
  }

  const optionIndex = DIALOGUE_OPTION_BUTTON_IDS.indexOf(Number(buttonId));
  if (optionIndex === -1) {
    return false;
  }

  const page = getBossTeleportPages()[pageIndex];
  const option = page?.options?.[optionIndex];
  if (!option) {
    closeTeleportDialogue(player);
    return true;
  }

  if (Number.isInteger(option.nextPage)) {
    openBossTeleportDialogue(player, option.nextPage);
    return true;
  }

  if (option.close) {
    closeTeleportDialogue(player);
    return true;
  }

  const destination = option.destination;
  closeTeleportDialogue(player);
  if (!destination || !TeleportHandler.checkReqs(player, destination)) {
    setBossInstancePending(player, null);
    return true;
  }
  setBossInstancePending(player, destination);

  TeleportHandler.teleport(
    player,
    destination,
    player.getSpellbook().getTeleportType(),
    false
  );
  return true;
}

function handleTeleportButton(player, buttonId) {
  if (!player) {
    return false;
  }

  const numericButtonId = Number(buttonId);
  if (HOME_TELEPORT_BUTTON_IDS.has(numericButtonId)) {
    if (!TeleportHandler.checkReqs(player, GameConstants.DEFAULT_LOCATION)) {
      setBossInstancePending(player, null);
      return true;
    }
    setBossInstancePending(player, GameConstants.DEFAULT_LOCATION);

    TeleportHandler.teleport(
      player,
      GameConstants.DEFAULT_LOCATION,
      player.getSpellbook().getTeleportType(),
      false
    );
    return true;
  }

  if (PVP_TELEPORT_BUTTON_IDS.has(numericButtonId)) {
    openPvPTeleportDialogue(player, 0);
    return true;
  }

  if (BOSS_MENU_BUTTON_IDS.has(numericButtonId)) {
    openBossTeleportDialogue(player, 0);
    return true;
  }

  if (PVP_DIALOGUE_OPTION_BUTTON_IDS.has(numericButtonId)) {
    if (handleBossTeleportOption(player, numericButtonId)) {
      return true;
    }
    return handlePvPTeleportOption(player, numericButtonId);
  }

  if (BOSS_TELEPORT_BUTTON_IDS.has(numericButtonId)) {
    const destination = BOSS_TELEPORT_DESTINATIONS.get(numericButtonId);
    if (!destination || !TeleportHandler.checkReqs(player, destination)) {
      setBossInstancePending(player, null);
      return true;
    }
    setBossInstancePending(player, destination);

    TeleportHandler.teleport(
      player,
      destination,
      player.getSpellbook().getTeleportType(),
      false
    );
    return true;
  }

  if (!TRAINING_TELEPORT_BUTTON_IDS.has(numericButtonId)) {
    return false;
  }

  if (!TeleportHandler.checkReqs(player, TRAINING_TELEPORT_DESTINATION)) {
    setBossInstancePending(player, null);
    return true;
  }
  setBossInstancePending(player, TRAINING_TELEPORT_DESTINATION);

  TeleportHandler.teleport(
    player,
    TRAINING_TELEPORT_DESTINATION,
    player.getSpellbook().getTeleportType(),
    false
  );
  return true;
}

module.exports = {
  name: "Teleports",
  register(api) {
    const allTeleportButtonIds = [
      ...HOME_TELEPORT_BUTTON_IDS,
      ...PVP_TELEPORT_BUTTON_IDS,
      ...BOSS_MENU_BUTTON_IDS,
      ...BOSS_TELEPORT_BUTTON_IDS,
      ...PVP_DIALOGUE_OPTION_BUTTON_IDS,
      ...TRAINING_TELEPORT_BUTTON_IDS,
    ];

    api.onButton(allTeleportButtonIds, ({ player, buttonId }) =>
      handleTeleportButton(player, buttonId)
    );

    api.onInterfaceActionButton(
      allTeleportButtonIds,
      ({ player, buttonId }) => handleTeleportButton(player, buttonId)
    );
  },
};
