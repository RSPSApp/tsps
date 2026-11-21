/**
 * Watchtower's timed moments, as the revision 242 capture plays them (Watchtower.bin; ticks are the
 * capture's, offsets are from the action that starts each):
 *
 * - The enclave scene (t3635-3670): the first run past the enclave guards. +3 the cutscene starts with
 *   the player inside the enclave entrance and the screen fading out; +6 the player is in a copy of
 *   the enclave at (2585,9425); +8 the cutscene shaman (4384) at (2592,9434) and dragon (4385) at
 *   (2594,9432) and the camera; +11 the fade in; +14 "Meanwhile, in the Shaman's enclave..."; +18 the
 *   dragon breathes fire on the shaman (spotanim 1, seq 81, sound 3266); +21 the 30 it bounces back;
 *   +22 "Hur, hut, hur. Stoopid dragon!"; +26 seq 5357, "Take dis!", projectile 970 and sound 3270;
 *   +27 "Hur, hur, hur, hur!", spotanim 971 on the dragon, sounds 3271 and 409; +28 the 75; +29 the
 *   dragon's death (seq 92); +30 the fade out; +33 watchtower_enclave_scene and the real entrance;
 *   +35 the cutscene ends with the fade in.
 * - The relic (t2037-2040): the wizard's seq 5352 and spotanim 969 (height 50) with sound 3267, the
 *   relic three ticks later.
 * - The scared skavid (t2995-3001): an ogre (4363; the Wiki calls it an ogre shaman) appears beside
 *   it in a puff of smoke (spotanim 86 at height 12, sound 1930), strikes it (sound 448) and shouts "You
 *   shut your mouth! Don't tell them anything!" as it cries out, and goes in another puff.
 */
module.exports = function createWatchtowerScenes(api, ctx) {
  const { Animation, Graphic, HitDamage, HitMask, Location, Projectile, Sound, Sounds, StatementDialogue } = api.core;
  const { createQuestScenes } = require("../QuestScenes");
  const W = require("./State.Watchtower");

  const ENCLAVE_SCENE = "watchtower-enclave";
  /** The enclave's chunk (2560,9408) and enough of the cave for the scene (8 x 8 chunks). */
  const ENCLAVE_INSTANCE = { sourceChunk: [320, 1176], size: 8 };
  const SCENE_AT = [2585, 9425, 0];
  const SHAMAN_AT = [2592, 9434, 0];
  const DRAGON_AT = [2594, 9432, 0];
  const SEQ = { FIREBREATH: 81, SHAMAN_CAST: 5357, DRAGON_DEATH: 92, WIZARD_RELIC: 5352, SKAVID_STRUCK: 5356, OGRE_STRIKE: 359 };
  /** ogre_chieftan_caves: the ogre that silences the scared skavid (t2995). */
  const NPCS_OGRE = 4363;
  const SPOTANIM = { FIREBREATH: 1, SPELL_IMPACT: 971, RELIC: 969, SMOKE: 86 };
  const PROJECTILE_SPELL = 970;
  const SOUND = { DRAGON_ATTACK: 3266, DRAGON_HIT: 410, SPELL_CAST: 3270, SPELL_HIT: 3271, DRAGON_DEATH: 409, RELIC: 3267,
    SMOKE: 1930, OGRE_STRIKE: 448 };

  const Scenes = createQuestScenes(api, { recoveryAttribute: W.ATTRIBUTES.SCENE_EXIT, onEnd: sceneEnded });

  const sound = (player, id, delay = 0) => Sounds.sendSound(player, new Sound(id, 1, delay, 0));

  /** The cutscene's words, from the Wiki's "Inside the enclave" section. */
  function sceneLines() {
    const steps = ctx.variantSteps(W.PAGE, "entering-the-enclave-inside-the-enclave") ?? [];
    const message = steps.find((step) => step.type === "message")?.text;
    const said = steps.filter((step) => step.type === "line").map((step) => step.text);
    return { message, said };
  }

  function sceneEnded(player, scene, logout) {
    Scenes.closeFade(player);
    if (scene.name !== ENCLAVE_SCENE) return;
    if (!logout && scene.exit) player.moveTo(new Location(...scene.exit));
    // The scene counts as seen once it has played to its end (t3668); a logout or death replays it.
    if (scene.finished) ctx.state.set(player, W.VARBITS.ENCLAVE_SCENE, 1);
  }

  /** The first run past the guards: the shaman and the dragon (t3638-3670). */
  function playEnclaveScene(player, stillThere = () => true) {
    const { message, said } = sceneLines();
    const later = (ticks, fn) => api.getTaskManager().submit(new api.core.CountdownTask(player, ticks, fn));
    // +3: the cutscene starts with the player at the real entrance, fading out.
    later(3, () => {
      // Gone from the entrance in the meantime (a teleport): no scene.
      if (!player.isRegistered?.() || !stillThere()) return;
      player.moveTo(new Location(...W.TILES.ENCLAVE_INSIDE));
      Scenes.controls(player, true, true);
      Scenes.fade(player, true);
      later(3, () => startCopy(player, message, said));
    });
  }

  function startCopy(player, message, said) {
    if (!player.isRegistered?.()) return;
    const scene = Scenes.open(player, ENCLAVE_SCENE, [[2560, 2623, 9408, 9471, 0]], {}, {
      instance: ENCLAVE_INSTANCE, at: SCENE_AT, exit: [...W.TILES.ENCLAVE_INSIDE],
    });
    Scenes.controls(player, true, true);
    let shaman, dragon;
    Scenes.later(scene, 2, () => {
      shaman = Scenes.actor(scene, W.NPCS.SCENE_SHAMAN, SHAMAN_AT, [DRAGON_AT[0], DRAGON_AT[1]]);
      dragon = Scenes.actor(scene, W.NPCS.SCENE_DRAGON, DRAGON_AT, [SHAMAN_AT[0], SHAMAN_AT[1]]);
      Scenes.camera(player, [2589, 9427, 500], [2597, 9438, 200], { rate: 232, rate2: 0 });
    });
    Scenes.later(scene, 5, () => Scenes.fade(player, false));
    Scenes.later(scene, 8, () => {
      if (message) player.getDialogueManager().startDialogues(
        new api.core.DialogueChainBuilder().add(new StatementDialogue(0, message)));
    });
    Scenes.later(scene, 12, () => {
      dragon?.performGraphic(Graphic.atHeight(SPOTANIM.FIREBREATH, 92));
      dragon?.performAnimation(new Animation(SEQ.FIREBREATH));
      sound(player, SOUND.DRAGON_ATTACK);
    });
    Scenes.later(scene, 15, () => {
      dragon?.addTickHit?.(new HitDamage(30, HitMask.RED));
      sound(player, SOUND.DRAGON_HIT);
    });
    Scenes.later(scene, 16, () => { if (said[0]) shaman?.forceChat(said[0]); });
    Scenes.later(scene, 20, () => {
      shaman?.performAnimation(new Animation(SEQ.SHAMAN_CAST));
      if (said[1]) shaman?.forceChat(said[1]);
      if (shaman && dragon) {
        new Projectile(shaman.getLocation().clone(), dragon.getLocation().clone(), dragon, PROJECTILE_SPELL, 0, 50, 92, 92, null)
          .withAngle(30).withProgress(10).withSource(shaman).sendProjectile();
      }
      sound(player, SOUND.SPELL_CAST);
    });
    Scenes.later(scene, 21, () => {
      if (said[2]) shaman?.forceChat(said[2]);
      dragon?.performGraphic(Graphic.atHeight(SPOTANIM.SPELL_IMPACT, 92));
      sound(player, SOUND.SPELL_HIT);
      sound(player, SOUND.DRAGON_DEATH, 20);
    });
    Scenes.later(scene, 22, () => {
      dragon?.addTickHit?.(new HitDamage(75, HitMask.RED));
      sound(player, SOUND.DRAGON_HIT);
    });
    Scenes.later(scene, 23, () => {
      dragon?.performAnimation(new Animation(SEQ.DRAGON_DEATH));
      sound(player, SOUND.DRAGON_DEATH);
    });
    Scenes.later(scene, 24, () => Scenes.fade(player, true));
    Scenes.later(scene, 27, () => {
      scene.finished = true;
      player.getDialogueManager().reset();
      player.getPacketSender().sendInterfaceRemoval();
      Scenes.end(player, false);
      // The fade overlay closes with the scene; the cutscene state goes and the screen fades in.
      Scenes.controls(player, true, true);
      api.getTaskManager().submit(new api.core.CountdownTask(player, 2, () => {
        Scenes.controls(player, false, true);
        Scenes.fade(player, false);
      }));
    });
  }

  /** The wizard assembles the relic (t2037); the relic's box follows three ticks later (the line's pauseTicks). */
  function assembleRelic(player, wizard) {
    wizard?.performAnimation(new Animation(SEQ.WIZARD_RELIC));
    wizard?.performGraphic(Graphic.atHeight(SPOTANIM.RELIC, 50));
    sound(player, SOUND.RELIC);
  }

  /**
   * The scared skavid silenced (t2995-3001): as the chat closes an ogre (ogre_chieftan_caves, 4363) is
   * there a tile south of the skavid, for the player alone; two ticks on it strikes (seq 359) and
   * shouts while the skavid is hit (seq 5356) and cries out; four ticks after that it is gone and the
   * skavid's next line shows (the line's pauseTicks).
   */
  /** The silencing ogre each player has out, so a logout or death removes it (its timer goes with the player). */
  const silencers = new Map();
  function removeSilencer(player) {
    const ogre = silencers.get(player);
    silencers.delete(player);
    if (!ogre?.isRegistered?.()) return;
    // The ogre goes in a puff of smoke, as it came (t3001).
    smoke(player, ogre.getLocation());
    api.removeNpc(ogre);
  }
  function smoke(player, at) {
    player.getPacketSender().sendGraphic(Graphic.atHeight(SPOTANIM.SMOKE, 12), at.clone());
    sound(player, SOUND.SMOKE);
  }

  function silenceSkavid(player, skavid, shout, cry) {
    const at = skavid?.getLocation?.();
    if (!at) return;
    removeSilencer(player);
    const ogre = api.spawnNpc({ id: NPCS_OGRE, x: at.getX(), y: at.getY() - 1, z: at.getZ(), wanderRadius: 0, owner: player, ownerOnly: true });
    if (ogre) {
      ogre.__skipDefaultRespawn = true;
      ogre.setPositionToFace(at.clone());
      silencers.set(player, ogre);
      smoke(player, ogre.getLocation());
    }
    const later = (ticks, fn) => api.getTaskManager().submit(new api.core.CountdownTask(player, ticks, fn));
    later(2, () => {
      skavid.performAnimation(new Animation(SEQ.SKAVID_STRUCK));
      if (cry) skavid.forceChat(cry);
      ogre?.performAnimation(new Animation(SEQ.OGRE_STRIKE));
      if (shout) ogre?.forceChat(shout);
      sound(player, SOUND.OGRE_STRIKE);
    });
    later(6, () => removeSilencer(player));
  }

  function cancel({ player }) {
    if (!player) return;
    if (silencers.has(player)) removeSilencer(player);
    if (Scenes.get(player)) Scenes.end(player, true);
  }

  return { Scenes, playEnclaveScene, assembleRelic, silenceSkavid, cancel, ENCLAVE_SCENE };
};
