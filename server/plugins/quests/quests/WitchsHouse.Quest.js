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
 * The low-combat start warning follows the player's combat level. The diary
 * (2408) and ball (2407) are world ground spawns from the data definitions; this
 * plugin only consumes/reads them. The basement boxes supply in-quest leather
 * gloves; the east-room boxes are reachable straight after the ladder, so the
 * pair can be found before the electric gate.
 *
 * Nora walks the garden's middle row, 2904-2929 on y 3463, a tile a tick, and waits two
 * ticks at the east end (rsprox 2963, 3246, 3249). The hedges' cache clipping decides what she
 * can see: the tall stretches block sight and the low ones don't. No recording shows a catch, so
 * looking only the way she's walking is inferred from the Wiki's route around the hedges with
 * run energy to spare; the catch's lines, curse animation, teleport to the boy, lost ball and
 * repeated steps are the Wiki's.
 *
 * The cache item is named SHED_KEY
 * (4186) but the quest's shed key is 2411, exposed here as
 * ItemIdentifiers.KEY_9; the cupboard open state is not swapped in the world.
 */
module.exports = function registerWitchsHouseQuest(api) {
  const { crossingFor } = require("../../objects/WallDoor.Doors");
  const {
    Skill,
    Item,
    Location,
    Area,
    Boundary,
    Animation,
    CountdownTask,
    RegionManager,
    TaskManager,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
    World,
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
  const BOXES_LOC_ID = 24692; // Boxes; no ObjectIdentifiers entry.
  const FULL_INVENTORY_MESSAGE = "You couldn't hold all those items.";
  /** Cache Boxes (24692) placements in the witch's house basement. */
  const BASEMENT_BOXES = [
    { x: 2899, y: 9871 }, // west room, behind the electric gate
    { x: 2899, y: 9872 },
    { x: 2900, y: 9872 },
    { x: 2905, y: 9872 }, // east room, the ladder drops into it
    { x: 2906, y: 9872 },
    { x: 2908, y: 9873 },
  ];
  /** The gate column splits the basement; the west room holds the cupboard. */
  const basementRoom = (x) => (x <= 2902 ? "west" : "east");

  const MOUSE_TILE = { x: 2903, y: 3466, z: 0 };
  const EXPERIMENT_TILE = { x: 2935, y: 3462, z: 0 };
  const BALL_SPAWN_TILE = { x: 2935, y: 3460, z: 0 };
  const BASEMENT_TILE = { x: 2907, y: 9876, z: 0 };
  const GROUND_FLOOR_TILE = { x: 2907, y: 3476, z: 0 };

  const NORA_NPC_ID = NpcIdentifiers.NORA_T_HAGG;
  const NORA_ROW = 3463;
  const NORA_WEST_X = 2904;
  const NORA_EAST_X = 2929;
  const NORA_EAST_WAIT_TICKS = 2;
  /** human_castcurse: the Wiki gives her spell the curse animation. */
  const NORA_CAST_ANIMATION = 718;
  const CAUGHT_CAST_TICKS = 2;
  const CAUGHT_TELEPORT_TICKS = 4;
  /** Beside the Boy (2928,3456). */
  const CAUGHT_TILE = { x: 2929, y: 3456, z: 0 };

  const START_HOOK = "quest:witch-s-house:start";
  const COMPLETE_ACTION_ID = "uyv8q6";

  let quest;
  let itemOnGroundManager;
  const experimentByPlayer = new Map();
  const mouseByPlayer = new Map();

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const wearingGloves = (player) =>
    player.getEquipment().get(api.core.Equipment.HANDS_SLOT)?.getId?.() === GLOVES_ITEM_ID;

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

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("below level 10 combat")) {
      return (player?.getSkillManager?.().getCombatLevel?.() ?? 10) < 10;
    }
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
    for (const itemId of [DOOR_KEY_ITEM_ID, DIARY_ITEM_ID, SHED_KEY_ITEM_ID]) {
      const amount = player.getInventory().getAmount(itemId);
      if (amount > 0) player.getInventory().deleteNumber(itemId, amount);
    }
    quest.complete(player);
  }

  /**
   * A wall loc blocks the tile edge it faces from, so the two tiles it separates
   * are the door's own tile and its neighbour across that edge: rot 0 west
   * (x/x-1), rot 2 east (x/x+1), rot 1 south (y/y+1), rot 3 north (y/y-1).
   * Crossing toggles between those two tiles. The old x+1/y-1 guess stepped a
   * tile past the shed's west-wall door, out of the door's own reach, so clicking
   * Open from inside could never leave; toggling also keeps the entry landing on
   * the door tile itself (the shed's interior starts there, unlike the house).
   */
  function crossDoor(event) {
    const { player } = event;
    const crossing = crossingFor(event.object, player.getLocation());
    if (!crossing || !Location.isSameTile(player.getLocation(), crossing.approach)) return;
    player.moveTo(new Location(crossing.destination.x, crossing.destination.y, crossing.destination.z));
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
    if (player.getInventory().getFreeSlots() <= 0) {
      player.sendMessage(FULL_INVENTORY_MESSAGE);
      return;
    }
    player.getInventory().adds(DOOR_KEY_ITEM_ID, 1);
    if (!held(player, DOOR_KEY_ITEM_ID)) return;
    startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-searching-the-plant-pot-for-the-key");
  }

  /**
   * QH: "If you don't have gloves, search the nearby boxes until you get a pair."
   * Cache Boxes (24692) placements in the basement: 2899,9871 / 2899,9872 / 2900,9872
   * sit in the west room behind the electric gate, while 2905,9872 / 2906,9872 /
   * 2908,9873 sit in the east room the ladder drops into, so the pair can be found
   * before the gate. Both rooms serve the handout; only the room the player is
   * standing in can be searched.
   */
  function searchBoxes(event) {
    if (event.objectId !== BOXES_LOC_ID) return;
    const { player, location } = event;
    if (location.z !== 0) return;
    if (!BASEMENT_BOXES.some((box) => box.x === location.x && box.y === location.y)) return;
    const at = player.getLocation();
    if (at.getZ() !== 0 || at.getX() < 2897 || at.getX() > 2909 || at.getY() < 9870 || at.getY() > 9878) return;
    if (basementRoom(at.getX()) !== basementRoom(location.x)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return;

    event.handled = true;
    if (held(player, GLOVES_ITEM_ID) || wearingGloves(player)) {
      player.sendMessage("You already have a pair of leather gloves.");
      return;
    }
    if (player.getInventory().getFreeSlots() <= 0) {
      player.sendMessage(FULL_INVENTORY_MESSAGE);
      return;
    }
    player.getInventory().adds(GLOVES_ITEM_ID, 1);
    player.sendMessage("You find a pair of leather gloves in the boxes.");
  }

  function searchCupboard(event) {
    const { player } = event;
    if (held(player, MAGNET_ITEM_ID)) {
      startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-searching-the-cupboard-for-the-magnet-searching-the-cupboard-again-with-a-magnet-already");
      return;
    }
    // A full bag must not advance the durable stage: the magnet is only found
    // once it is actually in the inventory, so the player can retry later.
    if (player.getInventory().getFreeSlots() <= 0) {
      player.sendMessage(FULL_INVENTORY_MESSAGE);
      return;
    }
    player.getInventory().adds(MAGNET_ITEM_ID, 1);
    if (!held(player, MAGNET_ITEM_ID)) {
      player.sendMessage(FULL_INVENTORY_MESSAGE);
      return;
    }
    if (quest.getStage(player) === STAGE_STARTED) quest.setStage(player, STAGE_FOUND_MAGNET);
    startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-searching-the-cupboard-for-the-magnet");
  }

  function searchFountain(event) {
    const { player } = event;
    if (held(player, SHED_KEY_ITEM_ID)) {
      startTranscript(api, player, BOY_NPC_ID, PAGE, "getting-past-the-witch-searching-the-fountain-in-the-garden-searching-the-fountain-again-whilst-holding-the-key");
      return;
    }
    if (player.getInventory().getFreeSlots() <= 0) {
      player.sendMessage(FULL_INVENTORY_MESSAGE);
      return;
    }
    player.getInventory().adds(SHED_KEY_ITEM_ID, 1);
    if (!held(player, SHED_KEY_ITEM_ID)) return;
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
    if (npc) {
      // Quest spawn: without this its death queues the definition's own respawn,
      // leaving an untracked shapeshifter behind in the shed.
      npc.__skipDefaultRespawn = true;
      experimentByPlayer.set(player, npc);
    }
  }

  function dropBall(player, location) {
    itemOnGroundManager?.registerLocation(
      player,
      new Item(BALL_ITEM_ID, 1),
      new Location(location.getX(), location.getY(), location.getZ())
    );
  }

  /** The shed's ball is a permanent ground spawn; only drop one if that is gone. */
  function ballSpawnPresent() {
    return World.getItems().some((ground) => {
      if (ground?.getItem?.().getId?.() !== BALL_ITEM_ID) return false;
      const position = ground.getPosition?.();
      return position?.getX?.() === BALL_SPAWN_TILE.x &&
        position?.getY?.() === BALL_SPAWN_TILE.y &&
        position?.getZ?.() === BALL_SPAWN_TILE.z;
    });
  }

  /**
   * Wiki: taking the shed's ball before the experiment dies leaves the player weakened.
   * Quest Helper's grabBall step also uses the attempt to bring out an experiment that
   * is missing (for example after a relog inside the shed), so spawn one if none is tracked.
   */
  function handleBallPickup(event) {
    if (event.groundItemId !== BALL_ITEM_ID) return;
    const { x, y, z } = event.location ?? {};
    if (Math.abs(x - BALL_SPAWN_TILE.x) > 2 || Math.abs(y - BALL_SPAWN_TILE.y) > 2 || z !== BALL_SPAWN_TILE.z) return;
    if (quest.getStage(event.player) >= STAGE_DEFEATED_EXPERIMENT) return;
    event.handled = true;
    ensureExperiment(event.player);
    event.player.sendMessage("The shapeshifter glares at you. You feel slightly weakened.");
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
      if (!ballSpawnPresent()) dropBall(owner, npc.getLocation());
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
    if (next) {
      next.__skipDefaultRespawn = true;
      experimentByPlayer.set(owner, next);
    }
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
    const entering = player.getLocation().getX() < event.location.x;
    if (entering && stage < STAGE_DEFEATED_EXPERIMENT) ensureExperiment(player);
    crossDoor(event);
  }

  /** The basement gate shocks bare hands; Doors asks here first via door:toggle. */
  function handleElectricGate(event) {
    const { player } = event;
    event.handled = true;
    if (!wearingGloves(player)) {
      startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-attempting-to-open-the-gate-without-correct-gloves");
      return;
    }
    crossElectricGate(event);
  }

  function handleDoorToggle(event) {
    if (GATE_LOC_IDS.has(event.objectId)) handleElectricGate(event);
  }

  /** All the object interactions in and around the house. */
  function handleObjectInteraction(event) {
    const { objectId, player } = event;
    if (objectId === BOXES_LOC_ID) {
      searchBoxes(event);
      return;
    }
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
      const leaving = player.getLocation().getX() > event.location.x;
      const stage = quest.getStage(player);
      if (!leaving && (stage < STAGE_STARTED || stage >= STAGE_COMPLETE)) {
        player.sendMessage("It would be rude to break into this house.");
        return;
      }
      if (!leaving && !held(player, DOOR_KEY_ITEM_ID)) {
        startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-attempting-to-open-the-garden-door-without-unlocking-it");
        return;
      }
      crossDoor(event);
      return;
    }
    if (GATE_LOC_IDS.has(objectId)) {
      handleElectricGate(event);
      return;
    }
    if (objectId === BACK_DOOR_LOC_ID) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_UNLOCKED_BACK_DOOR) {
        player.sendMessage("This door is locked.");
        return;
      }
      crossDoor(event);
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
  function handleItemOnObject(event) {
    if (event.itemId === SHED_KEY_ITEM_ID && event.objectId === SHED_DOOR_LOC_ID) {
      event.handled = true;
      openShedDoor(event);
      return;
    }
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
    if (!tracked || event.target !== tracked) return;
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

  // --- Nora and the garden

  const noraPatrol = { direction: 1, wait: 0 };
  const caughtPlayers = new WeakSet();

  function walkNora(npc) {
    if (noraPatrol.wait > 0) {
      noraPatrol.wait--;
      return;
    }
    const queue = npc.getMovementQueue();
    if (queue.size() > 0) return;
    const x = npc.getLocation().getX();
    if (x >= NORA_EAST_X && noraPatrol.direction > 0) {
      noraPatrol.direction = -1;
      noraPatrol.wait = NORA_EAST_WAIT_TICKS - 1;
      return;
    }
    if (x <= NORA_WEST_X) noraPatrol.direction = 1;
    queue.walkStep(noraPatrol.direction, 0);
  }

  function noraSees(npc, player) {
    const from = npc.getLocation();
    const to = player.getLocation();
    if (noraPatrol.wait === 0 && (to.getX() - from.getX()) * noraPatrol.direction < 0) return false;
    return RegionManager.canProjectileMove(from.getX(), from.getY(), to.getX(), to.getY(), to.getZ(), 1, 1, null);
  }

  /** Back to the start: the magnet and mouse again, and the ball is gone (Wiki). */
  function sendToBoy(player) {
    caughtPlayers.delete(player);
    if (player.isRegistered?.() === false) return;
    player.moveTo(new Location(CAUGHT_TILE.x, CAUGHT_TILE.y, CAUGHT_TILE.z));
    player.getInventory().deleteNumber(BALL_ITEM_ID, player.getInventory().getAmount(BALL_ITEM_ID));
    const stage = quest.getStage(player);
    if (stage > STAGE_STARTED && stage < STAGE_DEFEATED_EXPERIMENT) quest.setStage(player, STAGE_STARTED);
  }

  function catchPlayer(npc, player) {
    caughtPlayers.add(player);
    noraPatrol.wait = CAUGHT_TELEPORT_TICKS;
    player.getMovementQueue().reset();
    npc.setPositionToFace(player.getLocation());
    npc.forceChat("Stop! Thief!");
    TaskManager.submit(new CountdownTask(npc, CAUGHT_CAST_TICKS, () => {
      npc.forceChat("Klarata... Sepptento... Valkan!");
      npc.performAnimation(new Animation(NORA_CAST_ANIMATION));
    }));
    TaskManager.submit(new CountdownTask(npc, CAUGHT_TELEPORT_TICKS, () => sendToBoy(player)));
  }

  class WitchsGarden extends Area {
    constructor() {
      // The row Nora walks and the paths around its hedges, as far as the shed door.
      super([new Boundary(2901, 2933, 3460, 3466, 0)]);
    }

    getName() {
      return "WitchsGarden";
    }

    process(mobile) {
      if (!mobile.isNpc?.() || mobile.getId() !== NORA_NPC_ID) return;
      const npc = mobile.getAsNpc();
      npc.setScriptedMovement(true);
      npc.getMovementCoordinator?.().setRadius(0);
      walkNora(npc);
      for (const player of this.getPlayers()) {
        if (!caughtPlayers.has(player) && noraSees(npc, player)) catchPlayer(npc, player);
      }
    }
  }

  function handleLogout({ player }) {
    if (!player) return;
    const experiment = experimentByPlayer.get(player);
    if (experiment) api.removeNpc(experiment);
    const mouse = mouseByPlayer.get(player);
    if (mouse) api.removeNpc(mouse);
    experimentByPlayer.delete(player);
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

  api.registerArea(new WitchsGarden());
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("door:toggle", handleDoorToggle);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcBeforeDeath(handleExperimentBeforeDeath);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemAction(handleItemAction);
  api.onGroundItemPickup(handleBallPickup);
  api.onPlayerLogout(handleLogout);
  api.onPlayerLogin(handleLogin);
};
