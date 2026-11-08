/**
 * The Wyvern Cave on Fossil Island (https://oldschool.runescape.wiki/w/Wyvern_Cave): the
 * northern, task-only cave is guarded by Weve, who stops anyone without a Fossil Island wyvern
 * Slayer task from attacking its wyverns (live: rsprox 3038 and 3040, rev 231; docs/wyvern-cave.md).
 * The southern cave has no guard, so only the northern one is an Area.
 */
const WEVE_MESSAGE = "Weve wants you to stick to your Slayer assignments.";
const WEVE_LINE = "Hey! Leave them alone! My dad Steve will beat you up unless a Slayer Master has given you special permission.";
const WEVE_NAME = "Weve";
/** The four Fossil Island wyverns the "Fossil Island Wyverns" task covers. */
const WYVERN_NAMES = new Set(["Spitting Wyvern", "Taloned Wyvern", "Long-tailed Wyvern", "Ancient Wyvern"]);
/**
 * The northern cave, from the walkable tiles of the cache's map: x 3581-3653, y 10246-10312.
 * Its south-west edge dips to y 10235 beside the southern cave's east lobe, which this rectangle
 * leaves out; the wyverns stand in the rectangle, and an attack is asked of the target's area too.
 */
const NORTH_CAVE = [3580, 3656, 10246, 10312];
const ON_TASK_EVENT = "slayer:on-task";
const WEVE_EXPRESSION = "chatang3"; // cache seq of his chat head animation (captured)

let api = null;

function wyvernName(npc) {
  return (npc.getCurrentDefinition?.() ?? npc.getDefinition?.())?.getName?.() ?? "";
}

/** Whether the player's Slayer task (or content counting every Slayer monster) covers this wyvern. */
function onTask(player, npc) {
  const request = { player, npc, onTask: false };
  api.emitCustomEvent(ON_TASK_EVENT, request);
  return request.onTask === true;
}

/** Weve's refusal: the game message, then his line over his chat head (captured, one tick together). */
function refuse(player) {
  const { DialogueChainBuilder, NpcDialogue, NpcIdentifiers, CacheDefinitions } = api.core;
  player.sendMessage(WEVE_MESSAGE);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, NpcIdentifiers.WEVE, WEVE_LINE, WEVE_NAME, CacheDefinitions.getSeqId(WEVE_EXPRESSION))));
}

function createNorthCave(pluginApi) {
  const { Area, Boundary } = pluginApi.core;
  class NorthWyvernCave extends Area {
    canAttack(attacker, target) {
      if (!attacker?.isPlayer?.() || !target?.isNpc?.() || !WYVERN_NAMES.has(wyvernName(target))) return null;
      const player = attacker.getAsPlayer?.() ?? attacker;
      if (onTask(player, target)) return null;
      // Only the player's own pending attack is refused aloud: canAttack is also a permission probe
      // (minions, target scans, the dwarf cannon, the agent MCP) and a probe must stay silent.
      // Live (rsprox 3038): wyverns that attack a player Weve has stopped add no further lines.
      const combat = player.getCombat?.();
      if (combat?.getTarget?.() === target && !combat.isAutoRetaliating?.()) refuse(player);
      return false;
    }
  }
  return new NorthWyvernCave([new Boundary(...NORTH_CAVE, 0)]);
}

function registerNorthCave(pluginApi) {
  api = pluginApi;
  pluginApi.registerArea(createNorthCave(pluginApi));
}

module.exports = {
  name: "WyvernCave",
  description: "Stops anyone without a Fossil Island wyvern Slayer task from attacking the wyverns in the northern Wyvern Cave, with Weve warning them off.",
  members: true,
  register(pluginApi) {
    registerNorthCave(pluginApi);
  },
  _test: { createNorthCave, refuse, onTask, NORTH_CAVE, WEVE_MESSAGE, WEVE_LINE },
};
