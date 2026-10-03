/**
 * Hazeel Cult (members).
 *
 * The words come from the "Hazeel Cult" transcript page. This plugin supplies the
 * variant selector for Ceril, Clivet, Alomone, Butler Jones, the mansion guard,
 * Henryeta and the cultists; the start hook; the side choice; the prose-condition
 * answers; the poison-on-range, evidence cupboard and Alomone death; the sewer
 * valves / raft; and the two completion actions.
 *
 * Stages (varp 223): 2 started, 3 spoke to Clivet, 4 chose a side, 5 poisoned the
 * food, 6 finished the side task, 7 returned the armour / found the scroll,
 * 9 complete. The chosen side is kept in a player attribute (0 Carnillean,
 * 1 Hazeel); the wiki's 225 varp is not read by this runtime.
 *
 * Gaps (no dump/index support): the secret wall (2854/2855) has no ObjectIdentifier,
 * and the scroll chest ids 2856/2857 are unnamed, so the Hazeel-side scroll cannot
 * be obtained here (only the 46710-46712 chest ids are named); the Alomone death
 * does not drop the Carnillean armour on the ground; the crate (2858) and cave
 * entrance/stairs travel are not wired.
 */
module.exports = function registerHazeelCultQuest(api) {
  const { Skill, Location, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const CERIL_IDS = new Set([NpcIdentifiers.CERIL_CARNILLEAN]);
  const CLIVET_IDS = new Set([NpcIdentifiers.CLIVET, NpcIdentifiers.CLIVET_2]);
  const ALOMONE_IDS = new Set([
    NpcIdentifiers.ALOMONE,
    NpcIdentifiers.ALOMONE_2,
    NpcIdentifiers.ALOMONE_3,
  ]);
  const JONES_IDS = new Set([NpcIdentifiers.BUTLER_JONES]);
  const GUARD_IDS = new Set([
    NpcIdentifiers.GUARD_180,
    NpcIdentifiers.GUARD_181,
    NpcIdentifiers.GUARD_182,
  ]);
  const HENRYETA_IDS = new Set([NpcIdentifiers.HENRYETA_CARNILLEAN_2]);
  const CULTIST_IDS = new Set([
    NpcIdentifiers.HAZEEL_CULTIST_2,
    NpcIdentifiers.HAZEEL_CULTIST_3,
    NpcIdentifiers.HAZEEL_CULTIST_4,
    NpcIdentifiers.HAZEEL_CULTIST_5,
  ]);

  const POISON_RANGE_ID = ObjectIdentifiers.RANGE;
  const EVIDENCE_CUPBOARD_IDS = [ObjectIdentifiers.CUPBOARD_22, ObjectIdentifiers.CUPBOARD_23];
  const VALVE_IDS = [
    ObjectIdentifiers.SEWER_VALVE,
    ObjectIdentifiers.SEWER_VALVE_2,
    ObjectIdentifiers.SEWER_VALVE_3,
    ObjectIdentifiers.SEWER_VALVE_4,
    ObjectIdentifiers.SEWER_VALVE_5,
  ];
  const RAFT_ID = ObjectIdentifiers.RAFT;
  const HIDEOUT_TILE = { x: 2606, y: 9692, z: 0 };

  const VARP_HAZEEL_CULT = 223;
  const SIDE_CARNILLEAN = 0;
  const SIDE_HAZEEL = 1;

  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 2;
  const STAGE_SPOKEN_TO_CLIVET = 3;
  const STAGE_CHOSEN_SIDE = 4;
  const STAGE_POISONED_FOOD = 5;
  const STAGE_FINISHED_SIDE_TASK = 6;
  const STAGE_RETURNED_ARMOUR = 7;
  const STAGE_COMPLETE = 9;

  const SIDE_ATTR = "quest.hazeel_cult.side";
  const VALVES_ATTR = "quest.hazeel_cult.valves";

  const POISON = ItemIdentifiers.POISON;
  const ARMOUR = ItemIdentifiers.CARNILLEAN_ARMOUR;
  const HAZEEL_SCROLL = ItemIdentifiers.HAZEEL_SCROLL;
  const COINS = ItemIdentifiers.COINS;

  const START_HOOK = "quest:hazeel-cult:start";
  const CARNILLEAN_COMPLETE_ACTION = "LtuQhV";
  const HAZEEL_COMPLETE_ACTION = "O8EM1e";

  let quest;

  const attr = (player, key) => Number(player.getAttribute(key)) || 0;
  const setAttr = (player, key, value) => player.setAttribute(key, value);
  const side = (player) => attr(player, SIDE_ATTR);
  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const take = (player, itemId, amount = 1) => player.getInventory().deleteNumber(itemId, amount);
  const give = (player, itemId, amount = 1) => player.getInventory().adds(itemId, amount);

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I uncovered the plot surrounding the Carnillean family.</str>",
        side(player) === SIDE_HAZEEL
          ? "<str>I helped the cult resurrect Lord Hazeel.</str>"
          : "<str>I stopped the cult and exposed Butler Jones.</str>",
        "<col=ff0000>Quest complete!",
      ];
    }
    if (stage < STAGE_STARTED) {
      return [
        "I can start this quest by speaking to",
        "<col=800000>Ceril Carnillean<col=000080> south-west of Ardougne.",
      ];
    }
    const lines = ["<str>Ceril asked me to recover his stolen family armour.</str>"];
    if (stage < STAGE_SPOKEN_TO_CLIVET) {
      lines.push("I should investigate the cave near the Clock Tower.");
      return lines;
    }
    lines.push("<str>Clivet told me the cult's version of the mansion's history.</str>");
    if (stage < STAGE_CHOSEN_SIDE) {
      lines.push("I must decide whether to help the Carnilleans or the cult.");
      return lines;
    }
    if (side(player) === SIDE_HAZEEL) {
      if (stage < STAGE_POISONED_FOOD) lines.push("I must pour Clivet's poison into the mansion's range.");
      else if (stage < STAGE_FINISHED_SIDE_TASK) lines.push("I should return to Clivet, then meet Alomone in the hideout.");
      else if (stage < STAGE_RETURNED_ARMOUR) lines.push("I must find the Hazeel scroll hidden inside the mansion.");
      else lines.push("I should take the Hazeel scroll to Alomone.");
    } else if (stage < STAGE_FINISHED_SIDE_TASK) {
      lines.push("I must defeat Alomone and recover the Carnillean armour.");
    } else if (stage < STAGE_RETURNED_ARMOUR) {
      lines.push("I should return the Carnillean armour to Ceril.");
    } else {
      lines.push("Jones escaped Ceril's suspicion. I need evidence from the upstairs cupboard.");
    }
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.THIEVING, 1500);
    give(player, COINS, 2000);
  }

  function cerilVariant(player) {
    const stage = quest.getStage(player);
    if (stage === STAGE_NOT_STARTED) return "starting-off";
    if (side(player) === SIDE_HAZEEL) {
      if (stage >= STAGE_COMPLETE) return null;
      if (stage >= STAGE_RETURNED_ARMOUR) return "the-scroll-talking-to-ceril";
      if (stage >= STAGE_POISONED_FOOD) return "joining-the-hazeel-side-talking-to-ceril-after-the-poisoning";
      return "joining-the-hazeel-side-talking-to-ceril";
    }
    if (stage >= STAGE_COMPLETE) return "after-quest-completion-talking-to-ceril";
    if (stage === STAGE_FINISHED_SIDE_TASK && has(player, ARMOUR)) {
      take(player, ARMOUR);
      give(player, COINS, 5);
      quest.setStage(player, STAGE_RETURNED_ARMOUR);
      return "joining-the-carnillean-side-returning-the-armour";
    }
    if (stage >= STAGE_FINISHED_SIDE_TASK) {
      return "joining-the-carnillean-side-returning-the-armour-talking-to-cecil";
    }
    return "starting-off-talking-to-ceril-again";
  }

  function clivetVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED) return null;
    if (stage === STAGE_STARTED) {
      quest.setStage(player, STAGE_SPOKEN_TO_CLIVET);
      return "confronting-the-hazeel-cult";
    }
    if (stage === STAGE_SPOKEN_TO_CLIVET) {
      return "confronting-the-hazeel-cult-talking-to-clivet-again-before-joining";
    }
    if (side(player) === SIDE_HAZEEL) {
      if (stage >= STAGE_COMPLETE) return "the-scroll-talking-to-clivet-again-2";
      if (stage >= STAGE_RETURNED_ARMOUR) return "the-scroll-talking-to-clivet-again";
      if (stage >= STAGE_POISONED_FOOD) return "the-scroll-talking-to-clivet";
      return "joining-the-hazeel-side-talking-to-clivet-again";
    }
    return "joining-the-carnillean-side-talking-to-clivet";
  }

  function alomoneVariant(player) {
    const stage = quest.getStage(player);
    if (side(player) === SIDE_HAZEEL) {
      if (stage >= STAGE_COMPLETE) return null;
      if (stage >= STAGE_RETURNED_ARMOUR) return "the-scroll-talking-to-alomone-after-obtaining-the-scroll";
      if (stage >= STAGE_FINISHED_SIDE_TASK) return "the-scroll-talking-to-alomone-again";
      if (stage >= STAGE_CHOSEN_SIDE) {
        quest.setStage(player, STAGE_FINISHED_SIDE_TASK);
        return "the-scroll-talking-to-alomone";
      }
      return null;
    }
    if (stage >= STAGE_FINISHED_SIDE_TASK) return "joining-the-carnillean-side-if-alomone-is-alive";
    if (stage >= STAGE_CHOSEN_SIDE) return "joining-the-carnillean-side-talking-to-alomone";
    return null;
  }

  function jonesVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED) return null;
    if (stage === STAGE_STARTED) return "starting-off-talking-to-butler-jones";
    if (side(player) === SIDE_HAZEEL) {
      if (stage >= STAGE_COMPLETE) return null;
      if (stage >= STAGE_RETURNED_ARMOUR) {
        return has(player, HAZEEL_SCROLL)
          ? "the-scroll-talking-to-jones-after-obtaining-the-scroll"
          : "the-scroll-talking-to-butler-jones";
      }
      if (stage >= STAGE_POISONED_FOOD) return "joining-the-hazeel-side-talking-to-butler-jones-after-the-poisoning";
      return "joining-the-hazeel-side-talking-to-butler-jones";
    }
    if (stage >= STAGE_COMPLETE) return null;
    if (stage >= STAGE_FINISHED_SIDE_TASK) {
      return "joining-the-carnillean-side-returning-the-armour-talking-to-butler-jones";
    }
    return "joining-the-carnillean-side-talking-to-butler-jones";
  }

  function selectVariant({ npcId, player }) {
    if (CERIL_IDS.has(npcId)) return cerilVariant(player);
    if (CLIVET_IDS.has(npcId)) return clivetVariant(player);
    if (ALOMONE_IDS.has(npcId)) return alomoneVariant(player);
    if (JONES_IDS.has(npcId)) return jonesVariant(player);
    const stage = quest.getStage(player);
    if (GUARD_IDS.has(npcId)) {
      if (stage < STAGE_STARTED) return "starting-off-talking-to-the-guard";
      if (stage >= STAGE_COMPLETE) return "after-quest-completion-talking-to-guard";
      if (side(player) === SIDE_HAZEEL) return "joining-the-hazeel-side-talking-to-the-guard";
      return "starting-off-talking-to-the-guard";
    }
    if (HENRYETA_IDS.has(npcId)) {
      if (stage < STAGE_STARTED) return "starting-off-talking-to-henryeta";
      if (stage >= STAGE_COMPLETE) {
        return side(player) === SIDE_HAZEEL
          ? "joining-the-hazeel-side-talking-to-henryeta"
          : "after-quest-completion-talking-to-henryeta";
      }
      if (side(player) === SIDE_HAZEEL) return "joining-the-hazeel-side-talking-to-henryeta";
      return "joining-the-carnillean-side-returning-the-armour-talking-to-henryeta";
    }
    if (CULTIST_IDS.has(npcId)) {
      if (stage < STAGE_CHOSEN_SIDE) return null;
      return side(player) === SIDE_HAZEEL
        ? "the-scroll-talking-to-a-hazeel-cultist"
        : "joining-the-carnillean-side-talking-to-hazeel-cultist";
    }
    return null;
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("below level 10 combat")) return null;
    if (value.includes("full inventory")) return player.getInventory().isFull?.() === true;
    return null;
  }

  /** The Hazeel-side choice carries no hook; set the side/poison from the words. */
  function handleChoice({ player, npcId, option }) {
    if (!CLIVET_IDS.has(npcId)) return;
    if (quest.getStage(player) > STAGE_CHOSEN_SIDE) return;
    const text = String(option ?? "").toLowerCase();
    if (text.includes("i'll help you") || text.includes("i will help") || text.includes("i'll help the cult")) {
      setAttr(player, SIDE_ATTR, SIDE_HAZEEL);
      quest.setStage(player, STAGE_CHOSEN_SIDE);
      if (!has(player, POISON)) give(player, POISON);
    } else if (text.includes("won't help you") || text.includes("i will stop you") || text.includes("i won't help")) {
      setAttr(player, SIDE_ATTR, SIDE_CARNILLEAN);
      quest.setStage(player, STAGE_CHOSEN_SIDE);
    }
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!CERIL_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) {
      setAttr(player, SIDE_ATTR, SIDE_CARNILLEAN);
      quest.setStage(player, STAGE_STARTED);
    }
  }

  function handleAction({ player, npcId, stepId }) {
    if (quest.isComplete(player)) return;
    if (stepId === CARNILLEAN_COMPLETE_ACTION && CERIL_IDS.has(npcId)) {
      quest.complete(player);
      return;
    }
    if (stepId === HAZEEL_COMPLETE_ACTION && ALOMONE_IDS.has(npcId)) {
      if (has(player, HAZEEL_SCROLL)) take(player, HAZEEL_SCROLL);
      quest.complete(player);
    }
  }

  /** Pouring the poison into the mansion range advances the Hazeel side. */
  function handlePoisonRange(event) {
    if (event.objectId !== POISON_RANGE_ID || event.itemId !== POISON) return;
    const { player } = event;
    if (side(player) !== SIDE_HAZEEL || quest.getStage(player) !== STAGE_CHOSEN_SIDE) {
      player.sendMessage("You decide not to put poison in the food.");
      event.handled = true;
      return;
    }
    take(player, POISON);
    quest.setStage(player, STAGE_POISONED_FOOD);
    player.sendMessage("You pour the poison into the bubbling food.");
    event.handled = true;
  }

  /** Searching the cupboard after returning the armour exposes Jones. */
  function handleEvidenceCupboard(event) {
    if (!EVIDENCE_CUPBOARD_IDS.includes(event.objectId)) return;
    const { player } = event;
    if (side(player) === SIDE_HAZEEL || quest.getStage(player) !== STAGE_RETURNED_ARMOUR) {
      player.sendMessage("You search the cupboard but find nothing of interest.");
      event.handled = true;
      return;
    }
    player.sendMessage("You find poison and a cult amulet, proving Butler Jones's treachery.");
    quest.complete(player);
    event.handled = true;
  }

  /** Defeating Alomone on the Carnillean side recovers the family armour. */
  function handleNpcDeath(event) {
    const player = event.killer ?? event.player;
    const { npcId } = event;
    if (!player || !ALOMONE_IDS.has(npcId)) return;
    const stage = quest.getStage(player);
    if (side(player) !== SIDE_CARNILLEAN || stage < STAGE_CHOSEN_SIDE || stage >= STAGE_FINISHED_SIDE_TASK) return;
    quest.setStage(player, STAGE_FINISHED_SIDE_TASK);
    player.sendMessage("Alomone falls. The Carnillean armour is now unguarded.");
  }

  function handleValve(event) {
    const index = VALVE_IDS.indexOf(event.objectId);
    if (index === -1) return;
    const { player } = event;
    const value = attr(player, VALVES_ATTR) ^ (1 << index);
    setAttr(player, VALVES_ATTR, value);
    player.sendMessage("Beneath your feet you hear the sudden sound of rushing water.");
    event.handled = true;
  }

  function handleRaft(event) {
    if (event.objectId !== RAFT_ID) return;
    const { player } = event;
    if (quest.getStage(player) < STAGE_CHOSEN_SIDE) {
      player.sendMessage("Clivet stops you from using the raft.");
      event.handled = true;
      return;
    }
    const value = attr(player, VALVES_ATTR);
    let correct = 0;
    while (correct < 5 && (value & (1 << correct)) !== 0) correct++;
    if (correct < 5) {
      player.sendMessage("The current is flowing against the raft. It will not move.");
      event.handled = true;
      return;
    }
    player.moveTo(new Location(HIDEOUT_TILE.x, HIDEOUT_TILE.y, HIDEOUT_TILE.z));
    player.sendMessage("The raft carries you past the islands to the end of the sewer passage.");
    event.handled = true;
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "hazeel_cult",
    name: "Hazeel Cult",
    varpId: VARP_HAZEEL_CULT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.THIEVING.getIndex(), amount: 1500, label: "Thieving" }],
    rewardItemId: COINS,
    rewardItemLabel: "2,000 coins",
    otherRewards: ["A permanent choice between the Carnillean family and the Cult of Hazeel"],
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(SIDE_ATTR);
  api.persistAttribute(VALVES_ATTR);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemOnObject(handlePoisonRange, { noted: false });
  api.onObjectInteraction(handleEvidenceCupboard);
  api.onObjectInteraction(handleValve);
  api.onObjectInteraction(handleRaft);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
};
