/**
 * https://oldschool.runescape.wiki/w/Ancient_sceptre?action=raw#Passive_effect
 * All Ancient effects ×1.1: smoke severity 10/20→11/22, Shadow drain 10%/15%→11%/16.5%,
 * Blood healing 25%→27.5%, Ice floor(8/16/24/32 ×1.1)→8/17/26/35 ticks.
 * Smoke's 1/8 poison chance is unchanged: https://oldschool.runescape.wiki/w/Smoke_spells?action=raw
 */
let core;
const SCEPTRES = ["ANCIENT_SCEPTRE", "ANCIENT_SCEPTRE_L_"];
const TIERS = ["RUSH", "BURST", "BLITZ", "BARRAGE"];

function hasSceptre(cast) {
  if (!cast?.isPlayer?.()) return false;
  const weaponId = cast.getEquipment().get(core.Equipment.WEAPON_SLOT).getId();
  return SCEPTRES.some((name) => core.ItemIdentifiers[name] === weaponId);
}

function spellTier(spell, family) {
  return TIERS.findIndex((name) => core.CombatSpells[`${family}_${name}`] === spell);
}

function enhanceAncientEffect(event) {
  if (!event.allowed || !hasSceptre(event.attacker)) return;
  if (["SMOKE", "SHADOW", "BLOOD", "ICE"].some((family) => spellTier(event.spell, family) >= 0)) {
    event.effectMultiplier *= 1.1;
  }
}

function drainNpcAttack(event) {
  const tier = spellTier(event.spell, "SHADOW");
  if (tier < 0 || event.target.isPlayer() || !hasSceptre(event.attacker)) return;
  // The base Shadow effect handles players; supplement NPCs only after every veto has run.
  const npc = event.target.getAsNpc();
  const level = npc.getCurrentLevel(core.Skill.ATTACK);
  if (level < npc.getMaxLevel(core.Skill.ATTACK)) return;
  npc.setCurrentLevels(core.Skill.ATTACK, level - Math.floor(level * (tier < 2 ? 0.1 : 0.15) * event.effectMultiplier));
}

module.exports = {
  name: "AncientSceptre",
  members: true,
  register(api) {
    core = api.core;
    api.onCustomEvent("magic:hit-effects", enhanceAncientEffect);
    api.onCustomEvent("magic:hit-effects-applied", drainNpcAttack);
  },
};
