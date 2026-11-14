"use strict";

const { api, World, Animation, ChatType, CountdownTask, EffectSpells, Equipment, Flag, Location, Skill, ItemIdentifiers,
  ItemDefinition, PlayerRights, Task, TaskManager, DialogueChainBuilder, OptionDialogue } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const EstateAgent = require("./EstateAgent.Construction");
const Servants = require("./Servants.Construction");
const Estate = require("./Estate.Construction");
const Storage = require("./Storage.Construction");
const Portals = require("./Portals.Construction");
const Altars = require("./Altars.Construction");
const Data = require("./Data.Construction");
const Instance = require("./Instance.Construction");
const Commands = require("./Commands.Construction");
const JewelleryBox = require("./JewelleryBox.Construction");
const Menu = require("./Menu.Construction");
const Mounted = require("./Mounted.Construction");
const SuperiorGarden = require("./SuperiorGarden.Construction");
const GardenPlants = require("./GardenPlants.Construction");
const Lectern = require("./Lectern.Construction");
const Stairs = require("./Stairs.Construction");
const Workshop = require("./Workshop.Construction");
const Kitchen = require("./Kitchen.Construction");
const Workbench = require("./Workbench.Construction");
const Study = require("./Study.Construction");
const CombatRoom = require("./CombatRoom.Construction");
const Dungeon = require("./Dungeon.Construction");
const ThroneRoom = require("./ThroneRoom.Construction");
const Menagerie = require("./Menagerie.Construction");
const Decorations = require("./Decorations.Construction");
const GamesRoom = require("./GamesRoom.Construction");
const CombatRings = require("./CombatRings.Construction");
const Tea = require("./Tea.Construction");
const TipJar = require("./TipJar.Construction");
const Bookcase = require("./Bookcase.Construction");
const Scrying = require("./Scrying.Construction");
const CapeHanger = require("./CapeHanger.Construction");
const Trophies = require("./Trophies.Construction");
const MahoganyHomes = require("./MahoganyHomes.Construction");
const CarpenterOutfit = require("./CarpenterOutfit.Construction");
const MaxHouse = require("./MaxHouse.Construction");
const Nexus = require("./Nexus.Construction");
const ClockworkToys = require("./ClockworkToys.Construction");

const HAMMER_ID = ItemIdentifiers.HAMMER;
const HAMMERS = [HAMMER_ID, ItemIdentifiers.IMCANDO_HAMMER, ItemIdentifiers.IMCANDO_HAMMER_OFF_HAND_];
const SAW_ID = ItemIdentifiers.SAW;
const SAWS = [ItemIdentifiers.SAW, ItemIdentifiers.CRYSTAL_SAW, ItemIdentifiers.AMYS_SAW, ItemIdentifiers.AMYS_SAW_OFF_HAND_];
const TINDERBOX_ID = ItemIdentifiers.TINDERBOX;
// Wiki (Nails): with several kinds carried, the higher tier goes first.
const NAIL_IDS = [ItemIdentifiers.DRAGON_NAILS, ItemIdentifiers.RUNE_NAILS, ItemIdentifiers.ADAMANTITE_NAILS,
  ItemIdentifiers.MITHRIL_NAILS, ItemIdentifiers.BLACK_NAILS, ItemIdentifiers.STEEL_NAILS,
  ItemIdentifiers.IRON_NAILS, ItemIdentifiers.BRONZE_NAILS];
// The workshop's tool stores, in upgrade order.
const TOOL_STORES = ["TOOL_STORE_1", "TOOL_STORE_2", "TOOL_STORE_3", "TOOL_STORE_4", "TOOL_STORE_5"];
const BUILD_ANIMATION = Ids.seq("human_poh_build");
const BUILD_SOUND = 938;
// poh_portal_op: Yanille's portal once the Ardougne diary has changed it.
const DIARY_PORTAL_ID = Ids.loc("poh_portal_op");
const YANILLE_HOUSE_LOCATION_ID = 6;
const YANILLE_HOUSE_PORTAL_ID = Estate.HOUSE_LOCATIONS.find(location => location.id === YANILLE_HOUSE_LOCATION_ID).portal;
const YANILLE_HOUSE_PORTAL_LOCATION = { x: 2542, y: 3097, z: 0 };
const YANILLE_HOUSE_PORTAL_FOOTPRINT = api.core.CacheDefinitions.getObject(YANILLE_HOUSE_PORTAL_ID);
const ARDOUGNE_HARD_POH_TASK = "enter-your-poh-from-yanille";
const HOUSE_PORTAL_IDS = [...Estate.HOUSE_LOCATIONS.map(location => location.portal), DIARY_PORTAL_ID];
const EXIT_PORTAL_ID = Ids.loc("poh_exit_portal");
const HOUSE_LOCKED_VARBIT = Ids.varbit("poh_house_locked");
const GARDEN_CENTERPIECE_HOTSPOT_ID = Ids.loc("poh_crude_garden_1"); // the garden's centrepiece space
const ROOM_DOOR_HOTSPOT_IDS = [...new Set([...Data.ROOM_DOOR_HOTSPOT_IDS, ...Estate.HOUSE_STYLES.flatMap(style => style.doorHotspots)])];
const COINS_ID = ItemIdentifiers.COINS;
const { HOUSE_ATTRIBUTE } = Data;
const FURNITURE_BUILD_INTERFACE = Ids.iface("poh_furniture_creation");
const FURNITURE_BUILD_LIST_UID = (FURNITURE_BUILD_INTERFACE << 16) | 2;
// poh_furniture_creation's scripts: one furniture entry, then the list (no gamevals for scripts).
const FURNITURE_ENTRY_SCRIPT = 1404;
const FURNITURE_LIST_SCRIPT = 1406;
const REMOVE_ANIMATION = Ids.seq("human_throw_away");
const HOUSE_BOARD_INTERFACE = Ids.iface("poh_board");
// poh_board_addline (row, "name|location|level|altar|nexus|jewellery box|pool|spellbook altar|
// armour stand|time|", board location). The rows are 1-200; an empty row 200 ends the list.
const HOUSE_BOARD_ROW_SCRIPT = 3110;
const HOUSE_BOARD_LAST_ROW = 200;
const HOUSE_BOARD_LOCATION_VARBIT = Ids.varbit("poh_board_last_loc");
const HOUSE_BOARD_ADVERTISING_VARBIT = Ids.varbit("poh_board_advertising");
const HOUSE_BOARD_ROWS = Ids.component("poh_board:button");
const HOUSE_BOARD_HOURGLASS = Ids.component("poh_board:hourglass");
const HOUSE_BOARD_ADD_REMOVE = Ids.component("poh_board:addremove") & 0xffff;
const HOUSE_BOARD_REFRESH = Ids.component("poh_board:refresh_button") & 0xffff;
const HOURGLASS_ANIMATION = Ids.seq("sandtimer_30secs");
const ADVERT_LEVEL = 50;
const ADVERT_MINUTES = 30;
const MINUTE_MS = 60_000;
const ADVERT_TICKS = ADVERT_MINUTES * 100;

// Expand the named furniture groups used by parlour hotspot menus.
const FURNITURE_GROUPS = {
  PARLOUR_CHAIRS: ["CRUDE_WOODEN_CHAIR", "WOODEN_CHAIR", "ROCKING_CHAIR", "OAK_CHAIR", "OAK_ARMCHAIR", "TEAK_ARMCHAIR", "MAHOGANY_ARMCHAIR"],
  RUGS: ["BROWN_RUG", "RUG", "OPULENT_RUG"],
  BOOKCASES: ["WOODEN_BOOKCASE", "OAK_BOOKCASE", "MAHOGANY_BOOKCASE"],
  FIREPLACES: ["CLAY_FIREPLACE", "STONE_FIREPLACE", "MARBLE_FIREPLACE"],
  CURTAIN: ["TORN_CURTAINS", "CURTAINS", "OPULENT_CURTAINS"],
  // Dungeon spaces, in the house viewer's order (cache table 111/112).
  GUARDS: ["SKELETON_GUARD", "GUARD_DOG", "HOBGOBLIN", "BABY_RED_DRAGON", "HUGE_SPIDER", "TROLL_GUARD", "HELLHOUND"],
  DUNGEON_TRAPS: ["SPIKE_TRAP", "MAN_TRAP", "TANGLE_VINE", "MARBLE_TRAP", "TELEPORT_TRAP"],
  DUNGEON_DOORS: ["OAK_DOOR", "STEEL_PLATED_DOOR", "MARBLE_DOOR"],
  DUNGEON_LIGHTINGS: ["CANDLES", "TORCH", "SKULL_TORCH"],
  DUNGEON_DECORATIONS: ["DECORATIVE_BLOOD", "DECORATIVE_PIPE", "HANGING_SKELETON"],
  // The hall and dungeon stair spaces take a rug or a staircase (cache hotspot row stair_hotspot).
  HALL_STAIRS_UP: ["HALL_RUG", "HALL_OPULENT_RUG", "OAK_STAIRCASE_UP", "TEAK_STAIRCASE_UP", "SPIRAL_STAIRCASE", "MARBLE_STAIRCASE_UP", "MARBLE_SPIRAL_STAIRCASE"],
  HALL_STAIRS_DOWN: ["HALL_RUG", "HALL_OPULENT_RUG", "OAK_STAIRCASE_DOWN", "TEAK_STAIRCASE_DOWN", "SPIRAL_STAIRCASE", "MARBLE_STAIRCASE_DOWN", "MARBLE_SPIRAL_STAIRCASE"],
};

const HOUSE_OPTIONS_INTERFACE = Ids.iface("poh_options");
const SETTINGS_SIDE_INTERFACE = Ids.iface("settings_side");
const OPTIONS_VARBITS = {
  location: Ids.varbit("poh_house_location"), style: Ids.varbit("poh_house_style"), buildingMode: Ids.varbit("poh_building_mode"),
  teleportOutside: Ids.varbit("poh_tele_toggle"), defaultBuildingMode: Ids.varbit("poh_teleport_building_mode"),
  doors: Ids.varbit("poh_doors_option"),
};
const SETTINGS_TARGET_UID = Ids.component("toplevel_osrs_stretch:side11");
const HOUSE_KICK_OPTION = 7;
// The click House Options' settings (teleport, default building mode, doors) play.
const OPTION_SOUND = 2266;
const houseOptionsOpen = new WeakSet();

// The loading screen for entering a house.
const LOADING_INTERFACE = Ids.iface("poh_loading");
const OVERLAY_ATMOSPHERE_UID = Ids.component("toplevel_osrs_stretch:overlay_atmosphere");
const PORTAL_SOUND = 984;
// Ours: the loading jingle for a style none of the recorded houses had.
const DEFAULT_LOADING_JINGLE = 112;
const MINIMAP_STATE_VARBIT = Ids.varbit("minimap_state");
const BUSY_VARBIT = Ids.varbit("busy");
const MINIMAP_OFF = 2;
const loadingHouses = new WeakSet();
// Where each player stood when they last clicked a house portal, to tell whether they walked to it.
const portalClickTiles = new WeakMap();
const NAME_INPUT_SCRIPT = 109; // meslayer_mode8, answered by resume_p_namedialog
const VISIT_PROMPT = "Enter name:";
const VISIT_OFFLINE = "That player is offline, or has privacy mode enabled.";
const IRONMAN_VISIT = "Ironmen do not visit their friends.<br>Ironmen stand alone.";
const IRON_MODES = ["ironman", "ultimate", "hardcore"];
const kickOptionVisible = new WeakSet();

const activeHouses = new WeakMap();
// Advertised houses by owner: { since } (Date.now() when placed). Last advert time by username,
// for the once-every-30-minutes limit.
const adverts = new Map();
const lastAdvertised = new Map();
const lastVisited = new WeakMap();
const pendingFurnitureMenus = new WeakMap();

function defaultHouse() {
  return require("./StorageState.Construction").defaultHouse();
}

function houseStateFor(player) {
  const saved = player.getAttribute(HOUSE_ATTRIBUTE);
  if (saved && typeof saved === "object" && Array.isArray((saved).rooms)) {
    const house = saved;
    const movedStarter = moveLegacyStarterHouse(house);
    const addedBuildingMode = typeof house.defaultBuildingMode !== "boolean";
    if (addedBuildingMode) house.defaultBuildingMode = false;
    if (addedBuildingMode || movedStarter) player.setAttribute(HOUSE_ATTRIBUTE, house);
    return house;
  }

  const house = defaultHouse();
  player.setAttribute(HOUSE_ATTRIBUTE, house);
  return house;
}

function moveLegacyStarterHouse(house) {
  const rooms = house.rooms;
  const used = rooms.flat(2).filter((room) => room != null);
  const garden = rooms[1]?.[1]?.[1];
  const parlour = rooms[1]?.[1]?.[2];
  if (used.length !== 2 || garden?.roomKey !== "GARDEN" || parlour?.roomKey !== "PARLOUR") return false;
  rooms[1][1][1] = null;
  rooms[1][1][2] = null;
  rooms[1][4][4] = garden;
  rooms[1][4][5] = parlour;
  return true;
}

function houseFor(player) {
  const area = player.getPrivateArea();
  return area instanceof Instance.PlayerHouseInstance ? area : null;
}

function isBuildingMode(player) {
  const house = houseFor(player);
  return house?.owner === player && house.buildingMode;
}

function releaseHouse(player, restoreLocation) {
  const owned = activeHouses.get(player);
  if (houseFor(player)) exitHouse(player);
  if (owned) {
    for (const guest of owned.getPlayers().slice()) exitHouse(guest);
    owned.destroy();
    activeHouses.delete(player);
  }
  pendingFurnitureMenus.delete(player);
  if (restoreLocation && Instance.PlayerHouseInstance.isAllocationLocation(player.getLocation())) player.moveTo(Estate.houseExit(houseStateFor(player)));
}

/** "construction:owns-house" { player, owns }: whether the player has bought a house. */
function ownsHouse(request) {
  if (request?.player) request.owns = houseStateFor(request.player).owned !== false;
}

/**
 * "construction:grant-house" { player, granted }: gives a starter house in Rimmington when the
 * player has none (Daddy's Home). `granted` stays false if they already own one, so the caller
 * can pay the Wiki's 1,000 coins instead.
 */
function grantHouse(request) {
  if (!request?.player) return;
  const house = houseStateFor(request.player);
  if (house.owned !== false) {
    request.granted = false;
    return;
  }
  house.owned = true;
  house.location = 1;
  house.style = 0;
  request.player.setAttribute(HOUSE_ATTRIBUTE, house);
  syncHouseOptions(request.player);
  request.granted = true;
}

/** Refusals before entering your own house: guests or a follower in the way, or a locked Bank PIN. */
function entryRefused(player, buildingMode, via, resume) {
  let house = activeHouses.get(player);
  if (house?.isDestroyed()) house = undefined;
  if (buildingMode && house?.getPlayers().some(guest => guest !== player)) {
    player.sendMessage("You cannot enter building mode if there are other players in the house.");
    return true;
  }
  if (buildingMode && via !== "teleport" && hasFollower(player)) {
    player.sendMessage("You should pick up your follower before entering building mode.");
    return true;
  }
  if (buildingMode) {
    // The Bank PIN guards this (Wiki: Bank_PIN); a locked PIN asks first, then reopens it.
    const pin = { player, feature: "poh-building-mode", resume };
    api.emitCustomEvent("bank-pin:guard", pin);
    if (pin.locked) return true;
  }
  return false;
}

function ownsAHouse(player) {
  if (houseStateFor(player).owned !== false) return true;
  player.sendMessage("You do not own a house. Speak to an Estate agent to buy one.");
  return false;
}

/**
 * `via` is where the entry came from: "portal", "options" (House Options' building mode buttons,
 * which say "Building mode is now on/off.") or "teleport". Entering itself sends no chat line.
 */
function enterHouse(player, buildingMode, diaryEntryContext = null, via = "teleport") {
  const canCreditDiaryTask = isCurrentYanilleHouseEntry(player, diaryEntryContext);
  if (!ownsAHouse(player)) return false;
  if (entryRefused(player, buildingMode, via, () => enterHouse(player, true, diaryEntryContext, via))) return true;
  player.getPacketSender().sendInterfaceRemoval();
  houseViewers.delete(player);
  pendingRoomMenus.delete(player);
  pendingFurnitureMenus.delete(player);
  const house = openHouse(player);
  if (houseFor(player) && houseFor(player) !== house) exitHouse(player);
  if (buildingMode) endAdvert(player);
  if (!house.enterHouse(player, buildingMode)) {
    releaseHouse(player, true);
    player.sendMessage("Unable to load your house.");
    return false;
  }
  api.emitCustomEvent("combat:clear-burn", { target: player });
  player.getPacketSender().sendVarbit(HOUSE_LOCKED_VARBIT, house.save.locked ? 1 : 0);
  syncHouseOptions(player);
  syncKickOption(player);
  if (via === "options") player.sendMessage(buildingMode ? "Building mode is now on." : "Building mode is now off.");
  if (canCreditDiaryTask && house.owner === player && houseFor(player) === house) {
    api.emitCustomEvent("diary:task", { player, diary: "ardougne", task: ARDOUGNE_HARD_POH_TASK });
  }
  return true;
}

/** `owner`'s loaded house, loading it first if it isn't (the owner stays where they are). */
function openHouse(owner) {
  let house = activeHouses.get(owner);
  if (house && !house.isDestroyed()) return house;
  house = new Instance.PlayerHouseInstance(houseStateFor(owner));
  house.owner = owner;
  activeHouses.set(owner, house);
  return house;
}

/** Each house style has its own loading jingle (house-styles.json `loadingJingle`). */
function loadingJingle(save) {
  return Estate.HOUSE_STYLES[Estate.houseStyleIndex(save)]?.loadingJingle ?? DEFAULT_LOADING_JINGLE;
}

/**
 * The loading screen: the minimap goes off, the camera resets and poh_loading covers the game.
 * Portals and visits play the portal's sound with it; `jingle` (a house save) adds that house's
 * loading jingle and sets `busy`.
 */
function showHouseLoading(player, { sound = true, jingle = null } = {}) {
  const sender = player.getPacketSender();
  if (sound) sender.sendSound(PORTAL_SOUND, 1, 0);
  sender.sendVarbit(MINIMAP_STATE_VARBIT, MINIMAP_OFF);
  sender.sendCameraReset();
  sender.sendSubInterface(OVERLAY_ATMOSPHERE_UID, LOADING_INTERFACE, 1);
  if (jingle) playLoadingJingle(player, jingle);
}

function playLoadingJingle(player, save) {
  player.getPacketSender().sendJingle(loadingJingle(save));
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
}

function hideHouseLoading(player) {
  const sender = player.getPacketSender();
  sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID);
  sender.sendVarbit(MINIMAP_STATE_VARBIT, 0);
  sender.sendVarbit(BUSY_VARBIT, 0);
}

function tileOf(player) {
  const location = player.getLocation();
  return `${location.getX()},${location.getY()},${location.getZ()}`;
}

/**
 * Runs `steps` ({ ticks from now: action }) behind the loading screen, holding the player still
 * until the last one. A logout cancels it with the player's other tasks; a move its own steps
 * didn't make (another teleport, a death) cancels it, closes the screen and runs `cancelled`.
 */
function loadHouse(player, steps, cancelled = () => {}) {
  loadingHouses.add(player);
  const movement = player.getMovementQueue();
  const wasBlocked = movement.isMovementBlocked();
  movement.setBlockMovement(true).reset();
  const last = Math.max(...Object.keys(steps).map(Number));
  let tick = 0;
  let anchor = tileOf(player);
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player, false); }

    execute() {
      if (tileOf(player) !== anchor) { this.stop(); return; }
      tick++;
      try {
        steps[tick]?.();
      } finally {
        anchor = tileOf(player);
        if (tick >= last) this.stop();
      }
    }

    stop() {
      if (loadingHouses.has(player)) {
        loadingHouses.delete(player);
        if (!wasBlocked) movement.setBlockMovement(false);
        if (tick < last) { hideHouseLoading(player); cancelled(); }
      }
      super.stop();
    }
  })());
}

/**
 * A house teleport lands inside at once; the loading screen and jingle cover the next two ticks.
 * `landing(house)` picks another tile than the entry (a spirit tree's, beside it).
 */
function teleportIntoHouse(player, buildingMode, landing = null) {
  if (!enterHouse(player, buildingMode) || !houseFor(player) || loadingHouses.has(player)) return;
  const tile = landing?.(houseFor(player));
  if (tile) player.moveTo(tile);
  showHouseLoading(player, { sound: false, jingle: houseFor(player).save });
  loadHouse(player, { 2: () => hideHouseLoading(player) });
}

function hasFollower(player) {
  const request = { player, pet: null };
  api.emitCustomEvent("pets:current", request);
  return !!request.pet;
}

function isIronman(player) {
  const mode = { player, mode: "none" };
  api.emitCustomEvent("ironman:mode", mode);
  return IRON_MODES.includes(mode.mode);
}

/**
 * Why `player` can't visit `owner`'s house (at portal `location`, when given), or null.
 * Ours: the line for an owner who is online but not at home in that town.
 */
function visitRefusal(player, owner, house, location) {
  if (!owner || !owner.getRelations().canReceivePrivateMessageFrom(player)) return VISIT_OFFLINE;
  if (owner !== player && isIronman(player)) return Menu.messageBox(IRONMAN_VISIT);
  if (!house || house.isDestroyed() || (location != null && Estate.houseLocation(house.save).id !== location)) {
    return "That house is unavailable or its owner is not accepting guests.";
  }
  if (owner === player) return null;
  if (house.buildingMode) return `${owner.getDisplayName()} is in building mode at the moment.`;
  // Ours: "her" for a female owner.
  if (house.save.locked) return `${owner.getDisplayName()} has locked ${owner.getAppearance?.()?.isMale?.() === false ? "her" : "his"} house to visitors.`;
  return null;
}

/** The advertisement board's filter: the owner's own house too is listed only while open to guests. */
function canVisitHouse(player, house) {
  if (!house.owner || visitRefusal(player, house.owner, house, null)) return false;
  return house.owner !== player || (!house.buildingMode && !house.save.locked);
}

/**
 * Visits `name`'s house. With `loading` (the portal's name prompt, the advertisement board) the
 * loading screen plays and the guest arrives a tick later; otherwise at once (Scrying's return).
 */
function visitHouse(player, name, location = nearbyHouseLocation(player), diaryEntryContext = null, { loading = false } = {}) {
  const owner = World.getPlayerByName(String(name ?? "").trim().replace(/_/g, " "));
  if (owner === player) { enterAtPortal(player, false, location, diaryEntryContext); return; }
  const house = owner && activeHouses.get(owner);
  const refusal = visitRefusal(player, owner, house, location);
  if (refusal) { Menu.refuse(player, refusal); return; }
  if (houseFor(player) === house) return;
  if (!loading) { arriveAsGuest(player, owner, house); return; }
  if (loadingHouses.has(player)) return;
  showHouseLoading(player, { jingle: house.save });
  loadHouse(player, {
    1: () => {
      // The owner may have left, locked up or gone into building mode since.
      const current = activeHouses.get(owner);
      const late = visitRefusal(player, owner, current, location);
      if (late) { hideHouseLoading(player); Menu.refuse(player, late); return; }
      arriveAsGuest(player, owner, current);
    },
    2: () => hideHouseLoading(player),
  });
}

function arriveAsGuest(player, owner, house) {
  if (houseFor(player) === house) return;
  if (houseFor(player)) exitHouse(player);
  if (!house.enterHouse(player, false)) { exitHouse(player); return; }
  api.emitCustomEvent("combat:clear-burn", { target: player });
  lastVisited.set(player, owner.getUsername());
  player.getPacketSender().sendVarbit(HOUSE_LOCKED_VARBIT, house.save.locked ? 1 : 0);
}

/** Friend's house: Ironmen are refused at once; anyone else names the host. */
function promptVisit({ player, objectId, location: portalLocation, sourceLocation, object }) {
  portalClickTiles.delete(player);
  if (isIronman(player)) {
    Menu.refuse(player, Menu.messageBox(IRONMAN_VISIT));
    return true;
  }
  const location = nearbyHouseLocation(player, objectId);
  const diaryEntryContext = yanilleHouseEntryContext(objectId, portalLocation, sourceLocation, object);
  player.setEnteredSyntaxAction({ execute: (name) => visitHouse(player, name, location, diaryEntryContext, { loading: true }) });
  player.getPacketSender().sendClientScript(NAME_INPUT_SCRIPT, VISIT_PROMPT);
  return true;
}

function expelGuests(player) {
  const house = activeHouses.get(player);
  if (!house || houseFor(player) !== house || house.owner !== player) return;
  const guests = house.getPlayers().filter(guest => guest !== player);
  for (const guest of guests) {
    exitHouse(guest);
    guest.sendMessage("The house owner has expelled you.");
  }
  if (!guests.length) player.sendMessage("No guests were found in your house.");
  else if (guests.length === 1) player.sendMessage("Attempted to expel one guest.");
  // Ours: the line for several guests is our wording.
  else player.sendMessage(`Attempted to expel ${guests.length} guests.`);
}

/** Whether `owner`'s house is on the board. An advert lasts 30 minutes. */
function isAdvertised(owner) {
  const advert = adverts.get(owner);
  if (!advert) return false;
  if (Date.now() - advert.since < ADVERT_MINUTES * MINUTE_MS) return true;
  endAdvert(owner);
  return false;
}

/** Takes `owner`'s house off the board; false if it wasn't on it. */
function endAdvert(owner) {
  if (!adverts.delete(owner)) return false;
  owner.getPacketSender().sendVarbit(HOUSE_BOARD_ADVERTISING_VARBIT, 0);
  return true;
}

/** A Yes/No question in the chatbox; `onYes` runs on Yes. */
function askYesNo(player, question, onYes) {
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new OptionDialogue(0, {
    executeOption(option) {
      player.getPacketSender().sendInterfaceRemoval();
      if (Number(option) === 1) onYes(player);
    },
  }, "Yes.", "No.").setTitle(question)));
}

/** Add-House, or Add/Remove House with no advert up: the 30-minute limit, then the question. */
function offerAdvert({ player }) {
  const last = lastAdvertised.get(player.getUsername().toLowerCase());
  const wait = last == null ? 0 : ADVERT_MINUTES * MINUTE_MS - (Date.now() - last);
  if (wait > 0) {
    Menu.refuse(player, Menu.messageBox(`You can only advertise once every ${ADVERT_MINUTES} minutes. You have ${Math.ceil(wait / MINUTE_MS)} minutes(s) before you can advertise again.`));
    return true;
  }
  askYesNo(player, "Advertise your house on the board?", placeAdvert);
  return true;
}

function placeAdvert(player) {
  // Ours: the refusals for no house and a Construction level under 50.
  if (houseStateFor(player).owned === false) { player.sendMessage("You don't have a house to advertise."); return; }
  if (player.getSkillManager().getMaxLevel(Skill.CONSTRUCTION) < ADVERT_LEVEL) {
    player.sendMessage(`You need a Construction level of ${ADVERT_LEVEL} to advertise your house.`);
    return;
  }
  const now = Date.now();
  for (const [name, at] of lastAdvertised) if (now - at >= ADVERT_MINUTES * MINUTE_MS) lastAdvertised.delete(name);
  const advert = { since: now };
  adverts.delete(player);
  adverts.set(player, advert);
  lastAdvertised.set(player.getUsername().toLowerCase(), now);
  TaskManager.submit(new CountdownTask(advert, ADVERT_TICKS, () => { if (adverts.get(player) === advert) endAdvert(player); }));
  player.getPacketSender().sendVarbit(HOUSE_BOARD_ADVERTISING_VARBIT, 1);
  player.sendMessage("Your house is now being advertised on the noticeboard.");
  Menu.refuse(player, Menu.messageBox(`Your house is now being advertised on the noticeboard for the next ${ADVERT_MINUTES} minutes. If your house is closed or you log off, your advert will be removed.`));
}

/** The exit portal's advert option. Ours: nothing is said when there was no advert. */
function removeAdvertisement({ player }) {
  if (endAdvert(player)) player.sendMessage("Your house is no longer being advertised.");
  return true;
}

function advertisementRow(owner) {
  const save = houseStateFor(owner);
  const furniture = new Set();
  for (const plane of save.rooms) for (const column of plane) for (const room of column) {
    if (!room) continue;
    for (const key of Object.values(room.furniture)) furniture.add(key);
    for (const saved of Object.values(room.furnitureByLocation ?? {})) furniture.add(saved.buildableKey);
  }
  const has = (key) => furniture.has(key) ? "Y" : "N";
  const tier = (keys) => {
    for (let i = keys.length - 1; i >= 0; i--) if (furniture.has(keys[i])) return String(i + 1);
    return "0";
  };
  const spellbookAltar = [...furniture].some(key => key.startsWith("OCCULT_ALTAR")) ? "4"
    : tier(["ANCIENT_ALTAR", "LUNAR_ALTAR", "DARK_ALTAR"]);
  return [owner.getUsername(), Estate.houseLocation(save).id,
    owner.getSkillManager().getMaxLevel(Skill.CONSTRUCTION),
    has("GILDED_ALTAR"),
    tier(["MARBLE_PORTAL_NEXUS", "GILDED_PORTAL_NEXUS", "CRYSTALLINE_PORTAL_NEXUS"]),
    tier(["BASIC_JEWELLERY_BOX", "FANCY_JEWELLERY_BOX", "ORNATE_JEWELLERY_BOX"]),
    tier(["RESTORATION_POOL", "REVITALISATION_POOL", "REJUVENATION_POOL", "FANCY_REJUVENATION_POOL", "ORNATE_REJUVENATION_POOL"]),
    spellbookAltar, has("ARMOUR_STAND"), Math.floor(adverts.get(owner).since / MINUTE_MS), ""].join("|");
}

/**
 * The owners `viewer` sees on the board: every advertised house, wherever it is (the client
 * offers Enter House only on rows from the board's own town). An Ironman sees only their own.
 */
function listedOwners(viewer) {
  const ironman = isIronman(viewer);
  return [...adverts.keys()].filter(owner => isAdvertised(owner) && World.getPlayerByName(owner.getUsername()) === owner
    && (owner === viewer || !ironman))
    .slice(0, HOUSE_BOARD_LAST_ROW - 1);
}

const boardLocations = new WeakMap();

/** Fills rows 1-200; the empty rows clear what an earlier list left. */
function sendAdvertRows(player, location) {
  const owners = listedOwners(player);
  const sender = player.getPacketSender();
  for (let row = 1; row <= HOUSE_BOARD_LAST_ROW; row++) {
    const owner = owners[row - 1];
    sender.sendClientScript(HOUSE_BOARD_ROW_SCRIPT, row, owner ? advertisementRow(owner) : "", location);
  }
  sender.sendInterfaceAnimation(HOUSE_BOARD_HOURGLASS, HOURGLASS_ANIMATION);
  sender.sendInterfaceFlagsRange(HOUSE_BOARD_ROWS, 1, HOUSE_BOARD_LAST_ROW, 1 << 1);
}

function viewAdvertisements(player, location = boardLocations.get(player) ?? nearbyHouseLocation(player)) {
  boardLocations.set(player, location);
  const sender = player.getPacketSender();
  sender.sendInterfaceRemoval();
  sender.sendVarbit(HOUSE_BOARD_LOCATION_VARBIT, location);
  sender.sendInterface(HOUSE_BOARD_INTERFACE);
  sendAdvertRows(player, location);
  // Enter House: native scripts 3111/3125 submit the row's name through RESUME_NAMEDIALOG.
  player.setEnteredSyntaxAction({ execute: (name) => enterAdvertisedHouse(player, name, location) });
}

function enterAdvertisedHouse(player, name, location) {
  if (player.getInterfaceId() !== HOUSE_BOARD_INTERFACE) return;
  const owner = listedOwners(player).find(candidate => candidate.getUsername().toLowerCase() === String(name).toLowerCase());
  player.getPacketSender().sendInterfaceRemoval();
  if (!owner) {
    player.sendMessage("That house is no longer advertised or is not accepting guests.");
    return;
  }
  // An advertised house can be visited while its owner is elsewhere.
  if (owner !== player) openHouse(owner);
  visitHouse(player, owner.getUsername(), location, null, { loading: true });
}

function handleAdvertisementInterface(event) {
  const player = event.player;
  if (event.groupId !== HOUSE_BOARD_INTERFACE || player.getInterfaceId() !== HOUSE_BOARD_INTERFACE) return false;
  if (event.action !== 1) return false;
  if (event.childId === HOUSE_BOARD_ADD_REMOVE) {
    const location = boardLocations.get(player);
    player.getPacketSender().sendVarbit(HOUSE_BOARD_LOCATION_VARBIT, 0);
    player.getPacketSender().sendInterfaceRemoval();
    if (!isAdvertised(player)) return offerAdvert({ player });
    askYesNo(player, "Remove your advert?", () => {
      removeAdvertisement({ player });
      viewAdvertisements(player, location);
    });
    return true;
  }
  if (event.childId === HOUSE_BOARD_REFRESH) { sendAdvertRows(player, boardLocations.get(player)); return true; }
  return false;
}

function constructionLevel(player) {
  return player.getSkillManager().getCurrentLevel(Skill.CONSTRUCTION);
}

/**
 * The level a piece of furniture is built at: the Construction level, plus an invisible boost
 * carried items give ("construction:level-boost" `{ player, buildable, boost }`, the crystal saw's +3)
 * to builds that take a saw and a hammer. Wiki (Crystal saw): not rooms, nor garden plants (the
 * bagged plants and the watering-can builds).
 */
function furnitureLevel(player, buildable) {
  const level = constructionLevel(player);
  if (buildable?.tool === "watering-can" || (buildable && GardenPlants.isGardenPlant(buildable))) return level;
  const request = { player, buildable, boost: 0 };
  api.emitCustomEvent("construction:level-boost", request);
  return level + Math.max(0, Number(request.boost) || 0);
}

/** Saves the owner's house after furniture changed in place (no rebuild). */
function saveHouse(house) {
  house.owner.setAttribute(HOUSE_ATTRIBUTE, house.save);
  api.emitCustomEvent("persistence:save", { player: house.owner, reason: "construction" });
}
function rebuildHouse(player, house) {
  player.setAttribute(HOUSE_ATTRIBUTE, house.save);
  api.emitCustomEvent("persistence:save", { player, reason: "construction" });
  const position = house.getRoomPositionAt(player.getLocation());
  if (!position || !house.getRoom(position)) player.moveTo(house.getEntryLocation());
  if (!house.rebuild(player, true)) player.sendMessage("Unable to rebuild your house.");
  syncHouseOptions(player);
}

/**
 * Building, moving or removing a room rebuilds the house behind the loading screen: the screen
 * and the house style's loading jingle at once, the new house a tick later, and the screen closes
 * the tick after, when `then` runs (the house viewer opens again).
 */
function rebuildRooms(player, house, then = () => {}) {
  if (loadingHouses.has(player)) { rebuildHouse(player, house); then(); return; }
  let rebuilt = false;
  const rebuild = () => {
    if (rebuilt || houseFor(player) !== house) return;
    rebuilt = true;
    rebuildHouse(player, house);
  };
  player.getPacketSender().sendInterfaceRemoval();
  showHouseLoading(player, { sound: false, jingle: house.save });
  loadHouse(player, {
    1: rebuild,
    2: () => {
      hideHouseLoading(player);
      if (houseFor(player) === house && isBuildingMode(player)) then();
    },
  }, rebuild);
}

const ROOM_CREATION_INTERFACE = Ids.iface("poh_add_room");
const pendingRoomMenus = new WeakMap();
const CANT_AFFORD_ROOM = "You can't afford to build that room.";

function chooseRoom(player, house, target) {
  if (houseFor(player) !== house || !isBuildingMode(player)) return;
  pendingRoomMenus.set(player, { house, target, viewer: player.getInterfaceId() === HOUSE_VIEWER_INTERFACE });
  sendRoomList(player);
}

function sendRoomList(player) {
  player.getPacketSender().sendInterface(ROOM_CREATION_INTERFACE)
    .sendInterfaceFlagsRange((ROOM_CREATION_INTERFACE << 16) | 4, 1, 29, 1);
}

function selectRoomFromInterface(event) {
  if (event.groupId !== ROOM_CREATION_INTERFACE || event.childId !== 4) return false;
  const pending = pendingRoomMenus.get(event.player);
  if (!pending || event.player.getInterfaceId() !== ROOM_CREATION_INTERFACE || houseFor(event.player) !== pending.house || !isBuildingMode(event.player)) return true;
  const id = pending.target.plane === 2 && (event.action === 7 || event.action === 9) ? event.action + 1 : event.action;
  const room = Data.CONSTRUCTION_ROOMS.find(candidate => candidate.id === id);
  if (!room) { event.player.sendMessage("That room is not available yet."); return true; }
  const copy = pending.house.getOnlyCopy(room);
  // Too few coins is a chat line, and the room list stays open.
  if (!copy && !pending.house.canPlaceRoom(room, pending.target, constructionLevel(event.player))
    && event.player.getInventory().getAmount(COINS_ID) < room.cost) {
    event.player.sendMessage(CANT_AFFORD_ROOM);
    sendRoomList(event.player);
    return true;
  }
  pendingRoomMenus.delete(event.player);
  if (copy) return offerRoomMove(event.player, pending.house, pending.target, room, copy, pending.viewer), true;
  if (pending.viewer) previewRoom(event.player, pending.house, pending.target, room);
  else roomMenu(event.player, pending.house, pending.target, room, startingRotation(pending.house, pending.target, room));
  return true;
}

/** Turned so one of the room's doorways meets a neighbour's. */
function startingRotation(house, target, room) {
  const doors = house.templateDoorMask(room.key), adjacent = house.getAdjacentDoorMask(target);
  return [0, 1, 2, 3].find(turn => rotatedDoors(doors, turn) & adjacent) ?? 0;
}

/**
 * rsprox captures (poh_add_room:list, rev 229-236): a room picked at a door hotspot is built from
 * the chatbox, "Select an option" with Rotate clockwise / Rotate anticlockwise / Build / Cancel
 * (Build / Cancel for a one-door room). The room shows in place meanwhile (previewObjects).
 * Rotating sends the menu again; Build takes the coins and rebuilds the house. With `moving` (the
 * one copy of a room the house may only have one of) Build moves that room here instead, for free.
 */
function roomMenu(player, house, target, room, rotation, moving = null) {
  if (houseFor(player) !== house || !isBuildingMode(player)) return;
  const problem = moving ? house.canMoveRoom(moving, target) : roomProblem(player, house, target, room);
  player.getPacketSender().sendInterfaceRemoval();
  if (problem) return Menu.refuse(player, problem);
  showRoomPreview(player, house.previewObjects(room.key, target, rotation));
  const viewer = { house, destination: target, newRoom: room, rotation, moving };
  const build = () => { clearRoomPreview(player); buildRoom(player, viewer, false); };
  const cancel = () => clearRoomPreview(player);
  // One-door rooms (portal chamber, throne room, treasure room) only face their door (captures).
  const doors = house.templateDoorMask(room.key);
  if ((doors & (doors - 1)) === 0) return api.sendMultiChatboxPrompt(player, "Select an option", "Build", build, "Cancel", cancel);
  api.sendMultiChatboxPrompt(player, "Select an option",
    "Rotate clockwise", () => roomMenu(player, house, target, room, (rotation + 1) & 3, moving),
    "Rotate anticlockwise", () => roomMenu(player, house, target, room, (rotation + 3) & 3, moving),
    "Build", build,
    "Cancel", cancel);
}

/** rsprox captures (poh_add_room:list): the coins are checked when the room is picked, in the chat. */
function roomProblem(player, house, target, room) {
  return house.canPlaceRoom(room, target, constructionLevel(player))
    ?? (player.getInventory().getAmount(COINS_ID) < room.cost ? CANT_AFFORD_ROOM : null);
}

/**
 * rsprox captures (poh_add_room:list, rev 229): picking a room the house may only have one of
 * offers to move that one here ("You can only build one of those rooms." / "Move the room here.",
 * the menagerie in its own words), or says in a message box why it can't move.
 */
function offerRoomMove(player, house, target, room, copy, fromViewer) {
  player.getPacketSender().sendInterfaceRemoval();
  const problem = house.canMoveRoom(copy, target);
  if (problem) return Menu.refuse(player, Menu.messageBox(`You already have one of those rooms. ${problem.messageBox ?? problem}`));
  const menagerie = room.key === "MENAGERIE_INDOORS" || room.key === "MENAGERIE_OUTDOORS";
  const existing = Data.ROOM_BY_KEY.get(house.getRoom(copy).roomKey);
  api.sendMultiChatboxPrompt(player, menagerie ? "You can only build one menagerie." : "You can only build one of those rooms.",
    menagerie ? "Move your menagerie here." : "Move the room here.", () => {
      if (!fromViewer) return roomMenu(player, house, target, existing, startingRotation(house, target, existing), copy);
      openHouseViewer(player);
      const viewer = houseViewers.get(player);
      if (!viewer) return;
      Object.assign(viewer, { selected: copy, destination: target, mode: "rotate", rotation: startingRotation(house, target, existing) });
      syncViewerSelection(player, viewer);
    },
    "Cancel.", () => {});
}

/** player -> the preview locs on show */
const roomPreviews = new WeakMap();

function showRoomPreview(player, objects) {
  clearRoomPreview(player);
  roomPreviews.set(player, objects);
  for (const object of objects) player.getPacketSender().sendObject(object);
}

function clearRoomPreview(player) {
  const objects = roomPreviews.get(player);
  if (!objects) return;
  roomPreviews.delete(player);
  for (const object of objects) player.getPacketSender().sendObjectRemoval(object);
}

/** A room type's doorways turned to a rotation, as getAdjacentDoorMask turns its neighbours'. */
function rotatedDoors(doors, rotation) {
  return ((doors << rotation) | (doors >> (4 - rotation))) & 15;
}

/**
 * rsprox captures (poh_add_room:list): a room picked from the house viewer isn't built straight away
 * either. The viewer opens with it placed at the spot (poh_viewer_destination, _selectedroom, _type, _enable_rot and the
 * doorways), to be turned with Clockwise/Anticlockwise and built with Done, which takes the coins,
 * rebuilds the house and opens the viewer again. It starts turned so a doorway meets a neighbour's.
 */
function previewRoom(player, house, target, room) {
  if (houseFor(player) !== house || !isBuildingMode(player)) return;
  const problem = roomProblem(player, house, target, room);
  if (problem) {
    player.getPacketSender().sendInterfaceRemoval();
    return Menu.refuse(player, problem);
  }
  const rotation = startingRotation(house, target, room);
  player.getPacketSender().sendInterface(HOUSE_VIEWER_INTERFACE);
  const viewer = { house, rooms: [], rotation, mode: "rotate", destination: target, newRoom: room };
  houseViewers.set(player, viewer);
  refreshHouseViewer(player, viewer);
}

/** rsprox captures (poh_viewer:done, chatmenu Build): the house is rebuilt with no message. */
function buildRoom(player, viewer, reopenViewer = true) {
  const { house, destination: target, newRoom: room, rotation, moving } = viewer;
  if (houseFor(player) !== house || !isBuildingMode(player)) return;
  if (moving) {
    if (!house.moveRoom(moving, target, rotation)) return Menu.refuse(player, house.canMoveRoom(moving, target));
  } else {
    const problem = roomProblem(player, house, target, room);
    if (problem) return Menu.refuse(player, problem);
    player.getInventory().delete(COINS_ID, room.cost);
    house.placeRoom(target, room, rotation);
  }
  rebuildRooms(player, house, reopenViewer ? () => openHouseViewer(player) : undefined);
}

/**
 * rsprox captures (poh_viewer:delete, door hotspots into a built room, rev 229-235):
 * "Remove the parlour?" with Yes / No; the Yes says "Room deleted!". Refusals are message boxes.
 */
function removeRoomPrompt(player, house, target, onNo = () => {}, onRemoved = () => {}) {
  const room = house.getRoom(target);
  if (!room || loadingHouses.has(player)) return;
  const problem = house.canRemoveRoom(target);
  if (problem) return Menu.refuse(player, problem);
  const confirm = () => api.sendMultiChatboxPrompt(player, `Remove the ${Data.ROOM_BY_KEY.get(room.roomKey).name}?`, "Yes", () => {
    if (houseFor(player) !== house || !isBuildingMode(player) || house.getRoom(target) !== room) return;
    const currentProblem = house.canRemoveRoom(target);
    if (currentProblem) return Menu.refuse(player, currentProblem);
    house.removeRoom(target);
    api.emitCustomEvent("construction:room-removed", { player, house, room });
    player.sendMessage("Room deleted!");
    rebuildRooms(player, house, onRemoved);
  }, "No", onNo);
  // A room whose loss may cut off a floor, or costs the player something, warns first.
  const removal = { player, house, position: target, room, warning: null };
  api.emitCustomEvent("construction:room-removing", removal);
  if (removal.warning) Menu.warn(player, removal.warning, confirm);
  else confirm();
}

/** Build on a door hotspot: a new room through an empty doorway, else removing the room beyond it. */
function openRoomDoor(event) {
  const player = event.player;
  const house = houseFor(player);
  if (!house || !isBuildingMode(player)) return false;
  // The loading screen covers the old house until the new one is drawn.
  if (loadingHouses.has(player)) return true;
  const target = house.getDoorTarget(event.location);
  if (!target) return false;
  if (!house.getRoom(target)) {
    chooseRoom(player, house, target);
    return true;
  }
  // A shared doorway belongs to two rooms; the one to remove is the one the player isn't in.
  const doorRoom = house.getRoomPositionAt(event.location);
  const playerRoom = house.getRoomPositionAt(event.sourceLocation ?? player.getLocation());
  const inTarget = playerRoom?.x === target.x && playerRoom.y === target.y && playerRoom.plane === target.plane;
  removeRoomPrompt(player, house, inTarget && doorRoom && house.getRoom(doorRoom) ? doorRoom : target);
  return true;
}

function toggleHouseLock(event) {
  const player = event.player;
  const house = houseFor(player);
  if (!house) return false;
  if (house.owner !== player) { player.sendMessage("Only the owner can lock this portal."); return true; }
  house.save.locked = !house.save.locked;
  for (const occupant of house.getPlayers()) occupant.getPacketSender().sendVarbit(HOUSE_LOCKED_VARBIT, house.save.locked ? 1 : 0);
  player.setAttribute(HOUSE_ATTRIBUTE, house.save);
  player.sendMessage(house.save.locked ? "You lock the house portal." : "You unlock the house portal.");
  return true;
}

function exitHouse(player) {
  const house = houseFor(player);
  if (!house) return false;
  standFromChair(player);
  Workbench.standUp(player);
  houseViewers.delete(player);
  pendingRoomMenus.delete(player);
  player.getPacketSender().sendInterfaceRemoval();
  house.exitHouse(player, Estate.houseExit(house.save));
  api.emitCustomEvent("combat:clear-burn", { target: player });
  syncHouseOptions(player);
  syncKickOption(player);
  return true;
}

function syncKickOption(player) {
  const house = houseFor(player);
  const visible = !!house && house.owner === player && !house.isDestroyed();
  if (visible === kickOptionVisible.has(player)) return;
  player.getPacketSender().sendPlayerOption(HOUSE_KICK_OPTION, visible ? "Kick" : "", false);
  if (visible) kickOptionVisible.add(player);
  else kickOptionVisible.delete(player);
}

function kickGuest(event) {
  if (event.option !== HOUSE_KICK_OPTION) return;
  const house = houseFor(event.player);
  if (!house) return;
  event.handled = true;
  if (!house || house.isDestroyed() || house.owner !== event.player || event.target === event.player
    || houseFor(event.target) !== house || !house.getPlayers().includes(event.target)) return;
  exitHouse(event.target);
  event.target.sendMessage("The house owner has expelled you.");
}

function syncHouseOptions(player) {
  const saved = houseStateFor(player);
  const house = houseFor(player);
  const sender = player.getPacketSender();
  sender.sendVarbit(OPTIONS_VARBITS.location, saved.owned === false ? 0 : Estate.houseLocation(saved).id);
  sender.sendVarbit(OPTIONS_VARBITS.style, Estate.houseStyleIndex(saved));
  sender.sendVarbit(OPTIONS_VARBITS.buildingMode, house?.buildingMode ? 1 : 0);
  sender.sendVarbit(OPTIONS_VARBITS.teleportOutside, saved.teleportOutside ? 1 : 0);
  sender.sendVarbit(OPTIONS_VARBITS.defaultBuildingMode, saved.defaultBuildingMode ? 1 : 0);
  sender.sendVarbit(OPTIONS_VARBITS.doors, saved.doorMode ?? 0);
  if (houseOptionsOpen.has(player)) sender.sendString("Number of rooms: " + (house?.getRoomCount() ?? saved.rooms.flat(2).filter(Boolean).length),
    (HOUSE_OPTIONS_INTERFACE << 16) | 23);
}

function openHouseSettings(player) {
  houseOptionsOpen.add(player);
  const sender = player.getPacketSender();
  sender.sendSubInterface(SETTINGS_TARGET_UID, HOUSE_OPTIONS_INTERFACE, 1);
  for (const child of [1, 5, 6, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22]) {
    sender.sendInterfaceFlags((HOUSE_OPTIONS_INTERFACE << 16) | child, 1 << 1);
  }
  syncHouseOptions(player);
}

/** Puts the Settings tab back in place of House Options. */
function closeHouseOptions(player) {
  if (!houseOptionsOpen.delete(player)) return;
  player.getPacketSender().sendSubInterface(SETTINGS_TARGET_UID, SETTINGS_SIDE_INTERFACE, 1);
}

function isSeated(player) {
  const seat = seatedPlayers.get(player);
  return !!seat && player.getPrivateArea() === seat.house && player.getLocation().equals(seat.sitting ? seat.location : seat.front);
}

function toggleBuildingMode(player, house, on) {
  if (house.buildingMode === on) return;
  closeHouseOptions(player);
  if (isSeated(player)) { player.sendMessage("You cannot enter or leave building mode while sitting down."); return; }
  enterHouse(player, on, null, "options");
}

function closeHouseSettings(event) {
  if (!houseOptionsOpen.has(event.player) || event.player.getInterfaceId() >= 0
    || event.player.getPacketSender().hasInterruptibleInterface() === true) return;
  houseOptionsOpen.delete(event.player);
  event.player.getPacketSender().sendSubInterface(SETTINGS_TARGET_UID, SETTINGS_SIDE_INTERFACE, 1);
  event.handled = true;
}

function handleHouseOptions(event) {
  const { player, groupId, childId, action } = event;
  if (action !== 1) return false;
  if (groupId === SETTINGS_SIDE_INTERFACE && childId === 31) { openHouseSettings(player); return true; }
  if (groupId !== HOUSE_OPTIONS_INTERFACE || !houseOptionsOpen.has(player)) return false;
  if (childId === 24) { closeHouseOptions(player); return true; }
  const saved = houseStateFor(player);
  const house = houseFor(player);
  const setting = (childId >= 8 && childId <= 9) || (childId >= 11 && childId <= 12) || (childId >= 14 && childId <= 19);
  if (setting) player.getPacketSender().sendSound(OPTION_SOUND, 1, 0);
  if (childId === 8 || childId === 9) saved.teleportOutside = childId === 9;
  else if (childId === 11 || childId === 12) saved.defaultBuildingMode = childId === 11;
  else if (childId >= 14 && childId <= 19) {
    saved.doorMode = childId <= 15 ? 0 : childId <= 17 ? 1 : 2;
    if (house?.owner === player && !house.buildingMode) house.refreshDoors();
  } else if (childId === 21) {
    if (houseFor(player)) closeHouseOptions(player);
    if (!exitHouse(player)) player.sendMessage("You are not in a house.");
  } else if (childId === 22) {
    if (Servants.callServantFromOptions(player)) closeHouseOptions(player);
  } else if ((childId === 5 || childId === 6) && !house) {
    player.sendMessage("Building mode really only helps if you're in a house.");
  } else if (childId === 1 && (!house || house.owner !== player || !house.buildingMode)) {
    player.sendMessage("The layout viewer is only for building mode.");
  } else if (!house || house.owner !== player) player.sendMessage("You must be inside your own house to do that.");
  else if (childId === 5 || childId === 6) toggleBuildingMode(player, house, childId === 5);
  else if (childId === 20) { closeHouseOptions(player); expelGuests(player); }
  else if (childId === 1) { closeHouseOptions(player); openHouseViewer(player); }
  player.setAttribute(HOUSE_ATTRIBUTE, saved);
  // Also restores the teleport preference after this cache's Default Off listener changes it locally.
  syncHouseOptions(player);
  return true;
}

/** Cast follows the house's teleport setting; the spell's "Outside" option (`option`) always stays outside. */
function houseTeleportArrival({ player, name, option }) {
  if (name !== "teleport to house") return;
  const saved = houseStateFor(player);
  if (option === "outside" || saved.teleportOutside) player.moveTo(Estate.houseExit(saved));
  else teleportIntoHouse(player, saved.defaultBuildingMode);
}

/**
 * "construction:house-tablet": where a Teleport to house tablet goes. Break follows the
 * house's teleport setting, Inside/Outside override it; without a house it's refused
 * (no destination) so the tablet is kept.
 */
function houseTablet(request) {
  const { player } = request;
  const saved = houseStateFor(player);
  if (saved.owned === false) {
    player.sendMessage("You do not own a house. Speak to an Estate agent to buy one.");
    return;
  }
  const outside = request.option === "outside" || (request.option === "break" && !!saved.teleportOutside);
  request.destination = Estate.houseExit(saved);
  request.onArrival = outside ? null : () => { teleportIntoHouse(player, saved.defaultBuildingMode); };
}

/** The house's own spirit trees: the Spirit tree and the Spiritual fairy tree (superior garden). */
const SPIRIT_TREE_KEYS = new Set(["SPIRIT_TREE", "SPIRIT_TREE_AND_FAIRY_RING"]);

const isSpiritTree = (furniture) => SPIRIT_TREE_KEYS.has(furniture?.buildableKey ?? furniture);

function hasSpiritTree(save) {
  return save.rooms.flat(2).some((room) => room && (Object.values(room.furniture ?? {}).some(isSpiritTree)
    || Object.values(room.furnitureByLocation ?? {}).some(isSpiritTree)));
}

/**
 * "construction:spirit-tree" { player, owns, location, built }: the spirit tree network's
 * "Your house" entry. `location` is where the house stands ("Your house (Yanille)"); the entry
 * can be travelled to once a spirit tree is built in it.
 */
function spiritTreeHouse(request) {
  if (!request?.player) return;
  const save = houseStateFor(request.player);
  request.owns = save.owned !== false;
  if (!request.owns) return;
  request.location = Estate.houseLocation(save).name;
  request.built = hasSpiritTree(save);
}

/** The tile beside the house's spirit tree: east of its footprint, on its south row. */
function spiritTreeLanding(house) {
  const entry = house.furnitureEntries().find(({ furniture, room }) => isSpiritTree(furniture) && house.furnitureObjectId(room, furniture) >= 0);
  if (!entry) return null;
  const definition = api.core.CacheDefinitions.getObject(house.furnitureObjectId(entry.room, entry.furniture));
  const width = (entry.face & 1) ? definition?.sizeY ?? 1 : definition?.sizeX ?? 1;
  return new api.core.Location(entry.location.getX() + width, entry.location.getY(), entry.location.getZ());
}

/**
 * "construction:spirit-tree-travel" { player }: a spirit tree's trip into the house.
 * The player enters as a house teleport does (its loading screen and jingle) and stands by the tree.
 */
function spiritTreeTravel(request) {
  const { player } = request ?? {};
  if (!player) return;
  const saved = houseStateFor(player);
  if (saved.owned === false || !hasSpiritTree(saved)) return;
  teleportIntoHouse(player, saved.defaultBuildingMode, spiritTreeLanding);
}

/**
 * "construction:exit-house" { player, to, handled }: furniture that teleports the player out (the
 * superior garden's obelisk) leaves the house the way the portal does, landing at `to`.
 */
function exitHouseTo(request) {
  const { player, to } = request ?? {};
  const house = player ? houseFor(player) : null;
  if (!house || !to) return;
  house.exitHouse(player, to);
  request.handled = true;
}

const HOUSE_VIEWER_INTERFACE = Ids.iface("poh_viewer");
const VIEWER_VARBITS = {
  selectedRoom: Ids.varbit("poh_viewer_selectedroom"), destination: Ids.varbit("poh_viewer_destination"),
  rotation: Ids.varbit("poh_viewer_rot"), rotating: Ids.varbit("poh_viewer_enable_rot"), type: Ids.varbit("poh_viewer_type"),
  selectedDoors: Ids.varbit("poh_viewer_selecteddoors"), adjacentDoors: Ids.varbit("poh_viewer_adjacentdoors"),
};
// The viewer's client scripts: one room's slot, and the grid (no gamevals for scripts).
const VIEWER_ROOM_SCRIPT = 1376;
const VIEWER_GRID_SCRIPT = 1382;
const houseViewers = new WeakMap();

function openHouseViewer(player) {
  const house = houseFor(player);
  if (!house || house.owner !== player || !house.buildingMode) {
    player.sendMessage("The layout viewer is only for building mode.");
    return;
  }
  player.getPacketSender().sendInterface(HOUSE_VIEWER_INTERFACE);
  const viewer = { house, rooms: [], rotation: 0 };
  houseViewers.set(player, viewer);
  refreshHouseViewer(player, viewer);
}

function refreshHouseViewer(player, viewer) {
  const sender = player.getPacketSender();
  viewer.rooms = [];
  for (let plane = 0; plane < 3; plane++) for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
    const position = { x, y, plane }, room = viewer.house.getRoom(position);
    if (!room) continue;
    viewer.rooms.push(position);
    const index = viewer.rooms.length;
    const roomId = Data.ROOM_BY_KEY.get(room.roomKey).id;
    let packed = BigInt(x | (y << 3) | (plane << 6) | (room.rotation << 8) | (roomId << 10));
    const placed = Object.values(room.furnitureByLocation ?? {});
    const keys = [...placed.map(f => f.buildableKey), ...Object.entries(room.furniture)
      .filter(([hotspot]) => !placed.some(f => f.hotspotKey === hotspot)).map(([, key]) => key)];
    const rows = keys.map(key => Data.BUILDABLE_BY_KEY.get(key)?.menuRowId);
    (Data.CONSTRUCTION_VIEWER_FURNITURE[roomId] ?? []).forEach((choices, slot) => {
      const index = rows.findIndex(row => row != null && choices.includes(row));
      if (index < 0) return;
      const value = choices.indexOf(rows[index]) + 1;
      rows.splice(index, 1);
      packed |= BigInt(value) << BigInt(15 + slot * 5);
    });
    // Script 1376 carries bit 31 of the first word in bit 30 of the second word.
    sender.sendClientScript(VIEWER_ROOM_SCRIPT, index, Data.ROOM_ROW_BY_ID.get(roomId), 0, Number(packed & 0x7fffffffn),
      Number((packed >> 32n) | (((packed >> 31n) & 1n) << 30n)), 0);
    sender.sendInterfaceFlags((HOUSE_VIEWER_INTERFACE << 16) | (index + 5), 1 << 1);
  }
  // The cache uses a 9x9 click grid on each of three floors and hides unused room slots itself.
  sender.sendClientScript(VIEWER_GRID_SCRIPT, viewer.rooms.length, 0, (2 << 28) | (7 << 14) | 7, player.getLocation().getZ());
  sender.sendInterfaceFlagsRange((HOUSE_VIEWER_INTERFACE << 16) | 5, 0, 242, (1 << 1) | (1 << 6));
  for (const child of [63, 64, 65, 66, 67, 68, 69]) sender.sendInterfaceFlags((HOUSE_VIEWER_INTERFACE << 16) | child, 1 << 1);
  sender.sendInterfaceFlags((HOUSE_VIEWER_INTERFACE << 16) | 46, 1 << 2);
  syncViewerSelection(player, viewer);
}

function syncViewerSelection(player, viewer) {
  if (viewer.newRoom) return syncRoomPreview(player, viewer);
  const room = viewer.selected && viewer.house.getRoom(viewer.selected);
  const sender = player.getPacketSender();
  sender.sendVarbit(VIEWER_VARBITS.selectedRoom, viewer.selected ? viewer.rooms.findIndex(p => p.x === viewer.selected.x && p.y === viewer.selected.y && p.plane === viewer.selected.plane) + 1 : 0);
  sender.sendVarbit(VIEWER_VARBITS.type, room ? Data.ROOM_BY_KEY.get(room.roomKey).id : 0);
  sender.sendVarbit(VIEWER_VARBITS.rotation, viewer.rotation);
  sender.sendVarbit(VIEWER_VARBITS.rotating, viewer.mode === "rotate" ? 1 : 0);
  const destination = viewer.destination;
  sender.sendVarbit(VIEWER_VARBITS.destination, destination ? destination.plane * 81 + destination.y * 9 + destination.x + 1 : viewer.mode === "move" ? 244 : 0);
  sender.sendVarbit(VIEWER_VARBITS.selectedDoors, room ? viewer.house.getRoomDoorMask(viewer.selected) : 0);
  sender.sendVarbit(VIEWER_VARBITS.adjacentDoors, destination ? viewer.house.getAdjacentDoorMask(destination) : viewer.selected ? viewer.house.getAdjacentDoorMask(viewer.selected) : 0);
  if (destination && room) {
    sender.sendClientScript(VIEWER_ROOM_SCRIPT, -1, 0, 0, destination.x | (destination.y << 3) | (destination.plane << 6)
      | (viewer.rotation << 8) | (Data.ROOM_BY_KEY.get(room.roomKey).id << 10), 0, 0);
  }
}

/** The room being added, drawn at its destination (the viewer varbits, VIEWER_ROOM_SCRIPT slot -1). */
function syncRoomPreview(player, viewer) {
  const { house, destination, newRoom, rotation } = viewer;
  const sender = player.getPacketSender();
  sender.sendVarbit(VIEWER_VARBITS.selectedRoom, viewer.rooms.length + 1);
  sender.sendVarbit(VIEWER_VARBITS.type, newRoom.id);
  sender.sendVarbit(VIEWER_VARBITS.rotation, rotation);
  sender.sendVarbit(VIEWER_VARBITS.rotating, 1);
  sender.sendVarbit(VIEWER_VARBITS.destination, destination.plane * 81 + destination.y * 9 + destination.x + 1);
  sender.sendVarbit(VIEWER_VARBITS.selectedDoors, house.templateDoorMask(newRoom.key));
  sender.sendVarbit(VIEWER_VARBITS.adjacentDoors, house.getAdjacentDoorMask(destination));
  sender.sendClientScript(VIEWER_ROOM_SCRIPT, -1, 0, 0, destination.x | (destination.y << 3) | (destination.plane << 6)
    | (rotation << 8) | (newRoom.id << 10), 0, 0);
}

/** Clockwise, Anticlockwise, Done and Cancel while a new room is shown. */
function handleRoomPreview(player, viewer, childId) {
  if (childId === 65) viewer.rotation = (viewer.rotation + 1) & 3;
  else if (childId === 66) viewer.rotation = (viewer.rotation + 3) & 3;
  else if (childId === 69) return buildRoom(player, viewer);
  else if (childId === 68) return openHouseViewer(player);
  syncRoomPreview(player, viewer);
}

function handleHouseViewer(event) {
  const { player, groupId, childId, action } = event;
  if (groupId !== HOUSE_VIEWER_INTERFACE) return false;
  const viewer = houseViewers.get(player);
  if (!viewer || player.getInterfaceId() !== HOUSE_VIEWER_INTERFACE || houseFor(player) !== viewer.house || !isBuildingMode(player)) return true;
  if (childId === 46 && action === 2) {
    player.getPacketSender().sendInterfaceRemoval();
    player.moveTo(viewer.house.getEntryLocation());
    houseViewers.delete(player);
    return true;
  }
  if (childId === 5 && Number.isInteger(event.slot) && event.slot >= 0 && event.slot < 243) {
    const slot = event.slot;
    const target = { x: slot % 9, y: Math.floor(slot / 9) % 9, plane: Math.floor(slot / 81) };
    if (target.x >= 8 || target.y >= 8) return true;
    if (action === 6 && !viewer.mode) {
      chooseRoom(player, viewer.house, target);
    } else if (action === 1 && viewer.mode === "move" && viewer.selected) {
      const problem = viewer.house.canMoveRoom(viewer.selected, target);
      if (problem) Menu.refuse(player, problem);
      else { viewer.destination = target; viewer.mode = "rotate"; syncViewerSelection(player, viewer); }
    }
    return true;
  }
  if (action !== 1 || childId == null) return true;
  if (viewer.newRoom) return handleRoomPreview(player, viewer, childId), true;
  if (childId >= 6 && childId <= 43 && !viewer.mode) {
    const selected = viewer.rooms[childId - 6];
    if (selected) { viewer.selected = selected; viewer.rotation = viewer.house.getRoom(selected).rotation; }
  } else if (viewer.selected && viewer.house.getRoom(viewer.selected)) {
    if (childId === 63 && !viewer.mode) viewer.mode = "move";
    else if (childId === 64 && !viewer.mode) viewer.mode = "rotate";
    else if (childId === 65 && viewer.mode === "rotate") viewer.rotation = (viewer.rotation + 1) & 3;
    else if (childId === 66 && viewer.mode === "rotate") viewer.rotation = (viewer.rotation + 3) & 3;
    else if (childId === 68) { viewer.mode = undefined; viewer.destination = undefined; viewer.rotation = viewer.house.getRoom(viewer.selected).rotation; }
    else if (childId === 69 && viewer.mode === "rotate") {
      if (viewer.destination) {
        const problem = viewer.house.canMoveRoom(viewer.selected, viewer.destination);
        if (problem) { Menu.refuse(player, problem); syncViewerSelection(player, viewer); return true; }
        viewer.house.moveRoom(viewer.selected, viewer.destination, viewer.rotation);
      } else viewer.house.rotateRoom(viewer.selected, viewer.rotation);
      rebuildRooms(player, viewer.house, () => openHouseViewer(player));
      return true;
    } else if (childId === 67 && !viewer.mode) {
      removeRoomPrompt(player, viewer.house, viewer.selected, () => openHouseViewer(player), () => openHouseViewer(player));
    }
  }
  syncViewerSelection(player, viewer);
  return true;
}

function formatBuildable(buildable) {
  const name = Data.BUILDABLE_BY_KEY.get(buildable.key)?.name ?? buildable.key.replace(/_/g, " ");
  return name.toLowerCase();
}

/**
 * What a build takes (item id -> amount), or why it can't happen: a string for the chat, or a
 * Menu.messageBox. rsprox captures (poh_furniture_creation:contents, rev 226-236): the tools line,
 * the upgrade and occupied-hotspot lines (gamemessage), and a message box listing every material
 * with the missing ones in red, on a line of its own, each amount kept with its name by non-breaking spaces
 * ("You don't have the right materials:<br>2 x Plank, <col=ef1020>2 x Nails</col>").
 */
function getBuildMaterials(player, house, target, buildable) {
  if (buildable.invalidLevels) return "This build has an unsupported skill requirement.";
  if (furnitureLevel(player, buildable) < buildable.level) return `You need Construction level ${buildable.level} to build that.`;
  for (const requirement of buildable.secondaryLevels ?? []) {
    const skill = Skill.values().find(candidate => candidate.getClientId() === requirement.statId);
    if (!skill || !Number.isInteger(requirement.level) || requirement.level < 1) return "This build has an unsupported skill requirement.";
    // The cache's second skills: Farming (spirit trees), Cooking (the kitchen barrels), Smithing (the armour displays)
    // and Runecraft (the rune cases). Boostable, so the current level counts (Wiki: Beer barrel, Cooking 5; Mithril
    // armour (Construction), Smithing 68; Rune case space, Runecraft 14, 44 and 90).
    // Skill.getName() says "Runecrafting"; the game's name for the skill is Runecraft (Wiki; level-up lines).
    if (player.getSkillManager().getCurrentLevel(skill) < requirement.level)
      return `You need ${skill === Skill.RUNECRAFTING ? "Runecraft" : skill.getName()} level ${requirement.level} to build that.`;
  }
  // Natural teleports use a filled watering can instead (Wiki: Teleport space).
  if (buildable.tool !== "watering-can" && (!hasHammer(player) || !hasSaw(player))) return "You need a saw and a hammer in order to make furniture.";
  // A flatpack is made away from any hotspot: no furniture there to upgrade.
  const existing = target ? house.getFurnitureAtTarget(target)?.buildableKey : undefined;
  const previous = buildable.materials.find(material => Data.BUILDABLE_BY_KEY.has(material.source))?.source;
  if (existing && existing !== previous) {
    if (TOOL_STORES.includes(existing) && TOOL_STORES.includes(buildable.key)) {
      if (TOOL_STORES.indexOf(existing) >= TOOL_STORES.indexOf(buildable.key)) return "You already have a tool store of that level in the room.";
      return "That can only be built by upgrading the previous piece of furniture.";
    }
    return "That can only be built if the hotspot is empty.";
  }
  if (target && previous && existing !== previous) return "That can only be built by upgrading the previous piece of furniture.";
  const plantRefusal = GardenPlants.refusal(player, buildable);
  if (plantRefusal) return plantRefusal;
  const requiredItems = new Map();
  const listed = [];
  for (const material of buildable.materials) {
    if (material.source === "NAILS") {
      let remaining = material.amount;
      for (const id of NAIL_IDS) {
        const reserved = requiredItems.get(id) ?? 0;
        const amount = Math.min(remaining, Math.max(0, player.getInventory().getAmount(id) - reserved));
        if (amount > 0) requiredItems.set(id, reserved + amount);
        remaining -= amount;
        if (remaining === 0) break;
      }
      listed.push({ material, missing: remaining > 0 });
    } else if (material.itemId != null) {
      const amount = (requiredItems.get(material.itemId) ?? 0) + material.amount;
      requiredItems.set(material.itemId, amount);
      listed.push({ material, missing: player.getInventory().getAmount(material.itemId) + storedAmount(player, material.itemId) < amount });
    } else if (!Data.BUILDABLE_BY_KEY.has(material.source)) return "This build has an unsupported material requirement.";
  }
  if (listed.some(entry => entry.missing)) {
    return Menu.messageBox(`You don't have the right materials:<br>${listed.map(({ material, missing }) => {
      const label = `${material.amount} x ${materialName(material)}`;
      return missing ? `<col=ef1020>${label}</col>` : label;
    }).join(", ")}`);
  }
  return requiredItems;
}

/** Wiki (Imcando hammer): either repaired variant works carried or wielded. */
function hasHammer(player) {
  const equipment = player.getEquipment();
  const wielded = [Equipment.WEAPON_SLOT, Equipment.SHIELD_SLOT].map(slot => equipment.get(slot)?.getId());
  return HAMMERS.some(id => player.getInventory().contains(id) || wielded.includes(id));
}

/** A saw, the crystal saw or Amy's saw, carried or wielded (Amy's saw in the weapon slot, its off-hand copy in the shield slot). */
function hasSaw(player) {
  const equipment = player.getEquipment();
  const wielded = [Equipment.WEAPON_SLOT, Equipment.SHIELD_SLOT].map(slot => equipment.get(slot)?.getId());
  return SAWS.some(id => player.getInventory().contains(id) || wielded.includes(id));
}

/** What a carried container (the plank sack) holds of a material ("storage:amount"). */
function storedAmount(player, itemId) {
  const request = { player, itemId, amount: 0 };
  api.emitCustomEvent("storage:amount", request);
  return request.amount;
}

/** Wiki (Plank sack): the inventory's planks go first, then the sack's ("storage:take"). */
function useMaterial(player, itemId, amount) {
  const held = Math.min(amount, player.getInventory().getAmount(itemId));
  if (held > 0) player.getInventory().delete(itemId, held);
  if (amount > held) api.emitCustomEvent("storage:take", { player, itemId, amount: amount - held, taken: 0 });
}

/**
 * Uses a build's materials (getBuildMaterials' map), as content may keep some of them
 * ("construction:materials" `{ player, buildable, materials }` as [id, amount] pairs, a league
 * fragment's planks kept; `buildable` is null for a Mahogany Homes job): a listener may lower an amount, never raise it.
 */
function useMaterials(player, buildable, materials) {
  // Wiki (Crystal saw): a charge goes only on a piece the boost was needed for.
  if (buildable && constructionLevel(player) < buildable.level) api.emitCustomEvent("construction:level-boost-used", { player, buildable });
  const request = { player, buildable, materials: [...materials].map(([itemId, amount]) => [itemId, amount]) };
  api.emitCustomEvent("construction:materials", request);
  for (const [itemId, amount] of request.materials) {
    const used = Math.min(Number(amount) || 0, materials.get(itemId) ?? 0);
    if (used > 0) useMaterial(player, itemId, used);
  }
}

/**
 * The hammer: the piece's build animation with synth 938. The guards and the oubliette's floor
 * pieces are prayed into place instead (`buildSound: false`): no hammer sound.
 */
function hammer(player, animationId = BUILD_ANIMATION, sound = true) {
  if (animationId >= 0) player.performAnimation(new Animation(animationId));
  if (sound) player.getPacketSender().sendSound(BUILD_SOUND, 0, 0);
}

/**
 * rsprox captures (poh_furniture_creation:contents, rev 226-239): a piece without nails takes its
 * materials and gives its XP on the pick, and shows a tick later. With nails, nothing goes on the
 * pick; each tick after it hammers in one nail (see hammerNails), and the last nail takes the rest
 * and gives the XP. No build sentence.
 */
function buildFurniture(player, house, target, buildable) {
  if (houseFor(player) !== house || !isBuildingMode(player)) return;
  const materials = getBuildMaterials(player, house, target, buildable);
  if (!(materials instanceof Map)) return Menu.refuse(player, materials);
  if (!GardenPlants.animate(player, buildable)) hammer(player, buildable.buildAnimationId, buildable.buildSound !== false);
  if (nailsOf(buildable) === 0) return completeFurniture(player, house, target, buildable, materials);
  hammerNails(player, buildable, {
    building: () => houseFor(player) === house && isBuildingMode(player),
    rest: (withoutNails) => getBuildMaterials(player, house, target, withoutNails),
    complete: (rest) => completeFurniture(player, house, target, buildable, rest),
  });
}

function nailsOf(buildable) {
  return buildable.materials.find(material => material.source === "NAILS")?.amount ?? 0;
}

/**
 * Hammers a piece's nails in, one a tick from the tick after the pick: "You use a nail." (spam), the
 * best nails first (Wiki: Nails), the build animation each time and the hammer sound on every
 * second nail and on the last. A workbench's last nail (`lastNail: false`) is silent and has no
 * animation of its own: the workbench takes over from it. Once the last nail is in, `rest` checks
 * the other materials again and `complete` uses them. Nails also bend in live OSRS, at a rate neither
 * the captures nor the Wiki give, so they don't here.
 */
function hammerNails(player, buildable, { building, rest, complete, lastNail = true }) {
  const nails = nailsOf(buildable);
  let used = 0;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player.getIndex(), false); }
    execute() {
      if (!player.isRegistered() || !building()) return this.stop();
      const nail = NAIL_IDS.find(id => player.getInventory().contains(id));
      if (nail == null) {
        player.sendMessage("You don't have enough nails left.");
        return this.stop();
      }
      player.getInventory().delete(nail, 1);
      player.getPacketSender().sendTypedMessage(ChatType.SPAM, "You use a nail.");
      used++;
      const last = used >= nails;
      if (!last || lastNail) {
        if (buildable.buildAnimationId >= 0) player.performAnimation(new Animation(buildable.buildAnimationId));
        if (used % 2 === 0 || last) player.getPacketSender().sendSound(BUILD_SOUND, 0, 0);
      }
      if (!last) return;
      this.stop();
      const materials = rest({ ...buildable, materials: buildable.materials.filter(material => material.source !== "NAILS") });
      if (!(materials instanceof Map)) return Menu.refuse(player, materials);
      complete(materials);
    }
  })());
}

function completeFurniture(player, house, target, buildable, materials) {
  useMaterials(player, buildable, materials);
  player.getSkillManager().addExperiences(Skill.CONSTRUCTION, CarpenterOutfit.withBonus(player, buildable.experience));
  // Wiki (Spirit tree (Construction), Spirit tree & fairy ring): a planted spirit tree gives Farming experience too.
  if (buildable.farmingExperience > 0) player.getSkillManager().addExperiences(Skill.FARMING, buildable.farmingExperience);
  // Wiki (Mithril armour (Construction), Rune case space): 25 experience in the piece's second skill too.
  if (buildable.secondSkillExperience > 0) {
    for (const requirement of buildable.secondaryLevels ?? []) {
      const skill = Skill.values().find(candidate => candidate.getClientId() === requirement.statId);
      if (skill) player.getSkillManager().addExperiences(skill, buildable.secondSkillExperience);
    }
  }
  GardenPlants.complete(player, buildable);
  house.setFurniture(target, buildable);
  api.emitCustomEvent("construction:furniture-built", { player, buildable });
  // Keyed to the house, so a click straight after the build doesn't cancel the redraw.
  TaskManager.submit(new CountdownTask(house, 1, () => {
    if (houseFor(player) === house) rebuildHouse(player, house);
  }));
}

function materialName(material) {
  if (material.itemId != null) return ItemDefinition.forId(material.itemId).getName();
  if (material.source === "NAILS") return "Nails";
  if (material.source && Data.BUILDABLE_BY_KEY.has(material.source)) return formatBuildable({ key: material.source });
  return material.source?.replace(/^Tool\./, "").replace(/_/g, " ").toLowerCase() || "Unknown material";
}

function furnitureCreationText(buildable) {
  // The build menu shows the cache's own name ("Crude wooden chair|Plank: 2<br>Nails: 2<br><br>").
  const name = buildable.name ?? formatBuildable(buildable);
  const materials = buildable.materials.slice(0, 4).map((material) => `${materialName(material)}: ${material.amount.toLocaleString()}`);
  // Four lines whatever the count: "Oak chair|Oak plank: 2<br><br><br>" (rsprox captures, rev 229).
  return `${name}|${[...materials, "", "", "", ""].slice(0, 4).join("<br>")}`;
}

/** What a hotspot offers in its build menu, named groups expanded. */
function hotspotChoices(hotspotKey) {
  return (Data.HOTSPOT_BY_KEY.get(hotspotKey)?.buildables ?? [])
    .flatMap((key) => FURNITURE_GROUPS[key] ?? [key])
    .map((key) => Data.BUILDABLE_BY_KEY.get(key))
    .filter((buildable) => buildable?.menuRowId != null);
}

function chooseFurniture(player, house, target) {
  // The cache hides some rows from build menus; they are reached as an upgrade of what's there.
  const existing = house.getFurnitureAtTarget(target)?.buildableKey;
  const choices = hotspotChoices(target.hotspotKey)
    .filter((buildable) => !buildable.hidden || buildable.materials.some((material) => material.source === existing));
  if (choices.length === 0) {
    player.getPacketSender().sendInterfaceRemoval();
    player.sendMessage("This construction hotspot does not have a buildable configured yet.");
    return;
  }
  const sender = player.getPacketSender();
  sender.sendInterface(FURNITURE_BUILD_INTERFACE);
  choices.forEach((buildable, index) => {
    // Script 1404 resolves the preview item and name through furniture DB table 110.
    sender.sendClientScript(
      FURNITURE_ENTRY_SCRIPT,
      index + 1,
      buildable.menuRowId,
      buildable.level,
      furnitureCreationText(buildable),
      getBuildMaterials(player, house, target, buildable) instanceof Map ? 1 : 0,
    );
  });
  sender
    .sendClientScript(FURNITURE_LIST_SCRIPT, choices.length, 0)
    .sendInterfaceFlagsRange(FURNITURE_BUILD_LIST_UID, 1, choices.length, 1);
  pendingFurnitureMenus.set(player, { house, target, choices });
}

function closeFurnitureMenu({ player, interfaceId }) {
  if (interfaceId !== FURNITURE_BUILD_INTERFACE || !pendingFurnitureMenus.delete(player)) return;
  // The furniture list script suspends normal chat input while the number shortcuts are active.
  Menu.restoreChatInput(player);
}

function selectFurnitureFromInterface(event) {
  if (event.groupId !== FURNITURE_BUILD_INTERFACE || event.childId !== 2) return false;
  const pending = pendingFurnitureMenus.get(event.player);
  if (!pending) return false;
  // Script 1405 sends RESUME_PAUSEBUTTON with a one-based child index.
  const choice = Number.isInteger(event.action) && event.action > 0 ? pending.choices[event.action - 1] : undefined;
  if (!choice || houseFor(event.player) !== pending.house || !isBuildingMode(event.player)) return false;
  event.player.getPacketSender().sendInterfaceRemoval();
  buildFurniture(event.player, pending.house, pending.target, choice);
  return true;
}

function openBuildMenu(event) {
  const player = event.player;
  const house = houseFor(player);
  if (!house || !isBuildingMode(player)) return false;
  const target = house.getFurnitureTarget(event.location, event.objectId);
  if (!target) return false;
  chooseFurniture(player, house, target);
  return true;
}

function tryRemoveFurniture(event) {
  if (event.definition?.getInteractions()?.[event.clickType - 1]?.toLowerCase() !== "remove") return false;
  const player = event.player;
  const house = houseFor(player);
  const type = event.object?.getType?.() ?? 10;
  if (!house || !isBuildingMode(player) || !house.getFurnitureAt(event.location, event.objectId, type)) return false;
  const problem = house.canRemoveFurniture(event.location, event.objectId, type);
  if (problem) {
    Menu.refuse(player, problem);
    return true;
  }
  // rsprox captures ("Remove" on poh_chair1, rev 229): "Really remove it?", and the Yes is silent.
  const confirm = () => api.sendMultiChatboxPrompt(player, "Really remove it?", "Yes", () => {
    if (houseFor(player) !== house || !isBuildingMode(player)) return;
    const currentProblem = house.canRemoveFurniture(event.location, event.objectId, type);
    if (currentProblem) return Menu.refuse(player, currentProblem);
    const furniture = house.removeFurniture(event.location, event.objectId, type);
    if (!furniture) return;
    player.performAnimation(new Animation(REMOVE_ANIMATION));
    rebuildHouse(player, house);
    api.emitCustomEvent("construction:furniture-removed", { player, house, furniture });
  }, "No", () => {});
  // A piece whose removal costs the player something warns first (rsprox captures: the portal nexus).
  const removal = { player, house, furniture: house.getFurnitureAt(event.location, event.objectId, type), warning: null };
  api.emitCustomEvent("construction:furniture-removing", removal);
  if (removal.warning) Menu.warn(player, removal.warning, confirm);
  else confirm();
  return true;
}

function onObject(event) {
  const player = event.player;
  if (event.objectId === GARDEN_CENTERPIECE_HOTSPOT_ID && !isBuildingMode(player)) return exitHouse(player);
  return openBuildMenu(event);
}

function onItemOnObject(event) {
  if (Altars.offerHouseBones(event) || Storage.storeItemOnFurniture(event)) return true;
  if ((event.itemId === TINDERBOX_ID || event.itemId === ItemIdentifiers.MARRENTILL) && Altars.lightHouseBurner(event)) return true;
  if (!HAMMERS.includes(event.itemId) && event.itemId !== SAW_ID) return false;
  return openBuildMenu(event);
}

function handleFurnitureAction(event) {
  const house = houseFor(event.player);
  if (!house) return;
  const action = event.definition?.getInteractions()?.[event.clickType - 1]?.toLowerCase();
  if (action === "sit-on" && sitOnChair(event)) { event.handled = true; return; }
  if (action === "remove") { if (tryRemoveFurniture(event)) event.handled = true; return; }
  if (action === "upgrade") {
    if (!isBuildingMode(event.player)) { event.player.sendMessage("Only the owner can upgrade furniture in building mode."); event.handled = true; return; }
    const saved = house.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
    const position = house.getRoomPositionAt(event.location);
    if (saved && position) { chooseFurniture(event.player, house, { ...saved, position }); event.handled = true; }
    return;
  }
  if (Servants.useServantFurniture(event) || Portals.useHousePortal(event)
    || (["light", "re-light"].includes(action ?? "") && Altars.lightHouseBurner(event))
    || (action === "open" && Storage.openHouseFurniture(event))
    || (action === "close" && Storage.closeHouseFurniture(event))
    || (["search", "view"].includes(action ?? "") && Storage.openHouseStorage(event))) event.handled = true;
}

// Cache-native ready poses for the seven parlour chairs, in furniture-menu order.
const CHAIR_READY_ANIMATIONS = Array.from({ length: 7 }, (_, index) => Ids.seq(`chair_sit_ready_chair${index + 1}`));
// Thrones sit like chairs, with their own ready poses (chair_sit_ready_throne_1..7, captures).
const THRONES = ["OAK_THRONE", "TEAK_THRONE", "MAHOGANY_THRONE", "GILDED_THRONE", "SKELETON_THRONE", "CRYSTAL_THRONE", "DEMONIC_THRONE"];
const THRONE_READY_ANIMATIONS = THRONES.map((_, index) => Ids.seq(`chair_sit_ready_throne_${index + 1}`));
const DINING_BENCHES = ["WOODEN_BENCH", "OAK_BENCH", "CARVED_OAK_BENCH", "TEAK_BENCH", "CARVED_TEAK_BENCH", "MAHOGANY_BENCH", "GILDED_BENCH"];
const BENCH_READY_ANIMATIONS = DINING_BENCHES.map((_, index) => Ids.seq(`chair_sit_ready_diningchairs_${index + 1}`));
const CHAIR_SIT_ANIMATION = Ids.seq("chair_sit");
// A half-turn takes 32 client cycles; allow two server ticks before sitting.
const CHAIR_TURN_TICKS = 2;
const seatedPlayers = new WeakMap();

function isSeatedForDinner(player) {
  const seat = seatedPlayers.get(player);
  return !!seat?.sitting && DINING_BENCHES.includes(seat.furniture.buildableKey)
    && player.getPrivateArea() === seat.house && player.getLocation().equals(seat.location);
}

function chairFront(object) {
  const [dx, dy] = (object.getType() === 11
    ? [[-1, -1], [-1, 1], [1, 1], [1, -1]]
    : [[0, -1], [-1, 0], [0, 1], [1, 0]])[object.getFace() & 3];
  return object.getLocation().transform(dx, dy);
}

function routeHouseChair(event) {
  standFromChair(event.player);
  if (event.definition?.getInteractions()?.[event.clickType - 1]?.toLowerCase() !== "sit-on") return;
  const furniture = houseFor(event.player)?.getFurnitureAt(event.object.getLocation(), event.objectId, event.object.getType());
  if (furniture && (FURNITURE_GROUPS.PARLOUR_CHAIRS.includes(furniture.buildableKey) || DINING_BENCHES.includes(furniture.buildableKey))) event.destination = chairFront(event.object);
}

function standFromChair(player) {
  const seat = seatedPlayers.get(player);
  if (!seat) return;
  seatedPlayers.delete(player);
  const character = player;
  if (character.getSkillAnimation() === seat.ready) {
    character.setSkillAnimation(seat.previousAnimation);
    character.getUpdateFlag().flag(Flag.APPEARANCE);
  }
  const animation = character.getAnimation()?.getId();
  if (animation === CHAIR_SIT_ANIMATION || animation === seat.ready) character.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
}

function sitOnChair({ player, object, objectId, location }) {
  const house = houseFor(player);
  const type = object.getType();
  const furniture = house?.getFurnitureAt(location, objectId, type);
  const index = furniture ? FURNITURE_GROUPS.PARLOUR_CHAIRS.indexOf(furniture.buildableKey) : -1;
  const bench = furniture ? DINING_BENCHES.indexOf(furniture.buildableKey) : -1;
  const throne = furniture ? THRONES.indexOf(furniture.buildableKey) : -1;
  if (!house || !furniture || (index < 0 && bench < 0 && throne < 0)) return false;
  const seatLocation = new Location(location.x, location.y, location.z);
  const front = chairFront(object);
  // ObjectActionPacketListener routes first; never seat a distant or stale click.
  if (!player.getLocation().equals(front)) return true;
  if (seatedPlayers.get(player)?.furniture === furniture) return true;
  if (house.getPlayers().some(other => {
    const seat = seatedPlayers.get(other);
    return other !== player && seat?.furniture === furniture
      && other.getLocation().equals(seat.sitting ? seat.location : seat.front);
  })) {
    player.sendMessage("Someone is already sitting there.");
    return true;
  }
  standFromChair(player);
  // chairFront already rotates the player for diagonal chairs. Their alternate
  // idle sequences contain another body turn, so keep the unrotated pose.
  const ready = throne >= 0 ? THRONE_READY_ANIMATIONS[throne] : bench >= 0 ? BENCH_READY_ANIMATIONS[bench] : CHAIR_READY_ANIMATIONS[index];
  seatedPlayers.set(player, { house, location: seatLocation, objectId, type, furniture, ready, front,
    sitCycle: World.getProcessCycle() + CHAIR_TURN_TICKS, sitting: false,
    previousAnimation: player.getSkillAnimation() ?? 0 });
  player.setPositionToFace(front.transform(front.x - seatLocation.x, front.y - seatLocation.y));
  player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  return true;
}

function processChair(player) {
  const seat = seatedPlayers.get(player);
  if (!seat) return;
  const animation = player.getAnimation()?.getId();
  if (player.getPrivateArea() !== seat.house || seat.house.isDestroyed()
    || !player.getLocation().equals(seat.sitting ? seat.location : seat.front)
    || seat.house.getFurnitureAt(seat.location, seat.objectId, seat.type) !== seat.furniture
    || (animation != null && animation !== CHAIR_SIT_ANIMATION && animation !== seat.ready
      && (seat.sitting || animation !== Animation.DEFAULT_RESET_ANIMATION.getId()))) {
    standFromChair(player);
    return;
  }
  if (!seat.sitting && World.getProcessCycle() >= seat.sitCycle) {
    seat.sitting = true;
    player.moveTo(seat.location);
    player.setPositionToFace(seat.front);
    player.getUpdateFlag().flag(Flag.FACE_POSITION);
    player.setSkillAnimation(seat.ready);
    player.getUpdateFlag().flag(Flag.APPEARANCE);
    // Facing already includes shape 11's 45-degree turn. The diagonal entry
    // sequence turns the body again, so use the forward-facing sit transition.
    player.performAnimation(new Animation(CHAIR_SIT_ANIMATION));
  }
}

function openHouseDoor(event) {
  const { player, objectId, location } = event;
  if (houseFor(player)?.toggleDoor(objectId, new Location(location.x, location.y, location.z))) event.handled = true;
}

function nearbyHouseLocation(player, objectId) {
  const direct = Estate.HOUSE_LOCATIONS.find(location => location.portal === objectId || location.board === objectId);
  if (direct) return direct.id;
  if (objectId === DIARY_PORTAL_ID) return 6; // Yanille
  const house = houseFor(player);
  if (house) return Estate.houseLocation(house.save).id;
  const position = player.getLocation();
  return Estate.HOUSE_LOCATIONS.reduce((nearest, location) =>
    Math.hypot(location.x - position.getX(), location.y - position.getY())
      < Math.hypot(nearest.x - position.getX(), nearest.y - position.getY()) ? location : nearest).id;
}

function yanilleHouseEntryContext(objectId, location, sourceLocation, object) {
  const face = object?.getFace?.();
  if (object?.getType?.() !== 10 || face !== 2
    || YANILLE_HOUSE_PORTAL_FOOTPRINT.sizeX !== 5 || YANILLE_HOUSE_PORTAL_FOOTPRINT.sizeY !== 2) return null;
  if (objectId !== YANILLE_HOUSE_PORTAL_ID
    || location?.x !== YANILLE_HOUSE_PORTAL_LOCATION.x
    || location?.y !== YANILLE_HOUSE_PORTAL_LOCATION.y
    || location?.z !== YANILLE_HOUSE_PORTAL_LOCATION.z) return null;
  const width = (face & 1) === 1 ? YANILLE_HOUSE_PORTAL_FOOTPRINT.sizeY : YANILLE_HOUSE_PORTAL_FOOTPRINT.sizeX;
  const length = (face & 1) === 1 ? YANILLE_HOUSE_PORTAL_FOOTPRINT.sizeX : YANILLE_HOUSE_PORTAL_FOOTPRINT.sizeY;
  if (!isHousePortalReachable(sourceLocation, location, width, length)) return null;
  return {
    yanillePortal: true,
    objectId,
    portalLocation: { ...location },
    sourceLocation: { ...sourceLocation },
    width,
    length,
  };
}

function isHousePortalReachable(sourceLocation, portalLocation, width, length) {
  if (!sourceLocation || sourceLocation.z !== portalLocation.z) return false;
  const insideFootprint = sourceLocation.x >= portalLocation.x && sourceLocation.x < portalLocation.x + width
    && sourceLocation.y >= portalLocation.y && sourceLocation.y < portalLocation.y + length;
  if (insideFootprint) return false;
  const gap = (point, start, size) => Math.max(0, start - point, point - (start + size - 1));
  return Math.max(gap(sourceLocation.x, portalLocation.x, width),
    gap(sourceLocation.y, portalLocation.y, length)) <= 1;
}

function isCurrentYanilleHouseEntry(player, context) {
  if (context?.yanillePortal !== true || context.objectId !== YANILLE_HOUSE_PORTAL_ID
    || context.portalLocation?.x !== YANILLE_HOUSE_PORTAL_LOCATION.x
    || context.portalLocation?.y !== YANILLE_HOUSE_PORTAL_LOCATION.y
    || context.portalLocation?.z !== YANILLE_HOUSE_PORTAL_LOCATION.z
    || Estate.houseLocation(houseStateFor(player)).id !== YANILLE_HOUSE_LOCATION_ID) return false;
  const current = player.getLocation();
  const original = context.sourceLocation;
  return !!current && !!original
    && current.getX() === original.x
    && current.getY() === original.y
    && current.getZ() === original.z
    && isHousePortalReachable(original, context.portalLocation, context.width, context.length);
}

function enterAtPortal(player, buildingMode, location, diaryEntryContext, walked = false) {
  if (Estate.houseLocation(houseStateFor(player)).id !== location) {
    player.sendMessage("Your house is not located here.");
    return true;
  }
  return loadOwnHouse(player, buildingMode, location, diaryEntryContext, walked);
}

/**
 * Home and Build mode: the refusals come at the click, then the loading screen with the house's
 * jingle; the house loads a tick later and the screen closes the tick after. A player already
 * standing at the portal gets the screen on the click and the jingle a tick later, and the rest
 * follows a tick later too.
 */
function loadOwnHouse(player, buildingMode, location, diaryEntryContext, walked = false) {
  if (loadingHouses.has(player) || !ownsAHouse(player)) return true;
  if (entryRefused(player, buildingMode, "portal", () => loadOwnHouse(player, buildingMode, location, diaryEntryContext))) return true;
  player.getPacketSender().sendInterfaceRemoval();
  const save = houseStateFor(player);
  const enter = () => {
    enterHouse(player, buildingMode, diaryEntryContext, "portal");
    if (houseFor(player)) api.emitCustomEvent("poh:entered", { player, location });
  };
  if (walked) {
    showHouseLoading(player, { jingle: save });
    loadHouse(player, { 1: enter, 2: () => hideHouseLoading(player) });
  } else {
    showHouseLoading(player);
    loadHouse(player, { 1: () => playLoadingJingle(player, save), 2: enter, 3: () => hideHouseLoading(player) });
  }
  return true;
}

/** Notes where the player clicked a house portal from (the object route event). */
function notePortalClick({ player, objectId, sourceLocation }) {
  if (!HOUSE_PORTAL_IDS.includes(objectId) || !sourceLocation) return;
  portalClickTiles.set(player, `${sourceLocation.x},${sourceLocation.y},${sourceLocation.z}`);
}

/** Whether the player walked to the portal they're now using; forgets the click. */
function walkedToPortal({ player, sourceLocation }) {
  const clicked = portalClickTiles.get(player);
  portalClickTiles.delete(player);
  return clicked != null && !!sourceLocation && clicked !== `${sourceLocation.x},${sourceLocation.y},${sourceLocation.z}`;
}

/** Enter: "Select an option" over the portal's three destinations. */
function openPortalMenu(event) {
  portalClickTiles.delete(event.player);
  api.sendMultiChatboxPrompt(event.player, "Select an option",
    "Go to your house", () => enterNormalHouse(event, false),
    "Go to your house (building mode)", () => enterBuildingHouse(event, false),
    "Go to a friend's house", () => promptVisit(event),
    "Cancel", () => {});
  return true;
}
function enterNormalHouse(event, walked = walkedToPortal(event)) {
  const { player, objectId, location, sourceLocation, object } = event;
  const diaryEntryContext = yanilleHouseEntryContext(objectId, location, sourceLocation, object);
  return enterAtPortal(player, false, nearbyHouseLocation(player, objectId), diaryEntryContext, walked);
}
function enterBuildingHouse(event, walked = walkedToPortal(event)) {
  const { player, objectId, location, sourceLocation, object } = event;
  const diaryEntryContext = yanilleHouseEntryContext(objectId, location, sourceLocation, object);
  return enterAtPortal(player, true, nearbyHouseLocation(player, objectId), diaryEntryContext, walked);
}
/**
 * Wiki, Player-owned house: deaths anywhere in an active house keep items,
 * restore stats and leave by its portal, including player kills on PvP worlds.
 * CombatRings' earlier hook retains its separate in-house defeat behavior.
 */
function safeHouseDeath(event) {
  const { player } = event;
  const house = houseFor(player);
  if (event.preventDeath || !house || house.isDestroyed() || !house.getPlayers().includes(player)) return;
  event.preventDeath = true;
  const combat = player.getCombat();
  combat.reset();
  combat.setUnderAttack(null);
  combat.getHitQueue().clear();
  combat.clearDamageMap();
  api.core.CombatFactory.clearHitRollCache(player);
  World.getPlayers().forEach(other => { if (other !== player) other.getCombat().removeDamager(player); });
  player.setFollowing(null);
  player.resetAttributes();
  exitHouse(player);
}

function leaveHouse({ player }) {
  if (!houseFor(player)) return false;
  player.getPacketSender().sendSound(PORTAL_SOUND, 1, 0);
  return exitHouse(player);
}
function showAdvertisements({ player, objectId }) { viewAdvertisements(player, nearbyHouseLocation(player, objectId)); return true; }
function visitLastHouse({ player }) {
  const name = lastVisited.get(player);
  if (name) visitHouse(player, name, undefined, null, { loading: true });
  else player.sendMessage("You haven't visited anyone this session.");
  return true;
}
function houseCommand({ player }) { openHouseSettings(player); }
function handleHouseItem(event) { if (onItemOnObject(event)) event.handled = true; }
function handleHouseInterface(event) { if (selectFurnitureFromInterface(event) || selectRoomFromInterface(event) || handleAdvertisementInterface(event) || handleHouseOptions(event) || handleHouseViewer(event)) event.handled = true; }
function loginHouse({ player }) {
  houseOptionsOpen.delete(player);
  kickOptionVisible.delete(player);
  player.getPacketSender().sendPlayerOption(HOUSE_KICK_OPTION, "", false);
  syncHouseOptions(player);
  if (Instance.PlayerHouseInstance.isAllocationLocation(player.getLocation())) {
    player.moveTo(Estate.houseExit(houseStateFor(player)));
    player.sendMessage("Returned from your house after the instance closed.");
  }
}
function logoutHouse({ player }) { standFromChair(player); endAdvert(player); releaseHouse(player, true); }
/** Per tick, for players inside a house only (PlayerHouseInstance.process). */
function processOccupant(player, house) {
  processChair(player);
  Workbench.processSeat(player, house);
  Servants.processServant(player);
  syncKickOption(player);
  Altars.expireHouseBurners(house);
  CombatRoom.tendDummies(house);
  Dungeon.processOccupant(player, house);
}

/** PlayerHouseInstance.postLeave, after the player is out of the house. */
function leftHouse(player, house) {
  standFromChair(player);
  Workbench.standUp(player);
  syncKickOption(player);
  GamesRoom.leftGamesRoom(player, house);
  CombatRings.leftCombatRoom(player);
  Tea.leftWithTea(player);
}

// Kourend and Varlamore house locations need a visit first (Estate agent check).
function recordRegionVisit({ player, location }) {
  if (player.getPrivateArea() || location.getX() < 1024 || location.getX() >= 2048) return;
  const saved = houseStateFor(player);
  if (location.getY() >= 3200 && location.getY() < 4096 && !saved.visitedKourend) {
    saved.visitedKourend = true;
    player.setAttribute(HOUSE_ATTRIBUTE, saved);
  } else if (location.getY() >= 2816 && location.getY() < 3200 && !saved.visitedVarlamore) {
    saved.visitedVarlamore = true;
    player.setAttribute(HOUSE_ATTRIBUTE, saved);
  }
}

// Vengeance can't be cast in a house (rsprox capture 1074, Wiki: Vengeance), nor Vengeance Other (Wiki: Vengeance
// Other: "unable to cast Vengeance Other inside of a player-owned house").
function refuseHouseVengeance(event) {
  const vengeance = event.spell === EffectSpells.VENGEANCE || event.spellId === EffectSpells.VENGEANCE_OTHER.spellId();
  if (!vengeance || !houseFor(event.player)) return;
  event.player.sendMessage("You can't use this spell inside a player-owned house.");
  event.disabled = true;
}

const hotspotIds = [...Data.HOTSPOT_BY_OBJECT_ID.keys()].filter(id => id >= 0);
const furnitureObjectIds = [...new Set(Data.CONSTRUCTION_BUILDABLES.flatMap(buildable => buildable.objectIds.filter(id => id >= 0)))];

function attach(api) {
  EstateAgent.attachEstateAgents(api);
  Servants.attachServants(api);
  Menu.attachMenus(api);
  JewelleryBox.attachJewelleryBoxes(api);
  Mounted.attachMountedItems(api);
  SuperiorGarden.attachSuperiorGarden(api);
  Lectern.attachLecterns(api);
  Stairs.attachStairs(api);
  Workshop.attachWorkshop(api);
  Kitchen.attachKitchen(api);
  Workbench.attachWorkbench(api);
  Study.attachStudy(api);
  CombatRoom.attachCombatRoom(api);
  Dungeon.attachDungeon(api);
  ThroneRoom.attachThroneRoom(api);
  Menagerie.attachMenagerie(api);
  Decorations.attachDecorations(api);
  GamesRoom.attachGamesRoom(api);
  CombatRings.attachCombatRings(api);
  Tea.attachTea(api);
  TipJar.attachTipJar(api);
  Bookcase.attachBookcase(api);
  Storage.attachStorage(api);
  Scrying.attachScrying(api);
  CapeHanger.attachCapeHanger(api);
  Trophies.attachTrophies(api);
  MahoganyHomes.attachMahoganyHomes(api);
  CarpenterOutfit.attachCarpenterOutfit(api);
  Nexus.attachNexus(api);
  ClockworkToys.attachClockworkToys(api);
  api.persistAttribute(HOUSE_ATTRIBUTE, defaultHouse());
  api.onObjectFirstClick(HOUSE_PORTAL_IDS, openPortalMenu);
  api.onObjectSecondClick(HOUSE_PORTAL_IDS, enterNormalHouse);
  api.onObjectThirdClick(HOUSE_PORTAL_IDS, enterBuildingHouse);
  api.onObjectFourthClick(HOUSE_PORTAL_IDS, promptVisit);
  api.onObjectInteraction("House Advertisement", { View: showAdvertisements, "Add-House": offerAdvert, "Visit-Last": visitLastHouse });
  api.onObjectFirstClick(EXIT_PORTAL_ID, leaveHouse);
  api.onObjectSecondClick(EXIT_PORTAL_ID, toggleHouseLock);
  api.onObjectThirdClick(EXIT_PORTAL_ID, removeAdvertisement);
  api.registerCommand("house", houseCommand, PlayerRights.NONE, "Open your house options");
  api.registerCommand("hotspots", Commands.listHotspots, PlayerRights.DEVELOPER, "List the Construction hotspots in the room you stand in");
  api.registerCommand("housemats", Commands.houseMaterials, PlayerRights.DEVELOPER, "Spawn the materials to build a piece of furniture or a room");
  api.registerCommand("deletehouse", Commands.deleteHouse, PlayerRights.DEVELOPER, "Delete your house, so you have to buy a new one");
  api.registerCommand("maxhouse", MaxHouse.maxHouse, PlayerRights.DEVELOPER, "Replace your house with one of every room, fully furnished (::restorehouse undoes it)");
  api.registerCommand("restorehouse", MaxHouse.restoreHouse, PlayerRights.DEVELOPER, "Bring back the house ::maxhouse replaced");
  api.persistAttribute(MaxHouse.BACKUP_ATTRIBUTE, null);
  api.onObjectFirstClick(ROOM_DOOR_HOTSPOT_IDS, openRoomDoor);
  api.onObjectFifthClick(ROOM_DOOR_HOTSPOT_IDS, openRoomDoor);
  api.onObjectFirstClick(furnitureObjectIds, tryRemoveFurniture);
  api.onObjectSecondClick(furnitureObjectIds, tryRemoveFurniture);
  api.onObjectFifthClick(furnitureObjectIds, tryRemoveFurniture);
  api.onObjectFirstClick(hotspotIds, onObject);
  api.onObjectSecondClick(hotspotIds, onObject);
  api.onObjectFifthClick(hotspotIds, onObject);
  api.onObjectInteraction(handleFurnitureAction);
  api.onObjectRoute(routeHouseChair);
  api.onObjectRoute(notePortalClick);
  api.onItemOnObject(handleHouseItem, { noted: false });
  api.onInterfaceActionClick(handleHouseInterface);
  api.onCustomEvent("player:option-route", kickGuest);
  api.onCustomEvent("door:toggle", openHouseDoor);
  api.onCustomEvent("interface:close", closeHouseSettings);
  api.onCustomEvent("interface:closed", closeFurnitureMenu);
  api.onCustomEvent("spell:teleport-arrival", houseTeleportArrival);
  api.onCustomEvent("construction:house-tablet", houseTablet);
  api.onCustomEvent("construction:owns-house", ownsHouse);
  api.onCustomEvent("construction:grant-house", grantHouse);
  api.onCustomEvent("construction:spirit-tree", spiritTreeHouse);
  api.onCustomEvent("construction:spirit-tree-travel", spiritTreeTravel);
  api.onCustomEvent("construction:exit-house", exitHouseTo);
  api.onSpellDisabled(refuseHouseVengeance);
  api.onPlayerBeforeDeath(safeHouseDeath);
  api.onPlayerLogin(loginHouse);
  api.onPlayerMapSquareChange(recordRegionVisit);
  api.onPlayerDisconnect(logoutHouse);
  api.onPlayerLogout(logoutHouse);
}

Object.assign(module.exports, { completeFurniture, enterHouse, visitHouse, storedAmount, houseStateFor, releaseHouse, canVisitHouse, syncHouseOptions, isSeatedForDinner, houseFor, saveHouse, rebuildHouse, removeRoomPrompt, isBuildingMode, constructionLevel, furnitureLevel, hasHammer, hasSaw, getBuildMaterials, useMaterial, useMaterials, hammer, hammerNails, nailsOf, hotspotChoices, furnitureCreationText, processOccupant, leftHouse, attach });
