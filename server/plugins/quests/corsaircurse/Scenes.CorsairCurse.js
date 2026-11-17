/**
 * The Corsair Curse's cutscenes and Ithoi's fight, as live plays them (rsprox capture local 1001340,
 * rev 240.1, one whole run of the quest; the ticks in the tables are that recording's, counted from
 * the click that leads to each step).
 *
 * Every scene starts the same way: the screen fades out and two ticks later the cutscene state goes
 * on (cutscene_status, minimap off, fov_clamp, draw_distance_max_override, the area-sound override at
 * the player's own volume, side tabs closed, camera shake cleared), the player stands in a copy of the
 * map with the scene's actors, and it fades back in. Lines are continued by the player, except the
 * ones marked held; between a click and the next line live shows an empty, unclickable messagebox.
 *
 * - Tock's ship (tick 4382): the line about his ship is held while the camera pans over the real ship
 *   west of Rimmington (2918,3231); 23 ticks later the line comes back with its continue.
 * - Colin's mermaid (ticks 5054-5220): a copy of the cove at night, Colin (7965) at Ithoi's telescope,
 *   his telescope pose (7966), waves, a blown kiss; no mermaid is ever shown.
 * - Gnocci's doll (ticks 5314-5418): Gnocci (7971) and the player fishing lobsters on the beach, the
 *   doll drawn over the screen by the cache's own script (corscurs_doll, 2085), Gnocci (7972) burying
 *   it and running off east. No doll NPC is spawned, and the player never digs.
 * - The telescope (ticks 5917-5940): an instance of open sea (one chunk tiled 6 x 6), Bugs (7969) in
 *   it, the wom_telescope lens over the view.
 * - The fire (ticks 6378-6406): Ithoi (7962) in his hut, then out of it (7963), a spell on the fire,
 *   and back. The driftwood's burning and wet forms are the multiloc's, from corscurs_progress 49/50.
 * - The fight (ticks 6964-7250): climbing Ithoi's stairs at progress 52 enters a copy of the hut,
 *   where Ithoi (7964) attacks; his death takes the player back to the real hut two ticks later.
 *
 * Words come from the transcript (npc-dialogues.json "The Corsair Curse"), heads' animations from
 * data/chathead-animations.json; each table step names the start of its line, checked at load.
 */
const { createQuestScenes } = require("../QuestScenes");
const HEAD_ANIMATIONS = require("../data/chathead-animations.json");
const CameraShake = require("../../interface/CameraShake.plugin");

const PAGE = "The Corsair Curse";

const COLIN = 7965; // corscurs_cabinboy
const COLIN_TELESCOPE = 7966; // corscurs_cabinboy_telescope
const GNOCCI = 7970; // corscurs_cook
const GNOCCI_FISHING = 7971; // corscurs_cook_fishing
const GNOCCI_DIGGING = 7972; // corscurs_cook_digging
const BUGS = 7969; // corscurs_ogre
const ITHOI_SICK = 7962; // corscurs_navigator_sick (multinpc of corscurs_navigator)
const ITHOI_RUNNING = 7963; // corscurs_navigator_running
const ITHOI_FIGHT = 7964; // corscurs_navigator_combat

const FADE_UID = (161 << 16) | 1;
const FADE_INTERFACE = 174;
const FADE_SCRIPT = 948;
const TELESCOPE_INTERFACE = 386; // wom_telescope
const DOLL_SCRIPT = 2085; // corscurs_doll
const AREA_SOUND_VOLUME_VARP = 872; // option_areasounds

/** fade_overlay's arguments as the capture sends them. */
const FADE_OUT = [0, 255, 0, 0, 50];
const FADE_OUT_QUICK = [0, 255, 0, 0, 15];
const FADE_IN = [0, 0, 0, 255, 50];
const NIGHT_IN = [0, 0, 54, 150, 60];
const NIGHT_OUT = [54, 150, 0, 0, 60];
const FADE_CLEAR = [0, 0, 0, 0, 0];

const RATES = { rate: 232, rate2: 100 };
const SLOW = { rate: 1, rate2: 1 };

module.exports = function createCorsairCurseScenes(api, hooks) {
  const {
    ActionDialogue, Animation, DialogueChainBuilder, Graphic, Location, NpcDialogue, PlayerDialogue, StatementDialogue,
    CacheDefinitions,
  } = api.core;
  const { loadTranscripts } = require("../QuestRuntime");
  const { formatPlayerText } = require("../../npcs/NpcDialogues.plugin.js");
  const Scenes = createQuestScenes(api, { onEnd: sceneEnded, recoveryAttribute: "corsair-curse:scene-exit" });
  /** player -> { name, actors, onLogout } of the scene playing (kept until its last step ran). */
  const playing = new Map();

  // ==========================================================================
  // Helpers
  // ==========================================================================

  function overlay(player, args) {
    player.getPacketSender().mountSubInterface(FADE_UID, FADE_INTERFACE, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
  }

  function varbit(name) {
    return CacheDefinitions.getVarbitId?.(name);
  }

  function varp(name) {
    return CacheDefinitions.getVarpId?.(name);
  }

  /** The cutscene state live sets as a scene starts (tick +2) and clears as it ends. */
  function cutscene(player, on) {
    const sender = player.getPacketSender();
    Scenes.controls(player, on, true);
    for (const name of ["fov_clamp", "draw_distance_max_override"]) {
      const id = varbit(name);
      if (id != null) sender.sendVarbit(id, on ? 1 : 0);
    }
    const volume = Number(sender.getVarp?.(AREA_SOUND_VOLUME_VARP)) || 0;
    const override = varp("option_areasounds_override"), active = varp("areasounds_override");
    if (override != null) sender.sendConfig(override, on ? volume : 0);
    if (active != null) sender.sendConfig(active, on ? 1 : 0);
    if (on) {
      Scenes.hideTabs(player);
      for (let axis = 0; axis < 5; axis++) CameraShake.send(sender, "atmospheric", axis, 0, 0, 0);
    } else {
      Scenes.restoreTabs(player);
    }
  }

  function camera(player, move, look, rates = RATES, lookRates = rates) {
    Scenes.camera(player, move, look, rates, lookRates);
  }

  function moveCamera(player, [x, y, height], rates) {
    const at = Scenes.tileFor(player, [x, y, 0]);
    player.getPacketSender().sendCameraMoveTo(at.getX(), at.getY(), height, { ...rates, heightRelative: false });
  }

  function lookCamera(player, [x, y, height], rates) {
    const at = Scenes.tileFor(player, [x, y, 0]);
    player.getPacketSender().sendCameraLookAt(at.getX(), at.getY(), height, { ...rates, heightRelative: false });
  }

  function anim(mobile, id, delay = 0) {
    mobile?.performAnimation(new Animation(id, delay));
  }

  function transform(npc, id) {
    npc?.setNpcTransformationId(id);
  }

  /**
   * One tick of a scripted run: live moves these actors with a placement each tick (rsprox "teleport");
   * ours walks or runs them there so they keep their walk animation (Ours: the client slides, not snaps).
   */
  function stepTo(npc, tile) {
    if (!npc?.isRegistered?.()) return;
    const to = Scenes.tileFor(npc, tile);
    const from = npc.getLocation();
    const distance = Math.max(Math.abs(to.getX() - from.getX()), Math.abs(to.getY() - from.getY()));
    if (distance === 0) return;
    if (distance > 2) {
      npc.moveTo(to);
      return;
    }
    npc.setMovementSteps?.(distance);
    npc.getMovementQueue().reset().addSteps(to);
  }

  function actor(scene, id, tile, face) {
    const npc = Scenes.actor(scene, id, tile, face);
    npc?.setFlag?.("movement:ignore-clipping", true);
    return npc;
  }

  function sound(player, id, delay = 0, loops = 1) {
    player.getPacketSender().sendSoundEffect(id, loops, delay, 255);
  }

  function emptyBox(player) {
    Scenes.hold(player);
  }

  function expression(speaker, text) {
    return HEAD_ANIMATIONS[speaker]?.[String(text).replace(/\s+/g, " ").trim()];
  }

  // ==========================================================================
  // Transcript lines and the scene runner
  // ==========================================================================

  function variantSteps(variant) {
    const steps = loadTranscripts(api)?.[PAGE]?.variants?.[variant];
    if (!Array.isArray(steps)) throw new Error(`${PAGE}: no "${variant}" transcript`);
    return steps;
  }

  const lineText = (step) => typeof step?.player === "string" ? step.player : step?.type === "line" ? step.text : null;

  /** The list holding the step whose line starts with `prefix`, and its index, searching nested branches. */
  function findLine(steps, prefix) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (lineText(step)?.startsWith(prefix)) return { steps, index: i };
      for (const nested of [step?.steps, ...(step?.options ?? []).map((option) => option.steps)]) {
        const found = Array.isArray(nested) ? findLine(nested, prefix) : null;
        if (found) return found;
      }
    }
    return null;
  }

  /** The scene's lines in order: from the line starting `from` up to the action `to`, actions skipped. */
  function sceneLines(variant, from, to) {
    const found = findLine(variantSteps(variant), from);
    if (!found) throw new Error(`${PAGE}: "${variant}" has no line "${from}"`);
    const out = [];
    for (const step of found.steps.slice(found.index)) {
      if (to && step.id === to) break;
      const text = lineText(step);
      if (text === null) continue;
      out.push(typeof step.player === "string"
        ? { player: true, text, styled: step.styled }
        : { speaker: step.speaker, text, styled: step.styled });
    }
    return out;
  }

  /** The steps after the action (or line) `anchor`, nested ones included: the transcript after a scene. */
  function tailAfter(steps, anchor) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step?.id === anchor || lineText(step)?.startsWith(anchor)) return steps.slice(i + 1);
      for (const nested of [step?.steps, ...(step?.options ?? []).map((option) => option.steps)]) {
        const found = Array.isArray(nested) ? tailAfter(nested, anchor) : null;
        if (found) return found;
      }
    }
    return null;
  }

  /** Pairs each `say` step of a scene with its transcript line, checking the order and the words. */
  function bind(spec, lines) {
    const queue = lines.slice();
    for (const step of spec.steps) {
      if (step.say === undefined) continue;
      const line = queue.shift();
      if (!line || !line.text.startsWith(step.say)) {
        throw new Error(`${PAGE}: scene ${spec.name} expected "${step.say}", the transcript has "${line?.text}"`);
      }
      step.line = line;
    }
    return spec;
  }

  function headOf(state, line, step) {
    if (step.head !== undefined) return typeof step.head === "function" ? step.head(state) : step.head;
    const npc = state.speaker;
    if (npc?.isRegistered?.()) return npc.getNpcTransformationId?.() > 0 ? npc.getNpcTransformationId() : npc.getId();
    return state.npcId;
  }

  /** Shows one line: held (`held` ticks, or until the scene moves on) or continued, then `next`. */
  function showLine(player, state, step, next) {
    const { line } = step;
    const words = formatPlayerText(line.styled ?? line.text, player);
    const animation = expression(line.player ? "player" : line.speaker, line.text);
    const entry = line.player
      ? new PlayerDialogue(0, words, animation)
      : new NpcDialogue(0, headOf(state, line, step), words, line.speaker, animation);
    const chain = new DialogueChainBuilder();
    if (step.held !== undefined) {
      chain.add(new ActionDialogue(0, { execute: () => entry.sendHeld(player) }, true));
      player.getDialogueManager().startDialogues(chain);
      if (typeof step.held === "number") Scenes.later(player, step.held, () => { if (active(player, state)) next(); });
      return;
    }
    chain.add(entry);
    chain.add(new ActionDialogue(1, { execute: () => { if (active(player, state)) next(); } }));
    player.getDialogueManager().startDialogues(chain);
  }

  function active(player, state) {
    return playing.get(player) === state;
  }

  /** Runs step `index`: its events from now, its line `at` ticks later (an empty box until then). */
  function runStep(player, state, index) {
    const step = state.spec.steps[index];
    if (!step || !active(player, state)) return;
    for (const [ticks, event] of step.events ?? []) {
      if (ticks === 0) event(player, state);
      else Scenes.later(player, ticks, () => { if (active(player, state)) event(player, state); });
    }
    if (!step.line) return;
    const show = () => showLine(player, state, step, () => runStep(player, state, index + 1));
    if (step.at) {
      emptyBox(player);
      Scenes.later(player, step.at, () => { if (active(player, state)) show(); });
    } else {
      show();
    }
  }

  function play(player, spec, extra = {}) {
    stop(player);
    const state = { spec, scene: null, actors: {}, npcId: extra.npcId, return: player.getLocation().clone(), ...extra };
    playing.set(player, state);
    player.getMovementQueue().reset().setBlockMovement(true);
    runStep(player, state, 0);
    return state;
  }

  /** Opens the scene's copy and puts the player in it (live: two ticks after the fade starts). */
  function open(player, state, name, { sourceChunk, size, fill }, at, bounds) {
    const exit = [state.return.getX(), state.return.getY(), state.return.getZ()];
    state.scene = Scenes.open(player, name, bounds, { canTeleport: () => false, canAttack: () => false },
      { instance: { sourceChunk, size, fill }, at, exit });
    cutscene(player, true);
    return state.scene;
  }

  /** Leaves the copy for the real map (`to`, or where the scene started) and ends the cutscene. */
  function close(player, state, to = state.return) {
    state.closing = true;
    Scenes.end(player, false);
    player.moveTo(to instanceof Location ? to : new Location(...to));
  }

  function finish(player, state) {
    if (playing.get(player) === state) playing.delete(player);
    player.getMovementQueue().setBlockMovement(false);
  }

  /** A scene cut short (logout, or another conversation taking the chat): its copy goes, nothing advances. */
  function stop(player, logout = false) {
    const state = playing.get(player);
    if (!state) return;
    playing.delete(player);
    Scenes.cancel(player);
    if (Scenes.get(player)) Scenes.end(player, logout);
    else if (!logout) cutscene(player, false);
    player.getMovementQueue().setBlockMovement(false);
  }

  function sceneEnded(player, scene, logout) {
    if (scene.name === "fight") {
      // A death, a teleport or a logout in the copy: the fight plays again from the stairs.
      fights.delete(player);
      hooks.fightLeft?.(player);
      return;
    }
    const state = playing.get(player);
    cutscene(player, false);
    // Walking out or a logout before the scene's own end: it plays again from the start next time.
    if (state && state.scene === scene && !state.closing) {
      playing.delete(player);
      Scenes.cancel(player);
      player.getMovementQueue().setBlockMovement(false);
    }
    hooks.sceneEnded?.(player, scene, logout);
  }

  // ==========================================================================
  // Tock's ship (held line, ticks 4382-4405)
  // ==========================================================================

  /** Runs on the line's own showing; the line is held 23 ticks (NpcDialogues `holdTicks`). */
  function ship(player) {
    const state = { spec: { name: "ship", steps: [] }, return: player.getLocation().clone() };
    stop(player);
    playing.set(player, state);
    player.getMovementQueue().reset().setBlockMovement(true);
    overlay(player, FADE_OUT_QUICK);
    const later = (ticks, run) => Scenes.later(player, ticks, () => { if (active(player, state)) run(); });
    later(1, () => {
      state.scene = Scenes.open(player, "ship", [[2900, 2940, 3210, 3250, 0]], { canTeleport: () => false, canAttack: () => false });
      Scenes.place(player, [2918, 3231, 0]);
      cutscene(player, true);
    });
    later(2, () => camera(player, [2943, 3224, 800], [2928, 3224, 100]));
    later(3, () => {
      const rates = { rate: 6, rate2: 0 };
      camera(player, [2926, 3224, 800], [2911, 3224, 100], rates, rates);
      overlay(player, FADE_IN);
    });
    later(12, () => lookCamera(player, [2911, 3227, 100], { rate: 1, rate2: 0 }));
    later(21, () => overlay(player, FADE_OUT_QUICK));
    later(22, () => close(player, state));
    later(23, () => {
      overlay(player, FADE_IN);
      finish(player, state);
    });
  }

  // ==========================================================================
  // Colin's mermaid (ticks 5054-5220)
  // ==========================================================================

  const colin = (state) => state.actors.colin;
  const COLIN_SCENE = {
    name: "colin",
    variant: "colin-s-curse-talking-to-colin",
    from: "I was using Ithoi's telescope",
    to: "p6ox6g",
    steps: [
      { say: "I was using Ithoi's telescope", held: 5, events: [
        [0, (p) => overlay(p, FADE_OUT)],
        [2, (p, s) => {
          open(p, s, "colin", { sourceChunk: [313, 353], size: 7 }, [2528, 2841, 1], [[2504, 2559, 2824, 2879, 1]]);
          s.speaker = s.actors.colin = actor(s.scene, COLIN, [2527, 2836, 1], [2531, 2836]);
        }],
        [4, (p) => camera(p, [2527, 2824, 700], [2527, 2839, 350])],
      ] },
      { say: "Such a beautiful night!", events: [[0, (p, s) => {
        Scenes.face(p, [2527, 2836]);
        overlay(p, NIGHT_IN);
        moveCamera(p, [2527, 2828, 700], SLOW);
        p.getPacketSender().sendJingle(244);
      }]] },
      { say: "What lands lie beyond", at: 2, events: [
        [0, (p, s) => stepTo(colin(s), [2528, 2836, 1])],
        [2, (p, s) => { Scenes.face(p, [2528, 2836]); Scenes.face(colin(s), [2528, 2824]); }],
      ] },
      { say: "Eh?", at: 3, events: [
        [0, (p, s) => anim(colin(s), 2171)],
        [3, (p) => camera(p, [2523, 2831, 650], [2540, 2844, 350])],
      ] },
      { say: "What was that?", at: 1, events: [[1, (p, s) => anim(colin(s), 857)]] },
      { say: "Is that what I think it is?", at: 3, events: [
        [0, (p) => moveCamera(p, [2523, 2830, 700], SLOW)],
        [1, (p, s) => { anim(colin(s), 7825); transform(colin(s), COLIN_TELESCOPE); }],
      ] },
      { say: "It's so dark out there", at: 1 },
      { say: "... yes, it's a mermaid!", at: 2, events: [[2, (p, s) => {
        anim(colin(s), 7827);
        transform(colin(s), -1);
        moveCamera(p, [2523, 2831, 650], SLOW);
        p.getPacketSender().sendJingle(103);
      }]] },
      { say: "Hello?", at: 2, events: [
        [1, (p) => camera(p, [2524, 2834, 400], [2540, 2839, 350])],
        [2, (p, s) => anim(colin(s), 863)],
      ] },
      { say: "Can you hear me?", at: 2, events: [[2, (p, s) => anim(colin(s), 864)]] },
      { say: "You're the most lovely person", at: 2, events: [[2, (p, s) => {
        anim(colin(s), 862);
        p.getPacketSender().sendJingle(165);
      }]] },
      { say: "I can see you moving your arms", at: 5, events: [[2, (p, s) => {
        anim(colin(s), 2171);
        camera(p, [2523, 2831, 650], [2540, 2844, 350]);
      }]] },
      { say: "kiss*", at: 6, events: [
        [2, (p, s) => { anim(colin(s), 863); camera(p, [2524, 2834, 400], [2540, 2839, 350]); }],
        [6, (p, s) => { anim(colin(s), 1374); sound(p, 1854, 5); }],
      ] },
      { say: "Hello?", at: 4 },
      { say: "Oh, no, I think she's gone away", at: 6, events: [[3, (p, s) => {
        anim(colin(s), 7825);
        transform(colin(s), COLIN_TELESCOPE);
        camera(p, [2523, 2831, 650], [2540, 2844, 350]);
      }]] },
      { say: "Maybe she doesn't like strangers" },
      { say: "I hope she's not angry", events: [[0, (p) => {
        moveCamera(p, [2516, 2827, 1300], { rate: 2, rate2: 2 });
        overlay(p, NIGHT_OUT);
        p.getPacketSender().sendJingle(265);
      }]] },
      { events: [
        [0, (p) => { overlay(p, FADE_CLEAR); emptyBox(p); }],
        [1, (p, s) => close(p, s)],
        [2, (p) => overlay(p, FADE_IN)],
        [3, (p, s) => { finish(p, s); hooks.colinDone(p, tailAfter(variantSteps(COLIN_SCENE.variant), COLIN_SCENE.to)); }],
      ] },
    ],
  };

  // ==========================================================================
  // Gnocci's doll (ticks 5314-5418)
  // ==========================================================================

  const gnocci = (state) => state.actors.gnocci;
  /** Live plays human_lobster on the player and Gnocci every four ticks while they fish. */
  function lobsters(player, state) {
    if (!active(player, state) || state.caught) return;
    anim(player, 619);
    anim(gnocci(state), 619);
    Scenes.later(player, 4, () => lobsters(player, state));
  }
  const GNOCCI_SCENE = {
    name: "gnocci",
    variant: "gnocci-s-curse-talking-to-gnocci",
    from: "I was fishing...",
    to: "OV-LNe",
    steps: [
      { say: "I was fishing...", held: 5, events: [
        [0, (p) => overlay(p, FADE_OUT)],
        [2, (p, s) => {
          open(p, s, "gnocci", { sourceChunk: [311, 352], size: 6 }, [2500, 2840, 0], [[2488, 2535, 2816, 2863, 0]]);
          s.speaker = s.actors.gnocci = actor(s.scene, GNOCCI_FISHING, [2505, 2836, 0], [2505, 2832]);
        }],
        [4, (p) => camera(p, [2499, 2833, 800], [2505, 2837, 200])],
      ] },
      { say: "Let's see what I can find", events: [
        [0, (p) => {
          Scenes.face(p, [2505, 2836]);
          overlay(p, FADE_IN);
          moveCamera(p, [2503, 2830, 280], { rate: 3, rate2: 3 });
          p.getPacketSender().sendJingle(244);
        }],
        [1, (p, s) => lobsters(p, s)],
      ] },
      { say: "C'mon little lobsters, come to Gnocci!", at: 5 },
      { say: "Obby-lobby" },
      { say: "'obby-lobby' - what?", at: 2, events: [[1, (p) => overlay(p, FADE_OUT_QUICK)]] },
      { say: "It's a traditional lobster-fishing chant" },
      { say: "C'mon little lobsters. We don't want", at: 1, events: [[0, (p) => {
        p.getPacketSender().sendJingle(244);
        overlay(p, FADE_IN);
      }]] },
      { say: "Ooh, what's this?", at: 2, events: [
        [1, (p) => camera(p, [2504, 2841, 220], [2505, 2835, 170])],
        [2, (p, s) => {
          s.caught = true;
          anim(p, 4185);
          anim(gnocci(s), -1);
          transform(gnocci(s), GNOCCI);
        }],
      ] },
      { say: "Looks more like a child's toy", at: 2, events: [
        [0, (p) => moveCamera(p, [2505, 2839, 220], SLOW)],
        [2, (p) => anim(p, 4185, 30)],
      ] },
      { say: "Is it moving?" },
      { say: "She's moving!", held: 8, events: [
        [0, (p, s) => Scenes.face(gnocci(s), [2505, 2841])],
        [1, (p, s) => {
          anim(gnocci(s), 4280);
          p.getPacketSender().sendJingle(243);
          sound(p, 941, 15, 7);
        }],
        [2, (p) => p.getPacketSender().sendClientScript(DOLL_SCRIPT)],
      ] },
      // Gnocci digs as 7972, but the line keeps his 7970 head (tick 5413).
      { say: "I buried Her in the sand", at: 5, held: true, head: GNOCCI, events: [
        [0, (p, s) => {
          const cook = gnocci(s);
          if (cook?.isRegistered?.()) cook.moveTo(Scenes.tileFor(cook, [2505, 2839, 0]));
          transform(cook, GNOCCI_DIGGING);
          Scenes.face(cook, [2504, 2839]);
          camera(p, [2510, 2835, 350], [2504, 2840, 200]);
        }],
        [2, (p, s) => { anim(gnocci(s), 830); sound(p, 1470); }],
        [4, (p, s) => stepTo(gnocci(s), [2507, 2839, 0])],
        [5, (p, s) => stepTo(gnocci(s), [2509, 2839, 0])],
        [6, (p, s) => stepTo(gnocci(s), [2511, 2839, 0])],
        [7, (p, s) => {
          stepTo(gnocci(s), [2513, 2839, 0]);
          p.getPacketSender().sendJingle(265);
          overlay(p, FADE_OUT);
        }],
        [9, (p, s) => close(p, s)],
        [10, (p, s) => {
          overlay(p, FADE_IN);
          finish(p, s);
          hooks.gnocciDone(p, tailAfter(variantSteps(GNOCCI_SCENE.variant), GNOCCI_SCENE.to));
        }],
      ] },
    ],
  };

  // ==========================================================================
  // The telescope (ticks 5917-5940)
  // ==========================================================================

  /**
   * The copy is one sea chunk (2528,2816) tiled 6 x 6, tiles counted on from it: the player at its
   * first tile, Bugs at +22,+33 (his captured tile in the copy). Every copy shares one source, so the
   * capture cannot say which copy the camera stands in: ours is the one south of Bugs, looking north.
   */
  const TELESCOPE_SCENE = {
    name: "telescope",
    steps: [
      { events: [
        [0, (p) => { anim(p, 2171); emptyBox(p); overlay(p, FADE_OUT); }],
        [2, (p, s) => {
          open(p, s, "telescope", { sourceChunk: [316, 352], size: 6, fill: true }, [2528, 2816, 0], [[2528, 2575, 2816, 2863, 0]]);
          s.actors.bugs = actor(s.scene, BUGS, [2550, 2849, 0], [2550, 2848]);
        }],
        [3, (p) => p.getPacketSender().sendJingle(244)],
        [4, (p) => camera(p, [2552, 2845, 400], [2552, 2846, 300])],
        [5, (p) => {
          p.getPacketSender().sendSubInterface(FADE_UID, TELESCOPE_INTERFACE, 1);
          moveCamera(p, [2552, 2842, 400], SLOW);
        }],
        [11, (p) => p.getPacketSender().sendJingle(138)],
        [13, (p, s) => showLine(p, s, { line: s.line, held: true }, () => {})],
        [20, (p) => overlay(p, FADE_CLEAR)],
        [21, (p, s) => close(p, s)],
        [22, (p) => overlay(p, FADE_IN)],
        [23, (p, s) => { finish(p, s); hooks.telescopeDone(p); }],
      ] },
    ],
  };

  /** `line` is the player's line the transcript picks (Bugs named after Big Chompy Bird Hunting). */
  function telescope(player, line) {
    play(player, TELESCOPE_SCENE, { line });
  }

  // ==========================================================================
  // The fire (ticks 6378-6406)
  // ==========================================================================

  const ithoi = (state) => state.actors.ithoi;
  const FIRE_VARIANT = "traitor-in-the-midst-attempting-to-light-the-the-driftwood-after-discovering-ithoi-s-lie";
  function fireOverheads() {
    return variantSteps(FIRE_VARIANT).filter((step) => step.type === "line" && step.presentation === "overhead").map((step) => step.text);
  }
  function fireBox() {
    return variantSteps(FIRE_VARIANT).find((step) => step.type === "message")?.text ?? "";
  }
  /**
   * The Wiki transcript has Ithoi cast Water Strike; the capture draws Water Bolt's graphics (cast 120,
   * projectile 121, impact on the driftwood, sounds 209/210). Ours follows the Wiki: Water Strike's
   * cast 93, projectile 94, impact 95 and sounds 211/212, at the captured ticks.
   */
  const FIRE_SCENE = {
    name: "fire",
    steps: [
      { events: [
        [0, (p) => {
          anim(p, 733);
          p.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
            new ActionDialogue(0, { execute: () => StatementDialogue.send(p, fireBox(), false) }, true)));
        }],
        [2, (p) => {
          hooks.fireLit(p);
          anim(p, -1);
          overlay(p, FADE_OUT_QUICK);
          sound(p, 2596);
        }],
        [3, (p, s) => {
          open(p, s, "fire", { sourceChunk: [313, 352], size: 7 }, [2530, 2841, 1], [[2504, 2559, 2816, 2871, 0], [2504, 2559, 2816, 2871, 1]]);
          s.actors.sick = actor(s.scene, ITHOI_SICK, [2529, 2839, 1]);
        }],
        [4, (p) => emptyBox(p)],
        [5, (p) => { camera(p, [2529, 2835, 200], [2529, 2841, 170]); sound(p, 2066); }],
        [6, (p) => { overlay(p, FADE_IN); moveCamera(p, [2529, 2837, 200], SLOW); }],
        [8, (p, s) => s.actors.sick?.forceChat(fireOverheads()[0] ?? "")],
        [10, (p) => overlay(p, FADE_OUT_QUICK)],
        [11, (p, s) => {
          Scenes.place(p, [2529, 2838, 0]);
          Scenes.face(p, [2531, 2837]);
          Scenes.removeActor(s.scene, s.actors.sick);
        }],
        [12, (p) => camera(p, [2531, 2841, 300], [2531, 2835, 240])],
        [13, (p, s) => {
          s.actors.ithoi = actor(s.scene, ITHOI_RUNNING, [2529, 2833, 0]);
          overlay(p, FADE_IN);
        }],
        [14, (p, s) => stepTo(ithoi(s), [2530, 2833, 0])],
        [15, (p, s) => stepTo(ithoi(s), [2532, 2833, 0])],
        [16, (p, s) => stepTo(ithoi(s), [2532, 2835, 0])],
        [17, (p, s) => stepTo(ithoi(s), [2532, 2836, 0])],
        [20, (p, s) => ithoi(s)?.forceChat(fireOverheads()[1] ?? "")],
        [21, (p, s) => {
          const caster = ithoi(s);
          if (!caster?.isRegistered?.()) return;
          caster.performGraphic(new Graphic(93, 92));
          anim(caster, 711);
          Scenes.face(caster, [2531, 2837]);
          const target = Scenes.tileFor(p, [2530, 2837, 0]);
          // Captured flight: start 51, end 56, angle 8, heights 172 -> 10 (the packet carries them x4).
          p.getPacketSender().sendProjectile(caster.getLocation(), target, 0, 56, 94, 43, 3, null, 51, 8, 64);
          sound(p, 211);
        }],
        [23, (p) => {
          hooks.fireOut(p);
          p.getPacketSender().sendGraphic(new Graphic(95), Scenes.tileFor(p, [2530, 2837, 0]));
          sound(p, 212);
          sound(p, 1148, 10);
        }],
        [23, (p, s) => showLine(p, s, { line: s.line, held: true }, () => {})],
        [24, (p, s) => { stepTo(ithoi(s), [2532, 2835, 0]); moveCamera(p, [2531, 2840, 300], SLOW); }],
        [25, (p, s) => stepTo(ithoi(s), [2532, 2833, 0])],
        [26, (p, s) => { stepTo(ithoi(s), [2529, 2833, 0]); overlay(p, FADE_OUT_QUICK); }],
        [27, (p, s) => { close(p, s, [2529, 2838, 0]); Scenes.face(p, [2530, 2837]); }],
        [28, (p, s) => {
          overlay(p, FADE_IN);
          finish(p, s);
          hooks.fireDone(p, variantSteps(FIRE_VARIANT).slice(-1));
        }],
      ] },
    ],
  };

  function fire(player) {
    const line = sceneLines(FIRE_VARIANT, "Well, I guess that proves")[0];
    play(player, FIRE_SCENE, { line });
  }

  // ==========================================================================
  // Ithoi's fight (ticks 6964-7250)
  // ==========================================================================

  const fights = new Map();

  /** Climbing his stairs at progress 52: a copy of the hut, Ithoi on his bed's tile, attacking. */
  function fight(player) {
    if (fights.has(player)) return;
    const scene = Scenes.open(player, "fight", [[2496, 2559, 2808, 2871, 1], [2496, 2559, 2808, 2871, 0]], {
      // Ours: the Wiki says only that the fight is an instance; teleports and the normal attack rules stand.
      canTeleport: () => null,
      canAttack: () => null,
    }, { instance: { sourceChunk: [312, 351], size: 8 }, at: [2529, 2835, 1], exit: [2532, 2833, 0] });
    const npc = Scenes.actor(scene, ITHOI_FIGHT, [2529, 2839, 1]);
    if (!npc) {
      Scenes.end(player, false);
      return;
    }
    npc.setFlag?.("combat:no-retreat", true);
    fights.set(player, { scene, npc });
    Scenes.later(player, 1, () => { if (npc.isRegistered()) npc.setPositionToFace(player.getLocation()); });
    Scenes.later(player, 3, () => { if (npc.isRegistered() && fights.get(player)?.npc === npc) npc.getCombat().attack(player); });
  }

  function fightOf(player) {
    return fights.get(player) ?? null;
  }

  /** His death: the real hut two ticks after "Awww!", where the player stood in the copy. */
  function fightWon(player) {
    const entry = fights.get(player);
    if (!entry) return;
    Scenes.later(player, 2, () => {
      if (fights.get(player) !== entry) return;
      fights.delete(player);
      hooks.fightWon(player);
      if (Scenes.get(player) === entry.scene) Scenes.end(player, false);
    });
  }

  /** Down the stairs inside the copy: out to their foot on the real map. */
  function leaveFight(player) {
    const entry = fights.get(player);
    if (!entry) return false;
    fights.delete(player);
    Scenes.end(player, false);
    player.moveTo(new Location(2532, 2833, 0));
    return true;
  }

  function fightEnded(player) {
    fights.delete(player);
  }

  // ==========================================================================
  // Entry points
  // ==========================================================================

  /** The scene tables bound to the transcript's words, once (they throw if the transcript moved). */
  let bound = false;
  function ensureBound() {
    if (bound) return;
    bind(COLIN_SCENE, sceneLines(COLIN_SCENE.variant, COLIN_SCENE.from, COLIN_SCENE.to));
    // Gnocci's burial line is the transcript's first after the scene's action: held in the scene, then again after it.
    bind(GNOCCI_SCENE, sceneLines(GNOCCI_SCENE.variant, GNOCCI_SCENE.from));
    bound = true;
  }

  return {
    COLIN_SCENE, GNOCCI_SCENE, TELESCOPE_SCENE, FIRE_SCENE,
    ensureBound,
    ship,
    colin: (player, npcId) => { ensureBound(); play(player, COLIN_SCENE, { npcId }); },
    gnocci: (player, npcId) => { ensureBound(); play(player, GNOCCI_SCENE, { npcId }); },
    telescope,
    fire,
    fight, fightOf, fightWon, leaveFight, fightEnded,
    /** The capture's plain fades, out to black (50 cycles) or back in. */
    fade: (player, way) => overlay(player, way === "out" ? FADE_OUT : FADE_IN),
    /** A player's line without its continue: the dig's, while the doll runs off. */
    heldPlayerLine: (player, text) => showLine(player, {}, { line: { player: true, text }, held: true }, () => {}),
    playing: (player) => playing.get(player)?.spec?.name ?? null,
    scene: (player) => Scenes.get(player),
    stop,
    tailAfter: (variant, anchor) => tailAfter(variantSteps(variant), anchor),
    sceneLines,
  };
};
