/**
 * Murder Mystery (members).
 *
 * The words come from the "Murder Mystery" transcript page. This plugin supplies
 * the guard / suspect / poison-salesman variant selector, the start hook, the
 * prose-condition answers, the physical evidence gathering (smashed window,
 * barrels, flour, flypaper), the flour / flypaper fingerprint recipes, the poison
 * salesman proof and the guard's completion action.
 *
 * Stages (varp 192): 0 not started, 1 started, 2 complete. Extra state is kept in
 * player attributes (murderer, poison proof, evidence flags) because the wiki's
 * 193/194/195 varps are not read by this runtime.
 *
 * Gaps (no dump/index support): the crime-scene criminal's dagger and pungent pot
 * are not spawned on the ground by this plugin, and the flying-fingerprint chain
 * needs the dagger's unknown print, so the fingerprint evidence is only reachable
 * if those items enter the world another way. The dog-gate / gate-sacks / drain
 * objects with unnamed ids (2662/2664/2665/26109/2653/2651/26120/2634) are not in
 * ObjectIdentifiers and are skipped.
 */
module.exports = function registerMurderMysteryQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const GUARD_IDS = new Set([NpcIdentifiers.GUARD_61]);
  const ANNA_ID = NpcIdentifiers.ANNA_3;
  const BOB_ID = NpcIdentifiers.BOB_5;
  const CAROL_ID = NpcIdentifiers.CAROL;
  const DAVID_ID = NpcIdentifiers.DAVID_2;
  const DAVID_ALT_ID = NpcIdentifiers.DAVID;
  const ELIZABETH_ID = NpcIdentifiers.ELIZABETH;
  const FRANK_ID = NpcIdentifiers.FRANK;
  const GOSSIP_ID = NpcIdentifiers.GOSSIP;
  const POISON_SALESMAN_ID = NpcIdentifiers.POISON_SALESMAN;
  const DONOVAN_ID = NpcIdentifiers.DONOVAN_THE_FAMILY_HANDYMAN;
  const PIERRE_ID = NpcIdentifiers.PIERRE;
  const HOBBES_ID = NpcIdentifiers.HOBBES;
  const LOUISA_ID = NpcIdentifiers.LOUISA;
  const MARY_ID = NpcIdentifiers.MARY;
  const STANFORD_ID = NpcIdentifiers.STANFORD;

  const SMASHED_WINDOW_IDS = [
    ObjectIdentifiers.SMASHED_WINDOW,
    ObjectIdentifiers.SMASHED_WINDOW_2,
    ObjectIdentifiers.WINDOW_9,
  ];
  const FLOUR_BARREL_ID = ObjectIdentifiers.BARREL_OF_FLOUR_2;
  const FLYPAPER_SACKS_ID = ObjectIdentifiers.SACKS_6;

  const VARP_MURDER_MYSTERY = 192;
  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 1;
  const STAGE_COMPLETE = 2;

  const POISON_SALESMAN_QUESTIONED = 1;
  const POISON_MURDERER_QUESTIONED = 2;
  const POISON_LOCATION_CHECKED = 3;
  const EVIDENCE_THREAD = 1 << 1;
  const EVIDENCE_FINGERPRINTS = 1 << 2;

  const EV_ATTR = "quest.murder_mystery.evidence";
  const POISON_ATTR = "quest.murder_mystery.poison";
  const MURDERER_ATTR = "quest.murder_mystery.murderer";

  const ITEM = ItemIdentifiers;
  const POT = ITEM.POT;

  const MURDERERS = [
    {
      id: 1, name: "Anna", npcId: ANNA_ID,
      original: ITEM.SILVER_NECKLACE, dusted: ITEM.SILVER_NECKLACE_2, print: ITEM.ANNAS_PRINT,
      thread: ITEM.CRIMINALS_THREAD_2, barrelId: ObjectIdentifiers.ANNAS_BARREL,
      poisonLocId: ObjectIdentifiers.SINCLAIR_FAMILY_COMPOST_HEAP, poisonTarget: "compost heap",
    },
    {
      id: 2, name: "Bob", npcId: BOB_ID,
      original: ITEM.SILVER_CUP, dusted: ITEM.SILVER_CUP_2, print: ITEM.BOBS_PRINT,
      thread: ITEM.CRIMINALS_THREAD, barrelId: ObjectIdentifiers.BOBS_BARREL,
      poisonLocId: ObjectIdentifiers.SINCLAIR_FAMILY_BEEHIVE, poisonTarget: "beehive",
    },
    {
      id: 3, name: "Carol", npcId: CAROL_ID,
      original: ITEM.SILVER_BOTTLE, dusted: ITEM.SILVER_BOTTLE_2, print: ITEM.CAROLS_PRINT,
      thread: ITEM.CRIMINALS_THREAD, barrelId: ObjectIdentifiers.CAROLS_BARREL,
      poisonLocId: ObjectIdentifiers.SINCLAIR_MANSION_DRAIN, poisonTarget: "drain",
    },
    {
      id: 4, name: "David", npcId: DAVID_ID,
      original: ITEM.SILVER_BOOK, dusted: ITEM.SILVER_BOOK_2, print: ITEM.DAVIDS_PRINT,
      thread: ITEM.CRIMINALS_THREAD_2, barrelId: ObjectIdentifiers.DAVIDS_BARREL,
      poisonLocId: ObjectIdentifiers.SPIDERS_NEST, poisonTarget: "spiders' nest",
    },
    {
      id: 5, name: "Elizabeth", npcId: ELIZABETH_ID,
      original: ITEM.SILVER_NEEDLE, dusted: ITEM.SILVER_NEEDLE_2, print: ITEM.ELIZABETHS_PRINT,
      thread: ITEM.CRIMINALS_THREAD_3, barrelId: ObjectIdentifiers.ELIZABETHS_BARREL,
      poisonLocId: ObjectIdentifiers.SINCLAIR_FAMILY_FOUNTAIN, poisonTarget: "fountain",
    },
    {
      id: 6, name: "Frank", npcId: FRANK_ID,
      original: ITEM.SILVER_POT, dusted: ITEM.SILVER_POT_2, print: ITEM.FRANKS_PRINT,
      thread: ITEM.CRIMINALS_THREAD_3, barrelId: ObjectIdentifiers.FRANKS_BARREL,
      poisonLocId: ObjectIdentifiers.SINCLAIR_FAMILY_CREST, poisonTarget: "family crest",
    },
  ];

  /** Murder Mystery page -> the variant name fragment for each speaker. */
  const SPEAKER_FRAGMENT = new Map([
    [ANNA_ID, "anna"], [BOB_ID, "bob"], [CAROL_ID, "carol"], [DAVID_ID, "david"],
    [DAVID_ALT_ID, "david"], [ELIZABETH_ID, "elizabeth"], [FRANK_ID, "frank"],
    [GOSSIP_ID, "gossip"], [DONOVAN_ID, "donovan"], [PIERRE_ID, "pierre"],
    [HOBBES_ID, "hobbes"], [LOUISA_ID, "louisa"], [MARY_ID, "mary"], [STANFORD_ID, "stanford"],
  ]);

  const FAMILY_IDS = new Set([ANNA_ID, CAROL_ID, ELIZABETH_ID, MARY_ID]);
  const MEN_IDS = new Set([BOB_ID, DAVID_ID, DAVID_ALT_ID, FRANK_ID]);
  const SERVANT_IDS = new Set([DONOVAN_ID, PIERRE_ID, HOBBES_ID, LOUISA_ID, MARY_ID, STANFORD_ID]);
  const SERVANTS_WITH_BEFORE = new Set([DONOVAN_ID, PIERRE_ID, HOBBES_ID, LOUISA_ID, STANFORD_ID]);

  let quest;

  const attr = (player, key) => Number(player.getAttribute(key)) || 0;
  const setAttr = (player, key, value) => player.setAttribute(key, value);
  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const hasAny = (player, itemIds) => itemIds.some((itemId) => has(player, itemId));
  const murderer = (player) => MURDERERS[(attr(player, MURDERER_ATTR) || 1) - 1] ?? MURDERERS[0];

  function setEvidence(player, flag) {
    setAttr(player, EV_ATTR, attr(player, EV_ATTR) | flag);
  }

  function conclusiveEvidence(player) {
    const evidence = attr(player, EV_ATTR);
    return (evidence & EVIDENCE_THREAD) !== 0 &&
      (evidence & EVIDENCE_FINGERPRINTS) !== 0 &&
      attr(player, POISON_ATTR) >= POISON_LOCATION_CHECKED;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I gathered three independent pieces of evidence.</str>",
        "<str>I identified Lord Sinclair's murderer.</str>",
        "<col=ff0000>Quest complete!</col>",
      ];
    }
    if (stage < STAGE_STARTED) {
      return [
        "I can start this quest by speaking to a",
        "<col=800000>guard<col=000080> outside the Sinclair Mansion.",
      ];
    }
    const evidence = attr(player, EV_ATTR);
    return [
      "The guards asked me to investigate Lord Sinclair's murder.",
      (evidence & EVIDENCE_THREAD) !== 0
        ? "<str>I found coloured thread at the broken window.</str>"
        : "I should investigate the broken study window.",
      (evidence & EVIDENCE_FINGERPRINTS) !== 0
        ? "<str>I matched a family member's prints to the dagger.</str>"
        : "I should compare fingerprints from the dagger and silver belongings.",
      attr(player, POISON_ATTR) >= POISON_LOCATION_CHECKED
        ? "<str>I proved one family member lied about using poison.</str>"
        : "I should ask the poison salesman and inspect where each suspect used poison.",
      "When all three clues agree, I should report to the guard.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 1406);
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (GUARD_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return "post-quest-talking-to-the-guard-after-the-quest";
      if (stage === STAGE_NOT_STARTED) return "getting-started-talking-to-guard";
      if (conclusiveEvidence(player)) {
        return "presenting-the-evidence-talking-to-the-guard-with-all-evidence";
      }
      if (attr(player, EV_ATTR) !== 0 || attr(player, POISON_ATTR) !== 0) {
        return "presenting-the-evidence-talking-to-the-guard-with-some-but-not-all-evidence";
      }
      return "getting-started-talking-to-the-guard-after-starting-the-quest";
    }
    if (npcId === POISON_SALESMAN_ID) {
      if (stage === STAGE_STARTED) return "visiting-the-poison-salesman-talking-to-the-poison-salesman";
      if (stage >= STAGE_COMPLETE) return "post-quest-talking-to-the-poison-salesman-after-the-quest";
      return null;
    }
    const fragment = SPEAKER_FRAGMENT.get(npcId);
    if (!fragment) return null;
    if (stage === STAGE_STARTED) return `questioning-the-inhabitants-talking-to-${fragment}`;
    if (stage >= STAGE_COMPLETE) {
      if (npcId === GOSSIP_ID) return "post-quest-talking-to-gossip-after-the-quest";
      if (npcId === PIERRE_ID) return null; // no post-quest transcript variant
      return `post-quest-talking-to-${fragment}-after-the-quest`;
    }
    // Not started: only some NPCs have a "before starting" snub variant.
    if (SERVANTS_WITH_BEFORE.has(npcId)) return `before-starting-talking-to-${fragment}`;
    if (FAMILY_IDS.has(npcId)) return "before-starting-talking-to-anna-carol-mary-or-elizabeth";
    if (MEN_IDS.has(npcId)) return "before-starting-talking-to-frank-david-or-bob";
    return null;
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("criminal's thread is red")) return murderer(player).thread === ITEM.CRIMINALS_THREAD;
    if (value.includes("thread isn't red")) return murderer(player).thread !== ITEM.CRIMINALS_THREAD;
    if (value.includes("full inventory")) return player.getInventory().isFull?.() === true;
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!GUARD_IDS.has(npcId) || hook !== "quest:murder-mystery:start") return;
    if (quest.getStage(player) !== STAGE_NOT_STARTED) return;
    const selected = ((Number(player.getId?.()) || 0) % MURDERERS.length) + 1;
    setAttr(player, MURDERER_ATTR, selected);
    setAttr(player, POISON_ATTR, 0);
    setAttr(player, EV_ATTR, 0);
    quest.setStage(player, STAGE_STARTED);
  }

  function handleAction({ player, npcId, stepId }) {
    if (!GUARD_IDS.has(npcId) || stepId !== "uvOs6C") return;
    if (quest.isComplete(player)) return;
    setAttr(player, MURDERER_ATTR, 0);
    setAttr(player, POISON_ATTR, 0);
    setAttr(player, EV_ATTR, 0);
    quest.complete(player);
  }

  function investigationBlocked(player) {
    if (quest.getStage(player) !== STAGE_STARTED) {
      player.sendMessage("You need the guard's permission to investigate.");
      return true;
    }
    return false;
  }

  /** Coloured thread is caught on the smashed study window. */
  function handleWindow(event) {
    if (!SMASHED_WINDOW_IDS.includes(event.objectId)) return;
    const { player } = event;
    if (investigationBlocked(player)) return;
    const thread = murderer(player).thread;
    if (!has(player, thread) && !player.getInventory().isFull()) player.getInventory().adds(thread, 1);
    setEvidence(player, EVIDENCE_THREAD);
    player.sendMessage("You take coloured thread caught on a nail in the smashed window.");
    event.handled = true;
  }

  /** Each suspect's barrel hides a silver belonging. */
  function handleBarrel(event) {
    const suspect = MURDERERS.find((entry) => entry.barrelId === event.objectId);
    if (!suspect) return;
    const { player } = event;
    if (investigationBlocked(player)) return;
    if (has(player, suspect.original) || has(player, suspect.dusted) || has(player, suspect.print)) {
      player.sendMessage(`You already took ${suspect.name}'s silver belonging.`);
      event.handled = true;
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory slot.");
      event.handled = true;
      return;
    }
    player.getInventory().adds(suspect.original, 1);
    player.sendMessage(`You find ${suspect.name}'s silver belonging in the barrel.`);
    event.handled = true;
  }

  function handleFlourBarrel(event) {
    if (event.objectId !== FLOUR_BARREL_ID) return;
    const { player } = event;
    if (investigationBlocked(player)) return;
    if (!has(player, POT)) {
      player.sendMessage("You need an empty pot to hold the flour.");
      event.handled = true;
      return;
    }
    player.getInventory().deleteNumber(POT, 1);
    player.getInventory().adds(ITEM.POT_OF_FLOUR, 1);
    player.sendMessage("You fill the pot with finely sifted flour.");
    event.handled = true;
  }

  function handleFlypaperSacks(event) {
    if (event.objectId !== FLYPAPER_SACKS_ID) return;
    const { player } = event;
    if (investigationBlocked(player)) return;
    if (!has(player, ITEM.FLYPAPER) && !player.getInventory().isFull()) {
      player.getInventory().adds(ITEM.FLYPAPER, 1);
      player.sendMessage("You take a piece of sticky flypaper.");
    }
    event.handled = true;
  }

  /** Flour + silver -> empty pot + dusted item; flypaper + dusted -> original + print. */
  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const ids = [usedItemId, usedWithItemId];
    if (ids.includes(ITEM.POT_OF_FLOUR)) {
      const proof = MURDERERS.find((entry) => ids.includes(entry.original));
      if (!proof) return;
      player.getInventory().deleteNumber(ITEM.POT_OF_FLOUR, 1);
      player.getInventory().deleteNumber(proof.original, 1);
      player.getInventory().adds(POT, 1);
      player.getInventory().adds(proof.dusted, 1);
      player.sendMessage(`You coat ${proof.name}'s silver with a thin layer of flour.`);
      event.handled = true;
      return;
    }
    if (ids.includes(ITEM.FLYPAPER)) {
      const proof = MURDERERS.find((entry) => ids.includes(entry.dusted));
      if (!proof) return;
      player.getInventory().deleteNumber(ITEM.FLYPAPER, 1);
      player.getInventory().deleteNumber(proof.dusted, 1);
      player.getInventory().adds(proof.original, 1);
      player.getInventory().adds(proof.print, 1);
      player.sendMessage(`You lift a clean fingerprint from ${proof.name}'s silver.`);
      event.handled = true;
      return;
    }
    if (ids.includes(ITEM.UNKNOWN_PRINT)) {
      const suspect = MURDERERS.find((entry) => ids.includes(entry.print));
      if (!suspect) return;
      if (attr(player, MURDERER_ATTR) !== suspect.id) {
        player.getInventory().deleteNumber(suspect.print, 1);
        player.sendMessage(`The prints do not match. This clears ${suspect.name}.`);
        event.handled = true;
        return;
      }
      player.getInventory().deleteNumber(ITEM.UNKNOWN_PRINT, 1);
      player.getInventory().deleteNumber(suspect.print, 1);
      player.getInventory().adds(ITEM.KILLERS_PRINT, 1);
      setEvidence(player, EVIDENCE_FINGERPRINTS);
      player.sendMessage(`${suspect.name}'s fingerprints exactly match those on the murder weapon.`);
      event.handled = true;
    }
  }

  /** The poison salesman reveals who bought poison; talking to a suspect advances. */
  function handlePoisonSalesman({ player, npcId }) {
    if (npcId !== POISON_SALESMAN_ID) return;
    if (quest.getStage(player) !== STAGE_STARTED) return;
    if (attr(player, POISON_ATTR) < POISON_SALESMAN_QUESTIONED) {
      setAttr(player, POISON_ATTR, POISON_SALESMAN_QUESTIONED);
    }
  }

  function handlePoisonLocation(event) {
    const suspect = MURDERERS.find((entry) => entry.poisonLocId === event.objectId);
    if (!suspect) return;
    const { player } = event;
    if (investigationBlocked(player)) return;
    if (attr(player, POISON_ATTR) < POISON_MURDERER_QUESTIONED) {
      player.sendMessage(`It is the Sinclair ${suspect.poisonTarget}.`);
      event.handled = true;
      return;
    }
    if (attr(player, MURDERER_ATTR) === suspect.id) {
      setAttr(player, POISON_ATTR, POISON_LOCATION_CHECKED);
      player.sendMessage(`The ${suspect.poisonTarget} is untouched. ${suspect.name} lied about using poison here.`);
    } else {
      player.sendMessage(`The ${suspect.poisonTarget} shows clear traces of recently used poison.`);
    }
    event.handled = true;
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "murder_mystery",
    name: "Murder Mystery",
    varpId: VARP_MURDER_MYSTERY,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 3,
    xpRewards: [{ skillId: Skill.CRAFTING.getIndex(), amount: 1406, label: "Crafting" }],
    rewardItemId: ItemIdentifiers.COINS,
    rewardItemLabel: "2,000 coins",
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(EV_ATTR);
  api.persistAttribute(POISON_ATTR);
  api.persistAttribute(MURDERER_ATTR);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onNpcInteraction(handlePoisonSalesman);
  api.onObjectInteraction(handleWindow);
  api.onObjectInteraction(handleBarrel);
  api.onObjectInteraction(handleFlourBarrel);
  api.onObjectInteraction(handleFlypaperSacks);
  api.onObjectInteraction(handlePoisonLocation);
  api.onItemOnItem(handleItemOnItem);
  api.onPlayerLogin(handleLogin);
};
