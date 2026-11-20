/**
 * Darkness of Hallowvale: Ghetto unit (see ../quests/DarknessOfHallowvale.Quest.js for the unit map).
 *
 * Meiyerditch from the arrival (stage 50) to the hideout (80), and the hideout entry at every visit.
 * Live's capture (rsprox, revision 242; ticks are the capture's) is the model:
 *
 * - The wall floorboards (18122, varbit 2589): Search shows the messagebox and "Kick them?" (t552-555);
 *   Yes plays myq3_stamp 4750 and m3_kick_wall 1716, and two ticks on 2589 = 1 with "You kick the
 *   floorboards..." (t557-559). The stage stays 50. Climb-down: human_pickupfloor 827, then the move
 *   to 3588,3173,0 a tick on (t561-562); the underboards (18124) climb back up (t6074-6075).
 * - The breached wall's rubble (18037/18038): two exactmove legs through plane 1, six ticks apart, and
 *   back to plane 0 six ticks later (t572-584, t6053-6065).
 * - The citizens: one conversation whose menu follows the stage, as live redraws it (t596-821): 52 as
 *   the player continues past "Yes... but I really can't talk about them." (t603), 54 with "I
 *   understand, but you may not like what you find..." (t736), 60 when "Can you introduce me to Old
 *   Man Ral?" is chosen (t773); from 60 the "Meiyerditch citizen" page's standard talk (t2395).
 * - Old Man Ral: the sage chain and 65 with "Hmph. Myreque, eh?..." (t1158); from 65 his own page's
 *   "Hello again!" talk (t1181); the papyrus talk while the sketches are being made.
 * - The rooftop route: every jump, crawl, shelf, push wall, floor, the table tunnel, the washing line,
 *   the pots and the ghetto's locked door (2578), the ladder top (2598), each with live's sequences,
 *   exactmoves, sounds, messages and the Agility xp on the tick live gives it (t1213-2635).
 * - The hideout: the wall's latch (knife or sickle, 70 at t2729), the wall's two-tick opening
 *   (t2731-2733), the symbol (t2736-2737), the rug and the trapdoor (2590 1 -> 2 -> 1 -> 0, 80 at
 *   t2748), the ladder up (t7298-7315) and the locked shortcut door (t7323).
 * - Talk-to on a vyrewatch before the hideout (80); from 80, and the hassle, it is the Hassle unit's.
 *
 * Words are the transcript pages' ("Darkness of Hallowvale", "Meiyerditch citizen", "Old Man Ral",
 * the quest page's vyrewatch lines); the object lines live sends that no page holds are LIVE_TEXT.
 */
const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");
const { loadTranscripts } = require("../QuestRuntime");
const ROUTE = require("../quests/data/darkness-of-hallowvale-route.json");

module.exports = function attachGhetto(context) {
  const { api, state, common, STAGE, VARBIT, PAGE } = context;
  const core = api.core;
  const { Location, Skill, ItemIdentifiers: I } = core;
  ObstacleRunner.init(api);

  // ---------------------------------------------------------------------------
  // Ids (cache gamevals)
  // ---------------------------------------------------------------------------

  const LOC = Object.freeze({
    FLOORBOARDS: 18122, // meiyerditch_wall_floorboards_multi_loc (2589: 18033 Search, 18034 Climb-down)
    UNDERBOARDS: 18124, // mieyerditch_wall_underboards_multi_loc (2589 = 1: 18036 Climb-up)
    LADDER_UP: 17974, // area_sanguine_ghetto_ladder_up
    LADDER_DOWN: 17975, // area_sanguine_ghetto_ladder_down
    STAIRS_UP: 17976, // area_sanguine_ghetto_stairs_up
    STAIRS_DOWN: 17978, // area_sanguine_ghetto_stairs_down
    BROKEN_STAIRS_UP: 17977, // area_sanguine_ghetto_stairs_up_broken (Old Man Ral's house)
    BROKEN_STAIRS_DOWN: 17979, // area_sanguine_ghetto_stairs_down_broken
    TABLE: 18083, // myq3_agil_8_trapdoor_tunnel_multi (2597: 18059 Table, 18060 Trapdoor table, 18061 Trapdoor tunnel)
    TABLE_2: 18084, // myq3_agil_8_trapdoor_tunnel_multi_02 (2597: 18062, 18063, 18064)
    POTS: 18065, // myq3_ghetto_pots_search
    LOCKED_DOOR: 18091, // myq3_agil_14_locked_door
    LOCKED_DOOR_OPEN: 18092, // myq3_agil_14_locked_door_inactive
    LADDER_WALL: 18115, // myq3_agil_32_ladder_wall_multi (2598: 18066 full, 18067 empty)
    LADDER_FLOOR: 18116, // myq3_agil_33_ladder_floor_multi (2598: 18068 Broken ladder, 18069 Ladder)
    HIDEOUT_WALL: 17980, // area_sanguine_myreque_secret_wall_closed
    HIDEOUT_WALL_OPEN: 17981, // area_sanguine_myreque_secret_wall_inactive
    SYMBOL: 18146, // sang_myreque_hideout_symbol_multi (2590: 18144 Press, 18145 Search)
    RUG: 18120, // sang_myreque_hideout_trapdoor_multiloc (2590: 17983 Rug, 17984 Lumpy rug, 17985 Trapdoor)
    HIDEOUT_LADDER: 17986, // area_sanguine_myreque_hideout_ladder_up
    SHORTCUT_DOOR: 17973, // area_sanguine_myreque_door_locked
    INVISWALL: 38848, // inviswall, nameless
  });
  /** The multilocs' transforms the hooks see (ObjectDefinition.forPlayer). */
  const TRANSFORM = Object.freeze({
    TABLE_SEARCH: 18059, TABLE_OPEN: 18060, TUNNEL: 18061, TABLE_2_SEARCH: 18062, TABLE_2_OPEN: 18063,
    WALL_FULL: 18066, WALL_EMPTY: 18067, BROKEN_LADDER: 18068, FIXED_LADDER: 18069,
    SYMBOL_PRESS: 18144, RUG_LUMPY: 17984, TRAPDOOR_OPEN: 17985,
  });

  const ITEM = Object.freeze({
    DOOR_KEY: 9654, // myq3_agil_key_1
    LADDER_TOP: 9655, // myq3_sanguine_ladder_top
    KNIFE: I.KNIFE, // 946
    SICKLE: I.SILVER_SICKLE, // 2961
    SICKLE_B: I.SILVER_SICKLE_B_, // 2963
  });

  const NPC = Object.freeze({
    CITIZEN: core.NpcIdentifiers.MEIYERDITCH_CITIZEN, // 3780: the citizens' pages are played as this one
    RAL: 15774, // myreque_pt3_old_man_ral_1op (3772's multinpc, "Old Man Ral")
  });

  // Sequences, sounds (as captured)
  const SEQ = Object.freeze({
    STAMP: 4750, // myq3_stamp
    PICKUP_FLOOR: 827, // human_pickupfloor
    REACH_LADDER: 828, // human_reachforladder
    PICKUP_TABLE: 832, // human_pickuptable
    STEPPING_JUMP: 769, // human_steppingstonejump
    DOUBLE_JUMP: 4721, // myq3_double_square_jump
    CRAWLING: 844, // human_crawling
    SHELF_CLIMB: 4722, // myq3_shelf_climb
    PUSH: 810, // human_push
    ENTER_HOLE: 2589, // agilty_shortcut_enter_hole
    TUNNEL_WALK: 2590, // agilty_shortcut_tunnel_walk
    EXIT_HOLE: 2591, // agilty_shortcut_exit_hole
    RUBBLE_FIRST: 4723, // myq3_breached_wall_crossing_first
    RUBBLE_SECOND: 4724, // myq3_breached_wall_crossing_second
    WALL_BUTTON: 4743, // myq3_ghetto_wall_button_anim (loc)
    BALANCE_WALK: 762, // the washing line's walk (ours: live resends the appearance but rsprox hides the BAS)
  });
  const SOUND = Object.freeze({
    KICK_WALL: 1716, // m3_kick_wall
    JUMP: 2461, // jump
    CLIMB_UNDER: 2452, // climb_under
    CLIMB_UP_SHELVES: 2997, // m3_climb_up_shelves
    CLIMB_DOWN_SHELVES: 2995, // m3_climb_down_shelves
    PUSH_WALL: 1719, // m3_push_wall
    TRAPDOOR_OPEN: 91, // trapdoor_open
    TIGHTROPE: 2495, // tightrope
    WALK_RUBBLE: 1722, // m3_walk_rubble
    SEARCH_JARS: 1720, // m3_search_jars
    LOCKED: 2402, // locked
    UNLOCK: 2419, // unlock
    DOOR_OPEN: 62, // door_open
    SNAPWOOD: 2107, // snapwood_1
    STAB: 2549, // stabsword_stab
    CHEST_OPEN: 52, // chest_open
    PLACE_SYMBOL: 1714, // m3_place_symbol
    DOWN_STAIRS: 1952, // down_stone_stairs
    UP_STAIRS: 1956, // up_stone_stairs
  });

  /** update_stat_v2's Agility field on every obstacle (t1231 ... t2703): the Wiki gives no value. */
  const OBSTACLE_XP = 5;
  /** Wiki (Darkness of Hallowvale): "the obstacles within Meiyerditch have an unboostable requirement of 25 Agility". */
  const OBSTACLE_AGILITY = 25;
  /** Wiki: "unhooking the latch in Meiyerditch has an unboostable requirement of 22 Thieving". */
  const LATCH_THIEVING = 22;
  const LANDINGS = Object.freeze({
    UNDER_FLOORBOARDS: [3588, 3173, 0], // t562
    ON_FLOORBOARDS: [3590, 3173, 1], // t6075
    FIXED_LADDER: [3630, 3240, 0], // t2635
    HIDEOUT: [3626, 9618, 0], // t2748
    HIDEOUT_SURFACE: [3638, 3249, 0], // t7302
  });
  /** Ours: the ghetto's bounds (the citizens', children's and vyrewatch' talks, the ghetto ladders). */
  const GHETTO = Object.freeze({ minX: 3580, maxX: 3650, minY: 3150, maxY: 3325 });
  const TRAPDOOR_RESET_TICKS = 10; // 2590 1 -> 0, t2748 -> t2758 and t7305 -> t7315

  const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping"; // MovementQueue.IGNORE_CLIPPING_FLAG
  const PASS_OPEN_TICKS = 2; // the locked door and the hideout wall are back two ticks later (t2439, t2733)

  /** Pass-throughs live opens for two ticks: the closed wall, and the inviswall + open leaf it becomes. */
  const PASS = Object.freeze({
    door: Object.freeze({ closed: [[LOC.LOCKED_DOOR, 3608, 3221, 0, 0, 2]],
      opened: [[LOC.INVISWALL, 3608, 3221, 0, 0, 2], [LOC.LOCKED_DOOR_OPEN, 3609, 3221, 0, 0, 3]],
      sides: [[3608, 3221, 0], [3609, 3221, 0]] }),
    hideout: Object.freeze({ closed: [[LOC.HIDEOUT_WALL, 3640, 3253, 0, 0, 3]],
      opened: [[LOC.INVISWALL, 3640, 3253, 0, 0, 3], [LOC.HIDEOUT_WALL_OPEN, 3640, 3252, 0, 0, 0]],
      sides: [[3640, 3253, 0], [3640, 3252, 0]] }),
  });

  /** Ladder rotations: the way off the ladder on its upper floor (the lower floor is the opposite side). */
  const LADDER_BACK = [[0, 1], [1, 0], [0, -1], [-1, 0]];

  // ---------------------------------------------------------------------------
  // Route data (../quests/data/darkness-of-hallowvale-route.json)
  // ---------------------------------------------------------------------------

  const key = (id, [x, y, z]) => `${id}:${x},${y},${z}`;
  const ROUTE_AT = new Map();
  const ROUTE_IDS = new Set();
  for (const entry of ROUTE) {
    if (!entry.at) continue;
    ROUTE_AT.set(key(entry.id, entry.at), entry);
    ROUTE_IDS.add(entry.id);
  }

  /** The route entry for a clicked loc: by its tile, else (one entry for the id) the only one. */
  function routeEntry(objectId, location) {
    if (!ROUTE_IDS.has(objectId)) return null;
    const tile = tileOf(location);
    if (tile) {
      const found = ROUTE_AT.get(key(objectId, [tile.x, tile.y, tile.z]));
      if (found) return found;
    }
    const all = ROUTE.filter((entry) => entry.id === objectId && entry.at);
    return all.length === 1 ? all[0] : null;
  }

  // ---------------------------------------------------------------------------
  // Words
  // ---------------------------------------------------------------------------

  const V = Object.freeze({
    FLOORBOARDS: "contact-with-the-sanguinesti-region-entering-the-wall",
    LOST: "contact-with-the-sanguinesti-region-attempting-to-start-the-route-to-the-sanguinesti-myreque-hideout",
    CITIZEN: "contact-with-the-sanguinesti-region-talking-to-a-meiyerditch-citizen",
    CITIZEN_QUIET: "contact-with-the-sanguinesti-region-talking-to-a-meiyerditch-citizen-after-quietly-asking-about-the-myreque",
    CITIZEN_INSIST: "contact-with-the-sanguinesti-region-talking-to-a-meiyerditch-citizen-after-insisting-to-meet-the-myreque",
    CITIZEN_AFTER: "standard-dialogue-after-darkness-of-hallowvale-meiyerditch", // "Meiyerditch citizen" page
    CHILD: "contact-with-the-sanguinesti-region-talking-to-a-child",
    VYREWATCH: "contact-with-the-sanguinesti-region-talking-to-a-vyrewatch",
    RAL: "contact-with-the-sanguinesti-region-talking-to-old-man-ral",
    RAL_AFTER: "standard-dialogue-after-darkness-of-hallowvale", // "Old Man Ral" page
    RAL_PAPYRUS: "close-encounters-with-vyre-kind-talking-to-old-man-ral-after-talking-to-safalaan-hallow",
    BROKEN_STAIRS: "keys-to-the-myreque-attempting-to-climb-the-broken-stairs-in-old-man-ral-s-house",
    TABLE_SEARCH: "keys-to-the-myreque-opening-the-tunnel-north-west-of-old-man-ral-s-house-searching-the-table",
    TABLE_OPEN: "keys-to-the-myreque-opening-the-tunnel-north-west-of-old-man-ral-s-house-opening-the-trapdoor-table",
    SHORTCUT_DOOR: "keys-to-the-myreque-attempting-to-open-the-door-with-a-shortcut-key-symbol-on-it",
    POTS: "keys-to-the-myreque-opening-the-locked-door-in-the-house-north-of-old-man-ral-searching-the-pots",
    UNLOCK: "keys-to-the-myreque-opening-the-locked-door-in-the-house-north-of-old-man-ral-unlocking-the-door",
    BROKEN_LADDER: "keys-to-the-myreque-repairing-the-ladder-in-the-house-north-west-of-ver-sinhaza-searching-the-broken-ladder",
    LADDER_WALL: "keys-to-the-myreque-repairing-the-ladder-in-the-house-north-west-of-ver-sinhaza-searching-the-wall-with-a-ladder-on-it-upstairs",
    LADDER_FIX: "keys-to-the-myreque-repairing-the-ladder-in-the-house-north-west-of-ver-sinhaza-searching-the-broken-ladder-while-holding-a-ladder-top",
    WALL_PUSH: "keys-to-the-myreque-gaining-access-to-the-sanguinesti-myreque-hideout-attempting-to-push-the-wall-guarding-the-hideout",
    WALL_KNIFE: "keys-to-the-myreque-gaining-access-to-the-sanguinesti-myreque-hideout-using-a-knife-on-the-wall",
    WALL_SICKLE: "keys-to-the-myreque-gaining-access-to-the-sanguinesti-myreque-hideout-using-a-silver-sickle-on-the-wall",
    WALL_SICKLE_B: "keys-to-the-myreque-gaining-access-to-the-sanguinesti-myreque-hideout-using-a-silver-sickle-b-on-the-wall",
  });
  const PAGES = Object.freeze({ CITIZEN: "Meiyerditch citizen", RAL: "Old Man Ral" });

  function variantSteps(page, variant) {
    return loadTranscripts(api)?.[page]?.variants?.[variant] ?? [];
  }

  /** The first step (depth first) of `steps` that passes `test`. */
  function findStep(steps, test) {
    if (!steps || typeof steps !== "object") return null;
    if (!Array.isArray(steps) && test(steps)) return steps;
    for (const value of Array.isArray(steps) ? steps : Object.values(steps)) {
      if (!value || typeof value !== "object") continue;
      const found = findStep(value, test);
      if (found) return found;
    }
    return null;
  }

  const textCache = new Map();
  /** A message step's text by its step id. */
  function words(variant, stepId) {
    const cacheKey = `${variant}#${stepId}`;
    if (!textCache.has(cacheKey)) {
      const step = findStep(variantSteps(PAGE, variant), (candidate) => candidate.id === stepId);
      textCache.set(cacheKey, typeof step?.text === "string" ? step.text : "");
    }
    return textCache.get(cacheKey);
  }

  const TEXT = {
    floorboardsWeak: () => words(V.FLOORBOARDS, "UDikGR"),
    kickPrompt: () => findStep(variantSteps(PAGE, V.FLOORBOARDS), (step) => step.type === "choice")?.prompt ?? "",
    lost: () => words(V.LOST, "jd3DrU"),
    brokenStairs: () => words(V.BROKEN_STAIRS, "OIfoyD"),
    tableSearch: () => words(V.TABLE_SEARCH, "-FmkNL"),
    tableOpen: () => words(V.TABLE_OPEN, "zW_lRH"),
    shortcutLocked: () => words(V.SHORTCUT_DOOR, "WtzgtG"),
    searchPots: () => words(V.POTS, "wyd9AX"),
    findKey: () => words(V.POTS, "b8QDbX"),
    unlock: () => words(V.UNLOCK, "K30GgU"),
    brokenLadder: () => words(V.BROKEN_LADDER, "5u2eEO"),
    searchWall: () => words(V.LADDER_WALL, "rFDrkL"),
    findLadderTop: () => words(V.LADDER_WALL, "g-pQ70"),
    fixLadder: () => words(V.LADDER_FIX, "cjSvUe"),
    wallPush: () => words(V.WALL_PUSH, "gzcVPB"),
    knifeReady: () => words(V.WALL_KNIFE, "c7l3d1"),
    knifeDone: () => words(V.WALL_KNIFE, "_CuGrg"),
    sickleReady: () => words(V.WALL_SICKLE, "2X5tV4"),
    sickleDone: () => words(V.WALL_SICKLE, "fSvLLe"),
    sickleBReady: () => words(V.WALL_SICKLE_B, "X-bX0o"),
    sickleBDone: () => words(V.WALL_SICKLE_B, "auHzRI"),
  };

  /** Game messages live sent that no transcript page holds (capture ticks). */
  const LIVE_TEXT = Object.freeze({
    kicked: "You kick the floorboards; they crack and eventually fall down.", // t559
    wrongSideThere: "You can't jump from here; you need to get closer to jump there.", // t1224 (18071 only)
    wrongSide: "You can't jump from here; you need to get closer to jump here.", // t2334, t2456, t2491, t2572, t2695
    climbUpShelves: "You climb up the shelves.", // t2476, t2558
    climbDownShelves: "You climb down the shelves.", // t2565
    washingLine: "You carefully cross the washing line.", // t2515
    doorLocked: "The door seems to be locked.", // t2435
    doorSwing: "You swing the door open.", // t2437
    climbDownLadder: "You climb down the ladder.", // t2634
    pushDoor: "You push the door to one side.", // t2731
    symbol: "You push the symbol in... You hear a click.", // t2737
    openTrapdoor: "You open the secret trapdoor.", // t2742
    climbTrapdoor: "You climb down through the trapdoor.", // t2745
    climbUpLadder: "You climb up the ladder.", // t7302
  });
  /** Ours: no capture or Wiki line for these refusals. */
  const OUR_TEXT = Object.freeze({
    agility: `You need an Agility level of at least ${OBSTACLE_AGILITY} to attempt this.`, // the Agility plugin's own refusal
    thieving: `You need a Thieving level of ${LATCH_THIEVING} to unhook the latch.`,
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const stage = (player) => state.stage(player);
  const complete = (player) => stage(player) >= STAGE.COMPLETE;
  const during = (player, from, until = STAGE.COMPLETE) => { const s = stage(player); return s >= from && s < until; };
  /** The route needs Ral's directions (65); after the quest it is open. */
  const routeKnown = (player) => stage(player) >= STAGE.ROUTE_KNOWN;
  const tileOf = (location) => location?.getX
    ? { x: location.getX(), y: location.getY(), z: location.getZ() }
    : location && Number.isInteger(location.x) ? { x: location.x, y: location.y, z: location.z ?? 0 } : null;
  const at = (player, [x, y, z]) => {
    const here = player.getLocation();
    return here.getX() === x && here.getY() === y && here.getZ() === z;
  };
  const loc = ([x, y, z]) => new Location(x, y, z);
  const chebyshev = (a, b) => Math.max(Math.abs(a.x - b[0]), Math.abs(a.y - b[1]));
  const inGhetto = (location) => {
    const tile = tileOf(location);
    return !!tile && tile.x >= GHETTO.minX && tile.x <= GHETTO.maxX && tile.y >= GHETTO.minY && tile.y <= GHETTO.maxY;
  };
  const npcIdOf = (event) => event.definition?.getId?.() ?? event.npc?.getCurrentDefinition?.(event.player)?.getId?.() ?? event.npcId;
  const ownsPage = (pages, ...names) => !Array.isArray(pages) || pages.some((entry) => names.includes(entry?.page));
  const busy = (player) => ObstacleRunner.isBusy(player);

  function definitionOf(player, objectId) {
    return core.ObjectDefinition.forPlayer(objectId, player) ?? core.ObjectDefinition.forId(objectId);
  }

  function optionOf(event) {
    if (typeof event.option === "string" && event.option) return event.option;
    const definition = event.definition ?? definitionOf(event.player, event.objectId);
    return definition?.getInteractions?.()?.[(event.clickType | 0) - 1] ?? "";
  }

  function giveXp(player) {
    player.getSkillManager().addExperiences(Skill.AGILITY, OBSTACLE_XP);
  }

  /** Ral's directions first ("You're pretty sure you'll get lost..."), then the Wiki's 25 Agility. */
  function mayUseObstacle(player, { agility = true } = {}) {
    if (!routeKnown(player)) {
      common.mesbox(player, TEXT.lost());
      return false;
    }
    if (agility && player.getSkillManager().getMaxLevel(Skill.AGILITY) < OBSTACLE_AGILITY) {
      common.message(player, OUR_TEXT.agility);
      return false;
    }
    return true;
  }

  /**
   * Live's exactmove form (t1229, t1265, t1305, t572): the player is placed on the far tile and slides
   * there from `from` (`d1`/`d2` client cycles), facing `dir`.
   */
  function slide(from, to, [d1, d2], dir) {
    return {
      run: ({ player }) => {
        const start = loc(from);
        player.moveTo(loc(to));
        player.setForceMovement(new core.ForceMovement(start, new Location(to[0] - from[0], to[1] - from[1]), d1, d2,
          { north: 0, east: 1, south: 2, west: 3 }[dir], -1));
      },
    };
  }

  const setVarbit = (varbit, value) => ({ run: ({ player }) => state.set(player, varbit, value) });

  /** Plays an obstacle; `xp` gives the Agility on its `complete` step. */
  function runObstacle(player, object, steps, { xp = false, agility = true, render = null } = {}) {
    ObstacleRunner.run({ player, object }, steps, {
      busyVarbit: true,
      agility,
      render,
      onFinish: (completed) => { if (completed && xp) giveXp(player); },
    });
    return true;
  }

  function directionTo(from, to) {
    const dx = to[0] - from[0], dy = to[1] - from[1];
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "east" : "west";
    return dy >= 0 ? "north" : "south";
  }

  // ---------------------------------------------------------------------------
  // The wall floorboards (18122 / 18124)
  // ---------------------------------------------------------------------------

  /** Search (t550-555): the messagebox, then "Kick them?". */
  function searchFloorboards(event) {
    if (event.objectId !== LOC.FLOORBOARDS || state.get(event.player, VARBIT.WALL_FLOORBOARDS) !== 0) return false;
    common.mesbox(event.player, TEXT.floorboardsWeak(), (p) => common.confirm(p, TEXT.kickPrompt(), kickFloorboards));
    return true;
  }

  /** Yes (t557): the stamp and the kick, then 2589 = 1 and the message two ticks on (t559). */
  function kickFloorboards(player) {
    player.getPacketSender().sendInterfaceRemoval();
    common.anim(player, SEQ.STAMP);
    common.sound(player, SOUND.KICK_WALL);
    common.later(player, 2, (p) => {
      state.set(p, VARBIT.WALL_FLOORBOARDS, 1);
      common.message(p, LIVE_TEXT.kicked);
    });
  }

  /** Climb-down (t561-562) and the underboards' Climb-up (t6074-6075): the animation, the move a tick on. */
  function floorboardsClimb(event) {
    const { player, objectId } = event;
    if (state.get(player, VARBIT.WALL_FLOORBOARDS) !== 1 || busy(player)) return false;
    if (objectId === LOC.FLOORBOARDS) {
      return runObstacle(player, event.object, [{ anim: SEQ.PICKUP_FLOOR }, { wait: 1 }, { tele: LANDINGS.UNDER_FLOORBOARDS }],
        { agility: false });
    }
    if (objectId === LOC.UNDERBOARDS) {
      return runObstacle(player, event.object, [{ anim: SEQ.REACH_LADDER }, { wait: 1 }, { tele: LANDINGS.ON_FLOORBOARDS }],
        { agility: false });
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // The rooftop route's obstacles
  // ---------------------------------------------------------------------------

  /**
   * A floorboard jump, from its take-off tile only (t1224: "You can't jump from here..."). Two tiles
   * (t1229): exactmove 58/70, human_steppingstonejump 769 (30 in), jump 2461 (64 in), the xp two ticks
   * on; three tiles (t2377): 60/85, myq3_double_square_jump 4721, the xp four ticks on.
   */
  function jump(event) {
    const { player } = event;
    const entry = routeEntry(event.objectId, event.location);
    if (entry?.kind !== "jump" || busy(player)) return entry?.kind === "jump";
    if (!mayUseObstacle(player)) return true;
    if (!at(player, entry.from)) {
      common.message(player, entry.id === 18071 ? LIVE_TEXT.wrongSideThere : LIVE_TEXT.wrongSide);
      return true;
    }
    const steps = entry.long
      ? [slide(entry.from, entry.to, [60, 85], entry.dir), { anim: SEQ.DOUBLE_JUMP, delay: 30 }, { sound: SOUND.JUMP, delay: 64 }, { wait: 4 }]
      : [slide(entry.from, entry.to, [58, 70], entry.dir), { anim: SEQ.STEPPING_JUMP, delay: 30 }, { sound: SOUND.JUMP, delay: 64 }, { wait: 2 }];
    return runObstacle(player, event.object, [...steps, { complete: true }], { xp: true });
  }

  /** A crawl (t1264-1267): human_pickupfloor, a tick on the crawl (6/20, 844, climb_under), the xp two ticks later. */
  function crawl(event) {
    const { player } = event;
    const entry = routeEntry(event.objectId, event.location);
    if (entry?.kind !== "crawl") return false;
    if (busy(player)) return true;
    if (!mayUseObstacle(player)) return true;
    const [a, b] = entry.ends;
    const from = at(player, a) ? a : at(player, b) ? b : null;
    if (!from) return true;
    const to = from === a ? b : a;
    return runObstacle(player, event.object, [
      { anim: SEQ.PICKUP_FLOOR }, { wait: 1 },
      slide(from, to, [6, 20], directionTo(from, to)), { anim: SEQ.CRAWLING }, { sound: SOUND.CLIMB_UNDER },
      { wait: 2 }, { anim: -1 }, { complete: true },
    ], { xp: true });
  }

  /**
   * Shelves. Up (t2307-2315): stood on the shelf, myq3_shelf_climb 4722 (5 in) and m3_climb_up_shelves,
   * the move, the xp and (sector two) "You climb up the shelves." 8 ticks on. Down (t2345-2347,
   * t2564-2565): human_pickupfloor and m3_climb_down_shelves, the move a tick or two on.
   */
  function shelf(event) {
    const { player } = event;
    const entry = routeEntry(event.objectId, event.location);
    if (entry?.kind !== "shelf-up" && entry?.kind !== "shelf-down") return false;
    if (busy(player)) return true;
    if (!mayUseObstacle(player)) return true;
    if (!at(player, entry.from)) return true;
    const up = entry.kind === "shelf-up";
    const message = entry.message ? [{ msg: up ? LIVE_TEXT.climbUpShelves : LIVE_TEXT.climbDownShelves }] : [];
    const start = up
      ? [{ anim: SEQ.SHELF_CLIMB, delay: 5 }, { sound: SOUND.CLIMB_UP_SHELVES }]
      : [{ anim: SEQ.PICKUP_FLOOR }, { sound: SOUND.CLIMB_DOWN_SHELVES }];
    return runObstacle(player, event.object, [
      ...start, { wait: entry.ticks }, ...message, { tele: entry.to }, { anim: -1 }, { complete: true },
    ], { xp: true });
  }

  /**
   * A push wall (t1249-1252): human_push 810 and m3_push_wall, a tick on its varbit 1 and the wall's
   * fall (loc_anim 4744/4745), a tick later 2 (the wall gone, the floor across shown). No xp.
   */
  function pushWall(event) {
    const { player } = event;
    const entry = routeEntry(event.objectId, event.location);
    if (entry?.kind !== "pushwall") return false;
    if (busy(player) || state.get(player, entry.varbit) !== 0) return true;
    if (!mayUseObstacle(player)) return true;
    return runObstacle(player, event.object, [
      { anim: SEQ.PUSH }, { sound: SOUND.PUSH_WALL }, { wait: 1 },
      setVarbit(entry.varbit, 1), { objAnim: entry.anim }, { wait: 1 },
      setVarbit(entry.varbit, 2),
    ], { agility: false });
  }

  /** The floor a push wall opens (t1257-1259): two tiles at once, then the last a couple of ticks later. */
  function walkAcrossFloor(event) {
    const { player } = event;
    const entry = routeEntry(event.objectId, event.location);
    if (entry?.kind !== "floor") return false;
    if (busy(player)) return true;
    if (!at(player, entry.from)) return true;
    const [first, second, last] = entry.path;
    return runObstacle(player, event.object, [
      { walk: [first, second], tilesPerTick: 2, arrive: true }, { wait: 2 }, { walk: [last], arrive: true },
    ], { agility: false });
  }

  /**
   * The washing line (t2515-2524): the message, tightrope 2495 looping 5 times, the balance walk, two
   * tiles every three ticks, and the xp as the walk ends.
   */
  function washingLine(event) {
    const { player } = event;
    const entry = routeEntry(event.objectId, event.location);
    if (entry?.kind !== "tightrope") return false;
    if (busy(player)) return true;
    if (!mayUseObstacle(player)) return true;
    if (!at(player, entry.from)) return true;
    const steps = [{ msg: LIVE_TEXT.washingLine }, { sound: SOUND.TIGHTROPE, loops: 5 }];
    for (const tile of entry.path) steps.push({ walk: [tile], tilesPerTick: 2, traversalType: 1, arrive: true }, { wait: 3 });
    steps.push({ complete: true });
    return runObstacle(player, event.object, steps, { xp: true, render: SEQ.BALANCE_WALK });
  }

  /**
   * The table tunnel (18083 at 2597 = 2; t1305-1314): into the hole (0/50, 2589, climb_under), along
   * (0/100, 2590) two ticks on, out (15/33, 2591) three ticks later, the xp four ticks after that.
   */
  function tunnel(event) {
    const { player } = event;
    const entry = routeEntry(event.objectId, event.location);
    if (entry?.kind !== "tunnel") return false;
    if (busy(player)) return true;
    if (!mayUseObstacle(player)) return true;
    if (!at(player, entry.from)) return true;
    const [enter, along, out] = entry.legs;
    return runObstacle(player, event.object, [
      slide(entry.from, enter, [0, 50], entry.dir), { anim: SEQ.ENTER_HOLE }, { sound: SOUND.CLIMB_UNDER }, { wait: 2 },
      slide(enter, along, [0, 100], entry.dir), { anim: SEQ.TUNNEL_WALK }, { wait: 3 },
      slide(along, out, [15, 33], entry.dir), { anim: SEQ.EXIT_HOLE }, { wait: 4 },
      { complete: true },
    ], { xp: true });
  }

  /**
   * The breached wall (t572-584): onto plane 1 over the first half (18/108, 4723, m3_walk_rubble), six
   * ticks on the second (145/168, 4724, m3_walk_rubble and jump 140 in), six later down to plane 0.
   */
  function climbRubble(event) {
    const { player } = event;
    const entry = routeEntry(event.objectId, event.location);
    if (entry?.kind !== "rubble") return false;
    if (busy(player)) return true;
    if (!at(player, entry.from)) return true;
    const [vx, vy, vz] = entry.via;
    const far = [entry.to[0], entry.to[1], vz];
    return runObstacle(player, event.object, [
      slide([entry.from[0], entry.from[1], vz], [vx, vy, vz], [18, 108], entry.dir), { anim: SEQ.RUBBLE_FIRST },
      { sound: SOUND.WALK_RUBBLE }, { wait: 6 },
      slide([vx, vy, vz], far, [145, 168], entry.dir), { anim: SEQ.RUBBLE_SECOND }, { sound: SOUND.WALK_RUBBLE },
      { sound: SOUND.JUMP, delay: 140 }, { wait: 6 },
      { tele: entry.to },
    ], { agility: false });
  }

  /** The table over the tunnel (t1289-1301): Search finds the trapdoor (2597 = 1), Open opens it (2). */
  function table(event) {
    const { player } = event;
    if (event.objectId !== LOC.TABLE && event.objectId !== LOC.TABLE_2) return false;
    if (busy(player)) return true;
    if (!mayUseObstacle(player, { agility: false })) return true;
    const found = state.get(player, VARBIT.TABLE_TRAPDOOR);
    if (found === 0) {
      return runObstacle(player, event.object, [
        { anim: SEQ.PICKUP_TABLE }, { wait: 2 }, setVarbit(VARBIT.TABLE_TRAPDOOR, 1), { msg: TEXT.tableSearch() },
      ], { agility: false });
    }
    if (found === 1) {
      return runObstacle(player, event.object, [
        { anim: SEQ.PICKUP_FLOOR }, { wait: 2 }, setVarbit(VARBIT.TABLE_TRAPDOOR, 2), { msg: TEXT.tableOpen() },
        { sound: SOUND.TRAPDOOR_OPEN },
      ], { agility: false });
    }
    return false;
  }

  /** Old Man Ral's broken stairs: the Wiki's box (ours: no capture). */
  function brokenStairs(player) {
    common.mesbox(player, TEXT.brokenStairs());
    return true;
  }

  // ---------------------------------------------------------------------------
  // The pots, the locked door (2578) and the ladder top (2598)
  // ---------------------------------------------------------------------------

  /** The pots (t2429-2431): human_pickupfloor, m3_search_jars and the message, the key two ticks on. */
  function searchPots(event) {
    const { player } = event;
    if (event.objectId !== LOC.POTS || !routeKnown(player)) return false;
    if (busy(player)) return true;
    common.anim(player, SEQ.PICKUP_FLOOR);
    common.sound(player, SOUND.SEARCH_JARS);
    common.message(player, TEXT.searchPots());
    // Ours: no second key once the door is unlocked or while one is carried.
    if (state.get(player, VARBIT.GHETTO_DOOR) !== 0 || common.held(player, ITEM.DOOR_KEY) || common.freeSlots(player) <= 0) return true;
    common.later(player, 2, (p) => {
      if (state.get(p, VARBIT.GHETTO_DOOR) !== 0 || common.held(p, ITEM.DOOR_KEY) || common.freeSlots(p) <= 0) return;
      p.getInventory().add(new core.Item(ITEM.DOOR_KEY, 1));
      common.itemBox(p, ITEM.DOOR_KEY, TEXT.findKey());
    });
    return true;
  }

  /**
   * The ghetto's locked door (t2433-2439), one click with the key: "The door seems to be locked.", 2578 = 1,
   * the key gone, locked and unlock, the key's box; on its continue "You swing the door open." and the
   * two-tick pass-through. Unlocked, every Open is the pass-through.
   */
  function lockedDoor(player) {
    if (state.get(player, VARBIT.GHETTO_DOOR) === 1) {
      swingDoor(player);
      return true;
    }
    common.message(player, LIVE_TEXT.doorLocked);
    if (!common.held(player, ITEM.DOOR_KEY)) return true;
    state.set(player, VARBIT.GHETTO_DOOR, 1);
    player.getInventory().delete(ITEM.DOOR_KEY, 1);
    common.sound(player, SOUND.LOCKED);
    common.sound(player, SOUND.UNLOCK);
    common.itemBox(player, ITEM.DOOR_KEY, TEXT.unlock(), swingDoor);
    return true;
  }

  function swingDoor(player) {
    common.message(player, LIVE_TEXT.doorSwing);
    passThrough(player, PASS.door);
  }

  /** The wall above the broken ladder (t2614-2619): the message, 2598 = 1, human_pickuptable, the top and its box. */
  function searchLadderWall(event) {
    const { player } = event;
    if (event.objectId !== LOC.LADDER_WALL || !routeKnown(player)) return false;
    common.message(player, TEXT.searchWall());
    // Ours: the emptied wall (18067) and a full pack only give the message.
    if (definitionOf(player, event.objectId)?.id !== TRANSFORM.WALL_FULL || common.freeSlots(player) <= 0) return true;
    state.set(player, VARBIT.LADDERTOP_WALL, 1);
    common.anim(player, SEQ.PICKUP_TABLE);
    player.getInventory().add(new core.Item(ITEM.LADDER_TOP, 1));
    common.itemBox(player, ITEM.LADDER_TOP, TEXT.findLadderTop());
    return true;
  }

  /**
   * A destroyed ladder top (Ours: not captured) puts it back in the wall while the ladder is still broken,
   * so the route can't be lost; one held or banked elsewhere is left alone.
   */
  function ladderTopDestroyed({ player, itemId }) {
    if (!player || itemId !== ITEM.LADDER_TOP || state.get(player, VARBIT.LADDERTOP_WALL) !== 1) return;
    if (core.Bank.owns(player, ITEM.LADDER_TOP)) return;
    state.set(player, VARBIT.LADDERTOP_WALL, 0);
  }

  /** The broken ladder with the top (t2631-2632): human_pickupfloor and snapwood, a tick on 2598 = 2 and the box. */
  function searchBrokenLadder(event) {
    const { player } = event;
    if (event.objectId !== LOC.LADDER_FLOOR || !routeKnown(player)) return false;
    if (!common.held(player, ITEM.LADDER_TOP)) {
      common.mesbox(player, TEXT.brokenLadder());
      return true;
    }
    common.anim(player, SEQ.PICKUP_FLOOR);
    common.sound(player, SOUND.SNAPWOOD);
    common.later(player, 1, (p) => {
      if (!common.held(p, ITEM.LADDER_TOP)) return;
      p.getInventory().delete(ITEM.LADDER_TOP, 1);
      state.set(p, VARBIT.LADDERTOP_WALL, 2);
      common.itemBox(p, ITEM.LADDER_TOP, TEXT.fixLadder());
    });
    return true;
  }

  /** The mended ladder (t2634-2635): "You climb down the ladder." and the climb to 3630,3240,0. */
  function climbFixedLadder(player) {
    common.message(player, LIVE_TEXT.climbDownLadder);
    api.emitCustomEvent("ladders:climbDown", { player, destination: loc(LANDINGS.FIXED_LADDER) });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Pass-throughs (the locked door, the hideout wall)
  // ---------------------------------------------------------------------------

  const passOpen = new Set();

  function passLoc([id, x, y, z, type, face]) {
    return new core.GameObject(id, new Location(x, y, z), type, face, null);
  }

  function swapLocs(remove, add) {
    for (const leaf of remove) core.ObjectManager.deregister(passLoc(leaf), true);
    for (const leaf of add) core.ObjectManager.register(passLoc(leaf), true);
  }

  /** Players stepping through: whether they had the clipping flag before (restored once across). */
  const steppingThrough = new WeakMap();

  function endStep(player) {
    if (!steppingThrough.has(player)) return;
    if (!steppingThrough.get(player)) player.removeFlag?.(IGNORE_CLIPPING_FLAG);
    steppingThrough.delete(player);
  }

  /** The opener's one step to the other side, over the inviswall (t2437, t2731). */
  function stepThrough(player, pass) {
    endStep(player);
    const [a, b] = pass.sides;
    const destination = at(player, a) ? b : a;
    steppingThrough.set(player, player.hasFlag?.(IGNORE_CLIPPING_FLAG) === true);
    player.setFlag?.(IGNORE_CLIPPING_FLAG, true);
    const queue = player.getMovementQueue();
    queue.reset();
    queue.addSteps(loc(destination));
    let ticks = PASS_OPEN_TICKS + 1;
    const task = new core.Task(1, false);
    task.execute = () => {
      if (at(player, destination) || --ticks <= 0 || (queue.size?.() ?? 0) === 0 || player.isRegistered?.() === false) {
        task.stop();
        endStep(player);
      }
    };
    core.TaskManager.submit(task);
  }

  /** The two-tick opening: inviswall in the doorway and the open leaf beside it, door_open, the step through. */
  function passThrough(player, pass) {
    const name = pass === PASS.door ? "door" : "hideout";
    if (!passOpen.has(name)) {
      passOpen.add(name);
      swapLocs(pass.closed, pass.opened);
      core.TaskManager.submit(new core.CountdownTask({ pass: `darkness-of-hallowvale:${name}` }, PASS_OPEN_TICKS, () => {
        swapLocs(pass.opened, pass.closed);
        passOpen.delete(name);
      }));
    }
    common.sound(player, SOUND.DOOR_OPEN);
    stepThrough(player, pass);
  }

  // ---------------------------------------------------------------------------
  // The hideout: wall and latch (70), symbol, rug and trapdoor (2590, 80), ladder, shortcut door
  // ---------------------------------------------------------------------------

  /** Push (t2712-2715 before the latch; t2731 after): the latch's box, or the wall's two-tick opening. */
  function pushHideoutWall(event) {
    const { player } = event;
    if (event.objectId !== LOC.HIDEOUT_WALL) return false;
    if (stage(player) < STAGE.LATCH_UNHOOKED) {
      common.mesbox(player, TEXT.wallPush());
      return true;
    }
    common.message(player, LIVE_TEXT.pushDoor);
    passThrough(player, PASS.hideout);
    return true;
  }

  /**
   * A knife on the wall (t2724-2729): the knife's box; on its continue human_pickuptable and
   * stabsword_stab a tick on, and 70, chest_open and the second box three ticks after the continue.
   * The silver sickles say their own lines (the Wiki's).
   */
  function bladeOnWall(event) {
    const { player, itemId } = event;
    if (event.objectId !== LOC.HIDEOUT_WALL || !during(player, STAGE.ROUTE_KNOWN, STAGE.LATCH_UNHOOKED)) return false;
    if (player.getSkillManager().getMaxLevel(Skill.THIEVING) < LATCH_THIEVING) {
      common.message(player, OUR_TEXT.thieving);
      return true;
    }
    const [ready, done] = itemId === ITEM.SICKLE ? [TEXT.sickleReady(), TEXT.sickleDone()]
      : itemId === ITEM.SICKLE_B ? [TEXT.sickleBReady(), TEXT.sickleBDone()] : [TEXT.knifeReady(), TEXT.knifeDone()];
    common.itemBox(player, itemId, ready, (p) => {
      p.getPacketSender().sendInterfaceRemoval();
      common.later(p, 1, (q) => {
        common.anim(q, SEQ.PICKUP_TABLE);
        common.sound(q, SOUND.STAB);
      });
      common.later(p, 3, (q) => {
        state.advance(q, STAGE.LATCH_UNHOOKED);
        common.sound(q, SOUND.CHEST_OPEN);
        common.itemBox(q, itemId, done);
      });
    });
    return true;
  }

  /** The symbol (t2736-2737): human_pickuptable, the button's loc_anim and m3_place_symbol, a tick on the click and 2590 = 1. */
  function pressSymbol(event) {
    const { player } = event;
    if (event.objectId !== LOC.SYMBOL || stage(player) < STAGE.LATCH_UNHOOKED) return false;
    if (busy(player)) return true;
    return runObstacle(player, event.object, [
      { anim: SEQ.PICKUP_TABLE }, { objAnim: SEQ.WALL_BUTTON }, { sound: SOUND.PLACE_SYMBOL }, { wait: 1 },
      { msg: LIVE_TEXT.symbol }, setVarbit(VARBIT.HIDEOUT_TRAPDOOR, 1),
    ], { agility: false });
  }

  /** The lumpy rug (t2742): "You open the secret trapdoor.", 2590 = 2 and trapdoor_open, no animation. */
  function openRug(event) {
    const { player } = event;
    if (event.objectId !== LOC.RUG || state.get(player, VARBIT.HIDEOUT_TRAPDOOR) !== 1) return false;
    common.later(player, 1, (p) => {
      if (state.get(p, VARBIT.HIDEOUT_TRAPDOOR) !== 1) return;
      common.message(p, LIVE_TEXT.openTrapdoor);
      state.set(p, VARBIT.HIDEOUT_TRAPDOOR, 2);
      common.sound(p, SOUND.TRAPDOOR_OPEN);
    });
    return true;
  }

  /** Ours: the open trapdoor's Close puts the rug back over it (not captured). */
  function closeTrapdoor(player) {
    state.set(player, VARBIT.HIDEOUT_TRAPDOOR, 1);
    return true;
  }

  /**
   * Down the trapdoor (t2745-2758): the message, human_pickupfloor and the fade out; three ticks on 80
   * (the first time), 2590 = 1, the hideout at 3626,9618,0, down_stone_stairs and the fade in; ten
   * ticks after that 2590 = 0, so the symbol is pressed again on every entry.
   */
  function climbTrapdoor(player) {
    if (busy(player)) return true;
    runObstacle(player, null, [
      { msg: LIVE_TEXT.climbTrapdoor }, { anim: SEQ.PICKUP_FLOOR }, { fade: "out" }, { wait: 3 },
      { run: ({ player: p }) => { state.advance(p, STAGE.IN_HIDEOUT); state.set(p, VARBIT.HIDEOUT_TRAPDOOR, 1); } },
      { tele: LANDINGS.HIDEOUT }, { sound: SOUND.DOWN_STAIRS }, { fade: "in" }, { wait: 2 },
    ], { agility: false });
    common.later(player, 3 + TRAPDOOR_RESET_TICKS, (p) => state.set(p, VARBIT.HIDEOUT_TRAPDOOR, 0));
    return true;
  }

  /**
   * Up the hideout ladder (t7298-7315): 2590 = 2 (the trapdoor shows open above), human_reachforladder
   * and the fade out; up_stone_stairs three ticks on, a tick later the room at 3638,3249,0 with "You climb
   * up the ladder." and the fade in; 2590 = 1 three ticks after that and 0 ten ticks later.
   */
  function climbHideoutLadder(player) {
    if (busy(player)) return true;
    runObstacle(player, null, [
      setVarbit(VARBIT.HIDEOUT_TRAPDOOR, 2), { anim: SEQ.REACH_LADDER }, { fade: "out" }, { wait: 3 },
      { sound: SOUND.UP_STAIRS }, { wait: 1 },
      { tele: LANDINGS.HIDEOUT_SURFACE }, { msg: LIVE_TEXT.climbUpLadder }, { fade: "in" }, { wait: 3 },
      setVarbit(VARBIT.HIDEOUT_TRAPDOOR, 1),
    ], { agility: false });
    common.later(player, 7 + TRAPDOOR_RESET_TICKS, (p) => state.set(p, VARBIT.HIDEOUT_TRAPDOOR, 0));
    return true;
  }

  /** The shortcut doors (t7323): the messagebox, and locked on its continue. Ours: they stay shut until the quest is done. */
  function shortcutDoor(player) {
    common.mesbox(player, TEXT.shortcutLocked(), (p) => common.sound(p, SOUND.LOCKED));
    return true;
  }

  // ---------------------------------------------------------------------------
  // Ghetto ladders and stairs
  // ---------------------------------------------------------------------------

  /** A ghetto ladder's far end: up to the side its rotation faces, down to the opposite side (t1216-1217, t1286-1287). */
  function ladderDestination(object, up) {
    const tile = tileOf(object?.getLocation?.());
    if (!tile) return null;
    const [dx, dy] = LADDER_BACK[(object.getFace?.() ?? 0) & 3];
    return up ? new Location(tile.x + dx, tile.y + dy, tile.z + 1) : new Location(tile.x - dx, tile.y - dy, tile.z - 1);
  }

  function climbGhettoLadder(player, object, up) {
    const destination = ladderDestination(object, up);
    if (!destination || destination.getZ() < 0 || destination.getZ() > 3) return false;
    api.emitCustomEvent(up ? "ladders:climbUp" : "ladders:climbDown", { player, destination });
    return true;
  }

  /** Stairs are walked, without an animation (t2703-2708). */
  function climbStairs(player, object, objectId) {
    const entry = routeEntry(objectId, object?.getLocation?.());
    if (entry?.kind !== "stairs") return false;
    api.emitCustomEvent(objectId === LOC.STAIRS_UP ? "ladders:climbUp" : "ladders:climbDown",
      { player, destination: loc(entry.to), animate: false });
    return true;
  }

  /** Every climb this unit owns, whether Ladders asks (ladders:climb) or the hook below gets it. */
  function climbOwned(player, object, objectId, option) {
    if (!player || !object) return false;
    if (objectId === LOC.LADDER_UP || objectId === LOC.LADDER_DOWN) {
      return inGhetto(object.getLocation()) && climbGhettoLadder(player, object, objectId === LOC.LADDER_UP);
    }
    if (objectId === LOC.STAIRS_UP || objectId === LOC.STAIRS_DOWN) return climbStairs(player, object, objectId);
    if (objectId === LOC.BROKEN_STAIRS_UP || objectId === LOC.BROKEN_STAIRS_DOWN) return brokenStairs(player);
    if (objectId === LOC.HIDEOUT_LADDER) return climbHideoutLadder(player);
    const definition = definitionOf(player, objectId);
    if (objectId === LOC.LADDER_FLOOR && definition?.id === TRANSFORM.FIXED_LADDER) return climbFixedLadder(player);
    if (objectId === LOC.RUG && definition?.id === TRANSFORM.TRAPDOOR_OPEN) {
      return option === "Close" ? closeTrapdoor(player) : climbTrapdoor(player);
    }
    return false;
  }

  /** Ladders asks first for every ladder, staircase and trapdoor. */
  function claimClimb(request) {
    if (request.handled || !request.player) return;
    const option = definitionOf(request.player, request.objectId)?.getInteractions?.()?.[(request.clickType | 0) - 1] ?? "";
    if (climbOwned(request.player, request.object, request.objectId, option)) request.handled = true;
  }

  function climbHook(event) {
    return climbOwned(event.player, event.object, event.objectId, optionOf(event));
  }

  /** Doors asks first for the locked door, the shortcut doors and the trapdoor's Close. */
  function claimDoor(request) {
    if (request.handled || !request.player) return;
    if (doorOwned(request.player, request.objectId, optionOf(request))) request.handled = true;
  }

  function doorOwned(player, objectId, option) {
    if (objectId === LOC.LOCKED_DOOR) return lockedDoor(player);
    if (objectId === LOC.SHORTCUT_DOOR && !complete(player)) return shortcutDoor(player);
    if (objectId === LOC.RUG && option === "Close" && definitionOf(player, objectId)?.id === TRANSFORM.TRAPDOOR_OPEN) {
      return closeTrapdoor(player);
    }
    return false;
  }

  function doorHook(event) {
    return doorOwned(event.player, event.objectId, optionOf(event));
  }

  // ---------------------------------------------------------------------------
  // Routes: obstacles are used from their take-off tile (t1233: the walk to 3599,3200 for 18072)
  // ---------------------------------------------------------------------------

  /**
   * The tile a click walks to. A jump clicked from the far side (nearer its landing than its take-off)
   * walks to it as usual and is refused there (t1219-1224).
   */
  function routeObstacle(event) {
    if (event.destination) return;
    const object = event.object;
    const entry = routeEntry(event.objectId, object?.getLocation?.());
    if (!entry || !entry.from) return;
    const source = event.sourceLocation;
    switch (entry.kind) {
      case "jump":
        if (chebyshev(source, entry.from) > chebyshev(source, entry.at)) return;
        break;
      case "shelf-up": case "shelf-down": case "pushwall": case "floor": case "tightrope": case "tunnel": case "rubble":
        break;
      default:
        return;
    }
    if (source.z !== entry.from[2]) return;
    event.destination = { x: entry.from[0], y: entry.from[1], z: entry.from[2] };
  }

  // ---------------------------------------------------------------------------
  // The citizens (52, 54, 60), the children and the vyrewatch
  // ---------------------------------------------------------------------------

  const OPTION = Object.freeze({
    WHAT: "What do you do here?",
    MYREQUE: "Do you know about the Myreque?",
    OF_MYREQUE: "Do you know of the Myreque?",
    WHISPER: "(whisper) Do you know about the Myreque?",
    INSIST: "(whisper) I really need to meet the Myreque.",
    INTRODUCE: "Can you introduce me to Old Man Ral?",
    HOW_RAL: "How can Old Man Ral help me?",
    MORE: "- More questions -",
  });
  const LINE = Object.freeze({
    WHISPERED: "Yes... but I really can't talk about them.", // t603: 52 on its continue
    INSISTED: "I understand, but you may not like what you find.", // t736: 54 as it shows
    ROUTE: "Hmph. Myreque, eh?", // t1158: 65 as it shows
    SECTOR: "[one/two/three/four/five/six]",
  });

  let citizen = null;

  /**
   * One conversation, with a menu that follows the stage as live's does (t596, t603, t767, t777): the
   * whisper (50), "after quietly asking" (52), "after insisting" (54) and, from 60, the citizens' own
   * standard menu. Each answer comes back to this menu ("shows other options").
   */
  function citizenConversation() {
    if (citizen) return citizen;
    const base = variantSteps(PAGE, V.CITIZEN);
    const menuOf = (steps) => steps.find((step) => step?.type === "choice") ?? { options: [] };
    const baseMenu = menuOf(base), quiet = menuOf(variantSteps(PAGE, V.CITIZEN_QUIET));
    const insist = menuOf(variantSteps(PAGE, V.CITIZEN_INSIST)), after = menuOf(variantSteps(PAGES.CITIZEN, V.CITIZEN_AFTER));
    const option = (menu, text) => menu.options.find((entry) => entry.text === text);
    const back = { type: "jump", reference: "other" };
    const spoken = (steps) => (steps ?? []).filter((step) => step?.type !== "jump" && step?.type !== "unavailable");
    const ownWhat = option(baseMenu, OPTION.WHAT), ownMore = option(baseMenu, OPTION.MORE);
    const answered = (entry) => ({ ...entry, steps: [...spoken(entry.steps), back] });
    const atFifty = baseMenu.options.map((entry) => entry.text === OPTION.WHISPER ? answered(entry) : entry);
    const reuse = (entry) => entry.text === OPTION.WHAT ? ownWhat : entry.text === OPTION.MORE ? ownMore : null;
    const atFiftyTwo = quiet.options.map((entry) => reuse(entry)
      // "(jump above)": the plain question's answer (live answers it otherwise, see the unit's report).
      ?? (entry.text === OPTION.OF_MYREQUE ? { text: entry.text, steps: option(baseMenu, OPTION.MYREQUE)?.steps ?? [] }
        : entry.text === OPTION.INSIST ? answered(entry) : entry));
    const atFiftyFour = insist.options.map((entry) => reuse(entry)
      // The dump lost the player's line here (unavailable): the player says the option, as live (t773).
      ?? (entry.text === OPTION.INTRODUCE ? { ...entry, steps: [{ player: entry.text }, ...spoken(entry.steps), back] } : entry));
    const top = { type: "choice", prompt: baseMenu.prompt ?? "", options: atFifty };
    citizen = {
      greeting: base.find((step) => step?.type === "random"),
      top,
      signature: signature(atFifty),
      menus: [[STAGE.RAL_INTRODUCED, after.options], [STAGE.INSISTED, atFiftyFour], [STAGE.WHISPERED, atFiftyTwo], [0, atFifty]],
    };
    return citizen;
  }

  function citizenMenu(player) {
    const s = stage(player);
    return citizenConversation().menus.find(([from]) => s >= from)[1];
  }

  function talkCitizen(event) {
    const { player } = event;
    if (!during(player, STAGE.ARRIVED) || !inGhetto(event.npc?.getLocation?.() ?? player.getLocation())) return false;
    const npcId = npcIdOf(event);
    if (stage(player) >= STAGE.RAL_INTRODUCED) {
      return common.play(player, npcId, V.CITIZEN_AFTER, null, PAGES.CITIZEN, event.npc);
    }
    const { greeting, top } = citizenConversation();
    return common.play(player, npcId, V.CITIZEN, () => [greeting, top], PAGE, event.npc);
  }

  const signature = (options) => (Array.isArray(options) ? options : []).map((entry) => entry?.text ?? "").join("|");

  /** The citizens' menu (known by its whisper options; the runtime may copy the steps), redrawn each time it shows. */
  function shapeMenu(notice) {
    if (!notice.player || !citizen || signature(notice.options) !== citizen.signature) return;
    notice.options = citizenMenu(notice.player);
  }

  /** 60 on choosing "Can you introduce me to Old Man Ral?" (t773); ours: "How can Old Man Ral help me?" too. */
  function onChoice(choice) {
    const { player } = choice;
    if (!player || !ownsPage(choice.pages, PAGE) || stage(player) !== STAGE.INSISTED) return;
    if (choice.option === OPTION.INTRODUCE || choice.option === OPTION.HOW_RAL) state.advance(player, STAGE.RAL_INTRODUCED);
  }

  function talkChild(event) {
    const { player } = event;
    if (!during(player, STAGE.ARRIVED) || !inGhetto(event.npc?.getLocation?.() ?? player.getLocation())) return false;
    return common.play(player, npcIdOf(event), V.CHILD, null, PAGE, event.npc);
  }

  /**
   * Talk-to on a vyrewatch while contact is made: the quest page's "Hello?" lines (Wiki). From the
   * hideout on (80), and any vyrewatch that has stopped the player, Talk-to is the Hassle unit's.
   */
  function talkVyrewatch(event) {
    const { player } = event;
    if (!during(player, STAGE.ARRIVED, STAGE.IN_HIDEOUT) || !inGhetto(event.npc?.getLocation?.() ?? player.getLocation())) return false;
    if (state.get(player, VARBIT.VAMP_HASSLE) !== 0) return false;
    return common.play(player, npcIdOf(event), V.VYREWATCH, null, PAGE, event.npc);
  }

  // ---------------------------------------------------------------------------
  // Old Man Ral (65)
  // ---------------------------------------------------------------------------

  const sketching = (player) => during(player, STAGE.SKETCHING) && state.get(player, VARBIT.SKETCHES_GIVEN) === 0;

  /**
   * 50-64 the quest page's talk (t847-1170); from 65 his own page's "Hello again!" (t1181); while the
   * sketches are made (200 on), the post-Safalaan talk, whose papyrus steps the Sketches unit answers.
   */
  function talkRal(event) {
    const { player } = event;
    if (!during(player, STAGE.ARRIVED)) return false;
    const npcId = npcIdOf(event);
    if (stage(player) < STAGE.ROUTE_KNOWN) return common.play(player, npcId, V.RAL, null, PAGE, event.npc);
    if (sketching(player)) {
      return common.play(player, npcId, V.RAL_PAPYRUS, papyrusTalk, PAGE, event.npc);
    }
    return common.play(player, npcId, V.RAL_AFTER, null, PAGES.RAL, event.npc);
  }

  /**
   * The papyrus talk's menu: "(Same as standard dialogue)" is his standard answer, and "(Shows standard
   * options)" his standard menu (the runtime would end the talk at either).
   */
  function papyrusTalk(raw) {
    const standard = variantSteps(PAGES.RAL, V.RAL_AFTER).find((step) => step?.type === "choice");
    if (!standard) return raw;
    const same = (entry) => standard.options.find((candidate) => candidate.text === entry.text);
    const fix = (steps) => (steps ?? []).flatMap((step) => {
      if (step?.type === "reference" || (step?.type === "action" && /shows standard options/i.test(step.text ?? ""))) return [standard];
      if (step?.type === "condition") return [{ ...step, steps: fix(step.steps) }];
      if (step?.type === "choice") {
        return [{ ...step, options: step.options.map((entry) => entry.steps?.length === 1 && entry.steps[0].type === "action" && same(entry)
          ? same(entry) : { ...entry, steps: fix(entry.steps) }) }];
      }
      return [step];
    });
    return fix(raw);
  }

  /** "Someone said you could help me." once a citizen has sent the player to him (60, t1015). */
  function answerCondition({ player, stepId }) {
    if (stepId === "CuTiaH") return stage(player) >= STAGE.RAL_INTRODUCED;
    return null;
  }

  // ---------------------------------------------------------------------------
  // Lines: the stage changes, live's chatheads, the citizens' sector
  // ---------------------------------------------------------------------------

  /** Live's chathead animations (chatneu1 588 unless listed), by the speaker's page and the line's start. */
  const HEADS = Object.freeze({
    "Meiyerditch citizen": [
      ["Get off me! I haven't got anything!", 596], ["Argghghhh!", 596], ["Well, I guess so.", 596],
      ["Hey, don't sneak up on me like that!", 596], ["Yes... but I really can't", 596],
      ["Hey, calm down, I'm not going to hurt you.", 572], ["Hey, don't be scared,", 571], ["Sorry, didn't mean to scare you.", 572],
      ["Do you know about the Myreque?", 554], ["Do you know of the Myreque?", 554], ["What do you do here?", 610],
      ["Why do you wanna know?", 554], ["I dunno. I don't know if I can trust you", 554],
      ["Yep, that's where we are", 611], ["The city is sectioned off", 612], ["They're monsters, I know that much.", 613],
      ["I know that the juveniles", 612], ["Then you have juvinates.", 612], ["After that you have the vyres.", 611],
      ["Drakan? Which one", 610], ["Well, I was referring to the main Drakan", 589], ["Hmm, nothing has been seen of him", 612],
      ["To do? Around here?", 611], ["The juvinates organise work crews", 613], ["If you want to escape", 612],
      ["It's very nice of you to offer", 612], ["They say this place once had", 613],
      ["I really need to meet the Myreque.", 555], ["I understand, but you may not like", 612],
      ["Can you introduce me to Old Man Ral?", 554], ["Well, I don't need to do that.", 612],
      ["Well, you're in sector", 612], ["Life's so very hard here.", 612], ["You must be new here", 613],
    ],
    "Old Man Ral": [
      ["Hmph!", 610, true], ["Hmph! People say things", 611], ["Hmph! Oh yes, what was it?", 610],
      ["Hmph! Nope, that's not me", 611], ["Hmph! Okay then, what was it?", 554], ["Hmph! A snitch!", 611],
      ["Hmph! So no one actually referred you", 611], ["Hmph! Nope, doesn't sound like me", 611],
      ["Hmph! Yes indeed, what was the name?", 610], ["Hmph! What do I know about anything?", 611],
      ["Hmph! A simple man only knows", 613], ["Hmph! I am a simple man", 612], ["Hmph! Am I?", 610],
      ["Hmph! Sage of Sanguinesti, eh?", 610], ["Hmph! So that's what they call me", 610], ["Hmmm. Sage of Sanguinesti.", 612],
      ["Hmmmph. That depends.", 611], ["Hmph. Myreque, eh?", 557], ["And now you should leave.", 589],
      ["Hmph! Why should I know about the Myreque", 611],
      ["It's true. They said that you were very well informed.", 589], ["No, I'm sure they gave you a name", 589],
      ["No, no, sorry, I do apologise.", 589], ["No, I'm pretty sure they directed me to you.", 589],
      ["Oh yes, yes. All the time.", 589], ["They said that you might be able to help me", 589],
      ["Well, hopefully they hid themselves.", 589],
    ],
    Vyrewatch: [["Hello?", 596, true], ["Get out of my face, meat sack", 615]],
  });

  function headFor(name, text) {
    for (const [start, anim, exact] of HEADS[name] ?? []) if (exact ? text === start : text.startsWith(start)) return anim;
    return null;
  }

  /** Ours: the sector a citizen names, from the capture's sector one around Old Man Ral (t2395) and the route's doors. */
  function sector(location) {
    const tile = tileOf(location);
    if (!tile) return "one";
    if (tile.y < 3236) return tile.x < 3609 ? "one" : "two";
    if (tile.y < 3290) return "three";
    return "four";
  }

  function onLine(request) {
    const { player, text } = request;
    if (!player || typeof text !== "string") return;
    const name = request.definition?.getName?.();
    if (!ownsPage(request.pages, PAGE, PAGES.CITIZEN, PAGES.RAL)) return;
    if (text.includes(LINE.SECTOR)) request.text = text.replace(LINE.SECTOR, sector(request.npc?.getLocation?.() ?? player.getLocation()));
    if (request.expression === undefined) {
      const head = headFor(name, text);
      if (head !== null) request.expression = head;
    }
    if (!ownsPage(request.pages, PAGE)) return;
    const s = stage(player);
    if (s === STAGE.ARRIVED && text === LINE.WHISPERED) request.after = () => state.advance(player, STAGE.WHISPERED);
    else if (s === STAGE.WHISPERED && text.startsWith(LINE.INSISTED)) request.before = () => state.advance(player, STAGE.INSISTED);
    else if (s >= STAGE.RAL_INTRODUCED && s < STAGE.ROUTE_KNOWN && text.startsWith(LINE.ROUTE)) {
      request.before = () => state.advance(player, STAGE.ROUTE_KNOWN);
    }
  }

  // ---------------------------------------------------------------------------
  // Object hooks
  // ---------------------------------------------------------------------------

  function wallPush(event) {
    return pushWall(event) || pushHideoutWall(event);
  }

  function wallSearch(event) {
    return searchLadderWall(event);
  }

  function floorSearch(event) {
    return searchFloorboards(event);
  }

  function floorClimb(event) {
    return floorboardsClimb(event);
  }

  function climbInto(event) {
    return tunnel(event);
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  api.onCustomEvent("ladders:climb", claimClimb);
  api.onCustomEvent("door:toggle", claimDoor);
  api.onCustomEvent("npc-dialogue:line", onLine);
  api.onCustomEvent("npc-dialogue:menu", shapeMenu);
  api.onCustomEvent("npc-dialogue:choice", onChoice);
  api.onCustomEvent("destroy-item:destroyed", ladderTopDestroyed);
  api.onNpcDialogueCondition(answerCondition);
  api.onObjectRoute(routeObstacle);
  api.onObjectInteraction("Floor", { Search: floorSearch, "Climb-down": floorClimb, "Climb-up": floorClimb, "Walk-across": walkAcrossFloor });
  api.onObjectInteraction("Wall rubble", { "Climb-over": climbRubble });
  api.onObjectInteraction("Floorboards", { "Jump-to": jump });
  api.onObjectInteraction("Wall", { "Crawl-under": crawl, Push: wallPush, Search: wallSearch });
  api.onObjectInteraction("Shelf", { "Climb-up": shelf, "Climb-down": shelf });
  api.onObjectInteraction("Washing line", { "Walk-across": washingLine });
  api.onObjectInteraction("Table", { Search: table });
  api.onObjectInteraction("Trapdoor table", { Open: table });
  api.onObjectInteraction("Trapdoor tunnel", { "Climb-into": climbInto });
  api.onObjectInteraction("Tunnel", { "Climb-into": climbInto });
  api.onObjectInteraction("Pots", { Search: searchPots });
  api.onObjectInteraction("Broken ladder", { Search: searchBrokenLadder });
  api.onObjectInteraction("Decorated wall", { Press: pressSymbol });
  api.onObjectInteraction("Lumpy rug", { Open: openRug });
  api.onObjectInteraction("Door", { Open: doorHook });
  api.onObjectInteraction("Trapdoor", { "Climb-down": climbHook, Close: climbHook });
  api.onObjectInteraction("Ladder", { "Climb-up": climbHook, "Climb-down": climbHook });
  api.onObjectInteraction("Stairs up", { "Climb-up": climbHook });
  api.onObjectInteraction("Stairs down", { "Climb-down": climbHook });
  api.onObjectInteraction("Broken stairs", { "Climb-up": climbHook, "Climb-down": climbHook });
  api.onItemOnObject("Knife", "Wall", bladeOnWall, { noted: false });
  api.onItemOnObject("Silver sickle", "Wall", bladeOnWall, { noted: false });
  api.onItemOnObject("Silver sickle (b)", "Wall", bladeOnWall, { noted: false });
  api.onNpcInteraction("Meiyerditch citizen", { "Talk-to": talkCitizen });
  api.onNpcInteraction("Child", { "Talk-to": talkChild });
  api.onNpcInteraction("Vyrewatch", { "Talk-to": talkVyrewatch });
  api.onNpcInteraction("Old Man Ral", { "Talk-to": talkRal });
};
