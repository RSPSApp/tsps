"use strict";

const Shared = require("./Shared.ValeTotems");

const TRAIL_VARP = "ent_totems_transmit_1";
// Cache rev 242: eight destination indicators in bits 0–7, XP charges in bits 8–10.
const TRANSIENT_MASK = (1 << 11) - 1;
const XP_ACTIONS = "ent_totems_trail_xp_buff_actions";
const XP_CHARGES = 4;
const XP_PERCENT = 115;
const EMPTY_SITE_LIMIT = 3;
const ACTIVATION_MESSAGE = "You feel closer to the ent! It will leave you more offerings during its next totem visit.";
const FLOWERS = ["ent_totems_trail_part_0", "ent_totems_trail_part_1"];
const FLOWER_FACES = [0, 2];
const FLOWER_SHAPE = 10;
const bonuses = new WeakMap();
const visibleFlowers = new Map();

function varbit(name) {
  return Shared.core().CacheDefinitions.getVarbitId(name);
}

function updateEntIndicators(player) {
  const active = bonuses.get(player);
  if (!active) return;
  const destinations = new Set(Array.from(active.keys(), (ent) => ent.destination));
  const sender = player.getPacketSender();
  for (const { site } of Shared.DATA.sites) {
    const id = varbit(`ent_totems_site_${site}_trail_buff_active`);
    const visible = destinations.has(site) ? 1 : 0;
    if (sender.getVarbit(id) !== visible) sender.sendVarbit(id, visible);
  }
  if (active.size === 0) bonuses.delete(player);
}

/** Record a real step over an existing flower. Each player can complete a pair once. */
function step(player, pair, part) {
  if (!pair.parts[part]) return;
  const progress = pair.progress ??= new WeakMap();
  const previous = progress.get(player) ?? 0;
  const current = previous | (1 << part);
  if (current === previous) return;
  progress.set(player, current);
  if (current !== 3) return;

  let active = bonuses.get(player);
  if (!active) bonuses.set(player, active = new Map());
  active.set(pair.ent, EMPTY_SITE_LIMIT);
  updateEntIndicators(player);
  player.getPacketSender().sendVarbit(varbit(XP_ACTIONS), XP_CHARGES);
  player.sendMessage(`<col=229628>${ACTIVATION_MESSAGE}</col>`);
}

/** The buff follows this individual ent, and a decorated totem consumes it. */
function offeringMultiplier(player, ent, totem) {
  const active = bonuses.get(player);
  const remaining = active?.get(ent);
  if (remaining === undefined) return 1;
  if (totem.carved && totem.decorations > 0) {
    active.delete(ent);
    return 2;
  }
  if (totem.wood === 0) {
    if (remaining === 1) active.delete(ent);
    else active.set(ent, remaining - 1);
  }
  return 1;
}

function grantFletchingXp(player, xp) {
  const sender = player.getPacketSender();
  const id = varbit(XP_ACTIONS);
  const charges = sender.getVarbit(id);
  if (charges > 0) {
    Shared.spam(player, "Your connection to the ents inspires your carving.");
    if (charges === 1) Shared.spam(player, "Your connection to the ents fades.");
    Shared.addXp(player, "FLETCHING", xp * XP_PERCENT / 100);
    sender.sendVarbit(id, charges - 1);
  } else {
    Shared.addXp(player, "FLETCHING", xp);
  }
}

function tileKey(location) {
  return location.getX() * 16384 + location.getY();
}

function placeFlower(pair, part, location) {
  const { GameObject, ObjectManager } = Shared.core();
  const key = tileKey(location);
  // Two routes can cross. Keep the first live flower on a tile until its own pair expires.
  if (visibleFlowers.has(key)) return;
  const flower = new GameObject(Shared.loc(FLOWERS[part]), location, FLOWER_SHAPE, FLOWER_FACES[part], null);
  ObjectManager.register(flower, true);
  pair.parts[part] = flower;
  visibleFlowers.set(key, { pair, part });
}

function removePair(pair) {
  const { ObjectManager } = Shared.core();
  for (const flower of pair.parts) {
    if (!flower) continue;
    visibleFlowers.delete(tileKey(flower.getLocation()));
    ObjectManager.deregister(flower, true);
  }
}

function stepAt(player, location) {
  const flower = visibleFlowers.get(tileKey(location));
  if (flower) step(player, flower.pair, flower.part);
}

function registerTrailArea() {
  const api = Shared.api();
  const { Area, Boundary } = api.core;
  const { minX, maxX, minY, maxY } = Shared.DATA.valley;
  class AuburnValleyTrails extends Area {
    process(mobile) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      if (player.isPlayerBot?.() || !player.getMovementQueue().didMoveThisCycle()) return;
      const location = player.getLocation();
      const running = player.getRunningDirection();
      if (running.getId() !== -1) stepAt(player, location.transform(-running.getX(), -running.getY()));
      stepAt(player, location);
    }
  }
  api.registerArea(new AuburnValleyTrails([new Boundary(minX, maxX, minY, maxY, 0)]));
}

function attach(api) {
  api.onServerStartup(registerTrailArea);
}

function persistentValue(name, value) {
  return name === TRAIL_VARP ? value & ~TRANSIENT_MASK : value;
}

module.exports = {
  attach, step, placeFlower, removePair, offeringMultiplier, updateEntIndicators, grantFletchingXp,
  persistentValue,
};
