/**
 * Tribal Totem (members).
 *
 * Words come from the "Tribal Totem" transcript page:
 *   Kangai Mau, not started -> getting-started-talking-to-kangai-mau
 *   Kangai Mau, carrying the totem -> returning-back-to-kangai-mau
 *   GPDT employee, crate relabelled -> investigating-the-gpdt-depot-talking-to-gpdt-employee-after-using-the-address-label-on-the-crate
 *   Horacio -> getting-started-talking-to-horacio
 *   Wizard Cromperty -> investigating-the-gpdt-depot-talking-to-wizard-cromperty
 *
 * This plugin supplies the variant selector, the prose-condition answers, the
 * start hook, the totem hand-in (transcript action) and the guide-book read.
 *
 * Gaps (no object/item wiring here): the GPDT crates, the address label, the
 * mansion combination door, the trap stairs and the chest need real object ids
 * the dump does not pin down; only the conversation stages, start hook, hand-in
 * and guide-book read are ported.
 */
module.exports = function registerTribalTotemQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Tribal Totem";
  const VARP_TRIBAL_TOTEM = 200;

  const STAGE_STARTED = 1;
  const STAGE_CRATE_MARKED = 2;
  const STAGE_COMPLETE = 5;

  const START_HOOK = "quest:tribal-totem:start";
  /** Transcript action that ends the "returning back to Kangai Mau" branch. */
  const COMPLETE_ACTION_ID = "WkVGYP";

  const KANGAI_MAU_NPC_ID = NpcIdentifiers.KANGAI_MAU;
  const GPDT_EMPLOYEE_NPC_ID = NpcIdentifiers.GPDT_EMPLOYEE;
  const HORACIO_NPC_ID = NpcIdentifiers.HORACIO;
  const WIZARD_CROMPERTY_NPC_IDS = new Set([
    NpcIdentifiers.WIZARD_CROMPERTY,
    NpcIdentifiers.WIZARD_CROMPERTY_2,
  ]);

  const TRIBAL_TOTEM_ITEM_ID = ItemIdentifiers.TOTEM;
  const GUIDE_BOOK_ITEM_ID = ItemIdentifiers.GUIDE_BOOK;
  const SWORDFISH_ITEM_ID = ItemIdentifiers.SWORDFISH;

  const page = (variant) => ({ page: PAGE, variant });
  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  let quest;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I recovered the Rantuki tribe's totem from</str>",
        "<str>Lord Handelmort's mansion in Ardougne.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_CRATE_MARKED) {
      return [
        "<str>I relabelled Wizard Cromperty's crate so the GPDT</str>",
        "<str>would deliver it into Handelmort Mansion.</str>",
        "I must get inside and take the <col=800000>tribal totem</col>.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Kangai Mau asked me to recover the Rantuki tribe's",
        "<col=800000>tribal totem</col> from <col=800000>Lord Handelmort's</col>",
        "mansion in East Ardougne.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Kangai Mau</col>",
      "in the Shrimp & Parrot in Brimhaven.",
      "",
      "I need level 21 <col=800000>Thieving</col>.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.THIEVING, 1775);
    player.getInventory().adds(SWORDFISH_ITEM_ID, 4);
  }

  function kangaiVariant(player, stage) {
    if (stage >= STAGE_COMPLETE || has(player, TRIBAL_TOTEM_ITEM_ID)) {
      return page("returning-back-to-kangai-mau");
    }
    return page("getting-started-talking-to-kangai-mau");
  }

  /** Which transcript variant the clicked NPC plays. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === KANGAI_MAU_NPC_ID) return kangaiVariant(player, stage);
    if (npcId === GPDT_EMPLOYEE_NPC_ID) {
      return page(
        stage >= STAGE_CRATE_MARKED
          ? "investigating-the-gpdt-depot-talking-to-gpdt-employee-after-using-the-address-label-on-the-crate"
          : "investigating-the-gpdt-depot-talking-to-a-gpdt-employee"
      );
    }
    if (npcId === HORACIO_NPC_ID) return page("getting-started-talking-to-horacio");
    if (WIZARD_CROMPERTY_NPC_IDS.has(npcId)) {
      return page("investigating-the-gpdt-depot-talking-to-wizard-cromperty");
    }
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("does not have the totem")) return !has(player, TRIBAL_TOTEM_ITEM_ID);
    if (value.includes("has the totem")) return has(player, TRIBAL_TOTEM_ITEM_ID);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== KANGAI_MAU_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** The transcript's "Quest complete!" action consumes the totem and finishes. */
  function handleAction({ player, npcId, stepId }) {
    if (npcId !== KANGAI_MAU_NPC_ID || stepId !== COMPLETE_ACTION_ID) return;
    if (quest.isComplete(player)) return;
    if (has(player, TRIBAL_TOTEM_ITEM_ID)) player.getInventory().deleteNumber(TRIBAL_TOTEM_ITEM_ID, 1);
    quest.complete(player);
  }

  function readGuideBook(event) {
    if (event.itemId !== GUIDE_BOOK_ITEM_ID) return;
    if (!String(event.option ?? "").toLowerCase().includes("read")) return;
    event.player.sendMessage("The guide lists the owner as Lord Francis Kurt Handelmort.");
    event.handled = true;
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "tribal_totem",
    name: "Tribal Totem",
    varpId: VARP_TRIBAL_TOTEM,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.THIEVING.getIndex(), amount: 1775, label: "Thieving" }],
    rewardItemId: SWORDFISH_ITEM_ID,
    rewardItemLabel: "5 Swordfish",
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemAction(readGuideBook);
  api.onPlayerLogin(handleLogin);
};
