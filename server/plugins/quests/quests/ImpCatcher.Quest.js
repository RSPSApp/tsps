/** Imp Catcher: dialogue branches and the captured bead ritual. See docs/f2p-varrock-parity.md. */
module.exports = function registerImpCatcherQuest(api) {
  const { Skill, Animation, Graphic, Location, World, CountdownTask, TaskManager, DialogueChainBuilder, ActionDialogue, StatementDialogue, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  // Wizard Mizgog spawns as transformed NPC 5005 (-> 7746/7747); handle all forms.
  // 5005 has no NpcIdentifiers member, so it stays a local constant.
  const MIZGOG_TRANSFORMED_NPC_ID = 5005; // no enum member
  const MIZGOG_NPC_IDS = new Set([
    MIZGOG_TRANSFORMED_NPC_ID,
    NpcIdentifiers.WIZARD_MIZGOG,
    NpcIdentifiers.WIZARD_MIZGOG_2,
  ]);

  const VARP_IMP_CATCHER = 160;
  const STAGE_STARTED = 1;
  const STAGE_COMPLETE = 2;

  const REQUIRED_ITEMS = [
    { itemId: ItemIdentifiers.BLACK_BEAD, label: "1 Black Bead." },
    { itemId: ItemIdentifiers.RED_BEAD, label: "1 Red Bead." },
    { itemId: ItemIdentifiers.WHITE_BEAD, label: "1 White Bead." },
    { itemId: ItemIdentifiers.YELLOW_BEAD, label: "1 Yellow Bead." },
  ];

  /** Hand-in actions: "finishing up" and the start-with-all-beads branch. */
  const HAND_IN_ACTION_IDS = new Set(["k5b4d5", "_JySdu"]);

  /** Post-quest "I have them with me!" trade: another amulet for another bead set. */
  const SPARE_AMULET_MESSAGE_ID = "jxPdQz";

  /** "Yes." on "Start the Imp Catcher quest?" carries this slug. */
  const START_HOOK = "quest:imp-catcher:start";

  const PAGE_IMP_CATCHER = "Imp Catcher";
  const PAGE_WIZARD_MIZGOG = "Wizard Mizgog";
  const VARIANT_START = "starting-out-talking-to-wizard-mizgog";
  const VARIANT_NO_BEADS = "finding-the-beads-speaking-to-wizard-mizgog-with-no-beads";
  const VARIANT_SOME_BEADS = "finding-the-beads-speaking-to-wizard-mizgog-with-some-beads";
  const VARIANT_HAND_IN = "finishing-up-giving-the-beads-to-wizard-mizgog";
  const VARIANT_AFTER = "after-imp-catcher";

  // Prose condition substrings (negative checks first: the "does not have all
  // four beads" prose contains "has all four beads").
  const CONDITION_NOT_ALL_BEADS = "does not have all four beads";
  const CONDITION_ALREADY_ALL_BEADS = "already has all four beads";
  const CONDITION_WITHOUT_ALL_BEADS = "without all four beads";
  const CONDITION_ALL_BEADS = "has all four beads";

  const PENDING_ATTRIBUTE = "imp-catcher:ritual-pending";
  const REWARDED_ATTRIBUTE = "imp-catcher:amulet-issued";
  const rituals = new Map(), casters = new WeakMap();
  let quest;
  function later(key, ticks, fn) { TaskManager.submit(new CountdownTask(key, ticks, fn)); }
  function fade(player, out) { player.getPacketSender().sendSubInterface((161 << 16) | 1, 174, 1, { postScripts: [{ scriptId: 948, args: out ? [0, 255, 0, 0, 15] : [0, 0, 0, 255, 50] }] }); }
  function unlock(player) {
    const ritual=rituals.get(player); if (ritual) TaskManager.cancelTasks(ritual);
    rituals.delete(player);
    player.getMovementQueue().setBlockMovement(false); player.setUntargetable(false);
    player.getPacketSender().sendVarbit(12393, 0).sendVarbit(6719, 0).sendCameraReset().closeSubInterface((161 << 16) | 1);
  }
  function beginRitual(event) {
    const { player } = event;
    if (rituals.has(player) || quest.isComplete(player) || !hasAllBeads(player)) return;
    const ritual={}; rituals.set(player,ritual);
    player.getMovementQueue().reset().setBlockMovement(true); player.setUntargetable(true);
    player.getPacketSender().sendVarbit(12393,1);
    fade(player,true);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ActionDialogue(0, { execute: () => StatementDialogue.send(player,"You give four coloured beads to Wizard Mizgog.",false) })));
    later(ritual,1,()=> player.getPacketSender().sendJingle(133,0).sendCameraLookAt(3103,3162,350,{rate:232,rate2:100,heightRelative:false}).sendCameraMoveTo(3103,3161,775,{rate:232,rate2:100,heightRelative:false}));
    later(ritual,2,()=>fade(player,false));
    later(ritual,5,()=> {
      const npc=casters.get(player) ?? World.getNpcsNear(player.getLocation(),16,player.getPrivateArea?.()??null).find(npc=>npc && isMizgog(npc.getId()));
      npc?.performAnimation(new Animation(4285)); player.getPacketSender().sendSoundEffect(1632,1,0);
    });
    later(ritual,7,()=> {
      if (!hasAllBeads(player)) { unlock(player); return; }
      for (const requirement of REQUIRED_ITEMS) player.getInventory().deleteNumber(requirement.itemId,1);
      player.setAttribute(PENDING_ATTRIBUTE,1); player.getPacketSender().sendConfig(VARP_IMP_CATCHER,STAGE_COMPLETE);
    });
    later(ritual,8,()=>player.getPacketSender().sendGraphic(new Graphic(714,0,100),new Location(3102,3163,2)).sendSoundEffect(1633,1,0));
    later(ritual,16,()=>fade(player,true));
    later(ritual,17,()=> {
      if (!player.getAttribute(PENDING_ATTRIBUTE)) return;
      reward(player); player.getPacketSender().sendCameraReset(); fade(player,false);
    });
    later(ritual,19,()=> {
      player.getDialogueManager().reset(); player.getPacketSender().sendInterfaceRemoval();
      if (player.getAttribute(PENDING_ATTRIBUTE)) { player.setAttribute(PENDING_ATTRIBUTE,0); quest.complete(player); }
      unlock(player);
    });
  }
  function restoreRitual({ player }) {
    if (player.getAttribute(PENDING_ATTRIBUTE)) { player.setAttribute(PENDING_ATTRIBUTE,0); quest.complete(player); }
  }


  const isMizgog = (npcId) => MIZGOG_NPC_IDS.has(npcId);

  function hasAllBeads(player) {
    return REQUIRED_ITEMS.every((requirement) => player.getInventory().getAmount(requirement.itemId) > 0);
  }

  function hasAnyBead(player) {
    return REQUIRED_ITEMS.some((requirement) => player.getInventory().getAmount(requirement.itemId) > 0);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I have spoken to Wizard Mizgog.</str>",
        "",
        "<str>I have collected all the beads.</str>",
        "",
        "<str>Wizard Mizgog thanked me for finding his beads and gave me an</str>",
        "<str>Amulet of Accuracy.</str>",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_STARTED) {
      if (hasAllBeads(player)) {
        return [
          "<str>I have spoken to Wizard Mizgog.</str>",
          "",
          "I have collected all the missing beads and need to return",
          "them to <col=800000>Wizard Mizgog</col>.",
        ];
      }
      const lines = [
        "<str>I have spoken to Wizard Mizgog.</str>",
        "",
        "I need to collect some items by killing <col=800000>Imps</col>, I can",
        "find Imps all over the kingdom.",
        "",
      ];
      for (const requirement of REQUIRED_ITEMS) {
        lines.push(
          player.getInventory().getAmount(requirement.itemId) > 0
            ? `<str>${requirement.label}</str>`
            : `<col=800000>${requirement.label}</col>`,
        );
      }
      return lines;
    }
    return [
      "I can start this quest by talking to",
      "<col=800000>Wizard Mizgog</col> in the",
      "<col=800000>Wizards' Tower</col>.",
      "",
      "There aren't any requirements for this quest.",
    ];
  }

  function reward(player) {
    if (player.getAttribute(REWARDED_ATTRIBUTE)) return;
    player.setAttribute(REWARDED_ATTRIBUTE,1);
    player.getInventory().adds(ItemIdentifiers.AMULET_OF_ACCURACY,1);
    player.sendMessage("The wizard hands you an amulet.");
    player.getSkillManager().addExperiences(Skill.MAGIC, 875);
  }

  // Which transcript variant Wizard Mizgog plays, by quest stage / carried beads.
  function selectVariant({ npcId, player }) {
    if (npcId === NpcIdentifiers.WIZARD_GRAYZAG && quest.getStage(player) === STAGE_STARTED) return { page: PAGE_IMP_CATCHER, variant: "finding-the-beads-speaking-to-wizard-grayzag" };
    if (!isMizgog(npcId)) return null;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return { page: PAGE_WIZARD_MIZGOG, variant: VARIANT_AFTER };
    if (stage >= STAGE_STARTED) {
      if (hasAllBeads(player)) return { page: PAGE_IMP_CATCHER, variant: VARIANT_HAND_IN };
      return hasAnyBead(player)
        ? { page: PAGE_IMP_CATCHER, variant: VARIANT_SOME_BEADS }
        : { page: PAGE_IMP_CATCHER, variant: VARIANT_NO_BEADS };
    }
    return { page: PAGE_IMP_CATCHER, variant: VARIANT_START };
  }

  // Answer the transcript's prose conditions.
  function answerCondition({ npcId, player, text }) {
    if (!isMizgog(npcId)) return null;
    const value = String(text).toLowerCase();
    if (value.includes(CONDITION_NOT_ALL_BEADS)) return !hasAllBeads(player);
    if (value.includes(CONDITION_ALREADY_ALL_BEADS)) return hasAllBeads(player);
    if (value.includes(CONDITION_WITHOUT_ALL_BEADS)) return !hasAllBeads(player);
    if (value.includes(CONDITION_ALL_BEADS)) return hasAllBeads(player);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!isMizgog(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
  }

  function handleDialogueAction(event) {
    if (!isMizgog(event.npcId)) return;
    if (HAND_IN_ACTION_IDS.has(event.stepId)) {
      if (!hasAllBeads(event.player) || quest.getStage(event.player) !== STAGE_STARTED) return;
      if (event.npc) casters.set(event.player,event.npc);
      startTranscript(api,event.player,event.npcId,PAGE_IMP_CATCHER,"finishing-up-quest-complete");
      event.handled=true; return;
    }
    if (event.stepId === "XpTtp9") { event.handled=true; beginRitual(event); return; }
    if (["DUX9vV","6fGWGv","2TvFXa"].includes(event.stepId)) { event.handled=true; return; }
    // Post-quest: swap a spare set of beads for another amulet. Do not consume
    // the step so the transcript's own "Mizgog removes the beads..." line plays.
    if (event.stepId === SPARE_AMULET_MESSAGE_ID && quest.isComplete(event.player) && hasAllBeads(event.player)) {
      for (const requirement of REQUIRED_ITEMS) {
        event.player.getInventory().deleteNumber(requirement.itemId, 1);
      }
      event.player.getInventory().adds(ItemIdentifiers.AMULET_OF_ACCURACY, 1);
    }
  }

  quest = registerQuest(api, {
    key: "imp_catcher",
    name: "Imp Catcher",
    varpId: VARP_IMP_CATCHER,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    completionJingleId: 153,
    varpValue: (stage,player)=>player.getAttribute(PENDING_ATTRIBUTE) ? STAGE_COMPLETE : stage,
    xpRewards: [{ skillId: Skill.MAGIC.getIndex(), amount: 875, label: "Magic" }],
    scrollItemId: ItemIdentifiers.AMULET_OF_ACCURACY,
    rewardItemLabel: "An Amulet of Accuracy",
    buildJournal,
    onReward: reward,
  });

  api.persistAttribute(PENDING_ATTRIBUTE,0);
  api.persistAttribute(REWARDED_ATTRIBUTE,0);
  api.onPlayerLogin(restoreRitual);
  api.onPlayerLogout(({player})=>unlock(player));
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
};
