/**
 * Shilo Village's way in, as the capture plays it (RSProx capture ShiloVillage, rev 242.1; ticks
 * are that recording's):
 * - the broken cart on the Brimhaven road (multiloc 2216 on varp 116: 28930 "Look-at"/"Search" before
 *   the quest, 28931 "Climb over" after it): Look-at's box (t672); Search from the road, the box, Mosol's
 *   warning and the menu (t678-688, t753-773, the transcript's "Search Broken cart"); over it from
 *   either side by sequence 828 and three footstep sounds, landing on the far side a tick later with the
 *   one line inbound (t689, t5409) or the two lines outbound (t741-742, t775-776, t5405);
 * - the village's metal gate (2259/2260, a west-edge wall at x 2875): before the quest the cold-gate
 *   menu from outside, and its Yes drags the player in (t692-716), No backs away (t699-701); from
 *   inside it opens slowly (t731-736); after it the gate walks the player through with a line each way
 *   (t5401-5415). Open, both leaves become inviswall 38848 with the open leaves 1573/1574 on x 2874, and
 *   they shut again two ticks later;
 * - the inner wooden gate (2261/2262, an east-edge wall at x 2867): before the quest it won't open
 *   (t719-726); after it, it opens for the step through with a line each way (t5398-5421), inviswall on
 *   the doorway and 2263/2264 east of it for two ticks, sound 67;
 * - the green mist in the courtyard between the gates (t726-738) and the gas some undead ones leave
 *   where they die (t4156-4172; Wiki, Undead one: the zombie variants, 2-3 damage, one square);
 * - Mosol Rei: the undead he points out (t826-832, t1097-1100) and, after the quest, his way into the
 *   village (Talk-to's Yes t5392-5397, Follow t5430-5433: a box, a fade, the player inside at 2866,2952).
 */
module.exports = function attachVillage(api, sv) {
  const { ObstacleRunner, STAGE, MECH, NPC, LOC } = sv;
  const { Graphic, Location, Area, Boundary } = api.core;

  // --- The broken cart --------------------------------------------------------------------------
  /** The cart's 3x3 at 2877-2879: the road side is east of its middle. */
  const CART_MIDDLE_X = 2878;
  const CART_INSIDE_TILE = [2876, 2952, 0];
  const CART_OUTSIDE_TILE = [2880, 2952, 0];
  const CART_LOOK = "You see a broken cart has been placed here. You suspect it's intended to keep people out.";
  const CART_IN_LINE = "You nimbly jump from one side of the cart to the other, and climb down again.";
  const CART_OUT_LINES = ["You climb up onto the cart, and nimbly jump from one side...", "...to the other, and climb down again."];
  const CART_LOOK_VARIANT = "starting-out-look-at-broken-cart";
  const CART_SEARCH_VARIANT = "starting-out-search-broken-cart";
  /** The transcript's climbing options; "Don't warn me again." skips the warning from then on (ours: kept). */
  const CART_CLIMB = "I'm climbing over the cart anyway!";
  const CART_CLIMB_QUIETLY = "I'm climbing in anyway. Don't warn me again.";

  // --- The metal gate ---------------------------------------------------------------------------
  const GATE_X = 2875;
  const GATE_CLOSED = [[2259, 2875, 2952, 0, 0], [2260, 2875, 2953, 0, 0]];
  const GATE_OPENED = [
    [LOC.INVISWALL, 2875, 2953, 0, 0], [LOC.INVISWALL, 2875, 2952, 0, 0],
    [LOC.METAL_GATE_OPEN_R, 2874, 2953, 0, 1], [LOC.METAL_GATE_OPEN_L, 2874, 2952, 0, 3],
  ];
  const GATE_SOUND = 71; // iron_door_open
  const GATE_VARIANT = "starting-out-open-metal-gate";
  const GATE_FEARLESS = "Yes, I am fearless!";
  const GATE_AFRAID = "No, actually, I have a bad feeling about this!";
  const GATE_LINES = Object.freeze({
    opening: "The gates slowly begin to open...",
    grabbed: "Suddenly some Zombies grab you and start dragging you inside!",
    backAway: "You drag your quivering body away from the gates.",
    unseen: "You look around, but you don't think anyone saw you.",
    slowly: "The gates open very slowly.",
    through: "You open the gates and make your way through into the village.",
    backOut: "You open the gates and make your way back out of the village.",
  });

  // --- The inner wooden gate --------------------------------------------------------------------
  const INNER_X = 2867;
  const INNER_CLOSED = [[2261, 2867, 2953, 0, 2], [2262, 2867, 2952, 0, 2]];
  const INNER_OPENED = [
    [LOC.INVISWALL, 2867, 2952, 0, 2], [LOC.INVISWALL, 2867, 2953, 0, 2],
    [2263, 2868, 2953, 0, 1], [2264, 2869, 2953, 0, 1],
  ];
  const INNER_SOUND = 67; // gate_open
  const INNER_LINES = Object.freeze({
    refused: "The gate won't open.",
    into: "You make your way into Shilo Village.",
    outOf: "You make your way out of Shilo Village.",
  });

  // --- The mist ---------------------------------------------------------------------------------
  const MIST_GFX = 184; // shilomist
  const MIST_SOUND = 2138; // swamp_gas
  const MIST_LINE = "A green thick mist rises from the ground and starts choking you.";
  /** It rises four times, four ticks apart, at the same tile (t726/730/734/738, t4160-4172). */
  const MIST_PULSES = 4;
  const MIST_INTERVAL = 4;
  /** Wiki (Undead one): 2-3 damage to whoever is within one square of it. */
  const MIST_DAMAGE = [2, 3];
  /**
   * Ours: how often. The capture shows the courtyard mist once in 30 ticks there (t726) and the gas from
   * one of about ten zombie deaths; the Wiki says only "the chance".
   */
  const COURTYARD_MIST_CHANCE = 1 / 32;
  const ZOMBIE_GAS_CHANCE = 1 / 8;
  /** The village's undead ones that leave gas when killed (Wiki: the zombie variants, 5346-5351). */
  const ZOMBIE_IDS = new Set([5346, 5347, 5348, 5349, 5350, 5351]);
  /** The cloud rises four ticks after the body is gone (zombie death t4151, removed t4156, cloud t4160). */
  const ZOMBIE_GAS_DELAY = 9;
  /** The courtyard between the gates, x 2868-2874 (ours: the y extent is where the zombies stand). */
  const COURTYARD = { minX: 2868, maxX: 2874, minY: 2946, maxY: 2959 };

  // --- Mosol Rei --------------------------------------------------------------------------------
  const MOSOL_SUMMON_STEP = "Xkfm6o"; // the transcript's "Mosol is attacked by undead" marker
  const MOSOL_SHOUT = "Arrggghhh, here are some now!";
  /** Where the undead appear, with their puff of smoke (t830: three; t1100: the first one). */
  const UNDEAD_SLOTS = [
    { id: NPC.UNDEAD_ONE_ARMED, at: [2883, 2952], puff: [2884, 2953] },
    { id: NPC.UNDEAD_ONE, at: [2880, 2954], puff: [2881, 2955] },
    { id: NPC.UNDEAD_ONE_ARMED, at: [2880, 2951], puff: [2881, 2951] },
  ];
  const UNDEAD_SAYS = ["Prepare to go to the other side!", "You cannot escape me, prepare to die.", "Rahhhhh! OOoohhhhhh!"];
  const SMOKEPUFF = 86;
  const SMOKEPUFF_SOUND = 1930;
  /** Ours: they go after 500 ticks if not killed (the capture's were killed). */
  const UNDEAD_LIFETIME = 500;
  const MOSOL_LEADS = "Mosol leads you into the village and walks back out into the jungle.";
  const MOSOL_LANDING = [2866, 2952, 0];

  /** Players who chose to climb the cart, until the transcript ends. */
  const pendingCart = new WeakSet();
  const summoned = new Map();

  function mapAnim(player, id, [x, y], { delay = 0, height = 0 } = {}) {
    const at = new Location(x, y, player.getLocation().getZ());
    const graphic = Graphic.delayed(id, delay, height);
    for (const viewer of [player, ...(player.getLocalPlayers?.() ?? [])]) {
      viewer.getPacketSender().sendGlobalGraphic(graphic, at);
    }
  }

  function areaSound(player, soundId, [x, y], radius = 10) {
    api.core.Sounds.playAreaSound({ soundId, x, y, level: player.getLocation().getZ(), radius });
  }

  // --- Cart -------------------------------------------------------------------------------------
  function cartFrom(player) {
    return player.getLocation().getX() < CART_MIDDLE_X ? "inside" : "outside";
  }

  function climbCart(player) {
    if (ObstacleRunner.isBusy(player)) return;
    const inbound = cartFrom(player) === "outside";
    ObstacleRunner.run({ player }, [
      { anim: 828, delay: 15 },
      { sound: 4035 },
      { sound: 4033, delay: 13 },
      { sound: 4034, delay: 19 },
      ...(inbound ? [] : [{ msg: CART_OUT_LINES[0] }]),
      { wait: 1 },
      { msg: inbound ? CART_IN_LINE : CART_OUT_LINES[1] },
      { tele: inbound ? CART_INSIDE_TILE : CART_OUTSIDE_TILE },
      { anim: -1 },
    ], { busyVarbit: true });
  }

  function handleCart(event) {
    const { player, clickType } = event;
    event.handled = true;
    if (sv.complete(player)) {
      if (clickType === 2) climbCart(player);
      return;
    }
    if (clickType === 1) {
      if (!sv.scene(player, NPC.MOSOL_REI, CART_LOOK_VARIANT)) sv.statement(player, CART_LOOK);
      return;
    }
    if (cartFrom(player) === "inside" || sv.mechTest(player, MECH.CART_NO_WARNING)) {
      climbCart(player);
      return;
    }
    sv.scene(player, NPC.MOSOL_REI, CART_SEARCH_VARIANT);
  }

  // --- Metal gate -------------------------------------------------------------------------------
  function swingGate() {
    sv.swingOpen({ closed: GATE_CLOSED, opened: GATE_OPENED });
  }

  /** Before the quest, from inside: it opens slowly and lets the player out (t731-736). */
  function slowlyOut(player) {
    const y = player.getLocation().getY();
    ObstacleRunner.run({ player }, [
      { wait: 1 },
      { msg: GATE_LINES.slowly },
      { run: swingGate },
      { sound: GATE_SOUND },
      { walk: [[GATE_X, y]], arrive: true },
    ], { busyVarbit: true });
  }

  /** "Yes, I am fearless!": the gates open and the zombies drag the player in (t708-716). */
  function draggedIn(player) {
    const here = player.getLocation();
    const y = 2953;
    ObstacleRunner.run({ player }, [
      { msg: GATE_LINES.opening },
      { wait: 1 },
      // A step onto the gate's north row first (t709); from that row already, the tick passes as a wait.
      here.getY() === y ? { wait: 1 } : { walk: [[here.getX(), y]] },
      { msg: GATE_LINES.grabbed },
      { run: swingGate },
      { sound: GATE_SOUND },
      { walk: [[2874, y], [2873, y]], tilesPerTick: 2, arrive: true },
      { walk: [[2872, y], [2871, y], [2870, y]], arrive: true },
    ], { busyVarbit: true });
  }

  /** "No, actually...": backing away, and a look round two ticks later (t699-701). */
  function backAway(player) {
    ObstacleRunner.run({ player }, [
      { msg: GATE_LINES.backAway },
      { wait: 2 },
      { msg: GATE_LINES.unseen },
    ], { busyVarbit: true });
  }

  /** After the quest: through with the line each way, the gate shut two ticks later (t5401-5415). */
  function passGate(player) {
    if (ObstacleRunner.isBusy(player)) return;
    const y = player.getLocation().getY();
    const inbound = player.getLocation().getX() >= GATE_X;
    const path = inbound ? [[GATE_X, y], [GATE_X - 1, y]] : [[GATE_X, y]];
    const onGate = sv.at(player, GATE_X, y);
    ObstacleRunner.run({ player }, [
      { walk: inbound && onGate ? [[GATE_X - 1, y]] : path, arrive: true },
      { msg: inbound ? GATE_LINES.through : GATE_LINES.backOut },
      { run: swingGate },
      { sound: GATE_SOUND },
    ]);
  }

  function handleMetalGate(event) {
    const { player } = event;
    event.handled = true;
    if (ObstacleRunner.isBusy(player)) return;
    if (sv.complete(player)) {
      passGate(player);
      return;
    }
    if (player.getLocation().getX() < GATE_X) {
      slowlyOut(player);
      return;
    }
    sv.scene(player, NPC.MOSOL_REI, GATE_VARIANT);
  }

  // --- Inner gate -------------------------------------------------------------------------------
  function swingInner() {
    sv.swingOpen({ closed: INNER_CLOSED, opened: INNER_OPENED });
  }

  /** After the quest: the step across, with the line on the tick it is taken (t5398-5421). */
  function passInner(player) {
    if (ObstacleRunner.isBusy(player)) return;
    const y = player.getLocation().getY();
    const outbound = player.getLocation().getX() <= INNER_X;
    const steps = outbound
      ? [...(sv.at(player, INNER_X, y) ? [] : [{ walk: [[INNER_X, y]], arrive: true }]), { walk: [[INNER_X + 1, y]], arrive: true }]
      : [...(sv.at(player, INNER_X + 1, y) ? [] : [{ walk: [[INNER_X + 1, y]], arrive: true }]), { walk: [[INNER_X, y]], arrive: true }];
    ObstacleRunner.run({ player }, [
      ...steps,
      { msg: outbound ? INNER_LINES.outOf : INNER_LINES.into },
      { run: swingInner },
      { sound: INNER_SOUND },
    ]);
  }

  function handleInnerGate(event) {
    const { player } = event;
    event.handled = true;
    if (sv.complete(player)) {
      passInner(player);
      return;
    }
    player.sendMessage(INNER_LINES.refused);
  }

  /** The village's gates and cart ask before the Doors plugin, which would open them as plain doors. */
  function beforeObject(event) {
    const { objectId, clickType } = event;
    if (objectId === LOC.BROKEN_CART) handleCart(event);
    else if (clickType === 1 && LOC.VILLAGE_GATE.includes(objectId) && atVillage(event.location)) handleMetalGate(event);
    else if (clickType === 1 && LOC.INNER_GATE.includes(objectId) && atVillage(event.location)) handleInnerGate(event);
  }

  function atVillage(location) {
    const x = location?.getX?.() ?? location?.x;
    const y = location?.getY?.() ?? location?.y;
    return x >= 2860 && x <= 2880 && y >= 2945 && y <= 2960;
  }

  // --- Transcript hooks -------------------------------------------------------------------------
  function handleChoice(event) {
    const { player, option } = event;
    if (!player) return;
    if (option === CART_CLIMB || option === CART_CLIMB_QUIETLY) {
      if (option === CART_CLIMB_QUIETLY) sv.mechSet(player, MECH.CART_NO_WARNING, true);
      pendingCart.add(player);
    } else if (option === GATE_FEARLESS) {
      event.end = true;
      draggedIn(player);
    } else if (option === GATE_AFRAID) {
      event.end = true;
      backAway(player);
    }
  }

  /** The player's own line after a climbing option: the climb starts as it is continued (t688, t772). */
  function handleLine(event) {
    const { player } = event;
    if (!player || !pendingCart.has(player)) return;
    const text = String(event.text ?? "");
    if (text !== CART_CLIMB && text !== CART_CLIMB_QUIETLY) return;
    pendingCart.delete(player);
    const previous = event.after;
    event.after = () => {
      previous?.();
      climbCart(player);
    };
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player) return;
    if (stepId === MOSOL_SUMMON_STEP) {
      event.handled = true;
      event.end = true;
      summonUndead(player, event.npc);
      return;
    }
    if (event.kind === "message" && String(event.text) === MOSOL_LEADS) {
      // Talk-to's Yes reaches the box: the lead-in plays it itself, with the fade.
      event.handled = true;
      event.end = true;
      leadIn(player);
    }
  }

  // --- Mosol's undead ---------------------------------------------------------------------------
  /**
   * The dialogue closes, Mosol shouts (overhead and in chat), and one to three undead ones rise round
   * him in a puff of smoke, each with a shout of its own, and attack (t830 three, t1100 one; the number
   * is ours: 1-3 at random).
   */
  function summonUndead(player, mosol) {
    mosol?.forceChat?.(MOSOL_SHOUT);
    player.sendMessage(`Mosol Rei: ${MOSOL_SHOUT}`);
    const count = 1 + Math.floor(Math.random() * UNDEAD_SLOTS.length);
    const z = player.getLocation().getZ();
    for (const slot of UNDEAD_SLOTS.slice(0, count)) {
      mapAnim(player, SMOKEPUFF, slot.puff, { height: 5 });
      areaSound(player, SMOKEPUFF_SOUND, slot.puff);
      const npc = api.spawnNpc({ id: slot.id, x: slot.at[0], y: slot.at[1], z, wanderRadius: 3, owner: player, ownerOnly: true });
      if (!npc) continue;
      npc.forceChat?.(UNDEAD_SAYS[Math.floor(Math.random() * UNDEAD_SAYS.length)]);
      npc.getCombat?.().attack?.(player);
      const list = summoned.get(player) ?? [];
      list.push(npc);
      summoned.set(player, list);
      sv.later(player, UNDEAD_LIFETIME, () => dismiss(player, npc));
    }
  }

  function dismiss(player, npc) {
    if (npc?.isRegistered?.() !== false) api.removeNpc(npc);
    const list = summoned.get(player);
    if (list) summoned.set(player, list.filter((other) => other !== npc));
  }

  // --- Mosol's way in ---------------------------------------------------------------------------
  /**
   * The box with the fade out, the player inside the inner gate two ticks later, and the box again with
   * the fade in (t5392-5397). Talk-to's Yes leads the same way as Follow (t5430-5433).
   */
  function leadIn(player) {
    if (ObstacleRunner.isBusy(player)) return;
    ObstacleRunner.run({ player }, [
      { msg: { mesbox: MOSOL_LEADS } },
      { fade: "out" },
      { wait: 2 },
      { tele: MOSOL_LANDING },
      { wait: 1 },
      { fade: "in" },
      { msg: { mesbox: MOSOL_LEADS } },
    ]);
  }

  function handleMosolFollow(event) {
    const { player } = event;
    if (!sv.complete(player)) return false;
    event.handled = true;
    leadIn(player);
    return true;
  }

  // --- Mist -------------------------------------------------------------------------------------
  /** A cloud of green mist at `tile`, pulsing four times; each pulse chokes whoever stands within one square. */
  function raiseMist(viewer, [x, y]) {
    const z = viewer.getLocation().getZ();
    const told = new WeakSet();
    const pulse = () => {
        mapAnim(viewer, MIST_GFX, [x, y], { delay: 3, height: 124 });
        areaSound(viewer, MIST_SOUND, [x, y]);
        for (const player of [viewer, ...(viewer.getLocalPlayers?.() ?? [])]) {
          const at = player.getLocation();
          if (at.getZ() !== z || Math.abs(at.getX() - x) > 1 || Math.abs(at.getY() - y) > 1) continue;
          if (!told.has(player)) {
            told.add(player);
            player.sendMessage(MIST_LINE);
          }
          sv.later(player, 1, () => hit(player));
        }
    };
    pulse();
    for (let index = 1; index < MIST_PULSES; index++) sv.later(viewer, index * MIST_INTERVAL, pulse);
  }

  function hit(player) {
    const { HitDamage, HitMask } = api.core;
    const damage = MIST_DAMAGE[0] + Math.floor(Math.random() * (MIST_DAMAGE[1] - MIST_DAMAGE[0] + 1));
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.RED)]);
  }

  function createCourtyard() {
    return new (class ShiloCourtyard extends Area {
      constructor() {
        super([new Boundary(COURTYARD.minX, COURTYARD.maxX, COURTYARD.minY, COURTYARD.maxY, 0)]);
      }

      process(mobile) {
        if (!mobile.isPlayer?.() || sv.complete(mobile) || Math.random() >= COURTYARD_MIST_CHANCE) return;
        const at = mobile.getLocation();
        raiseMist(mobile, [at.getX(), at.getY()]);
      }
    })();
  }

  function handleNpcDeath(event) {
    const npcId = event.npcId ?? event.npc?.getId?.();
    const killer = event.killer;
    if (!ZOMBIE_IDS.has(npcId) || !killer?.isPlayer?.() || Math.random() >= ZOMBIE_GAS_CHANCE) return;
    const at = event.npc?.getLocation?.();
    if (!at) return;
    const tile = [at.getX(), at.getY()];
    sv.later(killer, ZOMBIE_GAS_DELAY, () => raiseMist(killer, tile));
  }

  function handleLogout({ player }) {
    for (const npc of summoned.get(player) ?? []) api.removeNpc(npc);
    summoned.delete(player);
  }

  api.onBeforeObjectInteraction(beforeObject);
  api.onNpcInteraction("Mosol Rei", { Follow: handleMosolFollow });
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogout(handleLogout);
  api.registerArea(createCourtyard());

  return { climbCart, passGate, passInner, leadIn, raiseMist, summonUndead, UNDEAD_SLOTS, CART_SEARCH_VARIANT, GATE_VARIANT };
};
