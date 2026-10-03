/**
 * Dwarf Cannon (members).
 *
 * The words come from the "Dwarf Cannon" transcript page. Captain Lawgof and
 * Nulodion are indexed, so this plugin supplies the by-stage variant selector, the
 * prose-condition answers, the start hook (railings + hammer), and the completion
 * action on "talking-to-lawgof-after-getting-the-ammo-mould". Lollk is indexed only
 * for the crate transcript, replayed on talk.
 *
 * Stage machine (varp 0, ported from xrsps): 1 railings, 2 watchtower, 3 find cave,
 * 4 find Lollk, 5 return to Lawgof, 6 repair cannon, 8 cannon repaired, 9 speak to
 * Nulodion, 10 return notes, 11 complete. The six-rail and three-mechanism repair
 * counters (xrsps varp 1) are not persisted here.
 *
 * Gaps (no dump/index/object support): the railing repair, watchtower ladders and
 * dwarf remains, the goblin cave/crate rescue, the multicannon inspection/repair,
 * Nulodion's door and his cannon sale are object interactions the transcript dump
 * cannot verify; the railing stage advances straight to the watchtower on talk.
 */
module.exports = function registerDwarfCannonQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Dwarf Cannon";
  const LAWGOF_PAGE = "Captain Lawgof";

  const VARP_DWARF_CANNON = 0;

  const STAGE_REPAIR_RAILINGS = 1;
  const STAGE_CHECK_WATCHTOWER = 2;
  const STAGE_FIND_CAVE = 3;
  const STAGE_FIND_LOLLK = 4;
  const STAGE_RETURN_TO_LAWGOF = 5;
  const STAGE_REPAIR_CANNON = 6;
  const STAGE_INSPECTED_CANNON = 7;
  const STAGE_CANNON_REPAIRED = 8;
  const STAGE_SPEAK_TO_NULODION = 9;
  const STAGE_RETURN_NOTES = 10;
  const STAGE_COMPLETE = 11;

  const START_HOOK = "quest:dwarf-cannon:start";
  /** "Congratulations! Quest complete!" in talking-to-lawgof-after-getting-the-ammo-mould. */
  const COMPLETE_ACTION_ID = "c8LrCL";

  const page = (p, variant) => ({ page: p, variant });
  const has = (player, itemId, quantity = 1) => player.getInventory().getAmount(itemId) >= quantity;

  let quest;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped Captain Lawgof defend his outpost.</str>",
        "<str>I can use dwarf multicannons and make cannonballs.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_RETURN_NOTES) return ["I have Nulodion's notes and ammo mould.", "I should return to <col=800000>Captain Lawgof</col>."];
    if (stage >= STAGE_SPEAK_TO_NULODION) return ["I should speak to <col=800000>Nulodion</col> at the", "dwarven mine entrance south of Ice Mountain."];
    if (stage >= STAGE_CANNON_REPAIRED) return ["The multicannon is repaired.", "I should report to <col=800000>Captain Lawgof</col>."];
    if (stage >= STAGE_INSPECTED_CANNON || stage >= STAGE_REPAIR_CANNON) return ["I should use the <col=800000>toolkit</col> on the broken cannon."];
    if (stage >= STAGE_RETURN_TO_LAWGOF) return ["I found Lollk alive in the goblin cave.", "I should return to <col=800000>Captain Lawgof</col>."];
    if (stage >= STAGE_FIND_LOLLK) return ["The goblins took Lollk.", "I should search the <col=800000>crates</col> inside their cave."];
    if (stage >= STAGE_FIND_CAVE) return ["The remains belonged to Gilob, but Lollk may live.", "I should find the <col=800000>goblin cave</col> to the south-east."];
    if (stage >= STAGE_CHECK_WATCHTOWER) return ["I should climb the southern watchtower", "and investigate why it has gone quiet."];
    if (stage >= STAGE_REPAIR_RAILINGS) return ["Captain Lawgof gave me replacement rails and a hammer.", "I should repair the broken railings."];
    return ["Speak to <col=800000>Captain Lawgof</col> at the Coal Trucks,", "north-west of the Fishing Guild."];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 750);
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (npcId === NpcIdentifiers.CAPTAIN_LAWGOF) {
      if (stage >= STAGE_COMPLETE) return page(LAWGOF_PAGE, "after-completing-dwarf-cannon");
      if (stage >= STAGE_RETURN_NOTES) return page(PAGE, "talking-to-lawgof-after-getting-the-ammo-mould");
      if (stage >= STAGE_SPEAK_TO_NULODION) return page(PAGE, "fixing-the-cannon-talking-to-captain-lawgof-after-fixing-the-cannon-talking-to-captain-lawgof-again-after-agreeing-to-see-nulodion");
      if (stage >= STAGE_CANNON_REPAIRED) return page(PAGE, "fixing-the-cannon-talking-to-captain-lawgof-after-fixing-the-cannon");
      if (stage >= STAGE_REPAIR_CANNON) return page(PAGE, "fixing-the-cannon-talking-to-captain-lawgof-before-fixing-the-cannon");
      if (stage >= STAGE_RETURN_TO_LAWGOF) return page(PAGE, "the-dwarf-child-talking-to-captain-lawgof-after-finding-lollk");
      if (stage >= STAGE_FIND_CAVE) return page(PAGE, "finding-the-remains-talking-to-captain-lawgof-after-getting-the-remains");
      if (stage >= STAGE_CHECK_WATCHTOWER) return page(PAGE, "fixing-the-railings-talking-to-captain-lawgof-after-fixing-the-railings");
      if (stage >= STAGE_REPAIR_RAILINGS) return page(PAGE, "fixing-the-railings-talking-to-captain-lawgof-before-fixing-the-railings");
      return page(PAGE, "captain-lawgof");
    }

    if (npcId === NpcIdentifiers.NULODION) {
      if (stage >= STAGE_RETURN_NOTES) return page(PAGE, "fixing-the-cannon-talking-to-nulodion-again");
      if (stage === STAGE_SPEAK_TO_NULODION) return page(PAGE, "fixing-the-cannon-talking-to-nulodion");
      return null;
    }

    if (npcId === NpcIdentifiers.LOLLK && stage === STAGE_FIND_LOLLK) {
      return page(PAGE, "the-dwarf-child-searching-the-crate-containing-lollk");
    }

    return null;
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("does not have a hammer")) return !has(player, ItemIdentifiers.HAMMER);
    if (value.includes("does not have a railing")) return !has(player, ItemIdentifiers.RAILING);
    if (value.includes("player has no railings")) return !has(player, ItemIdentifiers.RAILING);
    if (value.includes("player has at least 1 railing")) return has(player, ItemIdentifiers.RAILING);
    if (value.includes("player has no inventory space")) return player.getInventory().isFull();
    if (value.includes("player already has the remains")) return has(player, ItemIdentifiers.DWARF_REMAINS);
    if (value.includes("player lost the toolkit")) return !has(player, ItemIdentifiers.TOOLKIT);
    if (value.includes("player lost the notes")) return !has(player, ItemIdentifiers.NULODIONS_NOTES);
    if (value.includes("player lost the ammo mould")) return !has(player, ItemIdentifiers.AMMO_MOULD);
    if (value.includes("player does not have the notes and ammo mould")) {
      return !has(player, ItemIdentifiers.NULODIONS_NOTES) || !has(player, ItemIdentifiers.AMMO_MOULD);
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== NpcIdentifiers.CAPTAIN_LAWGOF || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_REPAIR_RAILINGS) return;
    const inventory = player.getInventory();
    if (inventory.getAmount(ItemIdentifiers.RAILING) < 6) inventory.adds(ItemIdentifiers.RAILING, 6);
    if (inventory.getAmount(ItemIdentifiers.HAMMER) < 1) inventory.adds(ItemIdentifiers.HAMMER, 1);
    quest.setStage(player, STAGE_REPAIR_RAILINGS);
  }

  function handleAction({ player, npcId, stepId }) {
    if (npcId !== NpcIdentifiers.CAPTAIN_LAWGOF || stepId !== COMPLETE_ACTION_ID) return;
    if (quest.getStage(player) < STAGE_RETURN_NOTES || quest.isComplete(player)) return;
    if (has(player, ItemIdentifiers.NULODIONS_NOTES)) player.getInventory().deleteNumber(ItemIdentifiers.NULODIONS_NOTES, 1);
    quest.complete(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "dwarf_cannon",
    name: "Dwarf Cannon",
    varpId: VARP_DWARF_CANNON,
    startedValue: STAGE_REPAIR_RAILINGS,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.CRAFTING.getIndex(), amount: 750, label: "Crafting" }],
    rewardItemId: ItemIdentifiers.AMMO_MOULD,
    rewardItemLabel: "An ammo mould",
    otherRewards: ["Ability to use dwarf multicannons", "Ability to make cannonballs", "Black Guard membership"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onPlayerLogin(handleLogin);
};
