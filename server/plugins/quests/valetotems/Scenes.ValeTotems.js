/**
 * The Vale Totems miniquest's three cutscenes, as live plays them (RSProx capture
 * 20261109T224258-5ab63b4, rev 242): the ent worshipping the old totem (ticks 469-495), Ranulph
 * breaking it (506-538) and the ent accepting the rebuilt one (696-722).
 *
 * Each one fades out on the continue that starts it, rebuilds the player into an instance two
 * ticks later (a copy of the map around the totem, unturned, all four planes), plays its
 * actors, camera and effects there, fades out again, rebuilds the real map and fades back in
 * before the conversation goes on. `data/scenes.json` holds the timelines in real-map tiles.
 *
 * Live, the scene sets fov_clamp 3, cutscene_status 1, minimap_state 2, the area-sound, draw
 * distance and roof overrides, hides NPC, loc and ground-item ops and closes the side tabs;
 * all of it goes back as it leaves. Not sent here: hidelocops and minimap_toggle (the server
 * has no encoder for them yet); minimap_state still blanks the minimap.
 *
 * A logout mid-scene ends it: the player is put back on the scene's exit tile and the quest
 * keeps whichever stage the scene had reached (its `action`s are the checkpoints).
 */
const { createQuestScenes } = require("../QuestScenes");
const SCENES = require("./data/scenes.json").scenes;

module.exports = function createValeTotemsScenes(api) {
  const { Animation, CountdownTask, DialogueChainBuilder, ActionDialogue, Graphic, Location, NpcDialogue, PlayerDialogue, TaskManager, TemplatedInstanceArea } = api.core;
  const Quest = createQuestScenes(api);

  const SOURCE_CHUNK_X = 1312 / 8;
  const SOURCE_CHUNK_Y = 3320 / 8;
  const SIZE_CHUNKS = 13;
  const PLANES = 4;
  const SONG = { id: 822, fades: { fadeOutDelay: 0, fadeOutSpeed: 60, fadeInDelay: 60, fadeInSpeed: 0 } };
  /** Set while the scene plays and cleared after it: varbits, then varps (option overrides). */
  const SCENE_VARBITS = [["fov_clamp", 3], ["draw_distance_max_override", 1], ["option_hide_rooftops_override", 1]];
  const SCENE_VARPS = [["option_areasounds_override", 30], ["areasounds_override", 1]];
  // The side tabs the scene closes (toplevel 161 slots, as MagicCarpets.plugin.js closes them).
  const TOPLEVEL = 161;
  const COMBAT_TAB = [76, 593];
  const MAGIC_TAB = 82;
  const TABS = [[77, 320], [78, 629], [79, 149], [80, 387], [81, 541], [87, 116], [88, 216]];

  const playing = new Map();

  class SceneArea extends TemplatedInstanceArea {
    constructor(owner) {
      super(SIZE_CHUNKS, SIZE_CHUNKS);
      this.owner = owner;
      for (let z = 0; z < PLANES; z++) {
        for (let x = 0; x < SIZE_CHUNKS; x++) {
          for (let y = 0; y < SIZE_CHUNKS; y++) {
            this.setChunk(z, x, y, { sourceChunkX: SOURCE_CHUNK_X + x, sourceChunkY: SOURCE_CHUNK_Y + y, sourcePlane: z, rotation: 0 });
          }
        }
      }
    }

    getName() { return "Vale Totems cutscene"; }
    canTeleport() { return false; }
    canAttack() { return false; }
    npcAggression() { return false; }

    sourceTile(x, y, z = 0) {
      return this.tile(x - SOURCE_CHUNK_X * 8, y - SOURCE_CHUNK_Y * 8, z);
    }

    postLeave(mobile, logout) {
      const scene = playing.get(mobile);
      if (mobile === this.owner && scene?.area === this) finish(scene, logout, true);
      super.postLeave(mobile, logout);
    }
  }

  function active(player) {
    return playing.has(player);
  }

  /**
   * Plays a scene: `actions[name](player)` runs on its checkpoint ticks and `done(player)` once
   * the player is back on the real map with the screen faded in.
   */
  function play(player, name, { actions = {}, done } = {}) {
    if (playing.has(player)) return false;
    const definition = SCENES[name];
    if (!definition) throw new Error(`ValeTotems: no scene ${name}`);
    const scene = { player, name, definition, area: null, actors: new Map(), exitTile: null, actions, done, segment: 0 };
    playing.set(player, scene);
    // Live locks the player from the first fade; the cutscene vars follow on the rebuild tick.
    player.getMovementQueue().reset().setBlockMovement(true);
    runSegment(scene);
    return true;
  }

  function runSegment(scene) {
    for (const event of scene.definition.segments[scene.segment]) {
      if (event.tick === 0) run(scene, event);
      else later(scene, event.tick, () => run(scene, event));
    }
  }

  function later(scene, ticks, callback) {
    TaskManager.submit(new CountdownTask(scene, ticks, () => {
      if (playing.get(scene.player) !== scene) return;
      if (scene.player.isRegistered?.() === false) return finish(scene, true);
      callback();
    }));
  }

  function tile(scene, [x, y], z = 0) {
    return scene.area ? scene.area.sourceTile(x, y, z) : new Location(x, y, z);
  }

  function who(scene, key) {
    return key === "player" ? scene.player : scene.actors.get(key);
  }

  function run(scene, event) {
    const { player } = scene;
    if (event.fade) Quest.fade(player, event.fade === "out");
    if (event.closeFade) Quest.closeFade(player);
    if (event.hold) Quest.hold(player);
    if (event.enter) enter(scene, event.enter);
    if (event.exit) exit(scene, event.exit);
    if (event.actor) addActor(scene, event.actor);
    if (event.camera) {
      const to = tile(scene, event.camera.to);
      const look = tile(scene, event.camera.look);
      Quest.camera(player, [to.getX(), to.getY(), event.camera.to[2]], [look.getX(), look.getY(), event.camera.look[2]]);
    }
    if (event.glide) {
      const to = tile(scene, event.glide.to);
      player.getPacketSender().sendCameraMoveTo(to.getX(), to.getY(), event.glide.height, {
        cycles: event.glide.cycles, easing: "ease_in_out_sine", ignoreTerrain: true, heightRelative: false,
      });
    }
    if (event.walk) walk(scene, event.walk);
    if (event.face) who(scene, event.face.who)?.setPositionToFace(tile(scene, event.face.at));
    if (event.anim) who(scene, event.anim.who)?.performAnimation(new Animation(event.anim.id));
    if (event.mapAnim) player.getPacketSender().sendGraphic(new Graphic(event.mapAnim.id), tile(scene, event.mapAnim.at));
    for (const sound of event.sounds ?? []) player.getPacketSender().sendSound(sound, 1, 0);
    if (event.action) scene.actions[event.action]?.(player);
    if (event.line) line(scene, event.line);
    if (event.done) {
      finish(scene, false);
      scene.done?.(player);
    }
  }

  function enter(scene, { player: [x, y], face }) {
    const { player } = scene;
    const sender = player.getPacketSender();
    const cache = api.core.CacheDefinitions;
    for (const [name, value] of SCENE_VARBITS) sender.sendVarbit(cache.getVarbitId(name), value);
    for (const [name, value] of SCENE_VARPS) sender.sendConfig(cache.getVarpId(name), value);
    Quest.controls(player, true, true);
    scene.area = new SceneArea(player);
    scene.area.enter(player);
    player.moveTo(scene.area.sourceTile(x, y));
    if (face) player.setPositionToFace(tile(scene, face));
    hideTabs(player);
    sender.sendSong(SONG.id, SONG.fades);
  }

  /** Back on the real map; the scene stays "playing" until its last event (the fade in). */
  function exit(scene, exitTile) {
    scene.exitTile = exitTile;
    leaveInstance(scene, false);
  }

  function leaveInstance(scene, logout, fromArea = false) {
    const { player } = scene;
    for (const key of [...scene.actors.keys()]) removeActor(scene, key);
    const area = scene.area;
    scene.area = null;
    if (area) {
      scene.leaving = true;
      if (!fromArea && player.getPrivateArea?.() === area) area.leave(player, logout);
      area.destroy();
      scene.leaving = false;
    }
    const exitTile = scene.exitTile ?? scene.definition.segments.flat().find((event) => event.exit)?.exit;
    if (exitTile && (area || logout)) {
      const at = new Location(exitTile.player[0], exitTile.player[1], 0);
      if (logout) player.setLocation?.(at);
      else player.moveTo(at);
      if (exitTile.face && !logout) player.setPositionToFace(new Location(exitTile.face[0], exitTile.face[1], 0));
    }
    restore(player, logout);
  }

  function restore(player, logout) {
    if (player.__valeTotemsSceneRestored) return;
    player.__valeTotemsSceneRestored = true;
    const sender = player.getPacketSender();
    const cache = api.core.CacheDefinitions;
    for (const [name] of SCENE_VARBITS) sender.sendVarbit(cache.getVarbitId(name), 0);
    for (const [name] of SCENE_VARPS) sender.sendConfig(cache.getVarpId(name), 0);
    // Live clears cutscene_status, minimap_state and the hidden ops on the exit tick too; the
    // player stays locked until the scene's last fade-in.
    Quest.controls(player, false);
    if (logout) return;
    player.getMovementQueue().setBlockMovement(true);
    restoreTabs(player);
    sender.sendCameraUnlock?.(false);
    sender.sendCameraReset();
  }

  function finish(scene, logout, fromArea = false) {
    const { player } = scene;
    if (playing.get(player) !== scene || scene.leaving) return;
    if (scene.area || logout) leaveInstance(scene, logout, fromArea);
    playing.delete(player);
    TaskManager.cancelTasks(scene);
    delete player.__valeTotemsSceneRestored;
    Quest.controls(player, false);
    if (!logout) player.getPacketSender().sendCameraReset();
  }

  function addActor(scene, { key, id, at, face, wander = 0 }) {
    removeActor(scene, key);
    const position = tile(scene, at);
    const npc = api.spawnNpc({ id, x: position.getX(), y: position.getY(), z: 0, owner: scene.player, ownerOnly: true, wanderRadius: wander });
    if (!npc) return;
    npc.__skipDefaultRespawn = true;
    scene.area.add(npc);
    if (face) npc.setPositionToFace(tile(scene, face));
    scene.actors.set(key, npc);
  }

  function removeActor(scene, key) {
    const npc = scene.actors.get(key);
    scene.actors.delete(key);
    if (npc?.isRegistered?.()) api.removeNpc(npc);
  }

  /** Walks a mobile along the path's corners, a tile a tick. The player's own lock lifts for it. */
  function walk(scene, { who: key, path }) {
    const mobile = who(scene, key);
    if (!mobile) return;
    const queue = mobile.getMovementQueue();
    const player = key === "player";
    if (player) queue.setBlockMovement(false);
    queue.reset();
    for (const corner of path) queue.addSteps(tile(scene, corner));
    // The movement coordinator walks an NPC off its home straight back: home is the path's end.
    if (!player) {
      mobile.setSpawnPosition?.(tile(scene, path.at(-1)));
      return;
    }
    const steps = queue.size();
    later(scene, Math.max(1, steps + 1), () => queue.setBlockMovement(true));
  }

  /** A line the player continues; the scene's next segment starts on that continue. */
  function line(scene, { speaker, npc, name, text, expression }) {
    const { player } = scene;
    const chain = new DialogueChainBuilder();
    chain.add(speaker === "player"
      ? new PlayerDialogue(0, text, expression)
      : new NpcDialogue(0, npc, text, name, expression));
    chain.add(new ActionDialogue(1, { execute: () => next(scene) }));
    player.getDialogueManager().startDialogues(chain);
  }

  function next(scene) {
    if (playing.get(scene.player) !== scene) return;
    scene.segment += 1;
    if (scene.segment < scene.definition.segments.length) runSegment(scene);
  }

  function hideTabs(player) {
    const sender = player.getPacketSender();
    for (const slot of [COMBAT_TAB[0], MAGIC_TAB, ...TABS.map(([tab]) => tab)]) sender.closeSubInterface((TOPLEVEL << 16) | slot);
  }

  function restoreTabs(player) {
    const sender = player.getPacketSender();
    sender.sendTabInterface(0, COMBAT_TAB[1]);
    sender.sendTabInterface(6, player.getSpellbook().getInterfaceId());
    for (const [slot, group] of TABS) sender.sendTabInterface(slot, group);
    player.getInventory().refreshItems();
    player.getEquipment().refreshItems();
  }

  /** Ends a running scene now (a logout before its area does it). */
  function end(player, logout) {
    const scene = playing.get(player);
    if (scene) finish(scene, logout);
  }

  return { active, play, end };
};
