/**
 * Priest in Peril (members).
 *
 * The words come from the "Priest in Peril" transcript page; this plugin supplies
 * the variant selector for King Roald and Drezel (both indexed), the prose-
 * condition answers, the start hook, the essence hand-in and the monk/guardian
 * interactions. Drezel's Talk-to is transcript-driven so every branch plays.
 *
 * Stages (varp 302): 10 started, 20 guardian killed, 30 told King Roald,
 * 40 met Drezel, 50 vampyre sealed, 60 complete.
 *
 * Gaps (no dump/index support): the golden key/blessed-water objects (cell door,
 * well, coffin) are not implemented; the Drezel conversation drives those stages,
 * the hooded monk drops the key and the guardian is a private 7620 spawn. The
 * guardian's magic condition is answered true.
 */
module.exports = function registerPriestInPerilQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, Location } = api.core;
  const { registerQuest, startTranscript, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Priest in Peril";

  const KING_ROALD_NPC_IDS = new Set([
    NpcIdentifiers.KING_ROALD,
    NpcIdentifiers.KING_ROALD_3,
    NpcIdentifiers.KING_ROALD_5,
    NpcIdentifiers.KING_ROALD_6,
    NpcIdentifiers.KING_ROALD_7,
  ]);
  const DREZEL_NPC_ID = NpcIdentifiers.DREZEL;
  const TEMPLE_GUARDIAN_NPC_ID = NpcIdentifiers.TEMPLE_GUARDIAN;
  const MONKS_OF_ZAMORAK_NPC_IDS = new Set([
    NpcIdentifiers.MONK_OF_ZAMORAK,
    NpcIdentifiers.MONK_OF_ZAMORAK_2,
    NpcIdentifiers.MONK_OF_ZAMORAK_3,
    // Rev 241 moved the temple monks' names into transforms; interactions resolve the
    // spawned parents 3484-3486 to these variants.
    NpcIdentifiers.MONK_OF_ZAMORAK_4,
    NpcIdentifiers.MONK_OF_ZAMORAK_5,
    NpcIdentifiers.MONK_OF_ZAMORAK_6,
    NpcIdentifiers.MONK_OF_ZAMORAK_15,
    NpcIdentifiers.MONK_OF_ZAMORAK_16,
    NpcIdentifiers.MONK_OF_ZAMORAK_17,
  ]);

  const VARP_PRIEST_IN_PERIL = 302;
  const STAGE_STARTED = 10;
  const STAGE_GUARDIAN_KILLED = 20;
  const STAGE_TOLD_KING_ROALD = 30;
  const STAGE_MET_DREZEL = 40;
  const STAGE_VAMPYRE_SEALED = 50;
  const STAGE_COMPLETE = 60;
  /**
   * Varp 302 as the client sees it. The cache keys the quest NPCs on OSRS's own values:
   * the cell Drezel (9804) shows at 4-8, the mausoleum Drezel (9805) at 8-61 and the
   * world guardian (3487) at 0-2. Sending the 10/20/... stages raw hid the cell Drezel
   * and showed the mausoleum one all quest. Before the King is told, 3 hides all three
   * (the plugin spawns its own guardian); once the vampyre is sealed, 8 ("meet me in the
   * mausoleum") shows both, so the cell Drezel stays through the golden-key talk.
   */
  const VARP_VALUE_BY_STAGE = new Map([
    [STAGE_STARTED, 3],
    [STAGE_GUARDIAN_KILLED, 3],
    [STAGE_TOLD_KING_ROALD, 4],
    [STAGE_MET_DREZEL, 5],
    [STAGE_VAMPYRE_SEALED, 8],
    [STAGE_COMPLETE, 61],
  ]);

  const GOLDEN_KEY_ITEM_ID = ItemIdentifiers.GOLDEN_KEY;
  const BLESSED_WATER_ITEM_ID = ItemIdentifiers.BLESSED_WATER;
  const RUNE_ESSENCE_ITEM_ID = ItemIdentifiers.RUNE_ESSENCE;
  const PURE_ESSENCE_ITEM_ID = ItemIdentifiers.PURE_ESSENCE;
  const ESSENCE_REQUIRED = 50;

  const START_HOOK = "quest:priest-in-peril:start";
  /** Transcript action that ends the "giving the last of the essence" branch. */
  const COMPLETE_ACTION_ID = "5wj46V";
  /** "You give Drezel some essence." message steps (last batch and partial ones). */
  const ESSENCE_MESSAGE_IDS = new Set(["4daSZa", "ViQ2ji"]);
  const ESSENCE_REMAINING_BLANK = "[1-50]";
  const ESSENCE_HANDED_ATTRIBUTE = "priest-in-peril:essence-handed-in";
  /** Transcript message shown only below the recommended combat level. */
  const COMBAT_WARNING_STEP_ID = "0cBLcT";
  const RECOMMENDED_COMBAT_LEVEL = 15;

  // The mausoleum trapdoors: 1579 north of the temple (over the mausoleum ladder)
  // and 3432 inside the church. The cache's raw 3487 guardian only resolves to
  // 7620 at raw varp 302 values 0-2, which the quest's 10/20/... encoding never
  // hits, so the plugin spawns the real guardian as a private quest NPC instead.
  const NORTH_TRAPDOOR_ID = ObjectIdentifiers.TRAPDOOR_4; // 1579 at 3405,3507
  const CHURCH_TRAPDOOR_ID = ObjectIdentifiers.TRAPDOOR_12; // 3432 at 3422,3485
  const MAUSOLEUM_LADDER_ID = ObjectIdentifiers.LADDER_216; // 17385 at 3405,9907
  const LARGE_DOOR_IDS = new Set([
    ObjectIdentifiers.LARGE_DOOR_21, // 3489
    ObjectIdentifiers.LARGE_DOOR_22, // 3490
  ]);
  const MYSTERIOUS_VOICE_NPC_ID = 12240;
  const DOOR_ANSWERED_ATTRIBUTE = "priest-in-peril:door-answered";

  const NORTH_TRAPDOOR_LOCATION = { x: 3405, y: 3507, z: 0 };
  const CHURCH_TRAPDOOR_LOCATION = { x: 3422, y: 3485, z: 0 };
  // Walkable tiles beside each trapdoor to route to first (the trapdoor itself
  // is ground decoration, so walkToObject cannot find a side to stand on).
  const NORTH_TRAPDOOR_APPROACH = { x: 3405, y: 3506, z: 0 };
  const CHURCH_TRAPDOOR_APPROACH = { x: 3421, y: 3485, z: 0 };
  const MAUSOLEUM_LADDER_LOCATION = { x: 3405, y: 9907, z: 0 };
  const NORTH_TRAPDOOR_LANDING = new Location(3405, 9906, 0);
  const CHURCH_TRAPDOOR_LANDING = new Location(3422, 9885, 0);
  const MAUSOLEUM_LADDER_LANDING = new Location(3405, 3506, 0);
  const HOLY_BARRIER_LANDING = new Location(3423, 3485, 0);
  const GUARDIAN_SPAWN = { x: 3405, y: 9902, z: 0 };
  /** The mausoleum's own map square, for deciding whether a login is inside it. */
  const MAUSOLEUM_BOUNDS = { minX: 3395, maxX: 3455, minY: 9878, maxY: 9912 };

  let quest;
  /** The private guardian spawned for each quester (owner-only). */
  const guardianByPlayer = new Map();

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;

  function essenceCount(player) {
    return (
      player.getInventory().getAmount(RUNE_ESSENCE_ITEM_ID) +
      player.getInventory().getAmount(PURE_ESSENCE_ITEM_ID)
    );
  }

  function takeEssence(player) {
    let remaining = ESSENCE_REQUIRED;
    for (const itemId of [RUNE_ESSENCE_ITEM_ID, PURE_ESSENCE_ITEM_ID]) {
      while (remaining > 0 && player.getInventory().getAmount(itemId) > 0) {
        player.getInventory().deleteNumber(itemId, 1);
        remaining--;
      }
    }
    return remaining === 0;
  }

  /** Hand-ins are banked: 50 unnoted essence do not fit in one inventory. */
  function essenceHandedIn(player) {
    return Number(player.getAttribute(ESSENCE_HANDED_ATTRIBUTE)) || 0;
  }

  function giveEssenceToDrezel(player) {
    let taken = 0;
    for (const itemId of [RUNE_ESSENCE_ITEM_ID, PURE_ESSENCE_ITEM_ID]) {
      const amount = player.getInventory().getAmount(itemId);
      if (amount > 0) {
        player.getInventory().deleteNumber(itemId, amount);
        taken += amount;
      }
    }
    player.setAttribute(ESSENCE_HANDED_ATTRIBUTE, Math.min(ESSENCE_REQUIRED, essenceHandedIn(player) + taken));
  }

  function inMausoleum(player) {
    const location = player.getLocation();
    return (
      location.getX() >= MAUSOLEUM_BOUNDS.minX &&
      location.getX() <= MAUSOLEUM_BOUNDS.maxX &&
      location.getY() >= MAUSOLEUM_BOUNDS.minY &&
      location.getY() <= MAUSOLEUM_BOUNDS.maxY &&
      location.getZ() === 0
    );
  }

  function hasGuardian(player) {
    const npc = guardianByPlayer.get(player);
    return Boolean(npc && npc.getHitpoints?.() > 0);
  }

  /**
   * The world's 3487 guardian is nameless and optionless at quest stages (its
   * transform is keyed to raw varp 302 values 0-2), so a quester in the
   * mausoleum gets a private attackable 7620 on the same spot. Removed on death
   * (the quest moves on) and on logout; never respawned after the kill.
   */
  function ensureGuardian(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_GUARDIAN_KILLED) return;
    if (hasGuardian(player)) return;
    const npc = api.spawnNpc({
      id: TEMPLE_GUARDIAN_NPC_ID,
      x: GUARDIAN_SPAWN.x,
      y: GUARDIAN_SPAWN.y,
      z: GUARDIAN_SPAWN.z,
      wanderRadius: 2,
      owner: player,
      ownerOnly: true,
    });
    if (!npc) return;
    // Without this the death task queues the definition's own respawn.
    npc.__skipDefaultRespawn = true;
    guardianByPlayer.set(player, npc);
  }

  function removeGuardian(player) {
    const npc = guardianByPlayer.get(player);
    if (!npc) return;
    guardianByPlayer.delete(player);
    api.removeNpc(npc);
  }

  function sameTile(location, tile) {
    return Boolean(location) && location.x === tile.x && location.y === tile.y && (location.z ?? 0) === tile.z;
  }

  function adjacentTo(location, tile) {
    return Math.max(Math.abs(location.x - tile.x), Math.abs(location.y - tile.y)) <= 1;
  }

  /**
   * The trapdoors are ground decoration (shape 22): walkToObject cannot find a
   * side to stand on, so the click never reaches the interaction hooks. Route to
   * a walkable tile beside one first; an adjacent click stands still.
   */
  function handleTrapdoorRoute(event) {
    const objectLocation = event.object?.getLocation?.();
    if (event.objectId === NORTH_TRAPDOOR_ID && sameTile(objectLocation, NORTH_TRAPDOOR_LOCATION)) {
      event.destination = adjacentTo(event.sourceLocation, NORTH_TRAPDOOR_LOCATION)
        ? { ...event.sourceLocation }
        : { ...NORTH_TRAPDOOR_APPROACH };
      return;
    }
    if (event.objectId === CHURCH_TRAPDOOR_ID && sameTile(objectLocation, CHURCH_TRAPDOOR_LOCATION)) {
      event.destination = adjacentTo(event.sourceLocation, CHURCH_TRAPDOOR_LOCATION)
        ? { ...event.sourceLocation }
        : { ...CHURCH_TRAPDOOR_APPROACH };
    }
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I restored the River Salve barrier.</str>",
        "<str>Drezel can safely guard the temple again.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_VAMPYRE_SEALED) {
      return [
        "<str>I freed Drezel and sealed the vampyre's coffin.</str>",
        "Drezel needs <col=800000>50 rune or pure essence</col>",
        "to restore the River Salve barrier.",
      ];
    }
    if (stage >= STAGE_MET_DREZEL) {
      return [
        "<str>I found Drezel imprisoned beneath the temple.</str>",
        "I should seal the vampyre's coffin and warn",
        "<col=800000>King Roald</col>.",
      ];
    }
    if (stage >= STAGE_TOLD_KING_ROALD) {
      return [
        "King Roald explained that the creature guarded Misthalin.",
        "I must return to the temple and rescue <col=800000>Drezel</col>.",
      ];
    }
    if (stage >= STAGE_GUARDIAN_KILLED) {
      return [
        "<str>I killed the creature at the temple.</str>",
        "I should report back to <col=800000>King Roald</col>.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "King Roald sent me to check on <col=800000>Drezel</col>.",
        "I should investigate the temple east of Varrock.",
      ];
    }
    return [
      "I can start this quest by speaking to",
      "<col=800000>King Roald</col> in Varrock Palace.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.PRAYER, 1406);
  }

  function kingRoaldVariant(stage, player) {
    // Shield of Arrav also finishes at King Roald; defer to its handler once the
    // player has joined a gang (otherwise its certificate branch is unreachable).
    const shieldStage = Number(player.getAttribute("quest.shield_of_arrav.stage")) || 0;
    if (shieldStage >= 4) return null;
    if (stage >= STAGE_COMPLETE) {
      return { page: "King Roald", variant: "standard-dialogue-after-priest-in-peril" };
    }
    if (stage >= STAGE_VAMPYRE_SEALED) {
      return "after-drezel-is-freed-and-the-vampyre-is-sealed-talking-to-king-roald-again";
    }
    if (stage >= STAGE_MET_DREZEL) return "saving-drezel-and-the-world-updating-king-roald";
    if (stage >= STAGE_TOLD_KING_ROALD) return "you-killed-a-dog-talking-to-him-again";
    if (stage >= STAGE_GUARDIAN_KILLED) {
      // Telling him about the dog is what completes "report back to King Roald".
      quest.setStage(player, STAGE_TOLD_KING_ROALD);
      return "you-killed-a-dog-talking-to-king-roald-about-the-now-dead-dog";
    }
    if (stage >= STAGE_STARTED) return "starting-the-quest-talking-to-king-roald-again";
    return "starting-the-quest";
  }

  /**
   * Drezel drives the middle of the quest. Meeting him advances to "met"; the
   * golden key earns the blessed water; fifty essence finishes the barrier.
   */
  function drezelVariant(stage, player) {
    if (stage >= STAGE_COMPLETE) {
      return "after-drezel-is-freed-and-the-vampyre-is-sealed-talking-to-drezel-again";
    }
    if (stage >= STAGE_VAMPYRE_SEALED) {
      if (essenceHandedIn(player) + essenceCount(player) >= ESSENCE_REQUIRED) {
        return "giving-drezel-the-last-of-the-essence";
      }
      return essenceCount(player) > 0
        ? "repairing-the-barrier-bringing-drezel-essence"
        : "repairing-the-barrier-talking-to-drezel-again";
    }
    if (stage >= STAGE_MET_DREZEL) {
      if (held(player, GOLDEN_KEY_ITEM_ID)) {
        if (!held(player, BLESSED_WATER_ITEM_ID)) {
          player.getInventory().adds(BLESSED_WATER_ITEM_ID, 1);
          player.sendMessage("Drezel blesses some water for you.");
        }
        quest.setStage(player, STAGE_VAMPYRE_SEALED);
        return "saving-drezel-and-the-world-talking-to-drezel-with-the-golden-key";
      }
      return "saving-drezel-and-the-world-talking-to-drezel-again";
    }
    quest.setStage(player, STAGE_MET_DREZEL);
    return "saving-drezel-and-the-world-meeting-drezel";
  }

  /** Which transcript variant the speaker plays. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (KING_ROALD_NPC_IDS.has(npcId)) return kingRoaldVariant(stage, player);
    if (npcId === DREZEL_NPC_ID) return drezelVariant(stage, player);
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const stage = quest.getStage(player);
    if (value.includes("attempts to use magic spells on the guardian")) return true;
    if (value.includes("has murky water")) return false;
    if (value.includes("doesn't have murky water")) return true;
    if (value.includes("first time blessing water")) return stage < STAGE_VAMPYRE_SEALED;
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!KING_ROALD_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** The transcript's hand-in and "Quest complete!" steps drive the essence count. */
  function handleAction(event) {
    const { player, npcId, stepId, kind } = event;
    // The wiki guards the warning below combat 15 but the parsed message is
    // unconditional; drop it for everyone who meets the recommendation.
    if (kind === "message" && stepId === COMBAT_WARNING_STEP_ID) {
      if (player.getSkillManager().getCombatLevel() >= RECOMMENDED_COMBAT_LEVEL) event.handled = true;
      return;
    }
    if (npcId !== DREZEL_NPC_ID) return;
    if (kind === "message" && ESSENCE_MESSAGE_IDS.has(stepId)) {
      // Fire only on the message emission, not the generic action one.
      giveEssenceToDrezel(player);
      return;
    }
    if (stepId !== COMPLETE_ACTION_ID) return;
    if (quest.getStage(player) >= STAGE_VAMPYRE_SEALED && !quest.isComplete(player)) {
      // The batch was already banked when the transcript's message played; the
      // fallback covers a completion action reached without the message.
      if (essenceHandedIn(player) < ESSENCE_REQUIRED) takeEssence(player);
      quest.complete(player);
    }
  }

  /** Fill Drezel's "[1-50] more" blank with the essence still owed. */
  function fillEssenceLine(event) {
    if (event.npcId !== DREZEL_NPC_ID || typeof event.text !== "string") return;
    if (!event.text.includes(ESSENCE_REMAINING_BLANK)) return;
    const remaining = Math.max(0, ESSENCE_REQUIRED - essenceHandedIn(event.player));
    event.text = event.text.replace(ESSENCE_REMAINING_BLANK, String(remaining));
  }

  /** Killing the temple guardian advances the quest. */
  function handleGuardianDeath({ killer, npcId }) {
    if (!killer || npcId !== TEMPLE_GUARDIAN_NPC_ID) return;
    guardianByPlayer.delete(killer);
    if (quest.getStage(killer) < STAGE_GUARDIAN_KILLED) {
      quest.setStage(killer, STAGE_GUARDIAN_KILLED);
    }
  }

  /**
   * The hooded level-30 monk drops the golden key. The monks only expose
   * "Attack" (no Talk-to), so the kill is the reachable key hand-out.
   */
  function handleMonkDeath({ killer, npcId }) {
    if (!killer || !MONKS_OF_ZAMORAK_NPC_IDS.has(npcId)) return;
    if (quest.getStage(killer) < STAGE_GUARDIAN_KILLED) return;
    if (held(killer, GOLDEN_KEY_ITEM_ID)) return;
    killer.getInventory().adds(GOLDEN_KEY_ITEM_ID, 1);
    killer.sendMessage("The monk drops a golden key.");
  }

  /** The Zamorakian monks are not indexed, so replay their line and hand over the key. */
  function handleMonkInteraction(event) {
    if (!MONKS_OF_ZAMORAK_NPC_IDS.has(event.npcId)) return;
    const { player } = event;
    if (quest.getStage(player) < STAGE_GUARDIAN_KILLED) return;
    event.handled = true;
    if (!held(player, GOLDEN_KEY_ITEM_ID)) {
      player.getInventory().adds(GOLDEN_KEY_ITEM_ID, 1);
      player.sendMessage("The monk hands you a golden key.");
    }
    startTranscript(
      api, player, event.npcId, PAGE, "you-killed-a-dog-letting-the-monks-know-you-did-the-deed"
    );
  }

  /**
   * The trapdoors north of the temple and inside the church drop into the
   * mausoleum (the ladder at 3405,9907 is right below the north one). The
   * generic Ladders fallback cannot pair a trapdoor's "Open" with the ladder,
   * so climb down explicitly.
   */
  function handleTrapdoorOpen(event) {
    const { player, objectId, location } = event;
    if (objectId === NORTH_TRAPDOOR_ID && sameTile(location, NORTH_TRAPDOOR_LOCATION)) {
      ensureGuardian(player);
      api.emitCustomEvent("ladders:climbDown", { player, destination: NORTH_TRAPDOOR_LANDING.clone() });
      event.handled = true;
      return true;
    }
    if (objectId === CHURCH_TRAPDOOR_ID && sameTile(location, CHURCH_TRAPDOOR_LOCATION)) {
      ensureGuardian(player);
      api.emitCustomEvent("ladders:climbDown", { player, destination: CHURCH_TRAPDOOR_LANDING.clone() });
      event.handled = true;
      return true;
    }
    return false;
  }

  /**
   * Doors lists "Trapdoor" among its toggles and its Open hook registers before
   * this quest's, so claim the two mausoleum trapdoors through "door:toggle",
   * which runs before any generic door handling.
   */
  function claimTrapdoorToggle(request) {
    if (request.handled) return;
    handleTrapdoorOpen(request);
  }

  /**
   * The mausoleum ladder (17385) is listed at many other places, and Monk's
   * Friend claims every 17385 for its cave; claim this one through the Ladders
   * "ladders:climb" extension point, which runs before the generic hooks.
   */
  function claimMausoleumClimb(request) {
    if (request.objectId !== MAUSOLEUM_LADDER_ID) return;
    const location = request.object?.getLocation?.();
    if (!location || location.getX() !== MAUSOLEUM_LADDER_LOCATION.x || location.getY() !== MAUSOLEUM_LADDER_LOCATION.y) {
      return;
    }
    api.emitCustomEvent("ladders:climbUp", {
      player: request.player,
      destination: MAUSOLEUM_LADDER_LANDING.clone(),
    });
    request.handled = true;
  }

  function handleHolyBarrier({ player, objectId }) {
    if (objectId !== ObjectIdentifiers.HOLY_BARRIER) return false;
    if (!quest.isComplete(player)) {
      player.sendMessage("You need to complete Priest in Peril before passing through this barrier.");
      return true;
    }
    player.moveTo(HOLY_BARRIER_LANDING.clone());
    player.sendMessage("You pass through the holy barrier.");
    return true;
  }

  /**
   * Knocking the large door: the Mysterious Voice asks about the dog before the
   * kill and thanks the player after it. Once the King has been told, the door
   * just opens (the doors plugin's normal toggle). Before the quest nobody
   * answers and the door stays shut.
   */
  function handleLargeDoor(request) {
    if (!LARGE_DOOR_IDS.has(request.objectId)) return;
    const { player } = request;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED) {
      startTranscript(api, player, MYSTERIOUS_VOICE_NPC_ID, PAGE, "pre-quest-at-the-temple-before-starting-the-quest");
      request.handled = true;
      return;
    }
    if (stage >= STAGE_TOLD_KING_ROALD) return;
    const variant = stage >= STAGE_GUARDIAN_KILLED
      ? "you-killed-a-dog-letting-the-monks-know-you-did-the-deed"
      : player.getAttribute(DOOR_ANSWERED_ATTRIBUTE)
        ? "at-the-temple-knocking-on-the-door-after-accepting-to-kill-the-dog"
        : "at-the-temple";
    if (startTranscript(api, player, MYSTERIOUS_VOICE_NPC_ID, PAGE, variant)) {
      player.setAttribute(DOOR_ANSWERED_ATTRIBUTE, true);
      request.handled = true;
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    if (inMausoleum(player)) ensureGuardian(player);
  }

  function handleLogout({ player }) {
    if (player) removeGuardian(player);
  }

  quest = registerQuest(api, {
    key: "priest_in_peril",
    name: "Priest in Peril",
    varpId: VARP_PRIEST_IN_PERIL,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.PRAYER.getIndex(), amount: 1406, label: "Prayer" }],
    rewardItemId: ItemIdentifiers.WOLFBANE,
    rewardItemLabel: "Wolfbane dagger",
    otherRewards: ["Access to Morytania"],
    buildJournal,
    onReward: grantReward,
    varpValue: (stage) => VARP_VALUE_BY_STAGE.get(stage) ?? stage,
  });

  api.persistAttribute(DOOR_ANSWERED_ATTRIBUTE);
  api.persistAttribute(ESSENCE_HANDED_ATTRIBUTE);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", fillEssenceLine);
  api.onCustomEvent("door:toggle", handleLargeDoor);
  api.onCustomEvent("door:toggle", claimTrapdoorToggle);
  api.onCustomEvent("ladders:climb", claimMausoleumClimb);
  api.onNpcDeath(handleGuardianDeath);
  api.onNpcDeath(handleMonkDeath);
  api.onNpcInteraction(handleMonkInteraction);
  api.onObjectRoute(handleTrapdoorRoute);
  api.onObjectInteraction("Trapdoor", { Open: handleTrapdoorOpen });
  api.onObjectInteraction("Holy barrier", { "Pass-through": handleHolyBarrier });
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
