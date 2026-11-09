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
 * The amount itself belongs on the cache's own count varbits (`mill_flour` 4920
 * and `mill_cornflour` 4923, 5 bits each on varps 203/694): the client reads
 * those, not an attribute, and the Cook's Assistant Quest Helper step is a plain
 * `VarbitRequirement(MILL_FLOUR, 1)` that never advances without them.
 */
const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { MapObjects } = require("../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");

const MAX_FLOUR = 30;
/** Varbit on the flour bin loc that selects its empty/full ("has flour") model. */
const FLOUR_STATE_VARBIT = 5325;
/** The bin's wheat and cornflour counts (`mill_flour`, `mill_cornflour`), 5 bits each. */
const FLOUR_COUNT_VARBIT = 4920;
const CORNFLOUR_COUNT_VARBIT = 4923;

const HOPPER_ATTRIBUTE = "windmill:hopper";
const FLOUR_ATTRIBUTE = "windmill:flour";
const FLOUR_KIND_ATTRIBUTE = "windmill:flour-kind";

function flourAmount(player) {
  const value = Number(player.getAttribute(FLOUR_ATTRIBUTE));
  return Number.isFinite(value) ? Math.max(0, Math.min(MAX_FLOUR, value | 0)) : 0;
}

function setFlourAmount(player, amount) {
  const value = Math.max(0, Math.min(MAX_FLOUR, amount | 0));
  player.setAttribute(FLOUR_ATTRIBUTE, value);
  // The client reads the count from the cache's varbit, so mirror it before the flag:
  // the bin's model and the Quest Helper both key off these, and the kind is still set
  // here in both callers (emptyFlourBin clears it only after this returns).
  const isCornflour = player.getAttribute(FLOUR_KIND_ATTRIBUTE) === "sweetcorn";
  player.getPacketSender().sendVarbit(isCornflour ? CORNFLOUR_COUNT_VARBIT : FLOUR_COUNT_VARBIT, value);
  player.getPacketSender().sendVarbit(FLOUR_STATE_VARBIT, value > 0 ? 1 : 0);
  return value;
}

/**
 * The saved bin count goes back on its varbits at login, as live sends it (capture 237/01099: mill_flour 0 -> 4):
 * otherwise the client reads 0 after a relog, the bin looks empty and Quest Helper's Cook's Assistant step regresses.
 */
function syncFlourOnLogin({ player }) {
  setFlourAmount(player, flourAmount(player));
}

function hopperContents(player) {
  const contents = player.getAttribute(HOPPER_ATTRIBUTE);
  return contents === true ? "grain" : contents === "sweetcorn" ? "sweetcorn" : null;
}

function hopperHasGrain(player) {
  return hopperContents(player) !== null;
}

function setHopperGrain(player, contents) {
  player.setAttribute(HOPPER_ATTRIBUTE, contents === true ? true : contents || false);
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
  if (!bin) return;
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

function fillSweetcornHopper(event, api) {
  const { player, objectId, itemId } = event;
  if (itemId !== ItemIdentifiers.SWEETCORN) return;
  const visible = api.core.ObjectDefinition.forPlayer(objectId, player);
  if (visible?.getName?.() !== "Hopper") return;
  if (hopperHasGrain(player)) {
    event.handled = true;
    player.sendMessage("There is already grain in the hopper.");
    return;
  }
  event.handled = true;
  player.getInventory().deleteNumber(ItemIdentifiers.SWEETCORN, 1);
  setHopperGrain(player, "sweetcorn");
  player.sendMessage("You put the sweetcorn in the hopper. You should now operate the controls nearby.");
}

function useGrainOnHopper(event) {
  // Quest items also use the name "Grain"; only ordinary wheat is milled.
  if (event.itemId !== ItemIdentifiers.GRAIN) return false;
  fillHopper(event);
}

function operateHopperControls(event) {
  const { player } = event;
  const contents = hopperContents(player);
  if (!contents) {
    player.sendMessage("You operate the empty hopper. Nothing interesting happens.");
    return;
  }
  if (flourAmount(player) >= MAX_FLOUR) {
    player.sendMessage("The flour bin downstairs is full, I should empty it first.");
    return;
  }
  const flourKind = player.getAttribute(FLOUR_KIND_ATTRIBUTE);
  if (flourAmount(player) > 0 && flourKind && flourKind !== contents) {
    player.sendMessage("The flour bin contains a different type of flour; empty it first.");
    return;
  }
  setHopperGrain(player, false);
  player.setAttribute(FLOUR_KIND_ATTRIBUTE, contents);
  const amount = setFlourAmount(player, flourAmount(player) + 1);
  player.sendMessage("You operate the hopper. The grain slides down the chute.");
  if (amount >= MAX_FLOUR) player.sendMessage("The flour bin downstairs is now full.");
  const bin = findFlourBin(event.location);
  if (bin) refreshBinObject(player, bin);
}

function emptyFlourBin(api, event) {
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
  const isCornflour = player.getAttribute(FLOUR_KIND_ATTRIBUTE) === "sweetcorn";
  player.getInventory().adds(isCornflour ? ItemIdentifiers.POT_OF_CORNFLOUR : ItemIdentifiers.POT_OF_FLOUR, 1);
  const amount = setFlourAmount(player, flourAmount(player) - 1);
  if (amount <= 0) player.setAttribute(FLOUR_KIND_ATTRIBUTE, null);
  player.sendMessage(
    amount <= 0
      ? "You fill a pot with the last of the flour in the bin."
      : "You fill a pot with flour from the bin."
  );
  if (!isCornflour) api.emitCustomEvent("windmill:flour-collected", { player });
  refreshBinObject(player, event.object);
}

module.exports = {
  name: "Windmill",
  description: "Windmill milling: fill the hopper with grain, operate the controls and empty the flour bin into a pot, as in Cook's Assistant.",
  register(api) {
    api.persistAttribute(HOPPER_ATTRIBUTE);
    api.persistAttribute(FLOUR_ATTRIBUTE);
    api.persistAttribute(FLOUR_KIND_ATTRIBUTE);
    api.onPlayerLogin(syncFlourOnLogin);
    api.onObjectInteraction("Hopper", { Fill: fillHopper });
    api.onObjectInteraction("Hopper controls", { Operate: operateHopperControls });
    api.onObjectInteraction("Flour bin", { Empty: emptyFlourBin.bind(null, api) });
    api.onItemOnObject("Grain", "Hopper", useGrainOnHopper, { noted: false });
    api.onItemOnObject((event) => fillSweetcornHopper(event, api), { noted: false });
  },
};
