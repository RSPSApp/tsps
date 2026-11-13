/**
 * A Kingdom Divided's Arceuus spells. Wiki (Arceuus spellbook): "With the exception of Ghostly Grasp and Inferior
 * Demonbane, all combat spells in the Arceuus spellbook require completion of the quest A Kingdom Divided", and
 * "With the exception of Resurrect Crops and reanimation spells, all utility spells" do too; "Players are free to use
 * all teleportation spells upon unlocking the Arceuus spellbook". Every Arceuus cast reaches Spell.canCast, which asks
 * here ("spell disabled") with the spell's cache item; the teleports carry none. TSPS wording for the refusal: the
 * page quotes no line.
 *
 * The world's `quests:equipment-requirements` switch (Quests plugin) lifts this lock with the other quest equipment
 * and spellbook requirements when it is false.
 */
const AKD_QUEST = { key: "a_kingdom_divided", name: "A Kingdom Divided" };
const REQUIREMENTS_CONFIG = "quests:equipment-requirements";
/** The spells the Wiki names as needing no quest (by cache spell name, lower case). */
const OPEN_SPELLS = new Set([
  "ghostly grasp",
  "inferior demonbane",
  "resurrect crops",
  "basic reanimation",
  "adept reanimation",
  "expert reanimation",
  "master reanimation",
]);
const REFUSAL = `You need to complete ${AKD_QUEST.name} to cast this spell.`;

let pluginApi = null;
let core = null;

function questComplete(player) {
  const query = { player, key: AKD_QUEST.key, complete: false };
  pluginApi.emitCustomEvent("quest:is-complete", query);
  return query.complete === true;
}

/** Content may lift a spell's lock ("magic:spell-unlocked", a league relic), as for the other locked spells. */
function unlockedByContent(player, spellId) {
  const unlock = { player, spellId, unlocked: false };
  pluginApi.emitCustomEvent("magic:spell-unlocked", unlock);
  return unlock.unlocked === true;
}

function lockArceuusSpell(event) {
  if (!event.player || event.spellbook !== core.MagicSpellbook.ARCEUUS) return;
  if (pluginApi.getPluginConfig(REQUIREMENTS_CONFIG, true) === false) return;
  const spellId = Number(event.spellId);
  if (!(spellId > 0)) return;
  const name = core.CacheDefinitions.getSpellName(-1, spellId)?.trim().toLowerCase();
  if (!name || OPEN_SPELLS.has(name) || name.endsWith(" teleport")) return;
  if (questComplete(event.player) || unlockedByContent(event.player, spellId)) return;
  event.disabled = true;
  event.player.sendMessage(REFUSAL);
}

module.exports = {
  name: "ArceuusQuestLock",
  description: "Blocks the Arceuus combat and utility spells until A Kingdom Divided is done, except Ghostly Grasp, Inferior Demonbane, teleports and reanimation.",
  register(api) {
    pluginApi = api;
    core = api.core;
    api.onSpellDisabled(lockArceuusSpell);
  },
  _test: { lockArceuusSpell, OPEN_SPELLS, REFUSAL },
};
