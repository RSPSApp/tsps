/**
 * Children of the Sun (members).
 *
 * The words come from the "Children of the Sun" transcript page (OSRS Wiki). The
 * stage lives in varbit 9632 ("vmq1", varp 4075, bits 0-6):
 *   0 not started, 2 accepted Alina's invitation, 4 the delegation arrives,
 *   6 tailing the suspicious guard, 8 the guard entered the house (eavesdrop),
 *   10 report to Sergeant Tobyn, 12 marking the disguised bandits,
 *   14 all four bandits marked, 16 escorted to the palace roof, 18 in the
 *   bandit cell, 20 left the cell, 22 Itzla departs, 24 complete.
 * On completion varbit 9645 ("vmq1_questcomplete_type") is set to 2, matching the
 * live-game transition recorded for this quest. Varbit 9646 ("vmq1_met_alina") is
 * set on the first Alina/Noah conversation.
 *
 * The ten 2-bit guard varbits 9633-9644 ("vmq1_guard_1..10") hold each guard's
 * state: 0 unmarked, 2 marked (the value live checkpoints use). The four bandits
 * posing as guards are the first four: outside Aris's tent (3208,3422), south-east
 * of Benny's news stand (3221,3430), the mace north-west of the east bank
 * (3246,3429) and the one leaning on Lowe's north wall (3237,3427). The other six
 * are real guards; marking any of them is what Tobyn's "incorrectly marked" branch
 * answers. All ten guard NPCs use the cache's Mark 12668+3i / Unmark 12669+3i ids.
 *
 * The suspicious guard is the primary 12661 ("Guard" with the big bag); 12662
 * is the cache's visible sibling and has no transform. Alina/Noah are
 * 12644/12646, Sergeant Tobyn 12648 and Prince Itzla Arkan 12650.
 * The bandit house door is object 50048 at (3259,3400), claimed through the shared
 * Doors plugin's "door:toggle" event.
 *
 * Source: OSRS Wiki "Children of the Sun" page, quick guide and transcript; guard
 * varbit checkpoints, guard posts and the tail route cross-checked against cache
 * ids (NpcIdentifiers 12644-12697, ObjectIdentifiers.DOOR_695) and the route walk
 * verified against the cache map/collision.
 *
 * Rewards per the OSRS Wiki: 1 Quest point and access to Varlamore. No XP, no item.
 *
 * Gaps: the tail is a walk along the wiki's route with pauses at the hiding spots,
 * not a cutscene - there is no line-of-sight or turn-to-look check, only "stepped
 * within one tile" (spotted) and "fell more than 14 tiles behind" (too far). The
 * delegation, eavesdrop and roof camera tracks use the captured coordinates and
 * resets; scene directions still play as game messages. Multi-speaker cutscene
 * lines share the speaking NPC's chathead. The dump has no post-quest Alina/Noah
 * variant, so a completed player replays the intro with the start hook guarded,
 * as ClockTower does. The escort to the palace roof is a teleport to (3203,3473,2).
 * All Varrock quest NPCs are per-player owner-only spawns because none exist in
 * npc-spawns.json.
 */
module.exports = function registerChildrenOfTheSunQuest(api) {
  const { Location, NpcIdentifiers, ObjectIdentifiers, RegionManager } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");
  const Scenes = createQuestScenes(api);

  const PAGE = "Children of the Sun";
  const START_HOOK = "quest:children-of-the-sun:start";

  // Varp 4075 "vmq1" (scripts/lookup-gameval.ts varbit vmq1).
  const VARP_CHILDREN_OF_THE_SUN = 4075;
  const STAGE_VARBIT = 9632;
  const GUARD_VARBIT_IDS = [9633, 9634, 9635, 9636, 9637, 9640, 9641, 9642, 9643, 9644];
  const QUESTCOMPLETE_TYPE_VARBIT = 9645;
  const MET_ALINA_VARBIT = 9646;
  const GUARD_MARKED_VALUE = 2;

  // Stage values (varbit 9632; the same even checkpoints the live quest uses).
  const STAGE_STARTED = 2;
  const STAGE_DELEGATION = 4;
  const STAGE_TAILING = 6;
  const STAGE_TAILED = 8;
  const STAGE_REPORT = 10;
  const STAGE_MARKING = 12;
  const STAGE_MARKED = 14;
  const STAGE_ROOF = 16;
  const STAGE_CELL = 18;
  const STAGE_LEFT_CELL = 20;
  const STAGE_ITZLA_LEFT = 22;
  const STAGE_COMPLETE = 24;

  const MET_ALINA_ATTRIBUTE = "quest.children_of_the_sun.met-alina";
  const GUARDS_ATTRIBUTE = "quest.children_of_the_sun.guards";
  const TAIL_FAIL_ATTRIBUTE = "quest.children_of_the_sun.tail-fail";
  const SCHEMA_ATTRIBUTE = "children-of-the-sun:schema";
  const SCHEMA_VERSION = 2;
  const TAIL_FAIL_SPOTTED = 1;
  const TAIL_FAIL_FAR = 2;

  const ALINA_NPC_ID = NpcIdentifiers.ALINA; // 12644
  const NOAH_NPC_ID = NpcIdentifiers.NOAH; // 12646
  const TOBYN_NPC_ID = NpcIdentifiers.SERGEANT_TOBYN; // 12648
  const ITZLA_NPC_ID = NpcIdentifiers.PRINCE_ITZLA_ARKAN; // 12650
  const BAG_GUARD_NPC_ID = NpcIdentifiers.GUARD_185; // 12661 primary; 12662 is the visible sibling

  const ALINA_NPC_IDS = new Set([NpcIdentifiers.ALINA, NpcIdentifiers.ALINA_2]);
  const NOAH_NPC_IDS = new Set([NpcIdentifiers.NOAH, NpcIdentifiers.NOAH_2]);
  const TOBYN_NPC_IDS = new Set([NpcIdentifiers.SERGEANT_TOBYN, NpcIdentifiers.SERGEANT_TOBYN_2]);
  const ITZLA_NPC_IDS = new Set([
    NpcIdentifiers.PRINCE_ITZLA_ARKAN,
    NpcIdentifiers.PRINCE_ITZLA_ARKAN_2,
  ]);

  // Guard 1..10 Mark/Unmark ids from NpcIdentifiers (12668..12697).
  const GUARD_UNMARKED_IDS = [
    NpcIdentifiers.GUARD_187,
    NpcIdentifiers.GUARD_190,
    NpcIdentifiers.GUARD_193,
    NpcIdentifiers.GUARD_196,
    NpcIdentifiers.GUARD_199,
    NpcIdentifiers.GUARD_202,
    NpcIdentifiers.GUARD_205,
    NpcIdentifiers.GUARD_208,
    NpcIdentifiers.GUARD_211,
    NpcIdentifiers.GUARD_214,
  ];
  const GUARD_MARKED_IDS = [
    NpcIdentifiers.GUARD_188,
    NpcIdentifiers.GUARD_191,
    NpcIdentifiers.GUARD_194,
    NpcIdentifiers.GUARD_197,
    NpcIdentifiers.GUARD_200,
    NpcIdentifiers.GUARD_203,
    NpcIdentifiers.GUARD_206,
    NpcIdentifiers.GUARD_209,
    NpcIdentifiers.GUARD_212,
    NpcIdentifiers.GUARD_215,
  ];
  const GUARD_MARKABLE_IDS = new Set([...GUARD_UNMARKED_IDS, ...GUARD_MARKED_IDS]);
  const CORRECT_GUARD_COUNT = 4;

  // Posts 1-4 are the disguised bandits, 5-10 the real guards.
  const GUARD_POSTS = [
    { x: 3208, y: 3422 },
    { x: 3221, y: 3430 },
    { x: 3246, y: 3429 },
    { x: 3237, y: 3427 },
    { x: 3227, y: 3424 },
    { x: 3218, y: 3424 },
    { x: 3230, y: 3430 },
    { x: 3206, y: 3431 },
    { x: 3239, y: 3433 },
    { x: 3218, y: 3433 },
  ];

  // The suspicious guard's route (wiki guide path), with pauses at the hiding spots.
  const TAIL_WAYPOINTS = [
    { x: 3225, y: 3429 },
    { x: 3233, y: 3429 },
    { x: 3233, y: 3427, pause: 8 },
    { x: 3233, y: 3429 },
    { x: 3235, y: 3429 },
    { x: 3240, y: 3429 },
    { x: 3242, y: 3429 },
    { x: 3242, y: 3417, pause: 8 },
    { x: 3242, y: 3403 },
    { x: 3241, y: 3403, pause: 8 },
    { x: 3239, y: 3401 },
    { x: 3236, y: 3397 },
    { x: 3236, y: 3392, pause: 8 },
    { x: 3238, y: 3390 },
    { x: 3248, y: 3390 },
    { x: 3248, y: 3396 },
    { x: 3247, y: 3397 },
    { x: 3258, y: 3400, pause: 2 }, // house approach beside the bandit door
  ];
  const TAIL_FAIL_DISTANCE = 14;
  const TAIL_SPOTTED_DISTANCE = 1;

  const BANDIT_DOOR_OBJECT_ID = ObjectIdentifiers.DOOR_695; // 50048 at (3259,3400)
  const BANDIT_DOOR_TILE = { x: 3259, y: 3400 };
  const ROOF_LANDING = { x: 3203, y: 3473, z: 2 };
  const TOBYN_ROOF_TILE = { x: 3202, y: 3473 };
  const ITZLA_ROOF_TILE = { x: 3204, y: 3473 };

  const ALINA_TILE = { x: 3225, y: 3426 };
  const NOAH_TILE = { x: 3228, y: 3427 };
  const TOBYN_TILE = { x: 3211, y: 3437 };

  // Captured cell scene: the roof is dressed as a cell, the bandit and the
  // enhanced Tobyn/Itzla variants appear, and Itzla walks to the bars.
  const CELL_BANDIT_ID = NpcIdentifiers.BANDIT_20; // 12667
  const CELL_TOBYN_ID = 12649; // enhanced roof variant
  const CELL_ITZLA_ID = 12651;
  const CELL_PLAYER_TILE = { x: 3204, y: 3473 };
  const CELL_BANDIT_TILE = { x: 3201, y: 3470 };
  const CELL_TOBYN_TILE = { x: 3203, y: 3473 };
  const CELL_ITZLA_TILE = { x: 3205, y: 3473 };
  const CELL_ITZLA_BARS = { x: 3204, y: 3470 };
  const CELL_INSTANCE_TILE = { x: 10172, y: 3399, z: 2 };

  // Condition step ids on the "Children of the Sun" page.
  const F2P_CONDITION_IDS = new Set(["i6hlqM", "uSwN8S"]);
  const MEMBERS_CONDITION_IDS = new Set(["qtA270", "YlcV3Z"]);
  const SPOTTED_CONDITION_ID = "4VoF4Q";
  const TOO_FAR_CONDITION_ID = "NvaK4l";
  const FOUR_MARKED_CONDITION_ID = "BYupI1";
  const INCORRECT_CONDITION_ID = "sIdt4l";
  const CORRECT_CONDITION_ID = "5o6brO";
  const BEFORE_VARLAMORE_CONDITION_ID = "-Jy7tc";
  const AFTER_VARLAMORE_CONDITION_ID = "bGkS46";

  // Action/message step ids on the page.
  const DELEGATION_SCENE_STEP = "wltzqo";
  const BAG_GUARD_OUT_STEP = "-vBZ7r";
  const GUARD_PASSES_STEP = "P8ojsR";
  const TAIL_BEGIN_STEP = "I40DOA";
  const TAIL_RESTART_STEP = "r2Pt3E";
  const EAVESDROP_BEGIN_STEP = "V-D092";
  const EAVESDROP_END_STEP = "HrKPFI";
  const ESCORT_STEP = "PiLgte";
  const ENTER_CELL_STEP = "D5boc3";
  const LEAVE_CELL_STEP = "4aa1xN";
  const ITZLA_DEPARTS_STEP = "VS01WH";
  const COMPLETE_STEP = "9QLQQG";
  const INTERROGATION_BEGIN_STEP = "D6DBki";

  // Captured camera tracks (RSProx 1637, rev 226.1): [offset, move, look, rates?].
  const CAMERA_DELEGATION = [
    [3, [3213, 3433, 460], [3225, 3427, 260]],
    [24, [3216, 3434, 390], [3211, 3438, 190]],
    [38, [3223, 3434, 390], [3225, 3425, 190]],
    [46, null],
  ];
  const CAMERA_EAVESDROP = [
    [3, [3252, 3396, 490], [3260, 3400, 290]],
    [10, [3263, 3395, 340], [3260, 3403, 300]],
    [18, [3252, 3396, 490], [3260, 3400, 290]],
    [21, null],
  ];
  const CAMERA_ROOF = [
    [15, [3207, 3471, 311], [3197, 3469, 300]],
    [40, null],
  ];

  const V_MEET = "delegation-talking-to-noah-or-alina";
  const V_BEFORE_START = "delegation-subsequent-dialogues-before-starting-the-quest";
  const V_STARTED = "delegation-subsequent-dialogues-after-starting-the-quest";
  const V_TAIL_RESTART = "investigation-talking-to-noah-or-alina-after-starting-to-tail-the-guard";
  const V_TOBYN_MOVE_ALONG = "investigation-talking-to-sergeant-tobyn-after-starting-to-tail-the-guard";
  const V_TOBYN_REPORT = "investigation-talking-to-sergeant-tobyn";
  const V_TOBYN_REMIND = "investigation-talking-to-sergeant-tobyn-talking-to-sergeant-tobyn-again";
  const V_TOBYN_MARKED = "investigation-talking-to-sergeant-tobyn-after-marking-the-imposters";
  const V_TOBYN_TURNED_IN = "investigation-talking-to-sergeant-tobyn-after-turning-in-the-guards";
  const V_MARK = "investigation-marking-a-guard";
  const V_UNMARK = "investigation-unmarking-a-guard";
  const V_TAIL_FAILED = "investigation-tailing-the-guard";
  const V_EAVESDROP = "investigation-successfully-following-the-guard";
  const V_INTERROGATION = "interrogation-talking-to-the-prince-or-sergeant";
  const V_INTERROGATION_DONE_TOBYN = "interrogation-talking-again-after-itzla-departs";
  const V_INTERROGATION_DONE_ITZLA = "interrogation-talking-again-after-finishing-the-interrogation";

  /** Tracked per-player owner-only spawns, keyed by role. */
  const trackedNpcs = new WeakMap();
  /** Mark-state NPC per guard slot, rebuilt whenever a guard is marked/unmarked. */
  const rosterNpcs = new WeakMap();
  /** The active tail: { npc, index, pauseTicks, grace, stuck, lastX, lastY }. */
  const tailSessions = new WeakMap();
  /** The finished guard standing at the house until the door is used. */
  const doorGuards = new WeakMap();
  /** One-shot "already marked enough" decision for the marking transcript. */
  const markRejections = new WeakMap();

  let quest;

  // ==========================================================================
  // State helpers
  // ==========================================================================

  function metAlina(player) {
    return player.getAttribute(MET_ALINA_ATTRIBUTE) === true;
  }

  function setMetAlina(player) {
    player.setAttribute(MET_ALINA_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(MET_ALINA_VARBIT, 1);
  }

  function guardsMask(player) {
    return Number(player.getAttribute(GUARDS_ATTRIBUTE)) || 0;
  }

  function isGuardMarked(player, index) {
    return (guardsMask(player) & (1 << index)) !== 0;
  }

  function setGuardMarked(player, index, marked) {
    const mask = guardsMask(player);
    const bit = 1 << index;
    player.setAttribute(GUARDS_ATTRIBUTE, marked ? mask | bit : mask & ~bit);
    player.getPacketSender().sendVarbit(GUARD_VARBIT_IDS[index], marked ? GUARD_MARKED_VALUE : 0);
  }

  function markedGuardCount(player) {
    let count = 0;
    for (let index = 0; index < GUARD_POSTS.length; index++) if (isGuardMarked(player, index)) count++;
    return count;
  }

  function correctGuardsMarked(player) {
    let count = 0;
    for (let index = 0; index < CORRECT_GUARD_COUNT; index++) if (isGuardMarked(player, index)) count++;
    return count;
  }

  function anyWrongGuardMarked(player) {
    for (let index = CORRECT_GUARD_COUNT; index < GUARD_POSTS.length; index++) {
      if (isGuardMarked(player, index)) return true;
    }
    return false;
  }

  function tailFailReason(player) {
    return Number(player.getAttribute(TAIL_FAIL_ATTRIBUTE)) || 0;
  }

  function isQuestPage(pages) {
    return Array.isArray(pages) && pages.some((page) => page?.page === PAGE);
  }

  function playTranscript(player, npcId, variant) {
    api.emitCustomEvent("npc-dialogue:start", { player, npcId, variant });
  }

  function playCamera(player, shots) {
    Scenes.cancel(player);
    for (const [ticks, move, look, rates] of shots) {
      Scenes.later(player, ticks, () => {
        if (player.isRegistered?.() === false) return;
        if (!move) player.getPacketSender().sendCameraReset();
        else Scenes.camera(player, move, look, rates);
      });
    }
  }

  function resetCamera(player) {
    Scenes.cancel(player);
    player.getPacketSender().sendCameraReset();
  }

  function later(player, ticks, fn) {
    const { CountdownTask, TaskManager } = api.core;
    if (!CountdownTask || !TaskManager) { fn(); return; }
    TaskManager.submit(new CountdownTask(player, ticks, () => {
      if (player.isRegistered?.() === false) return;
      fn();
    }));
  }

  // ==========================================================================
  // NPC spawns
  // ==========================================================================

  function spawnTracked(player, key, definition) {
    const tracked = trackedNpcs.get(player) ?? new Map();
    trackedNpcs.set(player, tracked);
    if (tracked.get(key)) return tracked.get(key);
    const npc = api.spawnNpc({ ...definition, owner: player, ownerOnly: true });
    if (npc) tracked.set(key, npc);
    return npc;
  }

  function removeTracked(player, key) {
    const tracked = trackedNpcs.get(player);
    const npc = tracked?.get(key);
    if (npc) {
      api.removeNpc(npc);
      tracked.delete(key);
    }
  }

  function ensureGroundNpcs(player) {
    spawnTracked(player, "alina", { id: ALINA_NPC_ID, ...ALINA_TILE, z: 0, wanderRadius: 0 });
    spawnTracked(player, "noah", { id: NOAH_NPC_ID, ...NOAH_TILE, z: 0, wanderRadius: 0 });
    spawnTracked(player, "tobyn", { id: TOBYN_NPC_ID, ...TOBYN_TILE, z: 0, wanderRadius: 0 });
  }

  function ensureRoofNpcs(player) {
    spawnTracked(player, "tobyn-roof", { id: TOBYN_NPC_ID, ...TOBYN_ROOF_TILE, z: 2, wanderRadius: 0 });
    spawnTracked(player, "itzla", { id: ITZLA_NPC_ID, ...ITZLA_ROOF_TILE, z: 2, wanderRadius: 0 });
  }

  function ensureGuards(player) {
    const roster = rosterNpcs.get(player) ?? new Map();
    rosterNpcs.set(player, roster);
    for (let index = 0; index < GUARD_POSTS.length; index++) {
      if (!roster.get(index)) syncGuardNpc(player, index);
    }
  }

  function guardNpcId(player, index) {
    const marked = isGuardMarked(player, index);
    return (marked ? GUARD_MARKED_IDS : GUARD_UNMARKED_IDS)[index];
  }

  function syncGuardNpc(player, index) {
    const roster = rosterNpcs.get(player) ?? new Map();
    rosterNpcs.set(player, roster);
    const previous = roster.get(index);
    if (previous) api.removeNpc(previous);
    const post = GUARD_POSTS[index];
    const npc = api.spawnNpc({
      id: guardNpcId(player, index),
      x: post.x,
      y: post.y,
      z: 0,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) roster.set(index, npc);
  }

  function removeGuards(player) {
    const roster = rosterNpcs.get(player);
    if (!roster) return;
    for (const npc of roster.values()) api.removeNpc(npc);
    rosterNpcs.delete(player);
  }

  function syncGuardVarbits(player) {
    const sender = player.getPacketSender();
    for (let index = 0; index < GUARD_VARBIT_IDS.length; index++) {
      sender.sendVarbit(GUARD_VARBIT_IDS[index], isGuardMarked(player, index) ? GUARD_MARKED_VALUE : 0);
    }
    if (metAlina(player)) sender.sendVarbit(MET_ALINA_VARBIT, 1);
    if (quest.isComplete(player)) sender.sendVarbit(QUESTCOMPLETE_TYPE_VARBIT, 2);
  }

  function removeCellScene(player) {
    removeTracked(player, "cell-bandit");
    removeTracked(player, "cell-tobyn");
    removeTracked(player, "cell-itzla");
  }

  function enterCellScene(player) {
    removeTracked(player, "tobyn-roof");
    removeTracked(player, "itzla");
    removeCellScene(player);
    spawnTracked(player, "cell-bandit", { id: CELL_BANDIT_ID, ...CELL_BANDIT_TILE, z: 2, wanderRadius: 0 });
    spawnTracked(player, "cell-tobyn", { id: CELL_TOBYN_ID, ...CELL_TOBYN_TILE, z: 2, wanderRadius: 0 });
    const itzla = spawnTracked(player, "cell-itzla", { id: CELL_ITZLA_ID, ...CELL_ITZLA_TILE, z: 2, wanderRadius: 0 });
    player.moveTo(new Location(CELL_PLAYER_TILE.x, CELL_PLAYER_TILE.y, 2));
    later(player, 1, () => itzla?.moveTo?.(new Location(CELL_ITZLA_TILE.x, CELL_ITZLA_TILE.y - 2, 2)));
    later(player, 2, () => itzla?.moveTo?.(new Location(CELL_ITZLA_BARS.x, CELL_ITZLA_BARS.y, 2)));
  }

  function leaveCellScene(player) {
    removeCellScene(player);
    player.moveTo(new Location(CELL_INSTANCE_TILE.x, CELL_INSTANCE_TILE.y, CELL_INSTANCE_TILE.z));
    later(player, 1, () => {
      player.moveTo(new Location(ROOF_LANDING.x, ROOF_LANDING.y, ROOF_LANDING.z));
      ensureRoofNpcs(player);
    });
  }

  function ensureQuestNpcs(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    ensureGroundNpcs(player);
    const stage = quest.getStage(player);
    if (stage >= STAGE_MARKING && stage < STAGE_ROOF) ensureGuards(player);
    if (stage === STAGE_CELL) { enterCellScene(player); return; }
    if (stage >= STAGE_ROOF && !quest.isComplete(player)) {
      ensureRoofNpcs(player);
      if (stage >= STAGE_ITZLA_LEFT) removeTracked(player, "itzla");
    }
    if (stage === STAGE_TAILING) startTail(player);
  }

  // ==========================================================================
  // Tailing the suspicious guard
  // ==========================================================================

  function removeTailGuard(player) {
    const session = tailSessions.get(player);
    if (session?.npc) api.removeNpc(session.npc);
    tailSessions.delete(player);
  }

  function removeDoorGuard(player) {
    const npc = doorGuards.get(player);
    if (npc) api.removeNpc(npc);
    doorGuards.delete(player);
  }

  /** Adjacent four-way route between captured checkpoints on the real map. */
  function walkableTailTile(x, y) {
    try {
      return !RegionManager.blocked(new Location(x, y, 0), null);
    } catch {
      return false;
    }
  }

  function tailSegment(from, to) {
    const startKey = `${from.x},${from.y}`;
    const goalKey = `${to.x},${to.y}`;
    const queue = [[from.x, from.y]];
    const parent = new Map([[startKey, null]]);
    for (let index = 0; index < queue.length; index++) {
      const [x, y] = queue[index];
      if (`${x},${y}` === goalKey) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        const key = `${nx},${ny}`;
        if (parent.has(key) || Math.abs(nx - from.x) > 30 || Math.abs(ny - from.y) > 30) continue;
        if (!walkableTailTile(nx, ny)) continue;
        if (RegionManager.canMove(x, y, nx, ny, 0, 1, 1, null) === false) continue;
        parent.set(key, `${x},${y}`);
        queue.push([nx, ny]);
      }
    }
    if (!parent.has(goalKey)) return null;
    const path = [];
    for (let key = goalKey; key && key !== startKey; key = parent.get(key)) {
      const [x, y] = key.split(",").map(Number);
      path.push({ x, y });
    }
    return path.reverse();
  }

  let tailRouteCache;
  function buildTailRoute() {
    if (tailRouteCache !== undefined) return tailRouteCache;
    const route = [];
    for (let index = 1; index < TAIL_WAYPOINTS.length; index++) {
      const from = TAIL_WAYPOINTS[index - 1];
      const to = TAIL_WAYPOINTS[index];
      const segment = tailSegment(from, to);
      if (!segment) { tailRouteCache = null; return null; }
      if (to.pause) segment[segment.length - 1].pause = to.pause;
      route.push(...segment);
    }
    tailRouteCache = route;
    return route;
  }

  function startTail(player) {
    removeTailGuard(player);
    removeDoorGuard(player);
    const start = TAIL_WAYPOINTS[0];
    const npc = api.spawnNpc({
      id: BAG_GUARD_NPC_ID,
      x: start.x,
      y: start.y,
      z: 0,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    player.setAttribute(TAIL_FAIL_ATTRIBUTE, 0);
    if (!npc) return;
    tailSessions.set(player, {
      npc,
      route: buildTailRoute() ?? TAIL_WAYPOINTS.slice(1),
      index: 0,
      pauseTicks: 0,
      grace: 2,
      stuck: 0,
      lastX: start.x,
      lastY: start.y,
    });
    quest.setStage(player, STAGE_TAILING);
  }

  function failTail(player, reason) {
    const session = tailSessions.get(player);
    if (!session) return;
    tailSessions.delete(player);
    if (session.npc) api.removeNpc(session.npc);
    player.setAttribute(TAIL_FAIL_ATTRIBUTE, reason);
    quest.setStage(player, STAGE_STARTED);
    playTranscript(player, BAG_GUARD_NPC_ID, V_TAIL_FAILED);
  }

  function finishTail(player) {
    const session = tailSessions.get(player);
    if (!session) return;
    tailSessions.delete(player);
    doorGuards.set(player, session.npc);
    player.setAttribute(TAIL_FAIL_ATTRIBUTE, 0);
    quest.setStage(player, STAGE_TAILED);
  }

  function tickTail(player, session) {
    const npc = session.npc;
    if (!npc || quest.getStage(player) !== STAGE_TAILING) {
      removeTailGuard(player);
      return;
    }
    const guard = npc.getLocation();
    const here = player.getLocation();
    const distance = Math.max(
      Math.abs(here.getX() - guard.getX()),
      Math.abs(here.getY() - guard.getY())
    );
    if (session.grace > 0) {
      session.grace--;
    } else if (distance <= TAIL_SPOTTED_DISTANCE) {
      failTail(player, TAIL_FAIL_SPOTTED);
      return;
    } else if (distance > TAIL_FAIL_DISTANCE) {
      failTail(player, TAIL_FAIL_FAR);
      return;
    }

    if (guard.getX() === session.lastX && guard.getY() === session.lastY) {
      session.stuck++;
    } else {
      session.stuck = 0;
      session.lastX = guard.getX();
      session.lastY = guard.getY();
    }

    if (session.pauseTicks > 0) {
      session.pauseTicks--;
      session.stuck = 0;
      return;
    }
    if (npc.getMovementQueue().hasPendingWork()) {
      if (session.stuck > 8) {
        npc.getMovementQueue().reset();
      } else {
        return;
      }
    }

    const target = session.route[session.index];
    if (!target) {
      // The guard has reached the door approach; the door cutscene is next.
      finishTail(player);
      return;
    }
    if (guard.getX() !== target.x || guard.getY() !== target.y) {
      if (session.stuck > 8) npc.moveTo(new Location(target.x, target.y, 0));
      else npc.getMovementQueue().addFirstStep(new Location(target.x, target.y, 0));
      return;
    }
    session.stuck = 0;
    session.index++;
    if (target.pause) {
      session.pauseTicks = target.pause;
      return;
    }
    const next = session.route[session.index];
    if (next) npc.getMovementQueue().addFirstStep(new Location(next.x, next.y, 0));
  }

  function handlePlayerProcess({ player }) {
    if (!player || player.isPlayerBot?.() === true) return;
    const session = tailSessions.get(player);
    if (session) tickTail(player, session);
  }

  // ==========================================================================
  // Escort and completion
  // ==========================================================================

  function escortToRoof(player) {
    removeGuards(player);
    removeDoorGuard(player);
    quest.setStage(player, STAGE_ROOF);
    player.moveTo(new Location(ROOF_LANDING.x, ROOF_LANDING.y, ROOF_LANDING.z));
    ensureRoofNpcs(player);
  }

  // ==========================================================================
  // Transcript wiring
  // ==========================================================================

  /** Which variant an NPC plays, by stage. */
  function selectVariant({ npcId, player }) {
    if (ALINA_NPC_IDS.has(npcId) || NOAH_NPC_IDS.has(npcId)) return selectDelegationVariant(player);
    if (TOBYN_NPC_IDS.has(npcId)) return selectTobynVariant(player);
    if (ITZLA_NPC_IDS.has(npcId)) return selectItzlaVariant(player);
    return null;
  }

  function selectDelegationVariant(player) {
    const stage = quest.getStage(player);
    if (quest.isComplete(player)) return V_MEET; // no post-quest variant in the dump
    if (tailFailReason(player) !== 0) return V_TAIL_RESTART;
    if (stage >= STAGE_TAILING && stage < STAGE_TAILED) return V_TAIL_RESTART;
    if (stage >= STAGE_STARTED) return V_STARTED;
    return metAlina(player) ? V_BEFORE_START : V_MEET;
  }

  function selectTobynVariant(player) {
    const stage = quest.getStage(player);
    const onRoof = player.getLocation().getZ() === 2;
    if (quest.isComplete(player)) return onRoof ? V_INTERROGATION_DONE_TOBYN : null;
    if (stage >= STAGE_ITZLA_LEFT) return onRoof ? V_INTERROGATION_DONE_TOBYN : V_TOBYN_TURNED_IN;
    if (stage >= STAGE_ROOF) return onRoof ? V_INTERROGATION : V_TOBYN_TURNED_IN;
    if (stage >= STAGE_MARKING) {
      if (correctGuardsMarked(player) === CORRECT_GUARD_COUNT) return V_TOBYN_MARKED;
      if (anyWrongGuardMarked(player)) return V_TOBYN_MARKED;
      return V_TOBYN_REMIND;
    }
    if (stage >= STAGE_REPORT) return V_TOBYN_REPORT;
    if (stage >= STAGE_TAILING) return V_TOBYN_MOVE_ALONG;
    return null; // "Transcript:Sergeant Tobyn" standard dialogue
  }

  function selectItzlaVariant(player) {
    return quest.isComplete(player) ? V_INTERROGATION_DONE_ITZLA : V_INTERROGATION;
  }

  /** Answers the wiki prose conditions with gameplay state. */
  function answerCondition(event) {
    const { npcId, player, stepId } = event;
    if (!isQuestPage(event.pages)) return null;
    if (F2P_CONDITION_IDS.has(stepId)) return false;
    if (MEMBERS_CONDITION_IDS.has(stepId)) return true;
    if (stepId === SPOTTED_CONDITION_ID) return tailFailReason(player) === TAIL_FAIL_SPOTTED;
    if (stepId === TOO_FAR_CONDITION_ID) return tailFailReason(player) === TAIL_FAIL_FAR;
    if (stepId === FOUR_MARKED_CONDITION_ID) {
      if (!GUARD_MARKABLE_IDS.has(npcId)) return null;
      const forced = markRejections.get(player);
      return typeof forced === "boolean" ? forced : markedGuardCount(player) >= CORRECT_GUARD_COUNT;
    }
    if (stepId === INCORRECT_CONDITION_ID) {
      return TOBYN_NPC_IDS.has(npcId) ? anyWrongGuardMarked(player) : null;
    }
    if (stepId === CORRECT_CONDITION_ID) {
      return TOBYN_NPC_IDS.has(npcId) ? correctGuardsMarked(player) === CORRECT_GUARD_COUNT : null;
    }
    if (stepId === BEFORE_VARLAMORE_CONDITION_ID) return false;
    if (stepId === AFTER_VARLAMORE_CONDITION_ID) return true;
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== START_HOOK) return;
    if (!ALINA_NPC_IDS.has(npcId) && !NOAH_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) === 0) quest.setStage(player, STAGE_STARTED);
  }

  /** First Alina/Noah chat records the meeting; Tobyn's briefing opens the marking. */
  function handleDialogueLine(event) {
    const { player, npcId, text } = event;
    if ((ALINA_NPC_IDS.has(npcId) || NOAH_NPC_IDS.has(npcId)) && !metAlina(player)) {
      setMetAlina(player);
      return;
    }
    if (
      TOBYN_NPC_IDS.has(npcId) &&
      quest.getStage(player) === STAGE_REPORT &&
      /get to it/i.test(String(text ?? ""))
    ) {
      quest.setStage(player, STAGE_MARKING);
      ensureGuards(player);
    }
  }

  /** Scene directions and hand-ins carried by action/message steps. */
  function handleAction(event) {
    const { player, stepId } = event;
    const message = String(event.text ?? "");
    switch (stepId) {
      case DELEGATION_SCENE_STEP:
        event.handled = true;
        if (message) player.sendMessage(message);
        if (quest.getStage(player) < STAGE_DELEGATION) quest.setStage(player, STAGE_DELEGATION);
        playCamera(player, CAMERA_DELEGATION);
        return;
      case BAG_GUARD_OUT_STEP:
      case GUARD_PASSES_STEP:
        event.handled = true;
        if (message) player.sendMessage(message);
        return;
      case TAIL_BEGIN_STEP:
      case TAIL_RESTART_STEP:
        event.handled = true;
        if (message) player.sendMessage(message);
        if (quest.getStage(player) < STAGE_TAILING) startTail(player);
        return;
      case EAVESDROP_BEGIN_STEP:
        event.handled = true;
        if (message) player.sendMessage(message);
        playCamera(player, CAMERA_EAVESDROP);
        return;
      case INTERROGATION_BEGIN_STEP:
        event.handled = true;
        if (message) player.sendMessage(message);
        return;
      case EAVESDROP_END_STEP:
        event.handled = true;
        if (message) player.sendMessage(message);
        removeDoorGuard(player);
        if (quest.getStage(player) < STAGE_REPORT) quest.setStage(player, STAGE_REPORT);
        return;
      case ESCORT_STEP:
        event.handled = true;
        event.end = true;
        if (message) player.sendMessage(message);
        escortToRoof(player);
        playCamera(player, CAMERA_ROOF);
        return;
      case ENTER_CELL_STEP:
        event.handled = true;
        if (message) player.sendMessage(message);
        enterCellScene(player);
        if (quest.getStage(player) < STAGE_CELL) quest.setStage(player, STAGE_CELL);
        return;
      case LEAVE_CELL_STEP:
        event.handled = true;
        if (message) player.sendMessage(message);
        leaveCellScene(player);
        if (quest.getStage(player) < STAGE_LEFT_CELL) quest.setStage(player, STAGE_LEFT_CELL);
        return;
      case ITZLA_DEPARTS_STEP:
        event.handled = true;
        if (message) player.sendMessage(message);
        removeTracked(player, "cell-itzla");
        removeTracked(player, "cell-bandit");
        removeTracked(player, "itzla");
        if (quest.getStage(player) < STAGE_ITZLA_LEFT) quest.setStage(player, STAGE_ITZLA_LEFT);
        return;
      case COMPLETE_STEP:
        event.handled = true;
        removeCellScene(player);
        if (!quest.isComplete(player)) {
          player.getPacketSender().sendVarbit(QUESTCOMPLETE_TYPE_VARBIT, 2);
          quest.complete(player);
        }
        return;
      default:
        return;
    }
  }

  /** The bandit-house door is claimed (before Doors swings it) while tailing is done. */
  function handleDoorToggle(request) {
    if (request.handled) return;
    if (request.objectId !== BANDIT_DOOR_OBJECT_ID) return;
    const location = request.location;
    if (!location || location.x !== BANDIT_DOOR_TILE.x || location.y !== BANDIT_DOOR_TILE.y) return;
    const { player } = request;
    if (quest.getStage(player) !== STAGE_TAILED) return;
    request.handled = true;
    removeDoorGuard(player);
    playTranscript(player, BAG_GUARD_NPC_ID, V_EAVESDROP);
  }

  function markGuard(event) {
    const { player, npcId } = event;
    const index = GUARD_UNMARKED_IDS.indexOf(npcId);
    if (index === -1) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_MARKING || stage >= STAGE_ROOF) return true;
    // Decide the message before mutating: the fourth mark must play the normal
    // variant even though the guard count reaches four.
    const rejected = markedGuardCount(player) >= CORRECT_GUARD_COUNT;
    if (!rejected) {
      setGuardMarked(player, index, true);
      syncGuardNpc(player, index);
      if (correctGuardsMarked(player) === CORRECT_GUARD_COUNT) quest.setStage(player, STAGE_MARKED);
    }
    markRejections.set(player, rejected);
    playTranscript(player, npcId, V_MARK);
    markRejections.delete(player);
    return true;
  }

  function unmarkGuard(event) {
    const { player, npcId } = event;
    const index = GUARD_MARKED_IDS.indexOf(npcId);
    if (index === -1) return false;
    setGuardMarked(player, index, false);
    syncGuardNpc(player, index);
    if (quest.getStage(player) === STAGE_MARKED && correctGuardsMarked(player) < CORRECT_GUARD_COUNT) {
      quest.setStage(player, STAGE_MARKING);
    }
    playTranscript(player, npcId, V_UNMARK);
    return true;
  }

  function markSchema(player) {
    if (Number(player.getAttribute(SCHEMA_ATTRIBUTE)) === SCHEMA_VERSION) return;
    player.setAttribute(SCHEMA_ATTRIBUTE, SCHEMA_VERSION);
  }

  /**
   * Before the native stage split, 22 meant "quest complete". Only saves
   * without the schema marker can be old, so they are moved to native 24.
   * Rewards are never re-paid: this only changes the stage.
   */
  function migrateLegacyStage(player) {
    if (Number(player.getAttribute(SCHEMA_ATTRIBUTE)) === SCHEMA_VERSION) return;
    if (quest.getStage(player) === 22) quest.setStage(player, STAGE_COMPLETE);
    markSchema(player);
  }

  function handleStageChanged(event) {
    if (event.key !== "children_of_the_sun" || !event.player) return;
    markSchema(event.player);
  }

  function handleLogin({ player }) {
    migrateLegacyStage(player);
    ensureQuestNpcs(player);
    syncGuardVarbits(player);
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    resetCamera(player);
    removeTailGuard(player);
    removeDoorGuard(player);
    removeGuards(player);
    const tracked = trackedNpcs.get(player);
    if (tracked) {
      for (const npc of tracked.values()) api.removeNpc(npc);
      trackedNpcs.delete(player);
    }
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Alina told me about the Varlamorian delegation and I agreed to help.</str>",
        "<str>I tailed a suspicious guard and overheard a bandit plot to attack the</str>",
        "<str>delegation, then helped Sergeant Tobyn catch the four disguised bandits.</str>",
        "<str>Prince Itzla Arkan questioned one of the bandits, who revealed that the</str>",
        "<str>Teokan of Ralos was the target. Varlamore is now open for travel.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_ROOF) {
      return [
        "Sergeant Tobyn has arrested the bandits.",
        "",
        "I should speak to <col=800000>Sergeant Tobyn</col> on the palace roof",
        "to help with the interrogation.",
      ];
    }
    if (stage >= STAGE_MARKED) {
      return [
        "Sergeant Tobyn asked me to point out the four bandits disguised as guards.",
        "",
        "I have marked all four disguised bandits.",
        "I should report back to <col=800000>Sergeant Tobyn</col> in Varrock Square.",
      ];
    }
    if (stage >= STAGE_MARKING) {
      return [
        "Sergeant Tobyn asked me to point out the four bandits disguised as guards.",
        "They are in the square or on the eastern road to the bank.",
        "",
        `I have marked ${correctGuardsMarked(player)} of the four disguised bandits.`,
      ];
    }
    if (stage >= STAGE_REPORT) {
      return [
        "<str>I followed the suspicious guard and overheard bandits planning to</str>",
        "<str>attack the Varlamorian delegation disguised as guards.</str>",
        "",
        "I should tell <col=800000>Sergeant Tobyn</col> in Varrock Square.",
      ];
    }
    if (stage >= STAGE_TAILED) {
      return [
        "The suspicious guard entered a house in south-east Varrock.",
        "",
        "I should look inside and see what he is up to.",
      ];
    }
    if (stage >= STAGE_TAILING) {
      return [
        "I am following the suspicious guard through south-east Varrock.",
        "",
        "I must stay hidden from him and not fall too far behind.",
      ];
    }
    if (stage >= STAGE_DELEGATION) {
      return [
        "The Varlamorian delegation has arrived at Varrock Palace.",
        "",
        "I noticed a guard carrying a suspiciously large bag.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Alina told me about the delegation from Varlamore.",
        "",
        "I should ask her when the delegation will arrive.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Noah</col> or",
      "<col=800000>Alina</col> in Varrock Square, behind Eliza's stall.",
    ];
  }

  api.persistAttribute(MET_ALINA_ATTRIBUTE);
  api.persistAttribute(GUARDS_ATTRIBUTE);
  api.persistAttribute(TAIL_FAIL_ATTRIBUTE);
  api.persistAttribute(SCHEMA_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "children_of_the_sun",
    name: "Children of the Sun",
    varpId: VARP_CHILDREN_OF_THE_SUN,
    varbitId: STAGE_VARBIT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [],
    otherRewards: ["Access to Varlamore through the Quetzal Transport System and fairy rings"],
    buildJournal,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onCustomEvent("door:toggle", handleDoorToggle);
  api.onNpcInteraction("Guard", { Mark: markGuard, Unmark: unmarkGuard });
  api.onPlayerProcess(handlePlayerProcess);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
