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
  const { Equipment, ItemIdentifiers: I } = api.core;
  const equipment = player.getEquipment?.();
  const amulet = equipment?.get?.(Equipment.AMULET_SLOT)?.getId?.();
  const legs = equipment?.get?.(Equipment.LEG_SLOT)?.getId?.();
  // Wiki (Ghostspeak amulet): worn Morytania legs 2 or better replace the amulet here.
  return amulet === I.GHOSTSPEAK_AMULET || amulet === I.GHOSTSPEAK_AMULET_2
    || [I.MORYTANIA_LEGS_2, I.MORYTANIA_LEGS_3, I.MORYTANIA_LEGS_4].includes(legs);
}

/** Buggie's refusal: the game message, then his line (Wiki: Entomologist; Transcript:Entomologist). */
function refuse(player) {
  player.sendMessage(BUGGIE_MESSAGE);
  const variant = wearsGhostspeak(player) ? BUGGIE_VARIANTS.understood : BUGGIE_VARIANTS.ghostly;
  api.emitCustomEvent(DIALOGUE_EVENT, {
    player, npcId: api.core.NpcIdentifiers.ENTOMOLOGIST, variant, exact: true, handled: false,
  });
}

/**
 * Buggie's corpse. rsprox 2922 (rev 230) records the live search: the diary comes out in an
 * objectbox (193) beside the line below, `+slayer_cave_diary`, and varbit `slayer_found_diary`
 * goes 0 -> 1. The Wiki (Entomologist's diary) adds that it is "reclaimed by searching Buggie",
 * which is the only source in the game. The refusal lines are not in that capture, so those two
 * stay derived. The POH bookcase follows on its own: the diary is slot 68 of the 5210 book enum,
 * and Bookcase.Construction records every book the player acquires.
 */
const ENTOMOLOGIST_DIARY_GAMEVAL = "slayer_cave_diary";
const DIARY_FOUND_VARBIT_GAMEVAL = "slayer_found_diary";
/** rsprox 2922, the objectbox line verbatim. */
const DIARY_FOUND_TEXT = "You search the corpse and find a book.";
const DIARY_ALREADY_HELD = "You have already taken his diary.";
const DIARY_NO_SPACE = "You need more inventory space to take his diary.";
/** The recorded varbit is a client flag only; the durable copy is this attribute (restored on login). */
const DIARY_FOUND_ATTRIBUTE = "kalphite-cave:found-diary";

/** Already holding a copy, in the inventory or the bank — searching again must not duplicate it. */
function holdsDiary(player, diaryId) {
  if (player.getInventory().getAmount(diaryId) > 0) return true;
  return (player.getBanks?.() ?? []).some((bank) => (bank?.getAmount?.(diaryId) ?? 0) > 0);
}

/** The objectbox (193) with an item beside its text, as live shows the diary (rsprox 2922). */
function objectBox(player, itemId, text) {
  const { DialogueChainBuilder, ItemStatementDialogue } = api.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text)));
}

/** Search on the Entomologist: hand over the diary once, and say why when it cannot be taken. */
function searchBuggie({ player }) {
  const { CacheDefinitions } = api.core;
  const diaryId = CacheDefinitions.getObjId(ENTOMOLOGIST_DIARY_GAMEVAL);
  if (diaryId == null) return;
  const inventory = player.getInventory();
  if (holdsDiary(player, diaryId)) {
    player.sendMessage(DIARY_ALREADY_HELD);
    return;
  }
  if (inventory.getFreeSlots() < 1) {
    player.sendMessage(DIARY_NO_SPACE);
    return;
  }
  inventory.adds(diaryId, 1);
  player.setAttribute(DIARY_FOUND_ATTRIBUTE, 1);
  const foundVarbit = CacheDefinitions.getVarbitId(DIARY_FOUND_VARBIT_GAMEVAL);
  if (foundVarbit != null) player.getPacketSender().sendVarbit(foundVarbit, 1);
  objectBox(player, diaryId, DIARY_FOUND_TEXT);
}

/** Login: a player who has already found the diary gets the recorded varbit back. */
function restoreFoundDiary({ player }) {
  if (!player.getAttribute?.(DIARY_FOUND_ATTRIBUTE)) return;
  const foundVarbit = api.core.CacheDefinitions.getVarbitId(DIARY_FOUND_VARBIT_GAMEVAL);
  if (foundVarbit != null) player.getPacketSender().sendVarbit(foundVarbit, 1);
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
  // Wiki (Entomologist's diary): the diary is reclaimed by searching Buggie, his only Search option.
  pluginApi.persistAttribute(DIARY_FOUND_ATTRIBUTE, 0);
  pluginApi.onNpcInteraction("Entomologist", { Search: searchBuggie });
  pluginApi.onPlayerLogin(restoreFoundDiary);
}

module.exports = {
  name: "KalphiteCave",
  description: "Makes the Kalphite Cave multi-combat and lets only players on a kalphite Slayer task attack its kalphites, with Buggie warning the rest off.",
  members: true,
  register(pluginApi) {
    registerCave(pluginApi);
  },
  _test: { createCave, refuse, onTask, wearsGhostspeak, CAVE, BUGGIE_MESSAGE, BUGGIE_VARIANTS, searchBuggie, holdsDiary, DIARY_FOUND_TEXT, DIARY_ALREADY_HELD, DIARY_NO_SPACE },
};
