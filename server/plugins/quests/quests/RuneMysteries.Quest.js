/**
 * Rune Mysteries.
 *
 * Words come from data/definitions/npc-dialogues.json (page "Rune Mysteries",
 * plus the "Archmage Sedridor" and "Aubury" general pages):
 *   Duke, not started    -> "Rune Mysteries" / "starting-off-talking-to-duke-horacio"
 *   Duke, in progress    -> "Rune Mysteries" / "...-talking-to-duke-horacio-again"
 *   Sedridor, not started-> "Archmage Sedridor" / "standard-dialogue-before-rune-mysteries"
 *   Sedridor, finished   -> "Archmage Sedridor" / "standard-dialogue-after-rune-mysteries"
 *   talisman delivery    -> "Rune Mysteries" / the "delivering-the-talisman-..." variants
 *   package delivery     -> "Rune Mysteries" / the "delivering-the-research-package-..." variants
 *   notes delivery       -> "Rune Mysteries" / "delivering-the-research-notes-talking-to-sedridor"
 *
 * The plugin supplies the variant selector, the condition answers, the start
 * hook, the item hand-ins/recoveries, the Rune Essence teleport and the quest
 * completion.
 */
module.exports = function registerRuneMysteriesQuest(api) {
  const { Animation, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  // NpcIdentifiers has no generated member for these legacy cache ids.
  const SEDRIDOR_CACHE_NPC_ID = 5034;
  const AUBURY_CACHE_NPC_ID = 2886;

  const DUKE_HORACIO_NPC_ID = NpcIdentifiers.DUKE_HORACIO;
  const SEDRIDOR_NPC_IDS = new Set([
    SEDRIDOR_CACHE_NPC_ID,
    NpcIdentifiers.ARCHMAGE_SEDRIDOR,
    NpcIdentifiers.ARCHMAGE_SEDRIDOR_2,
  ]);
  const AUBURY_NPC_IDS = new Set([
    AUBURY_CACHE_NPC_ID,
    NpcIdentifiers.AUBURY_2,
    NpcIdentifiers.AUBURY_3,
  ]);

  const AIR_TALISMAN_ITEM_ID = ItemIdentifiers.AIR_TALISMAN;
  const RESEARCH_PACKAGE_ITEM_ID = ItemIdentifiers.RESEARCH_PACKAGE;
  const RESEARCH_NOTES_ITEM_ID = ItemIdentifiers.RESEARCH_NOTES_4;

  const VARP_RUNE_MYSTERIES = 63;
  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 1;
  const STAGE_GIVEN_TALISMAN = 2;
  const STAGE_RECEIVED_PACKAGE = 3;
  const STAGE_GIVEN_PACKAGE = 4;
  const STAGE_RECEIVED_NOTES = 5;
  const STAGE_COMPLETE = 6;

  /** Temple of the Eye's stage attribute. Its tower/portal stages (6-25) give
   * Sedridor dialogue of their own, so Rune Mysteries must not shadow him there. */
  const TEMPLE_OF_THE_EYE_STAGE_ATTRIBUTE = "quest.temple_of_the_eye.stage";
  const TOTE_TOWER_STAGE = 60;
  const TOTE_COMPLETE_STAGE = 130;

  const TALISMAN_VARBIT = 13720; // cache runemysteries_talisman
  const TALISMAN_ATTRIBUTE = "rune-mysteries:talisman-received";
  const DOUBTED_ATTRIBUTE = "rune-mysteries:doubted-sedridor";
  const PACKAGE_ATTRIBUTE = "rune-mysteries:package-issued";
  const NOTES_ATTRIBUTE = "rune-mysteries:notes-issued";
  const DELIVERED_ATTRIBUTE = "rune-mysteries:notes-delivered";
  const pendingStart = new WeakSet();

  /** Transcript step ids (npc-dialogues.json action slugs). */
  const STEP_REPLACE_TALISMAN = "iRfiOS";
  const STEP_HAND_TALISMAN = new Set(["DvfTKd", "5_dl0N"]);
  const STEP_GIVE_PACKAGE = new Set(["-N0E2K", "UDdwCx", "786vQx"]);
  const STEP_HAND_PACKAGE = "44bs50";
  const STEP_GIVE_NOTES = new Set(["INsogy", "3o9zfG", "5g64gx"]);
  const STEP_TAKE_NOTES = "3-8qg3";

  /** Dialogue page names. */
  const PAGE_RUNE_MYSTERIES = "Rune Mysteries";
  const PAGE_ARCHMAGE_SEDRIDOR = "Archmage Sedridor";
  const PAGE_AUBURY = "Aubury";

  /** Dialogue variant names. */
  const VARIANT_DUKE_STARTING = "starting-off-talking-to-duke-horacio";
  const VARIANT_DUKE_AGAIN =
    "starting-off-talking-to-duke-horacio-talking-to-duke-horacio-again";
  const VARIANT_SEDRIDOR_BEFORE = "standard-dialogue-before-rune-mysteries";
  const VARIANT_SEDRIDOR_AFTER = "standard-dialogue-after-rune-mysteries";
  const VARIANT_TALISMAN_DELIVER = "delivering-the-talisman-talking-to-archmage-sedridor";
  const VARIANT_TALISMAN_RETURN =
    "delivering-the-talisman-talking-to-archmage-sedridor-talking-to-sedridor-again-after-not-having-the-talisman-when-first-going-through-the-dialogue";
  const VARIANT_TALISMAN_BEFORE_PACKAGE =
    "delivering-the-talisman-talking-to-archmage-sedridor-talking-to-sedridor-after-agreeing-to-go-see-aubury-but-before-receiving-the-package";
  const VARIANT_SEDRIDOR_AGAIN =
    "delivering-the-talisman-talking-to-archmage-sedridor-talking-to-sedridor-again";
  const VARIANT_NOTES_DELIVER = "delivering-the-research-notes-talking-to-sedridor";
  const VARIANT_PACKAGE_DELIVER = "delivering-the-research-package-talking-to-aubury";
  const VARIANT_PACKAGE_AFTER =
    "delivering-the-research-package-talking-to-aubury-talking-to-aubury-after-he-looked-through-the-package-but-before-he-hands-you-the-research-notes";
  const VARIANT_AUBURY_AGAIN =
    "delivering-the-research-package-talking-to-aubury-talking-to-aubury-again";
  const VARIANT_AUBURY_DEFAULT =
    "standard-dialogue-if-the-player-isn-t-carrying-a-combat-path-voucher-or-is-carrying-a-combat-path-voucher-and-has-received-all-possible-rewards-already";

  /** Condition text substrings (lowercased). */
  const CONDITION_LOST_TALISMAN = "lost the talisman";
  const CONDITION_NO_TALISMAN = "does not have the talisman";
  const CONDITION_NO_TALISMAN_APOS = "doesn't have the talisman";
  const CONDITION_DOES_HAVE_TALISMAN = "does have the talisman";
  const CONDITION_HAS_TALISMAN = "has the talisman";
  const CONDITION_LOST_PACKAGE = "lost the package";
  const CONDITION_NO_PACKAGE = "does not have the package";
  const CONDITION_HAS_PACKAGE = "has the package";
  const CONDITION_LOST_NOTES = "lost the notes";
  const CONDITION_NO_NOTES = "does not have the notes";
  const CONDITION_HAS_NOTES = "has the notes";
  const CONDITION_WITHOUT_DOUBTING = "without doubting";
  const CONDITION_WHILE_DOUBTING = "while doubting";

  const dukeLines = [
    "<str>I spoke to Duke Horacio and he showed me a strange</str>",
    "<str>talisman found by one of his subjects.</str>",
    "<str>I agreed to take it to the Wizards' Tower.</str>",
  ];

  const sedridorLines = [
    "<str>I gave the talisman to Archmage Sedridor and</str>",
    "<str>agreed to help with his research into rune stones.</str>",
  ];

  const auburyLines = [
    "<str>I took Sedridor's research package to Aubury</str>",
    "<str>in Varrock.</str>",
  ];

  let quest;

  function hasItem(player, itemId) {
    return player.getInventory().getAmount(itemId) > 0;
  }

  function isQuestNpc(npcId) {
    return (
      npcId === DUKE_HORACIO_NPC_ID || SEDRIDOR_NPC_IDS.has(npcId) || AUBURY_NPC_IDS.has(npcId)
    );
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        ...dukeLines,
        "",
        ...sedridorLines,
        "",
        ...auburyLines,
        "<str>I delivered Aubury's notes to Sedridor and learned</str>",
        "<str>the secret of the Rune Essence.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_RECEIVED_NOTES) {
      return [
        ...dukeLines,
        "",
        ...sedridorLines,
        "",
        ...auburyLines,
        hasItem(player, RESEARCH_NOTES_ITEM_ID)
          ? "I should take <col=800000>Aubury's notes</col> to <col=800000>Sedridor</col>."
          : "I should ask <col=800000>Aubury</col> for another copy of his notes.",
      ];
    }
    if (stage >= STAGE_GIVEN_PACKAGE) {
      return [
        ...dukeLines,
        "",
        ...sedridorLines,
        "",
        ...auburyLines,
        "I should speak to <col=800000>Aubury</col> again after he",
        "has examined the research package.",
      ];
    }
    if (stage >= STAGE_RECEIVED_PACKAGE) {
      return [
        ...dukeLines,
        "",
        ...sedridorLines,
        "",
        hasItem(player, RESEARCH_PACKAGE_ITEM_ID)
          ? "I should take the <col=800000>research package</col> to <col=800000>Aubury</col>"
          : "I should ask <col=800000>Sedridor</col> to recover the lost package.",
        "Aubury owns the rune shop in <col=800000>Varrock</col>.",
      ];
    }
    if (stage >= STAGE_GIVEN_TALISMAN) {
      return [
        ...dukeLines,
        "",
        "<str>I gave the talisman to Archmage Sedridor.</str>",
        "I should speak to <col=800000>Sedridor</col> again and offer",
        "to help with his research.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        ...dukeLines,
        "",
        "I need to find <col=800000>Archmage Sedridor</col> in the cellar",
        "of the <col=800000>Wizards' Tower</col> and give him the talisman.",
      ];
    }
    return [
      "I can start this quest by speaking to",
      "<col=800000>Duke Horacio</col>, upstairs in",
      "<col=800000>Lumbridge Castle</col>.",
      "",
      "There aren't any requirements for this quest.",
    ];
  }

  /** True while Temple of the Eye is in progress at the stages where it owns
   * Sedridor's dialogue (its tower and portal stages, 6-25). */
  function templeOfTheEyeUsesSedridor(player) {
    const stage = Number(player.getAttribute(TEMPLE_OF_THE_EYE_STAGE_ATTRIBUTE)) || 0;
    return stage >= TOTE_TOWER_STAGE && stage < TOTE_COMPLETE_STAGE;
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (npcId === DUKE_HORACIO_NPC_ID) {
      // The Duke is shared with Dragon Slayer I and other quests. Rune Mysteries
      // only owns his dialogue before/at the talisman handover; after that its
      // "again" page has no valid branch (both guards are stage-1 only). Defer
      // to another active quest, otherwise the shared flat Duke page, which
      // carries the real mid-quest/talisman-recovery/shield lines.
      if (stage >= STAGE_COMPLETE) return null;
      if (stage === STAGE_NOT_STARTED) {
        return { page: PAGE_RUNE_MYSTERIES, variant: VARIANT_DUKE_STARTING };
      }
      if (stage >= STAGE_GIVEN_TALISMAN) return null;
      return { page: PAGE_RUNE_MYSTERIES, variant: VARIANT_DUKE_AGAIN };
    }

    if (SEDRIDOR_NPC_IDS.has(npcId)) {
      if (stage === STAGE_NOT_STARTED) {
        return { page: PAGE_ARCHMAGE_SEDRIDOR, variant: VARIANT_SEDRIDOR_BEFORE };
      }
      if (stage >= STAGE_COMPLETE) {
        // Temple of the Eye is still using Sedridor; let its variants play.
        if (templeOfTheEyeUsesSedridor(player)) return null;
        return { page: PAGE_ARCHMAGE_SEDRIDOR, variant: VARIANT_SEDRIDOR_AFTER };
      }
      if (stage === STAGE_STARTED) {
        return hasItem(player, AIR_TALISMAN_ITEM_ID)
          ? { page: PAGE_RUNE_MYSTERIES, variant: VARIANT_TALISMAN_DELIVER }
          : { page: PAGE_RUNE_MYSTERIES, variant: VARIANT_TALISMAN_RETURN };
      }
      if (stage === STAGE_GIVEN_TALISMAN) {
        return { page: PAGE_RUNE_MYSTERIES, variant: "delivering-the-talisman-talking-to-archmage-sedridor-talking-to-sedridor-after-giving-him-the-talisman-but-before-agreeing-to-go-see-aubury" };
      }
      if (stage === STAGE_RECEIVED_PACKAGE && !player.getAttribute(PACKAGE_ATTRIBUTE) && !hasItem(player, RESEARCH_PACKAGE_ITEM_ID)) {
        return { page: PAGE_RUNE_MYSTERIES, variant: VARIANT_TALISMAN_BEFORE_PACKAGE };
      }
      if (stage === STAGE_RECEIVED_PACKAGE || stage === STAGE_GIVEN_PACKAGE) {
        return { page: PAGE_RUNE_MYSTERIES, variant: VARIANT_SEDRIDOR_AGAIN };
      }
      // Receiving the notes and handing them over completes the quest.
      return { page: PAGE_RUNE_MYSTERIES, variant: VARIANT_NOTES_DELIVER };
    }

    if (AUBURY_NPC_IDS.has(npcId)) {
      if (stage === STAGE_RECEIVED_PACKAGE) {
        return { page: PAGE_RUNE_MYSTERIES, variant: VARIANT_PACKAGE_DELIVER };
      }
      if (stage === STAGE_GIVEN_PACKAGE) {
        return { page: PAGE_RUNE_MYSTERIES, variant: "delivering-the-research-package-talking-to-aubury-talking-to-aubury-after-giving-him-the-package-but-before-he-goes-through-it" };
      }
      if (stage === STAGE_RECEIVED_NOTES && !player.getAttribute(NOTES_ATTRIBUTE) && !hasItem(player, RESEARCH_NOTES_ITEM_ID)) {
        return { page: PAGE_RUNE_MYSTERIES, variant: VARIANT_PACKAGE_AFTER };
      }
      if (stage === STAGE_RECEIVED_NOTES) {
        return { page: PAGE_RUNE_MYSTERIES, variant: VARIANT_AUBURY_AGAIN };
      }
      return { page: PAGE_AUBURY, variant: VARIANT_AUBURY_DEFAULT };
    }

    return null;
  }

  function answerCondition({ npcId, player, text }) {
    if (!isQuestNpc(npcId)) return null;
    const stage = quest.getStage(player);
    const value = String(text).toLowerCase();
    const inDelivery = stage === STAGE_STARTED;
    const talisman = hasItem(player, AIR_TALISMAN_ITEM_ID);
    const pkg = hasItem(player, RESEARCH_PACKAGE_ITEM_ID);
    const notes = hasItem(player, RESEARCH_NOTES_ITEM_ID) || Boolean(player.getAttribute(DELIVERED_ATTRIBUTE));

    if (value.includes(CONDITION_LOST_TALISMAN)) return inDelivery && !talisman;
    if (value.includes(CONDITION_NO_TALISMAN) || value.includes(CONDITION_NO_TALISMAN_APOS)) {
      return inDelivery && !talisman;
    }
    if (value.includes(CONDITION_DOES_HAVE_TALISMAN)) return inDelivery && talisman;
    if (value.includes(CONDITION_HAS_TALISMAN)) return inDelivery && talisman;

    if (value.includes(CONDITION_LOST_PACKAGE)) return stage === STAGE_RECEIVED_PACKAGE && !pkg;
    if (value.includes(CONDITION_NO_PACKAGE)) return stage === STAGE_RECEIVED_PACKAGE && !pkg;
    if (value.includes(CONDITION_HAS_PACKAGE)) return stage === STAGE_RECEIVED_PACKAGE && pkg;

    if (value.includes(CONDITION_LOST_NOTES)) return stage === STAGE_RECEIVED_NOTES && !notes;
    if (value.includes(CONDITION_NO_NOTES)) return stage === STAGE_RECEIVED_NOTES && !notes;
    if (value.includes(CONDITION_HAS_NOTES)) return stage === STAGE_RECEIVED_NOTES && notes;

    // Prefer the clean "end" branch over the dangling "call" continuation.
    if (value.includes(CONDITION_WITHOUT_DOUBTING)) return !player.getAttribute(DOUBTED_ATTRIBUTE);
    if (value.includes(CONDITION_WHILE_DOUBTING)) return Boolean(player.getAttribute(DOUBTED_ATTRIBUTE));

    return null;
  }

  // "Yes." on "Start the Rune Mysteries quest?" carries this slug.
  function handleStartHook({ player, npcId, hook }) {
    if (npcId === DUKE_HORACIO_NPC_ID && hook === "quest:rune-mysteries:start" && quest.getStage(player) === 0) pendingStart.add(player);
  }

  function handleChoice({ player, npcId, option }) {
    if (SEDRIDOR_NPC_IDS.has(npcId) && String(option).startsWith("No,") && String(option).includes("Sedridor")) player.setAttribute(DOUBTED_ATTRIBUTE, 1);
  }

  function handleLine(event) {
    const { player, npcId, text } = event;
    if (npcId === DUKE_HORACIO_NPC_ID && text === "Sure, no problem." && pendingStart.has(player)) {
      event.after = () => { pendingStart.delete(player); if (!quest.isStarted(player)) quest.setStage(player, STAGE_STARTED); };
    }
    if (SEDRIDOR_NPC_IDS.has(npcId) && text === "Yes, certainly.") {
      event.after = () => { if (quest.getStage(player) === STAGE_GIVEN_TALISMAN) quest.setStage(player, STAGE_RECEIVED_PACKAGE); };
    }
    if (AUBURY_NPC_IDS.has(npcId) && text.startsWith("Here, take these notes back to Sedridor.")) {
      event.before = () => { if (quest.getStage(player) === STAGE_GIVEN_PACKAGE) quest.setStage(player, STAGE_RECEIVED_NOTES); };
    }
    if (AUBURY_NPC_IDS.has(npcId) && text === "I'd love a cup of tea.") event.after = () => {
      player.sendMessage("Aubury hands you a cup of tea.");
      player.performAnimation(new Animation(829));
      player.getPacketSender().sendSoundEffect(2401, 1, 0);
    };
  }

  // Resume the actual imported conversation after interrupted handovers.
  function tailAfter(steps, id) {
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].id === id) return [...(steps[i].steps ?? []), ...steps.slice(i + 1)];
      for (const nested of [steps[i].steps, ...(steps[i].options ?? []).map(o => o.steps)]) {
        const found = nested && tailAfter(nested, id); if (found) return found;
      }
    }
    return null;
  }

  function handleAction(event) {
    if (!isQuestNpc(event.npcId)) return;
    const { player, stepId } = event;
    const stage = quest.getStage(player);

    if (stepId === "3lxHRr") { event.box = { items: [AIR_TALISMAN_ITEM_ID] }; return; }
    if (stepId === "EpfUcz" || stepId === "134Rji" || stepId === "5g64gx") {
      const variant = stepId === "EpfUcz" ? VARIANT_TALISMAN_DELIVER : VARIANT_PACKAGE_DELIVER;
      const anchor = stepId === "EpfUcz" ? "DvfTKd" : stepId === "134Rji" ? "44bs50" : "INsogy";
      startTranscript(api, player, event.npcId, PAGE_RUNE_MYSTERIES, variant,
        steps => stepId === "5g64gx" ? [{ type: "message", text: "Aubury hands you some research notes.", id: "INsogy" }] : tailAfter(steps, anchor));
      event.handled = true; return;
    }
    if (stepId === "G8M8tV") {
      event.handled = true;
      if (stage !== STAGE_STARTED || hasItem(player, AIR_TALISMAN_ITEM_ID)) return;
      if (player.getInventory().isFull()) { player.sendMessage("You need a free inventory space for the talisman."); event.end = true; return; }
      player.getInventory().adds(AIR_TALISMAN_ITEM_ID, 1);
      player.setAttribute(TALISMAN_ATTRIBUTE, 1);
      player.getPacketSender().sendVarbit(TALISMAN_VARBIT, 1);
      event.box = { items: [AIR_TALISMAN_ITEM_ID] }; return;
    }
    // Duke replaces a lost talisman (the hand-over message still prints).
    if (stepId === STEP_REPLACE_TALISMAN) {
      event.box = { items: [AIR_TALISMAN_ITEM_ID] };
      if (stage === STAGE_STARTED && !hasItem(player, AIR_TALISMAN_ITEM_ID)) {
        if (player.getInventory().isFull()) {
          player.sendMessage("Make some room and I will replace the talisman for you.");
        } else {
          player.getInventory().adds(AIR_TALISMAN_ITEM_ID, 1);
        }
      }
      return;
    }

    // Handing the talisman to Sedridor.
    if (STEP_HAND_TALISMAN.has(stepId)) {
      event.box = { items: [AIR_TALISMAN_ITEM_ID] };
      if (stage === STAGE_STARTED && hasItem(player, AIR_TALISMAN_ITEM_ID)) {
        player.getInventory().deleteNumber(AIR_TALISMAN_ITEM_ID, 1);
        quest.setStage(player, STAGE_GIVEN_TALISMAN);
      }
      return;
    }

    if (stepId === "Lq9FZ3" || stepId === "K0zo47") {
      event.box = { items: [AIR_TALISMAN_ITEM_ID] };
      player.getPacketSender().sendSoundEffect(142, 1, 0); return;
    }
    if (stepId === "FAcf6y") { event.box = { items: [RESEARCH_PACKAGE_ITEM_ID] }; return; }
    // Sedridor hands over (or recovers) the research package.
    if (STEP_GIVE_PACKAGE.has(stepId)) {
      if (stage < STAGE_GIVEN_TALISMAN || stage > STAGE_RECEIVED_PACKAGE) return;
      event.box = { items: [RESEARCH_PACKAGE_ITEM_ID] };
      if (!hasItem(player, RESEARCH_PACKAGE_ITEM_ID)) {
        if (player.getInventory().isFull()) {
          player.sendMessage("Make some room in your inventory and speak to me again for the package.");
        } else {
          player.getInventory().adds(RESEARCH_PACKAGE_ITEM_ID, 1);
          player.setAttribute(PACKAGE_ATTRIBUTE, 1);
          if (stage < STAGE_RECEIVED_PACKAGE) quest.setStage(player, STAGE_RECEIVED_PACKAGE);
        }
      }
      return;
    }

    // Handing the package to Aubury.
    if (stepId === STEP_HAND_PACKAGE) {
      event.box = { items: [RESEARCH_PACKAGE_ITEM_ID] };
      if (stage === STAGE_RECEIVED_PACKAGE && hasItem(player, RESEARCH_PACKAGE_ITEM_ID)) {
        player.getInventory().deleteNumber(RESEARCH_PACKAGE_ITEM_ID, 1);
        quest.setStage(player, STAGE_GIVEN_PACKAGE);
      }
      return;
    }

    // Aubury hands over (or recovers) his research notes.
    if (STEP_GIVE_NOTES.has(stepId)) {
      if (stage < STAGE_GIVEN_PACKAGE || stage > STAGE_RECEIVED_NOTES || player.getAttribute(DELIVERED_ATTRIBUTE)) return;
      event.box = { items: [RESEARCH_NOTES_ITEM_ID] };
      if (!hasItem(player, RESEARCH_NOTES_ITEM_ID)) {
        if (player.getInventory().isFull()) {
          player.sendMessage("Make some room in your inventory and speak to me again for the notes.");
        } else {
          player.getInventory().adds(RESEARCH_NOTES_ITEM_ID, 1);
          player.setAttribute(NOTES_ATTRIBUTE, 1);
          if (stage < STAGE_RECEIVED_NOTES) quest.setStage(player, STAGE_RECEIVED_NOTES);
        }
      }
      return;
    }

    if (stepId === "XMgO9a") {
      event.box = { items: [RESEARCH_NOTES_ITEM_ID] };
      if (stage === STAGE_RECEIVED_NOTES && hasItem(player, RESEARCH_NOTES_ITEM_ID) && !player.getAttribute(DELIVERED_ATTRIBUTE)) {
        player.getInventory().deleteNumber(RESEARCH_NOTES_ITEM_ID, 1);
        player.setAttribute(DELIVERED_ATTRIBUTE, 1);
      }
      return;
    }
    // Completion follows the entire explanation, after the notes handover.
    if (stepId === STEP_TAKE_NOTES) {
      if (stage === STAGE_RECEIVED_NOTES && player.getAttribute(DELIVERED_ATTRIBUTE)) quest.complete(player);
      event.handled = true;
      event.end = true;
      return;
    }
  }

  function restoreTalismanFlag({ player }) {
    player.getPacketSender().sendVarbit(TALISMAN_VARBIT, Number(Boolean(player.getAttribute(TALISMAN_ATTRIBUTE)) || quest.isStarted(player)));
  }

  quest = registerQuest(api, {
    key: "rune_mysteries",
    name: "Rune Mysteries",
    varpId: VARP_RUNE_MYSTERIES,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    completionJingleId: 154,
    rewardItemId: AIR_TALISMAN_ITEM_ID,
    rewardItemLabel: "An Air Talisman",
    otherRewards: ["Rune Essence Mine Access"],
    buildJournal,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onPlayerLogin(restoreTalismanFlag);
  api.persistAttribute(TALISMAN_ATTRIBUTE, 0);
  api.persistAttribute(DOUBTED_ATTRIBUTE, 0);
  api.persistAttribute(PACKAGE_ATTRIBUTE, 0);
  api.persistAttribute(NOTES_ATTRIBUTE, 0);
  api.persistAttribute(DELIVERED_ATTRIBUTE, 0);
};
