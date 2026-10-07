import { EstateAgentPlugin } from "./EstateAgentPlugin";
import { ConstructionServants, callServant, processServant, useServantFurniture } from "./ConstructionServants";
import { HOUSE_LOCATIONS, HOUSE_STYLES, houseLocation, houseExit, houseStyleIndex } from "./HouseEstateData";
import type { PluginApi, PluginInterfaceActionClickEvent, PluginItemOnObjectEvent, PluginObjectInteractionEvent, PluginObjectRouteEvent } from "../../../../plugins/PluginTypes";
import type { GameObject } from "../../../entity/impl/object/GameObject";
import { openHouseStorage, storeItemOnFurniture } from "./ConstructionStorage";
import { useHousePortal } from "./ConstructionPortals";
import { lightHouseBurner, offerHouseBones, expireHouseBurners } from "./ConstructionAltars";
import { World } from "../../../World";
import { Animation } from "../../../model/Animation";
import { Flag } from "../../../model/Flag";
import { Location } from "../../../model/Location";
import { Skill } from "../../../model/Skill";
import { PrivateChatStatus } from "../../../model/PlayerRelations";
import type { Player } from "../../../entity/impl/player/Player";
import type { PacketSender } from "../../../../net/packet/PacketSender";
import { ItemIdentifiers } from "../../../../util/ItemIdentifiers";
import { BUILDABLE_BY_KEY, CONSTRUCTION_BUILDABLES, CONSTRUCTION_ROOMS, CONSTRUCTION_VIEWER_FURNITURE, ROOM_BY_KEY, HOTSPOT_BY_OBJECT_ID, type ConstructionBuildable, type ConstructionRoom } from "./ConstructionData";
import { PlayerHouseInstance, createDefaultHouseSave, type HouseFurnitureTarget, type HouseRoomPosition, type PlayerHouseSave } from "./PlayerHouseInstance";

type ConstructionPlayer = {
  getAttribute(key: string): unknown;
  getLocation(): Location;
  getPrivateArea(): unknown;
  getSkillManager(): { getCurrentLevel(skill: Skill): number; addExperiences(skill: Skill, experience: number): unknown };
  getInventory(): { contains(id: number): boolean; getAmount(id: number): number; delete(id: number, amount: number): unknown };
  getPacketSender(): PacketSender;
  moveTo(location: Location): unknown;
  performAnimation(animation: Animation): void;
  sendMessage(message: string): void;
  setAttribute(key: string, value: unknown): void;
};

const HAMMER_ID = ItemIdentifiers.HAMMER;
const SAW_ID = ItemIdentifiers.SAW;
const TINDERBOX_ID = ItemIdentifiers.TINDERBOX;
const NAIL_IDS = [ItemIdentifiers.BRONZE_NAILS, ItemIdentifiers.IRON_NAILS, ItemIdentifiers.STEEL_NAILS,
  ItemIdentifiers.BLACK_NAILS, ItemIdentifiers.MITHRIL_NAILS, ItemIdentifiers.ADAMANTITE_NAILS,
  ItemIdentifiers.RUNE_NAILS, ItemIdentifiers.DRAGON_NAILS];
const HOUSE_PORTAL_IDS = [...HOUSE_LOCATIONS.map(location => location.portal), 30172];
const EXIT_PORTAL_ID = 4525;
const HOUSE_LOCKED_VARBIT = 2183;
const GARDEN_CENTERPIECE_HOTSPOT_ID = 15361;
const ROOM_DOOR_HOTSPOT_IDS = [...new Set([...Array.from({ length: 18 }, (_, index) => 15305 + index), ...HOUSE_STYLES.flatMap(style => style.doorHotspots)])];
const COINS_ID = 995;
const HOUSE_ATTRIBUTE = "construction:house";
const FURNITURE_BUILD_INTERFACE = 458;
const FURNITURE_BUILD_LIST_UID = (FURNITURE_BUILD_INTERFACE << 16) | 2;
const HOUSE_BOARD_INTERFACE = 52;
const HOUSE_BOARD_ROW_SCRIPT = 3110;
const HOUSE_BOARD_LAST_ROW = 200;
const HOUSE_BOARD_LOCATION_VARBIT = 9449;

// Expand the named furniture groups used by parlour hotspot menus.
const FURNITURE_GROUPS: Readonly<Record<string, readonly string[]>> = {
  PARLOUR_CHAIRS: ["CRUDE_WOODEN_CHAIR", "WOODEN_CHAIR", "ROCKING_CHAIR", "OAK_CHAIR", "OAK_ARMCHAIR", "TEAK_ARMCHAIR", "MAHOGANY_ARMCHAIR"],
  RUGS: ["BROWN_RUG", "RUG", "OPULENT_RUG"],
  BOOKCASES: ["WOODEN_BOOKCASE", "OAK_BOOKCASE", "MAHOGANY_BOOKCASE"],
  FIREPLACES: ["CLAY_FIREPLACE", "STONE_FIREPLACE", "MARBLE_FIREPLACE"],
  CURTAIN: ["TORN_CURTAINS", "CURTAINS", "OPULENT_CURTAINS"],
};

type PersistedHouse = PlayerHouseSave & { defaultBuildingMode: boolean; teleportOutside?: boolean };

const HOUSE_OPTIONS_INTERFACE = 370;
const SETTINGS_TARGET_UID = (161 << 16) | 87;
const HOUSE_KICK_OPTION = 7;
const houseOptionsOpen = new WeakSet<ConstructionPlayer>();
const kickOptionVisible = new WeakSet<ConstructionPlayer>();

const activeHouses = new WeakMap<ConstructionPlayer, PlayerHouseInstance>();
const advertisedHouses = new Set<PlayerHouseInstance>();
const lastVisited = new WeakMap<ConstructionPlayer, string>();
const pendingFurnitureMenus = new WeakMap<ConstructionPlayer, {
  house: PlayerHouseInstance;
  target: HouseFurnitureTarget;
  choices: readonly ConstructionBuildable[];
}>();

export function houseStateFor(player: ConstructionPlayer): PersistedHouse {
  const saved = player.getAttribute(HOUSE_ATTRIBUTE);
  if (saved && typeof saved === "object" && Array.isArray((saved as PlayerHouseSave).rooms)) {
    const house = saved as PersistedHouse;
    const movedStarter = moveLegacyStarterHouse(house);
    const addedBuildingMode = typeof house.defaultBuildingMode !== "boolean";
    if (addedBuildingMode) house.defaultBuildingMode = false;
    if (addedBuildingMode || movedStarter) player.setAttribute(HOUSE_ATTRIBUTE, house);
    return house;
  }

  const house: PersistedHouse = { ...createDefaultHouseSave(), owned: false, defaultBuildingMode: false };
  player.setAttribute(HOUSE_ATTRIBUTE, house);
  return house;
}

function moveLegacyStarterHouse(house: PlayerHouseSave): boolean {
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

function houseFor(player: ConstructionPlayer): PlayerHouseInstance | null {
  const area = player.getPrivateArea();
  return area instanceof PlayerHouseInstance ? area : null;
}

function isBuildingMode(player: ConstructionPlayer): boolean {
  const house = houseFor(player);
  return house?.owner === player && house.buildingMode;
}

export function releaseHouse(player: ConstructionPlayer, restoreLocation: boolean): void {
  const owned = activeHouses.get(player);
  if (houseFor(player)) exitHouse(player);
  if (owned) {
    for (const guest of owned.getPlayers().slice()) exitHouse(guest);
    advertisedHouses.delete(owned);
    owned.destroy();
    activeHouses.delete(player);
  }
  pendingFurnitureMenus.delete(player);
  if (restoreLocation && PlayerHouseInstance.isAllocationLocation(player.getLocation())) player.moveTo(houseExit(houseStateFor(player)));
}

/** "construction:owns-house" { player, owns }: whether the player has bought a house. */
function ownsHouse(request: { player: ConstructionPlayer; owns?: boolean }): void {
  if (request?.player) request.owns = houseStateFor(request.player).owned !== false;
}

function enterHouse(player: ConstructionPlayer, buildingMode: boolean): boolean {
  if (houseStateFor(player).owned === false) {
    player.sendMessage("You do not own a house. Speak to an Estate agent to buy one.");
    return false;
  }
  let house = activeHouses.get(player);
  if (house?.isDestroyed()) house = undefined;
  if (buildingMode && house?.getPlayers().some(guest => guest !== player)) {
    player.sendMessage("Expel your guests before entering building mode.");
    return true;
  }
  player.getPacketSender().sendInterfaceRemoval();
  houseViewers.delete(player);
  pendingRoomMenus.delete(player);
  pendingFurnitureMenus.delete(player);
  if (houseFor(player) && houseFor(player) !== house) exitHouse(player);
  if (!house) {
    house = new PlayerHouseInstance(houseStateFor(player));
    house.owner = player as Player;
    activeHouses.set(player, house);
  }
  if (buildingMode) advertisedHouses.delete(house);
  if (!house.enterHouse(player as Player, buildingMode)) {
    releaseHouse(player, true);
    player.sendMessage("Unable to load your house.");
    return false;
  }
  player.getPacketSender().sendVarbit(HOUSE_LOCKED_VARBIT, house.save.locked ? 1 : 0);
  syncHouseOptions(player);
  syncKickOption(player);
  player.sendMessage(buildingMode ? "You enter your house in building mode." : "You enter your house.");
  return true;
}

export function canVisitHouse(player: Player, house: PlayerHouseInstance): boolean {
  const owner = house.owner;
  return !!owner && !house.isDestroyed() && !house.buildingMode && !house.save.locked
    && owner.getRelations().canReceivePrivateMessageFrom(player);
}

function visitHouse(player: Player, name: string, location = nearbyHouseLocation(player)): void {
  const owner = World.getPlayerByName(name.trim().replace(/_/g, " "));
  const house = owner && activeHouses.get(owner);
  if (owner === player) { enterAtPortal(player, false, location); return; }
  if (!house || houseLocation(house.save).id !== location || !canVisitHouse(player, house)) {
    player.sendMessage("That house is unavailable or its owner is not accepting guests.");
    return;
  }
  if (houseFor(player) === house) return;
  if (houseFor(player)) exitHouse(player);
  if (!house.enterHouse(player, false)) { exitHouse(player); return; }
  lastVisited.set(player, owner!.getUsername());
  player.getPacketSender().sendVarbit(HOUSE_LOCKED_VARBIT, house.save.locked ? 1 : 0);
  player.sendMessage("Welcome to " + owner!.getUsername() + "'s house.");
}

function promptVisit({ player, objectId }: PluginObjectInteractionEvent): boolean {
  const location = nearbyHouseLocation(player, objectId);
  player.setEnteredSyntaxAction({ execute: (name: string) => visitHouse(player, name, location) });
  player.getPacketSender().sendEnterInputPrompt("Whose house would you like to visit?");
  return true;
}

function expelGuests(player: ConstructionPlayer): void {
  const house = activeHouses.get(player);
  if (!house || houseFor(player) !== house || house.owner !== player) return;
  for (const guest of house.getPlayers().slice()) if (guest !== player) {
    exitHouse(guest);
    guest.sendMessage("The house owner has expelled you.");
  }
}

function addAdvertisement({ player, objectId }: PluginObjectInteractionEvent): boolean {
  const location = nearbyHouseLocation(player, objectId);
  if (houseLocation(houseStateFor(player)).id !== location) {
    player.sendMessage("Your house is not located here.");
    return true;
  }
  let house = activeHouses.get(player);
  if (!house || house.isDestroyed() || houseFor(player) !== house) {
    if (!enterHouse(player, false)) return true;
    house = activeHouses.get(player);
  }
  if (!house || house.buildingMode || house.save.locked || player.getRelations().getStatus() === PrivateChatStatus.OFF) {
    player.sendMessage("Open your house in normal mode and enable Private chat before advertising.");
    return true;
  }
  advertisedHouses.add(house);
  player.sendMessage("Your house is now advertised.");
  return true;
}

function removeAdvertisement({ player }: PluginObjectInteractionEvent): boolean {
  const house = activeHouses.get(player);
  if (house) advertisedHouses.delete(house);
  player.sendMessage("Your house advertisement has been removed.");
  return true;
}

function advertisementRow(house: PlayerHouseInstance): string {
  const furniture = new Set<string>();
  for (const plane of house.save.rooms) for (const column of plane) for (const room of column) {
    if (!room) continue;
    for (const key of Object.values(room.furniture)) furniture.add(key);
    for (const saved of Object.values(room.furnitureByLocation ?? {})) furniture.add(saved.buildableKey);
  }
  const tier = (keys: string[]): string => {
    for (let i = keys.length - 1; i >= 0; i--) if (furniture.has(keys[i])) return String(i + 1);
    return "-";
  };
  return [house.owner!.getUsername(), houseLocation(house.save).id,
    house.owner!.getSkillManager().getMaxLevel(Skill.CONSTRUCTION),
    furniture.has("GILDED_ALTAR") ? "Y" : "-",
    tier(["MARBLE_PORTAL_NEXUS", "GILDED_PORTAL_NEXUS", "CRYSTALLINE_PORTAL_NEXUS"]),
    tier(["BASIC_JEWELLERY_BOX", "FANCY_JEWELLERY_BOX", "ORNATE_JEWELLERY_BOX"]),
    tier(["RESTORATION_POOL", "REVITALISATION_POOL", "REJUVENATION_POOL", "FANCY_REJUVENATION_POOL", "ORNATE_REJUVENATION_POOL"]),
    [...furniture].some(key => key.startsWith("OCCULT_ALTAR")) ? "O" :
      furniture.has("DARK_ALTAR") ? "D" : furniture.has("LUNAR_ALTAR") ? "L" : furniture.has("ANCIENT_ALTAR") ? "A" : "-",
    furniture.has("ARMOUR_STAND") ? "Y" : "-"].join("|");
}

const boardLocations = new WeakMap<Player, number>();

function viewAdvertisements(player: Player, location = boardLocations.get(player) ?? nearbyHouseLocation(player)): void {
  boardLocations.set(player, location);
  for (const house of advertisedHouses) if (house.isDestroyed()) advertisedHouses.delete(house);
  const houses = [...advertisedHouses].filter(house => houseLocation(house.save).id === location && canVisitHouse(player, house)).slice(0, HOUSE_BOARD_LAST_ROW);
  const sender = player.getPacketSender();
  sender.sendInterfaceRemoval();
  sender.sendVarbit(HOUSE_BOARD_LOCATION_VARBIT, location);
  sender.sendInterface(HOUSE_BOARD_INTERFACE);
  houses.forEach((house, index) => sender.sendClientScript(HOUSE_BOARD_ROW_SCRIPT, index, location, advertisementRow(house)));
  // The cache preallocates rows 0..200; the final empty row completes loading and sorts the list.
  sender.sendClientScript(HOUSE_BOARD_ROW_SCRIPT, HOUSE_BOARD_LAST_ROW, location, "");
  sender.sendInterfaceFlags((HOUSE_BOARD_INTERFACE << 16) | 23, 1 << 1);
  sender.sendInterfaceFlags((HOUSE_BOARD_INTERFACE << 16) | 30, 1 << 1);
  // Native scripts 3111/3125 submit the chosen name through RESUME_NAMEDIALOG.
  player.setEnteredSyntaxAction({ execute: (name: string) => {
    if (player.getInterfaceId() !== HOUSE_BOARD_INTERFACE) return;
    const house = houses.find(candidate => candidate.owner?.getUsername().toLowerCase() === name.toLowerCase());
    sender.sendInterfaceRemoval();
    if (!house || !advertisedHouses.has(house) || !canVisitHouse(player, house)) {
      player.sendMessage("That house is no longer advertised or is not accepting guests.");
      return;
    }
    visitHouse(player, house.owner!.getUsername(), location);
  } });
}

function handleAdvertisementInterface(event: PluginInterfaceActionClickEvent): boolean {
  if (event.groupId !== HOUSE_BOARD_INTERFACE || event.player.getInterfaceId() !== HOUSE_BOARD_INTERFACE) return false;
  if (event.action !== 1) return false;
  if (event.childId === 23) {
    const house = activeHouses.get(event.player);
    if (house && advertisedHouses.has(house)) { removeAdvertisement({ player: event.player } as PluginObjectInteractionEvent); viewAdvertisements(event.player); }
    else { event.player.getPacketSender().sendInterfaceRemoval(); addAdvertisement({ player: event.player } as PluginObjectInteractionEvent); }
    return true;
  }
  if (event.childId === 30) { viewAdvertisements(event.player); return true; }
  return false;
}

function constructionLevel(player: ConstructionPlayer): number {
  return player.getSkillManager().getCurrentLevel(Skill.CONSTRUCTION);
}

function rebuildHouse(player: ConstructionPlayer, house: PlayerHouseInstance): void {
  player.setAttribute(HOUSE_ATTRIBUTE, house.save);
  const position = house.getRoomPositionAt(player.getLocation());
  if (!position || !house.getRoom(position)) player.moveTo(house.getEntryLocation());
  if (!house.rebuild(player as Player, true)) player.sendMessage("Unable to rebuild your house.");
  syncHouseOptions(player);
}

const ROOM_CREATION_INTERFACE = 212;
const pendingRoomMenus = new WeakMap<ConstructionPlayer, { house: PlayerHouseInstance; target: HouseRoomPosition; viewer: boolean }>();

function chooseRoom(player: Player, house: PlayerHouseInstance, target: HouseRoomPosition): void {
  if (houseFor(player) !== house || !isBuildingMode(player)) return;
  pendingRoomMenus.set(player, { house, target, viewer: player.getInterfaceId() === HOUSE_VIEWER_INTERFACE });
  player.getPacketSender().sendInterface(ROOM_CREATION_INTERFACE)
    .sendInterfaceFlagsRange((ROOM_CREATION_INTERFACE << 16) | 4, 1, 29, 1);
}

function selectRoomFromInterface(event: PluginInterfaceActionClickEvent): boolean {
  if (event.groupId !== ROOM_CREATION_INTERFACE || event.childId !== 4) return false;
  const pending = pendingRoomMenus.get(event.player);
  if (!pending || event.player.getInterfaceId() !== ROOM_CREATION_INTERFACE || houseFor(event.player) !== pending.house || !isBuildingMode(event.player)) return true;
  const id = pending.target.plane === 2 && (event.action === 7 || event.action === 9) ? event.action + 1 : event.action;
  const room = CONSTRUCTION_ROOMS.find(candidate => candidate.id === id);
  if (!room) { event.player.sendMessage("That room is not available yet."); return true; }
  pendingRoomMenus.delete(event.player);
  event.player.getPacketSender().sendInterfaceRemoval();
  buildRoom(event.player, pending.house, pending.target, room);
  if (pending.viewer) openHouseViewer(event.player);
  return true;
}

function buildRoom(player: ConstructionPlayer, house: PlayerHouseInstance, target: HouseRoomPosition, room: ConstructionRoom): void {
  if (houseFor(player) !== house || !isBuildingMode(player)) return;
  const problem = house.canPlaceRoom(room, target, constructionLevel(player));
  if (problem) return player.sendMessage(problem);
  if (player.getInventory().getAmount(COINS_ID) < room.cost) return player.sendMessage("You don't have enough coins to build that room.");
  player.getInventory().delete(COINS_ID, room.cost);
  house.placeRoom(target, room);
  rebuildHouse(player, house);
  player.sendMessage(`You build a ${room.name}.`);
}

function manageRoom(api: PluginApi, player: ConstructionPlayer, house: PlayerHouseInstance, target: HouseRoomPosition): void {
  const room = house.getRoom(target);
  if (!room) return;
  const name = room.roomKey.replace(/_/g, " ").toLowerCase();
  api.sendMultiChatboxPrompt(player, `Manage ${name}`, "Rotate clockwise", () => {
    if (houseFor(player) !== house || !isBuildingMode(player) || !house.rotateRoom(target)) return;
    rebuildHouse(player, house);
    player.sendMessage(`You rotate the ${name}.`);
  }, "Remove room", () => {
    const problem = house.canRemoveRoom(target);
    if (problem) return player.sendMessage(problem);
    api.sendMultiChatboxPrompt(player, `Remove the ${name}?`, "Yes, remove it", () => {
      if (houseFor(player) !== house || !isBuildingMode(player)) return;
      const currentProblem = house.canRemoveRoom(target);
      if (currentProblem) return player.sendMessage(currentProblem);
      house.removeRoom(target);
      rebuildHouse(player, house);
      player.sendMessage(`You remove the ${name}.`);
    }, "No", () => {});
  }, "Cancel", () => {});
}

function openRoomDoor(api: PluginApi, event: PluginObjectInteractionEvent): boolean {
  const player = event.player as ConstructionPlayer;
  const house = houseFor(player);
  if (!house || !isBuildingMode(player)) return false;
  const target = house.getDoorTarget(event.location);
  if (!target) return false;
  if (!house.getRoom(target)) {
    chooseRoom(player as Player, house, target);
    return true;
  }
  const doorRoom = house.getRoomPositionAt(event.location);
  if (doorRoom && house.getRoom(doorRoom)) {
    // A shared doorway belongs to two rooms. Do not silently select the
    // adjoining room when the player intends to remove the room they are in.
    const playerRoom = house.getRoomPositionAt(event.sourceLocation ?? event.location);
    const onTargetSide = playerRoom?.x === target.x && playerRoom.y === target.y && playerRoom.plane === target.plane;
    const current = onTargetSide ? target : doorRoom;
    const adjoining = onTargetSide ? doorRoom : target;
    api.sendMultiChatboxPrompt(player, "Which room do you want to manage?",
      "Room on this side", () => manageRoom(api, player, house, current),
      "Room on the other side", () => manageRoom(api, player, house, adjoining),
      "Cancel", () => {});
  } else manageRoom(api, player, house, target);
  return true;
}

function toggleHouseLock(event: PluginObjectInteractionEvent): boolean {
  const player = event.player as ConstructionPlayer;
  const house = houseFor(player);
  if (!house) return false;
  if (house.owner !== player) { player.sendMessage("Only the owner can lock this portal."); return true; }
  house.save.locked = !house.save.locked;
  if (house.save.locked) advertisedHouses.delete(house);
  for (const occupant of house.getPlayers()) occupant.getPacketSender().sendVarbit(HOUSE_LOCKED_VARBIT, house.save.locked ? 1 : 0);
  player.setAttribute(HOUSE_ATTRIBUTE, house.save);
  player.sendMessage(house.save.locked ? "You lock the house portal." : "You unlock the house portal.");
  return true;
}

function exitHouse(player: ConstructionPlayer): boolean {
  const house = houseFor(player);
  if (!house) return false;
  standFromChair(player);
  pendingFurnitureMenus.delete(player);
  houseViewers.delete(player);
  pendingRoomMenus.delete(player);
  if (house.owner === player) advertisedHouses.delete(house);
  player.getPacketSender().sendInterfaceRemoval();
  house.exitHouse(player as Player, houseExit(house.save));
  syncHouseOptions(player);
  syncKickOption(player);
  return true;
}

function syncKickOption(player: ConstructionPlayer): void {
  const house = houseFor(player);
  const visible = !!house && house.owner === player && !house.isDestroyed();
  if (visible === kickOptionVisible.has(player)) return;
  player.getPacketSender().sendPlayerOption(HOUSE_KICK_OPTION, visible ? "Kick" : "", false);
  if (visible) kickOptionVisible.add(player);
  else kickOptionVisible.delete(player);
}

function kickGuest(event: { player: Player; target: Player; option: number; handled: boolean }): void {
  if (event.option !== HOUSE_KICK_OPTION) return;
  event.handled = true;
  const house = houseFor(event.player);
  if (!house || house.isDestroyed() || house.owner !== event.player || event.target === event.player
    || houseFor(event.target) !== house || !house.getPlayers().includes(event.target)) return;
  exitHouse(event.target);
  event.target.sendMessage("The house owner has expelled you.");
}

export function syncHouseOptions(player: ConstructionPlayer): void {
  const saved = houseStateFor(player);
  const house = houseFor(player);
  const sender = player.getPacketSender();
  sender.sendVarbit(2187, saved.owned === false ? 0 : houseLocation(saved).id);
  sender.sendVarbit(2188, houseStyleIndex(saved));
  sender.sendVarbit(2176, house?.buildingMode ? 1 : 0);
  sender.sendVarbit(4744, saved.teleportOutside ? 1 : 0);
  sender.sendVarbit(14670, saved.defaultBuildingMode ? 1 : 0);
  sender.sendVarbit(6269, saved.doorMode ?? 0);
  if (houseOptionsOpen.has(player)) sender.sendString("Rooms: " + (house?.getRoomCount() ?? saved.rooms.flat(2).filter(Boolean).length),
    (HOUSE_OPTIONS_INTERFACE << 16) | 23);
}

function openHouseSettings(player: ConstructionPlayer): void {
  houseOptionsOpen.add(player);
  const sender = player.getPacketSender();
  sender.sendSubInterface(SETTINGS_TARGET_UID, HOUSE_OPTIONS_INTERFACE, 1);
  for (const child of [1, 5, 6, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22]) {
    sender.sendInterfaceFlags((HOUSE_OPTIONS_INTERFACE << 16) | child, 1 << 1);
  }
  syncHouseOptions(player);
}

function closeHouseSettings(event: { player: Player; handled: boolean }): void {
  if (!houseOptionsOpen.has(event.player) || event.player.getInterfaceId() >= 0
    || event.player.getPacketSender().hasInterruptibleInterface() === true) return;
  houseOptionsOpen.delete(event.player);
  event.player.getPacketSender().sendSubInterface(SETTINGS_TARGET_UID, 116, 1);
  event.handled = true;
}

function handleHouseOptions(event: PluginInterfaceActionClickEvent): boolean {
  const { player, groupId, childId, action } = event;
  if (action !== 1) return false;
  if (groupId === 116 && childId === 31) { openHouseSettings(player); return true; }
  if (groupId !== HOUSE_OPTIONS_INTERFACE || !houseOptionsOpen.has(player)) return false;
  if (childId === 24) {
    houseOptionsOpen.delete(player);
    player.getPacketSender().sendSubInterface(SETTINGS_TARGET_UID, 116, 1);
    return true;
  }
  const saved = houseStateFor(player);
  const house = houseFor(player);
  if (childId === 8 || childId === 9) saved.teleportOutside = childId === 9;
  else if (childId === 11 || childId === 12) saved.defaultBuildingMode = childId === 11;
  else if (childId >= 14 && childId <= 19) {
    saved.doorMode = childId <= 15 ? 0 : childId <= 17 ? 1 : 2;
    if (house?.owner === player && !house.buildingMode) house.refreshDoors();
  } else if (childId === 21) {
    if (!exitHouse(player)) player.sendMessage("You are not in a house.");
  } else if (childId === 22) callServant(player);
  else if (!house || house.owner !== player) player.sendMessage("You must be inside your own house to do that.");
  else if (childId === 5 || childId === 6) {
    if (house.buildingMode !== (childId === 5)) enterHouse(player, childId === 5);
  } else if (childId === 20) expelGuests(player);
  else if (childId === 1) openHouseViewer(player);
  player.setAttribute(HOUSE_ATTRIBUTE, saved);
  // Also restores the teleport preference after this cache's Default Off listener changes it locally.
  syncHouseOptions(player);
  return true;
}

function houseTeleportArrival({ player, name }: { player: Player; name: string }): void {
  if (name !== "teleport to house") return;
  const saved = houseStateFor(player);
  if (saved.teleportOutside) player.moveTo(houseExit(saved));
  else enterHouse(player, saved.defaultBuildingMode);
}

/**
 * "construction:house-tablet": where a Teleport to house tablet goes. Break follows the
 * house's teleport setting, Inside/Outside override it; without a house it's refused
 * (no destination) so the tablet is kept.
 */
function houseTablet(request: { player: Player; option: string; destination: Location | null; onArrival: (() => void) | null }): void {
  const { player } = request;
  const saved = houseStateFor(player);
  if (saved.owned === false) {
    player.sendMessage("You do not own a house. Speak to an Estate agent to buy one.");
    return;
  }
  const outside = request.option === "outside" || (request.option === "break" && !!saved.teleportOutside);
  request.destination = houseExit(saved);
  request.onArrival = outside ? null : () => { enterHouse(player, saved.defaultBuildingMode); };
}

const HOUSE_VIEWER_INTERFACE = 422;
type HouseViewer = {
  house: PlayerHouseInstance;
  rooms: HouseRoomPosition[];
  selected?: HouseRoomPosition;
  destination?: HouseRoomPosition;
  rotation: number;
  mode?: "move" | "rotate";
};
const houseViewers = new WeakMap<ConstructionPlayer, HouseViewer>();

function openHouseViewer(player: Player): void {
  const house = houseFor(player);
  if (!house || house.owner !== player || !house.buildingMode) {
    player.sendMessage("The house viewer is only available in building mode.");
    return;
  }
  player.getPacketSender().sendInterface(HOUSE_VIEWER_INTERFACE);
  const viewer: HouseViewer = { house, rooms: [], rotation: 0 };
  houseViewers.set(player, viewer);
  refreshHouseViewer(player, viewer);
}

function refreshHouseViewer(player: Player, viewer: HouseViewer): void {
  const sender = player.getPacketSender();
  viewer.rooms = [];
  for (let plane = 0; plane < 3; plane++) for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
    const position = { x, y, plane }, room = viewer.house.getRoom(position);
    if (!room) continue;
    viewer.rooms.push(position);
    const index = viewer.rooms.length;
    const roomId = ROOM_BY_KEY.get(room.roomKey)!.id;
    let packed = BigInt(x | (y << 3) | (plane << 6) | (room.rotation << 8) | (roomId << 10));
    const placed = Object.values(room.furnitureByLocation ?? {});
    const keys = [...placed.map(f => f.buildableKey), ...Object.entries(room.furniture)
      .filter(([hotspot]) => !placed.some(f => f.hotspotKey === hotspot)).map(([, key]) => key)];
    const rows = keys.map(key => BUILDABLE_BY_KEY.get(key)?.menuRowId);
    (CONSTRUCTION_VIEWER_FURNITURE[roomId] ?? []).forEach((choices, slot) => {
      const index = rows.findIndex(row => row != null && choices.includes(row));
      if (index < 0) return;
      const value = choices.indexOf(rows[index]!) + 1;
      rows.splice(index, 1);
      packed |= BigInt(value) << BigInt(15 + slot * 5);
    });
    // Script 1376 carries bit 31 of the first word in bit 30 of the second word.
    sender.sendClientScript(1376, index, 4165 + roomId, 0, Number(packed & 0x7fffffffn),
      Number((packed >> 32n) | (((packed >> 31n) & 1n) << 30n)), 0);
    sender.sendInterfaceFlags((HOUSE_VIEWER_INTERFACE << 16) | (index + 5), 1 << 1);
  }
  // The cache uses a 9x9 click grid on each of three floors and hides unused room slots itself.
  sender.sendClientScript(1382, viewer.rooms.length, 0, (2 << 28) | (7 << 14) | 7, player.getLocation().getZ());
  sender.sendInterfaceFlagsRange((HOUSE_VIEWER_INTERFACE << 16) | 5, 0, 242, (1 << 1) | (1 << 6));
  for (const child of [63, 64, 65, 66, 67, 68, 69]) sender.sendInterfaceFlags((HOUSE_VIEWER_INTERFACE << 16) | child, 1 << 1);
  sender.sendInterfaceFlags((HOUSE_VIEWER_INTERFACE << 16) | 46, 1 << 2);
  syncViewerSelection(player, viewer);
}

function syncViewerSelection(player: Player, viewer: HouseViewer): void {
  const room = viewer.selected && viewer.house.getRoom(viewer.selected);
  const sender = player.getPacketSender();
  sender.sendVarbit(5329, viewer.selected ? viewer.rooms.findIndex(p => p.x === viewer.selected!.x && p.y === viewer.selected!.y && p.plane === viewer.selected!.plane) + 1 : 0);
  sender.sendVarbit(5333, room ? ROOM_BY_KEY.get(room.roomKey)!.id : 0);
  sender.sendVarbit(5331, viewer.rotation);
  sender.sendVarbit(5332, viewer.mode === "rotate" ? 1 : 0);
  const destination = viewer.destination;
  sender.sendVarbit(5330, destination ? destination.plane * 81 + destination.y * 9 + destination.x + 1 : viewer.mode === "move" ? 244 : 0);
  sender.sendVarbit(5334, room ? viewer.house.getRoomDoorMask(viewer.selected!) : 0);
  sender.sendVarbit(5335, destination ? viewer.house.getAdjacentDoorMask(destination) : viewer.selected ? viewer.house.getAdjacentDoorMask(viewer.selected) : 0);
  if (destination && room) {
    sender.sendClientScript(1376, -1, 0, 0, destination.x | (destination.y << 3) | (destination.plane << 6)
      | (viewer.rotation << 8) | (ROOM_BY_KEY.get(room.roomKey)!.id << 10), 0, 0);
  }
}

function handleHouseViewer(api: PluginApi, event: PluginInterfaceActionClickEvent): boolean {
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
  if (childId === 5 && Number.isInteger(event.slot) && event.slot! >= 0 && event.slot! < 243) {
    const slot = event.slot!;
    const target = { x: slot % 9, y: Math.floor(slot / 9) % 9, plane: Math.floor(slot / 81) };
    if (target.x >= 8 || target.y >= 8) return true;
    if (action === 6 && !viewer.mode) {
      chooseRoom(player, viewer.house, target);
    } else if (action === 1 && viewer.mode === "move" && viewer.selected) {
      const problem = viewer.house.canMoveRoom(viewer.selected, target);
      if (problem) player.sendMessage(problem);
      else { viewer.destination = target; viewer.mode = "rotate"; syncViewerSelection(player, viewer); }
    }
    return true;
  }
  if (action !== 1 || childId == null) return true;
  if (childId >= 6 && childId <= 43 && !viewer.mode) {
    const selected = viewer.rooms[childId - 6];
    if (selected) { viewer.selected = selected; viewer.rotation = viewer.house.getRoom(selected)!.rotation; }
  } else if (viewer.selected && viewer.house.getRoom(viewer.selected)) {
    if (childId === 63 && !viewer.mode) viewer.mode = "move";
    else if (childId === 64 && !viewer.mode) viewer.mode = "rotate";
    else if (childId === 65 && viewer.mode === "rotate") viewer.rotation = (viewer.rotation + 1) & 3;
    else if (childId === 66 && viewer.mode === "rotate") viewer.rotation = (viewer.rotation + 3) & 3;
    else if (childId === 68) { viewer.mode = undefined; viewer.destination = undefined; viewer.rotation = viewer.house.getRoom(viewer.selected)!.rotation; }
    else if (childId === 69 && viewer.mode === "rotate") {
      if (viewer.destination) {
        const problem = viewer.house.canMoveRoom(viewer.selected, viewer.destination);
        if (problem) { player.sendMessage(problem); syncViewerSelection(player, viewer); return true; }
        viewer.house.moveRoom(viewer.selected, viewer.destination, viewer.rotation);
      } else viewer.house.rotateRoom(viewer.selected, viewer.rotation);
      rebuildHouse(player, viewer.house);
      openHouseViewer(player);
      return true;
    } else if (childId === 67 && !viewer.mode) {
      const selected = viewer.selected, room = viewer.house.getRoom(selected);
      const problem = viewer.house.canRemoveRoom(selected);
      if (problem) player.sendMessage(problem);
      else api.sendMultiChatboxPrompt(player, "Delete this room and its furniture?", "Yes, delete it", () => {
        if (houseFor(player) !== viewer.house || !isBuildingMode(player) || viewer.house.getRoom(selected) !== room) return;
        const currentProblem = viewer.house.canRemoveRoom(selected);
        if (currentProblem) { player.sendMessage(currentProblem); return; }
        viewer.house.removeRoom(selected);
        rebuildHouse(player, viewer.house);
        openHouseViewer(player);
      }, "No", () => openHouseViewer(player));
    }
  }
  syncViewerSelection(player, viewer);
  return true;
}

function formatBuildable(buildable: { key: string }): string {
  return buildable.key.replace(/_/g, " ").toLowerCase();
}

function getBuildMaterials(player: ConstructionPlayer, house: PlayerHouseInstance, target: HouseFurnitureTarget, buildable: ConstructionBuildable): Map<number, number> | string {
  if (constructionLevel(player) < buildable.level) return `You need Construction level ${buildable.level} to build that.`;
  if (!player.getInventory().contains(HAMMER_ID) || !player.getInventory().contains(SAW_ID)) return "You need a hammer and a saw to build that.";
  const existing = house.getFurnitureAtTarget(target);
  if (existing && !buildable.materials.some(material => material.source === existing.buildableKey)) return "Remove the existing furniture first, or select its next upgrade.";
  const requiredItems = new Map<number, number>();
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
      if (remaining > 0) return "You do not have enough nails.";
    } else if (material.itemId != null) requiredItems.set(material.itemId, (requiredItems.get(material.itemId) ?? 0) + material.amount);
    else if (material.source === "Tool.TINDER_BOX") {
      if (!player.getInventory().contains(TINDERBOX_ID)) return "You need a tinderbox to build that.";
    } else if (material.source && BUILDABLE_BY_KEY.has(material.source)) {
      if (house.getFurnitureAtTarget(target)?.buildableKey !== material.source) return `You need the ${material.source.replace(/_/g, " ").toLowerCase()} already built there.`;
    } else return "This build has an unsupported material requirement.";
  }
  for (const [itemId, amount] of requiredItems) if (player.getInventory().getAmount(itemId) < amount) return "You do not have the required materials.";
  return requiredItems;
}

function buildFurniture(player: ConstructionPlayer, house: PlayerHouseInstance, target: HouseFurnitureTarget, buildable: ConstructionBuildable): void {
  if (houseFor(player) !== house || !isBuildingMode(player)) return;
  const materials = getBuildMaterials(player, house, target, buildable);
  if (typeof materials === "string") return player.sendMessage(materials);
  for (const [itemId, amount] of materials) player.getInventory().delete(itemId, amount);
  if (buildable.buildAnimationId >= 0) player.performAnimation(new Animation(buildable.buildAnimationId));
  house.setFurniture(target, buildable);
  player.getSkillManager().addExperiences(Skill.CONSTRUCTION, buildable.experience);
  rebuildHouse(player, house);
  player.sendMessage(`You build a ${formatBuildable(buildable)}.`);
}

function materialName(material: ConstructionBuildable["materials"][number]): string {
  if (material.itemId != null) return material.source?.replace(/_/g, " ").toLowerCase() || `Item ${material.itemId}`;
  if (material.source && BUILDABLE_BY_KEY.has(material.source)) return formatBuildable({ key: material.source });
  return material.source?.replace(/^Tool\./, "").replace(/\.toItem\(.*\)$/, "").replace(/_/g, " ").toLowerCase() || "Unknown material";
}

function furnitureCreationText(buildable: ConstructionBuildable): string {
  const name = formatBuildable(buildable);
  const materials = buildable.materials.slice(0, 4).map((material) => `${materialName(material)}: ${material.amount.toLocaleString()}`);
  return `${name}|${[...materials, "", "", "", ""].slice(0, 4).join("<br>")}<br>`;
}

function chooseFurniture(player: ConstructionPlayer, house: PlayerHouseInstance, target: HouseFurnitureTarget): void {
  const hotspot = HOTSPOT_BY_OBJECT_ID.get(target.sourceObjectId);
  if (!hotspot) return;
  const choices = hotspot.buildables
    .flatMap((key) => FURNITURE_GROUPS[key] ?? [key])
    .map((key) => BUILDABLE_BY_KEY.get(key))
    .filter((buildable): buildable is ConstructionBuildable => buildable?.menuRowId != null);
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
      1404,
      index + 1,
      buildable.menuRowId!,
      buildable.level,
      furnitureCreationText(buildable),
      typeof getBuildMaterials(player, house, target, buildable) === "string" ? 0 : 1,
    );
  });
  sender
    .sendClientScript(1406, choices.length, 0)
    .sendInterfaceFlagsRange(FURNITURE_BUILD_LIST_UID, 1, choices.length, 1);
  pendingFurnitureMenus.set(player, { house, target, choices });
}

function selectFurnitureFromInterface(event: PluginInterfaceActionClickEvent): boolean {
  if (event.groupId !== FURNITURE_BUILD_INTERFACE || event.childId !== 2) return false;
  const pending = pendingFurnitureMenus.get(event.player);
  if (!pending) return false;
  // Script 1405 sends RESUME_PAUSEBUTTON with a one-based child index.
  const choice = Number.isInteger(event.action) && event.action > 0 ? pending.choices[event.action - 1] : undefined;
  if (!choice || houseFor(event.player) !== pending.house || !isBuildingMode(event.player)) return false;
  pendingFurnitureMenus.delete(event.player);
  event.player.getPacketSender().sendInterfaceRemoval();
  buildFurniture(event.player, pending.house, pending.target, choice);
  return true;
}

function openBuildMenu(event: PluginObjectInteractionEvent): boolean {
  const player = event.player as ConstructionPlayer;
  const house = houseFor(player);
  if (!house || !isBuildingMode(player)) return false;
  const target = house.getFurnitureTarget(event.location, event.objectId);
  if (!target) return false;
  chooseFurniture(player, house, target);
  return true;
}

function tryRemoveFurniture(api: PluginApi, event: PluginObjectInteractionEvent): boolean {
  if (event.definition?.getInteractions()?.[event.clickType - 1]?.toLowerCase() !== "remove") return false;
  const player = event.player as ConstructionPlayer;
  const house = houseFor(player);
  const type = event.object?.getType?.() ?? 10;
  if (!house || !isBuildingMode(player) || !house.getFurnitureAt(event.location, event.objectId, type)) return false;
  const problem = house.canRemoveFurniture(event.location, event.objectId, type);
  if (problem) {
    player.sendMessage(problem);
    return true;
  }
  api.sendMultiChatboxPrompt(player, "Remove this furniture?", "Yes, remove it", () => {
    if (houseFor(player) !== house || !isBuildingMode(player)) return;
    const currentProblem = house.canRemoveFurniture(event.location, event.objectId, type);
    if (currentProblem) return player.sendMessage(currentProblem);
    const removed = house.removeFurniture(event.location, event.objectId, type);
    if (!removed) return;
    player.performAnimation(new Animation(3685));
    rebuildHouse(player, house);
    player.sendMessage(`You remove the ${formatBuildable({ key: removed.buildableKey })}.`);
  }, "No", () => {});
  return true;
}

function onObject(event: PluginObjectInteractionEvent): boolean {
  const player = event.player as ConstructionPlayer;
  if (event.objectId === GARDEN_CENTERPIECE_HOTSPOT_ID && !isBuildingMode(player)) return exitHouse(player);
  return openBuildMenu(event);
}

function onItemOnObject(event: PluginItemOnObjectEvent): boolean {
  if (offerHouseBones(event) || storeItemOnFurniture(event)) return true;
  if ((event.itemId === TINDERBOX_ID || event.itemId === ItemIdentifiers.MARRENTILL) && lightHouseBurner(event)) return true;
  if (event.itemId !== HAMMER_ID && event.itemId !== SAW_ID) return false;
  return openBuildMenu(event as unknown as PluginObjectInteractionEvent);
}

function handleFurnitureAction(api: PluginApi, event: PluginObjectInteractionEvent): void {
  const house = houseFor(event.player);
  if (!house) return;
  const action = event.definition?.getInteractions()?.[event.clickType - 1]?.toLowerCase();
  if (action === "sit-on" && sitOnChair(event)) { event.handled = true; return; }
  if (action === "remove") { if (tryRemoveFurniture(api, event)) event.handled = true; return; }
  if (action === "upgrade") {
    if (!isBuildingMode(event.player)) { event.player.sendMessage("Only the owner can upgrade furniture in building mode."); event.handled = true; return; }
    const saved = house.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
    const position = house.getRoomPositionAt(event.location);
    if (saved && position) { chooseFurniture(event.player, house, { ...saved, position }); event.handled = true; }
    return;
  }
  if (useServantFurniture(api, event) || useHousePortal(api, event)
    || (["light", "re-light"].includes(action ?? "") && lightHouseBurner(event))
    || (["open", "search", "view"].includes(action ?? "") && openHouseStorage(api, event))) event.handled = true;
}

// Cache-native ready poses for the seven parlour chairs, in furniture-menu order.
const CHAIR_READY_ANIMATIONS = [4073, 4075, 4077, 4081, 4083, 4085, 4087];
const DINING_BENCHES = ["WOODEN_BENCH", "OAK_BENCH", "CARVED_OAK_BENCH", "TEAK_BENCH", "CARVED_TEAK_BENCH", "MAHOGANY_BENCH", "GILDED_BENCH"];
const CHAIR_SIT_ANIMATION = 4103;
// A half-turn takes 32 client cycles; allow two server ticks before sitting.
const CHAIR_TURN_TICKS = 2;
const seatedPlayers = new WeakMap<ConstructionPlayer, {
  house: PlayerHouseInstance; location: Location; objectId: number; type: number;
  furniture: NonNullable<ReturnType<PlayerHouseInstance["getFurnitureAt"]>>;
  ready: number; previousAnimation: number; sitCycle: number; front: Location; sitting: boolean;
}>();

export function isSeatedForDinner(player: Player): boolean {
  const seat = seatedPlayers.get(player);
  return !!seat?.sitting && DINING_BENCHES.includes(seat.furniture.buildableKey)
    && player.getPrivateArea() === seat.house && player.getLocation().equals(seat.location);
}

function chairFront(object: GameObject): Location {
  const [dx, dy] = (object.getType() === 11
    ? [[-1, -1], [-1, 1], [1, 1], [1, -1]]
    : [[0, -1], [-1, 0], [0, 1], [1, 0]])[object.getFace() & 3];
  return object.getLocation().transform(dx, dy);
}

function routeHouseChair(event: PluginObjectRouteEvent): void {
  standFromChair(event.player);
  if (event.definition?.getInteractions()?.[event.clickType - 1]?.toLowerCase() !== "sit-on") return;
  const furniture = houseFor(event.player)?.getFurnitureAt(event.object.getLocation(), event.objectId, event.object.getType());
  if (furniture && (FURNITURE_GROUPS.PARLOUR_CHAIRS.includes(furniture.buildableKey) || DINING_BENCHES.includes(furniture.buildableKey))) event.destination = chairFront(event.object);
}

function standFromChair(player: ConstructionPlayer): void {
  const seat = seatedPlayers.get(player);
  if (!seat) return;
  seatedPlayers.delete(player);
  const character = player as Player;
  if (character.getSkillAnimation() === seat.ready) {
    character.setSkillAnimation(seat.previousAnimation);
    character.getUpdateFlag().flag(Flag.APPEARANCE);
  }
  const animation = character.getAnimation()?.getId();
  if (animation === CHAIR_SIT_ANIMATION || animation === seat.ready) character.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
}

function sitOnChair({ player, object, objectId, location }: PluginObjectInteractionEvent): boolean {
  const house = houseFor(player);
  const type = object.getType();
  const furniture = house?.getFurnitureAt(location, objectId, type);
  const index = furniture ? FURNITURE_GROUPS.PARLOUR_CHAIRS.indexOf(furniture.buildableKey) : -1;
  const bench = furniture ? DINING_BENCHES.indexOf(furniture.buildableKey) : -1;
  if (!house || !furniture || (index < 0 && bench < 0)) return false;
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
  const ready = bench >= 0 ? 4089 + bench * 2 : CHAIR_READY_ANIMATIONS[index];
  seatedPlayers.set(player, { house, location: seatLocation, objectId, type, furniture, ready, front,
    sitCycle: World.getProcessCycle() + CHAIR_TURN_TICKS, sitting: false,
    previousAnimation: player.getSkillAnimation() ?? 0 });
  player.setPositionToFace(front.transform(front.x - seatLocation.x, front.y - seatLocation.y));
  player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  return true;
}

function processChair(player: Player): void {
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

function openHouseDoor(event: PluginObjectInteractionEvent): void {
  const { player, objectId, location } = event;
  if (houseFor(player)?.toggleDoor(objectId, new Location(location.x, location.y, location.z))) event.handled = true;
}

function nearbyHouseLocation(player: ConstructionPlayer, objectId?: number): number {
  const direct = HOUSE_LOCATIONS.find(location => location.portal === objectId || location.board === objectId);
  if (direct) return direct.id;
  if (objectId === 30172) return 6; // Yanille's diary-transformed portal.
  const house = houseFor(player);
  if (house) return houseLocation(house.save).id;
  const position = player.getLocation();
  return HOUSE_LOCATIONS.reduce((nearest, location) =>
    Math.hypot(location.x - position.getX(), location.y - position.getY())
      < Math.hypot(nearest.x - position.getX(), nearest.y - position.getY()) ? location : nearest).id;
}

function enterAtPortal(player: ConstructionPlayer, buildingMode: boolean, location: number): boolean {
  if (houseLocation(houseStateFor(player)).id !== location) {
    player.sendMessage("Your house is not located here.");
    return true;
  }
  enterHouse(player, buildingMode);
  return true;
}

function enterDefaultHouse({ player, objectId }: PluginObjectInteractionEvent): boolean {
  return enterAtPortal(player, houseStateFor(player).defaultBuildingMode, nearbyHouseLocation(player, objectId));
}
function enterNormalHouse({ player, objectId }: PluginObjectInteractionEvent): boolean {
  return enterAtPortal(player, false, nearbyHouseLocation(player, objectId));
}
function enterBuildingHouse({ player, objectId }: PluginObjectInteractionEvent): boolean {
  return enterAtPortal(player, true, nearbyHouseLocation(player, objectId));
}
function leaveHouse({ player }: PluginObjectInteractionEvent): boolean { return exitHouse(player); }
function showAdvertisements({ player, objectId }: PluginObjectInteractionEvent): boolean { viewAdvertisements(player, nearbyHouseLocation(player, objectId)); return true; }
function visitLastHouse({ player }: PluginObjectInteractionEvent): boolean {
  const name = lastVisited.get(player);
  if (name) visitHouse(player, name);
  else player.sendMessage("You have not visited a house yet.");
  return true;
}
function houseCommand({ player }: { player: ConstructionPlayer }): void { openHouseSettings(player); }
function handleHouseItem(event: PluginItemOnObjectEvent): void { if (onItemOnObject(event)) event.handled = true; }
function handleHouseInterface(api: PluginApi, event: PluginInterfaceActionClickEvent): void { if (selectFurnitureFromInterface(event) || selectRoomFromInterface(event) || handleAdvertisementInterface(event) || handleHouseOptions(event) || handleHouseViewer(api, event)) event.handled = true; }
function loginHouse({ player }: { player: Player }): void {
  houseOptionsOpen.delete(player);
  kickOptionVisible.delete(player);
  player.getPacketSender().sendPlayerOption(HOUSE_KICK_OPTION, "", false);
  syncHouseOptions(player);
  if (PlayerHouseInstance.isAllocationLocation(player.getLocation())) {
    player.moveTo(houseExit(houseStateFor(player)));
    player.sendMessage("Returned from your house after the instance closed.");
  }
}
function logoutHouse({ player }: { player: Player }): void { standFromChair(player); releaseHouse(player, true); }
function processHouse({ player }: { player: Player }): void {
  processChair(player);
  processServant(player);
  const position = player.getLocation();
  if (!player.getPrivateArea() && position.getX() >= 1024 && position.getX() < 2048) {
    const saved = houseStateFor(player);
    if (position.getY() >= 3200 && position.getY() < 4096 && !saved.visitedKourend) {
      saved.visitedKourend = true;
      player.setAttribute(HOUSE_ATTRIBUTE, saved);
    } else if (position.getY() >= 2816 && position.getY() < 3200 && !saved.visitedVarlamore) {
      saved.visitedVarlamore = true;
      player.setAttribute(HOUSE_ATTRIBUTE, saved);
    }
  }
  const house = houseFor(player);
  syncKickOption(player);
  if (house) expireHouseBurners(house);
  const owned = activeHouses.get(player);
  if (owned && (owned.isDestroyed() || house !== owned)) advertisedHouses.delete(owned);
}

const hotspotIds = [...HOTSPOT_BY_OBJECT_ID.keys()].filter(id => id >= 0);
const furnitureObjectIds = [...new Set(CONSTRUCTION_BUILDABLES.flatMap(buildable => buildable.objectIds.filter(id => id >= 0)))];

export const ConstructionPlugin = {
  name: "Construction",
  members: true,
  register(api: PluginApi): void {
    EstateAgentPlugin.register(api);
    ConstructionServants.register(api);
    api.persistAttribute(HOUSE_ATTRIBUTE);
    api.onObjectFirstClick(HOUSE_PORTAL_IDS, enterDefaultHouse);
    api.onObjectSecondClick(HOUSE_PORTAL_IDS, enterNormalHouse);
    api.onObjectThirdClick(HOUSE_PORTAL_IDS, enterBuildingHouse);
    api.onObjectFourthClick(HOUSE_PORTAL_IDS, promptVisit);
    api.onObjectInteraction("House Advertisement", { View: showAdvertisements, "Add-House": addAdvertisement, "Visit-Last": visitLastHouse });
    api.onObjectFirstClick(EXIT_PORTAL_ID, leaveHouse);
    api.onObjectSecondClick(EXIT_PORTAL_ID, toggleHouseLock);
    api.onObjectThirdClick(EXIT_PORTAL_ID, removeAdvertisement);
    api.registerCommand("house", houseCommand);
    api.onObjectFirstClick(ROOM_DOOR_HOTSPOT_IDS, openRoomDoor.bind(null, api));
    api.onObjectFifthClick(ROOM_DOOR_HOTSPOT_IDS, openRoomDoor.bind(null, api));
    api.onObjectFirstClick(furnitureObjectIds, tryRemoveFurniture.bind(null, api));
    api.onObjectSecondClick(furnitureObjectIds, tryRemoveFurniture.bind(null, api));
    api.onObjectFifthClick(furnitureObjectIds, tryRemoveFurniture.bind(null, api));
    api.onObjectFirstClick(hotspotIds, onObject);
    api.onObjectSecondClick(hotspotIds, onObject);
    api.onObjectFifthClick(hotspotIds, onObject);
    api.onObjectInteraction(handleFurnitureAction.bind(null, api));
    api.onObjectRoute(routeHouseChair);
    api.onItemOnObject(handleHouseItem, { noted: false });
    api.onInterfaceActionClick(handleHouseInterface.bind(null, api));
    api.onCustomEvent("player:option-route", kickGuest);
    api.onCustomEvent("door:toggle", openHouseDoor);
    api.onCustomEvent("interface:close", closeHouseSettings);
    api.onCustomEvent("spell:teleport-arrival", houseTeleportArrival);
    api.onCustomEvent("construction:house-tablet", houseTablet);
    api.onCustomEvent("construction:owns-house", ownsHouse);
    api.onPlayerLogin(loginHouse);
    api.onPlayerProcess(processHouse);
    api.onPlayerDisconnect(logoutHouse);
    api.onPlayerLogout(logoutHouse);
  },
};

export default ConstructionPlugin;
