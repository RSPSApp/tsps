/**
 * Sea Slug (members).
 *
 * The words come from the "Sea Slug" transcript page. Caroline, Bailey, Kennith,
 * Kent and the four Holgart ids are all indexed, so this plugin supplies the
 * variant selector, the prose-condition answers, the start hook, the completion
 * action and the stage transitions the transcript does not carry (swamp-paste
 * hand-in, Kennith's escape, Kent's slug reveal).
 *
 * Stages (varp 159):
 *   1 started, 2 needs swamp paste, 3 boat repaired, 4 spoken to Kennith,
 *   5 sailed to Kent, 6 spoken to Kent, 7 lit torch, 8 Kennith needs escape,
 *   9 panel opened, 10 needs crane, 11 saved Kennith, 12 complete.
 *
 * Gaps: travel between shore/platform/island, the swamp-paste mixing and torch
 * lighting recipes, the loose panel and crane are not wired to objects here
 * (the transcript still plays the right words by stage; only the world edits are
 * missing). Level 30 Firemaking is only stated in the journal, not enforced.
 */
module.exports = function registerSeaSlugQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const CAROLINE_NPC_ID = NpcIdentifiers.CAROLINE; // 5067
  const KENNITH_NPC_IDS = new Set([NpcIdentifiers.KENNITH, NpcIdentifiers.KENNITH_2]);
  const BAILEY_NPC_ID = NpcIdentifiers.BAILEY; // 5066
  const KENT_NPC_ID = NpcIdentifiers.KENT; // 5074
  const HOLGART_NPC_IDS = new Set([
    NpcIdentifiers.HOLGART,
    NpcIdentifiers.HOLGART_2,
    NpcIdentifiers.HOLGART_3,
    NpcIdentifiers.HOLGART_4,
    NpcIdentifiers.HOLGART_5,
    NpcIdentifiers.HOLGART_6,
    NpcIdentifiers.HOLGART_7,
  ]);

  const VARP_SEA_SLUG = 159;
  const STAGE_STARTED = 1;
  const STAGE_NEEDS_SWAMP_PASTE = 2;
  const STAGE_BOAT_REPAIRED = 3;
  const STAGE_SPOKEN_TO_KENNITH = 4;
  const STAGE_SAILED_TO_KENT = 5;
  const STAGE_SPOKEN_TO_KENT = 6;
  const STAGE_LIT_TORCH = 7;
  const STAGE_KENNITH_NEEDS_ESCAPE = 8;
  const STAGE_PANEL_OPENED = 9;
  const STAGE_NEEDS_CRANE = 10;
  const STAGE_SAVED_KENNITH = 11;
  const STAGE_COMPLETE = 12;

  const SWAMP_PASTE_ITEM_ID = ItemIdentifiers.SWAMP_PASTE;
  const LIT_TORCH_ITEM_ID = ItemIdentifiers.LIT_TORCH;
  const UNLIT_TORCH_ITEM_ID = ItemIdentifiers.UNLIT_TORCH;

  const START_HOOK = "quest:sea-slug:start";
  const COMPLETE_ACTION_ID = "U0muMo";
  const KENT_ACTION_ID = "EkOxin";

  let quest;

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    const history = [
      "<str>I agreed to find Caroline's husband Kent and son Kennith.</str>",
      "",
    ];
    if (stage === 0) {
      return [
        "I can start this quest by speaking to <col=800000>Caroline</col>",
        "on the coast <col=800000>east of Ardougne</col>.",
        "",
        "I need level 30 <col=800000>Firemaking</col>.",
      ];
    }
    if (stage === STAGE_STARTED) {
      return [...history, "I should speak to <col=800000>Holgart</col> about reaching the Fishing Platform."];
    }
    if (stage === STAGE_NEEDS_SWAMP_PASTE) {
      return [
        ...history,
        held(player, SWAMP_PASTE_ITEM_ID)
          ? "I should give my <col=800000>swamp paste</col> to Holgart."
          : "Holgart needs <col=800000>swamp paste</col> to repair his boat.",
      ];
    }
    if (stage === STAGE_BOAT_REPAIRED) {
      return [...history, "Holgart's boat is repaired. I should sail to the <col=800000>Fishing Platform</col>."];
    }
    if (stage === STAGE_SPOKEN_TO_KENNITH || stage === STAGE_SAILED_TO_KENT) {
      return [...history, "I found Kennith hiding on the platform. I need to find <col=800000>Kent</col>."];
    }
    if (stage === STAGE_SPOKEN_TO_KENT) {
      return [...history, "Sea slugs fear heat. I need Bailey's torch and a way to <col=800000>light it</col>."];
    }
    if (stage === STAGE_LIT_TORCH) {
      return [...history, "My torch keeps the fishermen away. I should return to <col=800000>Kennith</col>."];
    }
    if (stage === STAGE_KENNITH_NEEDS_ESCAPE) {
      return [...history, "Kennith needs another escape route. The nearby wall panel looks weak."];
    }
    if (stage === STAGE_PANEL_OPENED) {
      return [...history, "I opened the wall. I should tell <col=800000>Kennith</col>."];
    }
    if (stage === STAGE_NEEDS_CRANE) {
      return [...history, "I need to use the <col=800000>crane</col> to lower Kennith into Holgart's boat."];
    }
    if (stage === STAGE_SAVED_KENNITH) {
      return [...history, "Kennith is safe. I should return to <col=800000>Caroline</col>."];
    }
    return [
      ...history,
      "<str>I rescued Kennith and helped reunite Caroline's family.</str>",
      "",
      "<col=ff0000>QUEST COMPLETE!</col>",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.FISHING, 7175);
  }

  function carolineVariant(stage) {
    if (stage >= STAGE_COMPLETE) return null;
    if (stage >= STAGE_SAVED_KENNITH) return "freeing-kennith-talking-to-caroline";
    if (stage >= STAGE_STARTED) return "starting-off-talking-to-caroline-again";
    return "starting-off";
  }

  function holgartVariant(stage, player) {
    if (stage === STAGE_STARTED) {
      quest.setStage(player, STAGE_NEEDS_SWAMP_PASTE);
      return "talking-to-holgart";
    }
    if (stage === STAGE_NEEDS_SWAMP_PASTE) {
      return held(player, SWAMP_PASTE_ITEM_ID)
        ? "talking-to-holgart"
        : "talking-to-holgart-talking-to-holgart-again";
    }
    if (stage === STAGE_BOAT_REPAIRED) return "talking-to-holgart-talking-to-holgart-after-fixing-the-boat";
    if (stage === STAGE_SPOKEN_TO_KENNITH) return "talking-to-holgart-after-talking-to-kennith";
    if (stage === STAGE_SAILED_TO_KENT) return "at-the-shipwreck-island-talking-to-holgart";
    if (stage === STAGE_SPOKEN_TO_KENT) {
      return "at-the-shipwreck-island-talking-to-holgart-again-before-returning-to-the-fishing-platform";
    }
    if (stage >= STAGE_SAVED_KENNITH) return "freeing-kennith-talking-to-holgart";
    return "at-the-shipwreck-island-talking-to-holgart";
  }

  function kennithVariant(stage) {
    if (stage === STAGE_BOAT_REPAIRED) return "at-the-fishing-platform-talking-to-kennith";
    if (stage >= STAGE_SPOKEN_TO_KENNITH && stage <= STAGE_SPOKEN_TO_KENT) {
      return "at-the-fishing-platform-subsequent-dialogue-with-kennith";
    }
    if (stage === STAGE_LIT_TORCH || stage === STAGE_KENNITH_NEEDS_ESCAPE) {
      return "rescuing-kennith-talking-to-kennith";
    }
    if (stage === STAGE_PANEL_OPENED) {
      return "freeing-kennith-talking-to-kennith-after-making-a-hole-in-the-wall";
    }
    if (stage >= STAGE_NEEDS_CRANE) return "freeing-kennith-subsequent-dialogue-with-kennith";
    return null;
  }

  function baileyVariant(stage, player) {
    if (stage >= STAGE_SAVED_KENNITH) return "freeing-kennith-talking-to-bailey-after-freeing-kennith";
    if (stage === STAGE_SPOKEN_TO_KENT) return "rescuing-kennith-talking-to-bailey";
    if (stage >= STAGE_LIT_TORCH && stage < STAGE_SAVED_KENNITH) {
      return held(player, LIT_TORCH_ITEM_ID)
        ? "rescuing-kennith-talking-to-bailey-with-the-lit-torch"
        : "rescuing-kennith-talking-to-bailey-again-with-the-unlit-torch";
    }
    return "at-the-fishing-platform-talking-to-bailey";
  }

  function kentVariant(stage) {
    if (stage === STAGE_SAILED_TO_KENT) return "at-the-shipwreck-island-talking-to-kent";
    if (stage >= STAGE_SPOKEN_TO_KENT) return "at-the-shipwreck-island-subsequent-dialogue-with-kent";
    return null;
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === CAROLINE_NPC_ID) return carolineVariant(stage);
    if (HOLGART_NPC_IDS.has(npcId)) return holgartVariant(stage, player);
    if (KENNITH_NPC_IDS.has(npcId)) {
      if (stage === STAGE_BOAT_REPAIRED) quest.setStage(player, STAGE_SPOKEN_TO_KENNITH);
      if (stage === STAGE_LIT_TORCH) quest.setStage(player, STAGE_KENNITH_NEEDS_ESCAPE);
      if (stage === STAGE_PANEL_OPENED) quest.setStage(player, STAGE_NEEDS_CRANE);
      return kennithVariant(stage);
    }
    if (npcId === BAILEY_NPC_ID) return baileyVariant(stage, player);
    if (npcId === KENT_NPC_ID) return kentVariant(stage);
    return null;
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const inventory = player.getInventory();
    const firemaking = player.getSkillManager().getCurrentLevel(Skill.FIREMAKING);
    if (value.includes("firemaking level is less than 30")) return firemaking < 30;
    if (value.includes("firemaking level is 30 or above")) return firemaking >= 30;
    if (value.includes("no space in their inventory")) return inventory.isFull();
    if (value.includes("already has one swamp paste")) return inventory.getAmount(SWAMP_PASTE_ITEM_ID) >= 1;
    if (value.includes("does not have swamp tar")) return !held(player, ItemIdentifiers.SWAMP_TAR);
    if (value.includes("has swamp tar")) return held(player, ItemIdentifiers.SWAMP_TAR);
    if (value.includes("loses their unlit torch")) return !held(player, UNLIT_TORCH_ITEM_ID);
    if (value.includes("has an unlit torch")) return held(player, UNLIT_TORCH_ITEM_ID);
    if (value.includes("does not have an unlit torch")) return !held(player, UNLIT_TORCH_ITEM_ID);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== CAROLINE_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  function handleAction({ player, npcId, stepId }) {
    if (stepId === COMPLETE_ACTION_ID) {
      if (npcId === CAROLINE_NPC_ID && !quest.isComplete(player)) {
        if (quest.getStage(player) < STAGE_SAVED_KENNITH) return;
        quest.complete(player);
      }
      return;
    }
    if (stepId === KENT_ACTION_ID && npcId === KENT_NPC_ID) {
      if (quest.getStage(player) < STAGE_SPOKEN_TO_KENT) quest.setStage(player, STAGE_SPOKEN_TO_KENT);
    }
  }

  /** Holgart's "already has one swamp paste" branch: hand it over, fix the boat. */
  function handleCondition({ player, npcId, stepId }) {
    if (stepId !== "u-qtrY" || !HOLGART_NPC_IDS.has(npcId)) return;
    if (!held(player, SWAMP_PASTE_ITEM_ID)) return;
    player.getInventory().deleteNumber(SWAMP_PASTE_ITEM_ID, 1);
    quest.setStage(player, STAGE_BOAT_REPAIRED);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "sea_slug",
    name: "Sea Slug",
    varpId: VARP_SEA_SLUG,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.FISHING.getIndex(), amount: 7175, label: "Fishing" }],
    rewardItemId: ItemIdentifiers.OYSTER_PEARLS,
    rewardItemLabel: "Oyster pearls",
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onPlayerLogin(handleLogin);
};
