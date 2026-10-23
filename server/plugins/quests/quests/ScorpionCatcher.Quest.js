/**
 * Scorpion Catcher (members).
 *
 * The words come from the "Scorpion Catcher" transcript page:
 *   Thormac (5232): starting-off-* -> finishing-up (complete)
 *   Seer    (5231): first-scorpion-* -> second-and-third-scorpions-*
 *
 * This plugin supplies the variant selector for Thormac and the Seer, the start
 * hook, the prose-condition answers, the cage-on-scorpion catching and the
 * completion action. The quest scorpions (5228-5230) are spawned by the world,
 * and Peksa's quest variant is replayed because the index gives him a separate
 * standard page with no variant selector.
 *
 * Stages: 0 unstarted, 1 cage received, 2 first hint known, 3 optional second
 * Seer detail, 4 complete. After the first hint the three scorpions may be
 * caught in any order. Durable completion stage 4 is sent as varp 76 value 6:
 * cache quest DB row 126 requires >= 6 for completion.
 *
 * Requirements: the OSRS Wiki marks Alfred Grimhand's Barcrawl as the only
 * "[required to start]" requirement and 31 Prayer as "[not required to start]"
 * (it is needed to enter the Monastery 1st floor, shared Doors/Ladders content
 * this plugin does not own). This server has no Barcrawl quest or attribute, so
 * the start gate cannot be enforced here and the quest is offered as it comes;
 * Prayer is therefore not used as a substitute for the missing requirement.
 *
 * Picking a scorpion up stings for 3 hitpoints (OSRS Wiki, "The first
 * scorpion"), and the post-quest battlestaff service uses the cache interface
 * 332 "thormac" ("What would you like to enchant?"), which lists one
 * "Enchant" button per elemental battlestaff.
 */
module.exports = function registerScorpionCatcherQuest(api) {
  const { Skill, Location, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, startTranscript, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Scorpion Catcher";

  const THORMAC_NPC_ID = NpcIdentifiers.THORMAC;
  const SEER_NPC_ID = NpcIdentifiers.SEER;
  const PEKSA_NPC_ID = NpcIdentifiers.PEKSA;
  const SECRET_WALL_ID = ObjectIdentifiers.OLD_WALL;

  const FIRST_SCORPION_NPC_ID = NpcIdentifiers.KHARID_SCORPION;
  const SECOND_SCORPION_NPC_ID = NpcIdentifiers.KHARID_SCORPION_2;
  const THIRD_SCORPION_NPC_ID = NpcIdentifiers.KHARID_SCORPION_3;

  const VARP_SCORPION_CATCHER = 76;
  const WIRE_COMPLETE = 6;
  const STAGE_STARTED = 1;
  const STAGE_FIRST_HINT = 2;
  const STAGE_SECOND_HINT = 3;
  const STAGE_COMPLETE = 4;

  const EMPTY_CAGE = ItemIdentifiers.SCORPION_CAGE;
  const FULL_CAGE = ItemIdentifiers.SCORPION_CAGE_8;

  /** Cache interface "thormac": "What would you like to enchant?". */
  const ENCHANT_INTERFACE = 332;
  /** The transcript's target name for that interface. */
  const ENCHANT_TARGET = "Thormac's battlestaff enchanting";
  /** OSRS Wiki (Battlestaff): 40,000 coins; 30,000/20,000 with the Hard/Elite Kandarin diaries. */
  const ENCHANT_PRICE = 40000;
  const COINS = ItemIdentifiers.COINS;
  /** The interface's "Enchant" buttons, one per elemental battlestaff (cache script 330). */
  const ENCHANT_STAFF_BY_BUTTON = new Map([
    [3, ItemIdentifiers.SMOKE_BATTLESTAFF],
    [4, ItemIdentifiers.AIR_BATTLESTAFF],
    [5, ItemIdentifiers.WATER_BATTLESTAFF],
    [6, ItemIdentifiers.EARTH_BATTLESTAFF],
    [7, ItemIdentifiers.FIRE_BATTLESTAFF],
    [8, ItemIdentifiers.LAVA_BATTLESTAFF],
    [9, ItemIdentifiers.MUD_BATTLESTAFF],
    [10, ItemIdentifiers.STEAM_BATTLESTAFF],
    [11, ItemIdentifiers.MIST_BATTLESTAFF],
    [12, ItemIdentifiers.DUST_BATTLESTAFF],
  ]);
  /** An elemental battlestaff becomes the mystic staff of the same element. */
  const MYSTIC_STAFF_BY_BATTLESTAFF = new Map([
    [ItemIdentifiers.AIR_BATTLESTAFF, ItemIdentifiers.MYSTIC_AIR_STAFF],
    [ItemIdentifiers.WATER_BATTLESTAFF, ItemIdentifiers.MYSTIC_WATER_STAFF],
    [ItemIdentifiers.EARTH_BATTLESTAFF, ItemIdentifiers.MYSTIC_EARTH_STAFF],
    [ItemIdentifiers.FIRE_BATTLESTAFF, ItemIdentifiers.MYSTIC_FIRE_STAFF],
    [ItemIdentifiers.LAVA_BATTLESTAFF, ItemIdentifiers.MYSTIC_LAVA_STAFF],
    [ItemIdentifiers.MUD_BATTLESTAFF, ItemIdentifiers.MYSTIC_MUD_STAFF],
    [ItemIdentifiers.STEAM_BATTLESTAFF, ItemIdentifiers.MYSTIC_STEAM_STAFF],
    [ItemIdentifiers.SMOKE_BATTLESTAFF, ItemIdentifiers.MYSTIC_SMOKE_STAFF],
    [ItemIdentifiers.MIST_BATTLESTAFF, ItemIdentifiers.MYSTIC_MIST_STAFF],
    [ItemIdentifiers.DUST_BATTLESTAFF, ItemIdentifiers.MYSTIC_DUST_STAFF],
  ]);

  /** cage item -> which scorpions it holds (bit 1 first, 2 second, 4 third). */
  const CAGE_MASK_BY_ITEM = new Map([
    [ItemIdentifiers.SCORPION_CAGE, 0],
    [ItemIdentifiers.SCORPION_CAGE_2, 1],
    [ItemIdentifiers.SCORPION_CAGE_5, 2],
    [ItemIdentifiers.SCORPION_CAGE_7, 4],
    [ItemIdentifiers.SCORPION_CAGE_3, 3],
    [ItemIdentifiers.SCORPION_CAGE_4, 5],
    [ItemIdentifiers.SCORPION_CAGE_6, 6],
    [ItemIdentifiers.SCORPION_CAGE_8, 7],
  ]);
  const CAGE_ITEM_BY_MASK = new Map(
    [...CAGE_MASK_BY_ITEM].map(([itemId, mask]) => [mask, itemId])
  );
  const CAGE_ITEM_IDS = [...CAGE_MASK_BY_ITEM.keys()];

  const SCORPION_BIT_BY_NPC = new Map([
    [FIRST_SCORPION_NPC_ID, 1],
    [SECOND_SCORPION_NPC_ID, 2],
    [THIRD_SCORPION_NPC_ID, 4],
  ]);

  const START_HOOK = "quest:scorpion-catcher:start";
  /** "finishing-up" ends with this action. */
  const COMPLETE_ACTION_ID = "QeBozC";
  /** OSRS Wiki: picking a scorpion up stings for 3 hitpoints. */
  const STING_DAMAGE = 3;
  const SEER_FIRST_OPTION = "I need to locate some scorpions.";
  const SEER_RETRIEVED_OPTION = "I've retrieved the scorpion from near the spiders.";

  let quest;
  /** Players with Thormac's enchanting interface open. */
  const enchanting = new WeakSet();

  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const ownsAnyCage = (player) => CAGE_ITEM_IDS.some((itemId) => has(player, itemId));
  const ownsFullCage = (player) => has(player, FULL_CAGE);

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I returned all three Kharid scorpions to Thormac.</str>",
        "<str>He can now enchant battlestaves for me.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage === 0) {
      return [
        "I can start this quest by speaking to <col=800000>Thormac</col>",
        "in the <col=800000>Sorcerer's Tower</col> south-west of Catherby.",
        "",
        "I need level 31 <col=800000>Prayer</col> to enter the Monastery upstairs.",
      ];
    }
    const lines = ["<str>Thormac asked me to recover his three Kharid scorpions.</str>", ""];
    const hasFirst = [ItemIdentifiers.SCORPION_CAGE_2, ItemIdentifiers.SCORPION_CAGE_3, ItemIdentifiers.SCORPION_CAGE_4, FULL_CAGE].some((id) => has(player, id));
    const hasSecond = [ItemIdentifiers.SCORPION_CAGE_5, ItemIdentifiers.SCORPION_CAGE_3, ItemIdentifiers.SCORPION_CAGE_6, FULL_CAGE].some((id) => has(player, id));
    const hasThird = [ItemIdentifiers.SCORPION_CAGE_7, ItemIdentifiers.SCORPION_CAGE_4, ItemIdentifiers.SCORPION_CAGE_6, FULL_CAGE].some((id) => has(player, id));
    if (stage === STAGE_STARTED) {
      return [...lines, "I should ask a <col=800000>Seer</col> where the scorpions escaped to."];
    }
    if (stage >= STAGE_FIRST_HINT) {
      lines.push(
        hasFirst
          ? "<str>I caught the scorpion in the secret room near spiders and coffins.</str>"
          : "One scorpion is in a <col=800000>secret room</col> near spiders and two coffins."
      );
    }
    if (stage >= STAGE_SECOND_HINT) {
      lines.push(
        hasSecond
          ? "<str>I caught the scorpion hidden at the Barbarian Outpost.</str>"
          : "One scorpion was taken to the <col=800000>Barbarian Outpost</col>.",
        hasThird
          ? "<str>I caught the scorpion upstairs in the Edgeville Monastery.</str>"
          : "One scorpion is upstairs by brown robes in the <col=800000>Monastery</col>."
      );
    } else {
      if (hasSecond) lines.push("<str>I caught the scorpion hidden at the Barbarian Outpost.</str>");
      if (hasThird) lines.push("<str>I caught the scorpion upstairs in the Edgeville Monastery.</str>");
    }
    if (hasFirst && hasSecond && hasThird) {
      lines.push("", "I should take the full cage back to <col=800000>Thormac</col>.");
    }
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.STRENGTH, 6625);
  }

  /** A hit the player takes, like the trap damage other quests apply. */
  function sting(player, amount) {
    const hit = api.core.HitDamage && new api.core.HitDamage(amount, api.core.HitMask.RED);
    const queue = player.getCombat?.()?.getHitQueue?.();
    if (hit && queue?.addPendingDamage) queue.addPendingDamage([hit]);
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === THORMAC_NPC_ID) {
      // After completion the Thormac page owns the thank-you and battlestaff service.
      if (stage >= STAGE_COMPLETE) return null;
      if (stage >= STAGE_STARTED && ownsFullCage(player)) {
        return "finishing-up";
      }
      if (stage === 0) {
        // The only start requirement is Alfred Grimhand's Barcrawl, which this
        // server has no quest or attribute for, so the quest is offered as it
        // comes rather than refused on a requirement that cannot be read.
        return "starting-off-with-the-requirements";
      }
      return "starting-off-subsequent-dialogue";
    }
    if (npcId === SEER_NPC_ID) {
      // Leave the standard Seer page (and Mourning's End Part I) alone when this
      // quest is unstarted or finished.
      if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return null;
      if (stage === STAGE_STARTED) return "first-scorpion-help-from-a-seer";
      if (stage === STAGE_FIRST_HINT) {
        return has(player, ItemIdentifiers.SCORPION_CAGE_2) ||
          has(player, ItemIdentifiers.SCORPION_CAGE_3) ||
          has(player, ItemIdentifiers.SCORPION_CAGE_4) ||
          ownsFullCage(player)
          ? "second-and-third-scorpions-more-help-from-a-seer"
          : "first-scorpion-subsequent-dialogue";
      }
      return "second-and-third-scorpions-more-help-from-a-seer";
    }
    return null;
  }

  function answerCondition({ player, npcId, text }) {
    if (npcId !== THORMAC_NPC_ID && npcId !== SEER_NPC_ID) return null;
    const value = String(text).toLowerCase();
    if (value.includes("full inventory")) return false;
    void player;
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== THORMAC_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) {
      if (!ownsAnyCage(player)) player.getInventory().adds(EMPTY_CAGE, 1);
      quest.setStage(player, STAGE_STARTED);
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId, action, target } = event;
    if (npcId === THORMAC_NPC_ID && action === "open_interface" && target === ENCHANT_TARGET) {
      openEnchantInterface(event);
      return;
    }
    if (npcId !== THORMAC_NPC_ID || stepId !== COMPLETE_ACTION_ID) return;
    if (quest.isComplete(player)) return;
    if (!ownsFullCage(player)) return;
    event.handled = true;
    player.getInventory().deleteNumber(FULL_CAGE, 1);
    quest.complete(player);
  }

  /**
   * The post-quest battlestaff service: Thormac's standard page opens the cache
   * interface "thormac", which offers one "Enchant" button per elemental
   * battlestaff. The service is only open while that dialogue is.
   */
  function openEnchantInterface(event) {
    const { player } = event;
    if (!quest.isComplete(player)) return;
    event.handled = true;
    event.end = true;
    enchanting.add(player);
    player.getPacketSender().sendInterface(ENCHANT_INTERFACE);
  }

  /** "Enchant" on one of the interface's battlestaff buttons. */
  function handleEnchantClick(event) {
    const { player } = event;
    if (event.groupId !== ENCHANT_INTERFACE) return;
    if (!enchanting.has(player)) return;
    const staff = MYSTIC_STAFF_BY_BATTLESTAFF.has(event.itemId)
      ? event.itemId
      : ENCHANT_STAFF_BY_BUTTON.get(event.childId);
    if (staff === undefined) return;
    event.handled = true;
    const inventory = player.getInventory();
    if (!inventory.getAmount(staff)) {
      player.sendMessage("You do not have that battlestaff.");
      return;
    }
    if (inventory.getAmount(COINS) < ENCHANT_PRICE) {
      player.sendMessage("You do not have enough coins to pay for that.");
      return;
    }
    inventory.deleteNumber(staff, 1);
    inventory.deleteNumber(COINS, ENCHANT_PRICE);
    inventory.adds(MYSTIC_STAFF_BY_BATTLESTAFF.get(staff), 1);
    player.sendMessage("Thormac enchants your battlestaff into a mystic staff.");
  }

  /** The Seer's first and second conversations publish the hints the catches key on. */
  function handleChoice({ player, npcId, option }) {
    if (npcId !== SEER_NPC_ID) return;
    const stage = quest.getStage(player);
    if (option === SEER_FIRST_OPTION && stage === STAGE_STARTED) {
      quest.setStage(player, STAGE_FIRST_HINT);
    } else if (option === SEER_RETRIEVED_OPTION && stage === STAGE_FIRST_HINT) {
      quest.setStage(player, STAGE_SECOND_HINT);
    }
  }

  /** A lost cage can be replaced by talking to Thormac again while in progress. */
  function handleThormacRecovery(event) {
    const { player, npcId, clickType, definition } = event;
    if (npcId !== THORMAC_NPC_ID) return;
    const action = definition?.getActions?.()?.[(clickType ?? 1) - 1];
    if (action && action !== "Talk-to") return;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return;
    if (ownsAnyCage(player)) return;
    player.getInventory().adds(EMPTY_CAGE, 1);
  }

  /** Peksa's quest variant has the scorpion information; the index only defaults to his shop page. */
  function handlePeksa(event) {
    const { player, npcId, clickType, definition } = event;
    if (npcId !== PEKSA_NPC_ID) return;
    const action = definition?.getActions?.()?.[(clickType ?? 1) - 1];
    if (action && action !== "Talk-to") return;
    const stage = quest.getStage(player);
    if (stage < STAGE_FIRST_HINT || stage >= STAGE_COMPLETE) return;
    event.handled = true;
    startTranscript(api, player, npcId, PAGE, "second-and-third-scorpions-brotherly-love");
  }

  /** Picking a scorpion up stings for 3 hitpoints; the cage is the way to catch it. */
  function handleScorpionInteraction(event) {
    const { player, npcId, clickType, definition } = event;
    if (!SCORPION_BIT_BY_NPC.has(npcId)) return;
    const actions = definition?.getActions?.();
    if (actions && actions[(clickType ?? 1) - 1] !== "Pick-up") return;
    event.handled = true;
    player.sendMessage("The scorpion stings you!");
    sting(player, STING_DAMAGE);
  }

  function requiredStageForScorpion() {
    // Once the Seer gives the first location, the Wiki and Quest Helper allow
    // all three scorpions to be caught in any order.
    return STAGE_FIRST_HINT;
  }

  function onCageOnScorpion(event) {
    const scorpionBit = SCORPION_BIT_BY_NPC.get(event.npcId ?? event.target?.getId?.());
    if (scorpionBit === undefined) return;
    const currentMask = CAGE_MASK_BY_ITEM.get(event.itemId);
    if (currentMask === undefined) return;
    const { player } = event;
    if (quest.getStage(player) < requiredStageForScorpion()) {
      player.sendMessage("You do not know where this scorpion belongs.");
      return;
    }
    if ((currentMask & scorpionBit) !== 0) {
      player.sendMessage("You've already caught this scorpion.");
      return;
    }
    const nextItemId = CAGE_ITEM_BY_MASK.get(currentMask | scorpionBit);
    if (nextItemId === undefined) return;
    player.getInventory().deleteNumber(event.itemId, 1);
    player.getInventory().adds(nextItemId, 1);
    player.sendMessage("You catch a scorpion!");
  }

  /** The secret room wall by the spiders opens once the first hint is known. */
  function handleSecretWall(event) {
    if (event.objectId !== SECRET_WALL_ID) return;
    const { player } = event;
    if (quest.getStage(player) < STAGE_FIRST_HINT) {
      player.sendMessage("It looks like an ordinary wall.");
      event.handled = true;
      return;
    }
    const here = player.getLocation();
    const wall = event.location;
    const x = here.getX();
    const y = here.getY();
    // The wall is the south edge of the secret room; cross the side the player
    // is standing on, moving in Y for the usual approach, X when alongside it.
    const useY = Math.abs(y - wall.y) >= Math.abs(x - wall.x);
    const targetX = useY ? wall.x : x < wall.x ? wall.x + 1 : wall.x - 1;
    const targetY = useY ? (y < wall.y ? wall.y + 1 : wall.y - 1) : wall.y;
    player.moveTo(new Location(targetX, targetY, wall.z ?? here.getZ()));
    player.sendMessage("You've found a secret door.");
    event.handled = true;
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  function handleInterfaceClosed({ player }) {
    // The enchanting interface is the only one this plugin opens, so any close
    // ends the service.
    enchanting.delete(player);
  }

  function handleLogout({ player }) {
    enchanting.delete(player);
  }

  quest = registerQuest(api, {
    key: "scorpion_catcher",
    name: "Scorpion Catcher",
    varpId: VARP_SCORPION_CATCHER,
    // Durable saves stay on stage 4; the native wire needs varp 76 >= 6.
    varpValue(stage) {
      return stage >= STAGE_COMPLETE ? WIRE_COMPLETE : stage;
    },
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.STRENGTH.getIndex(), amount: 6625, label: "Strength" }],
    otherRewards: ["Thormac can enchant elemental battlestaves into mystic staves for 40,000 coins"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onNpcInteraction(handleThormacRecovery);
  api.onNpcInteraction(handlePeksa);
  api.onNpcInteraction(handleScorpionInteraction);
  api.onItemOnNpc(onCageOnScorpion);
  api.onObjectInteraction(handleSecretWall);
  api.onPlayerLogin(handleLogin);
  api.onInterfaceActionClick(handleEnchantClick);
  api.onCustomEvent("interface:closed", handleInterfaceClosed);
  api.onPlayerLogout(handleLogout);
};
