/** Successful gameplay actions for the Ardougne, Varrock and Lumbridge & Draynor easy diaries. */
let api;

const ARDOUGNE_MARKET_SQUARE = [41, 51];
const CAKE_ITEM_ID = 1891;
const VARROCK_TEA_SQUARE = [51, 53];
const LUMBRIDGE_SQUARE = [50, 50];
const DRAYNOR_SEWERS_SQUARE = [48, 151];
const LUMBRIDGE_SWAMP_CAVES = { minX: 3140, maxX: 3235, minY: 9535, maxY: 9595, z: 0 };
const HAM_TRAPDOOR_ID = 5492; // ham_multi_trapdoor, nameless in the cache

function inSquare(location, [x, y]) {
  return (location.getX() >> 6) === x && (location.getY() >> 6) === y;
}

function thieved({ player, kind, succeeded, npc, object }) {
  if (!succeeded || player.getPrivateArea() !== null) return;
  if (kind === "stall" && object.getDefinition()?.getName() === "Tea stall") {
    const at = object.getLocation();
    if (at.getZ() === 0 && inSquare(at, VARROCK_TEA_SQUARE)) {
      api.emitCustomEvent("diary:task", { player, diary: "varrock", task: "steal-from-the-tea-stall-in-varrock" });
    }
  } else if (kind === "pickpocket" && ["Man", "Woman"].includes(npc.getCurrentDefinition(player)?.getName())) {
    // The task also counts upstairs in Lumbridge castle; do not restrict the plane.
    if (inSquare(npc.getLocation(), LUMBRIDGE_SQUARE)) {
      api.emitCustomEvent("diary:task", { player, diary: "lumbridge", task: "pickpocket-a-man-or-woman-in-lumbridge" });
    }
  }
}

function stoleCake({ player, method, stall, itemId, location }) {
  if (method !== "stall" || stall !== "Baker's stall" || itemId !== CAKE_ITEM_ID
    || player.getPrivateArea() !== null || location.getZ() !== 0 || !inSquare(location, ARDOUGNE_MARKET_SQUARE)) return;
  api.emitCustomEvent("diary:task", { player, diary: "ardougne", task: "steal-a-cake-from-the-ardougne-market-stalls" });
}

function killed({ killer, npc }) {
  if (!killer?.isPlayer?.() || npc.getPrivateArea() !== null) return;
  const at = npc.getLocation();
  const name = npc.getCurrentDefinition(killer)?.getName();
  if (name === "Zombie" && at.getZ() === 0 && inSquare(at, DRAYNOR_SEWERS_SQUARE)) {
    api.emitCustomEvent("diary:task", { player: killer, diary: "lumbridge", task: "kill-a-zombie-in-draynor-sewers" });
  } else if ([api.core.NpcIdentifiers.CAVE_BUG, api.core.NpcIdentifiers.CAVE_BUG_2].includes(npc.getId?.())
    && at.getZ() === LUMBRIDGE_SWAMP_CAVES.z
    && at.getX() >= LUMBRIDGE_SWAMP_CAVES.minX && at.getX() <= LUMBRIDGE_SWAMP_CAVES.maxX
    && at.getY() >= LUMBRIDGE_SWAMP_CAVES.minY && at.getY() <= LUMBRIDGE_SWAMP_CAVES.maxY) {
    api.emitCustomEvent("diary:task", { player: killer, diary: "lumbridge", task: "slay-a-cave-bug-beneath-lumbridge-swamp" });
  }
}

function arrived({ player, objectId, location }) {
  if (objectId !== HAM_TRAPDOOR_ID || location.x !== 3166 || location.y !== 3252 || location.z !== 0) return;
  const at = player.getLocation();
  if (player.getPrivateArea() !== null || at.getX() !== 3149 || at.getY() !== 9652 || at.getZ() !== 0) return;
  api.emitCustomEvent("diary:task", { player, diary: "lumbridge", task: "enter-the-h-a-m-hideout" });
}

module.exports = function attach(registry) {
  api = registry;
  api.onCustomEvent("thieving:success", stoleCake);
  api.onCustomEvent("thieving:done", thieved);
  api.onCustomEvent("loc-teleports:arrived", arrived);
  api.onNpcDeath(killed);
};
