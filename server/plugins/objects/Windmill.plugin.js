/**
 * Windmill milling (Mill Lane Mill and the other windmills), matching OSRS:
 *
 *   Hopper > Fill        put grain in the hopper
 *   Hopper controls > Operate   grind it down into the flour bin
 *   Flour bin > Empty    fill an empty pot with the flour
 *
 * The bin amount (0-30) and the hopper contents are per-player and shared
 * between windmills. The bin's empty/full appearance is the object transform on
 * the varbit the cache uses (5325), so we set it and re-send the resolved bin.
 */
const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { MapObjects } = require("../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");

const MAX_FLOUR = 30;
/** Varbit on the flour bin loc that selects its empty/full ("has flour") model. */
const FLOUR_STATE_VARBIT = 5325;

const HOPPER_ATTRIBUTE = "windmill:hopper";
const FLOUR_ATTRIBUTE = "windmill:flour";

function flourAmount(player) {
  const value = Number(player.getAttribute(FLOUR_ATTRIBUTE));
  return Number.isFinite(value) ? Math.max(0, Math.min(MAX_FLOUR, value | 0)) : 0;
}

function setFlourAmount(player, amount) {
  const value = Math.max(0, Math.min(MAX_FLOUR, amount | 0));
  player.setAttribute(FLOUR_ATTRIBUTE, value);
  player.getPacketSender().sendVarbit(FLOUR_STATE_VARBIT, value > 0 ? 1 : 0);
  return value;
}

function hopperHasGrain(player) {
  return player.getAttribute(HOPPER_ATTRIBUTE) === true;
}

function setHopperGrain(player, full) {
  player.setAttribute(HOPPER_ATTRIBUTE, full === true);
}

/** True for a loc whose cache record is the flour bin (direct or varbit-transformed). */
function isFlourBin(objectId) {
  const cached = CacheDefinitions.getObject(objectId);
  return cached?.name === "Flour bin" || cached?.transformVarbit === FLOUR_STATE_VARBIT;
}

/**
 * The bin sits on the ground floor while the hopper/controls are upstairs (and
 * possibly a different region), so pick the nearest loaded flour bin.
 */
function findFlourBin(nearLocation) {
  let best = null;
  let bestDistance = Infinity;
  for (const objects of MapObjects.mapObjects.values()) {
    for (const object of objects) {
      if (!isFlourBin(object.getId())) continue;
      const loc = object.getLocation();
      const dx = loc.getX() - nearLocation.x;
      const dy = loc.getY() - nearLocation.y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = object;
      }
    }
  }
  return best;
}

/** Re-send a bin with the model its transform varbit now resolves to. */
function refreshBinObject(player, bin) {
  const cached = CacheDefinitions.getObject(bin.getId());
  if (!cached) return;
  let displayId = bin.getId();
  if (Array.isArray(cached.transforms) && cached.transforms.length) {
    const index =
      cached.transformVarbit !== -1 ? player.getPacketSender().getVarbit(cached.transformVarbit) : -1;
    const resolved =
      index >= 0 && index < cached.transforms.length - 1
        ? cached.transforms[index]
        : cached.transforms[cached.transforms.length - 1];
    if (resolved !== -1) displayId = resolved;
  }
  const loc = bin.getLocation();
  player.getPacketSender().sendObject(
    new GameObject(
      displayId,
      new Location(loc.getX(), loc.getY(), loc.getZ()),
      bin.getType(),
      bin.getFace(),
      bin.getPrivateArea?.() ?? null
    )
  );
}

function fillHopper(event) {
  const { player } = event;
  if (hopperHasGrain(player)) {
    player.sendMessage("There is already grain in the hopper.");
    return;
  }
  if (!player.getInventory().containsNumber(ItemIdentifiers.GRAIN)) {
    player.sendMessage("You haven't got anything to fill the hopper with.");
    return;
  }
  player.getInventory().deleteNumber(ItemIdentifiers.GRAIN, 1);
  setHopperGrain(player, true);
  player.sendMessage(
    "You put the grain in the hopper. You should now pull the lever nearby to operate the hopper."
  );
}

function operateHopperControls(event) {
  const { player } = event;
  if (!hopperHasGrain(player)) {
    player.sendMessage("You operate the empty hopper. Nothing interesting happens.");
    return;
  }
  if (flourAmount(player) >= MAX_FLOUR) {
    player.sendMessage("The flour bin downstairs is full, I should empty it first.");
    return;
  }
  setHopperGrain(player, false);
  const amount = setFlourAmount(player, flourAmount(player) + 1);
  player.sendMessage("You operate the hopper. The grain slides down the chute.");
  if (amount >= MAX_FLOUR) player.sendMessage("The flour bin downstairs is now full.");
  const bin = findFlourBin(event.location);
  if (bin) refreshBinObject(player, bin);
}

function emptyFlourBin(event) {
  const { player } = event;
  if (flourAmount(player) <= 0) {
    player.sendMessage(
      "The flour bin is already empty. You need to place wheat in the hopper upstairs first."
    );
    return;
  }
  if (!player.getInventory().containsNumber(ItemIdentifiers.POT)) {
    player.sendMessage("You need an empty pot to hold the flour in.");
    return;
  }
  player.getInventory().deleteNumber(ItemIdentifiers.POT, 1);
  player.getInventory().adds(ItemIdentifiers.POT_OF_FLOUR, 1);
  const amount = setFlourAmount(player, flourAmount(player) - 1);
  player.sendMessage(
    amount <= 0
      ? "You fill a pot with the last of the flour in the bin."
      : "You fill a pot with flour from the bin."
  );
  refreshBinObject(player, event.object);
}

module.exports = {
  name: "Windmill",
  register(api) {
    api.persistAttribute(HOPPER_ATTRIBUTE);
    api.persistAttribute(FLOUR_ATTRIBUTE);
    api.onObjectInteraction("Hopper", { Fill: fillHopper });
    api.onObjectInteraction("Hopper controls", { Operate: operateHopperControls });
    api.onObjectInteraction("Flour bin", { Empty: emptyFlourBin });
  },
};
