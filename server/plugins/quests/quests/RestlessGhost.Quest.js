/**
 * The Restless Ghost.
 *
 * Words come from npc-dialogues.json. The "The Restless Ghost" page mixes every
 * NPC of the quest, so each branch is selected by the speaker's cache id:
 *   Father Aereck, Father Urhney and the Restless ghost.
 *
 * This plugin supplies the variant selector, the condition answers, the start
 * hook, the amulet hand-over actions and the coffin / skull-altar interactions.
 * The ghost is not a static world spawn: it rises from the graveyard coffin
 * when the player opens or searches it and vanishes when the skull is returned,
 * matching the reference's runtime spawn. The coffin placement and the
 * attacking skeleton are server content added separately.
 *
 * Gaps (no transcript support, see summary):
 *   - Aereck while carrying the skull but without it (reference has a lost-skull
 *     line the dump lacks) falls back to the found-skull branch.
 *   - Ghost after completion has no "not interested" variant; falls back to the
 *     pre-quest "Wooooo!" conversation.
 *   - The bank / Death's Office / Item Retrieval storage check for the lost
 *     amulet cannot be answered, so it always reads as "not stored".
 */
module.exports = function registerRestlessGhostQuest(api) {
  const { Skill, Equipment, Location, GameObject, ObjectManager, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest } = require("../QuestRuntime");

  const VARP_RESTLESS_GHOST = 107;
  const STAGE_STARTED = 1;
  const STAGE_SPOKEN_URHNEY = 2;
  const STAGE_SPOKEN_GHOST = 3;
  const STAGE_OBTAINED_SKULL = 4;
  const STAGE_COMPLETE = 5;

  const GHOSTSPEAK_AMULET_ID = ItemIdentifiers.GHOSTSPEAK_AMULET;
  const GHOSTS_SKULL_ID = ItemIdentifiers.GHOSTS_SKULL;

  /** Object id 2146 has no generated ObjectIdentifiers member; value kept from the original plugin. */
  const SKULL_ALTAR_OBJECT_ID = 2146;
  /** Skull altar in the Wizards' Tower: a varbit loc that resolves to one of these. */
  const SKULL_ALTAR_IDS = [SKULL_ALTAR_OBJECT_ID, ObjectIdentifiers.ALTAR_41, ObjectIdentifiers.ALTAR_42];

  const QUEST_START_HOOK = "quest:the-restless-ghost:start";
  /** "Father Urhney hands you an amulet." on page "The Restless Ghost". */
  const URHNEY_GIVE_AMULET_MESSAGE_ID = "Nn953X";
  /** Lost-amulet "ghostspeak amulet" action, on both Urhney pages. */
  const URHNEY_GIVE_AMULET_ACTION_IDS = new Set(["TkNeQZ", "z2bQM2"]);
  /** Where the ghost rises: the tile just south of the graveyard coffin (3249, 3192). */
  const GHOST_SPAWN_X = 3249;
  const GHOST_SPAWN_Y = 3194;
  const GHOST_WANDER_RADIUS = 2;
  /** Accepting the skull task sets the spoken-to-ghost stage (the reference's stage write). */
  const GHOST_SKULL_TASK_LINE =
    "Ok. I will try and get the skull back for you, then you can rest in peace.";
  /**
   * The "No, you sound like..." and "Wow, this amulet works!" branches commit to
   * the explanation through these nested choices; their transcript jumps replay
   * the option body instead of reaching the task text, so the stage is set here.
   */
  const GHOST_SKULL_TASK_CHOICES = new Set([
    "Yes, ok. Do you know WHY you're a ghost?",
    "Yes, ok. Do you know why you're a ghost?",
  ]);

  let quest;
  const ghostByPlayer = new Map();

  const ownsGhostspeakAmulet = (player) => {
    if (player.getInventory().getAmount(GHOSTSPEAK_AMULET_ID) > 0) return true;
    return player.getEquipment().get(Equipment.AMULET_SLOT)?.getId?.() === GHOSTSPEAK_AMULET_ID;
  };

  const wearingGhostspeakAmulet = (player) =>
    player.getEquipment().get(Equipment.AMULET_SLOT)?.getId?.() === GHOSTSPEAK_AMULET_ID;

  function giveGhostspeakAmulet(player) {
    if (ownsGhostspeakAmulet(player)) return;
    if (player.getInventory().isFull()) {
      player.sendMessage("You need some free inventory space before Father Urhney can give you the amulet.");
      return;
    }
    player.getInventory().adds(GHOSTSPEAK_AMULET_ID, 1);
    player.sendMessage("Father Urhney hands you an amulet.");
  }

  /** Rise the ghost from the coffin for this player, once, until the quest ends. */
  function ensureGhost(player) {
    if (quest.getStage(player) >= STAGE_COMPLETE) return;
    if (ghostByPlayer.has(player)) return;
    const npc = api.spawnNpc({
      id: NpcIdentifiers.RESTLESS_GHOST,
      x: GHOST_SPAWN_X,
      y: GHOST_SPAWN_Y,
      z: 0,
      wanderRadius: GHOST_WANDER_RADIUS,
      owner: player,
      ownerOnly: true,
    });
    if (npc) ghostByPlayer.set(player, npc);
  }

  function removeGhost(player) {
    const npc = ghostByPlayer.get(player);
    if (!npc) return;
    ghostByPlayer.delete(player);
    api.removeNpc(npc);
  }

  /** The private ghost follows its owner; drop it on logout like the other quest NPCs. */
  function handleLogout({ player }) {
    if (player) removeGhost(player);
  }

  /** Swap a coffin object for another id in place (the reference's loc change). */
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
    if (stage < STAGE_STARTED) {
      return [
        "I can start this quest by speaking to",
        "<col=800000>Father Aereck</col> in the <col=800000>church</col>",
        "next to <col=800000>Lumbridge Castle</col>.",
        "",
        "I must be unafraid of a <col=800000>level 13 Skeleton</col>.",
      ];
    }

    const lines = [
      "<str>Father Aereck asked me to help him deal with</str>",
      "<str>the ghost in the graveyard next to the church.</str>",
      "",
    ];
    if (stage < STAGE_SPOKEN_URHNEY) {
      return [
        ...lines,
        "I should find <col=800000>Father Urhney</col>, an expert on ghosts.",
        "He lives in a <col=800000>shack</col> in <col=800000>Lumbridge Swamp</col>.",
      ];
    }
    lines.push(
      "<str>Father Urhney gave me an Amulet of Ghostspeak</str>",
      "<str>so I can talk to the ghost.</str>",
      ""
    );
    if (stage < STAGE_SPOKEN_GHOST) {
      return [...lines, "I should wear the amulet and talk to the <col=800000>Ghost</col>."];
    }
    lines.push(
      "<str>The Ghost told me an evil warlock stole his skull.</str>",
      ""
    );
    if (stage < STAGE_OBTAINED_SKULL) {
      return [
        ...lines,
        "I should search the <col=800000>Wizards' Tower</col> south-west of",
        "Lumbridge for the <col=800000>Ghost's Skull</col>.",
      ];
    }
    lines.push(
      "<str>I found the Ghost's Skull in the Wizards' Tower.</str>",
      ""
    );
    if (stage < STAGE_COMPLETE) {
      return [...lines, "I should put the <col=800000>Skull</col> in the Ghost's coffin."];
    }
    return [
      ...lines,
      "<str>I placed the Skull in the coffin and allowed the</str>",
      "<str>Ghost to rest in peace.</str>",
      "",
      "<col=ff0000>QUEST COMPLETE!</col>",
    ];
  }

  function reward(player) {
    player.getSkillManager().addExperiences(Skill.PRAYER, 1125);
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (npcId === NpcIdentifiers.FATHER_AERECK) {
      if (stage >= STAGE_COMPLETE) {
        return { page: "Father Aereck", variant: "after-completion-of-the-restless-ghost" };
      }
      if (stage === STAGE_STARTED) {
        return { page: "The Restless Ghost", variant: "starting-out-talking-to-father-aereck-again" };
      }
      if (stage === STAGE_SPOKEN_URHNEY) {
        return { page: "The Restless Ghost", variant: "talking-to-father-urhney-talking-to-father-aereck" };
      }
      if (stage === STAGE_SPOKEN_GHOST) {
        return { page: "The Restless Ghost", variant: "talking-to-the-restless-ghost-talking-to-father-aereck" };
      }
      if (stage >= STAGE_OBTAINED_SKULL) {
        // No dump variant for "skull found but not carried"; use the found branch.
        return { page: "The Restless Ghost", variant: "after-retrieving-the-skull-talking-to-father-aereck-with-the-skull" };
      }
      return { page: "The Restless Ghost", variant: "starting-out" };
    }

    if (npcId === NpcIdentifiers.FATHER_URHNEY) {
      if (stage === STAGE_STARTED) {
        return { page: "The Restless Ghost", variant: "talking-to-father-urhney" };
      }
      if (stage >= STAGE_SPOKEN_URHNEY && stage < STAGE_COMPLETE && !ownsGhostspeakAmulet(player)) {
        return { page: "The Restless Ghost", variant: "talking-to-father-urhney-if-the-ghostspeak-amulet-is-ever-lost" };
      }
      if (stage >= STAGE_SPOKEN_URHNEY) {
        return { page: "Father Urhney", variant: "after-the-restless-ghost" };
      }
      return { page: "Father Urhney", variant: "before-the-restless-ghost" };
    }

    if (npcId === NpcIdentifiers.RESTLESS_GHOST) {
      if (stage === 0 || stage >= STAGE_COMPLETE) {
        // Stage 0 = the dump's only ghost page; completion has no variant.
        return { page: "Restless ghost", variant: "before-the-restless-ghost" };
      }
      if (!wearingGhostspeakAmulet(player)) {
        return {
          page: "The Restless Ghost",
          variant: stage > STAGE_SPOKEN_URHNEY
            ? "talking-to-the-restless-ghost-talking-to-the-restless-ghost-again-without-the-amulet-of-ghostspeak"
            : "talking-to-the-restless-ghost-without-wearing-the-amulet-of-ghostspeak",
        };
      }
      if (stage === STAGE_SPOKEN_URHNEY) {
        return { page: "The Restless Ghost", variant: "talking-to-the-restless-ghost-while-wearing-the-amulet-of-ghostspeak" };
      }
      if (stage === STAGE_SPOKEN_GHOST) {
        return { page: "The Restless Ghost", variant: "talking-to-the-restless-ghost-talking-to-the-restless-ghost-again-with-the-amulet-of-ghostspeak" };
      }
      return { page: "The Restless Ghost", variant: "after-retrieving-the-skull-talking-to-the-restless-ghost" };
    }

    return null;
  }

  function answerCondition({ npcId, player, text }) {
    if (npcId !== NpcIdentifiers.FATHER_URHNEY) return null;
    const value = String(text).toLowerCase();
    if (value.includes("currently has it in their inventory")) return ownsGhostspeakAmulet(player);
    // ponytail: no bank/Death's Office/retrieval lookup; treat as not stored.
    if (value.includes("stored in a bank")) return false;
    if (value.includes("does not have inventory space")) return player.getInventory().isFull();
    if (value.includes("has inventory space")) return !player.getInventory().isFull();
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== NpcIdentifiers.FATHER_AERECK || hook !== QUEST_START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (npcId !== NpcIdentifiers.FATHER_URHNEY) return;

    if (stepId === URHNEY_GIVE_AMULET_MESSAGE_ID) {
      giveGhostspeakAmulet(player);
      if (quest.getStage(player) < STAGE_SPOKEN_URHNEY) {
        quest.setStage(player, STAGE_SPOKEN_URHNEY);
      }
      if (event.text) player.sendMessage(String(event.text));
      event.handled = true;
      return;
    }

    if (URHNEY_GIVE_AMULET_ACTION_IDS.has(stepId)) {
      giveGhostspeakAmulet(player);
      event.handled = true;
    }
  }

  /** The skull conversation is the only write to the spoken-to-ghost stage. */
  function advanceToSpokenGhost(player) {
    if (quest.getStage(player) !== STAGE_SPOKEN_URHNEY) return;
    quest.setStage(player, STAGE_SPOKEN_GHOST);
  }

  function handleDialogueLine(event) {
    if (event.npcId !== NpcIdentifiers.RESTLESS_GHOST) return;
    if (event.text !== GHOST_SKULL_TASK_LINE) return;
    advanceToSpokenGhost(event.player);
  }

  function handleDialogueChoice(event) {
    if (event.npcId !== NpcIdentifiers.RESTLESS_GHOST) return;
    if (!GHOST_SKULL_TASK_CHOICES.has(event.option)) return;
    advanceToSpokenGhost(event.player);
  }

  function openCoffin(event) {
    ensureGhost(event.player);
    event.player.sendMessage("You open the coffin.");
    replaceObject(event.object, ObjectIdentifiers.COFFIN_12);
  }

  function searchOpenCoffin(event) {
    ensureGhost(event.player);
    const stage = quest.getStage(event.player);
    if (stage >= STAGE_COMPLETE) {
      event.player.sendMessage("There's a nice and complete skeleton in here!");
    } else if (stage >= STAGE_STARTED) {
      event.player.sendMessage("There's a skeleton without a skull in here.");
    } else {
      event.player.sendMessage("You search the coffin and find some human remains.");
    }
  }

  function closeCoffin(event) {
    event.player.sendMessage("You close the coffin.");
    replaceObject(event.object, ObjectIdentifiers.COFFIN_4);
  }

  function inspectCompletedCoffin(event) {
    event.player.sendMessage("The skull is back in there.");
  }

  function takeSkullFromAltar(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (player.getInventory().getAmount(GHOSTS_SKULL_ID) > 0) {
      player.sendMessage("You already have the Ghost's skull.");
      return;
    }
    if (stage < STAGE_SPOKEN_GHOST || stage >= STAGE_COMPLETE) {
      player.sendMessage("That skull looks scary. You have no reason to take it.");
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You don't have enough inventory space for the skull.");
      return;
    }
    player.getInventory().adds(GHOSTS_SKULL_ID, 1);
    quest.setStage(player, STAGE_OBTAINED_SKULL);
    player.sendMessage("You take the Ghost's skull from the altar.");
  }

  function putSkullInCoffin(event) {
    if (event.itemId !== GHOSTS_SKULL_ID) return;
    if (event.objectId === ObjectIdentifiers.COFFIN_4) {
      event.player.sendMessage("Maybe I should open it first.");
      event.handled = true;
      return;
    }
    if (event.objectId !== ObjectIdentifiers.COFFIN_12) return;
    if (quest.getStage(event.player) !== STAGE_OBTAINED_SKULL) return;
    if (event.player.getInventory().getAmount(GHOSTS_SKULL_ID) <= 0) return;
    event.player.getInventory().deleteNumber(GHOSTS_SKULL_ID, 1);
    event.player.sendMessage("You put the skull in the coffin.");
    replaceObject(event.object, ObjectIdentifiers.COFFIN_13);
    event.player.sendMessage("The spirit flies into the River Lum.");
    quest.complete(event.player);
    removeGhost(event.player);
    event.handled = true;
  }

  function giveSkullToGhost(event) {
    if (event.itemId !== GHOSTS_SKULL_ID) return;
    if (event.target.getId?.() !== NpcIdentifiers.RESTLESS_GHOST) return;
    event.player.sendMessage("I can't give it to him. It goes right through him.");
    event.handled = true;
  }

  quest = registerQuest(api, {
    key: "the_restless_ghost",
    name: "The Restless Ghost",
    varpId: VARP_RESTLESS_GHOST,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.PRAYER.getIndex(), amount: 1125, label: "Prayer" }],
    scrollItemId: GHOSTS_SKULL_ID,
    otherRewards: ["Amulet of ghostspeak"],
    buildJournal,
    onReward: reward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onPlayerLogout(handleLogout);
  api.onObjectFirstClick(ObjectIdentifiers.COFFIN_4, openCoffin);
  api.onObjectFirstClick(ObjectIdentifiers.COFFIN_12, searchOpenCoffin);
  api.onObjectSecondClick(ObjectIdentifiers.COFFIN_12, closeCoffin);
  api.onObjectFirstClick(ObjectIdentifiers.COFFIN_13, inspectCompletedCoffin);
  api.onObjectFirstClick(SKULL_ALTAR_IDS, takeSkullFromAltar);
  api.onItemOnObject(putSkullInCoffin);
  api.onItemOnNpc(giveSkullToGhost);
};
