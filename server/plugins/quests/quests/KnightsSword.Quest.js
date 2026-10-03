/**
 * The Knight's Sword.
 *
 * Words come from npc-dialogues.json (page "The Knight's Sword", plus the
 * post-quest pages "Squire" and "Thurgo"). The reference branch logic lives in
 * xrsps knightsSword/{constants,interactions,journal}.ts; this plugin supplies
 * the variant selector, the prose-condition answers, the start/hand-in hooks and
 * the blurite-rock / cupboard interactions.
 *
 * Stage flow (VARP 122):
 *   0 not started            squire "talking-to-the-squire"
 *   1 find Reldo             squire/thurgo "…before-talking-to-reldo", reldo "talking-to-reldo"
 *   2 find Imcando dwarf     thurgo pie-dependent variants
 *   3 gave Thurgo pie        thurgo "...again-without-the-portrait" (pie branch inlines stage 3->4)
 *   4 ask squire for portrait
 *   5 find portrait          squire/thurgo pick portrait-aware variants
 *   6 find materials         thurgo materials-aware, squire sword-aware
 *   7 complete
 *
 * Gaps are listed at the end of the file and echoed in the port summary.
 */
module.exports = function registerKnightsSwordQuest(api) {
  const { Skill, Equipment, Location, GameObject, ObjectManager, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest } = require("../QuestRuntime");
  const mining = require("../../skills/Mining.plugin.js");

  const SQUIRE_NPC_ID = NpcIdentifiers.SQUIRE_14;
  const THURGO_NPC_ID = NpcIdentifiers.THURGO;
  // xrsps constants say 6203; the osrsreboxed cache (and therefore tsps) uses 4242/4243.
  const LEGACY_RELDO_NPC_ID = 6203; // xrsps-only id, absent from the generated NpcIdentifiers
  const RELDO_NPC_IDS = new Set([LEGACY_RELDO_NPC_ID, NpcIdentifiers.RELDO, NpcIdentifiers.RELDO_2]);

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

  const CUPBOARD_CLOSED_ID = ObjectIdentifiers.CUPBOARD_8;
  const CUPBOARD_OPEN_ID = ObjectIdentifiers.CUPBOARD_9;
  const BLURITE_ROCKS_NAME = "Blurite rocks";
  const BLURITE_MINING_LEVEL = 10;
  const BLURITE_MINING_XP = 17.5;

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
        // The dump has no stage-3 squire branch; the cupboard explanation is the
        // only squire line before the portrait and advances stage 3/4 -> 5.
        quest.setStage(player, STAGE_FIND_PORTRAIT);
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
      if (value.includes(CONDITION_NOT_MET_THURGO)) return true;
      if (value.includes(CONDITION_MET_THURGO)) return false;
      if (value.includes(CONDITION_WITHOUT_10_MINING)) {
        return (
          player.getSkillManager().getCurrentLevel(Skill.MINING) < 10 ||
          player.getSkillManager().getCombatLevel() < 20
        );
      }
      if (value.includes(CONDITION_WIELDING_SWORD)) return isWieldingSword(player);
      if (value.includes(CONDITION_SWORD_IN_INVENTORY)) {
        return hasItem(player, BLURITE_SWORD_ITEM_ID);
      }
      return null;
    }
    if (npcId === THURGO_NPC_ID) {
      // ponytail: The Giant Dwarf meeting is untracked; the "hasn't met" branch
      // is the reference's default (xrsps has no Giant Dwarf variant either).
      if (value.includes(CONDITION_NOT_ALREADY_MET_THURGO)) return true;
      if (value.includes(CONDITION_MET_THURGO)) return false;
      return null;
    }
    return null;
  }

  // "Yes." on "Start The Knight's Sword quest?".
  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== SQUIRE_NPC_ID || hook !== QUEST_START_HOOK) return;
    if (quest.getStage(player) >= STAGE_FIND_RELDO) return;
    quest.setStage(player, STAGE_FIND_RELDO);
  }

  // Reldo has no action step; advance when the player takes the Imcando option.
  function handleReldoChoice({ player, npcId, option }) {
    if (!RELDO_NPC_IDS.has(npcId)) return;
    if (option !== CHOICE_IMCANDO_DWARVES) return;
    if (quest.getStage(player) !== STAGE_FIND_RELDO) return;
    quest.setStage(player, STAGE_FIND_IMCANDO_DWARF);
  }

  // Giving the pie and asking for the sword happen in one dump conversation;
  // mirror the reference by moving to "ask squire" once Thurgo asks for a picture.
  function handleThurgoLine(event) {
    if (event.npcId !== THURGO_NPC_ID) return;
    if (quest.getStage(event.player) !== STAGE_GAVE_THURGO_PIE) return;
    if (String(event.text).includes(LINE_PICTURE_REQUEST)) {
      quest.setStage(event.player, STAGE_ASK_SQUIRE_FOR_PORTRAIT);
    }
  }

  function handleDialogueAction(event) {
    const { player, npcId, stepId } = event;

    if (npcId === THURGO_NPC_ID) {
      if (stepId === PIE_HANDOVER_MESSAGE_ID) {
        if (hasItem(player, REDBERRY_PIE_ITEM_ID)) {
          player.getInventory().deleteNumber(REDBERRY_PIE_ITEM_ID, 1);
        }
        if (quest.getStage(player) < STAGE_GAVE_THURGO_PIE) {
          quest.setStage(player, STAGE_GAVE_THURGO_PIE);
        }
        return; // leave handled false so the message still shows
      }
      if (stepId === PORTRAIT_GIVE_ACTION_ID) {
        if (hasItem(player, PORTRAIT_ITEM_ID)) {
          player.getInventory().deleteNumber(PORTRAIT_ITEM_ID, 1);
        }
        quest.setStage(player, STAGE_FIND_MATERIALS);
        event.handled = true;
        return;
      }
      if (stepId === SWORD_SMITH_MESSAGE_ID) {
        if (hasItem(player, BLURITE_ORE_ITEM_ID) && hasItem(player, IRON_BAR_ITEM_ID, 2)) {
          player.getInventory().deleteNumber(BLURITE_ORE_ITEM_ID, 1);
          player.getInventory().deleteNumber(IRON_BAR_ITEM_ID, 2);
          player.getInventory().adds(BLURITE_SWORD_ITEM_ID, 1);
        }
        return; // leave handled false so the message still shows
      }
      return;
    }

    if (npcId === SQUIRE_NPC_ID && stepId === SWORD_HANDIN_ACTION_ID) {
      if (hasItem(player, BLURITE_SWORD_ITEM_ID)) {
        player.getInventory().deleteNumber(BLURITE_SWORD_ITEM_ID, 1);
      }
      quest.complete(player);
      event.handled = true;
      event.end = true;
    }
  }

  function searchCupboard(player) {
    if (quest.getStage(player) < STAGE_FIND_PORTRAIT) {
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
    player.getInventory().adds(PORTRAIT_ITEM_ID, 1);
    player.sendMessage("You find a small portrait in here which you take.");
  }

  // Sir Vyvin's cupboard (id 2271 closed, 2272 open): open swaps the model,
  // search hands over the portrait once the squire has pointed to it.
  function openCupboard(event) {
    if (event.objectId !== CUPBOARD_CLOSED_ID) return false;
    replaceObject(event.object, CUPBOARD_OPEN_ID);
    event.player.sendMessage("You open the cupboard.");
    return true;
  }

  function searchCupboardObject(event) {
    if (event.objectId !== CUPBOARD_CLOSED_ID && event.objectId !== CUPBOARD_OPEN_ID) return false;
    searchCupboard(event.player);
    return true;
  }

  // Blurite rocks (11378/11379). The xrsps reference leaves mining to its core
  // mining system, so this is a minimal port: 10 Mining, a usable pickaxe, one
  // ore. ponytail: no rock depletion/respawn, reuse Mining's pickaxe lookup.
  function mineBluriteRocks(event) {
    const { player } = event;
    if (player.getSkillManager().getCurrentLevel(Skill.MINING) < BLURITE_MINING_LEVEL) {
      player.sendMessage("You need a Mining level of at least 10 to mine this rock.");
      return true;
    }
    const pickaxe = mining.findBestPickaxe(player);
    if (!pickaxe) {
      player.sendMessage("You don't have a pickaxe which you can use.");
      return true;
    }
    if (player.getInventory().isFull()) {
      player.getInventory().full();
      return true;
    }
    player.performAnimation(pickaxe.animation);
    player.getInventory().adds(BLURITE_ORE_ITEM_ID, 1);
    player.getSkillManager().addExperiences(Skill.MINING, BLURITE_MINING_XP);
    player.sendMessage("You get some blurite ore.");
    return true;
  }

  quest = registerQuest(api, {
    key: "the_knights_sword",
    name: "The Knight's Sword",
    varpId: VARP_KNIGHTS_SWORD,
    startedValue: STAGE_FIND_RELDO,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.SMITHING.getIndex(), amount: 12725, label: "Smithing" }],
    scrollItemId: BLURITE_SWORD_ITEM_ID,
    buildJournal,
    onReward: reward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleReldoChoice);
  api.onCustomEvent("npc-dialogue:line", handleThurgoLine);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onObjectInteraction("Cupboard", { Open: openCupboard, Search: searchCupboardObject });
  api.onObjectInteraction(BLURITE_ROCKS_NAME, { Mine: mineBluriteRocks });
  /**
   * Gaps (not covered by the dump / reference):
   *  - The Giant Dwarf meeting is untracked, so Thurgo/Squire always take the
   *    "hasn't met Thurgo" branch (the reference does the same).
   *  - No squire variant exists for stage 3 (GAVE_THURGO_PIE); stages 3 and 4 both
   *    play the cupboard description and jump to FIND_PORTRAIT.
   *  - Thurgo stage 3/4 without a portrait uses the "again-without-the-portrait"
   *    line (no dedicated "ask the squire" dump variant).
   *  - Blurite mining is not implemented in the reference; the local version has no
   *    rock depletion/respawn.
   *  - "Smithing the sword on Thurgo's anvil" is dialogue-driven in the reference
   *    (no anvil object); the anvil interaction is intentionally not added.
   *  - Option-level prose conditions ("If the player has a redberry pie:") are not
   *    resolved by the dialogue runtime, so the pie prompt can appear without a pie.
   */
};
