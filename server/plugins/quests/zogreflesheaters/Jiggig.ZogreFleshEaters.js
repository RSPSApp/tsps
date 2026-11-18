/**
 * Zogre Flesh Eaters at Jiggig, as the revision 242 capture plays it (rsprox ZogreFleshEaters.bin;
 * docs/quests/zogre-flesh-eaters/README.md "Capture facts"):
 *
 * - The barricade guard (864) crushes the barricade: after "Ok, I opens da stoppa's..." the chat
 *   closes, the guard kicks (seq 2102, sound 2565) two ticks on, the stage and
 *   `thzfe_blocking_barricade` (496) are set a tick later (sound 1954), and "Ok der' yous goes!"
 *   follows two ticks after that (ticks 296-301). The crushed barricade is the player's own view of
 *   the multiloc 6878/6879 (496 = 1 shows "Crushed barricade", Climb-over); nothing changes for
 *   anyone else. Before the quest the guard says only his first line (tick 101).
 * - Climb-over hops the player two tiles across the barricade (exactmove 20/50 cycles, seq 1236
 *   at 20, sound 1953; ticks 310-326).
 * - The four tomb stairs: the "You climb ..." line, the stair sound (1952 down / 1956 up) and a
 *   fade-out on arrival, the player moved three ticks later, the fade back in four ticks after
 *   that (ticks 375-385, 2399-2409, 2690-2699, 2738-2749).
 * - Walking into the blackened north-west room for the first time plays its scene once
 *   (`thzfe_cut_scene` 505): the chat line, then the message box held for 17 ticks while the
 *   camera pans over the room, the camera back on Continue (ticks 417-436).
 */
const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");
const { STAGES, ATTRIBUTES } = require("./State.ZogreFleshEaters");

const BARRICADE_GUARD_ID = 864;
const GUARD_KICK_SEQ = 2102;
const GUARD_KICK_SOUND = 2565;
const BARRICADE_CRUSH_SOUND = 1954;
const CLIMB_SEQ = 1236;
const CLIMB_SOUND = 1953;
const STAIRS_DOWN_SOUND = 1952;
const STAIRS_UP_SOUND = 1956;
const CRUSH_STEP_ID = "izwjnR";

/** The stair placements and their captured landing tiles. */
const STAIRS = [
  { id: 6841, x: 2485, y: 3042, z: 0, down: true, to: [2477, 9437, 2] },
  { id: 6842, x: 2478, y: 9437, z: 2, down: false, to: [2485, 3045, 0] },
  { id: 6841, x: 2443, y: 9417, z: 2, down: true, to: [2442, 9418, 0] },
  { id: 6842, x: 2443, y: 9417, z: 0, down: false, to: [2446, 9417, 2] },
];
const CLIMB_DOWN_TEXT = "You climb down the steps.";
const CLIMB_UP_TEXT = "You climb up the steps.";

/**
 * The north-west room. The capture enters it at (2447, 9462) from the east (tick 417); the rest
 * of the box is Ours: the room's walls, from the map.
 */
const NORTH_WEST_ROOM = [2430, 2447, 9452, 9470, 2];
const ROOM_VARIANT = "entering-jiggig-entering-the-north-west-room";
const ROOM_BOX_STEP = "lVCtQz";
const ROOM_CHAT_STEP = "fgfA1p";
const ROOM_BOX_HOLD_TICKS = 17;
/** The camera's path, [tick, move [x, y, height, rate], look [x, y, height, rate]] (ticks 417-433). */
const ROOM_CAMERA = [
  [0, [2445, 9460, 400, 4], [2441, 9459, 25, 15]],
  [3, [2444, 9458, 400, 4], [2441, 9459, 25, 15]],
  [6, [2442, 9457, 400, 4], [2442, 9459, 25, 5]],
  [8, [2440, 9458, 400, 4], [2442, 9459, 25, 10]],
  [10, [2440, 9460, 400, 4], [2442, 9459, 25, 15]],
  [12, [2442, 9461, 400, 4], [2442, 9459, 25, 10]],
  [14, [2444, 9460, 400, 4], [2437, 9459, 25, 10]],
  [16, [2444, 9458, 400, 4], [2437, 9459, 25, 15]],
];

module.exports = function attachJiggig(api, ctx) {
  const { Animation, Boundary, CountdownTask, TaskManager } = api.core;
  ObstacleRunner.init(api);

  const stage = (player) => ctx.quest().getStage(player);

  /** 496 follows the stage: the barricade stays crushed for the player from the guard's kick on. */
  function barricadeValue(player) {
    return stage(player) >= STAGES.BARRICADE ? 1 : 0;
  }

  function later(player, ticks, callback) {
    TaskManager.submit(new CountdownTask(player, ticks, callback));
  }

  /** The guard's crush, held between his two lines as live times it. */
  function crush(event) {
    const { player, npc } = event;
    if (stage(player) !== STAGES.STARTED) {
      event.handled = true;
      return;
    }
    event.wait = (resume) => {
      later(player, 2, () => {
        npc?.performAnimation?.(new Animation(GUARD_KICK_SEQ));
        player.getPacketSender().sendSound(GUARD_KICK_SOUND, 1, 0);
        later(player, 1, () => {
          if (stage(player) < STAGES.BARRICADE) ctx.quest().setStage(player, STAGES.BARRICADE);
          ctx.sync(player);
          player.getPacketSender().sendSound(BARRICADE_CRUSH_SOUND, 1, 0);
          later(player, 2, resume);
        });
      });
    };
  }

  /** Before the quest the barricade guard has only his warning (tick 101). */
  function talkToGuard(event) {
    const { player } = event;
    if (event.npcId !== BARRICADE_GUARD_ID || stage(player) >= STAGES.STARTED) return false;
    event.handled = true;
    api.emitCustomEvent("npc-dialogue:start", {
      player, npc: event.npc, npcId: event.npcId,
      variant: "getting-started-talking-to-the-ogre-guard",
      select: (steps) => steps.slice(0, 1),
    });
    return true;
  }

  function climbOver(event) {
    const { player, location } = event;
    if (!location || ObstacleRunner.isBusy(player)) return true;
    const here = player.getLocation();
    const east = here.getX() < location.x;
    const target = [location.x + (east ? 1 : -1), here.getY(), 0];
    ObstacleRunner.run({ player }, [
      { sound: CLIMB_SOUND },
      { move: target, anim: CLIMB_SEQ, delay: 20, speed: [20, 50], dir: east ? "east" : "west", ticks: 2 },
    ]);
    return true;
  }

  function useStairs(event) {
    const { player, objectId, location } = event;
    if (!location) return false;
    const stair = STAIRS.find((entry) =>
      entry.id === objectId && entry.x === location.x && entry.y === location.y && entry.z === location.z);
    if (!stair) return false;
    event.handled = true;
    if (ObstacleRunner.isBusy(player)) return true;
    ObstacleRunner.run({ player }, [
      { msg: stair.down ? CLIMB_DOWN_TEXT : CLIMB_UP_TEXT },
      { sound: stair.down ? STAIRS_DOWN_SOUND : STAIRS_UP_SOUND },
      { fade: "out" },
      { wait: 3 },
      { tele: stair.to },
      { wait: 4 },
      { fade: "in" },
      { wait: 2 },
    ]);
    return true;
  }

  // --------------------------------------------------------------------------
  // The north-west room's scene
  // --------------------------------------------------------------------------

  function camera(player, [mx, my, mh, mr], [lx, ly, lh, lr]) {
    player.getPacketSender()
      .sendCameraMoveTo(mx, my, mh, { rate: mr, rate2: mr })
      .sendCameraLookAt(lx, ly, lh, { rate: lr, rate2: lr });
  }

  function playRoomScene(player) {
    if (player.getAttribute(ATTRIBUTES.CUT_SCENE) === true) return;
    if (stage(player) < STAGES.BARRICADE) return;
    player.setAttribute(ATTRIBUTES.CUT_SCENE, true);
    ctx.sync(player);
    player.getMovementQueue().reset();
    // Scoped playback: every chain of the scene shares one owner, so the camera knows when another
    // dialogue has replaced it (review of 4ecfe2890).
    ctx.startTranscript(player, ctx.GRISH_NPC_ID, ROOM_VARIANT, { scoped: true });
  }

  /** The camera's owner for each player watching the scene; it ends the scene once, however it ends. */
  const roomScenes = new Map();

  /**
   * Plays the camera path tick by tick while the scene's box is up. Continue ends it as live does
   * (cam_reset, tick 436); an interrupted box (Escape, another interface, another dialogue taking the
   * chatbox), leaving the room or logging out ends it too, with the camera reset, so it never stays on
   * the coffin. A replacing dialogue is left as it is: only the camera is given back.
   */
  function startRoomCamera(player) {
    endRoomScene(player);
    const manager = player.getDialogueManager();
    // Called from the scene's own chain, so its owner is the one in place now.
    const scene = { tick: 0, task: null, owner: manager.getOwner() ?? null };
    scene.task = new (class extends api.core.Task {
      execute() {
        if (roomScenes.get(player) !== scene) return this.stop();
        const owner = manager.getOwner();
        if (!player.isRegistered?.() || !owner || owner !== scene.owner) return endRoomScene(player);
        scene.tick++;
        const step = ROOM_CAMERA.find(([tick]) => tick === scene.tick);
        if (step) camera(player, step[1], step[2]);
      }
    })(1, player, false);
    roomScenes.set(player, scene);
    camera(player, ROOM_CAMERA[0][1], ROOM_CAMERA[0][2]);
    TaskManager.submit(scene.task);
  }

  function endRoomScene(player) {
    const scene = roomScenes.get(player);
    if (!scene) return;
    roomScenes.delete(player);
    scene.task?.stop();
    player.getPacketSender().sendCameraReset();
  }

  /** The scene's two message steps: the chat line first, then the held box (tick 417). */
  function roomMessage(event) {
    if (event.stepId === ROOM_CHAT_STEP) {
      event.handled = true;
      return true;
    }
    if (event.stepId !== ROOM_BOX_STEP) return false;
    const { player } = event;
    const chat = ctx.messageText(ROOM_VARIANT, ROOM_CHAT_STEP);
    if (chat) player.sendMessage(chat);
    startRoomCamera(player);
    event.box = { statement: true, holdTicks: ROOM_BOX_HOLD_TICKS };
    event.after = () => endRoomScene(player);
    return true;
  }

  class NorthWestRoom extends api.core.Area {
    postEnter(mobile) {
      if (mobile?.isPlayer?.()) playRoomScene(mobile);
    }

    postLeave(mobile) {
      if (mobile?.isPlayer?.()) endRoomScene(mobile);
    }
  }

  function register() {
    const [x1, x2, y1, y2, z] = NORTH_WEST_ROOM;
    api.registerArea(new NorthWestRoom([new Boundary(x1, x2, y1, y2, z)]));
    api.onNpcInteraction("Ogre guard", { "Talk-to": talkToGuard });
    api.onObjectInteraction("Crushed barricade", { "Climb-over": climbOver });
  }

  return { register, crush, useStairs, roomMessage, endRoomScene, barricadeValue, CRUSH_STEP_ID };
};
