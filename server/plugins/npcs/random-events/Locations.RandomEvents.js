"use strict";

const DATA = require("./data/locations.json");
const TELEPORTING_KINDS = new Set(["frog", "beekeeper", "drill", "forester", "gravedigger",
  "pinball", "evilbob", "prison", "eviltwin", "maze", "mime", "pillory", "quiz", "exam"]);
const BANK_FOLLOWERS = new Set(["genie", "countcheck", "jekyll"]);
const UNDERWATER_KINDS = new Set(["certer", "countcheck", "genie", "jekyll", "gift"]);
const KALPHITE_KINDS = new Set([...UNDERWATER_KINDS, "dwarf", "drill", "plant"]);

function inside(location, boxes) {
  const x = location.getX(), y = location.getY(), z = location.getZ();
  return boxes.some(([minX, maxX, minY, maxY, plane]) =>
    z === plane && x >= minX && x <= maxX && y >= minY && y <= maxY);
}

function bank(api, player) {
  const location = player.getLocation();
  if (inside(location, DATA.bankExceptions)) return false;
  const x = location.getX(), y = location.getY(), z = location.getZ();
  if (inside(location, DATA.bankRoofs) && api.getRegionManager().getRegion(x, y)?.isUnderRoof(x, y, z)) return true;
  const { MapObjects } = api.core;
  // shortcut: roofless banks use adjacent booth/chest tiles; add captured zone edges when available.
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if ((MapObjects.mapObjects.get(MapObjects.getHash(x + dx, y + dy, z)) ?? [])
      .some(object => /^(?:closed )?bank (?:chest|booth)$/i.test(object.getDefinition().getName()))) return true;
  }
  return false;
}

function available(api, definition, player, following = false) {
  const location = player.getLocation();
  if (inside(location, DATA.noEvents)) return false;
  const request = { player, kind: definition.kind, following, allowed: null };
  api.emitCustomEvent("random-events:eligibility", request);
  if (request.allowed !== null) return request.allowed;
  if (bank(api, player)) return following && BANK_FOLLOWERS.has(definition.kind);
  const wilderness = api.core.Wilderness.isPvpArea(location);
  const area = player.getArea?.();
  if (area && !wilderness && !DATA.allowedManagedAreas.includes(area.getName())) return false;
  if (inside(location, DATA.underwater)) return UNDERWATER_KINDS.has(definition.kind);
  if (inside(location, DATA.kalphite)) return KALPHITE_KINDS.has(definition.kind);
  return !TELEPORTING_KINDS.has(definition.kind) ||
    (!wilderness && !Object.values(DATA.oldHunter).some(boxes => inside(location, boxes)));
}

/** The diving variants appear here: the Wiki's Underwater NPC versions and reduced pool. */
function underwater(player) {
  return inside(player.getLocation(), DATA.underwater);
}

module.exports = { available, bank, underwater };
