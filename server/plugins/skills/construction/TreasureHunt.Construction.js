"use strict";

const { Animation, CountdownTask, Graphic, Location, PluginManager, RegionManager, TaskManager } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");
const Prizes = require("./Prizes.Construction");

// Treasure hunt (rsprox captures, Wiki): Activate on the fairy house ("You cannot summon the fairy
// while in building mode.") hides the treasure fairy somewhere in the house (sound 1930 and a
// smokepuff by the house) and gives "You take a magic stone that can lead you to the treasure."
// (a treasure stone). Feeling the stone says "Cold.", "Colder...", "Warmer...", "Hot!" or "Very
// hot!"; feeling it on her tile finds her ("You've found the fairy!", emote_dance) and wins. With
// no hunt on, "The stone is inert. No fairy is hidden in the house." The distances behind each
// message, and where she can hide (any free floor tile on the fairy house's floor), are this
// server's.
const STONE = Ids.obj("poh_treasure_hunt_stone");
const FAIRY = Ids.npc("poh_treasure_hunt_fairy");
const HIDE_SOUND = 1930;
const SMOKEPUFF = 86;
const DANCE = Ids.seq("emote_dance");
const FAIRY_TICKS = 10;

/** house -> { tile: Location, furniture, last: WeakMap(player -> distance) } */
const hunts = new WeakMap();

function activate(event) {
  const player = event.player;
  const house = House.houseFor(player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  if (furniture?.buildableKey !== "TREASURE_HUNT") return false;
  if (house.buildingMode) return player.sendMessage("You cannot summon the fairy while in building mode."), true;
  if (hunts.has(house)) return giveStone(player), true;
  Prizes.offer(player, house, "treasure", () => hide(player, house, furniture, event.location));
  return true;
}

function hide(player, house, furniture, at) {
  if (hunts.has(house) || House.houseFor(player) !== house || house.buildingMode) return;
  const tile = hidingPlace(house, at.z);
  if (!tile) return player.sendMessage("There is nowhere in the house for the fairy to hide.");
  hunts.set(house, { tile, furniture, last: new WeakMap() });
  const puff = new Location(at.x - 1, at.y + 2, at.z);
  for (const occupant of house.getPlayers()) {
    occupant.getPacketSender().sendAreaSound(HIDE_SOUND, puff.getX(), puff.getY(), puff.getZ(), 1, 0, 5);
    occupant.getPacketSender().sendGraphic(new Graphic(SMOKEPUFF), puff);
  }
  giveStone(player);
}

function giveStone(player) {
  if (player.getInventory().contains(STONE)) return;
  if (player.getInventory().getFreeSlots() === 0) return player.sendMessage("You don't have enough inventory space.");
  player.getInventory().adds(STONE, 1);
  player.sendMessage("You take a magic stone that can lead you to the treasure.");
}

/** A random free tile in a room on the given floor. */
function hidingPlace(house, plane) {
  const rooms = [];
  for (let x = 0; x < house.gridSize; x++) for (let y = 0; y < house.gridSize; y++) {
    if (house.getRoom({ x, y, plane })) rooms.push({ x, y, plane });
  }
  for (let tries = 0; tries < 40 && rooms.length; tries++) {
    const room = rooms[Math.floor(Math.random() * rooms.length)];
    const corner = house.roomCorner(room);
    const tile = new Location(corner.getX() + 1 + Math.floor(Math.random() * 6), corner.getY() + 1 + Math.floor(Math.random() * 6), corner.getZ());
    if (!RegionManager.blocked(tile, house)) return tile;
  }
  return null;
}

function feel({ player }) {
  const house = House.houseFor(player);
  const hunt = house && hunts.get(house);
  if (!hunt) return player.sendMessage("The stone is inert. No fairy is hidden in the house."), true;
  const here = player.getLocation();
  if (here.getZ() !== hunt.tile.getZ()) return player.sendMessage("Cold."), true;
  const distance = Math.max(Math.abs(here.getX() - hunt.tile.getX()), Math.abs(here.getY() - hunt.tile.getY()));
  if (distance === 0) return found(player, house, hunt), true;
  const last = hunt.last.get(player);
  hunt.last.set(player, distance);
  if (distance <= 2) player.sendMessage("Very hot!");
  else if (distance <= 4) player.sendMessage("Hot!");
  else if (last === undefined || last === distance || distance > 12) player.sendMessage("Cold.");
  else player.sendMessage(distance < last ? "Warmer..." : "Colder...");
  return true;
}

function found(player, house, hunt) {
  hunts.delete(house);
  player.performAnimation(new Animation(DANCE));
  player.sendMessage("You've found the fairy!");
  const fairy = PluginManager.spawnNpc({ id: FAIRY, x: hunt.tile.getX(), y: hunt.tile.getY(), z: hunt.tile.getZ(), wanderRadius: 0 });
  if (fairy) {
    fairy.__skipDefaultRespawn = true;
    house.enter(fairy);
    TaskManager.submit(new CountdownTask(player, FAIRY_TICKS, () => {
      if (!fairy.isRegistered()) return;
      house.leave(fairy, false);
      PluginManager.removeNpc(fairy);
    }));
  }
  for (const occupant of house.getPlayers()) {
    if (occupant !== player) occupant.sendMessage(`${player.getDisplayName()} has found the treasure fairy!`);
    occupant.getInventory().delete(STONE, occupant.getInventory().getAmount(STONE));
  }
  Prizes.award(house, "treasure", player);
}

/** House.leftHouse: the stone only works in the house it came from. */
function leftHunt(player) {
  const stones = player.getInventory().getAmount(STONE);
  if (stones) player.getInventory().delete(STONE, stones);
}

/** Instance.rebuild in building mode: the hunt is called off. */
function resetHunt(house) {
  if (!house.buildingMode || !hunts.has(house)) return;
  hunts.delete(house);
  Prizes.withdraw(house, "treasure");
}

function attachTreasureHunt(api) {
  api.onObjectInteraction("Treasure Hunt Fairy House", { Activate: activate });
  api.onItemAction("Treasure stone", { Feel: feel });
}

Object.assign(module.exports, { attachTreasureHunt, leftHunt, resetHunt });
