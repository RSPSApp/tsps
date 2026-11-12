"use strict";

const { CacheDefinitions, ItemIdentifiers: Items } = require("./Core.Construction");
const Data = require("./Data.Construction");
const Instance = require("./Instance.Construction");
const House = require("./House.Construction");

const COINS = Items.COINS;
const { HOUSE_ATTRIBUTE } = Data;

/** ::hotspots - every build hotspot of the room you stand in, with its tile. */
function listHotspots({ player }) {
  const house = player.getPrivateArea();
  const position = house instanceof Instance.PlayerHouseInstance ? house.getRoomPositionAt(player.getLocation()) : null;
  const room = position && house.getRoom(position);
  if (!room) {
    player.sendMessage("Stand in a room of a house first.");
    return;
  }
  player.sendMessage(`${room.roomKey} at ${position.x},${position.y} plane ${position.plane}, rotation ${room.rotation}:`);
  for (const tile of house.hotspotTiles(position)) {
    const name = CacheDefinitions.getObject(tile.id)?.name ?? "";
    if (!/space|hotspot/i.test(name)) continue;
    const key = Data.hotspotIn(room.roomKey, tile.id)?.key ?? "(not in this room's hotspots)";
    player.sendMessage(`${key} ${tile.id} "${name}" at ${tile.x} ${tile.y} ${tile.plane}`);
  }
}

/**
 * ::housemats <furniture or room> - the materials, tools and coins to build it. An exact name or
 * key wins; otherwise every match is listed until only one is left.
 */
function houseMaterials({ player, parts }) {
  const query = parts.slice(1).join(" ").trim().toLowerCase();
  if (!query) return player.sendMessage("Usage: ::housemats <furniture or room name>, e.g. ::housemats teak display");
  const key = query.replace(/[\s-]+/g, "_").toUpperCase();
  const buildables = Data.CONSTRUCTION_BUILDABLES ?? [...Data.BUILDABLE_BY_KEY.values()];
  const rooms = Data.CONSTRUCTION_ROOMS;
  const named = (entry) => (entry.name ?? "").toLowerCase();
  const exact = [...buildables.filter(entry => entry.key === key || named(entry) === query), ...rooms.filter(room => room.key === key || named(room) === query)];
  const matches = exact.length ? exact
    : [...buildables.filter(entry => named(entry).includes(query) || entry.key.includes(key)), ...rooms.filter(room => named(room).includes(query) || room.key.includes(key))];
  const unique = [...new Map(matches.map(entry => [entry.key, entry])).values()];
  if (!unique.length) return player.sendMessage(`Nothing called "${query}" can be built.`);
  if (unique.length > 1) {
    player.sendMessage(`${unique.length} matches, be more specific (or use the key):`);
    for (const entry of unique.slice(0, 12)) player.sendMessage(`- ${entry.name} (${entry.key}, level ${entry.level})`);
    return;
  }
  const target = unique[0];
  const inventory = player.getInventory();
  if (rooms.includes(target)) {
    inventory.adds(COINS, target.cost);
    return player.sendMessage(`Gave ${target.cost.toLocaleString("en-US")} coins for ${target.name} (level ${target.level}).`);
  }
  const given = [];
  const give = (itemId, amount) => {
    inventory.adds(itemId, amount);
    given.push(`${amount} x ${CacheDefinitions.getItem(itemId)?.name ?? itemId}`);
  };
  for (const tool of [Items.HAMMER, Items.SAW]) if (!inventory.contains(tool)) give(tool, 1);
  for (const material of target.materials) {
    if (material.itemId != null) give(material.itemId, material.amount);
    else if (material.source === "NAILS") give(Items.STEEL_NAILS, material.amount);
    else player.sendMessage(`It upgrades ${Data.BUILDABLE_BY_KEY.get(material.source)?.name ?? material.source}: build that first.`);
  }
  player.sendMessage(`${target.name} (level ${target.level}): ${given.join(", ") || "nothing needed"}.`);
}

/** ::deletehouse - forget the player's house, as if they had never bought one. */
function deleteHouse({ player }) {
  House.releaseHouse(player, true);
  player.setAttribute(HOUSE_ATTRIBUTE, null);
  House.houseStateFor(player); // saves a fresh, unowned house
  House.syncHouseOptions(player);
  player.sendMessage("Your house is gone. Speak to an Estate agent to buy a new one.");
}

Object.assign(module.exports, { listHotspots, houseMaterials, deleteHouse });
