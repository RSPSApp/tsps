/**
 * Witch's House (members).
 *
 * The words come from the "Witch's House" and "Boy" transcript pages; the Boy is
 * indexed, so this plugin selects his variant by stage, answers the combat-level
 * gate, runs the start hook and turns the final "Quest complete!" action into the
 * ball hand-in. The garden items (door key, magnet, shed key, diary) and the
 * shapeshifter are driven by object/item interactions, replaying the matching
 * transcript variants.
 *
 * Stages (varp 226): 1 started, 2 magnet found, 3 back door unlocked, 5 diary
 * read, 6 experiment defeated, 7 complete.
 *
 * Gaps (no dump/index support): Nora T. Hagg's garden catch/teleport is not
 * implemented; the wiki "level 10 combat" gate is assumed satisfied; the cache
 * item is named SHED_KEY (4186) but the quest's shed key is 2411, exposed here as
 * ItemIdentifiers.KEY_9; the diary (2408) has no spawn supplied by this plugin,
 * so reading it depends on another source placing it; the "grab the ball before
 * killing the experiment" branch is replaced by spawning the experiment on shed
 * entry and dropping the ball when its final form dies; the cupboard open state
 * is not swapped in the world.
 */
module.exports = function registerWitchsHouseQuest(api) {
  const {
    Skill,
    Item,
    Location,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
  } = api.core;
  const { registerQuest, startTranscript, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Witch's House";
  const BOY_NPC_ID = NpcIdentifiers.BOY; // 3994
  const MOUSE_NPC_ID = NpcIdentifiers.MOUSE; // 4000
  const EXPERIMENT_NPC_IDS = [
    NpcIdentifiers.WITCHS_EXPERIMENT,
    NpcIdentifiers.WITCHS_EXPERIMENT_SECOND_FORM_,
    NpcIdentifiers.WITCHS_EXPERIMENT_THIRD_FORM_,
    NpcIdentifiers.WITCHS_EXPERIMENT_FOURTH_FORM_,
  ];

  const VARP_WITCHS_HOUSE = 226;
  const STAGE_STARTED = 1;
  const STAGE_FOUND_MAGNET = 2;
  const STAGE_UNLOCKED_BACK_DOOR = 3;
  const STAGE_READ_DIARY = 5;
  const STAGE_DEFEATED_EXPERIMENT = 6;
  const STAGE_COMPLETE = 7;

  const BALL_ITEM_ID = ItemIdentifiers.BALL;
  const DIARY_ITEM_ID = ItemIdentifiers.DIARY;
  const DOOR_KEY_ITEM_ID = ItemIdentifiers.DOOR_KEY;
  const MAGNET_ITEM_ID = ItemIdentifiers.MAGNET;
  const SHED_KEY_ITEM_ID = ItemIdentifiers.KEY_9; // 2411 (SHED_KEY is 4186)
  const CHEESE_ITEM_ID = ItemIdentifiers.CHEESE;
  const GLOVES_ITEM_ID = ItemIdentifiers.LEATHER_GLOVES;

  const FRONT_DOOR_LOC_ID = ObjectIdentifiers.DOOR_102;
  const BACK_DOOR_LOC_ID = ObjectIdentifiers.DOOR_103;
  const SHED_DOOR_LOC_ID = ObjectIdentifiers.DOOR_104;
  const FOUNTAIN_LOC_ID = ObjectIdentifiers.FOUNTAIN_4;
  const GATE_LOC_IDS = new Set([ObjectIdentifiers.GATE_66, ObjectIdentifiers.GATE_67]);
  const POTTED_PLANT_LOC_ID = ObjectIdentifiers.POTTED_PLANT_3;
  const CUPBOARD_LOC_IDS = new Set([
    ObjectIdentifiers.CUPBOARD_24,
    ObjectIdentifiers.CUPBOARD_25,
  ]);
  // 2870 has no ObjectIdentifiers constant; the other two are named.
  const MOUSE_HOLE_LOC_IDS = new Set([2870, ObjectIdentifiers.MOUSE_HOLE, ObjectIdentifiers.MOUSE_HOLE_2]);
  const LADDER_DOWN_LOC_ID = ObjectIdentifiers.LADDER_322;
  const LADDER_UP_LOC_ID = ObjectIdentifiers.LADDER_321;

  const MOUSE_TILE = { x: 2903, y: 3466, z: 0 };
  const EXPERIMENT_TILE = { x: 2935, y: 3462, z: 0 };
  const BASEMENT_TILE = { x: 2907, y: 9876, z: 0 };
  const GROUND_FLOOR_TILE = { x: 2907, y: 3476, z: 0 };

  const START_HOOK = "quest:witch-s-house:start";
  const COMPLETE_ACTION_ID = "uyv8q6";

  let quest;
  let itemOnGroundManager;
  const experimentByPlayer = new Map();
  const mouseByPlayer = new Map();

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage <= 0) {
      return [
        "I can start this quest by speaking to the <col=800000>little boy</col>",
        "standing by the long garden just <col=800000>north of Taverley</col>.",
        "",
        "I must be able to defeat a <col=800000>level 53 enemy</col>.",
      ];
    }
    const history = [
      "<str>A small boy kicked his ball into the nearby garden.</str>",
      "<str>I agreed to retrieve it for him.</str>",
      "",
    ];
    if (stage === STAGE_STARTED) {
      return [...history, "I should find a way into the <col=800000>garden</col> where the ball is."];
    }
    if (stage === STAGE_FOUND_MAGNET) {
      return [...history, "I found a <col=800000>magnet</col> in a basement cupboard."];
    }
    if (stage >= STAGE_UNLOCKED_BACK_DOOR && stage < STAGE_DEFEATED_EXPERIMENT) {
      return [
        ...history,
        "<str>I found a magnet in a basement cupboard.</str>",
        "<str>I worked out how to unlock the back door to the garden.</str>",
        "",
        "The boy's ball is locked in the <col=800000>garden shed</col>.",
      ];
    }
    if (stage === STAGE_DEFEATED_EXPERIMENT) {
      return [
        ...history,
        "Now the <col=800000>shapeshifter</col> is dead, I should return the boy's <col=800000>ball</col>.",
      ];
    }
    return [
      ...history,
      "<str>I defeated the witch's strange experiment.</str>",
      "<str>I returned the child's ball to him.</str>",
      "",
      "<col=ff0000>QUEST COMPLETE!</col>",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.HITPOINTS, 6325);
  }

  function selectVariant({ npcId, player }) {
    if (npcId !== BOY_NPC_ID) return null;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return { page: "Boy", variant: "after-witch-s-house" };
    if (stage >= STAGE_STARTED && held(player, BALL_ITEM_ID)) return "finishing-up";
    if (stage >= STAGE_STARTED) return "getting-started-talking-to-him-again";
    return "getting-started";
  }

  function answerCondition({ text }) {
    const value = String(text).toLowerCase();
    if (value.includes("below level 10 combat")) return false;
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== BOY_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** The speech's "Quest complete!" action; the player still has to hold the ball. */
  function handleAction({ player, npcId, stepId }) {
    if (npcId !== BOY_NPC_ID || stepId !== COMPLETE_ACTION_ID) return;
    if (!held(player, BALL_ITEM_ID) || quest.isComplete(player)) return;
    player.getInventory().deleteNumber(BALL_ITEM_ID, 1);
    quest.complete(player);
  }

  function crossNorthSouthDoor(event) {
    const { player, location } = event;
    const y = player.getLocation().getY();
    const destinationY = y >= location.y ? location.y - 1 : location.y + 1;
    player.moveTo(new Location(location.x, destinationY, location.z));
  }

  function crossElectricGate(event) {
    const { player, location } = event;
    const x = player.getLocation().getX();
    const destinationX = x <= location.x ? location.x + 1 : location.x - 1;
    player.moveTo(new Location(destinationX, location.y, location.z));
  }

  function searchPottedPlant(event) {
    const { player } = event;
    if (held(player, DOOR_KEY_ITEM_ID)) {
      startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-searching-the-plant-pot-for-the-key-searching-the-plant-pot-with-a-key-already");
      return;
    }
    player.getInventory().adds(DOOR_KEY_ITEM_ID, 1);
    startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-searching-the-plant-pot-for-the-key");
  }

  function searchCupboard(event) {
    const { player } = event;
    if (held(player, MAGNET_ITEM_ID)) {
      startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-searching-the-cupboard-for-the-magnet-searching-the-cupboard-again-with-a-magnet-already");
      return;
    }
    player.getInventory().adds(MAGNET_ITEM_ID, 1);
    if (quest.getStage(player) === STAGE_STARTED) quest.setStage(player, STAGE_FOUND_MAGNET);
    startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-searching-the-cupboard-for-the-magnet");
  }

  function searchFountain(event) {
    const { player } = event;
    if (held(player, SHED_KEY_ITEM_ID)) {
      startTranscript(api, player, BOY_NPC_ID, PAGE, "getting-past-the-witch-searching-the-fountain-in-the-garden-searching-the-fountain-again-whilst-holding-the-key");
      return;
    }
    player.getInventory().adds(SHED_KEY_ITEM_ID, 1);
    startTranscript(api, player, BOY_NPC_ID, PAGE, "getting-past-the-witch-searching-the-fountain-in-the-garden");
  }

  function ensureExperiment(player) {
    if (experimentByPlayer.has(player)) return;
    const npc = api.spawnNpc({
      id: EXPERIMENT_NPC_IDS[0],
      x: EXPERIMENT_TILE.x,
      y: EXPERIMENT_TILE.y,
      z: EXPERIMENT_TILE.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) experimentByPlayer.set(player, npc);
  }

  function dropBall(player, location) {
    itemOnGroundManager?.registerLocation(
      player,
      new Item(BALL_ITEM_ID, 1),
      new Location(location.getX(), location.getY(), location.getZ())
    );
  }

  /** Each shapeshifter form dies into the next; the fourth one stays dead. */
  function handleExperimentBeforeDeath(event) {
    const npc = event?.npc;
    if (!npc) return;
    const index = EXPERIMENT_NPC_IDS.indexOf(npc.getId?.());
    if (index === -1) return;
    const owner = npc.getOwner?.();
    if (!owner || experimentByPlayer.get(owner) !== npc) return;

    if (index === EXPERIMENT_NPC_IDS.length - 1) {
      experimentByPlayer.delete(owner);
      if (quest.getStage(owner) < STAGE_DEFEATED_EXPERIMENT) {
        quest.setStage(owner, STAGE_DEFEATED_EXPERIMENT);
      }
      owner.sendMessage("You finally kill the shapeshifter once and for all.");
      dropBall(owner, npc.getLocation());
      return;
    }

    const location = npc.getLocation();
    experimentByPlayer.delete(owner);
    api.removeNpc(npc);
    const next = api.spawnNpc({
      id: EXPERIMENT_NPC_IDS[index + 1],
      x: location.getX(),
      y: location.getY(),
      z: location.getZ(),
      wanderRadius: 0,
      owner,
      ownerOnly: true,
    });
    if (next) experimentByPlayer.set(owner, next);
    const forms = ["spider", "bear", "wolf"];
    owner.sendMessage(`The shapeshifter's body deforms and turns into a ${forms[index]}!`);
    event.preventDeath = true;
  }

  function openShedDoor(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_DEFEATED_EXPERIMENT && !held(player, SHED_KEY_ITEM_ID)) {
      startTranscript(api, player, BOY_NPC_ID, PAGE, "getting-past-the-witch-attempting-to-open-the-shed-door-without-the-key-or-before-using-the-key-on-it");
      return;
    }
    const entering = player.getLocation().getY() >= event.location.y;
    if (entering && stage < STAGE_DEFEATED_EXPERIMENT) ensureExperiment(player);
    crossNorthSouthDoor(event);
  }

  /** All the object interactions in and around the house. */
  function handleObjectInteraction(event) {
    const { objectId, player } = event;
    if (objectId === POTTED_PLANT_LOC_ID) {
      event.handled = true;
      searchPottedPlant(event);
      return;
    }
    if (CUPBOARD_LOC_IDS.has(objectId)) {
      event.handled = true;
      searchCupboard(event);
      return;
    }
    if (objectId === FOUNTAIN_LOC_ID) {
      event.handled = true;
      searchFountain(event);
      return;
    }
    if (objectId === FRONT_DOOR_LOC_ID) {
      event.handled = true;
      const leaving = player.getLocation().getY() < event.location.y;
      const stage = quest.getStage(player);
      if (!leaving && (stage < STAGE_STARTED || stage >= STAGE_COMPLETE)) {
        player.sendMessage("It would be rude to break into this house.");
        return;
      }
      if (!leaving && !held(player, DOOR_KEY_ITEM_ID)) {
        startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-attempting-to-open-the-garden-door-without-unlocking-it");
        return;
      }
      crossNorthSouthDoor(event);
      return;
    }
    if (GATE_LOC_IDS.has(objectId)) {
      event.handled = true;
      if (player.getEquipment().get(api.core.Equipment.HANDS_SLOT)?.getId?.() !== GLOVES_ITEM_ID) {
        startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-attempting-to-open-the-gate-without-correct-gloves");
        return;
      }
      crossElectricGate(event);
      return;
    }
    if (objectId === BACK_DOOR_LOC_ID) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_UNLOCKED_BACK_DOOR) {
        player.sendMessage("This door is locked.");
        return;
      }
      crossNorthSouthDoor(event);
      return;
    }
    if (objectId === SHED_DOOR_LOC_ID) {
      event.handled = true;
      openShedDoor(event);
      return;
    }
    if (objectId === LADDER_DOWN_LOC_ID) {
      event.handled = true;
      player.moveTo(new Location(BASEMENT_TILE.x, BASEMENT_TILE.y, BASEMENT_TILE.z));
      return;
    }
    if (objectId === LADDER_UP_LOC_ID) {
      event.handled = true;
      player.moveTo(new Location(GROUND_FLOOR_TILE.x, GROUND_FLOOR_TILE.y, GROUND_FLOOR_TILE.z));
    }
  }

  /** Cheese on a mouse hole lures out the (owner-only) mouse. */
  function handleItemOnMouseHole(event) {
    if (event.itemId !== CHEESE_ITEM_ID || !MOUSE_HOLE_LOC_IDS.has(event.objectId)) return;
    const { player } = event;
    event.handled = true;
    player.getInventory().deleteNumber(CHEESE_ITEM_ID, 1);
    const tracked = mouseByPlayer.get(player);
    if (tracked) api.removeNpc(tracked);
    const mouse = api.spawnNpc({
      id: MOUSE_NPC_ID,
      x: MOUSE_TILE.x,
      y: MOUSE_TILE.y,
      z: MOUSE_TILE.z,
      wanderRadius: 1,
      owner: player,
      ownerOnly: true,
    });
    if (mouse) mouseByPlayer.set(player, mouse);
    startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-after-dropping-cheese-in-front-of-the-mouse-hole");
  }

  function handleItemOnNpc(event) {
    if (event.itemId !== MAGNET_ITEM_ID) return;
    const { player } = event;
    const tracked = mouseByPlayer.get(player);
    if (!tracked || tracked.getId?.() !== event.target?.getId?.()) return;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage >= STAGE_UNLOCKED_BACK_DOOR) {
      startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-using-a-magnet-on-the-mouse-using-a-magnet-on-a-mouse-while-the-door-is-unlocked");
      return;
    }
    if (stage < STAGE_FOUND_MAGNET) {
      startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-using-a-magnet-on-the-mouse-using-a-magnet-without-previously-searching-the-cupboard");
      return;
    }
    player.getInventory().deleteNumber(MAGNET_ITEM_ID, 1);
    api.removeNpc(tracked);
    mouseByPlayer.delete(player);
    quest.setStage(player, STAGE_UNLOCKED_BACK_DOOR);
    startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-using-a-magnet-on-the-mouse");
  }

  /** Reading the diary explains the mouse lock and the fountain. */
  function handleItemAction(event) {
    if (event.itemId !== DIARY_ITEM_ID) return;
    if (event.option && !/read/i.test(event.option)) return;
    event.handled = true;
    if (quest.getStage(event.player) === STAGE_UNLOCKED_BACK_DOOR) {
      quest.setStage(event.player, STAGE_READ_DIARY);
    }
    event.player.sendMessage(
      "The diary explains the mouse lock and says the shed key is hidden in the garden fountain."
    );
  }

  function handleLogout({ player }) {
    if (!player) return;
    if (experimentByPlayer.has(player)) experimentByPlayer.delete(player);
    mouseByPlayer.delete(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  itemOnGroundManager = api.getItemOnGroundManager();

  quest = registerQuest(api, {
    key: "witchs_house",
    name: "Witch's House",
    varpId: VARP_WITCHS_HOUSE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 4,
    xpRewards: [{ skillId: Skill.HITPOINTS.getIndex(), amount: 6325, label: "Hitpoints" }],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcBeforeDeath(handleExperimentBeforeDeath);
  api.onItemOnObject(handleItemOnMouseHole, { noted: false });
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemAction(handleItemAction);
  api.onPlayerLogout(handleLogout);
  api.onPlayerLogin(handleLogin);
};
