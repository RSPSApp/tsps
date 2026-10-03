/**
 * Scorpion Catcher (members).
 *
 * The words come from the "Scorpion Catcher" transcript page:
 *   Thormac (5232): starting-off-* -> finishing-up (complete)
 *   Seer    (5231): first-scorpion-* -> second-and-third-scorpions-*
 *
 * This plugin supplies the variant selector for Thormac and the Seer, the start
 * hook, the prose-condition answers, the cage-on-scorpion catching and the
 * completion action. Peksa (2872) and the Kharid scorpions are not in the
 * dialogue index, so they are replayed from interactions.
 *
 * Gaps (no dump/index support): the scorpion NPC spawns and the secret wall at
 * 2117 are not indexed for this quest, so catching is driven by the cage-on-npc
 * handler and the wall only teleports once the first hint is known. The three
 * scorpions are not spawned by this plugin (ordinary Kharid scorpion ids).
 */
module.exports = function registerScorpionCatcherQuest(api) {
  const { Skill, Location, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, startTranscript, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Scorpion Catcher";

  const THORMAC_NPC_ID = NpcIdentifiers.THORMAC;
  const SEER_NPC_ID = NpcIdentifiers.SEER;
  const PEKSA_NPC_ID = NpcIdentifiers.PEKSA;
  const SECRET_WALL_ID = ObjectIdentifiers.OLD_WALL;

  const FIRST_SCORPION_NPC_ID = NpcIdentifiers.KHARID_SCORPION;
  const SECOND_SCORPION_NPC_ID = NpcIdentifiers.KHARID_SCORPION_2;
  const THIRD_SCORPION_NPC_ID = NpcIdentifiers.KHARID_SCORPION_3;

  const VARP_SCORPION_CATCHER = 76;
  const STAGE_STARTED = 1;
  const STAGE_FIRST_HINT = 2;
  const STAGE_SECOND_HINT = 3;
  const STAGE_COMPLETE = 4;

  const EMPTY_CAGE = ItemIdentifiers.SCORPION_CAGE;
  const FULL_CAGE = ItemIdentifiers.SCORPION_CAGE_8;

  /** cage item -> which scorpions it holds (bit 1 first, 2 second, 4 third). */
  const CAGE_MASK_BY_ITEM = new Map([
    [ItemIdentifiers.SCORPION_CAGE, 0],
    [ItemIdentifiers.SCORPION_CAGE_2, 1],
    [ItemIdentifiers.SCORPION_CAGE_5, 2],
    [ItemIdentifiers.SCORPION_CAGE_7, 4],
    [ItemIdentifiers.SCORPION_CAGE_3, 3],
    [ItemIdentifiers.SCORPION_CAGE_4, 5],
    [ItemIdentifiers.SCORPION_CAGE_6, 6],
    [ItemIdentifiers.SCORPION_CAGE_8, 7],
  ]);
  const CAGE_ITEM_BY_MASK = new Map(
    [...CAGE_MASK_BY_ITEM].map(([itemId, mask]) => [mask, itemId])
  );
  const CAGE_ITEM_IDS = [...CAGE_MASK_BY_ITEM.keys()];

  const SCORPION_BIT_BY_NPC = new Map([
    [FIRST_SCORPION_NPC_ID, 1],
    [SECOND_SCORPION_NPC_ID, 2],
    [THIRD_SCORPION_NPC_ID, 4],
  ]);

  const START_HOOK = "quest:scorpion-catcher:start";
  /** "finishing-up" ends with this action. */
  const COMPLETE_ACTION_ID = "QeBozC";

  let quest;

  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const ownsAnyCage = (player) => CAGE_ITEM_IDS.some((itemId) => has(player, itemId));
  const ownsFullCage = (player) => has(player, FULL_CAGE);
  const prayerLevel = (player) => player.getSkillManager().getCurrentLevel(Skill.PRAYER);

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I returned all three Kharid scorpions to Thormac.</str>",
        "<str>He can now enchant battlestaves for me.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage === 0) {
      return [
        "I can start this quest by speaking to <col=800000>Thormac</col>",
        "in the <col=800000>Sorcerer's Tower</col> south-west of Catherby.",
        "",
        "I need level 31 <col=800000>Prayer</col>.",
      ];
    }
    const lines = ["<str>Thormac asked me to recover his three Kharid scorpions.</str>", ""];
    if (stage === STAGE_STARTED) {
      return [...lines, "I should ask a <col=800000>Seer</col> where the scorpions escaped to."];
    }
    const hasFirst = [ItemIdentifiers.SCORPION_CAGE_2, ItemIdentifiers.SCORPION_CAGE_3, ItemIdentifiers.SCORPION_CAGE_4, FULL_CAGE].some((id) => has(player, id));
    const hasSecond = [ItemIdentifiers.SCORPION_CAGE_5, ItemIdentifiers.SCORPION_CAGE_3, ItemIdentifiers.SCORPION_CAGE_6, FULL_CAGE].some((id) => has(player, id));
    const hasThird = [ItemIdentifiers.SCORPION_CAGE_7, ItemIdentifiers.SCORPION_CAGE_4, ItemIdentifiers.SCORPION_CAGE_6, FULL_CAGE].some((id) => has(player, id));
    if (stage >= STAGE_FIRST_HINT) {
      lines.push(
        hasFirst
          ? "<str>I caught the scorpion in the secret room near spiders and coffins.</str>"
          : "One scorpion is in a <col=800000>secret room</col> near spiders and two coffins."
      );
    }
    if (stage >= STAGE_SECOND_HINT) {
      lines.push(
        hasSecond
          ? "<str>I caught the scorpion hidden at the Barbarian Outpost.</str>"
          : "One scorpion was taken to the <col=800000>Barbarian Outpost</col>.",
        hasThird
          ? "<str>I caught the scorpion upstairs in the Edgeville Monastery.</str>"
          : "One scorpion is upstairs by brown robes in the <col=800000>Monastery</col>."
      );
    }
    if (hasFirst && hasSecond && hasThird) {
      lines.push("", "I should take the full cage back to <col=800000>Thormac</col>.");
    }
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.STRENGTH, 6625);
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === THORMAC_NPC_ID) {
      if (stage >= STAGE_STARTED && stage < STAGE_COMPLETE && ownsFullCage(player)) {
        return "finishing-up";
      }
      if (stage === 0) {
        return prayerLevel(player) >= 31
          ? "starting-off-with-the-requirements"
          : "starting-off-without-the-requirements";
      }
      return "starting-off-subsequent-dialogue";
    }
    if (npcId === SEER_NPC_ID) {
      if (stage === STAGE_STARTED) return "first-scorpion-help-from-a-seer";
      if (stage === STAGE_FIRST_HINT) {
        return has(player, ItemIdentifiers.SCORPION_CAGE_2) ||
          has(player, ItemIdentifiers.SCORPION_CAGE_3) ||
          has(player, ItemIdentifiers.SCORPION_CAGE_4) ||
          ownsFullCage(player)
          ? "second-and-third-scorpions-more-help-from-a-seer"
          : "first-scorpion-subsequent-dialogue";
      }
      if (stage === STAGE_SECOND_HINT) return "second-and-third-scorpions-more-help-from-a-seer";
      return "first-scorpion-subsequent-dialogue";
    }
    return null;
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("full inventory")) return false;
    void player;
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== THORMAC_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) {
      if (!ownsAnyCage(player)) player.getInventory().adds(EMPTY_CAGE, 1);
      quest.setStage(player, STAGE_STARTED);
    }
  }

  function handleAction({ player, npcId, stepId }) {
    if (npcId !== THORMAC_NPC_ID || stepId !== COMPLETE_ACTION_ID) return;
    if (quest.isComplete(player)) return;
    if (!ownsFullCage(player)) return;
    player.getInventory().deleteNumber(FULL_CAGE, 1);
    quest.complete(player);
  }

  /** Peksa is not indexed, so replay his "brotherly love" variant. */
  function handlePeksa(event) {
    const { player, npcId } = event;
    if (npcId !== PEKSA_NPC_ID) return;
    if (quest.getStage(player) < STAGE_SECOND_HINT) return;
    event.handled = true;
    startTranscript(api, player, npcId, PAGE, "second-and-third-scorpions-brotherly-love");
  }

  /** Trying to pick a scorpion up only stings; the cage is the way to catch it. */
  function handleScorpionInteraction(event) {
    const { player, npcId } = event;
    if (!SCORPION_BIT_BY_NPC.has(npcId)) return;
    event.handled = true;
    if (quest.getStage(player) < requiredStageForScorpion(npcId)) {
      player.sendMessage("The scorpion stings you!");
      return;
    }
    player.sendMessage("You need to use your cage on the scorpion.");
  }

  function requiredStageForScorpion(npcId) {
    return npcId === FIRST_SCORPION_NPC_ID ? STAGE_FIRST_HINT : STAGE_SECOND_HINT;
  }

  function onCageOnScorpion(event) {
    const scorpionBit = SCORPION_BIT_BY_NPC.get(event.target?.getId?.());
    if (scorpionBit === undefined) return;
    const currentMask = CAGE_MASK_BY_ITEM.get(event.itemId);
    if (currentMask === undefined) return;
    const { player } = event;
    if (quest.getStage(player) < requiredStageForScorpion(npcId)) {
      player.sendMessage("You do not know where this scorpion belongs.");
      return;
    }
    if ((currentMask & scorpionBit) !== 0) {
      player.sendMessage("You've already caught this scorpion.");
      return;
    }
    const nextItemId = CAGE_ITEM_BY_MASK.get(currentMask | scorpionBit);
    if (nextItemId === undefined) return;
    player.getInventory().deleteNumber(event.itemId, 1);
    player.getInventory().adds(nextItemId, 1);
    player.sendMessage("You catch a scorpion!");
  }

  /** The secret room wall by the spiders opens once the first hint is known. */
  function handleSecretWall(event) {
    if (event.objectId !== SECRET_WALL_ID) return;
    const { player } = event;
    if (quest.getStage(player) < STAGE_FIRST_HINT) {
      player.sendMessage("It looks like an ordinary wall.");
      event.handled = true;
      return;
    }
    const x = player.getLocation().getX();
    const targetX = x < event.location.x ? event.location.x + 1 : event.location.x - 1;
    player.moveTo(new Location(targetX, event.location.y, event.location.z ?? 0));
    player.sendMessage("You've found a secret door.");
    event.handled = true;
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "scorpion_catcher",
    name: "Scorpion Catcher",
    varpId: VARP_SCORPION_CATCHER,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.STRENGTH.getIndex(), amount: 6625, label: "Strength" }],
    rewardItemId: FULL_CAGE,
    rewardItemLabel: "A scorpion cage",
    otherRewards: ["Thormac can convert battlestaves into mystic staves"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onNpcInteraction(handlePeksa);
  api.onNpcInteraction(handleScorpionInteraction);
  api.onItemOnNpc(onCageOnScorpion);
  api.onObjectInteraction(handleSecretWall);
  api.onPlayerLogin(handleLogin);
};
