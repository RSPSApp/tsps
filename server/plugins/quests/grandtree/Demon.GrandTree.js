/**
 * Glough's pet: the trapdoor in his watchtower at stage 130, the cutscene under it and the fight with his black
 * demon. Everything here follows rsprox capture local 1002189 (revision 242.1), ticks 12206-12400, counted from the
 * player's reach at the trapdoor (t12209):
 *
 * - +0 the reach (seq 827, delay 15); +1 the screen fades out; +4 the player is in a copy of the cave at
 *   2491,9864 with cutscene_status, the minimap off and the side tabs closed; +7 the camera and the fade-in.
 * - +9 Glough appears at 2476,9866 facing east and the player says "Hello?" over their head while the camera drifts
 *   west; +14 "Anybody?"; Glough walks to 2485,9864 from +15; +23 "Glough?".
 * - +26 the camera takes the passage, the player walks to 2486,9864 and the conversation opens with "Glough?".
 * - Before "Fool... meet my little friend!" the demon appears at 2476,9864 facing east (seq 64 and sound 400, both
 *   delayed 90), with its camera and a shake; Glough backs off south to 2485,9860.
 * - Continuing it holds an empty message box and fades out; 3 ticks later the copy ends with the player at
 *   2491,9864 in the real cave, and 2 ticks after that Glough (2487,9858) and the demon (2478,9866), both facing
 *   south, are there and the screen fades in. The demon walks up and fights.
 * - The demon's death moves the stage on (by the quest's death hook); a tick later Glough cries "Mummy!" and four
 *   ticks after that he is gone.
 *
 * Wiki (The Grand Tree, "Encountering the Black demon"): a demon not killed within 10 minutes disappears, and the
 * fight is restarted by re-entering the trapdoor; clicking out of the conversation replays it ("treachery-revealed-
 * glough-s-pet-when-clicking-out-of-the-cutscene").
 */
const { createQuestScenes } = require("../QuestScenes");
const { startTranscript } = require("../QuestRuntime");

const PAGE = "The Grand Tree";
const INTRO = "treachery-revealed-glough-s-pet";
const INTERRUPTED = "treachery-revealed-glough-s-pet-when-clicking-out-of-the-cutscene";
const MUMMY = "Mummy!";
const DISMISS_ACTION = "2XcfN8";
const REVEAL_ACTION = "TMpqrL";
/** The intro's first chat line: the overheads before it are timed by the scene, as captured. */
const FIRST_CHAT_LINE = "Glough?";
const OVERHEADS = [[9, "Hello?"], [14, "Anybody?"], [23, "Glough?"]];

const REACH_ANIMATION = 827;
const REACH_DELAY = 15;
const DEMON_ATTACK_ANIMATION = 64;
const DEMON_ATTACK_SOUND = 400;
const DEMON_REVEAL_DELAY = 90;

const ARRIVAL = [2491, 9864, 0];
const CONVERSATION_TILE = [2486, 9864, 0];
const GLOUGH_ENTRANCE = [2476, 9866, 0];
const GLOUGH_FACING = [2486, 9866];
const GLOUGH_WAIT = [2485, 9864, 0];
const GLOUGH_RETREAT = [2485, 9860, 0];
const DEMON_ENTRANCE = [2476, 9864, 0];
const DEMON_FACING = [2486, 9864];
const FIGHT_GLOUGH = [2487, 9858, 0];
const FIGHT_DEMON = [2478, 9866, 0];
const FACING_SOUTH = (tile) => [tile[0], tile[1] - 1];
/** The cave copy: 13 x 13 chunks around the arrival tile, as live's quest instances take. */
const INSTANCE = { sourceChunk: [(ARRIVAL[0] >> 3) - 6, (ARRIVAL[1] >> 3) - 6], size: 13 };
/** The passage Glough's scene and fight play in; walking out of it ends the fight (the demon goes). */
const CHAMBER = [[2470, 2495, 9855, 9872, 0]];
/** Wiki: "If the demon is not killed within 10 minutes, it will disappear". */
const FIGHT_TICKS = 1000;
const MUMMY_TICKS = 1;
const GLOUGH_LEAVES_TICKS = 4;

module.exports = function createDemonEncounter(api, { onDefeated } = {}) {
  const { Animation, NpcIdentifiers } = api.core;
  const GLOUGH = NpcIdentifiers.GLOUGH;
  const BLACK_DEMON = NpcIdentifiers.BLACK_DEMON_2;
  const scenes = createQuestScenes(api, { onEnd, recoveryAttribute: "grand-tree:demon-scene-exit" });
  /** Players between the trapdoor and the copy (the reach and the fade). */
  const descending = new WeakSet();

  function onEnd(player, scene, logout) {
    if (logout || ["fight", "handover", "won"].includes(scene.phase)) return;
    player.getDialogueManager().reset();
    player.getPacketSender().sendInterfaceRemoval();
    scenes.restoreTabs(player);
    scenes.fade(player, false);
  }

  function play(scene, variant, from) {
    const { owner, glough } = scene;
    const select = from ? (steps) => steps.slice(Math.max(0, steps.findIndex(from))) : undefined;
    if (!startTranscript(api, owner, GLOUGH, PAGE, variant, select, glough, { scoped: true })) {
      scenes.end(owner, false);
    }
  }

  function playConversation(scene) {
    play(scene, INTRO, (step, index, steps) => step.player === FIRST_CHAT_LINE && step.presentation !== "overhead");
  }

  /** The reach and the fade at the trapdoor, then the copy. `resume` skips the reach (a login in the passage). */
  function start(player, { resume = false } = {}) {
    if (scenes.get(player) || descending.has(player)) return;
    descending.add(player);
    player.getMovementQueue().reset().setBlockMovement(true);
    if (resume) scenes.fade(player, true);
    else {
      player.performAnimation(new Animation(REACH_ANIMATION, REACH_DELAY));
      scenes.later(player, 1, () => scenes.fade(player, true));
    }
    scenes.later(player, resume ? 3 : 4, () => {
      descending.delete(player);
      openCutscene(player);
    });
  }

  function openCutscene(player) {
    const scene = scenes.open(player, "Glough's cave", CHAMBER, {
      canAttack: () => false,
      canTeleport: () => false,
      process(mobile) {
        if (mobile !== player || scene.phase !== "speaking" || scenes.chatOpen(player)) return;
        scenes.place(player, ARRIVAL);
        play(scene, INTERRUPTED);
      },
    }, { instance: INSTANCE, at: ARRIVAL, exit: ARRIVAL });
    scene.phase = "arriving";
    scenes.controls(player, true, true);
    scenes.hideTabs(player);
    scenes.later(scene, 3, () => {
      scenes.camera(player, [2488, 9864, 300], [2489, 9864, 225], { rate: 232, rate2: 232 });
      scenes.fade(player, false);
    });
    scenes.later(scene, 5, () => {
      scene.glough = scenes.actor(scene, GLOUGH, GLOUGH_ENTRANCE, GLOUGH_FACING);
      if (!scene.glough) return scenes.end(player, false);
      const move = scenes.tileFor(player, [2475, 9864, 0]);
      player.getPacketSender().sendCameraMoveTo(move.getX(), move.getY(), 500, { rate: 2, rate2: 2 });
    });
    for (const [tick, text] of OVERHEADS) scenes.later(scene, tick - 4, () => player.forceChat(text));
    scenes.later(scene, 11, () => scenes.walk(scene.glough, GLOUGH_WAIT));
    scenes.later(scene, 22, () => {
      scene.phase = "speaking";
      scenes.camera(player, [2488, 9855, 2000], [2485, 9864, 225], { rate: 232, rate2: 232 });
      player.getMovementQueue().setBlockMovement(false);
      scenes.walk(player, CONVERSATION_TILE);
      scenes.later(scene, 6, () => player.getMovementQueue().setBlockMovement(true));
      playConversation(scene);
    });
  }

  function handleLine(request) {
    const scene = scenes.get(request.player);
    if (!scene || request.npc !== scene.glough || scene.phase !== "speaking") return;
    if (request.text !== "Fool... meet my little friend!") return;
    request.before = () => {
      if (!scene.demon?.isRegistered()) {
        scene.demon = scenes.actor(scene, BLACK_DEMON, DEMON_ENTRANCE, DEMON_FACING);
        scene.demon?.performAnimation(new Animation(DEMON_ATTACK_ANIMATION, DEMON_REVEAL_DELAY));
        scene.owner.getPacketSender().sendSoundEffect(DEMON_ATTACK_SOUND, 1, DEMON_REVEAL_DELAY);
      }
      scenes.camera(scene.owner, [2487, 9866, 600], [2475, 9863, 300], { rate: 232, rate2: 232 });
      scene.owner.getPacketSender().sendCameraShake(0, 6, 6, 2);
      scenes.later(scene, 5, () => scenes.walk(scene.glough, GLOUGH_RETREAT));
    };
  }

  function handleAction(event) {
    const scene = scenes.get(event.player);
    if (!scene || event.npc !== scene.glough || scene.phase !== "speaking") return;
    const { owner } = scene;
    if (event.stepId === DISMISS_ACTION) {
      playConversation(scene);
      return;
    }
    if (event.stepId !== REVEAL_ACTION) return;
    event.handled = true;
    event.end = true;
    scene.phase = "handover";
    scenes.later(scene, 1, () => {
      scenes.hold(owner);
      scenes.fade(owner, true);
    });
    scenes.later(scene, 4, () => openFight(owner));
  }

  /** The copy ends and the fight is in the real cave, as live leaves the instance before it. */
  function openFight(player) {
    scenes.end(player, false);
    player.getDialogueManager().reset();
    player.getPacketSender().sendInterfaceRemoval();
    scenes.restoreTabs(player);
    scenes.place(player, ARRIVAL);
    const scene = scenes.open(player, "Glough's cave", CHAMBER, {
      canAttack: () => null,
      canTeleport: () => null,
      // Live moves the stage as the demon's death animation starts (t12394), before it is removed (t12400).
      process(mobile) {
        if (mobile === player && scene.phase === "fight" && scene.demon?.isDyingFunction?.()) won(player, scene);
      },
    });
    scene.phase = "arriving-fight";
    scenes.later(scene, 2, () => {
      scene.glough = scenes.actor(scene, GLOUGH, FIGHT_GLOUGH, FACING_SOUTH(FIGHT_GLOUGH));
      scene.demon = scenes.actor(scene, BLACK_DEMON, FIGHT_DEMON, FACING_SOUTH(FIGHT_DEMON));
      if (!scene.demon) return scenes.end(player, false);
      scene.phase = "fight";
      scenes.fade(player, false);
      scene.demon.getCombat().attack(player);
    });
    scenes.later(scene, FIGHT_TICKS, () => scenes.end(player, false));
  }

  function won(player, scene) {
    // NPCDeathTask owns removal of the demon that is dying.
    scene.actors.splice(scene.actors.indexOf(scene.demon), 1);
    scene.phase = "won";
    onDefeated?.(player);
    // The transcript's overhead ("treachery-revealed-when-you-defeat-the-black-demon"), said over his head
    // without opening a conversation: live sends only the [say] (t12395), so a level-up box stays open.
    scenes.later(scene, MUMMY_TICKS, () => {
      if (scene.glough?.isRegistered()) scene.glough.forceChat(MUMMY);
    });
    scenes.later(scene, MUMMY_TICKS + GLOUGH_LEAVES_TICKS, () => scenes.end(player, false));
  }

  /**
   * The demon's death hook (as it is removed): true when it was this player's fight, so the quest moves the stage
   * on if the dying animation did not already.
   */
  function defeat(player, npc) {
    const scene = scenes.get(player);
    if (scene?.phase !== "fight" || scene.demon !== npc) return false;
    won(player, scene);
    return true;
  }

  function resume(player) {
    const loc = player.getLocation();
    const [west, east, south, north, plane] = CHAMBER[0];
    if (loc.getZ() === plane && loc.getX() >= west && loc.getX() <= east && loc.getY() >= south && loc.getY() <= north) {
      start(player, { resume: true });
    }
  }

  /** A logout between the trapdoor and the copy: nothing is left waiting. */
  function cancel(player) {
    if (!descending.delete(player)) return;
    scenes.cancel(player);
    player.getMovementQueue().setBlockMovement(false);
  }

  return { start, resume, defeat, cancel, handleAction, handleLine, scenes };
};
