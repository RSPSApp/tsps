/**
 * Ectoplasmator (https://oldschool.runescape.wiki/w/Ectoplasmator), the Soul Wars reward from
 * the Nomad (plugins/minigames/soulwars/Rewards.SoulWars.js). Carried in the inventory, it gives
 * the player who kills a spectral creature Prayer experience equal to 20% of the creature's max
 * health, rounded down. It needs no charges and has no options of its own (cache ops: Drop).
 *
 * Wiki: spectral is the monster attribute (Spectral (attribute)); the Corporeal Beast and the
 * Blood, Blue and Eclipse Moons look it but give nothing, and the dumped attributes leave them
 * out. It stacks with the bonecrusher (a separate plugin on the kill's bones), and Catacombs of
 * Kourend prayer restores are for bones only, so nothing here touches prayer points.
 *
 * Ours: the experience lands when the kill is credited (onNpcDeath's killer, the player the
 * loot goes to); the Wiki gives no timing, message or sound for it.
 */
const SPECTRAL_ATTRIBUTE = "spectral";
const EXPERIENCE_SHARE = 0.2;

let core = null;

/** Prayer experience for killing `npc`, or 0 when it isn't spectral. */
function experienceFor(npc, killer) {
  const definition = npc?.getCurrentDefinition?.(killer) ?? npc?.getDefinition?.();
  if (!definition?.hasAttribute?.(SPECTRAL_ATTRIBUTE)) return 0;
  const hitpoints = Number(definition.getHitpoints?.()) || 0;
  return Math.floor(hitpoints * EXPERIENCE_SHARE);
}

/** onNpcDeath: the killer's ectoplasmator harvests a spectral kill. */
function harvest({ killer, npc }) {
  if (!killer?.isPlayer?.()) return;
  const player = killer.getAsPlayer?.() ?? killer;
  if (!player.getInventory().contains(core.ItemIdentifiers.ECTOPLASMATOR)) return;
  const experience = experienceFor(npc, player);
  if (experience > 0) player.getSkillManager().addExperiences(core.Skill.PRAYER, experience);
}

module.exports = {
  name: "Ectoplasmator",
  description: "Ectoplasmator: carried in the inventory, killing a spectral creature gives Prayer XP equal to 20% of its max health.",
  members: true,
  register(api) {
    core = api.core;
    api.onNpcDeath(harvest);
  },
  _test: { experienceFor, harvest },
};
