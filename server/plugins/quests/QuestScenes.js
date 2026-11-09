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
 *
 * Instance scenes play in a copy of the map, as live's rebuild_region does: pass
 * `{ instance: { sourceChunk: [chunkX, chunkY], size }, at, exit }` to `open`. The copy takes
 * `size` x `size` chunks of every plane, unturned, from the source chunk; the player is moved to
 * `at`. Everything stays in source coordinates: tiles given as `[x, y, z]` arrays to `actor`,
 * `loc`, `face`, `camera`, `place` and `walk` are translated into the copy, while a `Location`
 * (a mobile's own position) is used as it is. Walking out of `bounds` ends the scene on the
 * matching real tile. A logout, a death or a server stop inside it all come back to `exit`: a
 * factory given `recoveryAttribute` saves the exit while the scene plays and restores it at login.
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
/** Live's quest instances copy 13 x 13 chunks (104 x 104 tiles) of every plane. */
const INSTANCE_CHUNKS = 13;
const PLANES = 4;

function createQuestScenes(api, { onEnd, recoveryAttribute } = {}) {
  const {
    ActionDialogue, Boundary, CountdownTask, DialogueChainBuilder, GameObject, Location, MultiChatboxPrompt,
    PrivateArea, StatementDialogue, TaskManager, TemplatedInstanceArea,
  } = api.core;
  const scenes = new Map();
  const playerKeys = new WeakMap();

  /** A scene's `rules` ({ canTeleport, process, npcAggression, canAttack, multi }) answer for its area. */
  function sceneRules(Base) {
    return class extends Base {
      canTeleport() { return scenes.get(this.owner)?.rules?.canTeleport?.() ?? false; }
      process(mobile) { scenes.get(this.owner)?.rules?.process?.(mobile); }
      npcAggression(player, npc) { return scenes.get(this.owner)?.rules?.npcAggression?.(player, npc) ?? false; }
      canAttack(attacker, target, method) { return scenes.get(this.owner)?.rules?.canAttack?.(attacker, target, method) ?? null; }
      isMulti() { return scenes.get(this.owner)?.rules?.multi === true; }
      postLeave(mobile, logout) {
        const scene = scenes.get(mobile);
        if (mobile === this.owner && scene?.area === this) {
          // Cleared first so end() doesn't leave it again; `leftArea` still tells end() it was a copy.
          scene.area = null;
          scene.leftArea = this;
          end(mobile, logout);
        }
        super.postLeave(mobile, logout);
      }
    };
  }

  class QuestScene extends sceneRules(PrivateArea) {
    constructor(owner, bounds) {
      super(bounds.map(([minX, maxX, minY, maxY, z = 0]) => new Boundary(minX, maxX, minY, maxY, z)));
      this.owner = owner;
    }
  }

  /** The scene in a copy of the map; `bounds` stay in source coordinates and keep the playable box. */
  let QuestInstanceScene = null;
  // Built on first use, so a factory whose core has no instances (a test's stub) still works.
  const instanceScene = () => QuestInstanceScene ??= class extends sceneRules(TemplatedInstanceArea) {
    constructor(owner, bounds, { sourceChunk: [chunkX, chunkY], size }) {
      super(size, size);
      this.owner = owner;
      this.bounds = bounds;
      this.sourceX = chunkX * 8;
      this.sourceY = chunkY * 8;
      for (let z = 0; z < PLANES; z++) this.copySquare(size, chunkX, chunkY, z, 0, 0, z, 0);
    }
    getName() { return `${scenes.get(this.owner)?.name ?? "quest"} scene`; }
    sourceTile(x, y, z = 0) { return this.tile(x - this.sourceX, y - this.sourceY, z); }
    toSource(location) {
      return new Location(location.getX() - this.getBaseX() + this.sourceX, location.getY() - this.getBaseY() + this.sourceY, location.getZ());
    }
    inBounds(location) {
      const at = this.toSource(location);
      return this.bounds.some(([minX, maxX, minY, maxY, z = 0]) =>
        at.getZ() === z && at.getX() >= minX && at.getX() <= maxX && at.getY() >= minY && at.getY() <= maxY);
    }
    /** Walking out of the playable box ends the scene, as stepping off a private area's tiles did. */
    process(mobile) {
      super.process(mobile);
      const scene = scenes.get(this.owner);
      if (mobile !== this.owner || scene?.area !== this || scene.leaving || this.inBounds(mobile.getLocation())) return;
      scene.leaving = true;
      TaskManager.submit(new CountdownTask(scene, 1, () => { if (scenes.get(mobile) === scene) end(mobile, false); }));
    }
  };

  function instanceOf(scene) {
    const area = scene?.area ?? scene?.leftArea;
    return QuestInstanceScene && area instanceof QuestInstanceScene ? area : null;
  }

  /** The scene a mobile plays in: its own (the owner) or its owner's (an actor). */
  function sceneOf(mobile) {
    return scenes.get(mobile) ?? (mobile?.__questSceneOwner ? scenes.get(mobile.__questSceneOwner) : null) ?? null;
  }

  /** A source tile in the mobile's (or scene's) instance; a Location is a real position already. */
  function tileFor(sceneOrMobile, target) {
    if (target instanceof Location) return target;
    const [x, y, z] = target;
    const scene = sceneOrMobile?.actors ? sceneOrMobile : sceneOf(sceneOrMobile);
    const level = z ?? (sceneOrMobile?.getLocation?.()?.getZ?.() ?? 0);
    const area = instanceOf(scene);
    return area ? area.sourceTile(x, y, level) : new Location(x, y, level);
  }

  /** The source tile a real location stands for, outside any instance itself. */
  function toSource(mobile, location = mobile.getLocation()) {
    const area = instanceOf(sceneOf(mobile));
    return area && area.contains(location) ? area.toSource(location) : location;
  }

  /** Moves the scene's owner to a source tile, inside its instance when it has one. */
  function place(player, target) {
    player.moveTo(tileFor(player, target));
  }

  /** Walks a mobile to a source tile, inside its scene's instance when it has one. */
  function walk(mobile, target) {
    mobile?.getMovementQueue().addSteps(tileFor(mobile, target));
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
    const sender = player.getPacketSender();
    const mount = sender.mountSubInterface(FADE_UID, FADE_INTERFACE, 1, {
      postScripts: [{ scriptId: FADE_SCRIPT, args: out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES] }],
    });
    if (!out) TaskManager.submit(new CountdownTask(player, 3, () => sender.closeSubInterfaceMount(mount)));
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
      // Live toggles hidenpcops, hidelocops and hideobjops with cutscene_status in the same tick
      // (capture facts in the PR); loc ops remain a separate change.
      player.getPacketSender().sendHideNpcOps(cinematic === 1);
      player.getPacketSender().sendHideObjOps(cinematic === 1);
    }
  }

  /** An empty chatbox the player cannot continue: the capture's held moments. */
  function hold(player) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ActionDialogue(0, { execute: () => StatementDialogue.send(player, "", false) }, true)
    ));
  }

  /** `target` is a source tile `[x, y]`, or a Location (another mobile's position) used as it is. */
  function face(mobile, target) {
    if (target instanceof Location) {
      mobile.setPositionToFace(target);
      return;
    }
    const [x, y] = target;
    mobile.setPositionToFace(tileFor(mobile, [x, y, mobile.getLocation().getZ()]));
  }

  /** Camera packets take scene tiles; heights stay as given. */
  function camera(player, [mx, my, mh], [lx, ly, lh], rates = CAMERA_RATES) {
    const move = tileFor(player, [mx, my, 0]), look = tileFor(player, [lx, ly, 0]);
    player.getPacketSender().sendCameraMoveTo(move.getX(), move.getY(), mh, rates).sendCameraLookAt(look.getX(), look.getY(), lh, rates);
  }

  function open(player, name, bounds, rules = {}, { instance, at, exit } = {}) {
    end(player, false);
    const scene = { name, owner: player, actors: [], locs: [], rules, exit: exit ?? null, area: null };
    scene.area = instance
      ? new (instanceScene())(player, bounds, { sourceChunk: instance.sourceChunk, size: instance.size ?? INSTANCE_CHUNKS })
      : new QuestScene(player, bounds);
    scenes.set(player, scene);
    scene.area.enter(player);
    if (instance && recoveryAttribute && scene.exit) player.setAttribute(recoveryAttribute, scene.exit);
    if (at) place(player, at);
    return scene;
  }

  function get(player) {
    return scenes.get(player) ?? null;
  }

  function actor(scene, id, [x, y, z = 0], faceTile) {
    const at = tileFor(scene, [x, y, z]);
    const npc = api.spawnNpc({ id, x: at.getX(), y: at.getY(), z, owner: scene.owner, ownerOnly: true, wanderRadius: 0 });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.__questSceneOwner = scene.owner;
    scene.area?.add(npc);
    scene.actors.push(npc);
    if (faceTile) npc.setPositionToFace(tileFor(scene, [faceTile[0], faceTile[1], z]));
    return npc;
  }

  function removeActor(scene, npc) {
    const index = scene.actors.indexOf(npc);
    if (index >= 0) scene.actors.splice(index, 1);
    if (npc?.isRegistered?.()) api.removeNpc(npc);
  }

  /** A loc only the owner sees; `opFlags` hides its ops. */
  function loc(scene, { id, x, y, z = 0, type = 10, face: rotation = 0 }, opFlags) {
    const object = new GameObject(id, tileFor(scene, [x, y, z]), type, rotation, scene.area);
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
    const copy = instanceOf(scene);
    // Out of a copy before it goes: a logout is saved at the exit, otherwise the player stands on
    // the real tile their copy's tile stands for (a caller's own move comes after this).
    const from = copy?.contains(player.getLocation()) ? copy.toSource(player.getLocation()) : null;
    if (copy && logout && scene.exit) player.setLocation(new Location(...scene.exit));
    if (copy && recoveryAttribute) player.setAttribute(recoveryAttribute, null);
    scenes.delete(player);
    TaskManager.cancelTasks(scene);
    for (const npc of scene.actors.splice(0)) if (npc?.isRegistered?.()) api.removeNpc(npc);
    // A copy's locs go with it; the real map's rebuild clears them from the client.
    if (!logout && !copy) for (const object of scene.locs.splice(0)) player.getPacketSender().sendObjectRemoval(object);
    const area = scene.area;
    scene.area = null;
    if (area && player.getArea?.() === area) area.leave(player, logout);
    if (copy) {
      copy.destroy();
      if (!logout && from && copy.contains(player.getLocation())) player.moveTo(from);
    }
    controls(player, false);
    player.getPacketSender().sendCameraReset();
    onEnd?.(player, scene, logout);
  }

  /** Whether the player still has a chatbox up (a line or a menu). */
  function chatOpen(player) {
    return player.getDialogueManager().isActive?.() === true || !!MultiChatboxPrompt.getPending?.(player);
  }

  /** A player saved inside a copy (the server stopped there) comes back at the scene's exit. */
  function recover({ player }) {
    const exit = player?.getAttribute?.(recoveryAttribute);
    if (!Array.isArray(exit) || scenes.has(player)) return;
    player.setAttribute(recoveryAttribute, null);
    player.moveTo(new Location(...exit));
  }

  /** A death in a copy leaves its grave at the scene's exit, not in a copy that is about to go. */
  function graveAtExit(request) {
    const scene = scenes.get(request?.player);
    if (!instanceOf(scene) || !scene.exit) return;
    const [x, y, z = 0] = scene.exit;
    request.tile = { x, y, z };
  }

  if (recoveryAttribute) {
    api.persistAttribute(recoveryAttribute);
    api.onPlayerLogin(recover);
    api.onCustomEvent("gravestones:grave-location", graveAtExit);
  }

  return {
    CAMERA_RATES, later, cancel, fade, closeFade, controls, hold, face, camera, open, get, actor, removeActor, loc, end,
    chatOpen, place, walk, toSource,
  };
}

module.exports = { createQuestScenes, CAMERA_RATES };
