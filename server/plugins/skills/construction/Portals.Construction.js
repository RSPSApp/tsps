"use strict";

const { api, Skill, TeleportHandler, TeleportType, Wilderness, SpellTeleports, LunarSpells, ArceuusSpells, ObjectIdentifiers } = require("./Core.Construction");
const Data = require("./Data.Construction");
const Instance = require("./Instance.Construction");
const aliases = { moonclan: "LUNAR_ISLE", "ape atoll": "MARIM", "kourend castle": "KOUREND", "fenkenstrain's castle": "FENKENSTRAINS_CASTLE", waterbirth: "WATERBIRTH_ISLAND", watchtower: "YANILLE_WATCHTOWER", barbarian: "BARBARIAN_OUTPOST", khazard: "PORT_KHAZARD" };
function houseDestinations() {
  // Reuse the spell system's costs and destinations; home/house spells cannot be directed.
  return [...SpellTeleports.getTeleportDestinations(), ...LunarSpells.getTeleportDestinations(), ...ArceuusSpells.getTeleportDestinations().map(data => ({ ...data, name: data.name === "ape atoll teleport" ? "ape atoll dungeon teleport" : data.name }))]
    .filter(data => data.runes.length && data.name !== "teleport to house")
    .map(data => {
      const name = data.name.replace(/ teleport$/, "");
      const key = aliases[name] ?? name.replace(/ /g, "_").toUpperCase();
      const ids = ObjectIdentifiers;
      // Revision 237 names the mahogany Watchtower model "Yanille Portal".
      const portalIds = name === "watchtower"
        ? [ObjectIdentifiers.YANILLE_WATCHTOWER_PORTAL, ObjectIdentifiers.YANILLE_PORTAL_2, ObjectIdentifiers.YANILLE_WATCHTOWER_PORTAL_2]
        : [ids[`${key}_PORTAL`], ids[`${key}_PORTAL_2`], ids[`${key}_PORTAL_3`]];
      return { ...data, portalIds };
    });
}

function current(player, house, furniture) {
  return player.getPrivateArea() === house && house.save.rooms.flat(2).some(room => Object.values(room?.furnitureByLocation ?? {}).includes(furniture));
}

function configureHouseDestination(player, house, furniture, name) {
  if (house.owner !== player || !current(player, house, furniture)) return false;
  const nexus = furniture.hotspotKey === "PORTAL_NEXUS";
  if (!nexus && !furniture.buildableKey.endsWith("_PORTAL_FRAME")) return false;
  if (!nexus) {
    const room = house.save.rooms.flat(2).find(room => Object.values(room?.furnitureByLocation ?? {}).includes(furniture));
    if (!Object.values(room?.furnitureByLocation ?? {}).some(value => value.hotspotKey === "TELEPORT_FOCUS")) {
      player.sendMessage("Build a teleportation focus in this room first.");
      return false;
    }
  }
  const destination = houseDestinations().find(data => data.name === name);
  if (!destination || (!nexus && !destination.portalIds.every(Number.isInteger))) return false;
  const level = nexus ? player.getSkillManager().getMaxLevel(Skill.MAGIC) : player.getSkillManager().getCurrentLevel(Skill.MAGIC);
  if (level < destination.level) { player.sendMessage(`You need Magic level ${destination.level} to direct this teleport.`); return false; }
  const known = furniture.destinations ?? [];
  if (known.includes(name)) { player.sendMessage("That destination is already configured."); return false; }
  const limit = furniture.buildableKey === "MARBLE_PORTAL_NEXUS" ? 4 : furniture.buildableKey === "GILDED_PORTAL_NEXUS" ? 8 : Infinity;
  if (nexus && known.length >= limit) { player.sendMessage("Upgrade your nexus or remove a destination first."); return false; }
  const multiplier = nexus ? 1000 : 100;
  const inventory = player.getInventory();
  if (destination.runes.some(rune => inventory.getAmount(rune.getId()) < rune.getAmount() * multiplier)) { player.sendMessage("You do not have all the required runes in your inventory."); return false; }
  for (const rune of destination.runes) inventory.delete(rune.getId(), rune.getAmount() * multiplier);
  furniture.destinations = nexus ? [...known, name] : [name];
  if (!nexus) {
    const tier = furniture.buildableKey.startsWith("TEAK") ? 0 : furniture.buildableKey.startsWith("MAHOGANY") ? 1 : 2;
    furniture.displayObjectId = destination.portalIds[tier];
    player.getSkillManager().addExperiences(Skill.MAGIC, destination.experience * 5);
  }
  house.owner.setAttribute(Data.HOUSE_ATTRIBUTE, house.save);
  for (const occupant of house.getPlayers()) house.rebuild(occupant, house.buildingMode);
  player.sendMessage(`Added ${name}.`);
  return true;
}

function chooseDestination(player, house, furniture, mode, page = 0) {
  if (!current(player, house, furniture)) return;
  const nexus = furniture.hotspotKey === "PORTAL_NEXUS";
  const destinations = houseDestinations().filter(data => mode === "add" ? !(furniture.destinations ?? []).includes(data.name) && (nexus || data.portalIds.every(Number.isInteger)) : furniture.destinations?.includes(data.name));
  if (!destinations.length) { player.sendMessage("There are no destinations to select."); return; }
  const options = [];
  for (const destination of destinations.slice(page * 4, page * 4 + 4)) options.push(destination.name, () => {
    if (!current(player, house, furniture)) return;
    if (mode === "teleport") {
      const travel = () => {
        if (current(player, house, furniture) && furniture.destinations?.includes(destination.name) && TeleportHandler.checkReqs(player, destination.destination)) {
          TeleportHandler.teleport(player, destination.destination.clone(), TeleportType.NORMAL, false);
          api.emitCustomEvent("construction:portal", { player, destination: destination.name });
        }
      };
      if (Wilderness.isInLocation(destination.destination)) api.sendMultiChatboxPrompt(player, "This destination is in the Wilderness. Continue?", "Yes", travel, "No", () => {});
      else travel();
    } else if (house.owner === player) {
      if (mode === "add") {
        for (const rune of destination.runes) player.sendMessage(`${rune.getAmount() * (nexus ? 1000 : 100)} x ${rune.getDefinition().getName()}`);
        api.sendMultiChatboxPrompt(player, "Consume these runes to direct the teleport?", "Yes", () => { configureHouseDestination(player, house, furniture, destination.name); }, "No", () => {});
      } else api.sendMultiChatboxPrompt(player, "Remove this teleport without refunding runes?", "Yes", () => {
        if (house.owner !== player || !current(player, house, furniture)) return;
        furniture.destinations = furniture.destinations?.filter(name => name !== destination.name);
        player.setAttribute(Data.HOUSE_ATTRIBUTE, house.save);
      }, "No", () => {});
    }
  });
  if ((page + 1) * 4 < destinations.length) options.push("More destinations", () => chooseDestination(player, house, furniture, mode, page + 1));
  api.sendMultiChatboxPrompt(player, mode === "teleport" ? "Choose a destination" : "Configure destinations", ...options);
}

function useHousePortal(event) {
  const house = event.player.getPrivateArea();
  if (!(house instanceof Instance.PlayerHouseInstance)) return false;
  const furniture = house.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  if (!furniture) return false;
  const action = event.definition?.getInteractions()?.[event.clickType - 1]?.toLowerCase();
  // The nexus has its own interfaces (Nexus).
  if (furniture.hotspotKey === "PORTAL_NEXUS" && ["teleport", "teleport menu", "configuration"].includes(action ?? "")) {
    return require("./Nexus.Construction").nexusOption(event, action);
  }
  if (furniture.buildableKey.endsWith("_PORTAL_FRAME") && action === "enter") {
    chooseDestination(event.player, house, furniture, "teleport");
    return true;
  }
  if (action !== "direct-portal") return false;
  if (house.owner !== event.player) { event.player.sendMessage("Only the owner can direct portals."); return true; }
  const position = house.getRoomPositionAt(event.location);
  const portals = Object.values(house.getRoom(position).furnitureByLocation ?? {}).filter(value => value.buildableKey.endsWith("_PORTAL_FRAME"));
  if (!portals.length) { event.player.sendMessage("Build a portal frame in this room first."); return true; }
  const options = [];
  portals.forEach((portal, i) => options.push(`Portal ${i + 1}: ${portal.destinations?.[0] ?? "empty"}`, () => chooseDestination(event.player, house, portal, "add")));
  api.sendMultiChatboxPrompt(event.player, "Which portal?", ...options);
  return true;
}

Object.assign(module.exports, { houseDestinations, configureHouseDestination, useHousePortal });
