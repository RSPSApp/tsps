/**
 * Crab Quest's ceremony: the cutscene on the heights, as live plays it (RSProx capture
 * 20261103T014803-ee79c12, ticks 6678-7045).
 *
 * Live builds a second instance (13x13 zones from 2992,2600, unturned) and plays it on fixed
 * ticks: actors, their steps, animations and overhead lines, the sand-circle locs, the camera,
 * the two skyboxes, the music and the message boxes. `data/ceremony-timeline.json` holds those
 * events in source coordinates, each with its tick from the first fade.
 */
const TIMELINE = require("./data/ceremony-timeline.json");
const END_SLACK_TICKS = 2;

module.exports = function createCrabCeremony(api) {
  const {
    Animation, CountdownTask, DialogueChainBuilder, GameObject, Graphic, Location, PlayerDialogue,
    StatementDialogue, TaskManager, TemplatedInstanceArea,
  } = api.core;

  const SOURCE_X = 2992;
  const SOURCE_Y = 2600;
  const SIZE_CHUNKS = 13;
  const PLANES = 4;
  const FADE_UID = (161 << 16) | 1;
  const FADE_INTERFACE = 174;
  const FADE_SCRIPT = 948;
  const MINIMAP_STATE_VARBIT = 6719;
  const CUTSCENE_STATUS_VARBIT = 542;
  const FADE_IN_ARGS = [0, 0, 0, 255, 50];
  const FADE_CLOSE_TICKS = 3;
  /** The tick live rebuilds the region on (two after the first fade). */
  const ENTER_TICK = 2;
  /** The tick after the last event: live rebuilds the real beach then. */
  const END_TICK = TIMELINE.events.at(-1).tick + END_SLACK_TICKS;

  const ceremonies = new Map();

  class CeremonyArea extends TemplatedInstanceArea {
    constructor(owner) {
      super(SIZE_CHUNKS, SIZE_CHUNKS);
      this.owner = owner;
      for (let z = 0; z < PLANES; z++) {
        for (let x = 0; x < SIZE_CHUNKS; x++) {
          for (let y = 0; y < SIZE_CHUNKS; y++) {
            this.setChunk(z, x, y, { sourceChunkX: SOURCE_X / 8 + x, sourceChunkY: SOURCE_Y / 8 + y, sourcePlane: z, rotation: 0 });
          }
        }
      }
    }

    getName() { return "Crab Quest ceremony"; }
    canTeleport() { return false; }
    canAttack() { return false; }
    npcAggression() { return false; }

    sourceTile(x, y, z = 0) { return this.tile(x - SOURCE_X, y - SOURCE_Y, z); }

    postLeave(mobile, logout) {
      const ceremony = ceremonies.get(mobile);
      if (mobile === this.owner && ceremony?.area === this) finish(mobile, ceremony, logout);
      super.postLeave(mobile, logout);
    }
  }

  function active(player) {
    return ceremonies.has(player);
  }

  /**
   * Plays the ceremony from its first fade. `enter` runs on the rebuild tick (the dream is
   * left there); `done(player, logout)` runs once the player is back on the real beach.
   */
  function play(player, { enter, exitTile, done }) {
    if (ceremonies.has(player)) return;
    const ceremony = { player, area: null, actors: new Map(), locs: new Map(), exitTile, done };
    ceremonies.set(player, ceremony);
    player.getMovementQueue().reset().setBlockMovement(true);
    player.setUntargetable(true);
    // Tasks due on one tick run in the order they were submitted: the rebuild goes first.
    later(ceremony, ENTER_TICK, () => {
      enter?.(player);
      ceremony.area = new CeremonyArea(player);
      ceremony.area.enter(player);
    });
    for (const event of TIMELINE.events) {
      if (event.tick === 0) run(ceremony, event);
      else later(ceremony, event.tick, () => run(ceremony, event));
    }
    later(ceremony, END_TICK, () => finish(player, ceremony, false));
  }

  /** Runs `callback` at `tick`, unless the ceremony ended; a player gone offline ends it. */
  function later(ceremony, tick, callback) {
    TaskManager.submit(new CountdownTask(ceremony, Math.max(1, tick), () => {
      if (ceremonies.get(ceremony.player) !== ceremony) return;
      if (ceremony.player.isRegistered?.() === false) return finish(ceremony.player, ceremony, true);
      callback();
    }));
  }

  /** Ends a running ceremony now (a logout before or during it). */
  function end(player, logout) {
    const ceremony = ceremonies.get(player);
    if (ceremony) finish(player, ceremony, logout);
  }

  function tile(ceremony, [x, y], z = 0) {
    return ceremony.area ? ceremony.area.sourceTile(x, y, z) : new Location(x, y, z);
  }

  function run(ceremony, event) {
    const { player } = ceremony;
    const sender = player.getPacketSender();
    // Before the rebuild the events belong to the dream's actors; only the screen follows.
    const inside = !!ceremony.area;
    if (event.fade) {
      const mount = sender.mountSubInterface(FADE_UID, FADE_INTERFACE, 1, {
        postScripts: [{ scriptId: FADE_SCRIPT, args: event.fade }],
      });
      if (event.fade[1] === 0) TaskManager.submit(new CountdownTask(ceremony, FADE_CLOSE_TICKS, () => sender.closeSubInterfaceMount(mount)));
    }
    if (event.minimap !== undefined) sender.sendVarbit(MINIMAP_STATE_VARBIT, event.minimap);
    if (event.cutscene !== undefined) {
      sender.sendVarbit(CUTSCENE_STATUS_VARBIT, event.cutscene);
      sender.sendHideNpcOps(event.cutscene === 1);
      sender.sendHideObjOps(event.cutscene === 1);
    }
    if (event.mesbox) statement(player, event.mesbox);
    if (event.playerLine) {
      player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new PlayerDialogue(0, event.playerLine)));
    }
    if (event.skybox !== undefined) sender.sendCameraSkybox(event.skybox);
    if (event.cameraUnlock !== undefined) sender.sendCameraUnlock(event.cameraUnlock);
    if (event.cameraReset) sender.sendCameraReset();
    if (event.song) {
      const [id, fadeOutDelay, fadeOutSpeed, fadeInDelay, fadeInSpeed] = event.song;
      sender.sendSong(id, { fadeOutDelay, fadeOutSpeed, fadeInDelay, fadeInSpeed });
    }
    if (!inside) return;
    if (event.position) player.moveTo(tile(ceremony, event.position));
    if (event.walk) player.getMovementQueue().addFirstStep(tile(ceremony, event.walk.to));
    if (event.animation !== undefined) player.performAnimation(new Animation(event.animation));
    if (event.say) player.forceChat(event.say);
    if (event.graphic) player.performGraphic(new Graphic(event.graphic.id, event.graphic.height));
    if (event.camera) {
      const [x, y, height, rate, rate2] = event.camera;
      const at = tile(ceremony, [x, y]);
      sender.sendCameraMoveTo(at.getX(), at.getY(), height, { rate, rate2, heightRelative: false });
    }
    if (event.look) {
      const [x, y, height, rate, rate2] = event.look;
      const at = tile(ceremony, [x, y]);
      sender.sendCameraLookAt(at.getX(), at.getY(), height, { rate, rate2, heightRelative: false });
    }
    for (const [key, send] of [["cameraCycles", "sendCameraMoveTo"], ["lookCycles", "sendCameraLookAt"]]) {
      const cue = event[key];
      if (!cue) continue;
      const at = tile(ceremony, cue.to);
      sender[send](at.getX(), at.getY(), cue.height, {
        cycles: cue.cycles, easing: cue.easing, ignoreTerrain: cue.ignoreTerrain, heightRelative: false,
      });
    }
    if (event.arc) {
      const centre = tile(ceremony, event.arc.centre);
      const to = tile(ceremony, event.arc.to);
      sender.sendCameraMoveArc(centre.getX(), centre.getY(), to.getX(), to.getY(), event.arc.height, event.arc.cycles,
        event.arc.easing, event.arc.ignoreTerrain);
    }
    if (event.actor) addActor(ceremony, event.actor);
    if (event.remove !== undefined) removeActor(ceremony, event.remove);
    if (event.move) {
      const npc = ceremony.actors.get(event.move.key);
      if (npc) {
        npc.setMovementSteps?.(event.move.run ? 2 : 1);
        npc.getMovementQueue().reset().addFirstStep(tile(ceremony, event.move.to));
      }
    }
    if (event.place) ceremony.actors.get(event.place.key)?.moveTo(tile(ceremony, event.place.to));
    if (event.actorAnimation) ceremony.actors.get(event.actorAnimation.key)?.performAnimation(new Animation(event.actorAnimation.id));
    if (event.actorSay) ceremony.actors.get(event.actorSay.key)?.forceChat(event.actorSay.text);
    if (event.actorGraphic) {
      ceremony.actors.get(event.actorGraphic.key)?.performGraphic(new Graphic(event.actorGraphic.id, event.actorGraphic.height));
    }
    if (event.loc) placeLoc(ceremony, event.loc);
    if (event.removeLoc) removeLoc(ceremony, event.removeLoc);
    if (event.locAnimation) {
      const object = ceremony.locs.get(locKey(event.locAnimation.position, event.locAnimation.shape));
      if (object) sender.sendObjectAnimation(object, new Animation(event.locAnimation.id));
    }
  }

  function statement(player, text) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
  }

  function addActor(ceremony, { key, id, position, face }) {
    removeActor(ceremony, key);
    const at = tile(ceremony, position);
    const npc = api.spawnNpc({ id, x: at.getX(), y: at.getY(), z: 0, face, owner: ceremony.player, ownerOnly: true, wanderRadius: 0 });
    if (!npc) return;
    npc.__skipDefaultRespawn = true;
    ceremony.area.add(npc);
    ceremony.actors.set(key, npc);
  }

  function removeActor(ceremony, key) {
    const npc = ceremony.actors.get(key);
    if (!npc) return;
    ceremony.actors.delete(key);
    if (npc.isRegistered?.()) api.removeNpc(npc);
  }

  function locKey([x, y], shape) {
    return `${x},${y},${shape}`;
  }

  function placeLoc(ceremony, { id, position, shape, rotation }) {
    removeLoc(ceremony, { position, shape });
    const object = new GameObject(id, tile(ceremony, position), shape, rotation, ceremony.area);
    ceremony.area.add(object);
    api.core.ObjectManager.register(object, true);
    ceremony.locs.set(locKey(position, shape), object);
  }

  function removeLoc(ceremony, { position, shape }) {
    const key = locKey(position, shape);
    const object = ceremony.locs.get(key);
    if (!object) return;
    ceremony.locs.delete(key);
    api.core.ObjectManager.deregister(object, true);
  }

  /** Back on the real beach: the area goes, then `done` (the quest's closing lines). */
  function finish(player, ceremony, logout) {
    if (ceremonies.get(player) !== ceremony) return;
    ceremonies.delete(player);
    TaskManager.cancelTasks(ceremony);
    for (const key of [...ceremony.actors.keys()]) removeActor(ceremony, key);
    const area = ceremony.area;
    ceremony.area = null;
    if (area && player.getPrivateArea?.() === area) area.leave(player, logout);
    area?.destroy();
    const exit = new Location(ceremony.exitTile.x, ceremony.exitTile.y, 0);
    if (logout) player.setLocation?.(exit);
    else player.moveTo(exit);
    player.getMovementQueue().setBlockMovement(false);
    player.setUntargetable(false);
    const sender = player.getPacketSender();
    if (!logout) {
      // The timeline's last fade is to black (tick 362): fade back in on the beach and close the
      // overlay three ticks later, as its own fade-ins do.
      const mount = sender.mountSubInterface(FADE_UID, FADE_INTERFACE, 1, {
        postScripts: [{ scriptId: FADE_SCRIPT, args: FADE_IN_ARGS }],
      });
      TaskManager.submit(new CountdownTask(player, FADE_CLOSE_TICKS, () => sender.closeSubInterfaceMount(mount)));
    }
    sender.sendVarbit(CUTSCENE_STATUS_VARBIT, 0).sendVarbit(MINIMAP_STATE_VARBIT, 0);
    sender.sendHideNpcOps(false);
    sender.sendHideObjOps(false);
    sender.sendCameraSkybox(-1);
    sender.sendCameraUnlock(false);
    sender.sendCameraReset();
    ceremony.done?.(player, logout);
  }

  return { active, end, play };
};
