/** The Knight's Sword: revision 240 capture 20260817T113003 and the OSRS Wiki. */
module.exports = function registerKnightsSwordQuest(api) {
  const { Skill, Equipment, Location, GameObject, ObjectManager, Animation, CountdownTask, TaskManager, World, DialogueChainBuilder, ActionDialogue, StatementDialogue, ItemStatementDialogue, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  const SQUIRE_NPC_ID = NpcIdentifiers.SQUIRE_14;
  const THURGO_NPC_ID = NpcIdentifiers.THURGO;
  const RELDO_NPC_IDS = new Set([NpcIdentifiers.RELDO, NpcIdentifiers.RELDO_2]);

  const VARP_KNIGHTS_SWORD = 122;
  const STAGE_NOT_STARTED = 0;
  const STAGE_FIND_RELDO = 1;
  const STAGE_FIND_IMCANDO_DWARF = 2;
  const STAGE_GAVE_THURGO_PIE = 3;
  const STAGE_ASK_SQUIRE_FOR_PORTRAIT = 4;
  const STAGE_FIND_PORTRAIT = 5;
  const STAGE_FIND_MATERIALS = 6;
  const STAGE_COMPLETE = 7;

  const PORTRAIT_ITEM_ID = ItemIdentifiers.PORTRAIT;
  const BLURITE_SWORD_ITEM_ID = ItemIdentifiers.BLURITE_SWORD;
  const BLURITE_ORE_ITEM_ID = ItemIdentifiers.BLURITE_ORE;
  const REDBERRY_PIE_ITEM_ID = ItemIdentifiers.REDBERRY_PIE;
  const IRON_BAR_ITEM_ID = ItemIdentifiers.IRON_BAR;
  const GIANT_DWARF_PIE_ATTRIBUTE = "quest.giant_dwarf.pie";
  const SIR_VYVIN_NPC_ID = NpcIdentifiers.SIR_VYVIN;
  const GIANT_DWARF_AXE_ITEM_IDS = new Set([
    ItemIdentifiers.DWARVEN_BATTLEAXE,
    ItemIdentifiers.DWARVEN_BATTLEAXE_2,
    ItemIdentifiers.DWARVEN_BATTLEAXE_3,
    ItemIdentifiers.DWARVEN_BATTLEAXE_4,
  ]);

  const CUPBOARD_CLOSED_ID = ObjectIdentifiers.CUPBOARD_8;
  const CUPBOARD_OPEN_ID = ObjectIdentifiers.CUPBOARD_9;


  const QUEST_START_HOOK = "quest:the-knight-s-sword:start";
  const PIE_HANDOVER_MESSAGE_ID = "1U_fgy"; // "You hand over the pie."
  const PORTRAIT_GIVE_ACTION_ID = "3_D_pF"; // action "Portrait"
  const SWORD_SMITH_MESSAGE_ID = "7zBX9C"; // "You give the blurite ore and iron bars…"
  const SWORD_HANDIN_ACTION_ID = "7-huYO"; // action "Blurite sword"

  const PAGE_SQUIRE = "Squire";
  const PAGE_QUESTS = "The Knight's Sword";
  const PAGE_THURGO = "Thurgo";

  const VARIANT_AFTER_QUEST = "standard-dialogue-after-the-knight-s-sword";
  const VARIANT_SQUIRE_START = "talking-to-the-squire";
  const VARIANT_SQUIRE_EARLY =
    "talking-to-the-squire-talking-to-the-squire-again-after-starting-the-quest-but-before-talking-to-thurgo";
  const VARIANT_SQUIRE_AFTER_PIE = "talking-to-the-squire-after-giving-thurgo-a-redberry-pie";
  const VARIANT_SQUIRE_WITH_PORTRAIT =
    "talking-to-the-squire-after-giving-thurgo-a-redberry-pie-talking-to-the-squire-again-after-finding-the-portrait";
  const VARIANT_SQUIRE_WITHOUT_PORTRAIT =
    "talking-to-the-squire-after-giving-thurgo-a-redberry-pie-talking-to-the-squire-again-before-finding-the-portrait";
  const VARIANT_SQUIRE_GIVE_SWORD = "giving-the-sword-to-the-squire";
  const VARIANT_SQUIRE_BEFORE_SWORD = "creating-the-sword-talking-to-the-squire-before-making-the-sword";
  const VARIANT_THURGO_BEFORE_RELDO = "talking-to-the-squire-talking-to-thurgo-before-talking-to-reldo";
  const VARIANT_THURGO_WITH_PIE = "talking-to-thurgo-talking-to-thurgo-with-a-redberry-pie";
  const VARIANT_THURGO_WITHOUT_PIE = "talking-to-thurgo-talking-to-thurgo-without-a-redberry-pie";
  const VARIANT_THURGO_GIVE_PORTRAIT = "giving-thurgo-the-portrait";
  const VARIANT_THURGO_WITHOUT_PORTRAIT = "talking-to-thurgo-talking-to-thurgo-again-without-the-portrait";
  const VARIANT_SWORD_MADE = "creating-the-sword-after-the-sword-has-been-made";
  const VARIANT_SWORD_BOTH = "creating-the-sword-giving-both-the-iron-bars-and-blurite-to-thurgo";
  const VARIANT_SWORD_BARS_ONLY = "creating-the-sword-talking-to-thurgo-with-only-the-iron-bars";
  const VARIANT_SWORD_ORE_ONLY = "creating-the-sword-talking-to-thurgo-with-only-the-blurite";
  const VARIANT_SWORD_NO_MATERIALS = "creating-the-sword-talking-to-thurgo-without-the-materials";
  const VARIANT_RELDO = "talking-to-reldo";

  const CONDITION_NOT_MET_THURGO = "hasn't met thurgo";
  const CONDITION_MET_THURGO = "already met thurgo";
  const CONDITION_WITHOUT_10_MINING = "without 10 mining";
  const CONDITION_WIELDING_SWORD = "wielding the sword";
  const CONDITION_SWORD_IN_INVENTORY = "sword is in the player's inventory";
  const CONDITION_NOT_ALREADY_MET_THURGO = "hasn't already met thurgo";

  const CHOICE_IMCANDO_DWARVES = "What do you know about the Imcando dwarves?";
  const LINE_PICTURE_REQUEST = "Could you bring me a picture";

  let quest;

  const hasItem = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;

  const isWieldingSword = (player) =>
    player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() === BLURITE_SWORD_ITEM_ID;

  const ownsSword = (player) =>
    hasItem(player, BLURITE_SWORD_ITEM_ID) || isWieldingSword(player);

  function replaceObject(object, newId) {
    const location = object.getLocation();
    ObjectManager.deregister(object, true);
    ObjectManager.register(
      new GameObject(
        newId,
        new Location(location.getX(), location.getY(), location.getZ()),
        object.getType(),
        object.getFace(),
        object.getPrivateArea() ?? null
      ),
      true
    );
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage === STAGE_NOT_STARTED) {
      return [
        "I can start this quest by talking to the <col=800000>Squire</col>",
        "in the courtyard of the <col=800000>White Knights' Castle</col>.",
        "",
        "I need <col=800000>level 10 Mining</col> to obtain blurite ore.",
      ];
    }

    const lines = ["<str>I agreed to help replace Sir Vyvin's lost family sword.</str>", ""];
    if (stage === STAGE_FIND_RELDO) {
      lines.push("I should ask <col=800000>Reldo</col> in Varrock Palace about Imcando dwarves.");
    } else if (stage === STAGE_FIND_IMCANDO_DWARF) {
      lines.push(
        "Reldo said an Imcando dwarf lives on Asgarnia's southern peninsula.",
        "A <col=800000>redberry pie</col> may help me earn his trust."
      );
    } else if (stage === STAGE_GAVE_THURGO_PIE) {
      lines.push("I earned <col=800000>Thurgo's</col> trust. I should ask him to make the sword.");
    } else if (stage === STAGE_ASK_SQUIRE_FOR_PORTRAIT) {
      lines.push("Thurgo needs a picture. I should ask the <col=800000>Squire</col> where to find one.");
    } else if (stage === STAGE_FIND_PORTRAIT) {
      const carrying = hasItem(player, PORTRAIT_ITEM_ID);
      lines.push(
        carrying
          ? "<str>I found Sir Vyvin's portrait showing the sword.</str>"
          : "I need the <col=800000>portrait</col> from the cupboard in Sir Vyvin's room.",
        carrying
          ? "I should take it to <col=800000>Thurgo</col>."
          : "I must search it while Sir Vyvin is distracted."
      );
    } else if (stage === STAGE_FIND_MATERIALS) {
      if (ownsSword(player)) {
        lines.push(
          "<str>Thurgo made the replacement blurite sword.</str>",
          "I should return it to the <col=800000>Squire</col>."
        );
      } else {
        lines.push(
          "Thurgo needs <col=800000>one blurite ore</col> and <col=800000>two iron bars</col>.",
          "Blurite is found in the icy cave beneath the cliffs near his home."
        );
      }
    } else if (stage >= STAGE_COMPLETE) {
      lines.push(
        "<str>Thurgo made a replacement and I returned it to the Squire.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>"
      );
    }
    return lines;
  }

  function reward(player) {
    player.getSkillManager().addExperiences(Skill.SMITHING, 12725);
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (npcId === SQUIRE_NPC_ID) {
      if (stage >= STAGE_COMPLETE) {
        return { page: PAGE_SQUIRE, variant: VARIANT_AFTER_QUEST };
      }
      if (stage === STAGE_NOT_STARTED) {
        return { page: PAGE_QUESTS, variant: VARIANT_SQUIRE_START };
      }
      if (stage <= STAGE_FIND_IMCANDO_DWARF) {
        return { page: PAGE_QUESTS, variant: VARIANT_SQUIRE_EARLY };
      }
      if (stage <= STAGE_ASK_SQUIRE_FOR_PORTRAIT) {
        // Keep old stage-3 saves resumable; the line callback commits the portrait request.
        return { page: PAGE_QUESTS, variant: VARIANT_SQUIRE_AFTER_PIE };
      }
      if (stage === STAGE_FIND_PORTRAIT) {
        return hasItem(player, PORTRAIT_ITEM_ID)
          ? { page: PAGE_QUESTS, variant: VARIANT_SQUIRE_WITH_PORTRAIT }
          : { page: PAGE_QUESTS, variant: VARIANT_SQUIRE_WITHOUT_PORTRAIT };
      }
      return ownsSword(player)
        ? { page: PAGE_QUESTS, variant: VARIANT_SQUIRE_GIVE_SWORD }
        : { page: PAGE_QUESTS, variant: VARIANT_SQUIRE_BEFORE_SWORD };
    }

    if (npcId === THURGO_NPC_ID) {
      if (stage === STAGE_NOT_STARTED) return null;
      if (stage >= STAGE_COMPLETE) {
        return { page: PAGE_THURGO, variant: VARIANT_AFTER_QUEST };
      }
      if (stage === STAGE_FIND_RELDO) {
        return { page: PAGE_QUESTS, variant: VARIANT_THURGO_BEFORE_RELDO };
      }
      if (stage === STAGE_FIND_IMCANDO_DWARF) {
        return hasItem(player, REDBERRY_PIE_ITEM_ID)
          ? { page: PAGE_QUESTS, variant: VARIANT_THURGO_WITH_PIE }
          : { page: PAGE_QUESTS, variant: VARIANT_THURGO_WITHOUT_PIE };
      }
      if (stage <= STAGE_FIND_PORTRAIT) {
        if (stage === STAGE_FIND_PORTRAIT && hasItem(player, PORTRAIT_ITEM_ID)) {
          return { page: PAGE_QUESTS, variant: VARIANT_THURGO_GIVE_PORTRAIT };
        }
        return { page: PAGE_QUESTS, variant: VARIANT_THURGO_WITHOUT_PORTRAIT };
      }
      // Stage 6: pick by what the player is carrying.
      if (ownsSword(player)) {
        return { page: PAGE_QUESTS, variant: VARIANT_SWORD_MADE };
      }
      const hasBars = hasItem(player, IRON_BAR_ITEM_ID, 2);
      const hasOre = hasItem(player, BLURITE_ORE_ITEM_ID);
      if (hasBars && hasOre) {
        return { page: PAGE_QUESTS, variant: VARIANT_SWORD_BOTH };
      }
      if (hasBars) {
        return { page: PAGE_QUESTS, variant: VARIANT_SWORD_BARS_ONLY };
      }
      if (hasOre) {
        return { page: PAGE_QUESTS, variant: VARIANT_SWORD_ORE_ONLY };
      }
      return { page: PAGE_QUESTS, variant: VARIANT_SWORD_NO_MATERIALS };
    }

    if (RELDO_NPC_IDS.has(npcId) && stage === STAGE_FIND_RELDO) {
      return { page: PAGE_QUESTS, variant: VARIANT_RELDO };
    }
    return null;
  }

  function answerCondition({ npcId, player, text }) {
    const value = String(text).toLowerCase();
    if (npcId === SQUIRE_NPC_ID) {
      if (value.includes(CONDITION_NOT_MET_THURGO)) return !metThurgo(player);
      if (value.includes(CONDITION_MET_THURGO)) return metThurgo(player);
      if (value.includes(CONDITION_WITHOUT_10_MINING)) {
        if (value.includes("20 combat")) return false; // The menu hook supplies the appropriate warning once.
        return player.getSkillManager().getCurrentLevel(Skill.MINING) < 10;
      }
      if (value.includes(CONDITION_WIELDING_SWORD)) return isWieldingSword(player);
      if (value.includes(CONDITION_SWORD_IN_INVENTORY)) {
        return hasItem(player, BLURITE_SWORD_ITEM_ID);
      }
      return null;
    }
    if (npcId === THURGO_NPC_ID) {
      if (value.includes(CONDITION_NOT_ALREADY_MET_THURGO)) return !metThurgo(player);
      if (value.includes(CONDITION_MET_THURGO)) return metThurgo(player);
      return null;
    }
    return null;
  }

  // "Yes." on "Start The Knight's Sword quest?".
  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== SQUIRE_NPC_ID || hook !== QUEST_START_HOOK) return;
    if (quest.getStage(player) >= STAGE_FIND_RELDO) return;
    quest.setStage(player, metThurgo(player) ? STAGE_FIND_IMCANDO_DWARF : STAGE_FIND_RELDO);
    player.sendMessage("You've started a new quest: <col=081190>The Knight's Sword</col>");
  }

  function metThurgo(player) {
    const request = { player, key: "the_giant_dwarf", complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete || Boolean(player.getAttribute(GIANT_DWARF_PIE_ATTRIBUTE));
  }

  function handleQuestLine(event) {
    const { player, npcId, text } = event;
    if (RELDO_NPC_IDS.has(npcId) && String(text).startsWith("Well, not totally random.") && quest.getStage(player) === STAGE_FIND_RELDO) {
      event.before = () => quest.setStage(player, STAGE_FIND_IMCANDO_DWARF);
    }
    if (npcId === THURGO_NPC_ID && quest.getStage(player) === STAGE_GAVE_THURGO_PIE && String(text).includes(LINE_PICTURE_REQUEST)) {
      event.before = () => quest.setStage(player, STAGE_ASK_SQUIRE_FOR_PORTRAIT);
    }
    if (npcId === SQUIRE_NPC_ID && text === "Ok, I'll try and get that then." && quest.getStage(player) >= STAGE_GAVE_THURGO_PIE && quest.getStage(player) <= STAGE_ASK_SQUIRE_FOR_PORTRAIT) {
      event.before = () => quest.setStage(player, STAGE_FIND_PORTRAIT);
    }
  }

  function warnBeforeStart(event) {
    if (event.npcId !== SQUIRE_NPC_ID || !String(event.prompt).includes("Start The Knight's Sword")) return;
    const mining = event.player.getSkillManager().getCurrentLevel(Skill.MINING) < 10;
    const combat = event.player.getSkillManager().getCombatLevel() < 20;
    if (mining && combat) event.warning = "Before starting this quest, be aware that one or more of your skill levels are lower than what is required to fully complete it. Your combat level is also lower than the recommended level of 20.";
    else if (mining) event.warning = "Before starting this quest, be aware that one or more of your skill levels are lower than what is required to fully complete it.";
    else if (combat) event.warning = "Before starting this quest, be aware that your combat level is lower than the recommended level of 20.";
  }

  function findTail(steps, id) {
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].id === id) return steps.slice(i + 1);
      for (const option of steps[i].options ?? []) {
        const tail = findTail(option.steps ?? [], id);
        if (tail) return tail;
      }
    }
    return null;
  }

  /** GiantDwarf owns Thurgo while its axe-repair branch is active and the player holds the axe. */
  function giantDwarfOwnsThurgo(player) {
    const started = { player, key: "the_giant_dwarf", started: false };
    api.emitCustomEvent("quest:is-started", started);
    if (!started.started) return false;
    const complete = { player, key: "the_giant_dwarf", complete: false };
    api.emitCustomEvent("quest:is-complete", complete);
    if (complete.complete) return false;
    return [...GIANT_DWARF_AXE_ITEM_IDS].some((itemId) => hasItem(player, itemId));
  }

  // A pie handover sets stage 3 before the captured sword-request tail is shown. If the
  // player cancels/logs out before that tail, replay it from WITH_PIE without a second pie.
  function thurgoTalkTo(event) {
    const npcId = event.npcId ?? event.npc?.getId?.();
    if (npcId !== THURGO_NPC_ID || quest.getStage(event.player) !== STAGE_GAVE_THURGO_PIE) return false;
    if (giantDwarfOwnsThurgo(event.player)) return false;
    event.handled = true;
    startTranscript(api, event.player, THURGO_NPC_ID, PAGE_QUESTS, VARIANT_THURGO_WITH_PIE,
      (steps) => findTail(steps, "QZPa_e") ?? []);
    return true;
  }

  function feedThurgo(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_FIND_IMCANDO_DWARF || !hasItem(player, REDBERRY_PIE_ITEM_ID)) { event.end = true; return; }
    player.getInventory().deleteNumber(REDBERRY_PIE_ITEM_ID, 1);
    quest.setStage(player, STAGE_GAVE_THURGO_PIE);
    const manager = player.getDialogueManager(), chain = new DialogueChainBuilder();
    chain.add(new ItemStatementDialogue(0, REDBERRY_PIE_ITEM_ID, "You hand over the pie.<br> <br> "));
    manager.startDialogues(chain);
    const current = manager.getCurrent();
    const valid = () => player.isRegistered?.() !== false && manager.getCurrent() === current;
    const disableContinue = () => player.getPacketSender().sendInterfaceFlagsRange((193 << 16), -1, -1, 0).sendInterfaceScript(2868, [""]);
    disableContinue();
    TaskManager.submit(new CountdownTask(player, 3, () => {
      if (!valid()) return;
      ItemStatementDialogue.send(player, REDBERRY_PIE_ITEM_ID, "You hand over the pie.<br>Thurgo eats the pie.<br> ");
      disableContinue();
    }));
    TaskManager.submit(new CountdownTask(player, 9, () => {
      if (!valid()) return;
      const done = new DialogueChainBuilder();
      done.add(new ItemStatementDialogue(0, REDBERRY_PIE_ITEM_ID, "You hand over the pie.<br>Thurgo eats the pie.<br>Thurgo pats his stomach."));
      done.add(new ActionDialogue(1, { execute: () => startTranscript(api, player, THURGO_NPC_ID, PAGE_QUESTS, VARIANT_THURGO_WITH_PIE,
        steps => findTail(steps, "QZPa_e") ?? []) }));
      manager.startDialogues(done);
    }));
  }

  function handleDialogueAction(event) {
    const { player, npcId, stepId } = event;

    if (npcId === THURGO_NPC_ID) {
      if (stepId === PIE_HANDOVER_MESSAGE_ID) return feedThurgo(event);
      if (stepId === "4UKOc3") { event.box = { statement: true }; return; }
      if (stepId === "KYiD0w") {
        if (!hasItem(player, PORTRAIT_ITEM_ID)) { event.end = true; return; }
        event.text = "You give the portrait to Thurgo. Thurgo studies the portrait.";
        event.box = { items: [PORTRAIT_ITEM_ID] };
        return;
      }
      if (stepId === PORTRAIT_GIVE_ACTION_ID) {
        if (quest.getStage(player) !== STAGE_FIND_PORTRAIT || !hasItem(player, PORTRAIT_ITEM_ID)) { event.end = true; event.handled = true; return; }
        player.getInventory().deleteNumber(PORTRAIT_ITEM_ID, 1);
        quest.setStage(player, STAGE_FIND_MATERIALS);
        event.handled = true;
        return;
      }
      if (stepId === SWORD_SMITH_MESSAGE_ID) {
        if (quest.getStage(player) !== STAGE_FIND_MATERIALS || !hasItem(player, BLURITE_ORE_ITEM_ID) || !hasItem(player, IRON_BAR_ITEM_ID, 2) || ownsSword(player)) { event.end = true; return; }
        event.box = { items: [BLURITE_SWORD_ITEM_ID] };
        if (hasItem(player, BLURITE_ORE_ITEM_ID) && hasItem(player, IRON_BAR_ITEM_ID, 2)) {
          player.getInventory().deleteNumber(BLURITE_ORE_ITEM_ID, 1);
          player.getInventory().deleteNumber(IRON_BAR_ITEM_ID, 2);
          player.getInventory().adds(BLURITE_SWORD_ITEM_ID, 1);
        }
        return; // leave handled false so the message still shows
      }
      return;
    }

    if (npcId === SQUIRE_NPC_ID && stepId === "40MG6g") { event.box = { statement: true }; return; }
    if (npcId === SQUIRE_NPC_ID && stepId === SWORD_HANDIN_ACTION_ID) {
      event.handled = true;
      event.end = true;
      if (quest.getStage(player) !== STAGE_FIND_MATERIALS || !hasItem(player, BLURITE_SWORD_ITEM_ID)) return;
      if (hasItem(player, BLURITE_SWORD_ITEM_ID)) {
        player.getInventory().deleteNumber(BLURITE_SWORD_ITEM_ID, 1);
      }
      quest.complete(player);
      event.handled = true;
      event.end = true;
    }
  }

  function searchCupboard(player) {
    if (quest.getStage(player) < STAGE_FIND_PORTRAIT || quest.isComplete(player)) {
      player.sendMessage("There is just a load of junk in here.");
      return;
    }
    if (hasItem(player, PORTRAIT_ITEM_ID)) {
      player.sendMessage("You have already taken the portrait.");
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory space.");
      return;
    }
    for (const npc of World.getNpcs()) {
      if (npc.getId() !== SIR_VYVIN_NPC_ID) continue;
      const at = npc.getLocation();
      if (at.getZ() !== 2 || at.getX() < 2983 || at.getX() > 2989 || at.getY() < 3333 || at.getY() > 3337) continue;
      const target = npc.getInteractingMobile?.()?.getLocation() ?? npc.getPositionToFace?.();
      const face = npc.getFace?.().getDirection();
      const dx = target ? target.getX() - at.getX() : face?.getX() ?? 0;
      const dy = target ? target.getY() - at.getY() : face?.getY() ?? 0;
      if ((player.getLocation().getX() - at.getX()) * dx + (player.getLocation().getY() - at.getY()) * dy >= 0) {
        player.sendMessage("You can't search the cupboard while Sir Vyvin is watching you.");
        return;
      }
    }
    const chain = new DialogueChainBuilder();
    chain.add(new StatementDialogue(0, "You find a small portrait in here which you take."));
    chain.add(new ActionDialogue(1, { execute: () => {
      if (!hasItem(player, PORTRAIT_ITEM_ID) && quest.getStage(player) >= STAGE_FIND_PORTRAIT && !quest.isComplete(player)) {
        if (!player.getInventory().isFull()) player.getInventory().adds(PORTRAIT_ITEM_ID, 1);
        else player.getInventory().full();
      }
      player.getDialogueManager().reset();
    } }));
    player.getDialogueManager().startDialogues(chain);
  }

  // Sir Vyvin's cupboard (id 2271 closed, 2272 open): open swaps the model,
  // search hands over the portrait once the squire has pointed to it.
  function openCupboard(event) {
    if (event.objectId !== CUPBOARD_CLOSED_ID) return false;
    event.handled = true;
    event.player.performAnimation(new Animation(536));
    replaceObject(event.object, CUPBOARD_OPEN_ID);
    return true;
  }

  function searchCupboardObject(event) {
    if (event.objectId !== CUPBOARD_OPEN_ID) return false;
    event.handled = true;
    searchCupboard(event.player);
    return true;
  }

  function shutCupboard(event) {
    if (event.objectId !== CUPBOARD_OPEN_ID) return false;
    event.handled = true;
    replaceObject(event.object, CUPBOARD_CLOSED_ID);
    return true;
  }

  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    let variant;
    if (npcId === THURGO_NPC_ID && itemId === PORTRAIT_ITEM_ID && quest.getStage(player) === STAGE_FIND_PORTRAIT) variant = VARIANT_THURGO_GIVE_PORTRAIT;
    if (npcId === THURGO_NPC_ID && itemId === REDBERRY_PIE_ITEM_ID && quest.getStage(player) === STAGE_FIND_IMCANDO_DWARF) variant = VARIANT_THURGO_WITH_PIE;
    if (npcId === THURGO_NPC_ID && [BLURITE_ORE_ITEM_ID, IRON_BAR_ITEM_ID].includes(itemId) && quest.getStage(player) === STAGE_FIND_MATERIALS) variant = selectVariant({ player, npcId }).variant;
    if (npcId === SQUIRE_NPC_ID && itemId === BLURITE_SWORD_ITEM_ID && quest.getStage(player) === STAGE_FIND_MATERIALS) variant = VARIANT_SQUIRE_GIVE_SWORD;
    if (!variant) return;
    event.handled = true;
    startTranscript(api, player, npcId, PAGE_QUESTS, variant);
  }

  quest = registerQuest(api, {
    key: "the_knights_sword",
    name: "The Knight's Sword",
    varpId: VARP_KNIGHTS_SWORD,
    startedValue: STAGE_FIND_RELDO,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    completionJingleId: 153,
    xpRewards: [{ skillId: Skill.SMITHING.getIndex(), amount: 12725, label: "Smithing" }],
    scrollItemId: BLURITE_SWORD_ITEM_ID,
    buildJournal,
    onReward: reward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleQuestLine);
  api.onCustomEvent("npc-dialogue:menu", warnBeforeStart);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onObjectInteraction("Cupboard", { Open: openCupboard, Search: searchCupboardObject, Shut: shutCupboard });
  api.onNpcInteraction("Thurgo", { "Talk-to": thurgoTalkTo });
  api.onItemOnNpc(handleItemOnNpc);
};
