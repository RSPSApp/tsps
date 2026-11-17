/**
 * The Fremennik Trials: Hunter unit. Sigli the Huntsman's trial: the hunter's talisman, tracking
 * the invisible Draugen and fighting it (see State.FremennikTrials.js for the shared context).
 *
 * Live (rsprox 1002236, 1002250, 1002249 rev 242; 1001646 rev 241):
 *
 * - Sigli hands over the uncharged talisman (viking_draugen_talisman_uncharged) with the line
 *   "We do this with a special talisman..." (1002236 t3448). No varp, no message.
 * - The Draugen's position is a real NPC, viking_draugen_safe (a "Butterfly", no ops, seen by
 *   everyone). The first Locate of a hunt spawns one 35-80 tiles away inside x 2605-2743,
 *   y 3496-3733 (every one of 547 sightings in 8 recordings), with no message (1002236 t4833).
 * - Each Locate: within 3 tiles (Chebyshev) of it, "The Draugen is here! Beware!" and the
 *   Draugen (viking_draugen) appears on a tile orthogonally next to the player, facing them
 *   (1002236 t5535, 1002250 t545, 1001646 t315), and attacks 2 ticks later (t5537, t317).
 *   Otherwise, about 1 Locate in 9, "The Draugen has moved elsewhere..." and a new butterfly
 *   (the old one keeps wandering: 1002236 t4921/t4997/t5043/t5082/t5197), then always
 *   "The talisman guides you <dir>." from sign(dx), sign(dy) toward the butterfly's live tile.
 * - The Draugen dies with no death animation: the tick after the killing hit it is gone, with a
 *   smokepuff map_anim on its tile, the ghost_death synth, "You absorb the Draugen's essence into
 *   your talisman." and the talisman charged (1002236 t5572-5573, 1001646 t356-357).
 * - Locate on the charged talisman: "You have already captured the Draugen." (1001646 t363).
 * - Sigli: "I saw the entire hunt..." / "Thanks!"; on the continue of "Thanks!" the trial passes
 *   (viking +1) and the charged talisman goes, with no game message (1002236 t5674).
 *
 * Ours: no capture shows whether other players can attack someone's Draugen; it is owner-only
 * (visible to all, attackable by the hunter). Ours: at most MAX_BUTTERFLIES per player, oldest
 * decoy removed first; the Draugen leaves after DRAUGEN_LIFETIME if not killed. Wiki: a butterfly
 * despawns after ten minutes.
 */
module.exports = function attachFremennikTrialsHunter(api, ctx) {
  const { Location, Graphic, CountdownTask, TaskManager, RegionManager, NpcIdentifiers } = api.core;
  const { T, FLAG, NPC, I } = ctx;

  const SIGLI = NPC.SIGLI;
  /** viking_draugen 3922: the attackable Draugen. */
  const DRAUGEN = NpcIdentifiers.THE_DRAUGEN;
  /** viking_draugen_safe 3923: the roaming "Butterfly" that marks where the Draugen is. */
  const DRAUGEN_BUTTERFLY = NpcIdentifiers.BUTTERFLY_8;
  /** viking_draugen_talisman_uncharged 3697. */
  const TALISMAN = I.HUNTERS_TALISMAN_2;
  /** viking_draugen_talisman 3696. */
  const CHARGED_TALISMAN = I.HUNTERS_TALISMAN;

  const V_OFFER = "the-council-members-sigli-the-huntsman";
  const V_AGAIN = "the-council-members-sigli-the-huntsman-talking-to-sigli-again";
  const V_HUNT_DONE = "the-council-members-sigli-the-huntsman-talking-to-sigli-after-defeating-the-draugen";
  const V_DONE = `${V_HUNT_DONE}-subsequent-dialogue-with-sigli`;
  /** Transcript steps: inventory-space branches, the hand-out, the lost-talisman replacement. */
  const STEP_HAS_SPACE = "LZ_wQa";
  const STEP_NO_SPACE = "D4d-wQ";
  const STEP_RECEIVE = "-lHzb5";
  const STEP_REPLACE = "gKEm-3";
  /** The player's last line of the return; its continue passes the trial (1002236 t5674). */
  const THANKS = "Thanks!";

  const MSG_HERE = "The Draugen is here! Beware!";
  const MSG_MOVED = "The Draugen has moved elsewhere...";
  const MSG_CAPTURED = "You have already captured the Draugen.";
  const MSG_ABSORB = "You absorb the Draugen's essence into your talisman.";

  /** smokepuff map_anim on the Draugen's tile as it goes (1002236 t5573). */
  const GFX_SMOKEPUFF = 86;
  /** ghost_death synth (1002236 t5573). */
  const SOUND_GHOST_DEATH = 438;

  /** Every butterfly sighting falls in this box (8 recordings, 547 sightings). */
  const HUNT_AREA = { minX: 2605, maxX: 2743, minY: 3496, maxY: 3733 };
  /** New butterflies spawn this far (Chebyshev) from the player: about 36-81 seen. */
  const SPAWN_MIN = 35;
  const SPAWN_MAX = 80;
  const SPAWN_TRIES = 200;
  /** "here" within this many tiles (Chebyshev): deltas (-2,0), (+1,-2), (-1,+3); misses (5,-3), (2,-4). */
  const HERE_RANGE = 3;
  /** About 1 Locate in 9 moves the Draugen (5/42, 4/25, 0/7, 0/11 non-first clicks). */
  const MOVE_CHANCE = 1 / 9;
  /** The Draugen's first attack comes 2 ticks after it appears (1002236 t5535 -> t5537). */
  const ATTACK_DELAY = 2;
  /** Wiki: a butterfly despawns if the Draugen is not killed within ten minutes. */
  const BUTTERFLY_LIFETIME = 1000;
  /** Ours: live's wander covers about 20-30 tiles over a few minutes. */
  const BUTTERFLY_WANDER = 12;
  /** Ours: butterflies one player can have in the world at once (target included). */
  const MAX_BUTTERFLIES = 4;
  /** Ours: an unkilled Draugen leaves after this long, so a fled hunt can find it again. */
  const DRAUGEN_LIFETIME = 500;
  /** Ours: a Draugen this far from its hunter at a Locate is left behind and removed. */
  const DRAUGEN_LEASH = 16;

  /** player -> { butterflies: NPC[], target: NPC | null, draugen: NPC | null, started: boolean } */
  const hunts = new WeakMap();
  /** Draugen NPC -> its hunter. */
  const draugenOwners = new WeakMap();

  const alive = (npc) => !!npc && npc.isRegistered?.() !== false && !npc.__draugenGone;
  const huntActive = (player) => ctx.trialState(player, T.HUNTER) === 1;

  function hunt(player) {
    let state = hunts.get(player);
    if (!state) {
      state = { butterflies: [], target: null, draugen: null, started: false };
      hunts.set(player, state);
    }
    return state;
  }

  function despawn(npc) {
    if (!npc || npc.__draugenGone) return;
    npc.__draugenGone = true;
    api.removeNpc(npc);
  }

  // --- Sigli's dialogue -----------------------------------------------------------------------

  function sigliVariant(player, stage) {
    const state = ctx.trialState(player, T.HUNTER);
    if (state === 2) return V_DONE;
    if (state === 1) return ctx.flag(player, FLAG.DRAUGEN) && ctx.held(player, CHARGED_TALISMAN) ? V_HUNT_DONE : V_AGAIN;
    if (stage >= ctx.STAGE_STARTED) return V_OFFER;
    return null;
  }

  function sigliOffer(player) {
    return sigliVariant(player, ctx.quest.getStage(player)) ?? V_OFFER;
  }

  const hasTalisman = (player) => ctx.held(player, TALISMAN) || ctx.held(player, CHARGED_TALISMAN);

  function answerCondition({ player, npcId, value }) {
    if (!SIGLI.has(npcId)) return null;
    if (value.includes("does not have inventory space")) return ctx.freeSlots(player) <= 0;
    if (value.includes("has inventory space")) return ctx.freeSlots(player) > 0;
    if (value.includes("does not have a talisman")) return !hasTalisman(player);
    if (value.includes("has the talisman")) return hasTalisman(player);
    if (value.includes("draugen is defeated")) return ctx.flag(player, FLAG.DRAUGEN);
    // The "Using the hunter's talisman" variant's messages are sent by Locate below.
    if (value.includes("locate feature") || value.includes("draugen moves") ||
      value.includes("3 tiles near the draugen") || value.includes("of the draugen")) return false;
    return null;
  }

  /** Live gives the talisman in the tick its line shows (1002236 t3448). */
  function giveTalisman({ player }) {
    if (ctx.trialState(player, T.HUNTER) === 0) ctx.setTrialState(player, T.HUNTER, 1);
    if (!hasTalisman(player)) ctx.give(player, TALISMAN, 1);
  }

  /** A full inventory still starts the trial; Sigli's "lost it" branch hands one over later. */
  function startWithoutTalisman({ player }) {
    if (ctx.trialState(player, T.HUNTER) === 0) ctx.setTrialState(player, T.HUNTER, 1);
  }

  /** Wiki: a talisman lost after the kill restarts the hunt. */
  function replaceTalisman({ player }) {
    if (hasTalisman(player)) return;
    ctx.setFlag(player, FLAG.DRAUGEN, false);
    ctx.give(player, TALISMAN, 1);
  }

  /** On the continue of "Thanks!": the talisman goes and the vote counts, no message. */
  function thanksLine(event) {
    const { player, npcId, step } = event;
    if (!player || !SIGLI.has(npcId) || step?.player !== THANKS) return;
    if (!huntActive(player) || !ctx.flag(player, FLAG.DRAUGEN) || !ctx.held(player, CHARGED_TALISMAN)) return;
    event.after = () => completeHunt(player);
  }

  function completeHunt(player) {
    if (!huntActive(player) || !ctx.held(player, CHARGED_TALISMAN)) return;
    ctx.take(player, CHARGED_TALISMAN, 1);
    ctx.completeTrial(player, T.HUNTER);
    clearHunt(player);
  }

  // --- Tracking -------------------------------------------------------------------------------

  const chebyshev = (a, b) => Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));

  function walkable(x, y, z) {
    const tile = new Location(x, y, z);
    if (RegionManager.blocked(tile, null) || RegionManager.isWater(tile)) return false;
    // A tile walled in on every side is no place to wander from.
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !RegionManager.blocked(new Location(x + dx, y + dy, z), null));
  }

  /** A random walkable tile in the hunt area, SPAWN_MIN-SPAWN_MAX tiles from the player. */
  function butterflyTile(player) {
    const at = player.getLocation();
    const z = 0;
    for (let i = 0; i < SPAWN_TRIES; i++) {
      const distance = SPAWN_MIN + Math.floor(Math.random() * (SPAWN_MAX - SPAWN_MIN + 1));
      const along = Math.floor(Math.random() * (2 * distance + 1)) - distance;
      const side = Math.floor(Math.random() * 4);
      const dx = side === 0 ? distance : side === 1 ? -distance : along;
      const dy = side === 2 ? distance : side === 3 ? -distance : along;
      const x = at.getX() + dx;
      const y = at.getY() + dy;
      if (x < HUNT_AREA.minX || x > HUNT_AREA.maxX || y < HUNT_AREA.minY || y > HUNT_AREA.maxY) continue;
      if (walkable(x, y, z)) return new Location(x, y, z);
    }
    // Ours: a player at the area's edge where no ring tile fits: any walkable tile in the area.
    for (let i = 0; i < SPAWN_TRIES; i++) {
      const x = HUNT_AREA.minX + Math.floor(Math.random() * (HUNT_AREA.maxX - HUNT_AREA.minX + 1));
      const y = HUNT_AREA.minY + Math.floor(Math.random() * (HUNT_AREA.maxY - HUNT_AREA.minY + 1));
      if (walkable(x, y, z)) return new Location(x, y, z);
    }
    return null;
  }

  function spawnButterfly(player, state) {
    state.butterflies = state.butterflies.filter(alive);
    while (state.butterflies.length >= MAX_BUTTERFLIES) despawn(state.butterflies.shift());
    const tile = butterflyTile(player);
    if (!tile) return null;
    const npc = api.spawnNpc({
      id: DRAUGEN_BUTTERFLY, x: tile.getX(), y: tile.getY(), z: tile.getZ(), wanderRadius: BUTTERFLY_WANDER, owner: player,
    });
    if (!npc) return null;
    state.butterflies.push(npc);
    state.target = npc;
    TaskManager.submit(new CountdownTask(npc, BUTTERFLY_LIFETIME, () => expireButterfly(player, npc)));
    return npc;
  }

  function expireButterfly(player, npc) {
    despawn(npc);
    const state = hunts.get(player);
    if (!state) return;
    state.butterflies = state.butterflies.filter((entry) => entry !== npc);
    if (state.target === npc) state.target = null;
  }

  function direction(from, to) {
    const dx = Math.sign(to.getX() - from.getX());
    const dy = Math.sign(to.getY() - from.getY());
    const ns = dy > 0 ? "north" : dy < 0 ? "south" : "";
    const ew = dx > 0 ? "east" : dx < 0 ? "west" : "";
    return ns && ew ? `${ns}-${ew}` : ns || ew;
  }

  function locate(player) {
    if (!huntActive(player)) return;
    // Wiki: a talisman lost after the kill restarts the hunt.
    if (ctx.flag(player, FLAG.DRAUGEN)) {
      if (ctx.held(player, CHARGED_TALISMAN)) {
        player.sendMessage(MSG_CAPTURED);
        return;
      }
      ctx.setFlag(player, FLAG.DRAUGEN, false);
    }
    const state = hunt(player);
    // Ours: a Draugen the hunter left behind (fled, died) goes, so the hunt can find it again.
    if (alive(state.draugen) && chebyshev(player.getLocation(), state.draugen.getLocation()) > DRAUGEN_LEASH) {
      despawn(state.draugen);
      state.draugen = null;
    }
    // Ours: one Draugen per hunt; while it is out, the talisman says it is here.
    if (alive(state.draugen)) {
      player.sendMessage(MSG_HERE);
      return;
    }
    let target = alive(state.target) ? state.target : null;
    if (!target) {
      // A hunt whose butterfly timed out goes on elsewhere (1002249/1002250 first clicks).
      if (state.started) player.sendMessage(MSG_MOVED);
      state.started = true;
      target = spawnButterfly(player, state);
      if (!target) return;
    } else if (chebyshev(player.getLocation(), target.getLocation()) <= HERE_RANGE) {
      player.sendMessage(MSG_HERE);
      spawnDraugen(player, state);
      return;
    } else if (Math.random() < MOVE_CHANCE) {
      player.sendMessage(MSG_MOVED);
      target = spawnButterfly(player, state) ?? target;
    }
    player.sendMessage(`The talisman guides you ${direction(player.getLocation(), target.getLocation())}.`);
  }

  const shuffled = (list) => list.map((value) => [Math.random(), value]).sort((a, b) => a[0] - b[0]).map(([, value]) => value);
  /** Live's spots (seen west, west and south), then, where those are walled off (Ours), a diagonal or a tile further out. */
  const DRAUGEN_RINGS = [
    [[0, 1], [0, -1], [1, 0], [-1, 0]],
    [[1, 1], [1, -1], [-1, 1], [-1, -1]],
    [[0, 2], [0, -2], [2, 0], [-2, 0], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [-1, 2], [1, -2], [-1, -2]],
  ];

  /** A free tile next to the player that the Draugen can step to the player from. */
  function draugenTile(player) {
    const at = player.getLocation();
    const area = player.getPrivateArea?.() ?? null;
    const occupied = (x, y) => (player.getLocalNpcs?.() ?? []).some((npc) =>
      npc?.getLocation?.().getX() === x && npc.getLocation().getY() === y && npc.getLocation().getZ() === at.getZ());
    for (const ring of DRAUGEN_RINGS) {
      for (const [dx, dy] of shuffled(ring)) {
        const x = at.getX() + dx;
        const y = at.getY() + dy;
        const tile = new Location(x, y, at.getZ());
        if (RegionManager.blocked(tile, area) || occupied(x, y)) continue;
        const near = Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
        if (near && !RegionManager.canMove(at.getX(), at.getY(), x, y, at.getZ(), 1, 1, area)) continue;
        return tile;
      }
    }
    return null;
  }

  function spawnDraugen(player, state) {
    const tile = draugenTile(player) ?? player.getLocation().clone();
    const npc = api.spawnNpc({ id: DRAUGEN, x: tile.getX(), y: tile.getY(), z: tile.getZ(), wanderRadius: 0, owner: player });
    if (!npc) return;
    state.draugen = npc;
    draugenOwners.set(npc, player);
    npc.setPositionToFace(player.getLocation());
    // Aggressive: it attacks before the hunter does, ATTACK_DELAY ticks after it appeared.
    TaskManager.submit(new CountdownTask(npc, ATTACK_DELAY, () => {
      if (alive(npc) && player.isRegistered?.() !== false) npc.getCombat().attack(player);
    }));
    TaskManager.submit(new CountdownTask(npc, DRAUGEN_LIFETIME, () => {
      if (!alive(npc) || npc.getHitpoints?.() <= 0) return;
      despawn(npc);
      if (state.draugen === npc) state.draugen = null;
    }));
  }

  // --- The fight's end --------------------------------------------------------------------------

  /** No death animation: the Draugen goes the tick after the killing hit, in a puff of smoke. */
  function draugenDies(event) {
    const { npc } = event;
    const player = draugenOwners.get(npc);
    if (!player) return;
    event.preventDeath = true;
    npc.setDying?.(true);
    npc.getCombat().reset();
    if (player.getCombat?.().getTarget?.() === npc) player.getCombat().reset();
    TaskManager.submit(new CountdownTask(npc, 1, () => vanish(player, npc)));
  }

  function vanish(player, npc) {
    const tile = npc.getLocation().clone();
    despawn(npc);
    const state = hunts.get(player);
    if (state?.draugen === npc) state.draugen = null;
    if (player.isRegistered?.() === false) return;
    player.getPacketSender().sendGlobalGraphic(new Graphic(GFX_SMOKEPUFF), tile);
    player.getPacketSender().sendSound(SOUND_GHOST_DEATH, 1, 0);
    // Ours: no essence without the talisman to hold it.
    if (!huntActive(player) || !ctx.held(player, TALISMAN)) return;
    ctx.setFlag(player, FLAG.DRAUGEN);
    player.sendMessage(MSG_ABSORB);
    // The charged one takes the first free slot (1002236, 1002250).
    ctx.take(player, TALISMAN, 1);
    ctx.give(player, CHARGED_TALISMAN, 1);
  }

  // --- Lifecycle ---------------------------------------------------------------------------------

  function clearHunt(player) {
    const state = hunts.get(player);
    if (!state) return;
    for (const npc of state.butterflies) despawn(npc);
    despawn(state.draugen);
    hunts.delete(player);
  }

  function handleLogout({ player }) {
    clearHunt(player);
  }

  function handleItemAction(event) {
    const { player, itemId } = event;
    if (itemId !== TALISMAN && itemId !== CHARGED_TALISMAN) return;
    if (!String(event.option ?? "").toLowerCase().includes("locate")) return;
    event.handled = true;
    if (itemId === CHARGED_TALISMAN) {
      player.sendMessage(MSG_CAPTURED);
      return;
    }
    locate(player);
  }

  ctx.variant(SIGLI, sigliVariant);
  ctx.offer(SIGLI, sigliOffer);
  ctx.condition(answerCondition);
  ctx.conditionStep(STEP_HAS_SPACE, giveTalisman);
  ctx.conditionStep(STEP_NO_SPACE, startWithoutTalisman);
  ctx.action(STEP_RECEIVE, giveTalisman);
  ctx.action(STEP_REPLACE, replaceTalisman);
  ctx.line(thanksLine);
  api.onItemAction(handleItemAction);
  api.onNpcBeforeDeath(draugenDies);
  api.onPlayerLogout(handleLogout);
};
