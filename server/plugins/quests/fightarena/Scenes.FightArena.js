/**
 * Fight Arena's cutscenes and fights, as live plays them (rsprox recording local 1001680, rev 241, the whole
 * quest; local 1002138, rev 242, plays the same camera, actors, timings and fight copies). Ticks below are
 * the rev 241 recording's unless they say otherwise.
 *
 * Every scene plays in a copy of the arena (13 x 13 chunks from 2568,3120, every plane), with the
 * cutscene versions of the cast (sammy_servil_cutscene, justin_servil_cutscene,
 * general_khazard_cutscene, the guards and the caged beasts), the doors swapped for their noop
 * versions and the client's cutscene state on: the screen fades out, two ticks later the copy is
 * built with the side tabs closed, then the camera and the fade back in. Each fight then plays in a
 * copy of its own (see FIGHTS below), left through its escape door.
 *
 * - The cell (ticks 7459-7513): Sammy's keys conversation, "A cutscene begins.": the cell opens,
 *   Sammy runs off to the arena, the player follows him in, and the ogre's pen opens and the ogre
 *   hits Justin. The ogre fight starts (stage 6, the keys go).
 * - The ogre's death (7568-7631): General Khazard, two guards and the Servils meet the player; his
 *   talk ends with the guards taking the player to the jail, where Hengrad speaks first.
 * - Hengrad's "you'll be going back into the arena" (7664-7690): a guard brings the player in, the
 *   Khazards' lines, then the scorpion's pen opens (arenaquest_scorpion_cutscene).
 * - The scorpion's death (7723-7744): Khazard calls for Bouncer, whose pen opens
 *   (arenaquest_bouncer_cutscene).
 * - Bouncer's death (7892-7941): Khazard's anger, the Servils escorted out (stage 12), and
 *   Khazard's own fight.
 *
 * The words are the "Fight Arena" transcript's; each scene carries on the conversation after the
 * action step that started it.
 */
const CameraShake = require("../../interface/CameraShake.plugin");
const { createQuestScenes } = require("../QuestScenes");
const { startTranscript } = require("../QuestRuntime");

const PAGE = "Fight Arena";
const SCENE_EXIT_ATTRIBUTE = "fight-arena:scene-exit";
const SCORPION_SEEN_ATTRIBUTE = "fight-arena:scorpion-cutscene-seen";
const BOUNCER_SEEN_ATTRIBUTE = "fight-arena:bouncer-cutscene-seen";

const INSTANCE = { sourceChunk: [2568 >> 3, 3120 >> 3], size: 13 };
/**
 * Where a logout in an arena scene comes back: outside the arena door, where the escape door leaves the player
 * (live's fights are copies too, so the real arena floor holds no fight to come back to).
 */
const OUTSIDE_ARENA = [2607, 3151, 0];
/** Where the player moves in any of the scenes: the cells' corridor, the arena and its stands. */
const BOUNDS = [[2585, 2625, 3135, 3185, 0]];

/** The scenes' client state (tick 7461) and the script live runs with it. */
const SCENE_VARBITS = [["fov_clamp", 3], ["draw_distance_max_override", 1], ["option_hide_rooftops_override", 2]];
const SCENE_VARPS = [["option_areasounds_override", 25], ["areasounds_override", 1]];
const SETTINGS_SET_DRAW_DISTANCE_SCRIPT = 6021;

const CAST = {
  sammy: "sammy_servil_cutscene",
  justin: "justin_servil_cutscene",
  khazard: "general_khazard_cutscene",
  guard4: "arena_guard4_cutscene",
  guard5: "arena_guard5_cutscene",
  ogre: "arena_ogre_cutscene",
  scorpion: "arena_scorpion_cutscene",
  bouncer: "arena_bouncer_cutscene",
};
/** The chatheads the scenes' lines show (if_setnpchead): the cutscene versions. */
const SPEAKERS = { "General Khazard": CAST.khazard, "Sammy Servil": CAST.sammy, "Justin Servil": CAST.justin };

/** Doors and gates swapped for versions with no ops while a scene plays (every scene, tick 7461). */
const NOOP_LOCS = [
  ["poordoor_noop", 2617, 3171, 0, 1],
  ["poordoor_noop", 2608, 3181, 0, 3],
  ["arena_prisondoor_noop", 2617, 3167, 0, 0],
  ["arena_prisondoor_noop", 2617, 3163, 0, 0],
  ["castledoubledoorl_noop", 2594, 3180, 0, 1],
  ["castledoubledoorr_noop", 2595, 3180, 0, 1],
  ["poordoor_noop", 2606, 3153, 9, 1],
  ["invisable_nonblocking_wall_noshadow", 2606, 3152, 9, 0],
  ["arena_prisondoor_noop", 2617, 3159, 0, 0],
];
const WALL = "invisable_nonblocking_wall_noshadow";
/** Sammy's cell door swinging open (7470) and shut again (7473). */
const CELL_OPEN = [[WALL, 2617, 3167, 0, 0], ["arena_prisondoor_noop", 2616, 3167, 0, 1]];
const CELL_SHUT = [["arena_prisondoor_noop", 2617, 3167, 0, 0], [WALL, 2616, 3167, 0, 1]];

/** A pen's two gates (north gate on `top`, south on `top - 1`) opening for its beast, then closing. */
function penGates(top) {
  return {
    open: [["arena_inactivegate", 2607, top, 0, 1], [WALL, 2606, top, 0, 2], ["arena_inactivegate_r", 2607, top - 1, 0, 3], [WALL, 2606, top - 1, 0, 2]],
    shut: [[WALL, 2607, top, 0, 1], ["arena_inactivegate", 2606, top, 0, 2], [WALL, 2607, top - 1, 0, 3], ["arena_inactivegate_r", 2606, top - 1, 0, 2]],
  };
}
const OGRE_PEN = penGates(3166);
const SCORPION_PEN = penGates(3160);
const BOUNCER_PEN = penGates(3163);

/** The caged beasts every scene but the last shows in their pens, facing out (west). */
const PENNED = {
  ogre: [CAST.ogre, [2608, 3165, 0], [2595, 3165]],
  scorpion: [CAST.scorpion, [2608, 3159, 0], [2588, 3159]],
  bouncer: [CAST.bouncer, [2608, 3162, 0], [2588, 3162]],
};
/** Khazard, his guard and the Servils on the stand, watching the arena (7666, 7725, 7894). */
const STAND = {
  sammy: [CAST.sammy, [2603, 3153, 0], [2603, 3163]],
  justin: [CAST.justin, [2602, 3153, 0], [2602, 3163]],
  khazard: [CAST.khazard, [2600, 3153, 0], [2600, 3173]],
  guard4: [CAST.guard4, [2606, 3154, 0], [2596, 3164]],
};

const SCENES = {
  cell: {
    variant: "getting-the-keys-talking-to-sammy-servil-after-getting-the-keys",
    exit: [2617, 3166, 0],
    at: [2617, 3168, 0], face: [2617, 3165],
    cast: { ...PENNED, sammy: [CAST.sammy, [2616, 3167, 0], [2618, 3167]] },
    camera: [[2617, 3158, 500], [2617, 3170, 220]],
    speakAfter: "xgLOXp",
    // From "A cutscene begins." (7459): the copy 7461, camera 7462, fade in 7463, "the coast is clear" 7465.
    open: 2, cameraAt: 3, fadeIn: 4, speak: 6,
  },
  ogre: {
    variant: "the-battles-upon-killing-the-khazard-ogre",
    exit: OUTSIDE_ARENA,
    at: [2599, 3159, 0], face: [2619, 3139],
    cast: {
      justin: [CAST.justin, [2598, 3159, 0], [2618, 3139]],
      khazard: [CAST.khazard, [2604, 3153, 0], [2584, 3173]],
      guard5: [CAST.guard5, [2605, 3155, 0], [2585, 3175]],
      guard4: [CAST.guard4, [2603, 3153, 0], [2583, 3173]],
      sammy: [CAST.sammy, [2599, 3160, 0], [2619, 3140]],
      scorpion: PENNED.scorpion, bouncer: PENNED.bouncer,
    },
    // 7571-7573: the player and the Servils walk three tiles south-east, into Khazard's way.
    walks: { player: [2602, 3156, 0], justin: [2601, 3156, 0], sammy: [2602, 3157, 0] },
    camera: [[2601, 3165, 600], [2604, 3149, 300]],
    // From the ogre's death (7568): copy 7570, walk and camera 7571, fade in 7572, Khazard 7575.
    open: 2, cameraAt: 3, fadeIn: 4, speak: 7,
  },
  scorpion: {
    variant: "the-battles-talking-to-hengrad-in-the-jail-cell",
    exit: OUTSIDE_ARENA,
    at: [2608, 3150, 0], face: [2604, 3154],
    cast: { ...STAND, guard5: [CAST.guard5, [2609, 3149, 0], [2599, 3159]], scorpion: PENNED.scorpion, bouncer: PENNED.bouncer },
    walks: { player: [2604, 3155, 0] },
    camera: [[2601, 3164, 600], [2605, 3149, 400]],
    // Hengrad's conversation carries on after its "brought into the arena" step.
    speakAfter: "XDkdB3",
    // The guard behind the player (7668, 7670), two tiles a move.
    moves: [[4, "guard5", [2607, 3151, 0]], [6, "guard5", [2605, 3153, 0]]],
    // From Hengrad's last line (7664): copy 7666, camera 7667, fade in 7668, Khazard 7672.
    open: 2, cameraAt: 3, fadeIn: 4, speak: 8,
  },
  bouncer: {
    variant: "the-battles-upon-killing-the-scorpion",
    exit: OUTSIDE_ARENA,
    at: [2604, 3155, 0], face: [2604, 3158],
    cast: { ...STAND, bouncer: PENNED.bouncer },
    camera: [[2601, 3159, 460], [2609, 3164, 60]],
    // From the scorpion's death (7723): copy 7725, camera 7726, fade in 7727, Khazard 7729.
    open: 2, cameraAt: 3, fadeIn: 4, speak: 6,
  },
  khazard: {
    variant: "the-battles-upon-killing-bouncer",
    exit: OUTSIDE_ARENA,
    at: [2601, 3159, 0], face: [2601, 3156],
    cast: { ...STAND, khazard: [CAST.khazard, [2600, 3153, 0], [2604, 3173]] },
    walks: { player: [2601, 3156, 0] },
    camera: [[2599, 3164, 590], [2603, 3149, 390]],
    // From Bouncer's death (7892): copy 7894, walk and camera 7895, fade in 7896, Khazard 7899.
    open: 2, cameraAt: 3, fadeIn: 4, speak: 7,
  },
};

/**
 * A pen's release, from the continue that starts it: the camera on the pen, the beast moved two
 * tiles a move through its opening gates, the gates shut behind it, the seen-flag and the fade out
 * with its last move, the scene's end and the fight two ticks later, the fade in two after that.
 */
const RELEASES = {
  // "Quick, help him!" continued (7497): Justin and the camera at once, the ogre 7498-7502,
  // Justin hit 7505-7506, stage 6 and the fade 7509, the fight 7511, fade in 7513.
  ogre: {
    beast: "ogre", gates: OGRE_PEN,
    camera: [0, [2600, 3161, 490], [2609, 3167, 15]],
    pan: [3, [2600, 3157, 490], [2602, 3167, 200], { rate: 2, rate2: 0 }],
    moves: [[1, [2606, 3165, 0]], [3, [2604, 3165, 0]], [5, [2602, 3165, 0]]],
    gatesOpen: 1, gatesShut: 4, attack: 8, fadeOut: 12, fight: 14, fadeIn: 16,
  },
  // "Ignore him! You can do it!" continued (7680): camera 7681, the scorpion 7682-7686, the
  // varbit and the fade 7686, the fight 7688, fade in 7690.
  scorpion: {
    beast: "scorpion", gates: SCORPION_PEN, seen: SCORPION_SEEN_ATTRIBUTE, varbit: "arenaquest_scorpion_cutscene",
    camera: [1, [2601, 3156, 500], [2609, 3161, 100]],
    moves: [[2, [2606, 3159, 0]], [4, [2604, 3159, 0]], [6, [2602, 3159, 0]]],
    gatesOpen: 2, gatesShut: 5, fadeOut: 6, fight: 8, fadeIn: 10,
  },
  // "Bring on Bouncer!" continued (7735): Bouncer 7736-7740, the varbit and the fade 7740, the
  // fight 7742, fade in 7744.
  bouncer: {
    beast: "bouncer", gates: BOUNCER_PEN, seen: BOUNCER_SEEN_ATTRIBUTE, varbit: "arenaquest_bouncer_cutscene",
    moves: [[1, [2606, 3162, 0]], [3, [2604, 3162, 0]], [5, [2602, 3162, 0]]],
    gatesOpen: 1, gatesShut: 4, fadeOut: 5, fight: 7, fadeIn: 9,
  },
};

/**
 * The fights (rev 242 recording local 1002138, ticks 11838, 11991, 12036, 12204; rev 241 local 1001680 the same
 * tiles): each plays in its own copy of the arena, 13 x 13 chunks from 2552,3104, with the arena's guards, slaves
 * and stand copied in, the beasts still to come caged (their cutscene versions, facing out), and the arena door
 * swapped for fightarena_door2_escape. The player and the beast start on live's tiles.
 */
const FIGHT_INSTANCE = { sourceChunk: [2552 >> 3, 3104 >> 3], size: 13 };
/** The whole copy: only the escape door, a teleport, a death or a logout ends a fight, never a step. */
const FIGHT_BOUNDS = [[2552, 2655, 3104, 3207, 0]];
/** Live's copy carries the arena building's NPCs: the cells, the stands and the pens. */
const POPULACE_BOX = [2575, 2620, 3135, 3185];
/** A spawn row without a wanderRadius walks within 5 tiles (docs/npc-spawns.md). */
const SPAWN_WANDER_RADIUS = 5;
/** Where the escape door leaves the player, on the real map (ticks 12212 and 7951). */
const ESCAPE_TILE = OUTSIDE_ARENA;
const ESCAPE_DOOR = ["fightarena_door2_escape", 2606, 3152, 9, 0];
/** The real map's cage rows (multinpcs on arenaquest): a copy shows its own pens instead. */
const CAGES = ["arena_ogre_cage", "arena_scorpion_cage", "arena_bouncer_cage"];
const FIGHTS = {
  ogre: { at: [2605, 3153, 0], beast: ["arena_ogre", [2602, 3165, 0], [2582, 3165]], pens: ["scorpion", "bouncer"] },
  scorpion: { at: [2604, 3155, 0], beast: ["arena_scorpion", [2601, 3159, 0], [2581, 3159]], pens: ["bouncer"] },
  bouncer: { at: [2604, 3155, 0], beast: ["arena_bouncer", [2603, 3162, 0], [2583, 3162]], pens: [] },
  // Khazard himself stands where his stand form did (tick 12205), so that form stays out of the copy.
  khazard: { at: [2601, 3156, 0], beast: ["general_khazard", [2600, 3153, 0], [2600, 3173]], pens: [], without: ["general_khazard_arena"] },
};
/** The escape's fade, the move two ticks later, the fade in two after that (ticks 7949, 7951, 7953). */
const ESCAPE_MOVE_TICKS = 2;
const ESCAPE_FADE_IN_TICKS = 2;

/** The line whose continue releases a pen (it is the last of its conversation). */
const RELEASE_LINES = new Map([
  ["Ignore him! You can do it!", "scorpion"],
  ["Impressive, but now for a proper challenge. Time for my puppy. Bring on Bouncer!", "bouncer"],
]);

const OPEN_CELL_SEQ = "human_opendoor_weapon";
const JUSTIN_BLOCK_SEQ = "human_unarmedblock";
const OGRE_ATTACK_SEQ = "ogre_attack";

/**
 * `hooks` are the quest's: `startFight(player, kind, { player, beast })` puts the player and the
 * fight's beast on the real map, `jailed(player)` and `ogreFight(player)` / `khazardAttacks(player)`
 * move the stage where live moves it, `stage(player)` reads it.
 */
module.exports = function createFightArenaScenes(api, hooks) {
  const { Animation, CacheDefinitions, Location } = api.core;
  const Scenes = createQuestScenes(api, { onEnd: sceneEnded, recoveryAttribute: SCENE_EXIT_ATTRIBUTE });
  /** player -> { kind, scene, actors }: a scene from its fade out (before the copy) to its end. */
  const playing = new Map();

  function gameval(kind, name) {
    const id = kind === "npc" ? CacheDefinitions.getNpcId(name)
      : kind === "loc" ? CacheDefinitions.getLocId(name)
        : kind === "seq" ? CacheDefinitions.getSeqId(name)
          : kind === "varbit" ? CacheDefinitions.getVarbitId(name) : CacheDefinitions.getVarpId(name);
    if (!Number.isInteger(id)) throw new Error(`Fight Arena: no ${kind} ${name} in the cache.`);
    return id;
  }

  /** Runs `callback` after `ticks` while `state` is still the player's scene. */
  function later(player, state, ticks, callback) {
    const run = () => { if (playing.get(player) === state && player.isRegistered?.() !== false) callback(); };
    if (ticks <= 0) return run();
    Scenes.later(state.scene ?? player, ticks, run);
  }

  function sceneVars(player, on) {
    const sender = player.getPacketSender();
    for (const [name, value] of SCENE_VARBITS) sender.sendVarbit(gameval("varbit", name), on ? value : 0);
    for (const [name, value] of SCENE_VARPS) sender.sendConfig(gameval("varp", name), on ? value : 0);
    sender.sendInterfaceScript(SETTINGS_SET_DRAW_DISTANCE_SCRIPT);
  }

  function locs(state, list) {
    for (const [name, x, y, type, face] of list) Scenes.loc(state.scene, { id: gameval("loc", name), x, y, type, face });
  }

  function moveActor(state, name, tile) {
    const npc = state.actors[name];
    if (npc) npc.moveTo(Scenes.tileFor(npc, tile));
  }

  /** The player walks in the scene: their own steps, then held again once there. */
  function walkPlayer(player, state, tile, ticks) {
    player.getMovementQueue().setBlockMovement(false);
    Scenes.walk(player, tile);
    later(player, state, ticks, () => player.getMovementQueue().setBlockMovement(true));
  }

  /** The fade out and the held chat that start every scene; the copy follows `spec.open` ticks later. */
  function begin(player, kind) {
    if (playing.has(player)) return null;
    const state = { kind, scene: null, actors: {} };
    playing.set(player, state);
    player.getMovementQueue().reset().setBlockMovement(true);
    Scenes.hold(player);
    Scenes.fade(player, true);
    const spec = SCENES[kind];
    later(player, state, spec.open, () => openScene(player, state, spec));
    later(player, state, spec.cameraAt, () => Scenes.camera(player, ...spec.camera));
    later(player, state, spec.fadeIn, () => Scenes.fade(player, false));
    return state;
  }

  function openScene(player, state, spec) {
    state.scene = Scenes.open(player, `Fight Arena ${state.kind}`, BOUNDS, { canTeleport: () => false, canAttack: () => false },
      { instance: INSTANCE, at: spec.at, exit: spec.exit });
    Scenes.face(player, spec.face);
    Scenes.controls(player, true, true);
    sceneVars(player, true);
    Scenes.hideTabs(player);
    for (let axis = 0; axis < 5; axis++) CameraShake.send(player.getPacketSender(), "atmospheric", axis, 0);
    for (const [name, [npc, tile, face]] of Object.entries(spec.cast)) {
      state.actors[name] = Scenes.actor(state.scene, gameval("npc", npc), tile, face);
    }
    locs(state, NOOP_LOCS);
    const walks = spec.walks ?? {};
    // Tasks queued on the scene now run with it; the walks start the tick after the copy.
    Scenes.later(state.scene, 1, () => {
      for (const [name, tile] of Object.entries(walks)) {
        if (name === "player") walkPlayer(player, state, tile, 4);
        else Scenes.walk(state.actors[name], tile);
      }
    });
    for (const [tick, name, tile] of spec.moves ?? []) later(player, state, tick - spec.open, () => moveActor(state, name, tile));
    later(player, state, spec.speak - spec.open, () => carryOn(player, spec.variant, spec.speakAfter ?? null));
  }

  /** Plays the scene's conversation from the step after `afterId` (its start when null). */
  function carryOn(player, variant, afterId = null) {
    // The conversation's own NPC: Sammy's in the cell, Khazard's otherwise (both cutscene versions).
    const npcId = gameval("npc", variant === SCENES.cell.variant ? CAST.sammy : CAST.khazard);
    return startTranscript(api, player, npcId, PAGE, variant, (steps) => {
      if (!afterId) return steps;
      const index = steps.findIndex((step) => step.id === afterId);
      return index < 0 ? [] : steps.slice(index + 1);
    });
  }

  /** The scene's end two ticks after its fade out: the fight on the real map, the fade in after that. */
  function finish(player, state, kind, fadeInAfter) {
    Scenes.end(player, false);
    player.getMovementQueue().reset().setBlockMovement(true);
    Scenes.hold(player);
    hooks.startFight(player, kind);
    Scenes.later(player, fadeInAfter, () => {
      if (player.isRegistered?.() === false) return;
      Scenes.fade(player, false);
      player.getMovementQueue().setBlockMovement(false);
      player.getDialogueManager().reset?.();
      player.getPacketSender().sendInterfaceRemoval();
    });
  }

  // ---- the fights ----------------------------------------------------------------------------------------

  /** player -> { kind, scene, beast, leaving }: a fight's copy while the player is in it. */
  const fights = new Map();
  const fightScenes = new WeakSet();

  /**
   * The arena building's own world spawns, copied in as the copy's actors: what live's copy shows at this stage
   * (the multinpcs resolve on the player's arenaquest as the real map's do). Read from the spawn table, so the
   * copy does not depend on the real region's NPCs being spawned.
   */
  function populate(player, scene, without) {
    const skip = new Set([...CAGES, ...without].map((name) => gameval("npc", name)));
    const [minX, maxX, minY, maxY] = POPULACE_BOX;
    for (const spawn of api.core.NpcSpawnDefinition.all()) {
      const home = spawn.getPosition();
      if (skip.has(spawn.getId()) || home.getZ() !== 0) continue;
      if (home.getX() < minX || home.getX() > maxX || home.getY() < minY || home.getY() > maxY) continue;
      Scenes.actor(scene, spawn.getId(), [home.getX(), home.getY(), 0], null, {
        wanderRadius: spawn.getRadius() ?? SPAWN_WANDER_RADIUS,
        direction: spawn.getFacing()?.getId?.(),
      });
    }
  }

  /** The beast comes for the player, as live's walks out at once (tick 11840) and Khazard hits first (12206). */
  function spawnBeast(player, fight, kind) {
    const [name, tile, face] = FIGHTS[kind].beast;
    const npc = Scenes.actor(fight.scene, gameval("npc", name), tile, face);
    fight.beast = npc;
    // From the tick after it appears, as live's first step is (ticks 11840, 12206): on its own tick the player is
    // still being placed in the copy, and combat drops a target it can't yet reach.
    if (npc) Scenes.later(fight.scene, 1, () => {
      if (npc.isRegistered?.() !== false && fight.beast === npc) npc.getCombat?.().attack?.(player);
    });
    return npc;
  }

  /**
   * The player's fight against `kind` in its own copy: the arena's NPCs, the caged beasts still to come, the
   * escape door, the beast. A teleport, a death or a logout leaves it at the door outside; the stage stays.
   */
  function fight(player, kind) {
    const spec = FIGHTS[kind];
    if (!spec) throw new Error(`Fight Arena: no fight ${kind}.`);
    const holder = { kind, scene: null, beast: null, leaving: false };
    const scene = Scenes.open(player, `Fight Arena ${kind} fight`, FIGHT_BOUNDS, {
      // Teleports and aggression follow the normal rules; the copy's beast is the one that comes for the player.
      canTeleport: () => null,
      npcAggression: (target, npc) => (npc === holder.beast ? null : false),
    }, { instance: FIGHT_INSTANCE, at: spec.at, exit: ESCAPE_TILE });
    holder.scene = scene;
    fightScenes.add(scene);
    fights.set(player, holder);
    populate(player, scene, spec.without ?? []);
    holder.pens = {};
    for (const pen of spec.pens) {
      const [npc, tile, face] = PENNED[pen];
      holder.pens[pen] = Scenes.actor(scene, gameval("npc", npc), tile, face);
    }
    locs(holder, [ESCAPE_DOOR]);
    Scenes.face(player, spec.beast[1]);
    spawnBeast(player, holder, kind);
    return holder;
  }

  /** The next beast in the fight the player is in (a pen scene already seen); a new copy when there is none. */
  function nextBeast(player, kind) {
    const holder = fights.get(player);
    if (!holder || Scenes.get(player) !== holder.scene) return fight(player, kind);
    holder.kind = kind;
    // The beast leaves its pen: its caged version goes from the copy.
    const caged = holder.pens?.[kind];
    if (caged) {
      Scenes.removeActor(holder.scene, caged);
      delete holder.pens[kind];
    }
    spawnBeast(player, holder, kind);
    return holder;
  }

  /** "Escape" asks first (tick 7948); "Quick-escape" is the same way out without the question. */
  function escape(player, quick) {
    const holder = fights.get(player);
    if (!holder || Scenes.get(player) !== holder.scene || holder.leaving) return false;
    if (quick) {
      leave(player, holder);
      return true;
    }
    const { DialogueChainBuilder, OptionDialogue } = api.core;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new OptionDialogue(0, {
      executeOption(option) {
        player.getDialogueManager().reset();
        if (Number(option) === 1) leave(player, holder);
      },
    }, "Yes.", "No.").setTitle("Are you sure you want to leave?")));
    return true;
  }

  /** "Yes.": the fade out at once, the real map outside the door two ticks later, the fade in after two more. */
  function leave(player, holder) {
    holder.leaving = true;
    // The fight stops with the answer: live's Yes sets busy and clears the HP HUD (local 1002138 tick 12214),
    // and the minimap goes the tick after (12215). Nothing more can hit, or be hit, in the dark.
    player.getCombat().reset();
    holder.beast?.getCombat?.().reset?.();
    Scenes.controls(player, true);
    player.setUntargetable(true);
    Scenes.fade(player, true);
    Scenes.later(player, ESCAPE_MOVE_TICKS, () => {
      if (fights.get(player) !== holder || player.isRegistered?.() === false) return;
      Scenes.end(player, false);
      player.moveTo(new Location(...ESCAPE_TILE));
      Scenes.controls(player, true);
      Scenes.later(player, ESCAPE_FADE_IN_TICKS, () => {
        // A scene opened since (a re-entry) owns the player's controls now.
        if (player.isRegistered?.() === false || Scenes.get(player) || playing.has(player)) return;
        Scenes.fade(player, false);
        Scenes.controls(player, false);
      });
    });
  }

  /** The player chose to leave this fight: a hit still landing on its beast counts for nothing. */
  function leaving(player) {
    return fights.get(player)?.leaving === true;
  }

  function inFight(player) {
    const holder = fights.get(player);
    return !!holder && Scenes.get(player) === holder.scene;
  }

  function release(player, state, kind) {
    const spec = RELEASES[kind];
    const sender = player.getPacketSender();
    Scenes.hold(player);
    if (spec.camera) later(player, state, spec.camera[0], () => Scenes.camera(player, spec.camera[1], spec.camera[2]));
    if (spec.pan) later(player, state, spec.pan[0], () => Scenes.camera(player, spec.pan[1], spec.pan[2], spec.pan[3]));
    later(player, state, spec.gatesOpen, () => locs(state, spec.gates.open));
    later(player, state, spec.gatesShut, () => locs(state, spec.gates.shut));
    for (const [tick, tile] of spec.moves) later(player, state, tick, () => moveActor(state, spec.beast, tile));
    if (spec.attack !== undefined) {
      later(player, state, spec.attack, () => {
        state.actors.justin?.performAnimation(new Animation(gameval("seq", JUSTIN_BLOCK_SEQ)));
        state.actors.ogre?.performAnimation(new Animation(gameval("seq", OGRE_ATTACK_SEQ)));
        if (state.actors.ogre) Scenes.face(state.actors.ogre, [2597, 3164]);
      });
    }
    later(player, state, spec.fadeOut, () => {
      if (spec.seen) {
        player.setAttribute(spec.seen, 1);
        sender.sendVarbit(gameval("varbit", spec.varbit), 1);
      }
      if (kind === "ogre") hooks.ogreFight(player);
      Scenes.fade(player, true);
    });
    later(player, state, spec.fight, () => finish(player, state, kind, spec.fadeIn - spec.fight));
  }

  // ---- the scenes' starts and their action steps -------------------------------------------------------------

  /** "A cutscene begins." in Sammy's keys conversation. */
  function cellScene(player) {
    return begin(player, "cell") !== null;
  }

  /** "The player unlocks Sammy's cell and Sammy steps out." (7470-7473). */
  function unlockCell(player) {
    const state = playing.get(player);
    if (state?.kind !== "cell" || !state.scene) return false;
    Scenes.hold(player);
    player.performAnimation(new Animation(gameval("seq", OPEN_CELL_SEQ)));
    locs(state, CELL_OPEN);
    later(player, state, 1, () => moveActor(state, "sammy", [2617, 3167, 0]));
    later(player, state, 2, () => state.actors.sammy && Scenes.face(state.actors.sammy, [2617, 3174]));
    later(player, state, 3, () => {
      locs(state, CELL_SHUT);
      carryOn(player, SCENES.cell.variant, "-GpvYE");
    });
    return true;
  }

  /** "Sammy walks off." (7481): south down the corridor while the player calls after him. */
  function sammyRuns(player) {
    const state = playing.get(player);
    if (state?.kind !== "cell" || !state.actors.sammy) return false;
    Scenes.walk(state.actors.sammy, [2617, 3159, 0]);
    return true;
  }

  /** "The player follows Sammy into the Fight Arena." (7484-7493). */
  function followSammy(player) {
    const state = playing.get(player);
    if (state?.kind !== "cell" || !state.scene) return false;
    Scenes.hold(player);
    later(player, state, 1, () => walkPlayer(player, state, [2617, 3164, 0], 4));
    later(player, state, 3, () => Scenes.fade(player, true));
    later(player, state, 5, () => {
      Scenes.place(player, [2608, 3150, 0]);
      Scenes.face(player, [2604, 3154]);
      moveActor(state, "sammy", [2603, 3153, 0]);
      if (state.actors.sammy) Scenes.face(state.actors.sammy, [2599, 3168]);
    });
    later(player, state, 6, () => {
      walkPlayer(player, state, [2605, 3153, 0], 2);
      Scenes.camera(player, [2601, 3162, 490], [2606, 3149, 210]);
    });
    later(player, state, 7, () => Scenes.fade(player, false));
    later(player, state, 9, () => {
      Scenes.face(player, [2600, 3163]);
      carryOn(player, SCENES.cell.variant, "0Xedz5");
    });
    return true;
  }

  /** "The Khazard Ogre's cage is unlocked, and it attacks Jimmy Servil." */
  function ogreAttacks(player) {
    const state = playing.get(player);
    if (state?.kind !== "cell" || !state.scene) return false;
    state.actors.justin = Scenes.actor(state.scene, gameval("npc", CAST.justin), [2601, 3165, 0], [2608, 3166]);
    release(player, state, "ogre");
    return true;
  }

  /** The ogre's death: Khazard's scene, his conversation and the way to the jail. */
  function ogreDied(player) {
    return begin(player, "ogre") !== null;
  }

  /**
   * "The player is taken to a jail cell." (7625-7631): the stage, the fade, the jail two ticks
   * later and Hengrad's own conversation two ticks after the fade in.
   */
  function takenToJail(player) {
    const state = playing.get(player);
    if (state?.kind !== "ogre" || !state.scene) return false;
    hooks.jailed(player);
    Scenes.hold(player);
    Scenes.fade(player, true);
    later(player, state, 2, () => {
      Scenes.end(player, false);
      player.getMovementQueue().reset().setBlockMovement(true);
      Scenes.hold(player);
      hooks.startFight(player, "jail");
      Scenes.later(player, 2, () => {
        if (player.isRegistered?.() === false) return;
        Scenes.fade(player, false);
        player.getMovementQueue().setBlockMovement(false);
      });
      Scenes.later(player, 4, () => {
        if (player.isRegistered?.() === false || hooks.stage(player) !== hooks.STAGE_SENT_JAIL) return;
        startTranscript(api, player, hooks.HENGRAD_NPC_ID, PAGE, SCENES.scorpion.variant);
      });
    });
    return true;
  }

  /** "The player is brought into the arena." in Hengrad's conversation; once seen, straight to the fight. */
  function scorpionScene(player) {
    if (player.getAttribute(SCORPION_SEEN_ATTRIBUTE) === 1) return false;
    return begin(player, "scorpion") !== null;
  }

  /** The scorpion's death: Khazard calls for Bouncer, unless that scene was seen already. */
  function scorpionDied(player) {
    if (player.getAttribute(BOUNCER_SEEN_ATTRIBUTE) === 1) return false;
    return begin(player, "bouncer") !== null;
  }

  function bouncerDied(player) {
    return begin(player, "khazard") !== null;
  }

  /** "General Khazard attacks the player." (7934-7941): the Servils led out, the stage, the fight. */
  function khazardAttacks(player) {
    const state = playing.get(player);
    if (state?.kind !== "khazard" || !state.scene) return false;
    Scenes.hold(player);
    moveActor(state, "sammy", [2605, 3153, 0]);
    moveActor(state, "justin", [2604, 3153, 0]);
    later(player, state, 2, () => {
      moveActor(state, "sammy", [2606, 3152, 0]);
      moveActor(state, "justin", [2605, 3153, 0]);
    });
    later(player, state, 3, () => {
      hooks.khazardAttacks(player);
      moveActor(state, "guard4", [2604, 3154, 0]);
      moveActor(state, "sammy", [2608, 3150, 0]);
      moveActor(state, "justin", [2607, 3151, 0]);
      Scenes.fade(player, true);
    });
    later(player, state, 5, () => finish(player, state, "khazard", 2));
    return true;
  }

  /** A line in a scene: the cutscene chathead, and the pens' releases on their lines' continue. */
  function line(event) {
    const state = playing.get(event.player);
    if (!state?.scene) return;
    const speaker = SPEAKERS[event.step?.speaker];
    if (speaker) event.speakerId = gameval("npc", speaker);
    const kind = RELEASE_LINES.get(event.text);
    if (kind && state.kind === kind) event.after = () => release(event.player, state, kind);
  }

  function active(player) {
    return playing.has(player);
  }

  /** The scene ended (its way out, a logout or the player walking out): its client state goes. */
  function sceneEnded(player, scene, logout) {
    // A fight's copy had no cutscene state of its own to put back.
    if (fightScenes.has(scene)) {
      if (fights.get(player)?.scene === scene) fights.delete(player);
      return;
    }
    const state = playing.get(player);
    if (state?.scene === scene) playing.delete(player);
    sceneVars(player, false);
    if (!logout) Scenes.restoreTabs(player);
    player.getPacketSender().sendCameraUnlock(false);
  }

  /** A logout mid-scene: the copy goes (its exit is saved), or before the copy only the controls come back. */
  function logout(player) {
    Scenes.cancel(player);
    const state = playing.get(player);
    if (!state) {
      // A fight: its copy goes and the player is saved at the door outside.
      if (Scenes.get(player)) Scenes.end(player, true);
      return;
    }
    if (state.scene) return Scenes.end(player, true);
    playing.delete(player);
    Scenes.controls(player, false);
    Scenes.closeFade(player);
  }

  /** The seen-flags live in arenaquest_secondary; the client gets them back at login. */
  function login(player) {
    const sender = player.getPacketSender();
    sender.sendVarbit(gameval("varbit", RELEASES.scorpion.varbit), player.getAttribute(SCORPION_SEEN_ATTRIBUTE) === 1 ? 1 : 0);
    sender.sendVarbit(gameval("varbit", RELEASES.bouncer.varbit), player.getAttribute(BOUNCER_SEEN_ATTRIBUTE) === 1 ? 1 : 0);
  }

  api.persistAttribute(SCORPION_SEEN_ATTRIBUTE, 0);
  api.persistAttribute(BOUNCER_SEEN_ATTRIBUTE, 0);

  return {
    PAGE, SCENES, RELEASES, SCORPION_SEEN_ATTRIBUTE, BOUNCER_SEEN_ATTRIBUTE, Scenes,
    cellScene, unlockCell, sammyRuns, followSammy, ogreAttacks, ogreDied, takenToJail, scorpionScene, scorpionDied,
    bouncerDied, khazardAttacks, line, active, logout, login,
    fight, nextBeast, escape, inFight, leaving, FIGHTS, ESCAPE_TILE, ESCAPE_DOOR_NAME: ESCAPE_DOOR[0],
  };
};
