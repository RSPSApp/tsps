/**
 * Wanted!'s CommOrb scenes, as live plays them (RSProx capture "Wanted!" of 2026-11-12, rev 242.1,
 * one natural run: Canifis, Draynor Market, Champions' Guild, Brimhaven pub, Dorgesh-Kaan mine,
 * Yanille pub, rune essence mine; ticks below are that recording's).
 *
 * A scan that finds Solus (ticks from the Scan click, S):
 * - S: the player plays seq 2721 with spotanim 454 (height 92) and area sound 1900 (range 5). Every
 *   scan of the hunt does this, found or not.
 * - S+2: the cutscene starts (cutscene_status, minimap off, npc/obj ops hidden, fov_clamp,
 *   draw_distance_max_override, areasounds 56/1, side tabs closed), Solus appears for the owner on
 *   his tile facing the player, the player faces him and the camera looks at him (height 100,
 *   rates 100/100); the first line shows.
 * - Every line until the scene's last is held: no "Click here to continue", the next one comes
 *   six or seven ticks later. The last line is the only one the player continues.
 * - Which scene plays is the chase position's, not the destination's: 1 Solus teleports away,
 *   2 he teleports the player to Camelot, 3 smoke, 4 Flames of Zamorak and a wake-up outside Falador
 *   Castle, 5 the "maiden", 6 a summoned Black Knight, 7 the essence mine instance.
 * - The QH mission varbits move, and the clue item is handed over, on the ticks each scene's table
 *   names (they differ per scene).
 *
 * The finale (ticks from Aubury's Curse, T, capture ticks 4144-4320): fade out at T+1; at T+4 a copy
 * of the mine (live's is turned a quarter; ours is not) with the player on 2910,4830 and Solus
 * (4930) on 2900,4821; Savant's lines and Solus's overhead taunts; fifteen White Rangers at T+69;
 * Ice Barrage kills them at T+81 (their bones stay, the player's own); the cutscene ends at T+87;
 * at T+116 Solus shouts "YOU DIE NOW!", turns into 4962 and attacks. His death hands over the hat,
 * and 15 ticks later the player is back where they cast from.
 *
 * Words are the transcript's (npc-dialogues.json "Wanted!"); heads' animations come from
 * data/chathead-animations.json, which holds this capture's lines.
 */
const { createQuestScenes } = require("../QuestScenes");
const HEAD_ANIMATIONS = require("../data/chathead-animations.json");

const SAVANT_HEAD = 4931; // wanted_savant
const SOLUS_GENERIC = 4930; // wanted_solus
const SOLUS_ATTACKABLE = 4962; // wanted_solus_attackable
const FAKE_WOMAN = 6264; // wanted_solus_fake_woman
const SOLUS_DORGESHUUN = 4941; // wanted_solus3, what the maiden turns into
const WHITE_RANGER = 4961; // wanted_white_ranger
const BLACK_KNIGHT = 4959; // wanted_summoned_black_knight
const BONES = 526;
/** wanted_solusN is 4938 + N for the hunt's mission N (captured: 1, 2, 6, 13, 18; 3 is the maiden's). */
const SOLUS_BASE = 4938;

const SCAN = { anim: 2721, gfx: 454, height: 92, sound: 1900, range: 5 };
const LOOK_RATES = { rate: 100, rate2: 100 };
const FINALE_RATES = { rate: 232, rate2: 100 };

/** Set with cutscene_status for the scene and cleared with it (capture ticks 2451, 2564). */
const SCENE_VARBITS = [["fov_clamp", 1], ["draw_distance_max_override", 1]];
const SCENE_VARPS = [["option_areasounds_override", 56], ["areasounds_override", 1]];

const PLAYER_GROUP = 217;
const OBJECTBOX = 193;
const OBJECTBOX_SET_BUTTONS = 2868;

/** Solus's tile per mission where the capture has it; elsewhere he appears beside the player. */
const SOLUS_TILE = {
  1: [3489, 3478, 0],
  2: [3194, 3361, 0],
  3: [3316, 9612, 0],
  6: [3082, 3249, 0],
  13: [2797, 3162, 0],
  18: [2550, 3082, 0],
};
/** The farthest a fixed tile may be from the scanning player before Solus appears beside them (ours). */
const FIXED_TILE_REACH = 15;
/** Captured Black Knight tile at Yanille (2553,3081, player on 2551,3082); elsewhere the same offset (ours). */
const KNIGHT_TILE = { 18: [2553, 3081, 0] };
const KNIGHT_OFFSET = [2, -1];

const CAMELOT = [2756, 3479, 0];
const FALADOR_CASTLE = [2971, 3338, 0];
const DORGESHUUN_ESCAPE = [[3315, 9613], [3308, 9613], [3307, 9614], [3306, 9614], [3306, 9616], [3305, 9616],
  [3305, 9617], [3304, 9618], [3302, 9618]];

/**
 * One table per chase position. `lines` are the ticks (from the Scan click) of the scene's chat
 * lines and item box, in transcript order; `off` ends the cutscene; `advance` moves the mission
 * varbits; `events` are everything else.
 */
const POSITION_SCENES = {
  1: {
    variant: "approaching-canifis-scanning-in-canifis",
    lines: [2, 9, 15, 29, 35, 41, 47, 53, 59, 65, 71, 77, 83, 87, 94, 101, 108, 115],
    off: 115, advance: 29, look: true,
    events: [
      { t: 22, solusAnim: 714, hold: true },
      { t: 29, removeSolus: true, camReset: true },
    ],
  },
  2: {
    variant: "scanning-the-second-location",
    lines: [2, 9, 15, 22, 29, 36, 43, 59, 66, 73, 80, 86, 93, 97, 101, 108, 115, 121],
    off: 121, advance: 121, look: true,
    events: [
      { t: 36, solusGfx: [345, 0, 0] },
      { t: 43, camReset: true },
      { t: 50, solusGfx: [343, 0, 0], solusAnim: 1818, areaSound: [199, 5] },
      { t: 51, playerAnim: 1816, playerGfx: [342, 0, 92], areaSound: [200, 5] },
      { t: 54, teleport: CAMELOT, playerAnim: -1, removeSolus: true },
    ],
  },
  3: {
    variant: "scanning-at-champion-s-guild",
    lines: [2, 9, 18, 25, 32, 39, 46, 53, 60, 64, 71, 78, 85],
    off: 85, advance: 39, look: true,
    events: [
      { t: 16, solusAnim: 1979, smoke: true, solusSound: [183, 10], hold: true, camReset: true },
      { t: 17, removeSolus: true },
    ],
  },
  4: {
    variant: "scanning-the-fourth-location",
    lines: [2, 9, 15, 21, 28, 35, 42, 51, 58, 65, 72, 79, 86, 93, 100, 107, 114, 121, 128, 135, 145, 149, 156,
      163, 170, 177, 184, 191, 198],
    off: 198, advance: 145, look: true,
    events: [
      { t: 49, playerGfx: [78, 20, 0], solusAnim: 811, sound: [1655, 20], hold: true },
      { t: 50, playerAnim: 2724, flames: true },
      { t: 55, teleport: FALADOR_CASTLE, removeSolus: true, camReset: true, hold: true },
      { t: 57, playerAnim: -1 },
      { t: 142, hold: true },
    ],
  },
  5: {
    variant: "scanning-in-dorgeshuun-mines",
    actor: FAKE_WOMAN,
    lines: [2, 9, 16, 23, 30, 40, 47, 54, 61, 65, 72, 79, 86, 93, 100, 107, 114, 121, 128, 135, 142, 149, 156,
      160, 167, 174, 181],
    off: 156, advance: 156, look: false,
    events: [
      { t: 38, playerAnim: 1156, playerGfx: [245, 0, 124], sound: [2727, 0], solusAnim: -1 },
      { t: 40, transform: SOLUS_DORGESHUUN },
      { t: 48, escape: DORGESHUUN_ESCAPE },
      { t: 65, removeSolus: true },
    ],
  },
  6: {
    variant: "scanning-the-sixth-location",
    /** The knight's "Solus commands you die now!" is his overhead when he appears. */
    overhead: ["Black Knight"],
    lines: [2, 9, 16, 25],
    off: 25, look: true,
    events: [
      { t: 23, solusAnim: 2720 },
      { t: 25, removeSolus: true, camReset: true },
    ],
  },
};

/** After the summoned knight dies (capture tick 4012 = D): item box at D, lines 4-7 ticks apart. */
const KNIGHT_DEAD = { variant: "scanning-the-sixth-location-after-the-black-knight-is-defeated", lines: [0, 4, 11, 18, 25, 32, 39] };

const FINALE = {
  variant: "rune-essence-mine-ending-the-hunt",
  /** A copy of the mine (2880-2943, 4800-4863); live's turns it a quarter (rebuild_region rotation 1). */
  sourceChunk: [360, 600], size: 8,
  bounds: [[2880, 2943, 4800, 4863, 0]],
  at: [2910, 4830, 0],
  solus: [2900, 4821, 0],
  music: 57, // "rune essence"
  /** Chat lines (Savant and the player), ticks from the Curse. */
  lines: [8, 15, 22, 47, 50, 65, 102, 109],
  /** Solus's overheads: live breaks two transcript lines into parts, by word count. */
  says: [[27, 32], [37, 42], [57], [60], [73], [76], [87, 92, 97], [116]],
  /** Words in each part (capture: "Argh! I am so sick of your" / "interference!", ticks 4171-4176). */
  sayWords: { 0: [7, 1], 1: [7, 5], 6: [1, 2, 3] },
  rangers: [
    [2901, 4821], [2900, 4822], [2901, 4822], [2901, 4820], [2900, 4820], [2899, 4820], [2899, 4821], [2898, 4821],
    [2898, 4820], [2902, 4820], [2902, 4822], [2900, 4823], [2899, 4819], [2899, 4822], [2901, 4819],
  ],
  /** The player's moves (capture ticks 4191-4195): two steps, a placement, two steps. */
  playerWalk: { 47: [[2911, 4830], [2911, 4831]], 50: [[2898, 4818]] },
  playerPlace: { 49: [2896, 4816] },
};
const FINALE_DONE = { variant: "rune-essence-mine-ending-the-hunt-after-defeating-solus", lines: [2, 9, 13, 23] };

module.exports = function createWantedScenes(api, hooks) {
  const {
    ActionDialogue, Animation, DialogueChainBuilder, Graphic, HitDamage, HitMask, Item, ItemOnGroundManager, Location,
    NpcDialogue, PlayerDialogue, StatementDialogue,
  } = api.core;
  const { loadTranscripts } = require("../QuestRuntime");
  const { formatPlayerText } = require("../../npcs/NpcDialogues.plugin.js");
  const Scenes = createQuestScenes(api, { onEnd: finaleEnded, recoveryAttribute: "wanted:scene-exit" });
  /** player -> the scene playing. */
  const playing = new Map();

  function variantSteps(variant) {
    const steps = loadTranscripts(api)?.["Wanted!"]?.variants?.[variant];
    if (!Array.isArray(steps)) throw new Error(`Wanted!: no "${variant}" transcript`);
    return steps;
  }

  /**
   * The scene's chat lines in order: lines and item boxes, with the clue condition for `clue`
   * (a QH mission id) taken in place, and a "see Scanning in Canifis" reference replaced by that
   * clue's branch there. Overheads (`overhead` speakers) are left out.
   */
  function sceneLines(variant, clueStep, overhead = []) {
    const out = [];
    const take = (steps) => {
      for (const step of steps) {
        if (step.type === "condition") {
          if (clueStep && step.id === clueStep) take(step.steps ?? []);
          continue;
        }
        if (step.type === "reference") {
          if (clueStep) take(clueBranch(clueStep));
          continue;
        }
        if (step.type === "message") {
          out.push({ box: true, text: step.text });
          continue;
        }
        if (typeof step.player === "string") {
          out.push({ player: true, text: step.player });
          continue;
        }
        if (step.type === "line" && typeof step.text === "string" && !overhead.includes(step.speaker)) {
          out.push({ speaker: step.speaker, text: step.text });
        }
      }
    };
    take(variantSteps(variant));
    return out;
  }

  /** The Canifis scan's clue condition for a mission, by condition id. */
  function clueBranch(conditionId) {
    const condition = variantSteps(POSITION_SCENES[1].variant).find((step) => step.id === conditionId);
    return condition?.steps ?? [];
  }

  function overheads(variant, speakers) {
    return variantSteps(variant).filter((step) => step.type === "line" && speakers.includes(step.speaker)).map((step) => step.text);
  }

  function expression(speaker, text) {
    const normal = String(text).replace(/\s+/g, " ").trim();
    return HEAD_ANIMATIONS[speaker]?.[normal];
  }

  function sendSceneVars(player, on) {
    const sender = player.getPacketSender();
    const cache = api.core.CacheDefinitions;
    for (const [name, value] of SCENE_VARBITS) sender.sendVarbit(cache.getVarbitId(name), on ? value : 0);
    for (const [name, value] of SCENE_VARPS) sender.sendConfig(cache.getVarpId(name), on ? value : 0);
  }

  function cutscene(player, on) {
    Scenes.controls(player, on, true);
    sendSceneVars(player, on);
    if (on) Scenes.hideTabs(player);
    else Scenes.restoreTabs(player);
  }

  /** A chathead line; `last` is continued by the player and runs `done`, the others are held. */
  function showLine(player, state, line, last, done) {
    const text = formatPlayerText(line.text, player);
    const speaker = line.player ? "player" : line.speaker;
    const anim = expression(speaker, line.text);
    const chain = new DialogueChainBuilder();
    if (line.box) {
      const itemId = state.boxItem ?? -1;
      if (last) {
        const { ItemStatementDialogue } = api.core;
        chain.add(new ItemStatementDialogue(0, itemId, text));
        chain.add(new ActionDialogue(1, { execute: () => finishLine(player, done) }));
      } else {
        chain.add(new ActionDialogue(0, { execute: () => {
          player.getPacketSender()
            .sendChatboxInterface(OBJECTBOX)
            .sendClientScript(OBJECTBOX_SET_BUTTONS, "")
            .sendItemOnInterfaces((OBJECTBOX << 16) | 1, itemId, 400)
            .sendString(text, (OBJECTBOX << 16) | 2);
        } }, true));
      }
      player.getDialogueManager().startDialogues(chain);
      return;
    }
    const entry = line.player
      ? new PlayerDialogue(0, text, anim)
      : new NpcDialogue(0, headFor(state, line.speaker), text, line.speaker, anim);
    if (last) {
      chain.add(entry);
      chain.add(new ActionDialogue(1, { execute: () => finishLine(player, done) }));
    } else {
      chain.add(new ActionDialogue(0, { execute: () => {
        if (line.player) {
          entry.send(player);
          const continueUid = (PLAYER_GROUP << 16) | 5;
          player.getPacketSender().sendString("", continueUid).sendInterfaceFlagsRange(continueUid, -1, -1, 0);
        } else {
          entry.sendHeld(player);
        }
      } }, true));
    }
    player.getDialogueManager().startDialogues(chain);
  }

  function finishLine(player, done) {
    player.getPacketSender().sendInterfaceRemoval();
    done?.();
  }

  function headFor(state, speaker) {
    if (speaker === "Savant") return SAVANT_HEAD;
    if (speaker === "Solus") return SOLUS_GENERIC;
    return state.solus?.getNpcTransformationId?.() > 0 ? state.solus.getNpcTransformationId() : state.headId ?? SOLUS_GENERIC;
  }

  function hold(player) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ActionDialogue(0, { execute: () => StatementDialogue.send(player, "", false) }, true)
    ));
  }

  function at(tile) {
    return new Location(tile[0], tile[1], tile[2] ?? 0);
  }

  function near(a, b, reach) {
    return a.getZ() === b.getZ() && Math.abs(a.getX() - b.getX()) <= reach && Math.abs(a.getY() - b.getY()) <= reach;
  }

  function spawn(player, id, tile) {
    const npc = api.spawnNpc({ id, x: tile.getX(), y: tile.getY(), z: tile.getZ(), owner: player, ownerOnly: true, wanderRadius: 0 });
    if (npc) npc.__skipDefaultRespawn = true;
    return npc;
  }

  function removeNpc(npc) {
    if (npc?.isRegistered?.()) api.removeNpc(npc);
  }

  function solusTile(player, mission) {
    const here = player.getLocation();
    const fixed = SOLUS_TILE[mission];
    if (fixed && near(here, at(fixed), FIXED_TILE_REACH)) return at(fixed);
    // Ours: uncaptured destinations put him one tile west of the player.
    return new Location(here.getX() - 1, here.getY(), here.getZ());
  }

  function playScanEffect(player) {
    const location = player.getLocation();
    player.performAnimation(new Animation(SCAN.anim));
    player.performGraphic(new Graphic(SCAN.gfx, 0, SCAN.height));
    player.getPacketSender().sendAreaSound(SCAN.sound, location.getX(), location.getY(), location.getZ(), 1, 0, SCAN.range);
  }

  function active(player) {
    return playing.has(player);
  }

  /**
   * Plays position `position`'s scene for the destination `mission`. `clueStep` is the Canifis
   * scan's condition id for the clue to hand over (positions 1, 3, 5); `boxItem` the item box's item.
   */
  function playScan(player, position, { mission, next, clueStep, boxItem }) {
    const table = POSITION_SCENES[position];
    if (!table || playing.has(player)) return false;
    const lines = sceneLines(table.variant, clueStep, table.overhead);
    if (lines.length !== table.lines.length) {
      throw new Error(`Wanted!: position ${position} has ${lines.length} lines, the timeline ${table.lines.length}`);
    }
    const state = { position, mission, next, lines, table, boxItem, solus: null, headId: null, advanced: false, clued: false, key: {} };
    playing.set(player, state);
    Scenes.later(state.key, 2, () => openScene(player, state));
    for (const [index, tick] of table.lines.entries()) {
      Scenes.later(state.key, tick, () => {
        if (playing.get(player) !== state) return;
        const line = lines[index];
        if (line.box) clue(player, state);
        if (tick === table.advance) advance(player, state);
        if (tick === table.off) cutscene(player, false);
        const last = index === lines.length - 1;
        // Once the last line is up the scene is over, continued or not: a dialogue that replaces
        // it must not leave the CommOrb thinking a scene still plays. Only the continue summons
        // stop 6's knight; without it a rescan replays the scene.
        if (last) finish(player, state);
        showLine(player, state, line, last, () => sceneDone(player, state));
      });
    }
    if (table.advance !== undefined && !table.lines.includes(table.advance)) {
      Scenes.later(state.key, table.advance, () => playing.get(player) === state && advance(player, state));
    }
    for (const event of table.events) Scenes.later(state.key, event.t, () => playing.get(player) === state && run(player, state, event));
    return true;
  }

  function openScene(player, state) {
    if (playing.get(player) !== state) return;
    const { table, mission } = state;
    cutscene(player, true);
    const tile = solusTile(player, mission);
    const id = table.actor ?? SOLUS_BASE + mission;
    state.headId = id;
    state.solus = spawn(player, id, tile);
    state.solus?.setPositionToFace(player.getLocation());
    player.setPositionToFace(tile);
    if (table.look) player.getPacketSender().sendCameraLookAt(tile.getX(), tile.getY(), 100, LOOK_RATES);
  }

  function advance(player, state) {
    if (state.advanced) return;
    state.advanced = true;
    hooks.advance(player, state.position, state.next);
  }

  function clue(player, state) {
    if (state.clued) return;
    state.clued = true;
    hooks.clue(player, state.position, state.next);
  }

  function run(player, state, event) {
    const npc = state.solus;
    const sender = player.getPacketSender();
    const here = player.getLocation();
    if (event.hold) hold(player);
    if (event.solusAnim !== undefined && npc) npc.performAnimation(new Animation(event.solusAnim));
    if (event.solusGfx && npc) npc.performGraphic(new Graphic(...event.solusGfx));
    if (event.playerAnim !== undefined) player.performAnimation(new Animation(event.playerAnim));
    if (event.playerGfx) player.performGraphic(new Graphic(...event.playerGfx));
    if (event.sound) sender.sendSound(event.sound[0], 1, event.sound[1]);
    if (event.areaSound) sender.sendAreaSound(event.areaSound[0], here.getX(), here.getY(), here.getZ(), 1, 0, event.areaSound[1]);
    if (event.solusSound && npc) {
      const from = npc.getLocation();
      sender.sendAreaSound(event.solusSound[0], from.getX(), from.getY(), from.getZ(), 1, 0, event.solusSound[1]);
    }
    // Smoke barrage travel (390): starts 51 cycles in, heights 172/124, as captured (tick 2917).
    if (event.smoke && npc) sender.sendProjectile(npc.getLocation(), here, 0, 46, 390, 43, 31, player, 51, 16, 64);
    if (event.flames) flames(player);
    if (event.transform && npc) {
      npc.setNpcTransformationId(event.transform);
      npc.setPositionToFace(here);
    }
    if (event.escape && npc) {
      npc.getMovementQueue().reset();
      for (const [x, y] of event.escape) npc.getMovementQueue().addSteps(new Location(x, y, here.getZ()));
      npc.setSpawnPosition?.(new Location(...event.escape.at(-1), here.getZ()));
    }
    if (event.camReset) sender.sendCameraReset();
    if (event.teleport) player.moveTo(at(event.teleport));
    if (event.removeSolus) {
      removeNpc(npc);
      state.solus = null;
    }
  }

  /**
   * Flames of Zamorak at the fourth stop: "a high percentage of your current Hitpoints", never
   * fatal (Wiki quick guide). Ours: 85%, rounded up, which is the capture's 59 from 69 (tick 3290).
   */
  function flames(player) {
    const current = player.getHitpoints();
    const damage = Math.max(0, Math.min(current - 1, Math.ceil(current * 0.85)));
    player.addTickHit(player.decrementHealth(new HitDamage(damage, HitMask.RED)));
  }

  function finish(player, state) {
    if (playing.get(player) === state) playing.delete(player);
    state.finished = true;
  }

  function sceneDone(player, state) {
    if (!state.finished || state.done || playing.has(player)) return;
    state.done = true;
    api.core.TaskManager.cancelTasks(state.key);
    if (state.position === 6) {
      // The knight comes on the continue's next tick (capture ticks 3978-3979).
      Scenes.later(player, 1, () => summonKnight(player, state));
      return;
    }
    hooks.ended?.(player, state.position);
  }

  function summonKnight(player, state) {
    if (player.isRegistered?.() === false) return;
    const here = player.getLocation();
    const fixed = KNIGHT_TILE[state.mission];
    const tile = fixed && near(here, at(fixed), FIXED_TILE_REACH) ? at(fixed)
      : new Location(here.getX() + KNIGHT_OFFSET[0], here.getY() + KNIGHT_OFFSET[1], here.getZ());
    const knight = spawn(player, BLACK_KNIGHT, tile);
    if (!knight) return;
    const [say] = overheads(POSITION_SCENES[6].variant, ["Black Knight"]);
    if (say) knight.forceChat(formatPlayerText(say, player));
    knight.setPositionToFace(here);
    player.setPositionToFace(tile);
    player.getPacketSender()
      .sendGraphic(new Graphic(86, 0, 0), tile)
      .sendAreaSound(1930, tile.getX(), tile.getY(), tile.getZ(), 1, 0, 10)
      .sendEntityHint(knight);
    Scenes.later(knight, 1, () => knight.isRegistered?.() && knight.getCombat().attack(player));
    watchKnight(player, knight);
    hooks.knight?.(player, knight);
  }

  /**
   * The Wiki: "It is not necessary to kill the Black Knight; you can simply run away." What live
   * does then is uncaptured; ours: the knight goes once its owner is gone or more than 16 tiles away, and
   * a rescan at the stop summons a new one.
   */
  function watchKnight(player, knight) {
    Scenes.later(knight, 5, () => {
      if (!knight.isRegistered?.()) return;
      if (player.isRegistered?.() === false || !near(player.getLocation(), knight.getLocation(), 16)) {
        removeNpc(knight);
        return;
      }
      watchKnight(player, knight);
    });
  }

  /** The summoned knight's death: the clue box, the mission varbits and Savant's results. */
  function knightDefeated(player, boxItem, next) {
    if (playing.has(player)) return;
    player.getPacketSender().sendEntityHintRemoval?.(false);
    const lines = sceneLines(KNIGHT_DEAD.variant);
    const state = { position: 6, next, lines, boxItem, key: {}, advanced: false, clued: false, tail: true };
    playing.set(player, state);
    for (const [index, tick] of KNIGHT_DEAD.lines.entries()) {
      const show = () => {
        if (playing.get(player) !== state) return;
        if (lines[index].box) {
          clue(player, state);
          advance(player, state);
        }
        const last = index === lines.length - 1;
        if (last) finish(player, state);
        showLine(player, state, lines[index], last, () => hooks.ended?.(player, 6));
      };
      if (tick === 0) show();
      else Scenes.later(state.key, tick, show);
    }
  }

  // ==========================================================================
  // The finale
  // ==========================================================================

  /** Aubury's (or any mine wizard's) teleport takes the player into the finale instead. */
  function claimEssenceTeleport(event, exit) {
    const { player } = event;
    if (playing.has(player)) return false;
    event.steps = { ...(event.steps ?? {}), 1: () => Scenes.fade(player, true) };
    event.land = () => openFinale(player, exit);
    return true;
  }

  function openFinale(player, exit) {
    const steps = variantSteps(FINALE.variant);
    const lines = sceneLines(FINALE.variant, null, ["Solus Dellagar", "Solus"]);
    const says = overheads(FINALE.variant, ["Solus Dellagar", "Solus"]);
    if (lines.length !== FINALE.lines.length || says.length !== FINALE.says.length || !steps.length) {
      throw new Error("Wanted!: the essence mine transcript no longer fits its timeline");
    }
    const state = { position: 7, finale: true, lines, key: null, solus: null, rangers: [], exit, advanced: false };
    const scene = Scenes.open(player, "wanted-finale", FINALE.bounds, { musicTrack: FINALE.music, canTeleport: () => false }, {
      instance: { sourceChunk: FINALE.sourceChunk, size: FINALE.size }, at: FINALE.at, exit,
    });
    state.scene = scene;
    state.key = scene;
    playing.set(player, state);
    cutscene(player, true);
    state.solus = Scenes.actor(scene, SOLUS_GENERIC, FINALE.solus, [FINALE.solus[0], FINALE.solus[1] - 1]);
    // Ticks from the Curse; the instance is T+4.
    const later = (tick, callback) => Scenes.later(scene, tick - 4, () => playing.get(player) === state && callback());
    later(6, () => {
      Scenes.face(player, [FINALE.solus[0], FINALE.solus[1]]);
      state.solus?.setPositionToFace(player.getLocation());
      Scenes.camera(player, [2908, 4828, 450], [2900, 4821, 10], FINALE_RATES);
    });
    later(7, () => Scenes.fade(player, false));
    later(8, () => {
      const move = Scenes.tileFor(player, [2897, 4817, 0]);
      player.getPacketSender().sendCameraMoveTo(move.getX(), move.getY(), 300, { rate: 3, rate2: 3 });
    });
    later(47, () => {
      const move = Scenes.tileFor(player, [2911, 4831, 0]);
      player.getPacketSender().sendCameraMoveTo(move.getX(), move.getY(), 500, { rate: 10, rate2: 10 });
    });
    for (const [tick, tile] of Object.entries(FINALE.playerPlace)) later(Number(tick), () => Scenes.place(player, [...tile, 0]));
    for (const [tick, steps] of Object.entries(FINALE.playerWalk)) {
      later(Number(tick), () => {
        player.getMovementQueue().setBlockMovement(false);
        for (const step of steps) Scenes.walk(player, [...step, 0]);
      });
    }
    later(53, () => player.getMovementQueue().setBlockMovement(true));
    for (const [index, tick] of FINALE.lines.entries()) later(tick, () => showLine(player, state, lines[index], false));
    for (const [index, ticks] of FINALE.says.entries()) {
      const parts = sayParts(says[index], FINALE.sayWords[index]);
      ticks.forEach((tick, part) => later(tick, () => state.solus?.forceChat(formatPlayerText(parts[part], player))));
    }
    later(37, () => {
      state.solus?.performGraphic(new Graphic(247, 0, 0));
      state.solus?.performAnimation(new Animation(811));
      solusAreaSound(player, state, 1651, 10);
    });
    later(69, () => {
      player.getPacketSender().sendSound(1930, 1, 0).sendSound(1930, 1, 0);
      for (const [x, y] of FINALE.rangers) state.rangers.push(Scenes.actor(scene, WHITE_RANGER, [x, y, 0], FINALE.solus));
    });
    later(81, () => {
      state.solus?.performAnimation(new Animation(1979));
      solusAreaSound(player, state, 171, 10);
      for (const [x, y] of FINALE.rangers) {
        const tile = Scenes.tileFor(player, [x, y, 0]);
        player.getPacketSender().sendGraphic(new Graphic(369, 0, 0), tile)
          .sendAreaSound(168, tile.getX(), tile.getY(), 0, 1, 0, 10);
      }
    });
    later(82, () => {
      for (const ranger of state.rangers) ranger?.showHitsplat?.(70, { mine: 17, others: 17 }, { current: 0, max: 70 });
    });
    later(83, () => { for (const ranger of state.rangers) ranger?.performAnimation(new Animation(836)); });
    // Live sends the bones with the barrage, revealed 100 client cycles later (tick 4225).
    later(84, () => {
      for (const [x, y] of FINALE.rangers) {
        ItemOnGroundManager.registerLocation(player, new Item(BONES, 1), Scenes.tileFor(player, [x, y, 0]), scene.area, { goesGlobal: false });
      }
    });
    later(85, () => {
      for (const ranger of state.rangers.splice(0)) if (ranger) Scenes.removeActor(scene, ranger);
    });
    later(87, () => {
      player.getPacketSender().sendInterfaceRemoval();
      cutscene(player, false);
      player.getPacketSender().sendCameraUnlock(false).sendCameraReset();
      Scenes.camera(player, [2898, 4818, 300], [2900, 4821, 30], FINALE_RATES);
    });
    later(116, () => {
      player.getPacketSender().sendInterfaceRemoval().sendCameraReset();
      const solus = state.solus;
      if (!solus) return;
      solus.setNpcTransformationId(SOLUS_ATTACKABLE);
      const definition = solus.getCurrentDefinition?.();
      if (definition?.getHitpoints?.()) solus.setHitpoints(definition.getHitpoints());
      hooks.fight?.(player, solus);
      Scenes.later(scene, 1, () => solus.isRegistered?.() && solus.getCombat().attack(player));
    });
  }

  function sayParts(text, words) {
    if (!words) return [text];
    const all = String(text).split(" ");
    const parts = [];
    let start = 0;
    for (const count of words) {
      parts.push(all.slice(start, start + count).join(" "));
      start += count;
    }
    return parts;
  }

  function solusAreaSound(player, state, sound, range) {
    const from = state.solus?.getLocation();
    if (from) player.getPacketSender().sendAreaSound(sound, from.getX(), from.getY(), from.getZ(), 1, 0, range);
  }

  /** Solus died (capture tick 4297 = K): the hat and Savant's farewell, then home. */
  function finaleWon(player) {
    const state = playing.get(player);
    if (!state?.finale || state.won) return;
    state.won = true;
    state.solus = null;
    const lines = sceneLines(FINALE_DONE.variant);
    const scene = state.scene;
    const later = (tick, callback) => Scenes.later(scene, tick, () => playing.get(player) === state && callback());
    later(2, () => {
      advance(player, state);
    });
    for (const [index, tick] of FINALE_DONE.lines.entries()) {
      if (index === lines.length - 1) continue;
      later(tick, () => showLine(player, state, lines[index], false));
    }
    later(13, () => Scenes.fade(player, true));
    later(17, () => {
      state.leaving = true;
      const exit = state.exit;
      Scenes.end(player, false);
      player.moveTo(at(exit));
      Scenes.later(player, 5, () => Scenes.fade(player, false));
      Scenes.later(player, 6, () => {
        playing.delete(player);
        showLine(player, state, lines[lines.length - 1], true, () => hooks.ended?.(player, 7));
      });
    });
  }

  function finaleEnded(player, scene, logout) {
    const state = playing.get(player);
    if (!state?.finale || state.leaving) return;
    // Left early (a death, a logout): the hunt stays on the mine; the next teleport plays it again,
    // unless Solus was already beaten, which hands over what is left.
    playing.delete(player);
    if (state.won) advance(player, state);
    if (!logout) {
      Scenes.closeFade(player);
      player.getDialogueManager().reset?.();
      player.getPacketSender().sendInterfaceRemoval();
    }
  }

  /** A logout or death mid-scene: whatever the scene had not yet done of its trail work is done now. */
  function abort(player) {
    const state = playing.get(player);
    if (!state) return;
    // The finale's instance ends itself on a logout or a death (finaleEnded).
    if (state.finale) return;
    playing.delete(player);
    api.core.TaskManager.cancelTasks(state.key);
    if (state.solus) removeNpc(state.solus);
    if (state.advanced || state.clued) {
      clue(player, state);
      advance(player, state);
    }
    if (!state.tail && state.table && player.isRegistered?.() !== false) {
      cutscene(player, false);
      player.getPacketSender().sendCameraReset();
    }
  }

  return {
    playScan, playScanEffect, knightDefeated, claimEssenceTeleport, finaleWon, active, abort,
    isFinale: (player) => playing.get(player)?.finale === true,
  };
};

module.exports.POSITION_SCENES = POSITION_SCENES;
module.exports.FINALE = FINALE;
module.exports.KNIGHT_DEAD = KNIGHT_DEAD;
module.exports.FINALE_DONE = FINALE_DONE;
