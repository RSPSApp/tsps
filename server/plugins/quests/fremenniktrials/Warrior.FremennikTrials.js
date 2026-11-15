/**
 * The Fremennik Trials: Warrior unit. Thorvald the Warrior's trial: the battleground under his
 * hut and Koschei the deathless (see State.FremennikTrials.js for the shared context).
 *
 * Live (rsprox 1002236 rev 242 t8254-9696; 1001646 rev 241 t2279-2722):
 *
 * - Accepting ("Yes") only ends Thorvald's talk: no NPC, no varp, no message (1002236 t8381).
 * - viking_warrior_ladder (4187) op2 Climb-down: seq 828 and the move to 2671,10098,2 on the
 *   same tick (t8388), then "Explore this battleground and find your foe..." 3 ticks later
 *   (t8391). Dropping in the arena: "You cannot drop items in this area." (1001646 t2291).
 * - Koschei comes once the player has stood still a while (242: 15 ticks after stopping, t8397
 *   -> t8412; 241: 9 ticks, t2322 -> t2331), on a tile next to the player (diagonal in both),
 *   with a random overhead, smokepuff 86 and area sound 1930 (range 10) on his tile, varbit
 *   current_hint_arrow 14192 = 7 and a hint arrow on him. He attacks first (t8415).
 * - One NPC through four forms: at 0 HP, next tick seq sanctuary 1057 and the transformation
 *   to the next id (3898/3899/3900, healed to 50/70/255), the player busy (varbit 12393); the
 *   tick after, the new form's chat line (t8443-8444, t8542-8543, t8794-8795). Form 4 with
 *   prayer: the long line and prayer set to 0 that tick; without prayer (1001646 t2582) only the
 *   line's first sentence. On continue: busy 0, an overhead, and he fights on (t8449-8450).
 * - Form 4 hits every tick for 0-1. The hit that would take the player below 1 HP lands with
 *   no hitsplat; that tick the trial passes (varp 347 +1) and the player is busy (t9635); +2
 *   seq viking_drop_to_knee 1331 (t9637); +6 "Oh dear you are...", the move to 2667,3692,1,
 *   Koschei gone, the hint arrow reset (t9641); +11 "...still alive somehow?" and
 *   "Congratulations! You have passed the warrior's trial!", HP and prayer restored, seq 1332
 *   and Thorvald's talk (head anim chatlaugh2 606) (t9646; 1001646 t2692-2703 the same).
 * - The balcony's viking_warrior_ladder_down (4189) Climb-down: seq 828, the move to
 *   2666,3694,0 a tick later (t9695-9696), closing the talk. A click while busy does nothing.
 *
 * Wiki only (no capture): the armour/weapon refusal (data YSTKi0) and what counts; deaths in
 * forms 1-3 are safe; killing form 4 gives the Fremennik blade (data -dImPE); the 10-minute
 * timeout in forms 3/4 (data ppj2xU); prayer kept at 0 through form 4. Ours: see the notes
 * at each constant and docs/fremennik-trials.md.
 */
module.exports = function attachFremennikTrialsWarrior(api, ctx) {
  const { Location, Animation, Graphic, Area, Boundary, Equipment, CacheDefinitions, NpcIdentifiers, ObjectIdentifiers, Skill } = api.core;
  const { loadTranscripts } = require("../QuestRuntime");
  const { formatPlayerText } = require("../../npcs/NpcDialogues.plugin.js");
  const { T, NPC, I } = ctx;

  const THORVALD = NPC.THORVALD;
  /** viking_thorvald 3896: the head on the post-fight talk (1002236 t9646). */
  const THORVALD_ID = NpcIdentifiers.THORVALD_THE_WARRIOR;
  /** viking_enemy1..4 (3897-3900): one NPC that transforms through them. */
  const FORMS = [
    NpcIdentifiers.KOSCHEI_THE_DEATHLESS,
    NpcIdentifiers.KOSCHEI_THE_DEATHLESS_2,
    NpcIdentifiers.KOSCHEI_THE_DEATHLESS_3,
    NpcIdentifiers.KOSCHEI_THE_DEATHLESS_4,
  ];
  const KOSCHEI = new Set(FORMS);
  const LAST_FORM = FORMS.length;

  /** viking_warrior_ladder 4187 (Thorvald's hut): op2 Climb-down into the arena. */
  const LADDER_HUT = ObjectIdentifiers.LADDER_37;
  const OP_CLIMB_DOWN = 2;
  /** viking_warrior_ladder_up 4188 (the arena): Climb-up. */
  const LADDER_ARENA = ObjectIdentifiers.LADDER_38;
  /** viking_warrior_ladder_down 4189 (the balcony): Climb-down. */
  const LADDER_BALCONY = ObjectIdentifiers.LADDER_39;

  const ARENA_ENTRY = [2671, 10098, 2];
  /** Thorvald's balcony, where the pass lands (1002236 t9641). */
  const BALCONY = [2667, 3692, 1];
  /** Below the balcony ladder (1002236 t9696, 1001646 t2722). */
  const HUT = [2666, 3694, 0];
  /**
   * The arena: every tile reachable from the entry (2642-2672, 10065-10099 on plane 2, from the
   * cache's collision), with a tile of margin.
   */
  const ARENA = { minX: 2641, maxX: 2673, minY: 10064, maxY: 10100, z: 2 };

  const SEQ_LADDER = 828; // human_reachforladder
  const SEQ_TRANSFORM = 1057; // sanctuary
  const SEQ_KNEEL = 1331; // viking_drop_to_knee
  const SEQ_STAND = 1332; // viking_drop_to_knee's rise
  const GFX_SMOKEPUFF = 86; // smokepuff map_anim
  const SOUND_SMOKEPUFF = 1930;
  const SOUND_RANGE = 10;
  const HINT_VARBIT = 14192; // current_hint_arrow
  const HINT_NPC = 7;
  const BUSY_VARBIT = 12393;
  const CHATLAUGH2 = 606;

  /** Stationary ticks before Koschei comes: 9 (1001646 t2322-2331) to 15 (1002236 t8397-8412). */
  const SPAWN_STILL_MIN = 9;
  const SPAWN_STILL_MAX = 15;
  /**
   * Ticks after he appears that he starts his attack. Live's first slash shows 3 ticks after the spawn
   * (1002236 t8412 -> t8415); the engine swings on the combat tick after the attack starts.
   */
  const FIRST_ATTACK_TICKS = 2;
  /** Form change: transform the tick after 0 HP, the chat line the tick after that. */
  const TRANSFORM_TICKS = 1;
  const LINE_TICKS = 2;
  /** The pass, from the tick of the hit (1002236 t9635/9637/9641/9646). */
  const PASS_KNEEL = 2;
  const PASS_MOVE = 6;
  const PASS_END = 11;
  /** Balcony ladder: the move a tick after the climb animation (t9695 -> t9696). */
  const BALCONY_MOVE_TICKS = 1;
  /** "Explore this battleground..." 3 ticks after the move (t8388 -> t8391). */
  const ENTRY_MESSAGE_TICKS = 3;
  /** Wiki: 10 minutes in his third/fourth form and he leaves (data ppj2xU). */
  const TIMEOUT_TICKS = 1000;
  const TIMEOUT_FORM = 3;

  const MSG_NO_DROP = "You cannot drop items in this area."; // 1001646 t2291
  /** Ours: the standard death line for the Wiki's safe death in forms 1-3 (no capture). */
  const MSG_SAFE_DEATH = "Oh dear, you are dead!";

  const V_OFFER = "the-council-members-thorvald-the-warrior";
  const V_AGAIN = "the-council-members-thorvald-the-warrior-talking-to-thorvald-again";
  const V_DONE = "the-council-members-peer-the-seer-after-defeating-koschei-talking-to-thorvald";
  const V_DOWN_AGAIN = "the-council-members-peer-the-seer-after-defeating-koschei-attempting-to-climb-down-the-stairs-again";
  const V_ENTER = "the-council-members-peer-the-seer-entering-the-arena";
  const V_FIGHT = "the-council-members-peer-the-seer-during-the-fight";
  const V_RANDOM = "the-council-members-peer-the-seer-koschei-s-random-dialogue";
  /** The new form's chat line: form 2, 3, 4 (variant, condition step id). */
  const FORM_LINES = {
    2: ["the-council-members-peer-the-seer-during-the-fight-second-phase", "h5yzdR"],
    3: ["the-council-members-peer-the-seer-during-the-fight-third-phase", "mY4kck"],
    4: ["the-council-members-peer-the-seer-during-the-fight-fourth-phase", "Liuu-2"],
  };
  const V_FOURTH = FORM_LINES[4][0];
  const STEP_REFUSE = "YSTKi0";
  const STEP_ENTERED = "U98HqS";
  const STEP_TIMEOUT_A = "MeGDzT";
  const STEP_TIMEOUT_B = "pUIxg9";
  const STEP_OH_DEAR = "ibN1vU";
  const STEP_STILL_ALIVE = "vFYLg2";
  const STEP_KILLED = "WSyuYN";
  const STEP_BLADE = "6Tdk9I";
  const STEP_PASSED_TALK = "WzpjVF";
  const STEP_PASSED_MESSAGE = "KVGiuL";

  /**
   * What the battleground refuses (Wiki "The Fremennik Trials", Thorvald: "You cannot use any
   * weapons, armour, fletching materials (such as logs/arrowtips), or bring runes"; "you can use
   * food, Prayer, god books, and jewellery"; boots of lightness and H.A.M. clothing are allowed):
   * worn or carried, anything the cache gives a worn slot other than the amulet and ring slots,
   * except god books, boots of lightness and H.A.M. pieces; and, carried, runes and fletching
   * materials. Ours: the name patterns below stand in for the Wiki's item classes.
   */
  const JEWELLERY_SLOTS = new Set([Equipment.AMULET_SLOT, Equipment.RING_SLOT]);
  const ALLOWED_WEARABLE = [/^(holy|unholy|damaged) book/i, /^book of (balance|law|war|darkness)/i, /^boots of lightness/i, /^ham (hood|shirt|robe|cloak|logo|gloves|boots)/i];
  const RUNE = /\brunes?$/i;
  const FLETCHING = [/\blogs$/i, /arrowtips$/i, /^arrow shaft$/i, /^headless arrow$/i, /bolt tips$/i, /\(unf\)$/i, /\(u\)$/i];

  /** player -> { npc, form, still, threshold, last, formTicks, transforming, lineShown, passing, gen }. */
  const fights = new WeakMap();
  /** Koschei -> his player. */
  const owners = new WeakMap();

  // --- Data --------------------------------------------------------------------------------------

  function variantSteps(variant) {
    return loadTranscripts(api)?.[ctx.PAGE]?.variants?.[variant] ?? [];
  }

  /** The inner steps of condition `id` in `variant`. */
  function conditionSteps(variant, id) {
    return ctx.stepsById(id)(variantSteps(variant))[0]?.steps ?? [];
  }

  /** A message step's text, by id (the data's words, not ours). */
  function stepText(variant, id) {
    return ctx.stepsById(id)(variantSteps(variant))[0]?.text ?? null;
  }

  function say(player, variant, id) {
    const text = stepText(variant, id);
    if (text) player.sendMessage(text);
  }

  /** Koschei's random overheads (data V_RANDOM, presentation overhead). */
  function randomOverhead(player) {
    const lines = (variantSteps(V_RANDOM)[0]?.options ?? []).map((option) => option.steps?.[0]?.text).filter(Boolean);
    if (!lines.length) return null;
    return formatPlayerText(lines[Math.floor(Math.random() * lines.length)], player);
  }

  // --- Helpers -----------------------------------------------------------------------------------

  const inArena = (player) => ctx.inBox(player, ARENA.minX, ARENA.maxX, ARENA.minY, ARENA.maxY, ARENA.z);
  const alive = (npc) => npc?.isRegistered?.() === true;
  const at = ([x, y, z]) => new Location(x, y, z);

  function itemName(id) {
    return String(CacheDefinitions.getItem(id)?.name ?? "");
  }

  function forbiddenWearable(id) {
    const wearPos = CacheDefinitions.getItem(id)?.wearPos;
    if (!Number.isInteger(wearPos) || wearPos < 0 || JEWELLERY_SLOTS.has(wearPos)) return false;
    const name = itemName(id);
    return !ALLOWED_WEARABLE.some((pattern) => pattern.test(name));
  }

  function forbiddenCarried(id) {
    if (forbiddenWearable(id)) return true;
    const name = itemName(id);
    return RUNE.test(name) || FLETCHING.some((pattern) => pattern.test(name));
  }

  /** Wiki: weapons, armour, runes and fletching materials, worn or carried. */
  function hasForbiddenItems(player) {
    const ids = (container) => (container.getValidItems?.() ?? []).map((item) => item.getId());
    return ids(player.getEquipment()).some(forbiddenWearable) || ids(player.getInventory()).some(forbiddenCarried);
  }

  function lock(player, on) {
    player.getPacketSender().sendVarbit(BUSY_VARBIT, on ? 1 : 0);
    player.getMovementQueue().reset().setBlockMovement(on);
    if (on) player.getCombat().reset();
  }

  function setHint(player, npc) {
    const sender = player.getPacketSender();
    sender.sendVarbit(HINT_VARBIT, npc ? HINT_NPC : 0);
    if (npc) sender.sendEntityHint(npc);
    else sender.clearHintArrow();
  }

  function restore(player) {
    const skills = player.getSkillManager();
    for (const s of [Skill.HITPOINTS, Skill.PRAYER]) skills.setCurrentLevel(s, skills.getMaxLevel(s), true);
  }

  /** Runs `fn` after `ticks` if the fight is still the one that asked. */
  function laterInFight(player, state, ticks, fn) {
    const gen = state.gen;
    ctx.later(player, ticks, () => {
      if (fights.get(player) === state && state.gen === gen) fn();
    });
  }

  function newFight(player) {
    const state = {
      npc: null, form: 0, still: 0, last: player.getLocation().clone(),
      threshold: SPAWN_STILL_MIN + Math.floor(Math.random() * (SPAWN_STILL_MAX - SPAWN_STILL_MIN + 1)),
      formTicks: 0, transforming: false, lineShown: false, passing: false, longLine: false, gen: 0,
    };
    fights.set(player, state);
    return state;
  }

  function removeKoschei(player, state) {
    if (alive(state.npc)) api.removeNpc(state.npc);
    state.npc = null;
    if (player.isRegistered?.() !== false) setHint(player, null);
  }

  /** Ends the fight: Koschei goes, the player is free; the trial stays started (retryable). */
  function endFight(player) {
    const state = fights.get(player);
    if (!state) return;
    state.gen++;
    removeKoschei(player, state);
    fights.delete(player);
    if (state.transforming || state.passing) {
      lock(player, false);
      player.setUntargetable(false);
    }
    // A pass cut short (logout) keeps its vote; the player is not left on 1 HP.
    if (state.passing) restore(player);
  }

  // --- The ladders -------------------------------------------------------------------------------

  /** Claims the three warrior ladders before the generic Ladders plugin guesses. */
  function claimLadder(request) {
    const { player, objectId, clickType } = request;
    if (objectId === LADDER_HUT && clickType === OP_CLIMB_DOWN) {
      request.handled = true;
      climbIntoArena(player);
    } else if (objectId === LADDER_ARENA) {
      request.handled = true;
      leaveArena(player);
    } else if (objectId === LADDER_BALCONY) {
      request.handled = true;
      climbFromBalcony(player);
    }
  }

  function climbIntoArena(player) {
    const stage = ctx.quest?.getStage(player) ?? 0;
    const state = ctx.trialState(player, T.WARRIOR);
    if (stage >= ctx.STAGE_STARTED && state === 2) {
      ctx.play(player, THORVALD_ID, V_DOWN_AGAIN);
      return;
    }
    // Ours: before accepting the trial the ladder does nothing (no capture, no data line).
    if (stage < ctx.STAGE_STARTED || state !== 1) return;
    if (hasForbiddenItems(player)) {
      // Data YSTKi0 (Wiki only): Thorvald repeats the rule; the player stays.
      ctx.play(player, THORVALD_ID, V_ENTER, () => conditionSteps(V_ENTER, STEP_REFUSE).filter((step) => step.type !== "end"));
      return;
    }
    player.performAnimation(new Animation(SEQ_LADDER));
    player.moveTo(at(ARENA_ENTRY));
    ctx.later(player, ENTRY_MESSAGE_TICKS, () => {
      if (inArena(player)) say(player, V_FIGHT, STEP_ENTERED);
    });
  }

  /** Ours (Wiki: leaving fails the trial, retry later): the fight resets, back below the balcony. */
  function leaveArena(player) {
    const state = fights.get(player);
    if (state?.passing || state?.transforming) return;
    endFight(player);
    player.performAnimation(new Animation(SEQ_LADDER));
    player.getMovementQueue().reset().setBlockMovement(true);
    ctx.later(player, BALCONY_MOVE_TICKS, () => {
      player.getMovementQueue().setBlockMovement(false);
      player.moveTo(at(HUT));
    });
  }

  function climbFromBalcony(player) {
    if (fights.get(player)?.passing) return;
    player.getPacketSender().sendInterfaceRemoval();
    player.performAnimation(new Animation(SEQ_LADDER));
    player.getMovementQueue().reset().setBlockMovement(true);
    ctx.later(player, BALCONY_MOVE_TICKS, () => {
      player.getMovementQueue().setBlockMovement(false);
      player.moveTo(at(HUT));
    });
  }

  // --- The arena ---------------------------------------------------------------------------------

  class WarriorArena extends Area {
    process(mobile) {
      if (mobile.isPlayer()) arenaTick(mobile.getAsPlayer());
    }

    postLeave(mobile) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      // The pass moves the player out itself; anything else (a teleport, a logout) ends the fight.
      if (!fights.get(player)?.passing) endFight(player);
    }
  }

  function arenaTick(player) {
    if (ctx.trialState(player, T.WARRIOR) !== 1 || player.getHitpoints() <= 0) return;
    const state = fights.get(player) ?? newFight(player);
    if (state.passing) return;
    if (state.npc) {
      if (!alive(state.npc)) {
        state.npc = null;
        state.form = 0;
        return;
      }
      fightTick(player, state);
      return;
    }
    const here = player.getLocation();
    if (!here.equals(state.last)) {
      state.last = here.clone();
      state.still = 0;
      return;
    }
    if (++state.still >= state.threshold) spawnKoschei(player, state);
  }

  function fightTick(player, state) {
    if (state.transforming) {
      // The line's after never ran (the chatbox closed some other way): carry on as its continue.
      if (state.lineShown && !player.getDialogueManager().isActive()) resume(player, state);
      return;
    }
    // Wiki: through form 4 Koschei keeps the player's prayer at 0.
    if (state.form === LAST_FORM && player.getSkillManager().getCurrentLevel(Skill.PRAYER) > 0) {
      player.getSkillManager().setCurrentLevel(Skill.PRAYER, 0, true);
    }
    if (state.form >= TIMEOUT_FORM && ++state.formTicks >= TIMEOUT_TICKS) timeout(player, state);
  }

  /** Wiki (data ppj2xU): too long in his third/fourth form and he leaves; the fight starts over. */
  function timeout(player, state) {
    say(player, V_FIGHT, STEP_TIMEOUT_A);
    say(player, V_FIGHT, STEP_TIMEOUT_B);
    endFight(player);
  }

  /** A free tile next to the player, diagonals first (both captures). */
  function spawnTile(player) {
    const here = player.getLocation();
    const area = player.getPrivateArea?.() ?? null;
    const shuffle = (list) => list.sort(() => Math.random() - 0.5);
    const sides = [...shuffle([[1, 1], [1, -1], [-1, 1], [-1, -1]]), ...shuffle([[0, 1], [0, -1], [1, 0], [-1, 0]])];
    for (const [dx, dy] of sides) {
      const tile = new Location(here.getX() + dx, here.getY() + dy, here.getZ());
      if (api.core.RegionManager.blocked(tile, area)) continue;
      return tile;
    }
    return here.clone();
  }

  function spawnKoschei(player, state) {
    const tile = spawnTile(player);
    const npc = api.spawnNpc({ id: FORMS[0], x: tile.getX(), y: tile.getY(), z: tile.getZ(), wanderRadius: 0, owner: player, ownerOnly: true });
    if (!npc) return;
    npc.__skipDefaultRespawn = true;
    owners.set(npc, player);
    Object.assign(state, { npc, form: 1, formTicks: 0, still: 0 });
    npc.setPositionToFace(player.getLocation());
    const line = randomOverhead(player);
    if (line) npc.forceChat(line);
    const sender = player.getPacketSender();
    sender.sendGraphic(new Graphic(GFX_SMOKEPUFF), tile);
    sender.sendAreaSound(SOUND_SMOKEPUFF, tile.getX(), tile.getY(), tile.getZ(), 1, 0, SOUND_RANGE);
    setHint(player, npc);
    laterInFight(player, state, FIRST_ATTACK_TICKS, () => {
      if (alive(npc) && !state.transforming && !state.passing) npc.getCombat().attack(player);
    });
  }

  // --- Forms -------------------------------------------------------------------------------------

  function koscheiBeforeDeath(event) {
    const player = owners.get(event.npc);
    if (!player) return;
    const state = fights.get(player);
    event.preventDeath = true;
    if (!state || state.npc !== event.npc || state.transforming || state.passing) return;
    if (state.form < LAST_FORM) transform(player, state);
    else killedLastForm(player, state);
  }

  function transform(player, state) {
    const { npc } = state;
    state.transforming = true;
    state.lineShown = false;
    npc.getCombat().reset();
    npc.setUntargetable(true);
    player.setUntargetable(true);
    lock(player, true);
    laterInFight(player, state, TRANSFORM_TICKS, () => {
      state.form++;
      state.formTicks = 0;
      npc.performAnimation(new Animation(SEQ_TRANSFORM));
      npc.setNpcTransformationId(FORMS[state.form - 1]);
      npc.setHitpoints(npc.getMaxHitpoints());
    });
    laterInFight(player, state, LINE_TICKS, () => formLine(player, state));
  }

  function formLine(player, state) {
    const [variant, id] = FORM_LINES[state.form];
    state.longLine = false;
    if (state.form === LAST_FORM && player.getSkillManager().getCurrentLevel(Skill.PRAYER) > 0) {
      // "...you lose your prayer" and prayer 0 the same tick (1002236 t8795).
      state.longLine = true;
      player.getSkillManager().setCurrentLevel(Skill.PRAYER, 0, true);
    }
    state.lineShown = true;
    ctx.play(player, FORMS[state.form - 1], variant, () => conditionSteps(variant, id).filter((step) => step.type === "line"));
  }

  /** The form line's continue: busy off, an overhead, and he fights on the next tick. */
  function resume(player, state) {
    if (!state.transforming) return;
    state.transforming = false;
    state.lineShown = false;
    lock(player, false);
    player.setUntargetable(false);
    const { npc } = state;
    if (!alive(npc)) return;
    npc.setUntargetable(false);
    const line = randomOverhead(player);
    if (line) npc.forceChat(line);
    laterInFight(player, state, 1, () => {
      if (alive(npc) && !state.transforming && !state.passing) npc.getCombat().attack(player);
    });
  }

  /**
   * Wiki (data -dImPE): he vanishes in smoke and the player gets the Fremennik blade. The trial
   * passes either way, so with a full inventory the blade goes on the floor rather than being lost.
   */
  function killedLastForm(player, state) {
    const tile = state.npc.getLocation().clone();
    endFight(player);
    player.getCombat().reset();
    player.getPacketSender().sendGraphic(new Graphic(GFX_SMOKEPUFF), tile);
    ctx.giveReward(player, I.FREMENNIK_BLADE, 1);
    ctx.completeTrial(player, T.WARRIOR);
    say(player, V_FOURTH, STEP_KILLED);
  }

  // --- The pass ----------------------------------------------------------------------------------

  /** Form 4's hit that would leave the player below 1 HP lands with no hitsplat: the pass. */
  function koscheiHitLands(event) {
    const { player, hit } = event;
    const state = fights.get(player);
    if (!state || !hit || hit.getAttacker?.() !== state.npc || !state.npc) return;
    if (state.passing || state.transforming) {
      hit.withoutHitsplat();
      return;
    }
    if (state.form !== LAST_FORM || hit.getTotalDamage() < player.getHitpoints()) return;
    hit.withoutHitsplat();
    pass(player, state);
  }

  function pass(player, state) {
    state.passing = true;
    ctx.completeTrial(player, T.WARRIOR);
    lock(player, true);
    player.setUntargetable(true);
    if (alive(state.npc)) state.npc.getCombat().reset();
    laterInFight(player, state, PASS_KNEEL, () => player.performAnimation(new Animation(SEQ_KNEEL)));
    laterInFight(player, state, PASS_MOVE, () => {
      say(player, V_FOURTH, STEP_OH_DEAR);
      player.moveTo(at(BALCONY));
      removeKoschei(player, state);
    });
    laterInFight(player, state, PASS_END, () => finishPass(player, state));
  }

  function finishPass(player, state) {
    say(player, V_FOURTH, STEP_STILL_ALIVE);
    say(player, V_DONE, STEP_PASSED_MESSAGE);
    restore(player);
    player.performAnimation(new Animation(SEQ_STAND));
    fights.delete(player);
    lock(player, false);
    player.setUntargetable(false);
    // The data's WzpjVF lines without its message (sent above, before the talk, as live).
    ctx.play(player, THORVALD_ID, V_DONE, () => passedTalk());
  }

  function passedTalk() {
    return conditionSteps(V_DONE, STEP_PASSED_TALK).filter((step) => step.type !== "message" && step.type !== "end");
  }

  /** Any other way to 0 HP in the arena. */
  function playerBeforeDeath(event) {
    const { player } = event;
    const state = fights.get(player);
    if (!state && !inArena(player)) return;
    if (!state || ctx.trialState(player, T.WARRIOR) !== 1 && !state.passing) return;
    event.preventDeath = true;
    if (state.passing) return;
    if (state.form === LAST_FORM && !state.transforming) {
      pass(player, state);
      return;
    }
    // Wiki: a safe death in forms 1-3, respawning outside the room. Ours: no items lost, HP and
    // prayer back, below the balcony; the trial stays started.
    endFight(player);
    restore(player);
    player.sendMessage(MSG_SAFE_DEATH);
    player.moveTo(at(HUT));
  }

  function dropInArena(event) {
    if (!inArena(event.player)) return;
    event.handled = true;
    event.dropToGround = false;
    event.player.sendMessage(MSG_NO_DROP);
  }

  function handleLogout({ player }) {
    endFight(player);
  }

  // --- Thorvald's talk ---------------------------------------------------------------------------

  /** Thorvald's own trial talks (the Merchant unit's chain answers his chain variants first). */
  function thorvaldVariant(player, stage) {
    if (stage < ctx.STAGE_STARTED) return undefined;
    const state = ctx.trialState(player, T.WARRIOR);
    if (state === 2) return V_DONE;
    return state === 1 ? V_AGAIN : V_OFFER;
  }

  function thorvaldOffer(player) {
    return thorvaldVariant(player, ctx.quest.getStage(player)) ?? V_OFFER;
  }

  function acceptTrial(event, text) {
    const { player, npcId } = event;
    if (!THORVALD.has(npcId) || (text !== "yes" && text !== "yes.")) return;
    if (ctx.trialState(player, T.WARRIOR) === 0) ctx.setTrialState(player, T.WARRIOR, 1);
  }

  function answerCondition({ player, npcId, value }) {
    if (!THORVALD.has(npcId)) return null;
    if (value.includes("does not manage to defeat koschei")) return false;
    if (value.includes("manages to defeat koschei")) return ctx.trialState(player, T.WARRIOR) === 2;
    if (value.includes("does not have any weapons or armour")) return !hasForbiddenItems(player);
    if (value.includes("has any weapons or armour")) return hasForbiddenItems(player);
    if (value.includes("raw sardine on thorvald")) return false;
    if (value.includes("4th form") || value.includes("in 10 minutes") || value.includes("wield the blade")) return false;
    if (value.includes("enters the arena") || value.includes("another player's koschei")) return false;
    if (value.includes("prayer potion") || value.includes("nearly dead") || value.includes("phase")) return false;
    return null;
  }

  /** Old saves: a done message step that plays still passes the trial (as the old plugin did). */
  function passStep({ player }) {
    ctx.completeTrial(player, T.WARRIOR);
  }

  /** Koschei's form lines and Thorvald's post-fight talk. */
  function shapeLine(event) {
    const { player, npcId, step } = event;
    const state = fights.get(player);
    if (state?.transforming && state.lineShown && KOSCHEI.has(npcId)) {
      // Without prayer to take, form 4 says only the line's first sentence (1001646 t2582).
      if (state.form === LAST_FORM && !state.longLine) {
        const end = String(event.text).indexOf("!");
        if (end > 0) event.text = String(event.text).slice(0, end + 1);
      }
      event.after = () => resume(player, state);
      return;
    }
    if (THORVALD.has(npcId) && step && step === passedTalk()[0]) event.expression = CHATLAUGH2;
  }

  ctx.variant(THORVALD, thorvaldVariant);
  ctx.offer(THORVALD, thorvaldOffer);
  ctx.choice(acceptTrial);
  ctx.condition(answerCondition);
  ctx.action(STEP_PASSED_MESSAGE, passStep);
  ctx.action(STEP_KILLED, passStep);
  ctx.action(STEP_BLADE, passStep);
  ctx.line(shapeLine);
  api.registerArea(new WarriorArena([new Boundary(ARENA.minX, ARENA.maxX, ARENA.minY, ARENA.maxY, ARENA.z)]));
  api.onCustomEvent("ladders:climb", claimLadder);
  api.onNpcBeforeDeath(koscheiBeforeDeath);
  api.onPlayerHitModify(koscheiHitLands);
  api.onPlayerBeforeDeath(playerBeforeDeath);
  api.onItemDropPolicy(dropInArena);
  api.onPlayerLogout(handleLogout);
};
