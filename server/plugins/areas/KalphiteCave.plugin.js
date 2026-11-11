/**
 * The Kalphite Cave east of the Shantay Pass (https://oldschool.runescape.wiki/w/Kalphite_Cave;
 * docs/kalphite-cave.md). Its kalphites "can only be killed while on a Slayer task": the
 * Entomologist (Buggie) stops anyone else from attacking them, with his transcript line and the
 * game message `Buggie wants you to stick to your Slayer assignments.` (Wiki: Entomologist).
 * The cave is multi-combat (rsprox 2922: the multi icon on entering).
 */
const BUGGIE_MESSAGE = "Buggie wants you to stick to your Slayer assignments.";
/** Transcript:Entomologist, one variant per ghostspeak amulet worn or not. */
const BUGGIE_VARIANTS = Object.freeze({
  understood: "attempting-to-attack-a-kalphite-in-the-kalphite-cave-while-not-on-task-while-wearing-a-ghostspeak-amulet",
  ghostly: "attempting-to-attack-a-kalphite-in-the-kalphite-cave-while-not-on-task-without-wearing-a-ghostspeak-amulet",
});
/**
 * The cave, from the walkable tiles of the cache's map reached from the entrance's landing
 * (3305, 9497): x 3267-3340, y 9474-9542. Every one of the cave's 43 kalphite spawns stands in it,
 * the Desert Mining Camp's tunnels (y 9469 and south) and the Elid cave (x 3347) don't.
 */
const CAVE = Object.freeze([3267, 3340, 9474, 9542]);
const ON_TASK_EVENT = "slayer:on-task";
const DIALOGUE_EVENT = "npc-dialogue:start";

let api = null;

/** Whether the player's Slayer task (or content counting every Slayer monster) covers this NPC. */
function onTask(player, npc) {
  const request = { player, npc, onTask: false };
  api.emitCustomEvent(ON_TASK_EVENT, request);
  return request.onTask === true;
}

function wearsGhostspeak(player) {
  const { Equipment, ItemIdentifiers } = api.core;
  const amulet = player.getEquipment?.()?.get?.(Equipment.AMULET_SLOT)?.getId?.();
  return amulet === ItemIdentifiers.GHOSTSPEAK_AMULET || amulet === ItemIdentifiers.GHOSTSPEAK_AMULET_2;
}

/** Buggie's refusal: the game message, then his line (Wiki: Entomologist; Transcript:Entomologist). */
function refuse(player) {
  player.sendMessage(BUGGIE_MESSAGE);
  const variant = wearsGhostspeak(player) ? BUGGIE_VARIANTS.understood : BUGGIE_VARIANTS.ghostly;
  api.emitCustomEvent(DIALOGUE_EVENT, {
    player, npcId: api.core.NpcIdentifiers.ENTOMOLOGIST, variant, exact: true, handled: false,
  });
}

function createCave(pluginApi) {
  const { Area, Boundary } = pluginApi.core;
  class KalphiteCave extends Area {
    getName() {
      return "Kalphite Cave";
    }

    isMulti() {
      return true;
    }

    canAttack(attacker, target) {
      if (!attacker?.isPlayer?.() || !target?.isNpc?.()) return null;
      const player = attacker.getAsPlayer?.() ?? attacker;
      if (onTask(player, target)) return null;
      // Only the player's own pending attack is refused aloud: canAttack is also a permission probe
      // (minions, target scans, the dwarf cannon, the agent MCP) and a probe must stay silent, and
      // a kalphite attacking a player Buggie stopped must not repeat his line on every hit.
      const combat = player.getCombat?.();
      if (combat?.getTarget?.() === target && !combat.isAutoRetaliating?.()) refuse(player);
      return false;
    }
  }
  return new KalphiteCave([new Boundary(...CAVE, 0)]);
}

function registerCave(pluginApi) {
  api = pluginApi;
  pluginApi.registerArea(createCave(pluginApi));
}

module.exports = {
  name: "KalphiteCave",
  description: "Makes the Kalphite Cave multi-combat and lets only players on a kalphite Slayer task attack its kalphites, with Buggie warning the rest off.",
  members: true,
  register(pluginApi) {
    registerCave(pluginApi);
  },
  _test: { createCave, refuse, onTask, wearsGhostspeak, CAVE, BUGGIE_MESSAGE, BUGGIE_VARIANTS },
};
