/**
 * Ernest the Chicken.
 *
 * Words come from npc-dialogues.json. The "Ernest the Chicken" page mixes the
 * three speakers for the quest, so the variant is chosen by the speaker's cache
 * id:
 *   Veronica 3561, Professor Oddenstein 3562, Ernest 3563.
 *
 * Stages (varp 32): 1 started, 2 Oddenstein told you about the machine parts,
 * 3 complete.
 *
 * Supporting state kept in attributes (the reference's varps 33/668):
 *   ernest-the-chicken.fountain  1 = piranhas poisoned
 *   ernest-the-chicken.levers    the 6-bit basement lever/pulley puzzle
 *
 * The basement puzzle is the cache's own multi-loc set, not new map content:
 * levers 146-151 resolve through varbits 1788-1793 (varp 33, bits 1-6) and
 * doors 137-145 through varbits 1794-1802 (varp 668, bits 0-8). syncLevers
 * drives both and sends the resolved loc (up/down, closed/ajar) to the player,
 * since this client does not re-resolve multi-locs on a varp change; only an
 * ajar door (11450) offers its Open option.
 *
 * Gaps (no dump support, see summary):
 *   - Oddenstein before the quest has no "busy" line; the standard machine
 *     conversation plays.
 *   - Ernest 3563 has no stand-alone transcript, so he references the shared
 *     "finishing-up" conversation (a wiki infobox artifact). The runtime can
 *     only render the clicked NPC, so the plugin starts that variant itself
 *     with a speaker map that gives Ernest his own chathead.
 */
module.exports = function registerErnestTheChickenQuest(api) {
  const {
    GameConstants,
    GameObject,
    Location,
    HitDamage,
    HitMask,
    ItemIdentifiers,
    MapObjects,
    NpcDefinition,
    NpcIdentifiers,
    ObjectIdentifiers,
    RegionManager,
    World,
  } = api.core;
  const { registerQuest } = require("../QuestRuntime");
  const { startDialogue } = require("../../npcs/NpcDialogues.plugin.js");
  const fs = require("fs");
  const path = require("path");

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
  const START_HOOK = "quest:ernest-the-chicken:start";
  /** "The machine turns Ernest back into human form." */
  const MACHINE_ACTION_ID = "7lApN_";
  /** "Congratulations! Quest complete!" on the shared finishing-up page. */
  const COMPLETE_ACTION_ID = "2wle32";
  /** The nameless multi chicken (varp 32 picks Chicken 10556 or, at stage 3, nothing). */
  const CHICKEN_MULTI_NPC_ID = 2831;
  /** The secret room's eastern-wall lever (160); pulling it opens the bookcase and shoves you out. */
  const SECRET_ROOM_LEVER = ObjectIdentifiers.LEVER_7;
  const SECRET_ROOM_EXIT_X = 3098;
  /** The finishing-up variant's Ernest lines get Ernest's chathead, not the professor's. */
  const FINISHING_UP_SPEAKERS = new Map([["Ernest", ERNEST_NPC_ID]]);

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

  /** "I'm looking for a guy called Ernest." choice on the mad-scientist page. */
  const FIND_ERNEST_OPTION = "I'm looking for a guy called Ernest.";

  let quest;

  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const hasAllParts = (player) => hasItem(player, GAUGE) && hasItem(player, TUBE) && hasItem(player, OIL_CAN);

  const attr = (player, key) => Number(player.getAttribute(key)) || 0;
  const setAttr = (player, key, value) => player.setAttribute(key, value);

  /** The 9 puzzle doors opened by the 6 lever bits (copied from the reference). */
  function getErnestPuzzleDoorStates(bits) {
    const [a, b, c, d, e, f] = [0, 1, 2, 3, 4, 5].map((index) => (bits & (1 << index)) !== 0);
    return [
      !a && !b && d && e && f,
      !b && d && f,
      a && b && d,
      d,
      !e && f,
      !a && !b && c && d && !e && f,
      !b && d && !f,
      a && b && !c && !d && !e && !f,
      (!c && d) || (!a && !b && c && d && !e && f),
    ];
  }

  function buildJournal(player, quest) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I repaired the machine and Ernest is human again.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_ODDENSTEIN) {
      return [
        "Professor Oddenstein needs a <col=800000>pressure gauge</col>,",
        "<col=800000>rubber tube</col> and <col=800000>oil can</col> to restore Ernest.",
      ];
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

  function digCompost(player) {
    if (hasItem(player, KEY)) {
      player.sendMessage("You find nothing else.");
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory slot.");
      return;
    }
    player.getInventory().adds(KEY, 1);
    player.sendMessage("You dig up a small key.");
  }

  function searchFountain(player) {
    if (hasItem(player, GAUGE)) {
      player.sendMessage("There is nothing else in the fountain.");
      return;
    }
    if (attr(player, FOUNTAIN_ATTRIBUTE) !== 1) {
      bite(player, "The piranhas bite your hand!");
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory slot.");
      return;
    }
    player.getInventory().adds(GAUGE, 1);
    player.sendMessage("You retrieve the pressure gauge from the fountain.");
  }

  function useFishFoodOnFountain(player) {
    player.getInventory().deleteNumber(FISH_FOOD, 1);
    player.sendMessage("You pour the fish food into the fountain.");
    player.sendMessage("The piranhas start eating the food...");
    player.sendMessage("Now they seem hungrier than ever!");
  }

  function usePoisonedFoodOnFountain(player) {
    if (attr(player, FOUNTAIN_ATTRIBUTE) === 1) return;
    player.getInventory().deleteNumber(POISONED_FOOD, 1);
    setAttr(player, FOUNTAIN_ATTRIBUTE, 1);
    player.sendMessage("You pour the poisoned fish food into the fountain.");
    player.sendMessage("The piranhas start eating the food...");
    player.sendMessage("... then die and float to the surface.");
  }

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
    player.sendMessage(
      `You pull lever ${String.fromCharCode(65 + index)} ${(bits & (1 << index)) !== 0 ? "down" : "up"}.`
    );
  }

  function usePuzzleDoor(player, tile) {
    const index = DOOR_TILES.findIndex(([x, y]) => x === tile.x && y === tile.y);
    const states = getErnestPuzzleDoorStates(attr(player, LEVERS_ATTRIBUTE));
    if (index < 0 || !states[index]) {
      player.sendMessage("The door is locked firmly in place.");
      return;
    }
    crossDoor(player, tile);
  }

  /**
   * The puzzle doors are map scenery (shape 10) sitting next to wall pieces, so
   * the walk-to-object reach check refuses one side of some. Route the click to
   * the nearest walkable tile in front on the player's side instead; the
   * interaction then runs and usePuzzleDoor crosses the door.
   */
  function routePuzzleDoor(event) {
    if (!DOORS.includes(event.objectId)) return;
    const tile = event.object?.getLocation?.();
    if (!tile) return;
    const position = event.player.getLocation();
    let best = null;
    for (const [x, y] of [[tile.getX() + 1, tile.getY()], [tile.getX() - 1, tile.getY()], [tile.getX(), tile.getY() + 1], [tile.getX(), tile.getY() - 1]]) {
      const stand = new Location(x, y, tile.getZ());
      if (RegionManager.blocked(stand, event.player.getPrivateArea?.() ?? null)) continue;
      const distance = Math.max(Math.abs(x - position.getX()), Math.abs(y - position.getY()));
      if (!best || distance < best.distance) best = { x, y, distance };
    }
    if (!best) return;
    event.destination = { x: best.x, y: best.y, z: tile.getZ() };
  }

  /** "The machine turns Ernest back into human form." (LostCity's change_ernest). */
  function transformErnest(player) {
    const here = player.getLocation();
    for (const npc of World.getNpcs()) {
      if (npc?.getId?.() !== CHICKEN_MULTI_NPC_ID) continue;
      const location = npc.getLocation();
      if (location.getZ() !== here.getZ()) continue;
      if (Math.max(Math.abs(location.getX() - here.getX()), Math.abs(location.getY() - here.getY())) > 8) continue;
      npc.setNpcTransformationId(ERNEST_NPC_ID);
      return;
    }
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

  let finishingUpSteps;

  /** The finishing-up variant, loaded from the dialogue dump on first use. */
  function loadFinishingUpSteps() {
    if (finishingUpSteps) return finishingUpSteps;
    try {
      const file = path.join(GameConstants.DEFINITIONS_DIRECTORY, "npc-dialogues.json");
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      finishingUpSteps = data?.[PAGE_ERNEST]?.variants?.[FINISHING_UP_VARIANT] ?? [];
    } catch {
      finishingUpSteps = [];
    }
    return finishingUpSteps;
  }

  /**
   * The transcript runtime voices every line with the clicked NPC, so it puts
   * Ernest's thank-you in Oddenstein's mouth. Start the hand-in variant here
   * instead, with a speaker map the runtime resolves to Ernest's chathead.
   */
  function handleOddensteinTalk(event) {
    const { player, npcId, definition, clickType } = event;
    if (npcId !== ODDENSTEIN_NPC_ID) return;
    const option = String(definition?.getActions?.()?.[clickType - 1] ?? "").toLowerCase();
    if (option !== "talk-to") return;
    if (quest.getStage(player) < STAGE_ODDENSTEIN || !hasAllParts(player)) return;
    const steps = loadFinishingUpSteps();
    if (!steps.length) return;
    const npcDefinition = NpcDefinition.forId(ODDENSTEIN_NPC_ID);
    if (!npcDefinition) return;
    startDialogue(
      api,
      { player, npc: event.npc, npcId: ODDENSTEIN_NPC_ID, definition: npcDefinition },
      steps,
      undefined,
      {
        player,
        npc: event.npc,
        npcId: ODDENSTEIN_NPC_ID,
        definition: npcDefinition,
        speakerIdByName: FINISHING_UP_SPEAKERS,
      }
    );
    event.handled = true;
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
  }

  // The dump carries no hook for learning about the parts, so advance the
  // stage when the player commits to finding Ernest.
  function handleOddensteinChoice({ player, npcId, option }) {
    if (npcId !== ODDENSTEIN_NPC_ID) return;
    if (option !== FIND_ERNEST_OPTION) return;
    if (quest.getStage(player) >= STAGE_ODDENSTEIN) return;
    quest.setStage(player, STAGE_ODDENSTEIN);
  }

  function handleAction(event) {
    const { player } = event;

    // "The machine turns Ernest back into human form.": swap the chicken NPC
    // for human Ernest 3563, as LostCity's change_ernest does.
    if (event.stepId === MACHINE_ACTION_ID) {
      transformErnest(player);
      event.handled = true;
      return;
    }

    if (event.stepId !== COMPLETE_ACTION_ID) return;
    if (!hasAllParts(player)) return;
    player.getInventory().deleteNumber(GAUGE, 1);
    player.getInventory().deleteNumber(TUBE, 1);
    player.getInventory().deleteNumber(OIL_CAN, 1);
    quest.complete(player);
    event.handled = true;
    event.end = true;
  }

  /** The lever/door state lives in a persisted attribute; restore its visuals on login. */
  function handleLogin({ player }) {
    syncLevers(player, attr(player, LEVERS_ATTRIBUTE));
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
      usePuzzleDoor(player, location);
      event.handled = true;
      return;
    }
    if (objectId === SECRET_ROOM_LEVER && option.includes("pull")) {
      exitSecretRoom(player);
      event.handled = true;
      return;
    }
    if (objectId === COMPOST && option.includes("search")) {
      searchCompost(player);
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
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 4,
    scrollItemId: COINS,
    rewardItemLabel: "300 Coins",
    buildJournal,
    onReward: reward,
  });

  api.persistAttribute(FOUNTAIN_ATTRIBUTE);
  api.persistAttribute(LEVERS_ATTRIBUTE);

  api.onNpcDialogueVariant(selectVariant);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleOddensteinChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("ladders:climb", claimPuzzleLadder);
  api.onCustomEvent("door:toggle", handleManorDoorToggle);
  api.onNpcInteraction(handleOddensteinTalk);
  api.onObjectRoute(routePuzzleDoor);
  api.onObjectRoute(routeClosetDoor);
  api.onObjectRoute(routeManorDoor);
  api.onPlayerLogin(handleLogin);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject);
  api.onObjectInteraction(handleObjectInteraction);
};
