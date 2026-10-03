import type { PluginApi, PluginObjectInteractionEvent } from "../../../../plugins/PluginTypes";
import type { Player } from "../../../entity/impl/player/Player";
import { Skill } from "../../../model/Skill";
import { TeleportHandler } from "../../../model/teleportation/TeleportHandler";
import { TeleportType } from "../../../model/teleportation/TeleportType";
import { Wilderness } from "../../../content/wilderness/Wilderness";
import { SpellTeleports } from "../../../content/combat/magic/SpellTeleports";
import { LunarSpells } from "../../../content/combat/magic/LunarSpells";
import { ArceuusSpells } from "../../../content/combat/magic/ArceuusSpells";
import { ObjectIdentifiers } from "../../../../util/ObjectIdentifiers";
import { PlayerHouseInstance, type SavedHouseFurniture } from "./PlayerHouseInstance";

const aliases: Record<string, string> = { moonclan: "LUNAR_ISLE", "ape atoll": "MARIM", "kourend castle": "KOUREND", "fenkenstrain's castle": "FENKENSTRAINS_CASTLE", waterbirth: "WATERBIRTH_ISLAND", watchtower: "YANILLE_WATCHTOWER", barbarian: "BARBARIAN_OUTPOST", khazard: "PORT_KHAZARD" };
export function houseDestinations() {
  // Reuse the spell system's costs and destinations; home/house spells cannot be directed.
  return [...SpellTeleports.getTeleportDestinations(), ...LunarSpells.getTeleportDestinations(), ...ArceuusSpells.getTeleportDestinations().map(data => ({ ...data, name: data.name === "ape atoll teleport" ? "ape atoll dungeon teleport" : data.name }))]
    .filter(data => data.runes.length && data.name !== "teleport to house")
    .map(data => {
      const name = data.name.replace(/ teleport$/, "");
      const key = aliases[name] ?? name.replace(/ /g, "_").toUpperCase();
      const ids = ObjectIdentifiers as unknown as Record<string, number>;
      // Revision 237 names the mahogany Watchtower model "Yanille Portal".
      const portalIds = name === "watchtower"
        ? [ObjectIdentifiers.YANILLE_WATCHTOWER_PORTAL, ObjectIdentifiers.YANILLE_PORTAL_2, ObjectIdentifiers.YANILLE_WATCHTOWER_PORTAL_2]
        : [ids[`${key}_PORTAL`], ids[`${key}_PORTAL_2`], ids[`${key}_PORTAL_3`]];
      return { ...data, portalIds };
    });
}

function current(player: Player, house: PlayerHouseInstance, furniture: SavedHouseFurniture): boolean {
  return player.getPrivateArea() === house && house.save.rooms.flat(2).some(room => Object.values(room?.furnitureByLocation ?? {}).includes(furniture));
}

export function configureHouseDestination(player: Player, house: PlayerHouseInstance, furniture: SavedHouseFurniture, name: string): boolean {
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
  house.owner.setAttribute("construction:house", house.save);
  for (const occupant of house.getPlayers()) house.rebuild(occupant, house.buildingMode);
  player.sendMessage(`Added ${name}.`);
  return true;
}

function chooseDestination(api: PluginApi, player: Player, house: PlayerHouseInstance, furniture: SavedHouseFurniture, mode: "add" | "remove" | "teleport", page = 0): void {
  if (!current(player, house, furniture)) return;
  const nexus = furniture.hotspotKey === "PORTAL_NEXUS";
  const destinations = houseDestinations().filter(data => mode === "add" ? !(furniture.destinations ?? []).includes(data.name) && (nexus || data.portalIds.every(Number.isInteger)) : furniture.destinations?.includes(data.name));
  if (!destinations.length) { player.sendMessage("There are no destinations to select."); return; }
  const options: Array<string | (() => void)> = [];
  for (const destination of destinations.slice(page * 4, page * 4 + 4)) options.push(destination.name, () => {
    if (!current(player, house, furniture)) return;
    if (mode === "teleport") {
      const travel = () => {
        if (current(player, house, furniture) && furniture.destinations?.includes(destination.name) && TeleportHandler.checkReqs(player, destination.destination)) TeleportHandler.teleport(player, destination.destination.clone(), TeleportType.NORMAL, false);
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
        player.setAttribute("construction:house", house.save);
      }, "No", () => {});
    }
  });
  if ((page + 1) * 4 < destinations.length) options.push("More destinations", () => chooseDestination(api, player, house, furniture, mode, page + 1));
  api.sendMultiChatboxPrompt(player, mode === "teleport" ? "Choose a destination" : "Configure destinations", ...options);
}

export function useHousePortal(api: PluginApi, event: PluginObjectInteractionEvent): boolean {
  const house = event.player.getPrivateArea();
  if (!(house instanceof PlayerHouseInstance)) return false;
  const furniture = house.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  if (!furniture) return false;
  const action = event.definition?.getInteractions()?.[event.clickType - 1]?.toLowerCase();
  if (furniture.hotspotKey === "PORTAL_NEXUS" && ["teleport", "teleport menu", "configuration"].includes(action ?? "")) {
    if (action !== "configuration") chooseDestination(api, event.player, house, furniture, "teleport");
    else if (house.owner !== event.player) event.player.sendMessage("Only the owner can configure the nexus.");
    else api.sendMultiChatboxPrompt(event.player, "Portal nexus configuration", "Add destination", () => chooseDestination(api, event.player, house, furniture, "add"), "Remove destination", () => chooseDestination(api, event.player, house, furniture, "remove"), "Cancel", () => {});
    return true;
  }
  if (furniture.buildableKey.endsWith("_PORTAL_FRAME") && action === "enter") {
    chooseDestination(api, event.player, house, furniture, "teleport");
    return true;
  }
  if (action !== "direct-portal") return false;
  if (house.owner !== event.player) { event.player.sendMessage("Only the owner can direct portals."); return true; }
  const position = house.getRoomPositionAt(event.location)!;
  const portals = Object.values(house.getRoom(position)!.furnitureByLocation ?? {}).filter(value => value.buildableKey.endsWith("_PORTAL_FRAME"));
  if (!portals.length) { event.player.sendMessage("Build a portal frame in this room first."); return true; }
  const options: Array<string | (() => void)> = [];
  portals.forEach((portal, i) => options.push(`Portal ${i + 1}: ${portal.destinations?.[0] ?? "empty"}`, () => chooseDestination(api, event.player, house, portal, "add")));
  api.sendMultiChatboxPrompt(event.player, "Which portal?", ...options);
  return true;
}
