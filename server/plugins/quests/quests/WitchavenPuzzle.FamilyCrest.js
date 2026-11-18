"use strict";

const LEVERS_ATTRIBUTE = "family-crest:witchaven-levers";
const UNLOCKED_ATTRIBUTE = "family-crest:perfect-gold-unlocked";
const leverObjects = new WeakMap();
let api;
let core;
let levers;
let doors;

function leverBits(player) {
  return Number(player.getAttribute(LEVERS_ATTRIBUTE)) & 7;
}

function clearLevers({ player }) {
  for (const object of leverObjects.get(player) ?? []) {
    core.ObjectManager.deregister(object, true);
    const lever = levers.find((entry) => entry.up === object.getId());
    const base = core.MapObjects.get(lever.down, object.getLocation(), null);
    if (base) player.getPacketSender().sendObject(base);
  }
  leverObjects.delete(player);
}

function showLevers({ player }) {
  const here = player.getLocation();
  if (here.getZ() !== 0 || here.getX() < 2660 || here.getX() > 2780 || here.getY() < 9620 || here.getY() > 9770) return;
  clearLevers({ player });
  const shown = [];
  for (const lever of levers) {
    if ((leverBits(player) & lever.bit) === 0) continue;
    const at = new core.Location(lever.x, lever.y, 0);
    const base = core.MapObjects.get(lever.down, at, null);
    if (!base) continue;
    const object = new core.GameObject(lever.up, at, base.getType(), base.getFace(), null).setOwner(player);
    core.ObjectManager.register(object, true);
    shown.push(object);
  }
  leverObjects.set(player, shown);
}

function pullLever(event) {
  const lever = levers.find((entry) => (entry.down === event.objectId || entry.up === event.objectId)
    && event.location.x === entry.x && event.location.y === entry.y && event.location.z === 0);
  if (!lever) return;
  event.handled = true;
  const bits = leverBits(event.player) ^ lever.bit;
  event.player.setAttribute(LEVERS_ATTRIBUTE, bits);
  // The permanent unlock is the final arrangement in the Wiki's six-pull solution.
  if ((bits & 6) === 4) event.player.setAttribute(UNLOCKED_ATTRIBUTE, true);
  const sequence = core.CacheDefinitions.getSeqId("human_pull_lever");
  if (sequence != null) event.player.performAnimation(new core.Animation(sequence));
  showLevers(event);
}

function guardDoor(event) {
  if (event.handled || !doors.has(event.objectId)) return;
  const bits = leverBits(event.player);
  const outer = (bits & 1) !== 0;
  const south = (bits & 2) !== 0;
  const inner = (bits & 4) !== 0;
  const { ObjectIdentifiers: O } = core;
  // Cache gamevals encode the conditions: h2, h2i2, g2h1, i2h1 and h2g1.
  const allowed = new Map([
    [O.DOOR_73, south],
    [O.DOOR_74, south && inner],
    [O.DOOR_75, outer && !south],
    [O.DOOR_76, event.player.getLocation().getX() >= 2728
      || event.player.getAttribute(UNLOCKED_ATTRIBUTE) === true || inner && !south],
    [O.DOOR_77, south && !outer],
  ]);
  if (allowed.get(event.objectId)) return;
  event.handled = true;
  event.player.sendMessage("The door is locked.");
}

function attach(registry) {
  api = registry;
  core = api.core;
  const { ObjectIdentifiers: O } = core;
  levers = [
    { down: O.LEVER_11, up: O.LEVER_12, x: 2722, y: 9710, bit: 1 },
    { down: O.LEVER_13, up: O.LEVER_14, x: 2724, y: 9669, bit: 2 },
    { down: O.LEVER_15, up: O.LEVER_16, x: 2722, y: 9718, bit: 4 },
  ];
  doors = new Set([O.DOOR_73, O.DOOR_74, O.DOOR_75, O.DOOR_76, O.DOOR_77]);
  api.persistAttribute(LEVERS_ATTRIBUTE, 0);
  api.persistAttribute(UNLOCKED_ATTRIBUTE, false);
  api.onObjectInteraction("Lever", { Pull: pullLever });
  api.onCustomEvent("door:toggle", guardDoor);
  api.onPlayerMapSquareChange(showLevers);
  api.onCustomEvent("player:bootstrap-complete", showLevers);
  api.onPlayerLogout(clearLevers);
}

module.exports = { attach };
