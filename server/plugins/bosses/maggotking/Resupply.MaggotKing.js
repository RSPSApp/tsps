"use strict";

// Optional between-trip banking, not a new encounter or death-recovery gate.
// Primary: Maggot King/Strategies rev15402578; Bank chest (amenity) rev15402269.
const Common = require("./Common.MaggotKing");
// This is the existing Sailing amenity's persisted 0/1 state for varbit15621.
// Both login handlers must project the same state, including already-built saves.
const BUILT_ATTRIBUTE = "sailing:amenity-bankchest-sangvesti";
const CHEST = Object.freeze({ root: 62185, unbuilt: 62186, built: 62187,
  varbit: 15621, x: 2576, y: 7833, z: 0, shape: 10, face: 1 });
const BUILD_TICKS = 3;
const BASE_XP = 1787;
// These presentation lines are repository-owned; no retail message/animation capture is claimed.
const REQUIREMENTS = "You need level 70 Construction, a hammer, a saw, 1 magic stone, 2 cupronickel bars, 2 adamantite bars and 4 ironwood planks.";
const QUEST_REQUIRED = "You need to complete The Blood Moon Rises to build this bank chest.";
let api, core;
const pending = new Map();

// House destructures Core.Construction at load time: only load it during an operation,
// after normal plugin startup initialized Construction. Maggot never initializes that Core.
function house() { return require("../../skills/construction/House.Construction"); }
function buildable() {
  const ids = core.ItemIdentifiers;
  // Match Construction's material_cost descriptor, including GardenPlants' itemId check.
  return Object.freeze({ key: "maggot-resupply-chest", level: 70, tool: "saw",
    materials: Object.freeze([[ids.MAGIC_STONE, 1], [ids.CUPRONICKEL_BAR, 2],
      [ids.ADAMANTITE_BAR, 2], [ids.IRONWOOD_PLANK, 4]]
      .map(([itemId, amount]) => Object.freeze({ itemId, amount }))) });
}
function built(player) { return Number(player.getAttribute(BUILT_ATTRIBUTE)) === 1; }
function sync({ player }) {
  player.getPacketSender().sendVarbit(CHEST.varbit, built(player) ? 1 : 0);
}
function target(player, object) {
  const at = object?.getLocation?.();
  return player.getPrivateArea() == null && object?.getPrivateArea?.() == null
    && object?.getId?.() === CHEST.root && object.getType() === CHEST.shape && object.getFace() === CHEST.face
    && at?.getX() === CHEST.x && at.getY() === CHEST.y && at.getZ() === CHEST.z
    && player.getLocation().getZ() === CHEST.z
    && core.MapObjects.stillStands(player, CHEST.root, at, object, true);
}
function unbuiltTarget(player, object) {
  return !built(player) && target(player, object)
    && core.ObjectDefinition.forPlayer(CHEST.root, player)?.id === CHEST.unbuilt;
}
function reached(player, object) {
  const base = core.ObjectDefinition.forId(CHEST.root);
  const shown = core.ObjectDefinition.forPlayer(CHEST.root, player);
  return !!base && !!shown && core.PathFinder.reachedObject(player, CHEST.x, CHEST.y,
    base.getSizeX(), base.getSizeY(), object.getFace(), CHEST.shape, shown.getBlockingMask());
}
function eligible(player, descriptor, materials) {
  const helpers = house();
  return Common.questComplete(player) && helpers.hasHammer(player) && helpers.hasSaw(player)
    && helpers.furnitureLevel(player, descriptor) >= descriptor.level
    && [...materials].every(([id, amount]) => player.getInventory().getAmount(id) + helpers.storedAmount(player, id) >= amount);
}
function cancel({ player }) {
  const work = pending.get(player);
  // Synchronous payment is the linearization boundary. Reentrant callbacks cannot
  // clear the token and start another payment halfway through the same commit.
  if (work && work.phase !== "committing") work.task.stop();
}
function shutdown() {
  for (const player of [...pending.keys()]) cancel({ player });
}
function inspect({ player, object }) {
  if (!target(player, object)) return false;
  player.sendMessage(REQUIREMENTS);
  return true;
}
function build({ player, object }) {
  // Consume refusal of our root so the generic Sailing amenity cannot pay after rejection.
  if (!target(player, object)) return object?.getId?.() === CHEST.root;
  if (pending.has(player)) return true;
  if (built(player)) { sync({ player }); return true; }
  if (!Common.questComplete(player)) { player.sendMessage(QUEST_REQUIRED); return true; }
  if (!unbuiltTarget(player, object) || !reached(player, object)) return true;
  const descriptor = buildable();
  const materials = new Map(descriptor.materials.map(({ itemId, amount }) => [itemId, amount]));
  if (!eligible(player, descriptor, materials)) { player.sendMessage(REQUIREMENTS); return true; }
  const work = { phase: "waiting", origin: player.getLocation().clone(), area: player.getPrivateArea(), task: null };
  let elapsed = 0;
  work.task = new (class extends core.Task {
    constructor() { super(1, player.getIndex(), false); }
    stop() {
      super.stop();
      if (work.phase !== "committing" && pending.get(player) === work) pending.delete(player);
    }
    execute() {
      if (pending.get(player) !== work || !player.isRegistered() || player.getHitpoints() <= 0
        || player.getPrivateArea() !== work.area || !player.getLocation().equals(work.origin)
        || !unbuiltTarget(player, object) || !reached(player, object)) { this.stop(); return; }
      if (++elapsed < BUILD_TICKS) return;
      // All costs are deferred to this valid reached-operation's third task tick.
      // This commit/cancellation order is repository policy, not a retail tick capture.
      if (!eligible(player, descriptor, materials) || pending.get(player) !== work
        || !unbuiltTarget(player, object) || !reached(player, object)
        || !player.getLocation().equals(work.origin) || player.getPrivateArea() !== work.area) { this.stop(); return; }
      work.phase = "committing";
      try {
        // Existing helper owns needed crystal charge, bounded material discounts,
        // inventory-first and carried storage remainder. No second charge or stale snapshot.
        house().useMaterials(player, descriptor, materials);
        player.setAttribute(BUILT_ATTRIBUTE, 1);
        sync({ player });
        const outfit = { player, multiplier: 1 };
        api.emitCustomEvent("construction:outfit-multiplier", outfit);
        player.getSkillManager().addExperience(core.Skill.CONSTRUCTION, BASE_XP * outfit.multiplier);
        player.getInventory().refreshItems();
        api.emitCustomEvent("persistence:save", { player, reason: "maggot-resupply-chest" });
        player.sendMessage("You build the bank chest.");
      } finally {
        work.phase = "ended";
        this.stop();
      }
    }
  })();
  pending.set(player, work);
  core.TaskManager.submit(work.task);
  return true;
}
// A stale supplied Build can disagree with the current built definition's Bank slot.
// Name/action hooks cannot see that contradiction. Leave genuine Bank events to the listener.
function refuseStaleBuild(event) {
  if (event.handled || !event.player || event.clickType !== 1
    || event.objectId !== CHEST.root || event.object?.getId?.() !== CHEST.root
    || typeof event.option !== "string" || event.option.toLowerCase() !== "build"
    || !built(event.player)) return;
  if (build(event)) event.handled = true;
}
function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  api.persistAttribute(BUILT_ATTRIBUTE, 0);
  api.onBeforeObjectInteraction(refuseStaleBuild);
  api.onObjectInteraction("Bank chest space", { Build: build, Inspect: inspect });
  api.onPlayerLogin(sync);
  api.onPlayerLogout(cancel);
  api.onPlayerDisconnect(cancel);
  api.onPlayerBeforeDeath(cancel);
  api.onCustomEvent("player:interaction-cleared", cancel);
  api.onServerShutdown(shutdown);
}
module.exports = { attach, BUILT_ATTRIBUTE, CHEST, BUILD_TICKS, BASE_XP };
