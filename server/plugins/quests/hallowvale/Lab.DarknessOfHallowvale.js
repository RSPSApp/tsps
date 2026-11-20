/**
 * Darkness of Hallowvale: Lab (stages 250-320 and after; see ../quests/DarknessOfHallowvale.Quest.js
 * for the unit map).
 *
 * Sarius' message, the portrait's key, the sketches' hand-in, the laboratory behind the tapestry and
 * the statue, the Haemalchemy book, the sealed message and the completion, as the live capture
 * (revision 242, t7057-7796) plays them:
 * - A knife on the fireplace's loose tile (18039): human_pickupfloor and pick, the message in the
 *   inventory and its objectbox, 250 -> 260 on that tick (t7070), before the sketches are given.
 * - A knife on the portrait (multiloc 18126): human_knife_slash and m3_slash on the click, a tick
 *   later varbit 2595 0 -> 1 -> 2, the key and its objectbox (t7078-7079).
 * - Safalaan (6160, multinpc 3775): the sketches go with an objectbox_double (9646 + 9647) and
 *   myq3_sketches_given 2575 = 1, the stage stays (t7239); holding the message, the talk runs on into
 *   "Ah yes. I have it here." and "You show the message to Safalaan." with 2576 = 1 and 270 (t7252).
 * - A knife on the tapestry (18125): busy, two ticks on the slash, three ticks on 270 -> 280, 2594 = 1
 *   and the knife's objectbox (t7405-7408). The slashed tapestry is walked through, one step (t7412).
 * - The key on the statue (18127): human_pickuptable and m3_place_key on the click, two ticks on
 *   280 -> 290, 2596 = 1, the key gone and a messagebox (t7417-7419).
 * - The laboratory door (18047): the first opening sets 290 -> 300 (t7426); each opening walks the
 *   player across, shows the inviswall and the open door for two ticks with iron_door_open (t7426-7429,
 *   from inside t7479-7481), at any later stage too.
 * - The stairs (18049/18050): a fade, the climb and the landing tiles live used, (3637, 9695) and
 *   (3643, 3306) (t7430-7436, t7466-7474). The book is a ground spawn taken with Telekinetic Grab; the
 *   stage does not move (t7457).
 * - Safalaan with the book: the book is shown and kept (t7594); on "Safalaan teaches you..." it becomes
 *   the sealed message in its slot and 300 -> 310 (t7644).
 * - Veliaf (8277, multinpc 9489): "You show the message to Veliaf." (t7741); on the continue after
 *   "...here's a little something..." the quest completes, the tome takes the message's slot and
 *   ramble_npcs_visible 3412 = 1 (t7755).
 */
module.exports = function attachLab(context) {
  const { api, state, common, STAGE, VARBIT, PAGE } = context;
  const { ItemIdentifiers: I, Location, Item, HitDamage, HitMask } = api.core;
  const { loadTranscripts, giveReward } = require("../QuestRuntime");

  // --- Ids (cache gamevals)

  const FIREPLACE = 18039; // myq3_fireplace_loose_tile ("Fireplace")
  const PORTRAIT = 18126; // myq3_statue_painting_multi (2595: 18042 / 18043 / 18044 "Portrait")
  const TAPESTRY = 18125; // myq3_lab_tapestry_multi (2594: 18040 "Tapestry" / 18041 "Slashed tapestry")
  const STATUE = 18127; // myq3_lab_vamp_statue_multi (2596: 18045 "Vampyre statue" / 18046 "Statue with key")
  const LAB_DOOR = 18047; // myq3_laboratory_door_closed
  const LAB_DOOR_OPEN = 18048; // myq3_laboratory_door_inactive
  const INVISWALL = 38848; // inviswall
  const STAIRS_DOWN = 18049; // myq3_lab_stairs_down
  const STAIRS_UP = 18050; // myq3_lab_stairs_up
  const RUNE_CASE = 18052; // "Broken rune case"

  const KNIFE = I.KNIFE; // 946
  const SICKLES = [I.SILVER_SICKLE, I.SILVER_SICKLE_B_]; // 2961, 2963
  const SKETCHES = [9646, 9647, 9648]; // myq3_castle_sketch_1..3 ("Castle sketch 1-3")
  const SARIUS_MESSAGE = 9649; // myq3_sarius_message ("Message")
  const ORNATE_KEY = 9651; // myq3_lab_ornate_key ("Large ornate key")
  const HAEMALCHEMY = 9652; // myq3_haemalchemy_vol_1
  const SEALED_MESSAGE = 9653; // "Sealed message"
  /** myq3_xp_tome_3 / _2 / _1: Tome of Experience (3), (2), (1). */
  const TOMES = [9656, 9657, 9658];
  const RUNE_CASE_RUNES = [[I.LAW_RUNE, 1], [I.FIRE_RUNE, 3], [I.AIR_RUNE, 3], [I.WATER_RUNE, 1], [I.MIND_RUNE, 1]];

  /** Safalaan as the page's speakers (the hideout's 6160 shows as 3775). */
  const SAFALAAN_IDS = new Set([3775, 8216, 8217, 8218, 8219]);
  /** Veliaf as this quest has him: the page's speakers and the Burgh hideout's 8277 (seen as 9489). */
  const VELIAF_IDS = new Set([989, 5048, 15879, 15885, 9489, 9521, 9522, 9523, 9524, 9525, 9526, 9527, 9528, 9529, 9621]);

  const RAMBLE_NPCS_VISIBLE = 3412; // ramble_npcs_visible (varp 983), 1 from the completion (t7755)
  const BUSY = 12393; // busy

  // --- Live's animations, sounds and timings (capture ticks)

  const PICKUP_FLOOR = 827; // human_pickupfloor
  const PICK_SOUND = 2581; // pick (the fireplace, t7070)
  const KNIFE_SLASH = 3747; // human_knife_slash
  const SLASH_SOUND = 1721; // m3_slash
  const PICKUP_TABLE = 832; // human_pickuptable
  const PLACE_KEY_SOUND = 1717; // m3_place_key
  const STATUE_TICKS = 2; // t7417 -> t7419
  const TAPESTRY_SLASH_TICKS = 2; // t7405 -> t7407
  const TAPESTRY_BOX_TICKS = 3; // t7405 -> t7408
  const IRON_DOOR_OPEN = 71; // iron_door_open
  const DOOR_OPEN_TICKS = 2; // the open door stands two ticks (t7427 -> t7429)
  const REACH_FOR_LADDER = 828; // human_reachforladder
  const DOWN_STAIRS_SOUND = 1952; // down_stone_stairs
  const UP_STAIRS_SOUND = 1956; // up_stone_stairs
  const STAIRS_SOUND_DELAY = 10;
  const FADE_UID = (161 << 16) | 1;
  const FADE_INTERFACE = 174;
  const FADE_SCRIPT = 948;

  /** The tapestry's tile and the step through it (t7412 north, t7485 south). */
  const TAPESTRY_TILE = [3638, 3304, 0];
  const TAPESTRY_INSIDE = [3638, 3305, 0];
  /** The door's east edge: (3641, 3307) outside, (3642, 3307) inside (t7426-7427, t7479). */
  const DOOR_OUTSIDE = [3641, 3307, 0];
  const DOOR_INSIDE = [3642, 3307, 0];
  /** Landings live used (t7435, t7470). */
  const LAB_LANDING = [3637, 9695, 0];
  const LAB_SURFACE = [3643, 3306, 0];

  /** Chapters read so far (0-3): Veliaf replaces a lost tome at the charge it had, and none after all three. */
  const TOME_CHAPTERS_ATTRIBUTE = "darkness-of-hallowvale:tome-chapters";
  // Wiki (Tome of Experience (Darkness of Hallowvale)): three chapters of 2,000 XP, each in a skill of level 30 or more.
  const TOME_CHAPTER_XP = 2000;
  const TOME_MIN_LEVEL = 30;

  const IGNORE_CLIPPING_FLAG = api.core.MovementQueue?.IGNORE_CLIPPING_FLAG ?? "movement:ignore-clipping";

  const VARIANT = {
    fireplaceLook: "in-search-of-statuesque-evil-obtaining-the-message-left-by-sarius-guile-looking-at-the-fireplace-across-from-the-portrait",
    fireplaceLookOpened: "in-search-of-statuesque-evil-obtaining-the-message-left-by-sarius-guile-looking-at-the-fireplace-while-having-the-message",
    fireplaceKnife: "in-search-of-statuesque-evil-obtaining-the-message-left-by-sarius-guile-using-a-knife-on-the-fireplace",
    fireplaceKnifeAgain: "in-search-of-statuesque-evil-obtaining-the-message-left-by-sarius-guile-using-a-knife-on-the-fireplace-while-having-the-message",
    fireplaceSickle: "in-search-of-statuesque-evil-obtaining-the-message-left-by-sarius-guile-using-a-silver-sickle-or-silver-sickle-b-on-the-fireplace",
    fireplaceSickleAgain: "in-search-of-statuesque-evil-obtaining-the-message-left-by-sarius-guile-using-a-silver-sickle-or-silver-sickle-b-on-the-fireplace-while-having-the-message",
    portraitInspect: "in-search-of-statuesque-evil-obtaining-the-key-left-by-mauritys-guile-inspecting-the-portrait",
    portraitKnife: "in-search-of-statuesque-evil-obtaining-the-key-left-by-mauritys-guile-using-a-knife-on-the-portrait",
    portraitSickle: "in-search-of-statuesque-evil-obtaining-the-key-left-by-mauritys-guile-using-a-silver-sickle-or-silver-sickle-b-on-the-portrait",
    portraitSlashed: "in-search-of-statuesque-evil-obtaining-the-key-left-by-mauritys-guile-using-a-knife-or-sickle-on-the-portrait-after-slashing-it",
    portraitEmpty: "in-search-of-statuesque-evil-obtaining-the-key-left-by-mauritys-guile-inspecting-the-slashed-portrait-while-having-the-key",
    portraitKey: "in-search-of-statuesque-evil-obtaining-the-key-left-by-mauritys-guile-inspecting-the-slashed-portrait-without-having-the-key",
    allSketches: "close-encounters-with-vyre-kind-talking-to-safalaan-hallow-with-all-three-sketches",
    someSketches: "close-encounters-with-vyre-kind-talking-to-safalaan-hallow-after-completing-at-least-one-sketch",
    sketchesGiven: "in-search-of-statuesque-evil-talking-to-safalaan-hallow-after-handing-in-the-sketches",
    withMessage: "in-search-of-statuesque-evil-talking-to-safalaan-hallow-with-the-message",
    messageShown: "in-search-of-statuesque-evil-talking-to-safalaan-hallow-again-after-showing-him-the-message",
    messageOnSafalaan: "in-search-of-statuesque-evil-using-the-message-on-safalaan-hallow-after-showing-him-the-message",
    tapestryEarly: "keys-to-the-myreque-attempting-to-slash-the-tapestry-guarding-the-entrance-to-the-laboratory",
    tapestrySlash: "in-search-of-statuesque-evil-gaining-access-to-the-meiyerditch-laboratories-slashing-the-tapestry",
    doorLocked: "in-search-of-statuesque-evil-gaining-access-to-the-meiyerditch-laboratories-attempting-to-open-the-inner-door",
    keyOnDoor: "in-search-of-statuesque-evil-gaining-access-to-the-meiyerditch-laboratories-using-the-large-ornate-key-on-the-inner-door",
    statueInspect: "in-search-of-statuesque-evil-gaining-access-to-the-meiyerditch-laboratories-inspecting-the-vampyre-statue",
    statueKey: "in-search-of-statuesque-evil-gaining-access-to-the-meiyerditch-laboratories-using-the-large-ornate-key-on-the-vampyre-statue",
    statueKeyed: "in-search-of-statuesque-evil-gaining-access-to-the-meiyerditch-laboratories-inspecting-the-vampyre-statue-after-placing-the-key",
    labFound: "in-search-of-statuesque-evil-talking-to-safalaan-hallow-after-finding-the-laboratory",
    runeCase: "in-search-of-statuesque-evil-searching-the-broken-rune-case",
    runeCaseEmpty: "in-search-of-statuesque-evil-searching-the-broken-rune-case-again",
    readBook: "in-search-of-statuesque-evil-attempting-to-read-haemalchemy-volume-1",
    withBook: "in-search-of-statuesque-evil-talking-to-safalaan-hallow-with-the-haemalchemy-book",
    sealedHeld: "in-search-of-statuesque-evil-talking-to-safalaan-hallow-after-receiving-the-sealed-message",
    sealedLost: "in-search-of-statuesque-evil-talking-to-safalaan-hallow-after-losing-the-sealed-message",
    readSealed: "in-search-of-statuesque-evil-attempting-to-read-the-sealed-message",
    veliafWith: "in-search-of-statuesque-evil-talking-to-veliaf-hurtz-with-the-message-from-safalaan-hallow",
    veliafWithout: "in-search-of-statuesque-evil-talking-to-veliaf-hurtz-without-the-message-from-safalaan-hallow",
    veliafAfter: "post-quest-talking-to-veliaf-hurtz-after-finishing-the-quest",
  };

  /** Transcript step ids this unit answers. */
  const STEP = {
    giveSketches: "1Dbdsx", // "You give the sketches to Safalaan."
    giveSketchesAction: "3RdQ7u",
    showMessage: "fKY8Zv", // "You show the message to Safalaan."
    showMessageAgain: "wL973V", // the message used on Safalaan again
    showBook: "Rqdnge", // "You show the book on haemalchemy to Safalaan..."
    giveBookAction: "3QAxxe",
    sealedMessage: "MTZPyb", // "Safalaan teaches you how to unlock the doors..."
    sealedMessageAction: "lzpy1g",
    newSealedMessage: "nvMPrA", // "Safalaan gives you a sealed message..."
    showVeliaf: "Yop1nq", // "You show the message to Veliaf."
    complete: "xIJysR",
    tomeLost: "1VQDP4",
    tomeGiven: "DnjVLC",
  };

  const stage = (player) => state.stage(player);
  const atLeast = (player, value) => stage(player) >= value;
  const complete = (player) => atLeast(player, STAGE.COMPLETE);
  const tileOf = ([x, y, z]) => new Location(x, y, z);

  // --- Transcript words (for the boxes this unit sends itself)

  function findStep(steps, id) {
    for (const step of steps ?? []) {
      if (!step || typeof step !== "object") continue;
      if (step.id === id) return step;
      const nested = findStep(step.steps, id)
        ?? (step.options ?? []).reduce((found, option) => found ?? findStep(option.steps, id), null);
      if (nested) return nested;
    }
    return null;
  }

  const variantSteps = (variant) => loadTranscripts(api)?.[PAGE]?.variants?.[variant] ?? [];

  /** The text of a variant's only (or first) message step. */
  function words(variant, id) {
    const steps = variantSteps(variant);
    const step = id ? findStep(steps, id) : steps.find((entry) => entry?.type === "message");
    return String(step?.text ?? "");
  }

  // --- Small helpers

  const giveItem = (player, itemId) => giveReward(player, itemId, 1);

  function deleteAll(player, itemId) {
    const inventory = player.getInventory();
    const amount = inventory.getAmount(itemId);
    if (amount > 0) inventory.deleteNumber(itemId, amount);
  }

  function fade(player, out) {
    return player.getPacketSender().mountSubInterface(FADE_UID, FADE_INTERFACE, 1, {
      postScripts: [{ scriptId: FADE_SCRIPT, args: out ? [0, 255, 0, 0, 50] : [0, 0, 0, 255, 50] }],
    });
  }

  const busy = (player, on) => player.getPacketSender().sendVarbit(BUSY, on ? 1 : 0);

  /** Players stepping across the tapestry or the door: whether they had the clipping flag before. */
  const steppingThrough = new WeakMap();

  function endStep(player) {
    if (!steppingThrough.has(player)) return;
    if (!steppingThrough.get(player)) player.removeFlag?.(IGNORE_CLIPPING_FLAG);
    steppingThrough.delete(player);
  }

  /**
   * Walks the player over tiles their map blocks (the tapestry's and the door's edges), one tile a
   * step; collision comes back once the last tile is reached or the walk stops, as Doors' walkOverGate.
   */
  function stepAcross(player, tiles) {
    endStep(player);
    steppingThrough.set(player, player.hasFlag?.(IGNORE_CLIPPING_FLAG) === true);
    player.setFlag?.(IGNORE_CLIPPING_FLAG, true);
    const queue = player.getMovementQueue();
    // Live walks these steps, one tile a tick (t7426-7427), whatever the run setting.
    queue.setClickRunOverride?.(false);
    queue.reset();
    for (const tile of tiles) queue.addSteps(tileOf(tile));
    const [x, y] = tiles[tiles.length - 1];
    let left = tiles.length + 2;
    const task = new api.core.Task(1, false);
    task.execute = () => {
      const here = player.getLocation();
      const arrived = here.getX() === x && here.getY() === y;
      if (arrived || --left <= 0 || (queue.size?.() ?? 0) === 0 || player.isRegistered?.() === false) {
        task.stop();
        endStep(player);
      }
    };
    api.core.TaskManager.submit(task);
  }

  // --- The fireplace (t7057-7072)

  /** A knife on the loose tile: the message, its box and 250 -> 260 on one tick (t7070). */
  function knifeOnFireplace(event) {
    const { player, objectId } = event;
    if (objectId !== FIREPLACE || !state.within(player, STAGE.SARIUS_TALKED, STAGE.LAB_OPENED)) return false;
    // Ours: the tile already levered (260 on) gives a lost message again, as a fresh find.
    if (common.held(player, SARIUS_MESSAGE)) {
      common.mesbox(player, words(VARIANT.fireplaceKnifeAgain));
      return true;
    }
    common.anim(player, PICKUP_FLOOR);
    common.sound(player, PICK_SOUND);
    state.advance(player, STAGE.FIREPLACE_OPENED);
    giveItem(player, SARIUS_MESSAGE);
    common.itemBox(player, SARIUS_MESSAGE, words(VARIANT.fireplaceKnife, "_PqnRK"));
    return true;
  }

  /** "Your sickle is the wrong shape..." (Wiki); Ours: as a messagebox. */
  function sickleOnFireplace(event) {
    const { player, objectId } = event;
    if (objectId !== FIREPLACE || !atLeast(player, STAGE.SARIUS_TALKED) || complete(player)) return false;
    const opened = atLeast(player, STAGE.FIREPLACE_OPENED);
    common.mesbox(player, words(opened ? VARIANT.fireplaceSickleAgain : VARIANT.fireplaceSickle));
    return true;
  }

  /** Look-at (not captured: live's t7057 click was walked away from). Ours: a messagebox. */
  function lookAtFireplace(event) {
    const { player, objectId } = event;
    if (objectId !== FIREPLACE || !atLeast(player, STAGE.SARIUS_TALKED)) return false;
    const opened = atLeast(player, STAGE.FIREPLACE_OPENED) || common.held(player, SARIUS_MESSAGE);
    common.mesbox(player, words(opened ? VARIANT.fireplaceLookOpened : VARIANT.fireplaceLook));
    return true;
  }

  // --- The portrait (t7078-7082)

  /** The slash on the click, then 2595 0 -> 1 -> 2, the key and its objectbox a tick later (t7079). */
  function knifeOnPortrait(event) {
    const { player, objectId } = event;
    if (objectId !== PORTRAIT || !atLeast(player, STAGE.SARIUS_TALKED)) return false;
    if (state.get(player, VARBIT.PORTRAIT) !== 0) {
      common.mesbox(player, words(VARIANT.portraitSlashed)); // Ours: a messagebox
      return true;
    }
    common.anim(player, KNIFE_SLASH);
    common.sound(player, SLASH_SOUND);
    common.later(player, 1, slashPortrait);
    return true;
  }

  function slashPortrait(player) {
    if (state.get(player, VARBIT.PORTRAIT) !== 0) return;
    state.set(player, VARBIT.PORTRAIT, 1);
    state.set(player, VARBIT.PORTRAIT, 2);
    giveItem(player, ORNATE_KEY);
    common.itemBox(player, ORNATE_KEY, words(VARIANT.portraitKnife, "1UyE4K"));
  }

  function sickleOnPortrait(event) {
    const { player, objectId } = event;
    if (objectId !== PORTRAIT || !atLeast(player, STAGE.SARIUS_TALKED)) return false;
    const slashed = state.get(player, VARBIT.PORTRAIT) !== 0;
    common.mesbox(player, words(slashed ? VARIANT.portraitSlashed : VARIANT.portraitSickle)); // Ours: messageboxes
    return true;
  }

  /**
   * Inspect (not captured; Ours: messageboxes). A slashed portrait gives a lost key back while the
   * statue does not hold it ("There's a large ornate key hidden inside the painting. You take it.").
   */
  function inspectPortrait(event) {
    const { player, objectId } = event;
    if (objectId !== PORTRAIT) return false;
    const painting = state.get(player, VARBIT.PORTRAIT);
    if (painting === 0) {
      common.mesbox(player, words(VARIANT.portraitInspect));
      return true;
    }
    if (!common.held(player, ORNATE_KEY) && state.get(player, VARBIT.STATUE) === 0 && !complete(player)) {
      state.set(player, VARBIT.PORTRAIT, 2);
      giveItem(player, ORNATE_KEY);
      common.itemBox(player, ORNATE_KEY, words(VARIANT.portraitKey));
      return true;
    }
    common.mesbox(player, words(VARIANT.portraitEmpty));
    return true;
  }

  // --- Safalaan (from Sarius on)

  const holdsAllSketches = (player) => SKETCHES.every((itemId) => common.held(player, itemId));

  /**
   * The sketches talk, which live ran straight on into the message's (t7239-7258): holding the message,
   * the riddle tail gives way to "Ah yes. I have it here." and the show.
   */
  function sketchesRunOn(steps) {
    const ask = steps.findIndex((step) => /Didn't you mention something about Sarius and a message\?/.test(step?.text ?? ""));
    const tail = variantSteps(VARIANT.withMessage);
    const answer = tail.findIndex((step) => step?.player === "Ah yes. I have it here.");
    if (ask < 0 || answer < 0) return steps;
    return [...steps.slice(0, ask + 1), ...tail.slice(answer)];
  }

  function safalaanVariant(player) {
    const s = stage(player);
    if (s >= STAGE.SEALED_MESSAGE) return [common.held(player, SEALED_MESSAGE) ? VARIANT.sealedHeld : VARIANT.sealedLost];
    if (s >= STAGE.LAB_OPENED) return [common.held(player, HAEMALCHEMY) ? VARIANT.withBook : VARIANT.labFound];
    if (s >= STAGE.MESSAGE_SHOWN) return [VARIANT.messageShown];
    if (state.get(player, VARBIT.SKETCHES_GIVEN) === 1) {
      return [common.held(player, SARIUS_MESSAGE) ? VARIANT.withMessage : VARIANT.sketchesGiven];
    }
    if (!holdsAllSketches(player)) return [VARIANT.someSketches];
    return [VARIANT.allSketches, common.held(player, SARIUS_MESSAGE) ? sketchesRunOn : undefined];
  }

  function talkSafalaan(event) {
    const { player, npcId, npc } = event;
    if (!SAFALAAN_IDS.has(npcId) || !atLeast(player, STAGE.SARIUS_TALKED) || complete(player)) return false;
    const [variant, select] = safalaanVariant(player);
    common.play(player, npcId, variant, select, PAGE, npc);
    return true;
  }

  /** The message used on Safalaan: once shown, "Yes, you've shown me this before..."; before, the talk. */
  function messageOnSafalaan(event) {
    const { player, npcId, itemId } = event;
    if (itemId !== SARIUS_MESSAGE || !SAFALAAN_IDS.has(npcId)) return;
    if (!state.within(player, STAGE.SARIUS_TALKED, STAGE.LAB_OPENED)) return;
    event.handled = true;
    if (atLeast(player, STAGE.MESSAGE_SHOWN)) {
      common.play(player, npcId, VARIANT.messageOnSafalaan, undefined, PAGE, event.target);
      return;
    }
    talkSafalaan({ player, npcId, npc: event.target });
  }

  /** "You give the sketches to Safalaan." (t7239): all three go, 2575 = 1, the stage stays. */
  function giveSketches(event) {
    const { player } = event;
    if (!state.within(player, STAGE.SARIUS_TALKED, STAGE.FIREPLACE_OPENED) || !holdsAllSketches(player)
      || state.get(player, VARBIT.SKETCHES_GIVEN) === 1) {
      event.end = true;
      return;
    }
    for (const itemId of SKETCHES) deleteAll(player, itemId);
    state.set(player, VARBIT.SKETCHES_GIVEN, 1);
    event.handled = true;
    event.box = { items: [SKETCHES[0], SKETCHES[1]] };
  }

  /** "You show the message to Safalaan." (t7252): 2576 = 1 and 260 -> 270; the message is kept. */
  function showMessage(event) {
    const { player } = event;
    if (!common.held(player, SARIUS_MESSAGE) || !state.within(player, STAGE.FIREPLACE_OPENED, STAGE.MESSAGE_SHOWN)) {
      event.end = true;
      return;
    }
    state.set(player, VARBIT.SARIUS_MESSAGE_GIVEN, 1);
    state.advance(player, STAGE.MESSAGE_SHOWN);
    event.handled = true;
    event.box = { items: [SARIUS_MESSAGE] };
  }

  /** "You show the book on haemalchemy to Safalaan..." (t7594): shown, and kept until the sealed message. */
  function showBook(event) {
    if (!common.held(event.player, HAEMALCHEMY) || stage(event.player) !== STAGE.LAB_OPENED) {
      event.end = true;
      return;
    }
    event.handled = true;
    event.box = { items: [HAEMALCHEMY] };
  }

  /** "Safalaan teaches you..." (t7644): the book becomes the sealed message in its slot, 300 -> 310. */
  function receiveSealedMessage(event) {
    const { player } = event;
    if (stage(player) !== STAGE.LAB_OPENED || !common.replaceInSlot(player, HAEMALCHEMY, SEALED_MESSAGE)) {
      event.end = true;
      return;
    }
    // Live sends no varbit for the two shortcut doors here (2578 stays): they are not simulated.
    state.advance(player, STAGE.SEALED_MESSAGE);
    event.handled = true;
    event.box = { items: [SEALED_MESSAGE] };
  }

  /** "Safalaan gives you a sealed message..." for a lost one (not captured; Ours: its objectbox). */
  function reissueSealedMessage(event) {
    const { player } = event;
    if (stage(player) !== STAGE.SEALED_MESSAGE) return;
    if (!common.held(player, SEALED_MESSAGE)) giveItem(player, SEALED_MESSAGE);
    event.handled = true;
    event.box = { items: [SEALED_MESSAGE] };
  }

  // --- The tapestry (t7402-7412, t7482-7485)

  /** Before Safalaan has seen the message: "You see no good reason..." (Ours: a messagebox). */
  function knifeOnTapestry(event) {
    const { player, objectId } = event;
    if (objectId !== TAPESTRY || complete(player)) return false;
    if (state.get(player, VARBIT.TAPESTRY) === 1) return false;
    if (!atLeast(player, STAGE.MESSAGE_SHOWN)) {
      common.mesbox(player, words(VARIANT.tapestryEarly));
      return true;
    }
    busy(player, true);
    common.later(player, TAPESTRY_SLASH_TICKS - 1, (p) => {
      common.anim(p, KNIFE_SLASH);
      common.sound(p, SLASH_SOUND);
    });
    common.later(player, TAPESTRY_BOX_TICKS - 1, slashTapestry);
    return true;
  }

  function slashTapestry(player) {
    busy(player, false);
    if (state.get(player, VARBIT.TAPESTRY) === 1) return;
    state.advance(player, STAGE.TAPESTRY_SLASHED);
    state.set(player, VARBIT.TAPESTRY, 1);
    common.itemBox(player, KNIFE, words(VARIANT.tapestrySlash));
  }

  /** Walk-through: one step across, no teleport and no animation (t7412, t7485). */
  function walkThroughTapestry(event) {
    const { player, objectId } = event;
    if (objectId !== TAPESTRY || state.get(player, VARBIT.TAPESTRY) !== 1) return false;
    const inside = player.getLocation().getY() >= TAPESTRY_INSIDE[1];
    stepAcross(player, inside ? [TAPESTRY_TILE] : [TAPESTRY_TILE, TAPESTRY_INSIDE]);
    return true;
  }

  // --- The statue (t7417-7422)

  function keyOnStatue(event) {
    const { player, objectId } = event;
    if (objectId !== STATUE || state.get(player, VARBIT.TAPESTRY) !== 1) return false;
    if (state.get(player, VARBIT.STATUE) === 1) {
      common.mesbox(player, words(VARIANT.statueKeyed)); // Ours
      return true;
    }
    common.anim(player, PICKUP_TABLE);
    common.sound(player, PLACE_KEY_SOUND);
    common.later(player, STATUE_TICKS, placeKey);
    return true;
  }

  /** 280 -> 290, 2596 = 1, the key gone and live's messagebox (t7419). */
  function placeKey(player) {
    if (state.get(player, VARBIT.STATUE) === 1 || !common.held(player, ORNATE_KEY)) return;
    deleteAll(player, ORNATE_KEY);
    state.advance(player, STAGE.STATUE_KEYED);
    state.set(player, VARBIT.STATUE, 1);
    common.mesbox(player, words(VARIANT.statueKey, "w7RMRv"));
  }

  /** Inspect (not captured; Ours: messageboxes). */
  function inspectStatue(event) {
    const { player, objectId } = event;
    if (objectId !== STATUE) return false;
    common.mesbox(player, words(state.get(player, VARBIT.STATUE) === 1 ? VARIANT.statueKeyed : VARIANT.statueInspect));
    return true;
  }

  // --- The laboratory door (t7424-7429, t7475-7481)

  function swapDoor(player, open) {
    const sender = player.getPacketSender();
    const [x, y, z] = DOOR_OUTSIDE;
    const [ix, iy] = DOOR_INSIDE;
    if (open) {
      sender.sendObject(new api.core.GameObject(INVISWALL, new Location(x, y, z), 0, 2, null));
      sender.sendObject(new api.core.GameObject(LAB_DOOR_OPEN, new Location(ix, iy, z), 0, 3, null));
    } else {
      sender.sendObject(new api.core.GameObject(LAB_DOOR, new Location(x, y, z), 0, 2, null));
      sender.sendObjectRemoval(new api.core.GameObject(LAB_DOOR_OPEN, new Location(ix, iy, z), 0, 3, null));
    }
  }

  /**
   * Locked until the statue holds the key. From outside: a tick on, the first opening's 290 -> 300 and
   * the step onto (3641, 3307); the next, the step in, the open door and iron_door_open; the door
   * closes two ticks after. From inside the step out comes a tick on. Works at every later stage.
   */
  function openLabDoor(player) {
    if (state.get(player, VARBIT.STATUE) !== 1) {
      common.mesbox(player, words(VARIANT.doorLocked)); // Ours: a messagebox
      return;
    }
    const inside = player.getLocation().getX() >= DOOR_INSIDE[0];
    player.getMovementQueue().reset();
    if (inside) {
      common.later(player, 1, (p) => {
        stepAcross(p, [DOOR_OUTSIDE]);
        swapDoor(p, true);
        common.sound(p, IRON_DOOR_OPEN);
        common.later(p, DOOR_OPEN_TICKS, (q) => swapDoor(q, false));
      });
      return;
    }
    common.later(player, 1, (p) => {
      state.advance(p, STAGE.LAB_OPENED);
      busy(p, true);
      stepAcross(p, [DOOR_OUTSIDE, DOOR_INSIDE]);
    });
    common.later(player, 2, (p) => {
      busy(p, false);
      swapDoor(p, true);
      common.sound(p, IRON_DOOR_OPEN);
      common.later(p, DOOR_OPEN_TICKS, (q) => swapDoor(q, false));
    });
  }

  /** Doors asks first ("door:toggle"). */
  function claimLabDoor(request) {
    if (request.handled || !request.player || request.objectId !== LAB_DOOR) return;
    request.handled = true;
    openLabDoor(request.player);
  }

  function labDoorOpen(event) {
    if (event.objectId !== LAB_DOOR) return false;
    openLabDoor(event.player);
    return true;
  }

  /** The key on the door: "...an electric shock." and 10 damage (Wiki and transcript; Ours: a messagebox). */
  function keyOnLabDoor(event) {
    const { player, objectId } = event;
    if (objectId !== LAB_DOOR) return false;
    common.mesbox(player, words(VARIANT.keyOnDoor, "6bSK4j"));
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(10, HitMask.RED)]);
    return true;
  }

  // --- The laboratory stairs (t7430-7436 down, t7462-7474 up)

  function climbStairs(player, down) {
    const movement = player.getMovementQueue();
    movement.reset().setBlockMovement(true);
    common.later(player, 1, (p) => {
      busy(p, true);
      fade(p, true);
      if (!down) common.sound(p, UP_STAIRS_SOUND);
    });
    common.later(player, 2, (p) => {
      common.anim(p, down ? PICKUP_FLOOR : REACH_FOR_LADDER);
      common.sound(p, down ? DOWN_STAIRS_SOUND : UP_STAIRS_SOUND, STAIRS_SOUND_DELAY);
    });
    common.later(player, 4, (p) => {
      p.getMovementQueue().setBlockMovement(false);
      p.moveTo(tileOf(down ? LAB_LANDING : LAB_SURFACE));
      if (down) busy(p, false);
    });
    // The fade in: a tick after the landing going down (t7436), two going up (t7472); closed 2 later.
    const fadeIn = down ? 5 : 6;
    common.later(player, fadeIn, (p) => {
      if (!down) busy(p, false);
      const mount = fade(p, false);
      common.later(p, 2, (q) => q.getPacketSender().closeSubInterfaceMount(mount));
    });
  }

  /** Ladders asks first ("ladders:climb"); these are the laboratory's own. */
  function claimLabStairs(request) {
    if (request.handled || !request.player) return;
    if (request.objectId !== STAIRS_DOWN && request.objectId !== STAIRS_UP) return;
    request.handled = true;
    climbStairs(request.player, request.objectId === STAIRS_DOWN);
  }

  // --- The broken rune case (not captured; Ours: messageboxes, runes as the transcript lists them)

  function searchRuneCase(event) {
    const { player, objectId } = event;
    if (objectId !== RUNE_CASE) return false;
    if (state.get(player, VARBIT.RUNECASE_SEARCHED) === 1) {
      common.mesbox(player, words(VARIANT.runeCaseEmpty));
      return true;
    }
    const newStacks = RUNE_CASE_RUNES.filter(([itemId]) => !common.held(player, itemId)).length;
    if (common.freeSlots(player) < newStacks) {
      common.message(player, "You don't have enough inventory space.");
      return true;
    }
    state.set(player, VARBIT.RUNECASE_SEARCHED, 1);
    for (const [itemId, amount] of RUNE_CASE_RUNES) player.getInventory().adds(itemId, amount);
    common.mesbox(player, words(VARIANT.runeCase, "ClpzOr"));
    return true;
  }

  // --- Items

  /** Haemalchemy's Read (t7600: objectbox 193 with the book). */
  function readHaemalchemy({ player, itemId }) {
    if (itemId !== HAEMALCHEMY) return false;
    common.itemBox(player, HAEMALCHEMY, words(VARIANT.readBook));
    return true;
  }

  /** Not captured; Ours: as the book's box. */
  function readSealedMessage({ player, itemId }) {
    if (itemId !== SEALED_MESSAGE) return false;
    common.itemBox(player, SEALED_MESSAGE, words(VARIANT.readSealed));
    return true;
  }

  /** Sarius' message's Read (not captured; Ours: its examine, as before the alignment). */
  function readSariusMessage({ player, itemId }) {
    if (itemId !== SARIUS_MESSAGE) return false;
    const examine = api.core.CacheDefinitions?.getItem?.(itemId)?.examine;
    if (examine) common.message(player, examine);
    return true;
  }

  // --- The Tome of Experience (Wiki: three chapters of 2,000 XP in a skill of 30+, not bankable)

  function tomeChaptersRead(player) {
    const chapters = Number(player.getAttribute(TOME_CHAPTERS_ATTRIBUTE));
    return Number.isInteger(chapters) && chapters > 0 ? Math.min(chapters, TOMES.length) : 0;
  }

  /**
   * The (3) becomes the (2), the (2) the (1), and the (1) crumbles. The chapters are the account's,
   * not each copy's: any copy reads the next one, and once three are read a copy only crumbles.
   */
  function crumble(player, slot) {
    player.getInventory().deleteAtSlot(slot, 1);
    common.message(player, "The book crumbles into a dust cloud of knowledge.");
  }

  /** Wiki: the tome "cannot be banked"; the refusal is the recorded one (223/00013). */
  function refuseTomeBanking(event) {
    if (!TOMES.includes(event.item?.getId?.())) return;
    event.allow = false;
    if (!event.quiet) event.player.sendMessage("A magical force prevents you from banking this item!");
  }

  function readTome(event) {
    const { player, item, slot, itemId } = event;
    if (!TOMES.includes(itemId)) return false;
    if (tomeChaptersRead(player) >= TOMES.length) {
      if (player.getInventory().get(slot) === item) crumble(player, slot);
      return true;
    }
    api.emitCustomEvent("xpreward:open", {
      player,
      minLevel: TOME_MIN_LEVEL,
      title: "Choose the stat you wish to be advanced!",
      onConfirm: (skill, name) => readChapter(player, item, slot, skill, name),
    });
    return true;
  }

  function readChapter(player, item, slot, skill, name) {
    const inventory = player.getInventory();
    // The tome the chapter was opened from, still in its slot.
    if (inventory.get(slot) !== item) return null;
    const read = tomeChaptersRead(player);
    if (read >= TOMES.length) {
      crumble(player, slot);
      return null;
    }
    const skills = player.getSkillManager();
    const before = skills.getExperience(skill);
    skills.addExperience(skill, TOME_CHAPTER_XP, true);
    if (skills.getExperience(skill) === before) return null;
    player.setAttribute(TOME_CHAPTERS_ATTRIBUTE, read + 1);
    const next = TOMES[read + 1];
    if (next === undefined) {
      crumble(player, slot);
    } else {
      inventory.setItem(slot, new Item(next, 1));
      inventory.refreshItems();
    }
    return `You read a fascinating chapter and earn experience! You have been awarded 2,000 ${name ?? skill.getName()} experience!`;
  }

  const tomeLost = (player) => !TOMES.some((itemId) => common.held(player, itemId)) && tomeChaptersRead(player) < TOMES.length;

  // --- Veliaf (from the sealed message on)

  function talkVeliaf(event) {
    const { player, npcId, npc } = event;
    if (!VELIAF_IDS.has(npcId) || !atLeast(player, STAGE.SEALED_MESSAGE)) return false;
    if (context.requirements.tasteNeedsVeliafRod(player)) return false;
    let variant = VARIANT.veliafAfter;
    if (!complete(player)) variant = common.held(player, SEALED_MESSAGE) ? VARIANT.veliafWith : VARIANT.veliafWithout;
    common.play(player, npcId, variant, undefined, PAGE, npc);
    return true;
  }

  /** "You show the message to Veliaf." (t7741): its objectbox, the message stays until the rewards. */
  function showVeliaf(event) {
    if (!common.held(event.player, SEALED_MESSAGE) || complete(event.player)) {
      event.end = true;
      return;
    }
    event.handled = true;
    event.box = { items: [SEALED_MESSAGE] };
  }

  /**
   * The continue after "...here's a little something..." (t7755): the quest completes (rewards, chat
   * line, jingle 154 and the scroll are the runtime's), the tome takes the sealed message's slot and
   * ramble_npcs_visible goes to 1.
   */
  function completeQuest(event) {
    const { player } = event;
    event.handled = true;
    event.end = true;
    if (stage(player) !== STAGE.SEALED_MESSAGE || !common.replaceInSlot(player, SEALED_MESSAGE, TOMES[0])) return;
    deleteAll(player, SEALED_MESSAGE);
    state.own(player, () => context.quest().complete(player));
    player.getPacketSender().sendVarbit(RAMBLE_NPCS_VISIBLE, 1);
  }

  /** "Hmm, okay, let's see if I have another one for you..." (not captured): the next unread charge. */
  function replaceTome(event) {
    const { player } = event;
    event.handled = true;
    if (!complete(player) || !tomeLost(player)) return;
    giveItem(player, TOMES[tomeChaptersRead(player)]);
  }

  // --- Dialogue events

  const ownsPage = (pages) => !Array.isArray(pages) || pages.some((entry) => entry?.page === PAGE);

  function answerCondition({ player, npcId, stepId, pages }) {
    if (!player || stepId !== STEP.tomeLost || !ownsPage(pages)) return null;
    if (npcId !== undefined && !VELIAF_IDS.has(npcId)) return null;
    return tomeLost(player);
  }

  function handleDialogueAction(event) {
    if (!event?.player || !ownsPage(event.pages)) return;
    switch (event.stepId) {
      case STEP.giveSketches: return giveSketches(event);
      case STEP.showMessage: return showMessage(event);
      case STEP.showMessageAgain:
        event.handled = true;
        event.box = { items: [SARIUS_MESSAGE] };
        return;
      case STEP.showBook: return showBook(event);
      case STEP.sealedMessage: return receiveSealedMessage(event);
      case STEP.newSealedMessage: return reissueSealedMessage(event);
      case STEP.showVeliaf: return showVeliaf(event);
      case STEP.complete: return completeQuest(event);
      case STEP.tomeGiven: return replaceTome(event);
      case STEP.giveSketchesAction:
      case STEP.giveBookAction:
      case STEP.sealedMessageAction:
        // The items moved on their boxes (above).
        event.handled = true;
        return;
      default:
    }
  }

  /** ramble_npcs_visible is not a quest varbit of its own save: sent again from the stage at login. */
  function loginVarbits({ player }) {
    if (player && complete(player)) player.getPacketSender().sendVarbit(RAMBLE_NPCS_VISIBLE, 1);
  }

  // --- Registration

  api.persistAttribute(TOME_CHAPTERS_ATTRIBUTE, 0);
  api.onItemOnObject("Knife", "Fireplace", knifeOnFireplace, { noted: false });
  api.onItemOnObject("Silver sickle", "Fireplace", sickleOnFireplace, { noted: false });
  api.onItemOnObject("Silver sickle (b)", "Fireplace", sickleOnFireplace, { noted: false });
  api.onObjectInteraction("Fireplace", { "Look-at": lookAtFireplace });
  api.onItemOnObject("Knife", "Portrait", knifeOnPortrait, { noted: false });
  api.onItemOnObject("Silver sickle", "Portrait", sickleOnPortrait, { noted: false });
  api.onItemOnObject("Silver sickle (b)", "Portrait", sickleOnPortrait, { noted: false });
  api.onObjectInteraction("Portrait", { Inspect: inspectPortrait });
  api.onItemOnObject("Knife", "Tapestry", knifeOnTapestry, { noted: false });
  api.onObjectInteraction("Slashed tapestry", { "Walk-through": walkThroughTapestry });
  api.onItemOnObject("Large ornate key", "Vampyre statue", keyOnStatue);
  api.onItemOnObject("Large ornate key", "Statue with key", keyOnStatue);
  api.onObjectInteraction("Vampyre statue", { Inspect: inspectStatue });
  api.onObjectInteraction("Statue with key", { Inspect: inspectStatue });
  api.onCustomEvent("door:toggle", claimLabDoor);
  api.onObjectInteraction("Door", { Open: labDoorOpen });
  api.onItemOnObject("Large ornate key", "Door", keyOnLabDoor);
  api.onCustomEvent("ladders:climb", claimLabStairs);
  api.onObjectInteraction("Broken rune case", { Search: searchRuneCase });
  api.onNpcInteraction("Safalaan Hallow", { "Talk-to": talkSafalaan });
  api.onItemOnNpc(messageOnSafalaan);
  api.onNpcInteraction("Veliaf Hurtz", { "Talk-to": talkVeliaf });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onItemAction("Message", { Read: readSariusMessage });
  api.onItemAction("Haemalchemy volume 1", { Read: readHaemalchemy });
  api.onItemAction("Sealed message", { Read: readSealedMessage });
  api.onItemAction("Tome of Experience (3)", { Read: readTome });
  api.onItemAction("Tome of Experience (2)", { Read: readTome });
  api.onItemAction("Tome of Experience (1)", { Read: readTome });
  api.onCanBankItem(refuseTomeBanking);
  api.onPlayerLogin(loginVarbits);
};
