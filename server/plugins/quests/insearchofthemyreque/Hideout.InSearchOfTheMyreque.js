/**
 * In Search of the Myreque: Vanstrom's cutscene in the hideout and the Skeleton Hellhound fight, as live plays them (rsprox
 * capture of a full playthrough, revision 242, docs/in-search-of-the-myreque.md; ticks are that recording's).
 *
 * The words are the transcript's (Veliaf's "after introduced" variant); this unit plays what happens between them.
 * Live holds the chat with an empty box while each beat plays; the transcript runner's line `pauseTicks` closes the
 * chatbox for the same ticks instead.
 *
 * - Veliaf's thanks (tick 1298): the screen fades, and three ticks later the scene opens in a copy of the hideout
 *   (rebuild_region): stage 70, the player on (3506,9839), the six members in their cutscene forms, the camera on the
 *   room (move (3506,9845) 555, look (3505,9832) 85), the fade back in two ticks later and the mist (5057) two after that.
 * - "Vampyre!": the mist drifts two tiles north and becomes Vanstrom (9632, vyrelord_transform_pt2) on (3505,9835).
 * - Each blood barrage (vyrelord_barrage 8704): the face a tick after the line, the cast the next tick, the impact
 *   (spotanim 377, human_unarmed_def 425) two ticks on, the hit (Sani 30, Harold 40) and the death; the next line comes
 *   eight ticks after the one before the cast.
 * - "And now... A little gift for the rest of you.": vyrelord_summon (8722), the hound (5054, skeleton_hound_summon 1498)
 *   on (3505,9836) two ticks on, Vanstrom turns to mist and drifts away; twelve ticks after the line the cutscene ends
 *   (stage 80), the copy's tunnel becomes "Cave entrance" with Escape (38094) and the hound attacks.
 * - The kill (tick 1458): stage 85 and a fade a tick later, out of the copy onto (3506,9837) two ticks on, the fade back
 *   in, and Veliaf starts talking two ticks after that (no Talk-to).
 */
const SCENE = "in-search-of-the-myreque-hideout";
const ROOM_BOUNDS = [[3500, 3519, 9829, 9849, 0]];
/** The copy: 13 x 13 chunks of every plane around the hideout, as QuestScenes copies live's rebuild_region. */
const SOURCE_CHUNK = [(3505 >> 3) - 6, (9838 >> 3) - 6];
const SCENE_START = [3506, 9839, 0];
/** Where a logout or death in the copy comes back to: the main cave outside the hideout's tunnel. Ours. */
const SCENE_EXIT = [3492, 9824, 0];
const AFTER_KILL_TILE = [3506, 9837, 0];
const CAMERA_MOVE = [3506, 9845, 555];
const CAMERA_LOOK = [3505, 9832, 85];
const CAM_FORCE_ANGLE_SCRIPT = 143;
const CAM_FORCE_ANGLE = [160, 960];

const ACTORS = {
  veliaf: { id: 9621, at: [3505, 9839], face: [3506, 9839] },
  harold: { id: 9625, at: [3504, 9837], face: [3514, 9837] },
  sani: { id: 9623, at: [3508, 9836], face: [3498, 9846] },
  radigad: { id: 9627, at: [3511, 9834], face: [3505, 9834] },
  polmafi: { id: 9629, at: [3512, 9838], face: [3505, 9834] },
  ivan: { id: 9631, at: [3511, 9842], face: [3505, 9834] },
};
const MIST_NPC_ID = 5057;
const VANSTROM_NPC_ID = 9632;
const HELLHOUND_NPC_ID = 5054;
const ESCAPE_LOC_ID = 38094; // route_cavewalltunnel_escape: "Cave entrance", Escape / Quick-escape
const ESCAPE_LOC = { id: ESCAPE_LOC_ID, x: 3505, y: 9831, type: 10, face: 1 };
const ROOM_FOCUS = [3505, 9834];

const ANIM = {
  transformIn: 8745, // vyrelord_transform_pt2
  barrage: 8704, // vyrelord_barrage
  summon: 8722, // vyrelord_summon
  transformOut: 15167, // vyrelord_transform_pt1_loop
  defend: 425, // human_unarmed_def
  houndSummon: 1498, // skeleton_hound_summon
};
const BARRAGE_IMPACT_SPOTANIM = 377; // spell_blood_barrage_impact
const SOUND = {
  mist: 4374, // mist_loop_test
  transformIn: 4358, // mory_vanstrom_mist_transform_return
  bloodRange: 4415, // mory_vanstrom_blood_range_attack
  bloodCast: 106, // blood_cast
  barrageImpact: 102, // blood_barrage_impact
  summonCast: 151, // entangle_cast_and_fire
  summonHound: 1189, // summon_skeletalhound
  transformOut: 4394, // mory_vanstrom_mist_transform
  crawl: 2454, // climbing_loop
};
const CRAWL_ANIMATION = 2796; // human_longcrawl
const VICTIMS = {
  sani: { damage: 30, hitSound: 506, deathSound: 505 }, // female_hit, female_death
  harold: { damage: 40, hitSound: 513, deathSound: 512 }, // human_hit, human_death
};

/** The transcript lines the beats hang on, and how long each holds the conversation (ticks, from the capture). */
const LINES = {
  thanks: { text: "These weapons look great! Many thanks.", pause: 9 },
  vampyre: { text: "Vampyre!", pause: 5 },
  sani: { text: "We're dead!", pause: 8 },
  harold: { text: "Sorry Harold, you too!", pause: 8 },
  gift: { text: "And now... A little gift for the rest of you.", pause: 12 },
};

module.exports = function createMyrequeHideout(api, { Scenes, quest, stages, onKilled }) {
  const { Animation, Graphic, HitDamage, HitMask, Location } = api.core;

  const inScene = (player) => Scenes.get(player)?.name === SCENE;

  function actorFace(npc, [x, y]) {
    if (npc?.isRegistered?.()) Scenes.face(npc, [x, y]);
  }

  /**
   * Veliaf's thanks: the fade, then the copy of the room three ticks on. The transcript's pause holds the conversation
   * meanwhile (a chain started here would end it, so there is no held box).
   */
  function start(player) {
    if (inScene(player)) return;
    Scenes.fade(player, true);
    Scenes.controls(player, true, true);
    Scenes.later(player, 2, () => open(player));
  }

  function open(player) {
    if (!player.isRegistered?.()) return; // logged out during the fade: the thanks line plays again on the next talk
    if (quest.getStage(player) < stages.DELIVERED_WEAPONS) quest.setStage(player, stages.DELIVERED_WEAPONS);
    const scene = Scenes.open(player, SCENE, ROOM_BOUNDS, { canTeleport: () => (scene.fighting ? null : false) }, {
      instance: { sourceChunk: SOURCE_CHUNK },
      at: SCENE_START,
      exit: SCENE_EXIT,
    });
    scene.cast = {};
    for (const [name, { id, at, face }] of Object.entries(ACTORS)) {
      scene.cast[name] = Scenes.actor(scene, id, [at[0], at[1], 0], face);
    }
    Scenes.controls(player, true, true);
    Scenes.hideTabs(player);
    player.getPacketSender().sendCameraUnlock(false).sendClientScript(CAM_FORCE_ANGLE_SCRIPT, ...CAM_FORCE_ANGLE);
    Scenes.later(scene, 1, () => Scenes.camera(player, CAMERA_MOVE, CAMERA_LOOK));
    Scenes.later(scene, 2, () => Scenes.fade(player, false));
    Scenes.later(scene, 4, () => {
      scene.mist = Scenes.actor(scene, MIST_NPC_ID, [3504, 9832, 0], [3504, 9831]);
    });
    Scenes.later(scene, 5, () => { actorFace(scene.cast.harold, ROOM_FOCUS); actorFace(scene.cast.sani, ROOM_FOCUS); });
    Scenes.later(scene, 6, () => { Scenes.face(player, ROOM_FOCUS); actorFace(scene.cast.veliaf, ROOM_FOCUS); });
  }

  /** "Vampyre!": the mist drifts north and Vanstrom steps out of it. */
  function reveal(player) {
    const scene = Scenes.get(player);
    if (scene?.name !== SCENE) return;
    player.getPacketSender().sendSound(SOUND.mist, 3, 0);
    Scenes.walk(scene.mist, [3504, 9834, 0]);
    Scenes.later(scene, 3, () => {
      if (scene.mist) Scenes.removeActor(scene, scene.mist);
      scene.mist = null;
      scene.vanstrom = Scenes.actor(scene, VANSTROM_NPC_ID, [3505, 9835, 0], [3505, 9839]);
      scene.vanstrom?.performAnimation(new Animation(ANIM.transformIn));
      player.getPacketSender().sendSound(SOUND.transformIn, 1, 0);
    });
  }

  /** One blood barrage: face, cast, impact, hit; the engine plays the death and takes the actor away. */
  function barrage(player, victimName) {
    const scene = Scenes.get(player);
    const victim = scene?.cast?.[victimName];
    if (scene?.name !== SCENE || !victim?.isRegistered?.()) return;
    const { damage, hitSound, deathSound } = VICTIMS[victimName];
    const sender = player.getPacketSender();
    Scenes.later(scene, 1, () => { if (scene.vanstrom) Scenes.face(scene.vanstrom, victim.getLocation()); });
    Scenes.later(scene, 2, () => {
      scene.vanstrom?.performAnimation(new Animation(ANIM.barrage));
      sender.sendSound(SOUND.bloodRange, 1, 10).sendSound(SOUND.bloodCast, 1, 0);
    });
    Scenes.later(scene, 4, () => {
      victim.performGraphic(Graphic.delayed(BARRAGE_IMPACT_SPOTANIM, 25));
      victim.performAnimation(new Animation(ANIM.defend, 20));
      sender.sendSound(hitSound, 1, 25).sendSound(SOUND.barrageImpact, 1, 25);
    });
    Scenes.later(scene, 5, () => {
      if (!victim.isRegistered()) return;
      victim.setMaxHitpoints(damage);
      victim.setHitpoints(damage);
      victim.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.RED)]);
    });
    Scenes.later(scene, 6, () => sender.sendSound(deathSound, 1, 0));
    Scenes.later(scene, 7, () => { if (scene.cast[victimName]) Scenes.removeActor(scene, victim); scene.cast[victimName] = null; });
  }

  /** "And now...": the summons, the hound, and Vanstrom gone as mist. */
  function gift(player) {
    const scene = Scenes.get(player);
    if (scene?.name !== SCENE) return;
    const sender = player.getPacketSender();
    Scenes.later(scene, 1, () => {
      scene.vanstrom?.performAnimation(new Animation(ANIM.summon));
      sender.sendSound(SOUND.summonCast, 1, 0);
    });
    Scenes.later(scene, 2, () => sender.sendSound(SOUND.summonHound, 1, 0));
    Scenes.later(scene, 3, () => {
      scene.hound = Scenes.actor(scene, HELLHOUND_NPC_ID, [3505, 9836, 0], [3505, 9851]);
      scene.hound?.performAnimation(new Animation(ANIM.houndSummon));
    });
    Scenes.later(scene, 4, () => {
      scene.vanstrom?.performAnimation(new Animation(ANIM.transformOut));
      sender.sendSound(SOUND.transformOut, 1, 0);
    });
    Scenes.later(scene, 7, () => {
      if (scene.vanstrom) Scenes.removeActor(scene, scene.vanstrom);
      scene.vanstrom = null;
      scene.mist = Scenes.actor(scene, MIST_NPC_ID, [3504, 9834, 0], [3504, 9833]);
    });
    Scenes.later(scene, 8, () => {
      sender.sendSound(SOUND.mist, 3, 0);
      Scenes.walk(scene.mist, [3504, 9832, 0]);
    });
    Scenes.later(scene, 11, () => { if (scene.mist) Scenes.removeActor(scene, scene.mist); scene.mist = null; });
  }

  /** The transcript's "Cutscene ends": stage 80, controls back, the copy's escape tunnel, and the hound attacks. */
  function finish(player) {
    const scene = Scenes.get(player);
    if (scene?.name !== SCENE || scene.fighting) return;
    scene.fighting = true;
    if (quest.getStage(player) < stages.HELLHOUND_SUMMONED) quest.setStage(player, stages.HELLHOUND_SUMMONED);
    Scenes.controls(player, false);
    Scenes.restoreTabs(player);
    Scenes.closeFade(player);
    player.getPacketSender().sendCameraUnlock(false).sendCameraReset();
    Scenes.loc(scene, ESCAPE_LOC);
    if (!scene.hound?.isRegistered?.()) scene.hound = Scenes.actor(scene, HELLHOUND_NPC_ID, [3505, 9836, 0]);
    scene.hound?.getCombat().attack(player);
  }

  /** The transcript line hooks: each beat starts after its line and holds the conversation for its ticks. */
  function line(event) {
    const { player, text } = event;
    if (!player) return false;
    const stage = quest.getStage(player);
    if (text === LINES.thanks.text && stage >= stages.MET_VELIAF && stage < stages.HELLHOUND_SUMMONED && !inScene(player)) {
      event.pauseTicks = LINES.thanks.pause;
      event.after = () => start(player);
      return true;
    }
    if (!inScene(player)) return false;
    if (text === LINES.vampyre.text) {
      event.pauseTicks = LINES.vampyre.pause;
      event.after = () => reveal(player);
    } else if (text === LINES.sani.text) {
      event.pauseTicks = LINES.sani.pause;
      event.after = () => barrage(player, "sani");
    } else if (text === LINES.harold.text) {
      event.pauseTicks = LINES.harold.pause;
      event.after = () => barrage(player, "harold");
    } else if (text === LINES.gift.text) {
      event.pauseTicks = LINES.gift.pause;
      event.after = () => gift(player);
    } else {
      return false;
    }
    return true;
  }

  /**
   * The copy's tunnel (Escape, Quick-escape): out to the main cave as the hideout's own tunnel crawls (ticks 1557-1559:
   * human_longcrawl, the fade, the move two ticks on). Ours: both ops crawl; Quick-escape is not captured.
   */
  function escape(event) {
    const { player } = event;
    if (!inScene(player)) return false;
    event.handled = true;
    Scenes.controls(player, true);
    player.performAnimation(new Animation(CRAWL_ANIMATION));
    player.getPacketSender().sendSound(SOUND.crawl, 3, 4);
    Scenes.fade(player, true);
    Scenes.later(player, 2, () => {
      Scenes.end(player, false);
      player.moveTo(new Location(...SCENE_EXIT));
      player.performAnimation(new Animation(-1));
      Scenes.fade(player, false);
    });
    return true;
  }

  /** The kill in the copy: the fade, out onto the real hideout's tile, the fade back in and Veliaf's words. */
  function killed(player) {
    if (inScene(player)) {
      Scenes.later(player, 1, () => Scenes.fade(player, true));
      Scenes.later(player, 3, () => {
        Scenes.end(player, false);
        player.moveTo(new Location(...AFTER_KILL_TILE));
      });
      Scenes.later(player, 5, () => Scenes.fade(player, false));
      Scenes.later(player, 7, () => onKilled(player));
      return;
    }
    Scenes.later(player, 2, () => onKilled(player));
  }

  return { line, finish, escape, killed, inScene, SCENE, ESCAPE_LOC_ID, HELLHOUND_NPC_ID };
};
