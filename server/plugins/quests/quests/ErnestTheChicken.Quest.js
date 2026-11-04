/** Ernest the Chicken: revision240 Discord capture20260811T152500; cache241 IDs. */
module.exports = function registerErnestTheChickenQuest(api) {
  const {
    GameObject,
    Location,
    HitDamage,
    HitMask,
    ItemIdentifiers,
    MapObjects,
    NpcIdentifiers,
    ObjectIdentifiers,
    RegionManager,
    Animation, Graphic, PrivateArea, Boundary, CountdownTask, TaskManager,
    DialogueChainBuilder, PlayerDialogue, ActionDialogue,
  } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  const VERONICA_NPC_ID = NpcIdentifiers.VERONICA;
  const ODDENSTEIN_NPC_ID = NpcIdentifiers.PROFESSOR_ODDENSTEIN;
  const ERNEST_NPC_ID = NpcIdentifiers.ERNEST;

  const VARP_ERNEST = 32;
  /** varp "ernestlever": levers A-F are bits 1-6 (varbits 1788-1793). */
  const VARP_LEVERS = 33;
  /** varp "ernestdoors": doors 1-9 are bits 0-8 (varbits 1794-1802). */
  const VARP_DOORS = 668;
  const STAGE_STARTED = 1;
  const STAGE_ODDENSTEIN = 2;
  const STAGE_COMPLETE = 3;

  const GAUGE = ItemIdentifiers.PRESSURE_GAUGE;
  const FISH_FOOD = ItemIdentifiers.FISH_FOOD;
  const POISON = ItemIdentifiers.POISON;
  const POISONED_FOOD = ItemIdentifiers.POISONED_FISH_FOOD;
  const KEY = ItemIdentifiers.KEY;
  const TUBE = ItemIdentifiers.RUBBER_TUBE;
  const OIL_CAN = ItemIdentifiers.OIL_CAN;
  const SPADE = ItemIdentifiers.SPADE;
  const COINS = ItemIdentifiers.COINS;

  const COMPOST = ObjectIdentifiers.COMPOST_HEAP;
  const FOUNTAIN = ObjectIdentifiers.FOUNTAIN;
  const CLOSET_DOOR = ObjectIdentifiers.DOOR_14;
  const MANOR_ENTRANCE_DOORS = [ObjectIdentifiers.LARGE_DOOR_5, ObjectIdentifiers.LARGE_DOOR_6];
  const MANOR_EXIT_DOOR = ObjectIdentifiers.DOOR_15;
  /** Door 131's alcove (the skeleton and rubber tube) is one tile east of it. */
  const CLOSET_THROUGH = { x: 1, y: 0 };
  const LADDER_UP = ObjectIdentifiers.LADDER_5;
  const LADDER_DOWN = ObjectIdentifiers.LADDER_6;
  const BOOKCASES = [ObjectIdentifiers.BOOKCASE, ObjectIdentifiers.BOOKCASE_2];

  /**
   * The basement lever/pulley puzzle. Base lever objects 146-151 are named "null"
   * in the cache (the identifier generator skips nameless entries), so they stay
   * literals; their named "Lever A".."Lever F" variants have generated members.
   * Array index is the puzzle bit (0 = A).
   */
  const PUZZLE_LEVER_IDS = [
    [146, ObjectIdentifiers.LEVER_A, ObjectIdentifiers.LEVER_A_2],
    [147, ObjectIdentifiers.LEVER_B, ObjectIdentifiers.LEVER_B_2],
    [148, ObjectIdentifiers.LEVER_C, ObjectIdentifiers.LEVER_C_2],
    [149, ObjectIdentifiers.LEVER_D, ObjectIdentifiers.LEVER_D_2],
    [150, ObjectIdentifiers.LEVER_E, ObjectIdentifiers.LEVER_E_2],
    [151, ObjectIdentifiers.LEVER_F, ObjectIdentifiers.LEVER_F_2],
  ];

  /** Puzzle lever base tiles, in the same order as PUZZLE_LEVER_IDS (from the cache map). */
  const PUZZLE_LEVER_TILES = [
    [3108, 9745],
    [3118, 9752],
    [3112, 9760],
    [3108, 9767],
    [3097, 9767],
    [3096, 9765],
  ];

  /** The 9 puzzle door base ids (137-145 are nameless in the cache), in DOOR_TILES order. */
  const PUZZLE_DOOR_IDS = [137, 138, 139, 140, 141, 142, 143, 144, 145];
  const DOORS = [...PUZZLE_DOOR_IDS, ObjectIdentifiers.DOOR_274];
  /** Resolved door variants: 11449 closed, 11450 ajar (offers Open). */
  const DOOR_CLOSED = ObjectIdentifiers.DOOR_273;
  const DOOR_OPEN = ObjectIdentifiers.DOOR_274;
  /** The manor basement region; loc swaps are only sent to players standing in it. */
  const BASEMENT_BOUNDS = { minX: 3072, maxX: 3135, minY: 9600, maxY: 9855 };

  /** Door tiles, in the reference's door order, used to map a click to a state. */
  const DOOR_TILES = [
    [3105, 9765],
    [3100, 9765],
    [3105, 9760],
    [3100, 9760],
    [3100, 9755],
    [3102, 9763],
    [3097, 9763],
    [3108, 9758],
    [3102, 9758],
  ];

  const LEVER_IDS = new Map();
  for (let index = 0; index < PUZZLE_LEVER_IDS.length; index++) {
    for (const leverId of PUZZLE_LEVER_IDS[index]) LEVER_IDS.set(leverId, index);
  }

  const FOUNTAIN_ATTRIBUTE = "ernest-the-chicken.fountain";
  const LEVERS_ATTRIBUTE = "ernest-the-chicken.levers";
  const HANDIN_ATTRIBUTE = "ernest-the-chicken:parts-handed-in";
  const TRANSFORMED_ATTRIBUTE = "ernest-the-chicken:transformed";
  const HANDIN_VARBIT = 19655;
  const MACHINE_ACTION_ID = "7lApN_", COMPLETE_ACTION_ID = "2wle32";
  const scenes = new WeakMap();
  const actions = new WeakMap();
  const START_HOOK = "quest:ernest-the-chicken:start";
  class ErnestScene extends PrivateArea {
    constructor(player) { super([new Boundary(3106, 3115, 3362, 3370, 2)]); this.player = player; }
    canTeleport() { return false; }
    canAttack() { return false; }
    postLeave(mobile, logout) {
      if (mobile === this.player) {
        TaskManager.cancelTasks(this);
        scenes.delete(mobile);
        mobile.getMovementQueue().setBlockMovement(false);
        mobile.setUntargetable(false);
      }
      super.postLeave(mobile, logout);
    }
  }

  function leaveScene(player) {
    const scene = scenes.get(player);
    if (!scene) return;
    if (player.getArea() === scene) scene.leave(player, false);
    else { TaskManager.cancelTasks(scene); scene.destroy(); scenes.delete(player); }
  }

  function transformErnest(player) {
    if (scenes.has(player) || quest.isComplete(player)) return;
    const scene = new ErnestScene(player);
    scenes.set(player, scene); scene.enter(player);
    const actor = (id, x, y) => {
      const npc = api.spawnNpc({ id, x, y, z: 2, wanderRadius: 0, owner: player, ownerOnly: true });
      if (npc) scene.enter(npc);
      return npc;
    };
    const professor = actor(ODDENSTEIN_NPC_ID, 3110, 3367);
    const chicken = actor(NpcIdentifiers.CHICKEN_16, 3110, 3365);
    player.getMovementQueue().reset().setBlockMovement(true); player.setUntargetable(true);
    later(scene, 1, () => professor?.moveTo(new Location(3111, 3367, 2)));
    later(scene, 2, () => { player.sendMessage("Oddenstein starts up the machine."); professor?.performAnimation(new Animation(832)); });
    later(scene, 4, () => { player.sendMessage("The machine hums and shakes."); player.getPacketSender().sendSoundEffect(1790, 1, 0); });
    later(scene, 7, () => {
      const at = new Location(3111, 3366, 2);
      player.getPacketSender().sendGraphic(new Graphic(173), at);
      if (chicken) {
        chicken.performGraphic(new Graphic(80, 45));
        player.getPacketSender().sendProjectile(at, chicken.getLocation(), 0, 45, 174, 12, 0, chicken, 15, 0);
      }
      player.getPacketSender().sendSoundEffect(187, 2, 0);
    });
    later(scene, 9, () => {
      if (chicken) api.removeNpc(chicken);
      actor(ERNEST_NPC_ID, 3110, 3365);
      player.setAttribute(TRANSFORMED_ATTRIBUTE, 1);
      player.getPacketSender().sendConfig(VARP_ERNEST, 3).sendSoundEffect(1564, 1, 0);
      player.getMovementQueue().setBlockMovement(false); player.setUntargetable(false);
      startTranscript(api, player, ODDENSTEIN_NPC_ID, PAGE_ERNEST, FINISHING_UP_VARIANT, steps => steps.slice(9));
    });
  }

  /** The secret room's eastern-wall lever (160); pulling it opens the bookcase and shoves you out. */
  const SECRET_ROOM_LEVER = ObjectIdentifiers.LEVER_7;
  const SECRET_ROOM_EXIT_X = 3098;

  const PAGE_VERONICA = "Veronica";
  const PAGE_ODDENSTEIN = "Professor Oddenstein";
  const PAGE_ERNEST = "Ernest the Chicken";

  /** "Veronica" page variants. */
  const VERONICA_PRE_QUEST_VARIANT = "standard-dialogue-pre-quest";
  const VERONICA_POST_QUEST_VARIANT = "standard-dialogue-post-quest";
  const VERONICA_STARTING_VARIANT = "starting-off-veronica-during-quest";
  const VERONICA_FINDING_OUT_VARIANT =
    "the-mad-scientist-veronica-during-quest-after-finding-out-about-ernest";

  /** "Ernest the Chicken" page variants (the quest page mixes the three speakers). */
  const ODDENSTEIN_START_VARIANT = "the-mad-scientist";
  const ODDENSTEIN_BEFORE_PARTS_VARIANT = "the-mad-scientist-before-returning-any-parts";
  const ODDENSTEIN_RETURN_GAUGE_VARIANT = "returning-the-parts-the-pressure-gauge";
  const ODDENSTEIN_RETURN_TUBE_VARIANT = "returning-the-parts-the-rubber-tube";
  const ODDENSTEIN_RETURN_OIL_VARIANT = "returning-the-parts-the-oil-can";
  const ODDENSTEIN_RETURN_TUBE_GAUGE_VARIANT =
    "returning-the-parts-the-rubber-tube-and-pressure-gauge";
  const ODDENSTEIN_RETURN_TUBE_OIL_VARIANT = "returning-the-parts-the-rubber-tube-and-oil-can";
  const ODDENSTEIN_RETURN_GAUGE_OIL_VARIANT =
    "returning-the-parts-the-pressure-gauge-and-oil-can";
  const FINISHING_UP_VARIANT = "finishing-up";

  /** "Professor Oddenstein" page variants. */
  const ODDENSTEIN_STANDARD_VARIANT = "standard-dialogue";
  const ODDENSTEIN_AFTER_VARIANT = "after-ernest-the-chicken";


  let quest;

  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const hasAllParts = (player) => hasItem(player, GAUGE) && hasItem(player, TUBE) && hasItem(player, OIL_CAN);

  const attr = (player, key) => Number(player.getAttribute(key)) || 0;
  const setAttr = (player, key, value) => player.setAttribute(key, value);

  /** Door varbits1794–1802; capture includes repeated toggles and the complete oil-can route. */
  function getErnestPuzzleDoorStates(bits) {
    const [a, b, c, d, e, f] = [0, 1, 2, 3, 4, 5].map((index) => (bits & (1 << index)) !== 0);
    return [
      !a && !b && d && e && f,
      !b && d && f,
      a && !c && !e && !f,
      d && !e && !f,
      !a && !b && c && d && f,
      !a && !b && d && !e && f,
      !b && d && !f,
      a && b && !c && !e && !f,
      d && !e && (!c || (!a && !b && f)),
    ];
  }

  function buildJournal(player, quest) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return ["<str>I have spoken to Veronica", "", "<str>I have collected all the parts for the machine", "",
        "<str>Dr Oddenstein thanked me for helping fix his machine", "<str>We turned Ernest back to normal and he rewarded me", "<col=ff0000>QUEST COMPLETE!"];
    }
    if (stage >= STAGE_ODDENSTEIN) {
      return ["<str>I have spoken to Veronica", "", "<str>I've spoken to Dr Oddenstein, and discovered Ernest is a", "<str>chicken", "",
        "<col=000080>I need to bring <col=800000>Dr Oddenstein<col=000080> parts for his machine",
        "<col=800000>1 Oil Can", "<col=800000>1 Pressure Gauge", "<col=800000>1 Rubber Tube",
        "<col=800000>Dr Oddenstein<col=000080> said to search the manor grounds for the",
        "<col=000080>items. Maybe there are some items laying around that could", "<col=000080>help me."];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "I should search Draynor Manor for Ernest",
        "and speak to <col=800000>Professor Oddenstein</col> upstairs.",
      ];
    }
    return [
      "I can start this quest by speaking to",
      "<col=800000>Veronica</col> outside Draynor Manor.",
    ];
  }

  /**
   * Teleport the player to the far side of a door/bookcase they clicked. Door 131
   * is unclipped, so the default route can stop on the door tile itself; `through`
   * says which side it opens to then (the closet's alcove lies east).
   */
  function crossDoor(player, tile, through) {
    const position = player.getLocation();
    const z = tile.z ?? position.getZ();
    const dx = position.getX() - tile.x;
    const dy = position.getY() - tile.y;
    let x = position.getX();
    let y = position.getY();
    if (dx === 0 && dy === 0) {
      if (!through) return;
      x = tile.x + through.x;
      y = tile.y + through.y;
    } else if (Math.abs(dx) > Math.abs(dy)) {
      x = tile.x - Math.sign(dx);
    } else {
      y = tile.y - Math.sign(dy);
    }
    player.moveTo(new Location(x, y, z));
  }

  /**
   * Door 131's click routes onto the door tile (it has no clipping), where
   * crossDoor cannot tell which way the player came from. Route to the tile on
   * the clicked side first, so the crossing mirrors through to the other side.
   */
  function routeClosetDoor(event) {
    if (event.objectId !== CLOSET_DOOR || !event.object?.getLocation) return;
    const tile = event.object.getLocation();
    const from = event.sourceLocation ?? event.player.getLocation();
    const side = from.x > tile.getX() ? 1 : -1;
    event.destination = { x: tile.getX() + side, y: tile.getY(), z: tile.getZ() };
  }

  function useManorDoor({ player, objectId, location }) {
    if (!MANOR_ENTRANCE_DOORS.includes(objectId) && objectId !== MANOR_EXIT_DOOR) return false;
    if (MANOR_ENTRANCE_DOORS.includes(objectId) && player.getLocation().getY() >= location.y) {
      player.sendMessage("The doors won't open. You need to find another way out.");
      return true;
    }
    crossDoor(player, location, { x: 0, y: 1 });
    if (MANOR_ENTRANCE_DOORS.includes(objectId)) player.sendMessage("The doors slam shut behind you.");
    return true;
  }

  function routeManorDoor(event) {
    const entrance = MANOR_ENTRANCE_DOORS.includes(event.objectId);
    if (!entrance && event.objectId !== MANOR_EXIT_DOOR) return;
    const tile = event.object.getLocation();
    const north = event.sourceLocation.y >= tile.getY() + (entrance ? 1 : 0);
    event.destination = { x: tile.getX(), y: tile.getY() + (north ? 1 : -1), z: tile.getZ() };
  }

  function handleManorDoorToggle(request) {
    if (request.handled) return;
    if (!MANOR_ENTRANCE_DOORS.includes(request.objectId) && request.objectId !== MANOR_EXIT_DOOR) return;
    request.handled = useManorDoor(request);
  }

  /**
   * Show one resolved multi-loc variant to a single player. The client keeps
   * LOC_ADD_CHANGE locs and reuses them on scene rebuilds, so the puzzle stays
   * per-player (each player's varps resolve their own doors).
   */
  function sendLocVariant(player, baseId, tile, replacementId) {
    const position = player.getLocation();
    if (
      position.getZ() !== 0 ||
      position.getX() < BASEMENT_BOUNDS.minX || position.getX() > BASEMENT_BOUNDS.maxX ||
      position.getY() < BASEMENT_BOUNDS.minY || position.getY() > BASEMENT_BOUNDS.maxY
    ) {
      return;
    }
    const location = new Location(tile[0], tile[1], 0);
    const base = MapObjects.get(baseId, location, null);
    if (!base) return;
    player.getPacketSender().sendObject(
      new GameObject(replacementId, location, base.getType(), base.getFace(), null)
    );
  }

  function syncPuzzleVisuals(player, previous, bits) {
    if (previous === bits) return;
    for (let index = 0; index < PUZZLE_LEVER_IDS.length; index++) {
      const was = (previous & (1 << index)) !== 0;
      const now = (bits & (1 << index)) !== 0;
      if (was === now) continue;
      // PUZZLE_LEVER_IDS[index] = [base, up, down].
      const variant = now ? PUZZLE_LEVER_IDS[index][2] : PUZZLE_LEVER_IDS[index][1];
      sendLocVariant(player, PUZZLE_LEVER_IDS[index][0], PUZZLE_LEVER_TILES[index], variant);
    }
    const previousStates = getErnestPuzzleDoorStates(previous);
    const states = getErnestPuzzleDoorStates(bits);
    for (let index = 0; index < states.length; index++) {
      if (previousStates[index] === states[index]) continue;
      sendLocVariant(player, PUZZLE_DOOR_IDS[index], DOOR_TILES[index], states[index] ? DOOR_OPEN : DOOR_CLOSED);
    }
  }

  function syncLevers(player, bits) {
    const value = bits & 0x3f;
    const previous = attr(player, LEVERS_ATTRIBUTE);
    setAttr(player, LEVERS_ATTRIBUTE, value);
    const sender = player.getPacketSender();
    // Levers A-F are varp 33 bits 1-6 (bit 0 is unused).
    sender.sendConfig(VARP_LEVERS, value << 1);
    // Doors 1-9 are varp 668 bits 0-8, in the same order as getErnestPuzzleDoorStates.
    let doorBits = 0;
    const states = getErnestPuzzleDoorStates(value);
    for (let index = 0; index < states.length; index++) {
      if (states[index]) doorBits |= 1 << index;
    }
    sender.sendConfig(VARP_DOORS, doorBits);
    syncPuzzleVisuals(player, previous, value);
  }

  function bite(player, message) {
    if (message) player.sendMessage(message);
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(1, HitMask.RED)]);
  }

  function searchCompost(player) {
    player.sendMessage("You find nothing but rotting vegetables. Perhaps a spade would help.");
  }

  function later(key, ticks, run) { TaskManager.submit(new CountdownTask(key, ticks, run)); }

  function digCompost(player) {
    if (!hasItem(player, SPADE)) { searchCompost(player); return; }
    if (actions.has(player)) return;
    const token = {}; actions.set(player, token);
    player.performAnimation(new Animation(830));
    player.sendMessage("You dig through the compost...");
    later(player, 3, () => {
      if (actions.get(player) !== token) return;
      actions.delete(player);
      if (hasItem(player, KEY)) { player.sendMessage("... but you find nothing of interest."); return; }
      if (player.getInventory().isFull()) { player.sendMessage("You need a free inventory slot."); return; }
      player.getInventory().adds(KEY, 1);
      player.sendMessage("... and find a small key.");
    });
  }

  function searchFountain(player) {
    if (actions.has(player)) return;
    if (hasItem(player, GAUGE)) { player.sendMessage("There is nothing else in the fountain."); return; }
    const token = {}; actions.set(player, token);
    player.performAnimation(new Animation(881));
    later(player, 1, () => {
      if (actions.get(player) !== token) return;
      actions.delete(player);
      const chain = new DialogueChainBuilder().add(new PlayerDialogue(0, "There seems to be a pressure gauge in here..."));
      chain.add(new ActionDialogue(1, { execute: () => {
        if (attr(player, FOUNTAIN_ATTRIBUTE) !== 1) {
          bite(player, "Something in the water bites you.");
          player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new PlayerDialogue(0, "... and a lot of piranhas! I can't get the gauge out.")));
        } else {
          if (!hasItem(player, GAUGE) && !player.getInventory().isFull()) {
            player.getInventory().adds(GAUGE, 1);
            player.sendMessage("You get the pressure gauge from the fountain.");
          } else if (player.getInventory().isFull()) player.sendMessage("You need a free inventory slot.");
          player.getDialogueManager().reset();
          player.getPacketSender().sendInterfaceRemoval();
        }
      } }));
      player.getDialogueManager().startDialogues(chain);
    });
  }

  function feedFountain(player, poisoned) {
    const item = poisoned ? POISONED_FOOD : FISH_FOOD;
    if (!hasItem(player, item) || actions.has(player)) return;
    const token = {}; actions.set(player, token);
    player.getInventory().deleteNumber(item, 1);
    player.performAnimation(new Animation(881));
    player.sendMessage(`You pour the ${poisoned ? "poisoned " : ""}fish food into the fountain.`);
    if (poisoned) setAttr(player, FOUNTAIN_ATTRIBUTE, 1);
    later(player, 2, () => { if (actions.get(player) === token) player.sendMessage("The piranhas start eating the food..."); });
    later(player, 5, () => {
      if (actions.get(player) !== token) return;
      actions.delete(player);
      player.sendMessage(poisoned ? "... then die and float to the surface." : "Now they seem hungrier than ever!");
    });
  }

  function useFishFoodOnFountain(player) { feedFountain(player, false); }
  function usePoisonedFoodOnFountain(player) { feedFountain(player, true); }

  function poisonFishFood(player) {
    if (!hasItem(player, POISON) || !hasItem(player, FISH_FOOD)) return;
    player.getInventory().deleteNumber(FISH_FOOD, 1);
    player.getInventory().deleteNumber(POISON, 1);
    player.getInventory().adds(POISONED_FOOD, 1);
    player.sendMessage("You poison the fish food.");
  }

  function searchBookcase(player, tile) {
    player.sendMessage("You pull a book and the bookcase swings aside.");
    player.moveTo(new Location(tile.x + (player.getLocation().getX() < tile.x ? 1 : -1), player.getLocation().getY(), tile.z ?? player.getLocation().getZ()));
  }

  function openClosetDoor(player, tile) {
    if (!hasItem(player, KEY)) {
      player.sendMessage("The door is locked.");
      return;
    }
    crossDoor(player, tile, CLOSET_THROUGH);
  }

  function useLever(player, index) {
    const bits = attr(player, LEVERS_ATTRIBUTE) ^ (1 << index);
    syncLevers(player, bits);
    player.performAnimation(new Animation(2139));
    player.sendMessage("You hear a clunk.");
  }

  /**
   * The puzzle doors are shape-10 scenery with the wall on one edge of their tile. The cache
   * map has face 0 (doors 1-5, wall on the west edge) and face 3 (doors 6-9, south edge). A door
   * is crossed through that edge, so the crossing axis is the wall's, not the direction the
   * player happens to be standing in. Other faces do not occur and are left alone.
   */
  const WALL_STEPS = new Map([[0, { x: -1, y: 0 }], [3, { x: 0, y: -1 }]]);

  const puzzleDoorStep = (object) => WALL_STEPS.get(object?.getFace?.());

  function usePuzzleDoor(player, tile, object) {
    const index = DOOR_TILES.findIndex(([x, y]) => x === tile.x && y === tile.y);
    const states = getErnestPuzzleDoorStates(attr(player, LEVERS_ATTRIBUTE));
    if (index < 0 || !states[index]) {
      player.sendMessage("The door is locked firmly in place.");
      return;
    }
    const step = puzzleDoorStep(object);
    if (!step) return;
    const position = player.getLocation();
    const wallSide = (position.getX() - tile.x) * step.x + (position.getY() - tile.y) * step.y > 0;
    const direction = wallSide ? -1 : 1;
    player.moveTo(new Location(tile.x + direction * step.x, tile.y + direction * step.y, tile.z ?? position.getZ()));
  }

  /**
   * Route the click to the walkable tile directly in front of the door on either side of its
   * wall, the nearer to the player, so the interaction always runs from a tile that crosses the
   * wall. The ordinary reach check refuses some sides, and a tile beside the door along its wall
   * would otherwise be used as the starting side.
   */
  function routePuzzleDoor(event) {
    if (!DOORS.includes(event.objectId)) return;
    const tile = event.object?.getLocation?.();
    if (!tile) return;
    const step = puzzleDoorStep(event.object);
    if (!step) return;
    const position = event.player.getLocation();
    let best = null;
    // The side away from the wall comes first, so from the door tile itself (a tie) the player
    // is sent through the wall.
    for (const direction of [-1, 1]) {
      const x = tile.getX() + direction * step.x;
      const y = tile.getY() + direction * step.y;
      const stand = new Location(x, y, tile.getZ());
      if (RegionManager.blocked(stand, event.player.getPrivateArea?.() ?? null)) continue;
      const distance = Math.max(Math.abs(x - position.getX()), Math.abs(y - position.getY()));
      if (!best || distance < best.distance) best = { x, y, distance };
    }
    if (!best) return;
    event.destination = { x: best.x, y: best.y, z: tile.getZ() };
  }

  /** The secret room's eastern-wall lever opens the bookcase and moves you out through it. */
  function exitSecretRoom(player) {
    if (player.getLocation().getX() >= SECRET_ROOM_EXIT_X) return;
    player.sendMessage("The lever opens the secret door!");
    player.moveTo(new Location(SECRET_ROOM_EXIT_X, player.getLocation().getY(), 0));
  }

  /**
   * The basement ladder and the secret room's ladder: both ends are on plane 0
   * (the basement lies at y~9750, not on a plane below), so ClimbLinks cannot
   * pair them and the generic resolver sent the basement ladder up into the
   * manor's stairs. Claim the click through the ladders module's content hook.
   */
  function claimPuzzleLadder(request) {
    if (request.handled) return;
    const { player, objectId } = request;
    if (objectId !== LADDER_UP && objectId !== LADDER_DOWN) return;
    syncLevers(player, 0);
    const destination = objectId === LADDER_UP
      ? new Location(3092, 3362, 0) // secret room
      : new Location(3117, 9754, 0); // basement
    api.emitCustomEvent(objectId === LADDER_UP ? "ladders:climbUp" : "ladders:climbDown", {
      player,
      destination,
    });
    request.handled = true;
  }

  function handleOddensteinTalk(event) {
    const { player, npcId } = event;
    if (npcId !== ODDENSTEIN_NPC_ID || quest.isComplete(player) || quest.getStage(player) < STAGE_ODDENSTEIN) return;
    if (!attr(player, HANDIN_ATTRIBUTE)) return;
    event.handled = true;
    startTranscript(api, player, ODDENSTEIN_NPC_ID, PAGE_ERNEST, FINISHING_UP_VARIANT,
      steps => steps.slice(attr(player, TRANSFORMED_ATTRIBUTE) ? 9 : 5));
  }

  function reward(player) {
    player.getInventory().adds(COINS, 300);
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (npcId === VERONICA_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return { page: PAGE_VERONICA, variant: VERONICA_POST_QUEST_VARIANT };
      if (stage >= STAGE_ODDENSTEIN) {
        return { page: PAGE_ERNEST, variant: VERONICA_FINDING_OUT_VARIANT };
      }
      if (stage >= STAGE_STARTED) {
        return { page: PAGE_ERNEST, variant: VERONICA_STARTING_VARIANT };
      }
      return { page: PAGE_VERONICA, variant: VERONICA_PRE_QUEST_VARIANT };
    }

    if (npcId === ODDENSTEIN_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return { page: PAGE_ODDENSTEIN, variant: ODDENSTEIN_AFTER_VARIANT };
      if (stage === STAGE_STARTED) return { page: PAGE_ERNEST, variant: ODDENSTEIN_START_VARIANT };
      if (stage >= STAGE_ODDENSTEIN) {
        const gauge = hasItem(player, GAUGE);
        const tube = hasItem(player, TUBE);
        const oil = hasItem(player, OIL_CAN);
        if (gauge && tube && oil) return { page: PAGE_ERNEST, variant: FINISHING_UP_VARIANT };
        if (tube && gauge) return { page: PAGE_ERNEST, variant: ODDENSTEIN_RETURN_TUBE_GAUGE_VARIANT };
        if (tube && oil) return { page: PAGE_ERNEST, variant: ODDENSTEIN_RETURN_TUBE_OIL_VARIANT };
        if (gauge && oil) return { page: PAGE_ERNEST, variant: ODDENSTEIN_RETURN_GAUGE_OIL_VARIANT };
        if (gauge) return { page: PAGE_ERNEST, variant: ODDENSTEIN_RETURN_GAUGE_VARIANT };
        if (tube) return { page: PAGE_ERNEST, variant: ODDENSTEIN_RETURN_TUBE_VARIANT };
        if (oil) return { page: PAGE_ERNEST, variant: ODDENSTEIN_RETURN_OIL_VARIANT };
        return { page: PAGE_ERNEST, variant: ODDENSTEIN_BEFORE_PARTS_VARIANT };
      }
      return { page: PAGE_ODDENSTEIN, variant: ODDENSTEIN_STANDARD_VARIANT };
    }

    if (npcId === ERNEST_NPC_ID) {
      // No chicken-specific transcript in the dump; the wiki infobox lists
      // Ernest on the shared finishing-up conversation.
      return { page: PAGE_ERNEST, variant: FINISHING_UP_VARIANT };
    }

    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== VERONICA_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
    player.sendMessage("You've started a new quest: <col=081190>Ernest the Chicken</col>");
  }

  function handleLine(request) {
    if (request.npcId !== ODDENSTEIN_NPC_ID && request.npcId !== ERNEST_NPC_ID) return;
    if (String(request.text).startsWith("I'm missing the pressure gauge")) {
      request.before = () => { if (quest.getStage(request.player) < STAGE_ODDENSTEIN) quest.setStage(request.player, STAGE_ODDENSTEIN); };
    }
    if (String(request.text).startsWith("[Thank you")) {
      request.text = String(request.text).replace("[Thank you sir/Thank you m'lady/Thank you]", request.player.getAppearance?.().isMale?.() === false ? "Thank you, m'lady" : "Thank you, sir");
    }
  }

  function handleAction(event) {
    const { player } = event;
    if (event.npcId !== ODDENSTEIN_NPC_ID && event.npcId !== ERNEST_NPC_ID) return;
    if (event.stepId === "Y6CLr9") {
      event.handled = true;
      if (!attr(player, HANDIN_ATTRIBUTE)) {
        if (!hasAllParts(player) || quest.getStage(player) !== STAGE_ODDENSTEIN) { event.end = true; return; }
        for (const id of [GAUGE, TUBE, OIL_CAN]) player.getInventory().deleteNumber(id, 1);
        player.setAttribute(HANDIN_ATTRIBUTE, 1);
        player.getPacketSender().sendVarbit(HANDIN_VARBIT, 1);
        player.sendMessage("You give a rubber tube, a pressure gauge, ");
      }
      return;
    }
    if (event.stepId === "ig6Dot") {
      event.handled = true; event.end = true;
      if (attr(player, HANDIN_ATTRIBUTE)) transformErnest(player);
      return;
    }
    if (event.stepId === MACHINE_ACTION_ID) { event.handled = true; return; }
    if (event.stepId !== COMPLETE_ACTION_ID) return;
    event.handled = true; event.end = true;
    if (attr(player, HANDIN_ATTRIBUTE) && attr(player, TRANSFORMED_ATTRIBUTE)) {
      quest.complete(player); leaveScene(player);
    }
  }

  /** The lever/door state lives in a persisted attribute; restore its visuals on login. */
  function handleLogout({ player }) { leaveScene(player); actions.delete(player); }

  function handleLogin({ player }) {
    syncLevers(player, attr(player, LEVERS_ATTRIBUTE));
    player.getPacketSender().sendVarbit(HANDIN_VARBIT, attr(player, HANDIN_ATTRIBUTE));
  }

  function handleItemOnItem(event) {
    const ids = [event.usedItemId, event.usedWithItemId];
    if (!ids.includes(POISON) || !ids.includes(FISH_FOOD)) return;
    poisonFishFood(event.player);
    event.handled = true;
  }

  function handleItemOnObject(event) {
    const { player, objectId, itemId } = event;
    if (objectId === COMPOST && itemId === SPADE) {
      digCompost(player);
      event.handled = true;
      return;
    }
    if (objectId === CLOSET_DOOR && itemId === KEY) {
      crossDoor(player, event.location, CLOSET_THROUGH);
      event.handled = true;
      return;
    }
    if (objectId === FOUNTAIN) {
      if (itemId === FISH_FOOD) {
        useFishFoodOnFountain(player);
        event.handled = true;
      } else if (itemId === POISONED_FOOD) {
        usePoisonedFoodOnFountain(player);
        event.handled = true;
      } else {
        player.sendMessage("Something in the water bites you.");
        player.sendMessage("Ow!");
        event.handled = true;
      }
    }
  }

  function handleObjectInteraction(event) {
    const option = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
    const { player, objectId, location } = event;

    if (option.includes("open") && useManorDoor(event)) {
      event.handled = true;
      return;
    }

    if (LEVER_IDS.has(objectId)) {
      useLever(player, LEVER_IDS.get(objectId));
      event.handled = true;
      return;
    }
    if (DOORS.includes(objectId)) {
      usePuzzleDoor(player, location, event.object ?? MapObjects.get(objectId, new Location(location.x, location.y, location.z ?? 0), player.getPrivateArea?.() ?? null));
      event.handled = true;
      return;
    }
    if (objectId === SECRET_ROOM_LEVER && option.includes("pull")) {
      exitSecretRoom(player);
      event.handled = true;
      return;
    }
    if (objectId === COMPOST && option.includes("search")) {
      if (hasItem(player, SPADE)) digCompost(player); else searchCompost(player);
      event.handled = true;
      return;
    }
    if (objectId === FOUNTAIN && option.includes("search")) {
      searchFountain(player);
      event.handled = true;
      return;
    }
    if (objectId === CLOSET_DOOR && option.includes("open")) {
      openClosetDoor(player, location);
      event.handled = true;
      return;
    }
    if (BOOKCASES.includes(objectId) && option.includes("search")) {
      searchBookcase(player, location);
      event.handled = true;
    }
  }

  quest = registerQuest(api, {
    key: "ernest_the_chicken",
    name: "Ernest the Chicken",
    varpId: VARP_ERNEST,
    varpValue: (stage, player) => stage === STAGE_ODDENSTEIN && attr(player, TRANSFORMED_ATTRIBUTE) ? 3 : stage,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 4,
    scrollItemId: ItemIdentifiers.FEATHER,
    completionJingleId: 153,
    rewardItemLabel: "300 Coins",
    buildJournal,
    onReward: reward,
  });

  api.persistAttribute(FOUNTAIN_ATTRIBUTE, 0);
  api.persistAttribute(HANDIN_ATTRIBUTE, 0);
  api.persistAttribute(TRANSFORMED_ATTRIBUTE, 0);
  api.persistAttribute(LEVERS_ATTRIBUTE, 0);

  api.onNpcDialogueVariant(selectVariant);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("ladders:climb", claimPuzzleLadder);
  api.onCustomEvent("door:toggle", handleManorDoorToggle);
  api.onNpcInteraction(handleOddensteinTalk);
  api.onObjectRoute(routePuzzleDoor);
  api.onObjectRoute(routeClosetDoor);
  api.onObjectRoute(routeManorDoor);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDisconnect(handleLogout);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject);
  api.onObjectInteraction(handleObjectInteraction);
};
