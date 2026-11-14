/** Standard spellbook stat drains. Behavior: OSRS Wiki's six curse spell pages. */
const CURSES = [
  ['CONFUSE', 'ATTACK', 5], ['WEAKEN', 'STRENGTH', 5], ['CURSE', 'DEFENCE', 5],
  ['VULNERABILITY', 'DEFENCE', 10], ['ENFEEBLE', 'STRENGTH', 10], ['STUN', 'ATTACK', 10],
];
const spells = new Map();
/**
 * A curse on a stat that is already lowered. The attack curses' line is recorded
 * (rsprox_transcripts/228/02224.txt ticks 1158 and 1275, Confuse or Stun on Dusk: the Leagues V
 * spellbook labels are shifted, but human_castcurse plays); no recording or Wiki page gives the
 * strength or defence wording, so those keep the older line.
 */
function weakenedMessage(curse, npc) {
  if (curse.skill === core.Skill.ATTACK) return "Your foe's attack has already been weakened.";
  return `The spell has no effect because the ${npc ? 'NPC' : 'player'} is already weakened.`;
}
/**
 * A curse on an NPC whose stats can't be lowered at all (encounter stat-drain immunity): the line on the
 * click's tick, with no cast animation, runes or XP. No curse's refusal is recorded and the Wiki's curse
 * pages give no wording. This is the bind-immunity line (rsprox_transcripts/227/00095.txt:81131 and
 * 227/02174.txt:5460 are Entangle casts through Leagues V's 218:66 button, not Enfeeble), reused for the
 * curses (ours); the immunity belongs to the target, so all six curses share it.
 */
const IMMUNE_MESSAGE = 'Your target is currently immune to that spell.';
/** Whether the NPC keeps `skill` at its base level whatever it is set to (stat-drain immunity, or a floor at base). */
function drainImmune(npc, skill) {
  const maximum = npc.getMaxLevel(skill);
  return maximum > 0 && typeof npc.previewCurrentLevel === 'function' && npc.previewCurrentLevel(skill, maximum - 1) >= maximum;
}
let core;
let api;

function initialize(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  spells.clear();
  for (const [name, skill, percent] of CURSES) {
    spells.set(core.CombatSpells[name].spellId(), { skill: core.Skill[skill], percent });
  }
}

function disabled(event) {
  const curse = spells.get(event.spellId);
  if (event.disabled === true || !curse) return;
  const target = event.player.getCombat().getTarget();
  if (target?.isNpc?.() && drainImmune(target.getAsNpc(), curse.skill)) {
    event.player.sendMessage(IMMUNE_MESSAGE);
    event.disabled = true;
    return;
  }
  const stats = target?.isNpc?.() ? target.getAsNpc()
    : target?.isPlayer?.() ? target.getAsPlayer().getSkillManager() : null;
  if (!stats || stats.getCurrentLevel(curse.skill) >= stats.getMaxLevel(curse.skill)) return;
  event.player.sendMessage(weakenedMessage(curse, target.isNpc()));
  event.disabled = true;
}

function applyCurse(event) {
  if (!event.allowed || event.handled) return;
  const curse = spells.get(event.spell?.spellId?.());
  if (!curse) return;
  const { attacker, target } = event;
  const npc = target?.isNpc?.() ? target.getAsNpc() : null;
  const player = target?.isPlayer?.() ? target.getAsPlayer() : null;
  if (!npc && !player) return;
  event.handled = true;
  const skills = player?.getSkillManager();
  const current = npc ? npc.getCurrentLevel(curse.skill) : skills.getCurrentLevel(curse.skill);
  const maximum = npc ? npc.getMaxLevel(curse.skill) : skills.getMaxLevel(curse.skill);
  if (current < maximum) {
    if (attacker?.isPlayer?.()) attacker.getAsPlayer().sendMessage(weakenedMessage(curse, !!npc));
    return;
  }
  const strength = { attacker, target, spell: event.spell, context: event.context, percent: curse.percent };
  api.emitCustomEvent('combat:stat-drain-modify', strength);
  const percent = Number.isFinite(strength.percent) && strength.percent >= 0 && strength.percent <= 100 ? strength.percent : curse.percent;
  const decrease = Math.floor(current * percent / 100);
  if (npc) {
    // The NPC API owns encounter immunity and per-instance restoration state.
    npc.setCurrentLevels(curse.skill, current - decrease);
  } else {
    skills.setCurrentLevelCombat(curse.skill, current - decrease);
    skills.updateSkill(curse.skill);
    player.sendMessage('You feel slightly weakened.');
  }
}

module.exports = {
  name: 'Standard Curses',
  description: 'Standard-spellbook Confuse, Weaken and Curse, Vulnerability, Enfeeble and Stun stat drains.',
  register(api) {
    initialize(api);
    api.onSpellDisabled(disabled);
    api.onCustomEvent('magic:utility-effect', applyCurse);
  },
};
