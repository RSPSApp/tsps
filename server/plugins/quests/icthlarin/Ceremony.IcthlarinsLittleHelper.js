/**
 * Icthlarin's Little Helper: the ceremony, from its supplies to the end (stages 15-26), as the capture plays it
 * (local 1002310; docs/quests/icthlarins-little-helper).
 *
 * - Supplies (Wiki, not captured: the account brought a bag of salt and a bucket of sap): a bucket filled at
 *   the salt lake (Water 6605, "Collect"), dried on the suntrap (6606, "Use"); sap from a knife on an
 *   evergreen tree with a bucket; linen from Raetul (Talk).
 * - The ceremony: its priests and High Priest stand in the eastern room from stage 16 (t2515). Opening its door
 *   at stage 19 (t3111) is the cutscene: the Wanderer teleports in, turns into Amascut and possesses a priest
 *   (stage 22, t3148). Killing him (stage 23, t3219) leaves the jar's potion (Wiki). The High Priest's
 *   thanks takes the holy symbol (stage 24, t3281).
 * - Leaving the room at 24 (t3298) is the last flashback: Icthlarin frees the player at the ladder (stage 25,
 *   t3325), back outside the pyramid. The town High Priest's trinket completes the quest (t3378).
 */
function createCeremony(api, state, common, { STAGE, VARBIT, JARS, pyramid, getQuest }) {
  const { Location, Item, NpcIdentifiers, ItemOnGroundManager, Graphic } = api.core;
  const { CAMERA_RATES } = require("../QuestScenes");
  const Scenes = pyramid.Scenes;

  const NPC = Object.freeze({
    HIGH_PRIEST: 11649, // ics_little_hipriest_ceremony (multi: 11602 noop, 11603 op)
    PRIEST: 11606, // ics_little_priest_ceremony
    WANDERER: 11590, // ics_little_redheadlady_ceremony
    DEVOURER: 11591, // ics_little_devourer_ceremony
    POSSESSING: 11608, // ics_little_priest_ceremony_possessed
    POSSESSED: 4210, // ics_little_possessedpriest
    ICTHLARIN: 4199, // ics_little_ic
  });
  /** The ceremony's places (t2515, t3076). The priest at (3303, 9195) is the one possessed (t3136). */
  const CEREMONY_ACTORS = [
    { id: NPC.HIGH_PRIEST, tile: [3308, 9195], face: [3307, 9195], role: "highPriest" },
    { id: NPC.PRIEST, tile: [3307, 9193], face: [3307, 9194] },
    { id: NPC.PRIEST, tile: [3304, 9193], face: [3304, 9194] },
    { id: NPC.PRIEST, tile: [3303, 9195], face: [3304, 9195], role: "victim" },
  ];
  const WANDERER_TILE = [3308, 9197]; // t3120
  const ICTHLARIN_TILE = [3274, 9171]; // t3307
  const LAST_FLASHBACK_AT = [3282, 9171, 0]; // t3307
  const WATER = 6605; // icthalarins_waters_edge
  const SUNTRAP = 6606; // icthalarins_suntrap_centre
  const EVERGREEN = "Evergreen tree";

  const roles = new WeakMap();
  const stage = (player) => state.stage(player);

  // ---------------------------------------------------------------------------
  // Supplies
  // ---------------------------------------------------------------------------

  /** Wiki (Bucket of saltwater): a bucket filled from the lake, 1 tick. Ours: no message (none recorded). */
  function collectWater(event) {
    const { player } = event;
    if (stage(player) !== STAGE.PREPARATIONS) return false;
    if (!common.held(player, common.ITEM.BUCKET)) return false;
    common.replaceInSlot(player, common.ITEM.BUCKET, common.ITEM.BUCKET_OF_SALTWATER);
    return true;
  }

  /** The suntrap: the transcript's pour and evaporate (or "You don't have anything suitable..."; rec 331). */
  function useSuntrap(event) {
    const { player } = event;
    common.play(player, NpcIdentifiers.EMBALMER, "ceremony-preparations-aiding-the-embalmer-using-the-suntrap");
    return true;
  }

  function saltwaterOnSuntrap(event) {
    if (event.itemId !== common.ITEM.BUCKET_OF_SALTWATER) return false;
    return useSuntrap(event);
  }

  /** The suntrap's "pile of salt" action: the bucket's water for a pile of salt and the empty bucket. */
  function makeSalt(player) {
    if (!common.held(player, common.ITEM.BUCKET_OF_SALTWATER)) return;
    common.replaceInSlot(player, common.ITEM.BUCKET_OF_SALTWATER, common.ITEM.BUCKET);
    player.getInventory().adds(common.ITEM.PILE_OF_SALT, 1);
    state.set(player, VARBIT.SALT_FROM_SUNTRAP, 1);
  }

  /** Wiki (Bucket of sap): a knife on an evergreen tree with a bucket (2 ticks), the transcript's message. */
  function knifeOnTree(event) {
    const { player } = event;
    if (event.itemId !== common.ITEM.KNIFE || stage(player) !== STAGE.PREPARATIONS || state.get(player, VARBIT.GOT_SAP)) return false;
    if (!common.held(player, common.ITEM.BUCKET)) return false;
    common.later(player, 2, () => {
      if (!common.replaceInSlot(player, common.ITEM.BUCKET, common.ITEM.BUCKET_OF_SAP)) return;
      common.play(player, NpcIdentifiers.EMBALMER, "ceremony-preparations-aiding-the-embalmer-collecting-tree-sap");
    });
    return true;
  }

  /** Empty on the quest's buckets: the bucket back (items' cache option). */
  function emptyBucket(event) {
    const { player, itemId, option } = event;
    if (option !== "Empty") return false;
    if (itemId !== common.ITEM.BUCKET_OF_SAP && itemId !== common.ITEM.BUCKET_OF_SALTWATER) return false;
    common.replaceInSlot(player, itemId, common.ITEM.BUCKET);
    return true;
  }

  // ---------------------------------------------------------------------------
  // The ceremony in the eastern room
  // ---------------------------------------------------------------------------

  /** Pyramid's visit setup: the ceremony's NPCs, from the holy symbol to the priest's thanks. */
  function ceremonySetup(scene, visit) {
    const player = scene.owner;
    const s = stage(player);
    const present = s === STAGE.CEREMONY_BEGUN || (s >= STAGE.WARN_CEREMONY && s <= STAGE.ICTHLARIN_NEXT);
    if (!present) return;
    const cast = {};
    for (const actor of CEREMONY_ACTORS) {
      const npc = Scenes.actor(scene, actor.id, [...actor.tile, 0], actor.face);
      if (npc && actor.role) cast[actor.role] = npc;
    }
    if (s >= STAGE.POSSESSED && s < STAGE.PRIEST_DEAD && cast.victim) {
      // A fight left by a logout is fought again (Wiki: leave and re-enter for a full-health priest).
      Scenes.removeActor(scene, cast.victim);
      cast.victim = Scenes.actor(scene, NPC.POSSESSED, [3303, 9195, 0], [3304, 9195]);
      if (cast.victim) cast.victim.__icthlarinOwner = player;
    }
    if (s >= STAGE.PRIEST_DEAD && cast.victim) Scenes.removeActor(scene, cast.victim);
    roles.set(player, cast);
    visit.ceremony = cast;
  }

  /** The eastern door at 19 (the cutscene) and 24 (the last flashback). */
  function eastDoor(request) {
    const { player } = request;
    if (pyramid.inFlashback(player)) return;
    if (request.stage === STAGE.WARN_CEREMONY) {
      request.handled = true;
      common.sfx(player, "scrape");
      common.later(player, 1, () => ceremonyScene(player));
    } else if (request.stage === STAGE.ICTHLARIN_NEXT) {
      request.handled = true;
      lastFlashback(player);
    }
  }

  /** The cutscene (t3111-t3149): cinematic on, the camera on the room, the variant's lines at the player's pace. */
  function ceremonyScene(player) {
    state.setStage(player, STAGE.CEREMONY);
    state.setStage(player, STAGE.DEVOURER);
    Scenes.controls(player, true, true);
    Scenes.hideTabs(player);
    Scenes.camera(player, [3297, 9191, 520], [3310, 9197, 320], CAMERA_RATES);
    common.later(player, 2, () => common.play(player, NPC.HIGH_PRIEST, "the-devourer-revealed-opening-the-door-to-the-eastern-chamber"));
  }

  function wandererArrives(player) {
    const scene = Scenes.get(player);
    const cast = roles.get(player);
    if (!scene || !cast) return;
    cast.wanderer = Scenes.actor(scene, NPC.WANDERER, [...WANDERER_TILE, 0], [3307, 9196]);
    cast.wanderer?.performGraphic?.(new Graphic(common.SPOTANIM.abyssal_demon_teleport));
    common.sfx(player, "quick_teleport");
  }

  /** Lines that move the scene (t3130 Amascut, t3136 the priest, t3145 she leaves). */
  const SCENE_LINES = {
    "Adventurer, kill these pathetic priests.": (player, cast) => cast.wanderer?.setNpcTransformationId(NPC.DEVOURER),
    "You! Priest of the dog lord. You are now mine. Kill your brethren!": (player, cast) => cast.victim?.setNpcTransformationId(NPC.POSSESSING),
    "Protect us, adventurer! We must complete the ceremony!": (player, cast) => {
      if (cast.wanderer) Scenes.removeActor(Scenes.get(player), cast.wanderer);
      cast.wanderer = null;
    },
  };

  function sceneLine(request) {
    const cast = roles.get(request.player);
    const effect = SCENE_LINES[String(request.text ?? "")];
    if (!cast || !effect || stage(request.player) !== STAGE.DEVOURER) return;
    const before = request.before;
    request.before = () => { before?.(); effect(request.player, cast); };
  }

  /** "The Devourer teleports away" (t3144: 409 and quick_teleport, both 20 cycles late). */
  function devourerLeaves(player) {
    const cast = roles.get(player);
    cast?.wanderer?.performGraphic?.(new Graphic(common.SPOTANIM.abyssal_demon_teleport, 20));
    common.sfx(player, "quick_teleport", 20);
  }

  /** The cutscene's end (t3148-t3149): stage 22, the possessed priest, controls back. */
  function sceneEnds(player) {
    if (stage(player) !== STAGE.DEVOURER) return;
    state.setStage(player, STAGE.POSSESSED);
    const scene = Scenes.get(player);
    const cast = roles.get(player);
    if (scene && cast?.victim) {
      Scenes.removeActor(scene, cast.victim);
      cast.victim = Scenes.actor(scene, NPC.POSSESSED, [3303, 9195, 0], [3304, 9195]);
      if (cast.victim) {
        cast.victim.__icthlarinOwner = player;
        cast.victim.getCombat?.().attack?.(player);
      }
    }
    Scenes.controls(player, false);
    Scenes.restoreTabs(player);
    player.getPacketSender().sendCameraReset();
  }

  /** The possessed priest's death (t3217): stage 23 and the jar's potion (Wiki, Possessed Priest). */
  function priestDied(event) {
    const npc = event.npc;
    const player = npc?.__icthlarinOwner;
    if (!player || npc.getId() !== NPC.POSSESSED) return;
    if (stage(player) !== STAGE.POSSESSED) return;
    state.setStage(player, STAGE.PRIEST_DEAD);
    const potion = state.jar(player)?.potion;
    if (Number.isInteger(potion)) ItemOnGroundManager.registerNonGlobals(player, new Item(potion, 1), npc.getLocation().clone());
    const cast = roles.get(player);
    if (cast) cast.victim = null;
  }

  // ---------------------------------------------------------------------------
  // The last flashback (t3298-t3333)
  // ---------------------------------------------------------------------------

  function lastFlashback(player) {
    common.mesbox(player, "All of a sudden, a final sense of deja-vu sweeps over you...");
    common.later(player, 3, () => {
      common.release(player);
      common.sfx(player, "hypnotise");
      common.fade(player, common.FADE.TO_BLACK);
      common.later(player, 2, () => {
        Scenes.controls(player, true, true);
        Scenes.hideTabs(player);
        pyramid.build(player, LAST_FLASHBACK_AT, {
          flashback: true,
          setup: (scene) => { roles.set(player, { icthlarin: Scenes.actor(scene, NPC.ICTHLARIN, [...ICTHLARIN_TILE, 0], [3274, 9172]) }); },
        });
        common.later(player, 1, () => Scenes.camera(player, [3286, 9169, 510], [3277, 9171, 110], CAMERA_RATES));
        common.later(player, 2, () => common.fade(player, common.FADE.TO_PAST));
        common.later(player, 5, () => common.play(player, NPC.ICTHLARIN, "the-devourer-revealed-flashback-4-leaving-the-ceremonial-room",
          (steps) => steps.filter((step) => step.id !== "9NX8C8")));
      });
    });
  }

  /** "The flashback ends" (t3325): stage 25, out to the door, the last line. */
  function lastFlashbackEnds(player, event) {
    if (stage(player) !== STAGE.ICTHLARIN_NEXT) return;
    state.setStage(player, STAGE.FINISH);
    common.sfx(player, "hypnotise");
    common.fade(player, common.FADE.FROM_PAST);
    if (event) {
      // The last line waits for the town (t3327 -> t3331).
      event.pauseTicks = 4;
    }
    common.later(player, 2, () => {
      state.set(player, VARBIT.FLASHBACK, 0);
      pyramid.toTown(player);
      Scenes.controls(player, false);
      Scenes.restoreTabs(player);
      player.getPacketSender().sendCameraReset();
      common.later(player, 2, () => common.fade(player, common.FADE.FROM_BLACK, { close: 7 }));
    });
  }

  // ---------------------------------------------------------------------------
  // Completion (t3378)
  // ---------------------------------------------------------------------------

  /** The High Priest's trinket: the amulet, the quest's rewards and scroll, the quest-only items gone. */
  function finish(player) {
    for (const jar of JARS) if (jar) removeAll(player, jar.item);
    for (const id of [common.ITEM.TOKEN, common.ITEM.HOLY_SYMBOL, common.ITEM.UNHOLY_SYMBOL, common.ITEM.BUCKET_OF_SAP,
      common.ITEM.PILE_OF_SALT, common.ITEM.BUCKET_OF_SALTWATER, common.ITEM.LINEN]) removeAll(player, id);
    getQuest().complete(player);
  }

  function removeAll(player, itemId) {
    const amount = player.getInventory().getAmount(itemId);
    if (amount > 0) player.getInventory().deleteNumber(itemId, amount);
  }

  function handleAction(event) {
    const { player, stepId } = event;
    switch (stepId) {
      case "v-TFI2": event.handled = true; makeSalt(player); return;
      case "juxFZi": wandererArrives(player); return;
      case "KGKUnx": devourerLeaves(player); return;
      case "zMjQK_": sceneEnds(player); return;
      case "UAAgOr": lastFlashbackEnds(player, event); return;
      default:
    }
  }

  return {
    collectWater, useSuntrap, saltwaterOnSuntrap, knifeOnTree, emptyBucket, ceremonySetup, eastDoor, sceneLine,
    priestDied, finish, handleAction, WATER, SUNTRAP, EVERGREEN, NPC,
  };
}

module.exports = { createCeremony };
