/**
 * Icthlarin's Little Helper: Klenter's Pyramid, as the capture plays it (local 1002310; ticks in
 * docs/quests/ictlharins-little-helper).
 *
 * Every visit is a private copy of the pyramid (live rebuilds the map each time: `build_area`), with its five
 * mummies, the scarab swarm that comes up past them, the pit, the western jar room and the eastern ceremonial
 * room. The flashbacks play in the same copy, rebuilt as they start and end:
 *
 * - Flashback 1 (stage 3/4): touching the door (t1033). The jar becomes the unholy symbol in its slot, the
 *   sepia tint and overlay 146 go up. The western door's puzzle ends it (stage 5, t1229); the ladder's "Do you
 *   want to leave?" ends it early (t1072), stage kept.
 * - Flashback 2 (stage 8 -> 9): the deja-vu as the pit is jumped (t1964), landing north of it at the jar room.
 *   The right jar brings its apparition (10); its death (11); the jar taken; back over the pit ends it (12).
 * - Flashback 3 (stage 16 -> 17): the deja-vu at the pit again (t3024): the unholy symbol into a sarcophagus in
 *   the eastern room (18); out through its door ends it (19) with the ceremony set up.
 *
 * Inside a flashback teleports are refused ("An outside force seems to be blocking your teleport.", t2015;
 * Wiki: until it ends or the player dies). A logout leaves the player outside the door (Wiki) with the
 * present's item back; dying costs the cat (Wiki).
 */
function createPyramid(api, state, common, { STAGE, VARBIT, JARS }) {
  const { Location, NpcIdentifiers, Misc, Skill, ForceMovement, TaskManager, CountdownTask } = api.core;
  const { createQuestScenes } = require("../QuestScenes");

  const RECOVERY_ATTRIBUTE = "icthlarins-little-helper:pyramid-exit";
  const Scenes = createQuestScenes(api, { onEnd: sceneEnded, recoveryAttribute: RECOVERY_ATTRIBUTE });

  // ---------------------------------------------------------------------------
  // The map (source tiles)
  // ---------------------------------------------------------------------------

  const BOUNDS = [[3268, 3316, 9164, 9206, 0]];
  const INSTANCE = { sourceChunk: [408, 1145], size: 7 };
  const EXIT = [3294, 2781, 0]; // outside the door (t1074, t1864, t2397)
  const ENTRY = [3277, 9171, 0]; // inside, by the ladder (t1042, t1856)
  const FLASHBACK_2_START = [3280, 9200, 0]; // t1972
  const FLASHBACK_3_START = [3295, 9198, 0]; // t3032
  const SOUTH_OF_PIT = [3292, 9192, 0]; // a flashback over the pit ends here (t2180, t3076)
  const PIT_FALL_LANDING = [3312, 9180, 0]; // t2200
  const PIT_FALL_STEP = [3311, 9180, 0]; // t2202
  const APPARITION_TILE = [3284, 9193, 0]; // t2048
  /** The mummies the capture's copies hold (949-953 at their spawn tiles). */
  const MUMMIES = [[949, 3279, 9176], [950, 3277, 9186], [951, 3310, 9171], [952, 3284, 9189], [953, 3306, 9183]];
  /** Ours: the box round the four recorded swarm spawns (3296-3300, 9176-9178). */
  const SCARAB_ZONE = { minX: 3295, maxX: 3301, minY: 9175, maxY: 9179 };
  const SCARAB_SWARM = 4192; // ics_scarab_swarm
  const JAR_ROOM = { minX: 3276, maxX: 3288, minY: 9191, maxY: 9199 };
  const EAST_ROOM = { minX: 3299, maxX: 3312, minY: 9191, maxY: 9199 };
  /** The doors' walls sit on the north edge of their tile (rotation 1): the room is south. */
  const WEST_DOOR = [3280, 9199];
  const EAST_DOOR = [3306, 9199];

  const LOC = Object.freeze({
    PYRAMID_DOOR: 6614, // icthalarins_temple_door
    LADDER: 6645, // ics_ladder
    PIT_SOUTH: 6632, // ics_little_pit_to: from the south, jumps north
    PIT_NORTH: 6633, // ics_little_pit_from: from the north, jumps south
    WEST_DOOR: 44059, // icthalarins_ancient_temple_door_1
    EAST_DOOR: 44060, // icthalarins_ancient_temple_door_2
    SARCOPHAGUS: 44600, // ics_sarcophigi_door_2
    TABLE: 6631, // the jar table (Wiki transcript: "hide the symbol under the table")
  });
  const JAR_BY_LOC = new Map(JARS.filter(Boolean).map((jar, i) => [jar.loc, { ...jar, value: i + 1 }]));

  const DOOR_OPENS = 2000; // icthalarins_door_opens
  const DOOR_CLOSES = 1999; // icthalarins_door_closes
  const TELEPORT_BLOCKED = "An outside force seems to be blocking your teleport.";

  // ---------------------------------------------------------------------------
  // Per-visit state
  // ---------------------------------------------------------------------------

  /** { mummies, swarm, apparition, swapped: { slot, presentId, pastJar } } per player while in the copy. */
  const visits = new WeakMap();
  const visit = (player) => visits.get(player) ?? null;
  const inFlashback = (player) => state.get(player, VARBIT.FLASHBACK) === 1;
  const inPyramid = (player) => Scenes.get(player)?.name === "klenter's pyramid";

  /** The copy's rules: mummies and swarms attack as usual, teleports only outside a flashback. */
  function rules(player) {
    return {
      canTeleport: () => refuseInFlashback(player),
      npcAggression: () => null,
      process: scarabWatch,
      barsFollowers: false,
    };
  }

  /** Builds (or rebuilds) the copy and puts the player at `at`; `setup` places the visit's actors. */
  function build(player, at, { flashback = false, setup } = {}) {
    const existing = Scenes.get(player);
    let scene;
    if (existing && existing.name === "klenter's pyramid") {
      scene = existing;
      Scenes.swap(scene, INSTANCE, at);
    } else {
      scene = Scenes.open(player, "klenter's pyramid", BOUNDS, rules(player), { instance: INSTANCE, at, exit: EXIT });
    }
    state.set(player, VARBIT.SCARABS, 0);
    state.set(player, VARBIT.FLASHBACK, flashback ? 1 : 0);
    syncJarTable(player);
    const v = { scene, mummies: [], swarm: null, apparition: null, swapped: visit(player)?.swapped ?? null };
    visits.set(player, v);
    for (const [id, x, y] of MUMMIES) v.mummies.push(Scenes.actor(scene, id, [x, y, 0], null, { wanderRadius: 3 }));
    setup?.(scene, v);
    return scene;
  }

  function refuseInFlashback(player) {
    if (!inFlashback(player)) return null;
    player.sendMessage(TELEPORT_BLOCKED);
    return false;
  }

  /** The jar's spot on the table (varbits 404-407, 1 = gone), as each step leaves it. */
  function syncJarTable(player) {
    const stage = state.stage(player);
    const flashback = inFlashback(player);
    const own = state.jar(player);
    for (const jar of JARS) {
      if (!jar) continue;
      let gone = 0;
      if (jar === own) {
        if (!flashback && stage >= STAGE.IN_PYRAMID && stage <= STAGE.JAR_ROOM_OPEN) gone = 1;
        if (flashback && stage === STAGE.GUARDIAN_DEAD && visit(player)?.swapped?.pastJar) gone = 1;
      }
      state.set(player, jar.pot, gone);
    }
  }

  /** Back to the real map at the door (logout, death, the ladder), with the present's item back. */
  function sceneEnded(player, scene, logout) {
    if (scene?.name !== "klenter's pyramid") return;
    const v = visits.get(player);
    visits.delete(player);
    restorePresent(player, v);
    if (v?.apparition?.isRegistered?.()) api.removeNpc(v.apparition);
    if (v?.swarm?.isRegistered?.()) api.removeNpc(v.swarm);
    state.set(player, VARBIT.FLASHBACK, 0);
    // A fight left unfinished starts again with the jar (Wiki: re-entering puts the player back in the flashback).
    if (state.stage(player) === STAGE.GUARDIAN) state.setStage(player, STAGE.FLASHBACK_2);
    if ([STAGE.CEREMONY, STAGE.DEVOURER, STAGE.POSSESSED].includes(state.stage(player))) state.setStage(player, STAGE.WARN_CEREMONY);
    api.emitCustomEvent("icthlarins-little-helper:pyramid-left", { player, logout });
    common.flashbackOverlay(player, false);
    syncJarTable(player);
  }

  // ---------------------------------------------------------------------------
  // The present's item and the past's (t1042, t1074)
  // ---------------------------------------------------------------------------

  /** The item the past self carries instead (the unholy symbol), in the present one's slot. */
  function swapToPast(player, presentId) {
    const v = visit(player) ?? {};
    let slot = presentId ? common.slotOf(player, presentId) : -1;
    if (slot < 0) {
      slot = player.getInventory().getItems().findIndex((item) => !item || item.getId() === -1);
      presentId = null;
    }
    if (slot >= 0) {
      player.getInventory().set(slot, new api.core.Item(common.ITEM.UNHOLY_SYMBOL, 1));
      player.getInventory().refreshItems();
    }
    v.swapped = { slot, presentId, pastJar: false };
    visits.set(player, v);
  }

  function restorePresent(player, v = visit(player)) {
    const swapped = v?.swapped;
    if (!swapped) return;
    v.swapped = null;
    const inventory = player.getInventory();
    // The past's jar (taken in flashback 2) does not come back with the player (t2180: slot 21 cleared).
    if (swapped.pastJar) {
      const jar = state.jar(player);
      if (jar) {
        const items = inventory.getItems();
        for (let i = items.length - 1; i >= 0; i--) {
          if (i !== swapped.slot && items[i]?.getId() === jar.item) { inventory.set(i, new api.core.Item(-1, 0)); break; }
        }
      }
    }
    const symbolSlot = inventory.getItems()[swapped.slot]?.getId() === common.ITEM.UNHOLY_SYMBOL
      ? swapped.slot : common.slotOf(player, common.ITEM.UNHOLY_SYMBOL);
    if (symbolSlot >= 0) inventory.set(symbolSlot, new api.core.Item(swapped.presentId ?? -1, swapped.presentId ? 1 : 0));
    else if (swapped.presentId) inventory.adds(swapped.presentId, 1);
    inventory.refreshItems();
  }

  /** The quest item the present self holds as a flashback starts: the jar, or (flashback 3) the holy symbol. */
  function presentItem(player, stage) {
    if (stage >= STAGE.CEREMONY_BEGUN) return common.ITEM.HOLY_SYMBOL;
    return state.jar(player)?.item ?? null;
  }

  // ---------------------------------------------------------------------------
  // Fades (the hypnosis and the flashback's tint)
  // ---------------------------------------------------------------------------

  /** Into a flashback: hypnotise + black (t1033), the copy 2 ticks on, the sepia 2 ticks after (t1043). */
  function enterFlashback(player, stage, at, { line, setup } = {}) {
    common.lock(player, true);
    common.sfx(player, "hypnotise");
    common.fade(player, common.FADE.TO_BLACK);
    common.later(player, 1, () => common.minimap(player, true));
    common.later(player, 2, () => {
      if (stage !== null && state.stage(player) < stage) state.setStage(player, stage);
      swapToPast(player, presentItem(player, state.stage(player)));
      build(player, at, { flashback: true, setup });
      common.later(player, 2, () => {
        common.minimap(player, false);
        common.fade(player, common.FADE.TO_PAST);
        common.lock(player, false);
        common.later(player, 2, () => {
          if (line) line(player);
          common.flashbackOverlay(player, true);
        });
      });
    });
  }

  /** Out of a flashback: hypnotise + sepia to black (t1072), the copy (or the town) 2 ticks on. */
  function leaveFlashback(player, { stage = null, at = null, then, setup } = {}) {
    common.lock(player, true);
    common.flashbackOverlay(player, false);
    common.sfx(player, "hypnotise");
    common.fade(player, common.FADE.FROM_PAST);
    common.later(player, 1, () => common.minimap(player, true));
    common.later(player, 2, () => {
      if (stage !== null) state.setStage(player, stage);
      state.set(player, VARBIT.FLASHBACK, 0);
      restorePresent(player);
      if (at) build(player, at, { setup });
      else toTown(player);
      common.later(player, at ? 2 : 4, () => {
        common.minimap(player, false);
        common.lock(player, false);
        then?.(player);
        common.fade(player, common.FADE.FROM_BLACK, { close: 4 });
      });
    });
  }

  /** Out to the door, ending the copy (the ladder, a flashback's end in the town). */
  function toTown(player) {
    if (Scenes.get(player)?.name === "klenter's pyramid") Scenes.end(player, false);
    player.moveTo(new Location(...EXIT));
  }

  // ---------------------------------------------------------------------------
  // The pyramid door (outside)
  // ---------------------------------------------------------------------------

  function pyramidDoor(event) {
    const { player } = event;
    const stage = state.stage(player);
    if (stage < STAGE.IN_SOPHANEM) return false;
    if (state.isComplete?.(player) || stage >= STAGE.COMPLETE) {
      common.play(player, NpcIdentifiers.WANDERER_2, "finishing-up-trying-to-enter-the-pyramid-after-the-quest");
      return true;
    }
    if (stage <= STAGE.FLASHBACK_1) {
      touchDoor(player);
      return true;
    }
    if (stage < STAGE.RETURN_JAR) {
      common.play(player, NpcIdentifiers.WANDERER_2, "figuring-out-what-on-gielinor-is-going-on-trying-to-enter-the-pyramid-again");
      return true;
    }
    if (!common.hasCat(player)) {
      common.play(player, NpcIdentifiers.WANDERER_2, "putting-things-right-entering-klenter-s-pyramid");
      return true;
    }
    const variant = stage === STAGE.RETURN_JAR ? "putting-things-right-entering-klenter-s-pyramid"
      : stage >= STAGE.PREPARATIONS && stage <= STAGE.CEREMONY_BEGUN ? "reconsecrating-the-tomb-entering-klenter-s-pyramid-to-attend-the-ceremony"
        : "putting-things-right-entering-klenter-s-pyramid-entering-the-pyramid-again-after-leaving";
    common.dropCat(player);
    common.play(player, NpcIdentifiers.WANDERER_2, variant);
    return true;
  }

  /** "As you touch the pyramid door, a sense of deja-vu sweeps over you..." and flashback 1 (t1033-t1046). */
  function touchDoor(player) {
    common.pickUpCat(player);
    common.mesbox(player, "As you touch the pyramid door, a sense of deja-vu sweeps over you...");
    common.later(player, 3, () => {
      common.release(player);
      enterFlashback(player, STAGE.FLASHBACK_1, ENTRY, {
        line: (p) => common.play(p, NpcIdentifiers.WANDERER_2,
          "figuring-out-what-on-gielinor-is-going-on-flashback-1-touching-the-door-of-klenter-s-pyramid", onlyLines),
      });
    });
  }

  /** The cat opens the door (t1406-t1418): black, the copy, the music, back. */
  function catOpensDoor(player) {
    common.sfx(player, "happy_meeoow");
    common.lock(player, true);
    common.fade(player, common.FADE.TO_BLACK);
    common.later(player, 1, () => common.minimap(player, true));
    common.later(player, 2, () => {
      const stage = state.stage(player);
      if (stage === STAGE.RETURN_JAR) state.setStage(player, STAGE.IN_PYRAMID);
      const resume = resumeAt(player, state.stage(player));
      if (resume) {
        // Wiki: re-entering puts the player back in the flashback they left.
        swapToPast(player, presentItem(player, state.stage(player)));
        build(player, resume, { flashback: true });
      } else {
        build(player, ENTRY, { setup: ceremonySetup });
      }
      common.later(player, 2, () => {
        common.minimap(player, false);
        common.lock(player, false);
        common.fade(player, resume ? common.FADE.TO_PAST : common.FADE.FROM_BLACK, resume ? {} : { close: 2 });
        if (resume) common.later(player, 2, () => common.flashbackOverlay(player, true));
      });
    });
  }

  /** Where a flashback left mid-way picks up (none for the present). */
  function resumeAt(player, stage) {
    if (stage >= STAGE.FLASHBACK_2 && stage <= STAGE.GUARDIAN_DEAD) return FLASHBACK_2_START;
    if (stage === STAGE.FLASHBACK_3 || stage === STAGE.SYMBOL_HIDDEN) return FLASHBACK_3_START;
    return null;
  }

  /** The ceremony's NPCs stand in the eastern room once it has begun (t2515) and from stage 19 (t3076). */
  let ceremonySetup = null;
  function setCeremonySetup(fn) { ceremonySetup = fn; }

  // ---------------------------------------------------------------------------
  // Inside
  // ---------------------------------------------------------------------------

  /** The ladder: out at once in the present (t1421), "Do you want to leave?" in a flashback (t1063). */
  function ladder(event) {
    const { player } = event;
    if (!inPyramid(player)) return false;
    if (inFlashback(player)) {
      common.play(player, NpcIdentifiers.WANDERER_2,
        "figuring-out-what-on-gielinor-is-going-on-flashback-1-touching-the-door-of-klenter-s-pyramid-attempting-to-climb-up-the-ladder-during-the-flashback");
      return true;
    }
    common.animate(player, "reach_for_ladder");
    common.later(player, 1, () => toTown(player));
    return true;
  }

  /** "Yes." to "Do you want to leave?": the flashback ends early, the stage kept (t1072). */
  function leaveFlashbackEarly(player) {
    leaveFlashback(player, {});
  }

  /** Live's jump: the run-up, the leap, the landing (t1174-t1188), or the fall (t2189-t2203). */
  function pit(event) {
    const { player, objectId } = event;
    if (!inPyramid(player)) return false;
    const north = objectId === LOC.PIT_SOUTH;
    const stage = state.stage(player);
    const flashback = inFlashback(player);
    if (flashback) {
      if (north) return true;
      return jumpBackInFlashback(player, event);
    }
    if (north && stage === STAGE.IN_PYRAMID) return dejaVuAtPit(player, STAGE.FLASHBACK_2, FLASHBACK_2_START,
      "putting-things-right-flashback-2-jumping-over-the-pit");
    if (north && stage === STAGE.CEREMONY_BEGUN) return dejaVuAtPit(player, STAGE.FLASHBACK_3, FLASHBACK_3_START,
      "reconsecrating-the-tomb-flashback-3-jumping-over-the-pit-after-the-ceremony-has-begun");
    return jump(player, event, north);
  }

  function jumpBackInFlashback(player, event) {
    const stage = state.stage(player);
    if (stage === STAGE.FLASHBACK_3 || stage === STAGE.SYMBOL_HIDDEN) {
      common.play(player, NpcIdentifiers.WANDERER_2,
        "reconsecrating-the-tomb-flashback-3-jumping-over-the-pit-after-the-ceremony-has-begun-attempting-to-jump-over-the-pit");
      return true;
    }
    const jar = state.jar(player);
    if (stage !== STAGE.GUARDIAN_DEAD || !visit(player)?.swapped?.pastJar || !jar || !common.held(player, jar.item)) {
      common.play(player, NpcIdentifiers.WANDERER_2, "putting-things-right-flashback-2-jumping-over-the-pit", onlyLastLine);
      return true;
    }
    // The flashback ends with the stolen jar (t2178-t2186).
    leaveFlashback(player, {
      stage: STAGE.RETURNING_JAR, at: SOUTH_OF_PIT,
      then: (p) => common.play(p, NpcIdentifiers.WANDERER_2,
        "putting-things-right-flashback-2-jumping-over-the-pit-leaving-through-the-western-hallway", onlyLines),
    });
    return true;
  }

  /** "As you go to make the jump, another sense of deja-vu sweeps over you..." (t1965), then the flashback. */
  function dejaVuAtPit(player, stage, at, variant) {
    // Flashback 3 needs the unholy symbol, which takes the holy symbol's slot. Ours (not recorded): with neither
    // the holy symbol nor a free slot it waits, with the inventory's usual refusal.
    if (stage === STAGE.FLASHBACK_3 && !common.held(player, common.ITEM.HOLY_SYMBOL) && common.freeSlots(player) < 1) {
      player.sendMessage("You don't have enough inventory space to do that.");
      return true;
    }
    common.pickUpCat(player);
    common.mesbox(player, "As you go to make the jump, another sense of deja-vu sweeps over you...");
    common.later(player, 5, () => {
      common.release(player);
      enterFlashback(player, stage, at, {
        line: (p) => common.play(p, NpcIdentifiers.WANDERER_2, variant, onlyLines),
        setup: stage === STAGE.FLASHBACK_3 ? null : undefined,
      });
    });
    return true;
  }

  /**
   * Wiki (Pit (Klenter's Pyramid)): 20% run energy, drained; success 31% at 1 Agility to 90% at 99 (the
   * success chart's low 80, high 230). The capture's landing takes 15% (t1182: 8171 -> 6671).
   */
  const JUMP_ENERGY = 20;
  const JUMP_DRAIN = 15;
  function jumpChance(level) {
    return (Math.floor((80 * (99 - level)) / 98) + Math.floor((230 * (level - 1)) / 98) + 1) / 256;
  }

  function jump(player, event, north) {
    if (player.getRunEnergy?.() !== undefined && player.getRunEnergy() < JUMP_ENERGY) {
      // Transcript ("Trying to jump the gap without enough run energy").
      common.chain(player, [{ player: "I need to rest a little before I make the jump." }]);
      return true;
    }
    const x = event.object?.getLocation?.() ? Scenes.toSource(player, event.object.getLocation()).getX() : Scenes.toSource(player).getX();
    const from = north ? [x, 9191] : [x, 9199];
    const legs = north ? [[x, 9193], [x, 9196], [x, 9197]] : [[x, 9197], [x, 9194], [x, 9193]];
    const dir = north ? 0 : 2;
    const success = Math.random() < jumpChance(player.getSkillManager().getCurrentLevel(Skill.AGILITY));
    common.lock(player, true);
    Scenes.place(player, [...from, 0]);
    const camX = 3293;
    Scenes.camera(player, [camX, north ? 9186 : 9204, 475], [x, north ? 9197 : 9193, 300], { rate: 10, rate2: 10 });
    Scenes.camera(player, [x, north ? 9185 : 9205, 475], [x, north ? 9197 : 9193, 300], { rate: 20, rate2: 20 }, { rate: 10, rate2: 10 });
    const slide = (a, b, d1, d2, anim) => {
      const start = Scenes.tileFor(player, [a[0], a[1], 0]);
      Scenes.place(player, [b[0], b[1], 0]);
      player.setForceMovement(new ForceMovement(start, new Location(b[0] - a[0], b[1] - a[1]), d1, d2, dir, anim));
    };
    common.later(player, 3, () => {
      slide(from, legs[0], 30, 60, common.SEQ.ic_running);
      common.sfx(player, "pit_jump", 10);
    });
    common.later(player, 5, () => slide(legs[0], legs[1], 0, 30, common.SEQ.ic_pit_jump));
    common.later(player, 7, () => {
      player.setForceMovement?.(null);
      drainEnergy(player);
      if (success) {
        slide(legs[1], legs[2], 0, 30, common.SEQ.ic_up_ons);
        common.sfx(player, "pit_land");
        common.later(player, 6, () => { player.setForceMovement?.(null); player.getPacketSender().sendCameraReset(); common.lock(player, false); });
        return;
      }
      common.animate(player, "ic_pit_fall");
      common.sfx(player, "pit_fall", 10);
      common.later(player, 1, () => common.fade(player, common.FADE.TO_BLACK));
      common.later(player, 2, () => common.minimap(player, true));
      common.later(player, 4, () => { Scenes.place(player, PIT_FALL_LANDING); player.getPacketSender().sendCameraReset(); });
      common.later(player, 6, () => {
        Scenes.place(player, PIT_FALL_STEP);
        common.minimap(player, false);
        common.fade(player, common.FADE.FROM_BLACK, { close: 2 });
        common.sfx(player, "pit_shoot");
        common.lock(player, false);
      });
    });
    return true;
  }

  function drainEnergy(player) {
    if (typeof player.getRunEnergy !== "function" || typeof player.setRunEnergy !== "function") return;
    player.setRunEnergy(Math.max(0, player.getRunEnergy() - JUMP_DRAIN));
  }

  // ---------------------------------------------------------------------------
  // The western jar room and the eastern ceremonial room
  // ---------------------------------------------------------------------------

  /** A step through the door onto its tile, with live's opens/closes animations and scrape (t2022). */
  function stepThrough(player, object, [doorX, doorY]) {
    const here = Scenes.toSource(player);
    const inside = here.getY() <= doorY;
    const to = inside ? [doorX, doorY + 1, 0] : [doorX, doorY, 0];
    common.later(player, 1, () => {
      player.getPacketSender().sendObjectAnimation(object, { id: DOOR_OPENS });
      common.sfx(player, "scrape");
      player.setFlag?.("movement:ignore-clipping", true);
      const queue = player.getMovementQueue();
      queue.reset();
      queue.addSteps?.(Scenes.tileFor(player, to)) ?? Scenes.walk(player, to);
      common.later(player, 1, () => {
        player.getPacketSender().sendObjectAnimation(object, { id: DOOR_CLOSES });
        common.later(player, 1, () => player.removeFlag?.("movement:ignore-clipping"));
      });
    });
  }

  let puzzle = null;
  function setPuzzle(p) { puzzle = p; }

  function westDoor(event) {
    const { player, object } = event;
    if (!inPyramid(player)) return false;
    const stage = state.stage(player);
    const flashback = inFlashback(player);
    if (flashback && stage === STAGE.FLASHBACK_1) {
      common.later(player, 1, () => puzzle.start(player, firstPuzzleSolved));
      return true;
    }
    if (!flashback && stage === STAGE.RETURNING_JAR) {
      common.later(player, 1, () => puzzle.start(player, (p) => {
        state.setStage(p, STAGE.JAR_ROOM_OPEN);
        stepThrough(p, object, WEST_DOOR);
      }));
      return true;
    }
    stepThrough(player, object, WEST_DOOR);
    return true;
  }

  /** The first puzzle ends flashback 1 (t1229-t1247). */
  function firstPuzzleSolved(player) {
    state.setStage(player, STAGE.SEE_SPHINX);
    leaveFlashback(player, {
      then: (p) => common.play(p, NpcIdentifiers.WANDERER_2,
        "figuring-out-what-on-gielinor-is-going-on-flashback-1-touching-the-door-of-klenter-s-pyramid-solving-the-puzzle", onlyLines),
    });
  }

  function eastDoor(event) {
    const { player, object } = event;
    if (!inPyramid(player)) return false;
    const stage = state.stage(player);
    if (inFlashback(player) && stage === STAGE.SYMBOL_HIDDEN) {
      // Out of the eastern room: flashback 3 ends (t3071-t3078), the ceremony in its room.
      leaveFlashback(player, {
        stage: STAGE.WARN_CEREMONY, at: SOUTH_OF_PIT, setup: ceremonySetup,
        then: (p) => common.play(p, NpcIdentifiers.WANDERER_2,
          "reconsecrating-the-tomb-flashback-3-jumping-over-the-pit-after-the-ceremony-has-begun-hiding-the-symbol-in-a-sarcophagus",
          (steps) => steps.slice(steps.findIndex((s) => s.id === "TdWOLv") + 1)),
      });
      return true;
    }
    const request = { player, object, stage, handled: false };
    api.emitCustomEvent("icthlarins-little-helper:east-door", request);
    if (request.handled) return true;
    stepThrough(player, object, EAST_DOOR);
    return true;
  }

  function jarClicked(event) {
    const { player, objectId } = event;
    const jar = JAR_BY_LOC.get(objectId);
    if (!jar || !inPyramid(player)) return false;
    const stage = state.stage(player);
    const own = state.jar(player);
    const wrong = () => common.play(player, NpcIdentifiers.WANDERER_2, "putting-things-right-flashback-2-jumping-over-the-pit-attempting-to-take-the-wrong-jar");
    if (!inFlashback(player)) {
      common.play(player, NpcIdentifiers.WANDERER_2, "putting-things-right-attempting-to-take-a-jar-again");
      return true;
    }
    if (jar.item !== own?.item) return wrong() || true;
    if (stage === STAGE.FLASHBACK_2) {
      summonApparition(player, own);
      return true;
    }
    if (stage === STAGE.GUARDIAN) {
      // Ours: the guardian still stands; nothing else is recorded.
      if (!visit(player)?.apparition?.isRegistered?.()) summonApparition(player, own);
      return true;
    }
    if (stage === STAGE.GUARDIAN_DEAD) {
      if (visit(player)?.swapped?.pastJar) return wrong() || true;
      if (common.freeSlots(player) < 1) {
        player.sendMessage("You don't have enough inventory space."); // Ours: not recorded
        return true;
      }
      visit(player).swapped.pastJar = true;
      player.getInventory().adds(own.item, 1);
      syncJarTable(player);
      common.sfx(player, "pick2");
      common.itemBox(player, own.item, "You take the burial jar.");
      return true;
    }
    return wrong() || true;
  }

  /** The correct jar touched (t2048): stage 10, the apparition with its overhead line. */
  function summonApparition(player, jar) {
    const v = visit(player);
    state.setStage(player, STAGE.GUARDIAN);
    const npc = Scenes.actor(v.scene, jar.apparition, APPARITION_TILE, null);
    if (!npc) return;
    v.apparition = npc;
    npc.__icthlarinOwner = player;
    npc.forceChat?.("You will not defile this place!");
    npc.performGraphic?.(new api.core.Graphic(common.SPOTANIM.abyssal_demon_teleport));
    common.sfx(player, "quick_teleport");
    npc.getCombat?.().attack?.(player);
  }

  function apparitionDied(event) {
    const npc = event.npc;
    const player = npc?.__icthlarinOwner;
    if (!player || visit(player)?.apparition !== npc) return;
    visit(player).apparition = null;
    if (state.stage(player) === STAGE.GUARDIAN) state.setStage(player, STAGE.GUARDIAN_DEAD);
  }

  /** Searching a sarcophagus in a flashback (t2152): nothing interesting (Wiki loot: not modelled). */
  function sarcophagus(event) {
    const { player } = event;
    if (!inPyramid(player)) return false;
    player.sendMessage("You search the sarcophagus, but you don't find anything interesting.");
    return true;
  }

  /** The unholy symbol into a sarcophagus of the eastern room (t3055): stage 18. */
  function symbolOnSarcophagus(event) {
    const { player, itemId } = event;
    if (itemId !== common.ITEM.UNHOLY_SYMBOL || !inPyramid(player)) return false;
    if (!inFlashback(player) || state.stage(player) !== STAGE.FLASHBACK_3) return false;
    const here = Scenes.toSource(player);
    if (!inBox(here, EAST_ROOM)) return false;
    const v = visit(player);
    const slot = common.slotOf(player, common.ITEM.UNHOLY_SYMBOL);
    if (slot < 0) return true;
    player.getInventory().set(slot, new api.core.Item(-1, 0));
    player.getInventory().refreshItems();
    // The present's holy symbol comes back into this slot when the flashback ends.
    if (v?.swapped) v.swapped.slot = slot;
    state.setStage(player, STAGE.SYMBOL_HIDDEN);
    common.sfx(player, "put_down");
    common.chain(player, [{ item: common.ITEM.UNHOLY_SYMBOL, text: "You hide the unholy symbol in the sarcophagus." }], (p) => {
      common.play(p, NpcIdentifiers.WANDERER_2,
        "reconsecrating-the-tomb-flashback-3-jumping-over-the-pit-after-the-ceremony-has-begun-hiding-the-symbol-in-a-sarcophagus",
        (steps) => steps.slice(1, steps.findIndex((s) => s.id === "TdWOLv")));
    });
    return true;
  }

  function symbolOnTable(event) {
    const { player, itemId } = event;
    if (itemId !== common.ITEM.UNHOLY_SYMBOL || !inPyramid(player) || state.stage(player) !== STAGE.FLASHBACK_3) return false;
    common.play(player, NpcIdentifiers.WANDERER_2,
      "reconsecrating-the-tomb-flashback-3-jumping-over-the-pit-after-the-ceremony-has-begun-attempting-to-hide-the-symbol-under-the-table");
    return true;
  }

  /**
   * Dropping the jar (canopic jar's Drop): in the jar room with the room open it goes back (t2300: "You return
   * the burial jar.", stage 14); anywhere else it turns to dust (Wiki, Canopic jar).
   */
  function dropJar(event) {
    const { player, itemId } = event;
    const own = state.jar(player);
    if (!JARS.some((jar) => jar?.item === itemId)) return;
    event.handled = true;
    event.dropToGround = false;
    const here = inPyramid(player) ? Scenes.toSource(player) : null;
    if (itemId === own?.item && !inFlashback(player) && state.stage(player) === STAGE.JAR_ROOM_OPEN && here && inBox(here, JAR_ROOM)) {
      common.take(player, itemId);
      state.setStage(player, STAGE.JAR_RETURNED);
      syncJarTable(player);
      common.sfx(player, "put_down");
      common.itemBox(player, itemId, "You return the burial jar.");
      return;
    }
    common.take(player, itemId);
    player.sendMessage("The burial jar magically turns to dust as you drop it.");
  }

  // ---------------------------------------------------------------------------
  // Scarabs and the cat
  // ---------------------------------------------------------------------------

  /** Past the first mummies the swarm comes up once a visit (t1139: varbit 410, the message, the spiral). */
  function scarabWatch(mobile) {
    if (!mobile?.isPlayer?.()) return;
    const player = mobile;
    if (!inPyramid(player) || state.get(player, VARBIT.SCARABS) === 1) return;
    const here = Scenes.toSource(player);
    if (!inBox(here, SCARAB_ZONE)) return;
    state.set(player, VARBIT.SCARABS, 1);
    player.sendMessage("You've disturbed a swarm of scarabs!");
    const v = visit(player);
    const swarm = Scenes.actor(v.scene, SCARAB_SWARM, [here.getX(), here.getY(), 0], null);
    if (swarm) {
      v.swarm = swarm;
      common.animate(swarm, "scarab_spiral");
    }
    common.sfx(player, "scarabs_appear", 10);
  }

  function inBox(location, box) {
    return location.getX() >= box.minX && location.getX() <= box.maxX && location.getY() >= box.minY && location.getY() <= box.maxY;
  }

  /** A logout inside the copy: out at the door with the present's item back (Wiki, Flashback Mechanics). */
  function logout({ player }) {
    if (inPyramid(player)) Scenes.end(player, true);
  }

  /** Wiki (Flashback Mechanics): dying in a flashback costs the cat. */
  function died({ player }) {
    if (!player || !inPyramid(player) || !inFlashback(player)) return;
    common.loseCat(player);
  }

  /** Steps the transcript runner should only play as words (its world actions are this unit's). */
  function onlyLines(steps) {
    return steps.filter((step) => step.type !== "action" && step.type !== "message");
  }
  function onlyLastLine(steps) {
    const lines = onlyLines(steps);
    return lines.slice(-1);
  }

  return {
    LOC, Scenes, build, inPyramid, inFlashback, visit, syncJarTable, enterFlashback, leaveFlashback, toTown,
    pyramidDoor, catOpensDoor, ladder, leaveFlashbackEarly, pit, westDoor, eastDoor, jarClicked, apparitionDied,
    sarcophagus, symbolOnSarcophagus, symbolOnTable, dropJar, died, logout, setPuzzle, setCeremonySetup, onlyLines,
    restorePresent, EXIT, ENTRY, SOUTH_OF_PIT, EAST_ROOM,
    _test: { jumpChance, resumeAt, TELEPORT_BLOCKED, MUMMIES, SCARAB_ZONE, RECOVERY_ATTRIBUTE },
  };
}

module.exports = { createPyramid };
