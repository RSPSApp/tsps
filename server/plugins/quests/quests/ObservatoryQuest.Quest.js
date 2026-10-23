/**
 * Observatory Quest (members).
 *
 * The words come from the "Observatory Quest" transcript page. The professor, his
 * assistant and the sleeping goblin guard are indexed, so this plugin supplies the
 * by-stage variant selector, the prose-condition answers, the start hook and the
 * "Quest complete!" actions from after-viewing-the-telescope. Stage machine (varp
 * 112) ported from xrsps: 1 planks, 2 bronze, 3 glass, 4 mould, 5 lens, 6 telescope,
 * 7 complete, 8 wine claimed.
 *
 * Ported interactions: the item hand-ins (planks/bronze/glass/lens), the dungeon
 * chests (kitchen key), prodding the sleeping guard and the kitchen gate, the
 * goblin stove (lens mould), casting the lens (mould + molten glass), the two
 * dungeon stair runs and looking through the telescope.
 * The telescope assigns the player a constellation (announced in the message, so
 * text-only clients can answer the professor); the matching wiki reward table is
 * granted alongside the sapphire, and the assistant's post-quest jug of wine is wired.
 */
module.exports = function registerObservatoryQuest(api) {
  const { Skill, Location, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, ObjectManager, MapObjects } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Observatory Quest";

  const VARP_OBSERVATORY_QUEST = 112;

  const STAGE_PLANKS = 1;
  const STAGE_BRONZE = 2;
  const STAGE_GLASS = 3;
  const STAGE_MOULD = 4;
  const STAGE_LENS = 5;
  const STAGE_TELESCOPE = 6;
  const STAGE_COMPLETE = 7;
  const STAGE_CLAIMED_WINE = 8;

  const VIEWED_ATTRIBUTE = "quest.observatory_quest.viewed";
  const GUARD_AWAKE_ATTRIBUTE = "quest.observatory_quest.guard_awake";
  const CONSTELLATION_ATTRIBUTE = "quest.observatory_quest.constellation";

  const START_HOOK = "quest:observatory-quest:start";

  /** Each "Quest complete!" action id and the constellation its branch answers for. */
  const COMPLETION_ACTIONS = new Map([
    ["RZIxJd", "Aquarius"],
    ["42iZjm", "Capricorn"],
    ["az5TSU", "Sagittarius"],
    ["jFQCJj", "Scorpio"],
    ["JTTGjU", "Libra"],
    ["3JvMiY", "Virgo"],
    ["uJHYgt", "Leo"],
    ["5ogiFw", "Cancer"],
    ["OX2wkW", "Gemini"],
    ["b-a96m", "Taurus"],
    ["AlVBZ2", "Aries"],
    ["hHQ5V3", "Pisces"],
  ]);

  /** Item hand-in actions in the returning-with-* branches (stages 1-6). */
  const PLANK_HAND_IN_ACTION = "p1dp6a";
  const BRONZE_HAND_IN_ACTION = "7a36YD";
  const GLASS_HAND_IN_ACTION = "Y5Z4-D";
  const GLASS_RETURN_ACTION = "JH15Z2";
  const LENS_HAND_IN_ACTION = "p1dzXH";

  const PROFESSOR_NPC_ID = NpcIdentifiers.OBSERVATORY_PROFESSOR;
  const PROFESSOR_NPC_IDS = new Set([PROFESSOR_NPC_ID, NpcIdentifiers.OBSERVATORY_PROFESSOR_2]);
  const ASSISTANT_NPC_ID = NpcIdentifiers.OBSERVATORY_ASSISTANT;
  const SLEEPING_GUARD_NPC_ID = NpcIdentifiers.SLEEPING_GUARD;
  const GOBLIN_GUARD_NPC_ID = NpcIdentifiers.GOBLIN_GUARD;

  // 25385-25390: the three marked Observatory Dungeon chests and their open forms.
  const DUNGEON_CHEST_IDS = new Set([
    ObjectIdentifiers.CHEST_79,
    ObjectIdentifiers.CHEST_80,
    ObjectIdentifiers.CHEST_81,
    ObjectIdentifiers.CHEST_82,
    ObjectIdentifiers.CHEST_83,
    ObjectIdentifiers.CHEST_84,
  ]);
  const KITCHEN_GATE_IDS = new Set([ObjectIdentifiers.KITCHEN_GATE, ObjectIdentifiers.KITCHEN_GATE_2]);
  /** 25442 is the cache transform parent of GOBLIN_STOVE/GOBLIN_STOVE_2. */
  const GOBLIN_STOVE_IDS = new Set([
    ObjectIdentifiers.GOBLIN_STOVE,
    ObjectIdentifiers.GOBLIN_STOVE_2,
    25442,
  ]);
  /** 25591 is the cache transform parent of TELESCOPE_8/TELESCOPE_9 (upstairs). */
  const TELESCOPE_IDS = new Set([
    ObjectIdentifiers.TELESCOPE,
    ObjectIdentifiers.TELESCOPE_8,
    ObjectIdentifiers.TELESCOPE_9,
    25591,
  ]);
  const SURFACE_STAIRS_ID = ObjectIdentifiers.STAIRS_129; // 25432, east hill
  const DUNGEON_STAIRS_ID = ObjectIdentifiers.STAIRS_127; // 25429, north + south

  // 2335,9351 is the south end (y is lower); 2355,9395 is the north end.
  const DUNGEON_STAIRS_SOUTH = { x: 2335, y: 9351 };
  const DUNGEON_STAIRS_NORTH = { x: 2355, y: 9395 };
  const SURFACE_STAIRS_LANDING = { x: 2458, y: 3185, z: 0 };
  const DUNGEON_NORTH_LANDING = { x: 2355, y: 9394, z: 0 };
  const OBSERVATORY_LANDING = { x: 2443, y: 3158, z: 0 };


  const PLANK = ItemIdentifiers.PLANK;
  const BRONZE_BAR = ItemIdentifiers.BRONZE_BAR;
  const MOLTEN_GLASS = ItemIdentifiers.MOLTEN_GLASS;
  const GOBLIN_KITCHEN_KEY = ItemIdentifiers.GOBLIN_KITCHEN_KEY;
  const LENS_MOULD = ItemIdentifiers.LENS_MOULD;
  const OBSERVATORY_LENS = ItemIdentifiers.OBSERVATORY_LENS;
  const JUG_OF_WINE = ItemIdentifiers.JUG_OF_WINE;

  const WINE_MESSAGE_ACTION = "3f2Vz2";

  /** The wiki's per-sign reward, on top of the uncut sapphire every run gives. */
  const CONSTELLATION_REWARDS = Object.freeze({
    Aquarius: { items: [[ItemIdentifiers.WATER_RUNE, 25]] },
    Aries: { xp: [Skill.ATTACK, 875] },
    Cancer: { items: [[ItemIdentifiers.AMULET_OF_DEFENCE, 1]] },
    Capricorn: { xp: [Skill.STRENGTH, 875] },
    Gemini: { items: [[ItemIdentifiers.BLACK_2H_SWORD, 1]] },
    Leo: { xp: [Skill.HITPOINTS, 875] },
    Libra: { items: [[ItemIdentifiers.LAW_RUNE, 3]] },
    Pisces: { items: [[ItemIdentifiers.TUNA, 3]] },
    Sagittarius: { items: [[ItemIdentifiers.MAPLE_LONGBOW, 1]] },
    Scorpio: { items: [[ItemIdentifiers.WEAPON_POISON, 1]] },
    Taurus: { items: [[ItemIdentifiers.SUPER_STRENGTH_1_, 1]] },
    Virgo: { xp: [Skill.DEFENCE, 875] },
  });

  const page = (p, variant) => ({ page: p, variant });
  const has = (player, itemId, quantity = 1) => player.getInventory().getAmount(itemId) >= quantity;

  let quest;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) return ["<str>I repaired the Observatory telescope.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    if (stage === 0) return ["I can start this quest by speaking to the", "<col=800000>Observatory professor</col> south-west of Ardougne."];
    if (stage === STAGE_PLANKS) return ["The professor needs <col=800000>three wooden planks</col> for a new tripod."];
    if (stage === STAGE_BRONZE) return ["The professor needs a <col=800000>bronze bar</col> for the telescope tube."];
    if (stage === STAGE_GLASS) return ["The professor needs <col=800000>molten glass</col> for a replacement lens."];
    if (stage === STAGE_MOULD) return ["The goblins hid the professor's <col=800000>lens mould</col> in the Observatory dungeon."];
    if (stage === STAGE_LENS) return ["I should use the <col=800000>lens mould</col> with <col=800000>molten glass</col>."];
    return ["The telescope is repaired. I should meet the professor", "at the Observatory and <col=800000>look through the telescope</col>."];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 2250);
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (PROFESSOR_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return page("Observatory professor", "standard-dialogue-after-observatory-quest");
      if (stage === STAGE_TELESCOPE) {
        return page(PAGE, player.getAttribute(VIEWED_ATTRIBUTE)
          ? "after-viewing-the-telescope"
          : "entering-the-observatory-talking-to-the-professor");
      }
      if (stage === STAGE_LENS) {
        return page(PAGE, has(player, OBSERVATORY_LENS)
          ? "returning-with-the-observatory-lens"
          : "returning-with-the-lens-mould-returning-without-the-observatory-lens");
      }
      if (stage === STAGE_MOULD) {
        return page(PAGE, has(player, LENS_MOULD)
          ? "returning-with-the-lens-mould"
          : "returning-with-molten-glass-returning-without-the-lens-mould");
      }
      if (stage === STAGE_GLASS) {
        return page(PAGE, has(player, MOLTEN_GLASS)
          ? "returning-with-molten-glass"
          : "returning-with-a-bronze-bar-returning-without-molten-glass");
      }
      if (stage === STAGE_BRONZE) {
        return page(PAGE, has(player, BRONZE_BAR)
          ? "returning-with-a-bronze-bar"
          : "returning-with-three-planks-returning-without-a-bronze-bar");
      }
      if (stage === STAGE_PLANKS) {
        const planks = player.getInventory().getAmount(PLANK);
        if (planks >= 3) return page(PAGE, "returning-with-three-planks");
        if (planks > 0) return page(PAGE, "starting-off-returning-without-enough-planks");
        return page(PAGE, "starting-off-returning-with-no-planks");
      }
      return page(PAGE, "starting-off");
    }

    if (npcId === ASSISTANT_NPC_ID) {
      if (stage >= STAGE_CLAIMED_WINE) return page("Observatory assistant", "after-observatory-quest-subsequent-dialogue");
      if (stage >= STAGE_COMPLETE) return page("Observatory assistant", "after-observatory-quest-initial-dialogue");
      if (stage === STAGE_TELESCOPE) return page(PAGE, "returning-with-the-observatory-lens-talking-to-the-assistant-before-going-up-to-the-observatory");
      if (stage === STAGE_LENS) {
        return page(PAGE, has(player, OBSERVATORY_LENS)
          ? "making-the-observatory-lens-talking-to-the-assistant-with-the-observatory-lens"
          : "returning-with-the-lens-mould-talking-to-the-assistant-without-the-observatory-lens");
      }
      if (stage === STAGE_MOULD) {
        return page(PAGE, has(player, GOBLIN_KITCHEN_KEY)
          ? "searching-for-the-lens-mould-speaking-to-the-observatory-assistant-with-the-goblin-kitchen-key"
          : "returning-with-molten-glass-talking-to-the-assistant-without-the-lens-mould");
      }
      if (stage === STAGE_GLASS) {
        return page(PAGE, has(player, MOLTEN_GLASS)
          ? "returning-with-a-bronze-bar-talking-to-the-assistant-with-molten-glass"
          : "returning-with-a-bronze-bar-talking-to-the-assistant-without-molten-glass");
      }
      if (stage === STAGE_BRONZE) {
        return page(PAGE, has(player, BRONZE_BAR)
          ? "returning-with-three-planks-talking-to-the-assistant-with-a-bronze-bar"
          : "returning-with-three-planks-talking-to-the-assistant-without-a-bronze-bar");
      }
      if (stage === STAGE_PLANKS) {
        const planks = player.getInventory().getAmount(PLANK);
        if (planks >= 3) return page(PAGE, "starting-off-talking-to-the-assistant-with-three-planks");
        if (planks > 0) return page(PAGE, "starting-off-talking-to-the-assistant-with-less-than-three-planks");
        return page(PAGE, "starting-off-talking-to-the-assistant-without-any-planks");
      }
      return page("Observatory assistant", "before-observatory-quest");
    }

    if (npcId === SLEEPING_GUARD_NPC_ID && stage === STAGE_MOULD && !has(player, LENS_MOULD)) {
      return page(PAGE, "prodding-the-goblin-guard");
    }

    return null;
  }

  /** Answers the page's prose conditions; scoped so other quests' handlers are not shadowed. */
  function answerCondition({ player, npcId, text }) {
    if (!PROFESSOR_NPC_IDS.has(npcId) && npcId !== ASSISTANT_NPC_ID) return null;
    const value = String(text).toLowerCase();
    if (value.includes("no free inventory space") || value.includes("does not have inventory space")) {
      return player.getInventory().isFull();
    }
    if (value.includes("has inventory space")) return !player.getInventory().isFull();
    if (value.includes("did not see this sign")) return true;
    const seen = /did see ([a-z]+)/.exec(value);
    if (seen) {
      const observed = String(player.getAttribute(CONSTELLATION_ATTRIBUTE) ?? "").toLowerCase();
      return observed === seen[1];
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!PROFESSOR_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_PLANKS) quest.setStage(player, STAGE_PLANKS);
  }

  /**
   * Picks the sign a fresh telescope view shows. Since this server has no
   * character-creation star sign, one is rolled and persisted per player, with
   * OSRS's pure protection: no combat-XP sign for a level-1 skill.
   */
  function rollConstellation(player) {
    const names = Object.keys(CONSTELLATION_REWARDS).filter((name) => {
      const xp = CONSTELLATION_REWARDS[name].xp;
      return !xp || player.getSkillManager().getCurrentLevel(xp[0]) > 1;
    });
    const pool = names.length ? names : Object.keys(CONSTELLATION_REWARDS);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function constellationForViewing(player) {
    const existing = String(player.getAttribute(CONSTELLATION_ATTRIBUTE) ?? "");
    if (CONSTELLATION_REWARDS[existing]) return existing;
    const rolled = rollConstellation(player);
    player.setAttribute(CONSTELLATION_ATTRIBUTE, rolled);
    return rolled;
  }

  function grantConstellationReward(player, stepId) {
    const reward = CONSTELLATION_REWARDS[COMPLETION_ACTIONS.get(stepId)];
    if (!reward) return;
    for (const [itemId, amount] of reward.items ?? []) {
      player.getInventory().forceAdd(player, new api.core.Item(itemId, amount));
    }
    if (reward.xp) player.getSkillManager().addExperiences(reward.xp[0], reward.xp[1]);
  }

  /** Item hand-ins, the assistant's wine and the after-viewing completion action. */
  function handleAction(event) {
    const { player, npcId, stepId, kind } = event;
    if (npcId === ASSISTANT_NPC_ID) {
      // The initial post-quest chat's "The assistant gives you some wine." hands it over.
      if (kind === "message" && stepId === WINE_MESSAGE_ACTION && quest.getStage(player) === STAGE_COMPLETE) {
        if (player.getInventory().isFull()) return;
        player.getInventory().adds(JUG_OF_WINE, 1);
        quest.setStage(player, STAGE_CLAIMED_WINE);
      }
      return;
    }
    if (!PROFESSOR_NPC_IDS.has(npcId)) return;
    const stage = quest.getStage(player);
    switch (stepId) {
      case PLANK_HAND_IN_ACTION:
        if (stage !== STAGE_PLANKS || !has(player, PLANK, 3)) return;
        player.getInventory().deleteNumber(PLANK, 3);
        quest.setStage(player, STAGE_BRONZE);
        return;
      case BRONZE_HAND_IN_ACTION:
        if (stage !== STAGE_BRONZE || !has(player, BRONZE_BAR)) return;
        player.getInventory().deleteNumber(BRONZE_BAR, 1);
        quest.setStage(player, STAGE_GLASS);
        return;
      case GLASS_HAND_IN_ACTION:
        if (stage !== STAGE_GLASS || !has(player, MOLTEN_GLASS)) return;
        player.getInventory().deleteNumber(MOLTEN_GLASS, 1);
        quest.setStage(player, STAGE_MOULD);
        return;
      case GLASS_RETURN_ACTION:
        if (stage !== STAGE_MOULD || !has(player, LENS_MOULD)) return;
        if (!has(player, MOLTEN_GLASS)) player.getInventory().adds(MOLTEN_GLASS, 1);
        quest.setStage(player, STAGE_LENS);
        return;
      case LENS_HAND_IN_ACTION:
        if (stage !== STAGE_LENS) return;
        player.getInventory().deleteNumber(OBSERVATORY_LENS, 1);
        player.getInventory().deleteNumber(LENS_MOULD, 1);
        quest.setStage(player, STAGE_TELESCOPE);
        return;
      default:
        break;
    }
    if (!COMPLETION_ACTIONS.has(stepId)) return;
    if (stage < STAGE_TELESCOPE || quest.isComplete(player)) return;
    quest.complete(player);
    grantConstellationReward(player, stepId);
  }

  /** Cast the lens from the mould and molten glass. */
  function handleItemOnItem(event) {
    const ids = [event.usedItemId, event.usedWithItemId];
    if (!ids.includes(LENS_MOULD) || !ids.includes(MOLTEN_GLASS)) return;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_LENS) return;
    if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < 10) {
      player.sendMessage("You need level 10 Crafting to cast the lens.");
      event.handled = true;
      return;
    }
    player.getInventory().deleteNumber(MOLTEN_GLASS, 1);
    player.getInventory().adds(OBSERVATORY_LENS, 1);
    player.sendMessage("You pour the glass into the mould and make an Observatory lens.");
    event.handled = true;
  }

  /**
   * Opens the kitchen gate by removing both leaves, clearing their collision so the
   * doorway is passable on foot (the old teleport dropped the player on the wrong side).
   */
  function openKitchenGate(object) {
    if (!object?.getLocation) return;
    const location = object.getLocation();
    const partnerId = object.getId() === ObjectIdentifiers.KITCHEN_GATE
      ? ObjectIdentifiers.KITCHEN_GATE_2
      : ObjectIdentifiers.KITCHEN_GATE;
    ObjectManager.deregister(object, true);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const partner = MapObjects.get(
        partnerId,
        new Location(location.getX() + dx, location.getY() + dy, location.getZ()),
        null
      );
      if (partner) {
        ObjectManager.deregister(partner, true);
        break;
      }
    }
  }

  /** The marked dungeon chests hold the kitchen key; the stove holds the lens mould. */
  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    const option = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();

    if (DUNGEON_CHEST_IDS.has(objectId) && (option.includes("search") || option.includes("open"))) {
      // The key can be re-obtained at stage 5 if it was lost after the gate was unlocked.
      const stage = quest.getStage(player);
      if (stage < STAGE_MOULD || stage > STAGE_LENS) return;
      event.handled = true;
      if (!has(player, GOBLIN_KITCHEN_KEY)) {
        player.getInventory().adds(GOBLIN_KITCHEN_KEY, 1);
        player.sendMessage("You find a kitchen key.");
      } else {
        player.sendMessage("The chest is empty.");
      }
      return;
    }

    /** Kitchen gate: locked until the guard is dealt with, opened with the key. */
    if (KITCHEN_GATE_IDS.has(objectId) && option.includes("open")) {
      if (quest.getStage(player) < STAGE_MOULD) return;
      event.handled = true;
      if (!has(player, GOBLIN_KITCHEN_KEY)) {
        player.sendMessage("The kitchen gate is locked.");
        return;
      }
      if (Number(player.getAttribute(GUARD_AWAKE_ATTRIBUTE)) !== 1) {
        player.sendMessage("If you open the gate, the guard will hear you. You need to get rid of him.");
        return;
      }
      player.getInventory().deleteNumber(GOBLIN_KITCHEN_KEY, 1);
      player.sendMessage("You unlock the kitchen gate.");
      player.sendMessage("You had better be quick, there may be more guards about.");
      openKitchenGate(event.object);
      return;
    }

    /** Goblin stove: the lens mould is hidden in the stew. */
    if (GOBLIN_STOVE_IDS.has(objectId) && option.includes("inspect")) {
      if (quest.getStage(player) < STAGE_MOULD) return;
      event.handled = true;
      if (has(player, LENS_MOULD)) {
        player.sendMessage("Just a plain stove. Nothing here.");
        return;
      }
      player.getInventory().adds(LENS_MOULD, 1);
      player.sendMessage("The goblins appear to have been using the lens mould to cook their stew!");
      player.sendMessage("You shake out its contents and take it with you.");
      return;
    }

    if (TELESCOPE_IDS.has(objectId) && (option.includes("look") || option.includes("view"))) {
      if (quest.getStage(player) !== STAGE_TELESCOPE) return;
      const sign = constellationForViewing(player);
      player.setAttribute(VIEWED_ATTRIBUTE, true);
      player.sendMessage(`You look through the telescope and see the constellation ${sign}.`);
      event.handled = true;
    }
  }

  /** Prodding the sleeping guard wakes the attackable goblin guard. */
  function prodSleepingGuard(event) {
    const { player, npc } = event;
    if (!npc || quest.getStage(player) !== STAGE_MOULD) return;
    player.setAttribute(GUARD_AWAKE_ATTRIBUTE, 1);
    npc.setNpcTransformationId(GOBLIN_GUARD_NPC_ID);
    startTranscript(api, player, GOBLIN_GUARD_NPC_ID, PAGE, "prodding-the-goblin-guard");
  }

  /**
   * The two dungeon stair runs are far from anything ClimbLinks can pair, so give
   * them explicit destinations: the north stairs lead out to the east hill, the
   * south stairs lead up into the Observatory, and the surface stairs lead down.
   */
  function claimObservatoryClimb(request) {
    if (request.handled) return;
    const { player, object, objectId } = request;
    if (!player || !object) return;
    const location = object.getLocation?.();
    if (!location) return;
    if (objectId === SURFACE_STAIRS_ID) {
      player.moveTo(new Location(DUNGEON_NORTH_LANDING.x, DUNGEON_NORTH_LANDING.y, DUNGEON_NORTH_LANDING.z));
      request.handled = true;
      return;
    }
    if (objectId !== DUNGEON_STAIRS_ID) return;
    const x = location.getX();
    const y = location.getY();
    if (x === DUNGEON_STAIRS_SOUTH.x && y === DUNGEON_STAIRS_SOUTH.y) {
      player.moveTo(new Location(OBSERVATORY_LANDING.x, OBSERVATORY_LANDING.y, OBSERVATORY_LANDING.z));
      if (quest.getStage(player) === STAGE_TELESCOPE && !player.getAttribute(VIEWED_ATTRIBUTE)) {
        startTranscript(api, player, PROFESSOR_NPC_ID, PAGE, "entering-the-observatory");
      }
    } else if (x === DUNGEON_STAIRS_NORTH.x && y === DUNGEON_STAIRS_NORTH.y) {
      player.moveTo(new Location(SURFACE_STAIRS_LANDING.x, SURFACE_STAIRS_LANDING.y, SURFACE_STAIRS_LANDING.z));
    } else {
      return;
    }
    request.handled = true;
  }

  /** Fill the wiki transcript's "[player name]" blanks for the Observatory pair. */
  function fillPlayerName(request) {
    if (!request?.player || typeof request.text !== "string") return;
    if (!PROFESSOR_NPC_IDS.has(request.npcId) && request.npcId !== ASSISTANT_NPC_ID) return;
    if (!request.text.includes("[player name]")) return;
    request.text = request.text.replace(/\[player name\]/gi, request.player.getUsername());
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "observatory_quest",
    name: "Observatory Quest",
    varpId: VARP_OBSERVATORY_QUEST,
    // Wine is a post-quest assistant reward; the cache varp completes at 7.
    varpValue: (stage) => (stage >= STAGE_COMPLETE ? STAGE_COMPLETE : stage),
    startedValue: STAGE_PLANKS,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [{ skillId: Skill.CRAFTING.getIndex(), amount: 2250, label: "Crafting" }],
    rewardItemId: ItemIdentifiers.UNCUT_SAPPHIRE,
    rewardItemLabel: "An uncut sapphire",
    otherRewards: ["A random reward based on the observed constellation"],
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(VIEWED_ATTRIBUTE);
  api.persistAttribute(GUARD_AWAKE_ATTRIBUTE);
  api.persistAttribute(CONSTELLATION_ATTRIBUTE);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction("Sleeping guard", { Prod: prodSleepingGuard });
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", fillPlayerName);
  api.onCustomEvent("ladders:climb", claimObservatoryClimb);
  api.onItemOnItem(handleItemOnItem);
  api.onObjectInteraction(handleObjectInteraction);
  api.onPlayerLogin(handleLogin);
};
