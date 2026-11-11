const { createQuestScenes } = require("../QuestScenes");
const { startTranscript } = require("../QuestRuntime");

const PAGE = "The Grand Tree";
const INTRO = "treachery-revealed-glough-s-pet";
const INTERRUPTED = "treachery-revealed-glough-s-pet-when-clicking-out-of-the-cutscene";
const DISMISS_ACTION = "2XcfN8";
const REVEAL_ACTION = "TMpqrL";
const ENTRANCE = [2492, 9863, 0];
// The walkthrough shows the staging. Tiles are fitted to the active cave map.
const GLOUGH_INTRO = [2489, 9862, 0];
const GLOUGH_SPECTATOR = [2493, 9862, 0];
// The demon needs its full 3-by-3 footprint clear, including room to chase west.
const DEMON_FLOOR = [2487, 9863, 0];
const CHAMBER = [[2481, 2495, 9858, 9872, 0]];

module.exports = function createDemonEncounter(api) {
  const { Location, NpcIdentifiers } = api.core;
  const GLOUGH = NpcIdentifiers.GLOUGH;
  const BLACK_DEMON = NpcIdentifiers.BLACK_DEMON_2;
  const scenes = createQuestScenes(api, { onEnd });

  function onEnd(player, scene, logout) {
    if (logout || scene.phase === "fight") return;
    player.getDialogueManager().reset();
    player.getPacketSender().sendInterfaceRemoval();
    scenes.fade(player, false);
  }

  function play(scene, variant) {
    const { owner, glough } = scene;
    if (!startTranscript(api, owner, GLOUGH, PAGE, variant, undefined, glough, { scoped: true })) {
      scenes.end(owner, false);
    }
  }

  function start(player) {
    if (scenes.get(player)) return;
    const scene = scenes.open(player, "Glough's cave", CHAMBER, {
      canAttack: () => scene.phase === "fight" ? null : false,
      canTeleport: () => scene.phase === "fight",
      process(mobile) {
        if (mobile !== player || scene.phase !== "speaking" || scenes.chatOpen(player)) return;
        scenes.place(player, ENTRANCE);
        play(scene, INTERRUPTED);
      },
    }, { at: ENTRANCE });
    scene.phase = "arriving";
    scene.glough = scenes.actor(scene, GLOUGH, GLOUGH_INTRO, ENTRANCE);
    if (!scene.glough) {
      scenes.end(player, false);
      return;
    }
    scenes.controls(player, true, true);
    scenes.fade(player, true);
    scenes.later(scene, 2, () => {
      scenes.face(player, GLOUGH_INTRO);
      scenes.camera(player, [2486, 9864, 180], [2492, 9863, 120]);
      scenes.fade(player, false);
      scene.phase = "speaking";
      play(scene, INTRO);
    });
  }

  function handleLine(request) {
    const scene = scenes.get(request.player);
    if (!scene || request.npc !== scene.glough || scene.phase !== "speaking") return;
    if (request.text === "Glough?" && request.step.presentation !== "overhead") {
      request.before = () => scenes.camera(scene.owner, [2492, 9865, 275], [2489, 9863, 120]);
    }
    if (request.text !== "Fool... meet my little friend!") return;
    request.before = () => {
      scene.demon ??= scenes.actor(scene, BLACK_DEMON, DEMON_FLOOR, [2483, 9864]);
      scenes.camera(scene.owner, [2481, 9864, 300], [2488, 9864, 290]);
    };
  }

  function handleAction(event) {
    const scene = scenes.get(event.player);
    if (!scene || event.npc !== scene.glough || scene.phase !== "speaking") return;
    const { owner, glough } = scene;
    if (event.stepId === DISMISS_ACTION) {
      play(scene, INTRO);
      return;
    }
    if (event.stepId !== REVEAL_ACTION) return;
    event.handled = true;
    event.end = true;
    scene.phase = "revealing";
    scenes.fade(owner, true);
    scenes.later(scene, 2, () => {
      if (!scene.demon?.isRegistered()) {
        scenes.end(owner, false);
        return;
      }
      glough.moveTo(new Location(...GLOUGH_SPECTATOR));
      scene.phase = "fight";
      owner.getPacketSender().sendCameraReset();
      scenes.controls(owner, false);
      scenes.fade(owner, false);
      scene.demon.getCombat().attack(owner);
    });
  }

  function defeat(player, npc) {
    const scene = scenes.get(player);
    if (scene?.phase !== "fight" || scene.demon !== npc) return false;
    // NPCDeathTask owns removal of the demon that just died.
    scene.actors.splice(scene.actors.indexOf(npc), 1);
    scenes.end(player, false);
    return true;
  }

  function resume(player) {
    const loc = player.getLocation();
    const [west, east, south, north, plane] = CHAMBER[0];
    if (loc.getZ() === plane && loc.getX() >= west && loc.getX() <= east && loc.getY() >= south && loc.getY() <= north) {
      start(player);
    }
  }

  return { start, resume, defeat, handleAction, handleLine };
};
