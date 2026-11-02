/** Successful gameplay actions for the Varrock and Lumbridge & Draynor easy diaries. */
let api;

const VARROCK_TEA_SQUARE = [51, 53];
const LUMBRIDGE_SQUARE = [50, 50];
const DRAYNOR_SEWERS_SQUARE = [48, 151];

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

function killed({ killer, npc }) {
  if (!killer?.isPlayer?.() || npc.getPrivateArea() !== null || npc.getCurrentDefinition(killer)?.getName() !== "Zombie") return;
  const at = npc.getLocation();
  if (at.getZ() === 0 && inSquare(at, DRAYNOR_SEWERS_SQUARE)) {
    api.emitCustomEvent("diary:task", { player: killer, diary: "lumbridge", task: "kill-a-zombie-in-draynor-sewers" });
  }
}

module.exports = function attach(registry) {
  api = registry;
  api.onCustomEvent("thieving:done", thieved);
  api.onNpcDeath(killed);
};
