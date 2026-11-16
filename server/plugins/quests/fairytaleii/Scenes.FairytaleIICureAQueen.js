/**
 * Fairytale II's scenes, timed as live plays them (rsprox capture FairyTale2, rev 242.1; ticks are
 * that recording's). Each runs on its own timer keyed to a per-player state object, so a click
 * meanwhile cannot leave it half done, and logout/death end it cleanly.
 *
 * - Fairy Nuff's ransacked grotto: the camera sweep on first entry (283-306).
 * - The Fairy Godfather's pickpocket: the success box and jingle (1603), and the failure, where Fat
 *   Rocco knocks the player out and they wake somewhere outside Zanaris (1216-1234, 1363-1384,
 *   1486-1504).
 * - Fairy Nuff's spell of awakening with the secateurs (1882).
 * - The magic essence poured on the sleeping Queen, who wakes four ticks later (2415-2419).
 * - The star flowers of the cosmic entity's plane, which sprout, bloom and wither (1966-2098).
 */
module.exports = function createFairytaleIIScenes(api) {
  const {
    Animation, CacheDefinitions, Graphic, Location, PlayerDialogue, DialogueChainBuilder, Sound, Sounds,
    StatementDialogue, Task, TaskManager,
  } = api.core;

  const seq = (name, fallback) => CacheDefinitions.getSeqId?.(name) ?? fallback;
  const spot = (name, fallback) => CacheDefinitions.getSpotanimId?.(name) ?? fallback;
  const synth = (player, id) => Sounds.sendSound(player, new Sound(id, 1, 0, 1));
  const area = (player, id, tile, delay = 0, radius = 10) =>
    player.getPacketSender().sendAreaSound(id, tile.x, tile.y, tile.z ?? 0, 1, delay, radius);

  /** Runs `steps` ([tick, fn] after the start) on one task keyed to `state`. */
  function timeline(state, steps, onDone) {
    let tick = 0;
    const last = Math.max(...steps.map(([at]) => at));
    const task = new (class extends Task {
      execute() {
        tick++;
        for (const [at, fn] of steps) if (at === tick) fn();
        if (tick >= last) {
          this.stop();
          onDone?.();
        }
      }
    })(1, state);
    TaskManager.submit(task);
    return task;
  }

  // ==========================================================================
  // Fairy Nuff's grotto
  // ==========================================================================

  const PAN_HEIGHT = 300;
  const PAN_RATES = { rate: 4, rate2: 10 };
  /** The camera's spot (287) and where it looks, every two ticks from 289 to 303. */
  const PAN_CAMERA = [2386, 4471];
  const PAN_LOOKS = [
    [2387, 4474, 25], [2384, 4474, 75], [2384, 4472, 150], [2384, 4471, 200],
    [2384, 4470, 200], [2385, 4470, 200], [2388, 4470, 200], [2389, 4471, 75],
  ];
  /** The camera moves four ticks after the step in (283 -> 287), and resets at 306. */
  const PAN_START = 4;
  const PAN_END = 23;
  const SCARED = 597; // chatscared2, the player's line at 306
  const pans = new Map();

  /** Locks the player on their step into the grotto and sweeps the camera round the wreckage. */
  function startRoomPan(player, onDone) {
    if (pans.has(player)) return;
    const queue = player.getMovementQueue();
    const state = { wasBlocked: queue.isMovementBlocked() };
    pans.set(player, state);
    // Clicks during the sweep do not move the player (288).
    queue.reset().setBlockMovement(true);
    const sender = player.getPacketSender();
    const steps = [[PAN_START, () => sender.sendCameraMoveTo(...PAN_CAMERA, PAN_HEIGHT, PAN_RATES)]];
    PAN_LOOKS.forEach(([x, y, height], index) =>
      steps.push([PAN_START + 2 * (index + 1), () => sender.sendCameraLookAt(x, y, height, PAN_RATES)]));
    steps.push([PAN_END, () => {
      endRoomPan(player);
      onDone(player);
      player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new PlayerDialogue(0,
        "Wow! Somebody has trashed this cave! And what's happened to Fairy Nuff and the Fairy Queen?", SCARED)));
    }]);
    timeline(state, steps);
  }

  function endRoomPan(player, logout = false) {
    const state = pans.get(player);
    if (!state) return false;
    pans.delete(player);
    TaskManager.cancelTasks(state);
    player.getMovementQueue().setBlockMovement(state.wasBlocked);
    if (!logout) player.getPacketSender().sendCameraReset();
    return true;
  }

  // ==========================================================================
  // The Godfather's pocket
  // ==========================================================================

  const PICKPOCKET_SEQ = () => seq("human_pickpocket", 881);
  const BEATEN_SEQ = () => seq("human_staff_block", 415);
  const SYNTH_PICK = 2581;
  const SYNTH_CUDGEL = 1842;
  const STEALING_JINGLE = 204; // "pickpocket fairy godfather" (1603)
  const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
  const FADE_OVERLAY = 174;
  const FADE_SCRIPT = 948;
  /** Where each recorded failure woke the player (1227, 1379, 1499); the Wiki only says outside Zanaris. */
  const WAKE_TILES = [[3186, 3211, 0], [3139, 3260, 0], [3139, 3228, 0]];
  const ROCCO_NPC_IDS = new Set([5839, 5852]); // fairy_henchman2 and its multinpc
  const knockouts = new Map();

  function fade(player, out) {
    player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, {
      postScripts: [{ scriptId: FADE_SCRIPT, args: out ? [0, 255, 0, 0, 50] : [0, 0, 0, 255, 50] }],
    });
  }

  /** The reach: the attempt line, the pickpocket animation and sound (1216, 1603). */
  function reach(player, godfather) {
    player.sendMessage("You attempt to pickpocket the Fairy Godfather.");
    player.performAnimation(new Animation(PICKPOCKET_SEQ()));
    if (godfather) player.setPositionToFace(godfather.getLocation());
    synth(player, SYNTH_PICK);
  }

  /** Success: the secateurs box and the "Stealing from the Godfather" jingle on the same tick (1603). */
  function stealJingle(player) {
    player.getPacketSender().sendJingle(STEALING_JINGLE);
  }

  function nearbyRocco(godfather) {
    const at = godfather?.getLocation?.();
    if (!at) return null;
    for (const npc of api.core.World.getNpcs()) {
      if (!npc || !ROCCO_NPC_IDS.has(npc.getId())) continue;
      if (npc.getLocation().getDistance?.(at) <= 6) return npc;
    }
    return null;
  }

  /**
   * Failure, after the reach (1216): "Rocco, teach-a thees thief a lesson!" over the Godfather (+3),
   * Rocco comes over (+4), the player is beaten unconscious as the screen fades (+5), moved outside
   * Zanaris (+11) and wakes as it fades back (+16). The second recorded failure also says "You fail
   * to pick the Fairy Godfather's pocket." with the reach (1364); the others do not (see the docs).
   */
  function knockOut(player, godfather) {
    if (knockouts.has(player)) return;
    const state = {};
    knockouts.set(player, state);
    player.getMovementQueue().reset().setBlockMovement(true);
    player.sendMessage("You fail to pick the Fairy Godfather's pocket.");
    const rocco = nearbyRocco(godfather);
    const [x, y, z] = WAKE_TILES[Math.floor(Math.random() * WAKE_TILES.length)];
    timeline(state, [
      [3, () => godfather?.forceChat?.("Rocco, teach-a thees thief a lesson!")],
      [4, () => rocco?.setPositionToFace?.(player.getLocation())],
      [5, () => {
        player.sendMessage("You're beaten unconscious.");
        player.performAnimation(new Animation(BEATEN_SEQ()));
        synth(player, SYNTH_CUDGEL);
        fade(player, true);
      }],
      [11, () => player.moveTo(new Location(x, y, z))],
      [16, () => {
        fade(player, false);
        player.getMovementQueue().setBlockMovement(false);
        player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, "You slowly wake up in an unknown place.")));
      }],
      [18, () => player.getPacketSender().closeSubInterface?.(OVERLAY_ATMOSPHERE_UID)],
    ], () => knockouts.delete(player));
  }

  function endKnockOut(player) {
    const state = knockouts.get(player);
    if (!state) return;
    knockouts.delete(player);
    TaskManager.cancelTasks(state);
    player.getMovementQueue().setBlockMovement(false);
  }

  // ==========================================================================
  // Fairy Nuff's spell and the Queen's awakening
  // ==========================================================================

  /** Nuff casts with the secateurs as their box closes (1882): spotanim 568 at height 40, seq 4328, synth 1097. */
  function nuffEnchant(player, nuff) {
    nuff?.performAnimation?.(new Animation(seq("fairy2_secateur_enchant", 4328)));
    nuff?.performGraphic?.(new Graphic(spot("fairy_flower_enchant", 568), 40));
    synth(player, 1097);
  }

  const POUR_SEQ = () => seq("human_fairy2_kneel_and_pour", 4316);
  const QUEEN_WAKE_SEQ = () => seq("fairy2_queenwake", 4317);
  const AWAKENS_JINGLE = 205; // "fairyqueen awakens" (2415)
  /** The Queen stands up four ticks after the potion (2415 -> 2419). */
  const WAKE_TICKS = 4;
  const pours = new Map();

  /** The player kneels and pours; the sleeping Queen's loc plays her waking (2415), then `onAwake`. */
  function pourPotion(player, bed, onAwake) {
    if (pours.has(player)) return;
    const state = { onAwake };
    pours.set(player, state);
    player.performAnimation(new Animation(POUR_SEQ()));
    if (bed) {
      player.setPositionToFace(bed.getLocation());
      player.getPacketSender().sendObjectAnimation(bed, new Animation(QUEEN_WAKE_SEQ()));
    }
    player.getPacketSender().sendJingle(AWAKENS_JINGLE);
    timeline(state, [[WAKE_TICKS, () => {
      pours.delete(player);
      onAwake(player);
    }]]);
  }

  /** A pour cut short (logout, death) still wakes the Queen: the dose is already spent. */
  function endPour(player) {
    const state = pours.get(player);
    if (!state) return;
    pours.delete(player);
    TaskManager.cancelTasks(state);
    state.onAwake(player);
  }

  // ==========================================================================
  // Star flowers
  // ==========================================================================

  const SEED_NPC = () => CacheDefinitions.getNpcId?.("fairy2_starflower_seed") ?? 1856;
  const BLOOM_NPC = () => CacheDefinitions.getNpcId?.("fairy2_starflower_fullgrown") ?? 1857;
  const GROW_SEQ = () => seq("fairy2_starflower_grow", 4312);
  const DIE_SEQ = () => seq("fairy2_starflower_die", 4313);
  const PICK_SEQ = () => seq("human_pickuptable", 832);
  const SYNTH_GROW = 2874; // area, delay 255, range 10
  const SYNTH_DIE = 2873; // area, range 10
  /** A shoot blooms 58 ticks after it sprouts (2012 -> 2070, 2020 -> 2078, 2038 -> 2096). */
  const GROW_TICKS = 58;
  /**
   * The first shoot sprouts this long after arriving. The capture's sprouted 46 ticks in (1966 ->
   * 2012) and bloomed at 104 (62 s); the Wiki says they "start to bloom within a minute of arriving",
   * so the first bloom is at 100 ticks (42 + 58).
   */
  const FIRST_SPROUT_TICKS = 42;
  /** Ours: a new shoot every four ticks (the capture's average: 18 in view over 77 ticks), at most eight. */
  const SPROUT_EVERY = 4;
  const MAX_FLOWERS = 8;
  /** Ours: a bloom nobody picks withers this long after blooming (the capture's lasted 20+ ticks unpicked). */
  const BLOOM_TICKS = 100;
  /** A withering or picked bloom leaves six ticks later (2076 -> 2082). */
  const WITHER_TICKS = 6;
  /** Ours: shoots sprout on a free tile within this many tiles of the player. */
  const SPROUT_RADIUS = 6;
  const fields = new Map();

  /** Starts (or keeps) the player's field; `inField(tile)` bounds where shoots may sprout. */
  function enterField(player, inField) {
    if (fields.has(player)) return;
    const state = { flowers: new Set(), inField, tick: 0 };
    fields.set(player, state);
    // The arrival tick counts as the first (1966 -> 2012 is 46 ticks to the shoot).
    const task = new (class extends Task {
      execute() { growField(player, state); }
    })(1, state, true);
    TaskManager.submit(task);
  }

  function growField(player, state) {
    if (!player.isRegistered?.() || !state.inField(player.getLocation())) {
      leaveField(player);
      return;
    }
    state.tick++;
    for (const flower of [...state.flowers]) ageFlower(player, state, flower);
    if (state.tick < FIRST_SPROUT_TICKS || (state.tick - FIRST_SPROUT_TICKS) % SPROUT_EVERY !== 0) return;
    if (state.flowers.size >= MAX_FLOWERS) return;
    const tile = freeTile(player, state);
    if (tile) sprout(player, state, tile);
  }

  function freeTile(player, state) {
    const at = player.getLocation();
    const taken = new Set([...state.flowers].map((flower) => `${flower.tile.x},${flower.tile.y}`));
    for (let tries = 0; tries < 12; tries++) {
      const x = at.getX() + Math.floor(Math.random() * (2 * SPROUT_RADIUS + 1)) - SPROUT_RADIUS;
      const y = at.getY() + Math.floor(Math.random() * (2 * SPROUT_RADIUS + 1)) - SPROUT_RADIUS;
      const tile = new Location(x, y, at.getZ());
      if (taken.has(`${x},${y}`) || (x === at.getX() && y === at.getY()) || !state.inField(tile)) continue;
      if (api.core.RegionManager?.blocked?.(tile, player.getPrivateArea?.() ?? null)) continue;
      return { x, y, z: at.getZ() };
    }
    return null;
  }

  /** A shoot: the grow animation and its area sound (2012). */
  function sprout(player, state, tile) {
    const npc = api.spawnNpc({ id: SEED_NPC(), x: tile.x, y: tile.y, z: tile.z, wanderRadius: 0, owner: player, ownerOnly: true });
    if (!npc) return;
    npc.getMovementQueue?.()?.setBlockMovement?.(true);
    npc.performAnimation(new Animation(GROW_SEQ()));
    area(player, SYNTH_GROW, tile, 255);
    state.flowers.add({ npc, tile, age: 0, bloomed: false, withering: -1 });
  }

  function ageFlower(player, state, flower) {
    flower.age++;
    if (flower.withering >= 0) {
      if (++flower.withering >= WITHER_TICKS) removeFlower(state, flower);
      return;
    }
    if (!flower.bloomed && flower.age >= GROW_TICKS) {
      // The shoot turns into the bloom in place (2070), now with its Pick option.
      flower.bloomed = true;
      flower.npc.setNpcTransformationId(BLOOM_NPC());
    } else if (flower.bloomed && flower.age >= GROW_TICKS + BLOOM_TICKS) {
      wither(player, flower);
    }
  }

  function wither(player, flower) {
    flower.withering = 0;
    flower.npc.performAnimation(new Animation(DIE_SEQ()));
    area(player, SYNTH_DIE, flower.tile);
  }

  function removeFlower(state, flower) {
    state.flowers.delete(flower);
    api.removeNpc(flower.npc);
  }

  /** The bloom behind `npc`, if it is one of the player's and still pickable. */
  function bloomOf(player, npc) {
    const state = fields.get(player);
    if (!state) return null;
    for (const flower of state.flowers) {
      if (flower.npc === npc) return flower.bloomed && flower.withering < 0 ? flower : null;
    }
    return null;
  }

  /** Picking (2076): the player's pick-up animation and sound, and the bloom withers and goes. */
  function pickFlower(player, npc) {
    const flower = bloomOf(player, npc);
    if (!flower) return false;
    player.performAnimation(new Animation(PICK_SEQ()));
    synth(player, SYNTH_PICK);
    wither(player, flower);
    return true;
  }

  function leaveField(player) {
    const state = fields.get(player);
    if (!state) return;
    fields.delete(player);
    TaskManager.cancelTasks(state);
    for (const flower of state.flowers) api.removeNpc(flower.npc);
    state.flowers.clear();
  }

  /** Logout or death: every scene ends and the player's flowers go. */
  function endAll(player, logout = false) {
    endRoomPan(player, logout);
    endKnockOut(player);
    endPour(player);
    leaveField(player);
  }

  return {
    startRoomPan, endRoomPan, isPanning: (player) => pans.has(player),
    reach, stealJingle, knockOut, isKnockedOut: (player) => knockouts.has(player),
    nuffEnchant, pourPotion, isPouring: (player) => pours.has(player),
    enterField, leaveField, pickFlower, bloomOf, hasField: (player) => fields.has(player),
    endAll,
    constants: { GROW_TICKS, FIRST_SPROUT_TICKS, WITHER_TICKS, WAKE_TICKS, PAN_END, WAKE_TILES },
  };
};
