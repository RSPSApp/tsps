/** Wiki: Not So Great After All — the finishing blow, with any demonbane weapon or spell. */
const Slayer = require("../../../skills/slayer/Data.Slayer");
const { isDemonbaneAttack } = require("../../../combat/effects/Demonbane.EquipmentEffects");
const { weaponName } = require("../../../combat/effects/GearChecks.EquipmentEffects");

const DEMONBANE_WEAPONS_WITHOUT_DIRECT_BONUS = new Set(["holy water", "purging staff"]);
const finishers = new WeakMap();
let api;
let greaterDemonTask;

function dealt({ player, target, hit }) {
  if (!target?.isNpc?.() || target.getAttribute?.("echo-boss:encounter")) return;
  greaterDemonTask ??= [...Slayer.get().taskById.values()].find((task) => task.name === "greater demons").id;
  const name = target.getCurrentDefinition().getName();
  if (!Slayer.npcCountsFor(greaterDemonTask, target.getId(), name)) return;
  const spell = hit.getCombatType() === api.core.CombatType.MAGIC ? player.getCombat().getSelectedSpell() : null;
  if (!isDemonbaneAttack(player, spell) && !DEMONBANE_WEAPONS_WITHOUT_DIRECT_BONUS.has(weaponName(player))) return;
  // Snapshot the attack before a projectile lands or a thrown weapon leaves its equipment slot.
  for (const damage of hit.getHits()) damage.onApplied((taken) => {
    if (taken > 0 && target.getHitpoints() <= 0) finishers.set(target, player);
  });
}

function died({ npc, killer, preventDeath }) {
  const player = finishers.get(npc);
  finishers.delete(npc);
  if (player && player === killer && !preventDeath) {
    api.emitCustomEvent("combat-achievements:complete", { player, task: "Not So Great After All" });
  }
}

module.exports = function attachGreaterDemonTasks(pluginApi) {
  api = pluginApi;
  Slayer.init(api);
  api.onPlayerDealtDamage(dealt);
  api.onNpcDeath(died);
};

Object.assign(module.exports, { dealt, died });
