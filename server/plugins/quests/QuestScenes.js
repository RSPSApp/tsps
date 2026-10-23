/**
 * Private quest scenes, as live OSRS plays its quest cutscenes and solo fights (RSProx captures):
 *
 * - The screen fades out (overlay 174 with clientscript 948), the scene's actors and locs appear
 *   for its owner only, in a private area at the source coordinates (live uses an instance), and
 *   the screen fades back in. `cutscene_status` and `minimap_state` follow it.
 * - A scene ends when its owner leaves the area, logs out or the quest ends it: its actors and
 *   locs go, the camera and controls come back and `onEnd(player, scene, logout)` runs.
 *
 * One factory per quest, so each quest keeps its own scenes and end handling:
 *
 *   const Scenes = createQuestScenes(api, { onEnd });
 *   const scene = Scenes.open(player, "judgement", [[minX, maxX, minY, maxY, z]]);
 *   Scenes.actor(scene, npcId, [x, y, z], [faceX, faceY]);
 *   Scenes.later(scene, 2, () => Scenes.fade(player, false));
 */
const FADE_UID = (161 << 16) | 1;
const FADE_INTERFACE = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;
const CUTSCENE_STATUS_VARBIT = 542;
// Server-owned cinematic marker Quest Helper reads as its cutscene proxy. The cache's clientscripts
// only read it (script 3459); there is no CS2 setter, so shared scenes must publish it with 542.
const GRAVESTONE_TLI_HIDE_VARBIT = 12139;
const MINIMAP_STATE_VARBIT = 6719;
const MINIMAP_OFF = 2;
/** The camera rates every captured quest cutscene in this batch moves with. */
const CAMERA_RATES = { rate: 232, rate2: 100 };

function createQuestScenes(api, { onEnd } = {}) {
  const {
    ActionDialogue, Boundary, CountdownTask, DialogueChainBuilder, GameObject, Location, MultiChatboxPrompt,
    PrivateArea, StatementDialogue, TaskManager,
  } = api.core;
  const scenes = new Map();
  const playerKeys = new WeakMap();

  class QuestScene extends PrivateArea {
    constructor(owner, bounds) {
      super(bounds.map(([minX, maxX, minY, maxY, z = 0]) => new Boundary(minX, maxX, minY, maxY, z)));
      this.owner = owner;
    }
    canTeleport() { return scenes.get(this.owner)?.rules?.canTeleport?.() ?? false; }
    process(mobile) { scenes.get(this.owner)?.rules?.process?.(mobile); }
    /** A scene's `rules` ({ npcAggression, canAttack, multi }) answer for its area. */
    npcAggression(player, npc) { return scenes.get(this.owner)?.rules?.npcAggression?.(player, npc) ?? false; }
    canAttack(attacker, target, method) { return scenes.get(this.owner)?.rules?.canAttack?.(attacker, target, method) ?? null; }
    isMulti() { return scenes.get(this.owner)?.rules?.multi === true; }
    postLeave(mobile, logout) {
      const scene = scenes.get(mobile);
      if (mobile === this.owner && scene?.area === this) {
        scene.area = null;
        end(mobile, logout);
      }
      super.postLeave(mobile, logout);
    }
  }

  /** Runs `callback` after `ticks`; keyed tasks die with their scene (or their player). */
  function later(key, ticks, callback) {
    if (key?.isPlayer?.()) {
      const player = key;
      key = playerKeys.get(player);
      if (!key) {
        key = {};
        playerKeys.set(player, key);
      }
    }
    TaskManager.submit(new CountdownTask(key, ticks, callback));
  }

  function cancel(player) {
    const key = playerKeys.get(player);
    if (key) TaskManager.cancelTasks(key);
  }

  function fade(player, out) {
    player.getPacketSender().sendSubInterface(FADE_UID, FADE_INTERFACE, 1, {
      postScripts: [{ scriptId: FADE_SCRIPT, args: out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES] }],
    });
  }

  function closeFade(player) {
    player.getPacketSender().closeSubInterface(FADE_UID);
  }

  /** Movement and the minimap; `cutscene` also sets cutscene_status and stops attacks on the player. */
  function controls(player, active, cutscene = false) {
    player.getMovementQueue().reset().setBlockMovement(active);
    player.setUntargetable(active && cutscene);
    player.getPacketSender().sendVarbit(MINIMAP_STATE_VARBIT, active ? MINIMAP_OFF : 0);
    if (cutscene || !active) {
      const cinematic = active && cutscene ? 1 : 0;
      player.getPacketSender().sendVarbit(CUTSCENE_STATUS_VARBIT, cinematic);
      player.getPacketSender().sendVarbit(GRAVESTONE_TLI_HIDE_VARBIT, cinematic);
    }
  }

  /** An empty chatbox the player cannot continue: the capture's held moments. */
  function hold(player) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ActionDialogue(0, { execute: () => StatementDialogue.send(player, "", false) })
    ));
  }

  function face(mobile, [x, y]) {
    mobile.setPositionToFace(new Location(x, y, mobile.getLocation().getZ()));
  }

  function camera(player, [mx, my, mh], [lx, ly, lh], rates = CAMERA_RATES) {
    player.getPacketSender().sendCameraMoveTo(mx, my, mh, rates).sendCameraLookAt(lx, ly, lh, rates);
  }

  function open(player, name, bounds, rules = {}) {
    end(player, false);
    const scene = { name, owner: player, actors: [], locs: [], rules, area: new QuestScene(player, bounds) };
    scenes.set(player, scene);
    scene.area.enter(player);
    return scene;
  }

  function get(player) {
    return scenes.get(player) ?? null;
  }

  function actor(scene, id, [x, y, z = 0], faceTile) {
    const npc = api.spawnNpc({ id, x, y, z, owner: scene.owner, ownerOnly: true, wanderRadius: 0 });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.__questSceneOwner = scene.owner;
    scene.area?.add(npc);
    scene.actors.push(npc);
    if (faceTile) npc.setPositionToFace(new Location(faceTile[0], faceTile[1], z));
    return npc;
  }

  function removeActor(scene, npc) {
    const index = scene.actors.indexOf(npc);
    if (index >= 0) scene.actors.splice(index, 1);
    if (npc?.isRegistered?.()) api.removeNpc(npc);
  }

  /** A loc only the owner sees; `opFlags` hides its ops. */
  function loc(scene, { id, x, y, z = 0, type = 10, face: rotation = 0 }, opFlags) {
    const object = new GameObject(id, new Location(x, y, z), type, rotation, scene.area);
    if (opFlags !== undefined) object.getOpFlags = () => opFlags;
    scene.area?.add(object);
    scene.locs.push(object);
    api.core.ObjectManager.register(object, true);
    return object;
  }

  function end(player, logout) {
    const scene = scenes.get(player);
    if (!scene) return;
    scene.rules?.beforeEnd?.(player, scene);
    scenes.delete(player);
    TaskManager.cancelTasks(scene);
    for (const npc of scene.actors.splice(0)) if (npc?.isRegistered?.()) api.removeNpc(npc);
    if (!logout) for (const object of scene.locs.splice(0)) player.getPacketSender().sendObjectRemoval(object);
    const area = scene.area;
    scene.area = null;
    if (area && player.getArea?.() === area) area.leave(player, logout);
    controls(player, false);
    player.getPacketSender().sendCameraReset();
    onEnd?.(player, scene, logout);
  }

  /** Whether the player still has a chatbox up (a line or a menu). */
  function chatOpen(player) {
    return player.getDialogueManager().isActive?.() === true || !!MultiChatboxPrompt.getPending?.(player);
  }

  return { CAMERA_RATES, later, cancel, fade, closeFade, controls, hold, face, camera, open, get, actor, removeActor, loc, end, chatOpen };
}

module.exports = { createQuestScenes, CAMERA_RATES };
