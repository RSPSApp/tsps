"use strict";

const { Animation, PluginManager } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");

// Combat dummies (rsprox captures): Attach swaps the dummy for its NPC ("You attach the sand
// bag."), which takes hits and never falls; Detach swaps back. The NPC has the cache's 1,000
// hitpoints, topped up every tick, and never retaliates. Its Upgrade and Remove only refuse
// until the sand bag is detached (rsprox.net recs 2765, 2767; rev 229).
const DUMMY_NPCS = { COMBAT_DUMMY: Ids.npc("poh_combat_dummy_npc"), UNDEAD_COMBAT_DUMMY: Ids.npc("poh_combat_dummy_undeadslayer_npc") };
const PICK_UP = Ids.seq("human_pickuptable");
const NO_RETALIATE = "combat:no-retaliate";

/** house -> Map(npc -> furniture it stands in for) */
const attached = new WeakMap();

function dummiesIn(house) {
  let dummies = attached.get(house);
  if (!dummies) attached.set(house, dummies = new Map());
  return dummies;
}

function attach(event) {
  const player = event.player;
  const house = House.houseFor(player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  const npcId = furniture && DUMMY_NPCS[furniture.buildableKey];
  if (!npcId) return false;
  if (house.buildingMode) {
    player.sendMessage("You cannot set up the combat dummy in building mode.");
    return true;
  }
  const { x, y, z } = event.location;
  const npc = PluginManager.spawnNpc({ id: npcId, x, y, z, wanderRadius: 0 });
  if (!npc) return true;
  npc.setFlag?.(NO_RETALIATE, true);
  house.enter(npc);
  dummiesIn(house).set(npc, furniture);
  house.hideFurniture(furniture);
  player.performAnimation(new Animation(PICK_UP));
  player.sendMessage("You attach the sand bag.");
  return true;
}

function detach(event) {
  const house = House.houseFor(event.player);
  const furniture = house && dummiesIn(house).get(event.npc);
  if (!furniture) return false;
  dummiesIn(house).delete(event.npc);
  house.leave(event.npc, false);
  PluginManager.removeNpc(event.npc);
  house.showFurniture(furniture);
  event.player.performAnimation(new Animation(PICK_UP));
  event.player.sendMessage("You detach the sand bag.");
  return true;
}

/** The attached dummy NPC's Upgrade and Remove: the loc must come back first. */
function refuseWhileAttached(message, event) {
  const house = House.houseFor(event.player);
  if (!house || !dummiesIn(house).has(event.npc)) return false;
  event.player.sendMessage(message);
  return true;
}

const refuseUpgrade = refuseWhileAttached.bind(null, "You should detach the sand bag first.");
const refuseRemove = refuseWhileAttached.bind(null, "You must detach the sand bag before you can remove this.");

/** PlayerHouseInstance.process: dummies never fall. */
function tendDummies(house) {
  for (const npc of attached.get(house)?.keys() ?? []) {
    if (npc.getHitpoints() < npc.getDefinition().getHitpoints()) npc.setHitpoints(npc.getDefinition().getHitpoints());
  }
}

function attachCombatRoom(api) {
  api.onObjectInteraction("Combat dummy", { Attach: attach });
  api.onObjectInteraction("Undead combat dummy", { Attach: attach });
  // The cache names them in colour tags; match the plain names too.
  api.onNpcsInteraction(["<col=00ffff>Combat dummy</col>", "<col=00ffff>Undead Combat dummy</col>", "Combat dummy", "Undead Combat dummy"], {
    Detach: detach, Upgrade: refuseUpgrade, Remove: refuseRemove,
  });
}

Object.assign(module.exports, { attachCombatRoom, tendDummies });
