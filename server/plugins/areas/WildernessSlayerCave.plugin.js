/**
 * The Wilderness Slayer Cave's task-only monsters.
 *
 * Wiki (Wilderness Slayer Cave, citing Mod Ash, 16 March 2022): abyssal demons, nechryaels, dust
 * devils and jellies can only be killed while on a Slayer task. Peeve (11237), a ghost roaming the
 * cave, stops anyone else; Transcript:Peeve has the two lines, by whether Peeve is understood. No
 * rsprox capture shows the refusal, so it is a plain game message here.
 *
 * Keyed on the cave's own NPC ids rather than registered as an Area: the cave is in the
 * Wilderness, and a tile belongs to one area.
 */

const TASK_ONLY_NAMES = Object.freeze([
  "ABYSSAL_DEMON", // 11239
  "DUST_DEVIL_3", // 11238
  "GREATER_NECHRYAEL_2", // 11240
  "JELLY_8", "JELLY_9", "JELLY_10", "JELLY_11", "JELLY_12", // 11241-11245
]);
const ON_TASK_EVENT = "slayer:on-task";
const REFUSAL = "Peeve: Sneaky one! Don't touch these unless you have a Slayer task to kill them.";
const GHOSTLY_REFUSAL = "Peeve: wooooo ooo woo-woo";

let api = null;
let taskOnlyIds = new Set();

/** Whether the player's Slayer task (or content counting every Slayer monster) covers this NPC. */
function onTask(player, npc) {
  const request = { player, npc, onTask: false };
  api.emitCustomEvent(ON_TASK_EVENT, request);
  return request.onTask === true;
}

function wearsGhostspeak(player) {
  const { Equipment, ItemIdentifiers: I } = api.core;
  const equipment = player.getEquipment?.();
  const amulet = equipment?.get?.(Equipment.AMULET_SLOT)?.getId?.();
  const legs = equipment?.get?.(Equipment.LEG_SLOT)?.getId?.();
  // Wiki (Ghostspeak amulet): worn Morytania legs 2 or better replace the amulet here.
  return amulet === I.GHOSTSPEAK_AMULET || amulet === I.GHOSTSPEAK_AMULET_2
    || [I.MORYTANIA_LEGS_2, I.MORYTANIA_LEGS_3, I.MORYTANIA_LEGS_4].includes(legs);
}

/** Refuses a player's attack on a task-only cave monster they have no task for. */
function refuseOffTask(event) {
  const { attacker, target } = event;
  if (!target?.isNpc?.() || !taskOnlyIds.has(target.getId()) || !attacker?.isPlayer?.()) return;
  const player = attacker.getAsPlayer?.() ?? attacker;
  if (onTask(player, target)) return;
  event.allow = false;
  // Hitting back at one that is still attacking them is not the player's own attempt: no line.
  if (player.getCombat?.()?.isAutoRetaliating?.()) return;
  event.message = wearsGhostspeak(player) ? REFUSAL : GHOSTLY_REFUSAL;
}

function attach(pluginApi) {
  api = pluginApi;
  taskOnlyIds = new Set(TASK_ONLY_NAMES.map((name) => pluginApi.core.NpcIdentifiers[name]));
  pluginApi.onCanAttack(refuseOffTask);
}

module.exports = {
  name: "WildernessSlayerCave",
  description: "Only a matching Slayer task lets a player attack the Wilderness Slayer Cave's abyssal demons, dust devils, Greater Nechryaels and jellies; Peeve refuses everyone else.",
  members: true,
  register(pluginApi) {
    attach(pluginApi);
  },
  _test: { attach, refuseOffTask, TASK_ONLY_NAMES, REFUSAL, GHOSTLY_REFUSAL },
};
