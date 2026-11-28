/**
 * The Fremennik Trials: the Reveller's trial (Manni's drinking contest), from rsprox 1002236
 * (rev 242), 1002250 (rev 242, the win with the low-alcohol keg already held) and 1001364 (rev 241,
 * the first talk and the workman's Talk-to). See State.FremennikTrials.js for the shared context.
 *
 * - Manni hands out nothing (1002236 t3245-3256): the keg is a ground item (viking_beerkeg) on the
 *   table at 2660,3676,0 that respawns at once (t3262). Take is the normal table take (seq 9401,
 *   synth 2582). "You already have a keg of beer." when one is held (t5802).
 * - The contest: on the "As you wish" continue the chat closes, Manni drinks (seq 1327), +2 his
 *   message, +7 the player drinks (seq 1330, on a loss synth 2401), +9 the keg goes (on a loss
 *   cam_shake 3/0/20/2), then the rest of the talk (+15 after a loss, t3285-3300; +12 after the
 *   win, t5836-5848). A loss resets the camera as "Come back if'n..." opens (t3309).
 * - The win: "Congratulations! You have completed the Revellers' trial." as "I jusht can't..."
 *   opens (t5859, 1002250 t957); the trial is passed on that line's continue (t5868).
 * - The council workman takes a beer or a beer tankard for the strange object, in the beer's slot,
 *   as his first line opens (t4744). Tinderbox: the lit object, synth fuse_light (t5690).
 * - The lit object in the longhall's pipe: its message and the player's line (t5697), no bang. The
 *   bang comes when the kegs are switched (t5811): its message and area sound 1487, then next tick
 *   "You empty the keg..." and "What was THAT?" from the longhall (t5812). The held keg stays
 *   item 3711; the switch is the hidden LOW_ALCOHOL flag.
 * - The poison salesman's low-alcohol keg: 250 coins (t4652). His two narrations and the
 *   workman's wink are message boxes (t4534, t4588; 1001364 t3084).
 *
 * Wiki only: the switch without a distraction (Manni's "Thinking of cheating" talk), the lit object
 * exploding after 70-100 seconds in the inventory, anything else put into the pipe, Manni's beer
 * after the quest.
 */
module.exports = function attachFremennikTrialsReveller(api, ctx) {
  const { Animation, HitDamage, HitMask, Location, ObjectIdentifiers, Skill } = api.core;
  const { startTranscript, loadTranscripts } = require("../QuestRuntime");
  const CameraShake = require("../../interface/CameraShake.plugin");
  const { I, T, FLAG, NPC, STAGE_STARTED, STAGE_COMPLETE } = ctx;

  const V = {
    offer: "the-council-members-manni-the-reveller",
    again: "the-council-members-manni-the-reveller-talking-to-manni-the-reveller-again",
    retry: "the-council-members-manni-the-reveller-talking-to-manni-the-reveller-again-talking-to-manni-after-the-player-s-loss",
    win: "the-council-members-creating-a-distraction-talking-to-manni-after-switching-with-the-low-alcohol-beer",
    done: "the-council-members-subsequent-dialogue-with-manni",
    cheating: "the-council-members-attempting-to-use-the-low-alcohol-keg-with-the-regular-keg-of-beer",
    distraction: "the-council-members-creating-a-distraction",
    workmanBeer: "the-council-members-talking-to-the-council-workman-using-a-normal-beer-or-beer-tankard-on-the-council-workman",
    poison: "the-council-members-talking-to-the-poison-salesman",
    poisonAgain: "the-council-members-talking-to-the-poison-salesman-talking-to-the-poison-salesman-again",
  };
  /** Manni's own page after the quest (Wiki): "Hey! It's [Fremennik name]! Let me buy you a drink!" */

  /** The poison salesman finished his pitch once: he then asks "...you want to buy some?" (Ours: the key). */
  const PITCH_ATTRIBUTE = "quest.fremennik_trials.poison_pitch";

  const KEG_TILE = { x: 2660, y: 3676, z: 0 }; // rsprox 1002236 t3259 opobj3 viking_beerkeg
  const PIPE = ObjectIdentifiers.PIPE_2; // 4162 viking_pipe_end_longhall, 2663,3674,0
  const PIPE_TILE = new Location(2663, 3674, 0);
  const LOW_ALCOHOL_PRICE = 250;
  /** Ours: how far from the pipe the longhall's NPCs hear the bang. */
  const LONGHALL_RANGE = 16;

  const SEQ_TANKARD_DRINK = 1327; // viking_tankard_drink (Manni)
  const SEQ_KEG_DRINK = 1330; // viking_keg_drink_full (player)
  const SYNTH_LIQUID = 2401; // liquid
  const SYNTH_FUSE_LIGHT = 2598; // fuse_light
  const SOUND_EXPLOSION = 1487; // explosion, sound_area range 10 at 2659,3685,0 (t5811)
  const EXPLOSION_TILE = { x: 2659, y: 3685, z: 0 };
  const EXPLOSION_RANGE = 10;
  const DRUNK_SHAKE = [3, 0, 20, 2]; // cam_shake axis=3 random=0 amplitude=20 rate=2 (t3294)
  const CHATHAP3 = 569; // the player's pipe line (t5697)

  /** Ticks after the "As you wish" continue (1002236 t3285 / t5836). */
  const SCENE = { MESSAGE: 2, DRINK: 7, KEG_GONE: 9, LOSS_TALK: 15, WIN_TALK: 12 };

  const MSG = {
    haveKeg: "You already have a keg of beer.",
    manniDrinks: "The Fremennik drinks his tankard first. He staggers a little bit.",
    drunk: "You drink from your keg. You feel extremely drunk...",
    sober: "You drink from your keg. You don't feel at all drunk.",
    won: "Congratulations! You have completed the Revellers' trial.",
    lit: "You light the string of the strange object. It starts to hiss slightly.",
    bang: "You hear a loud bang from outside. It echoes through the drain.",
    switched: "You empty the keg and refill it with low alcohol beer.",
    exploded: "The strange object you lit earlier explodes in your inventory!",
  };
  const WHAT_WAS_THAT = "What was THAT?";
  /** viking_brundt, the spawned multinpc parent of Brundt (no NpcIdentifiers name). */
  const BRUNDT_PARENT = 3926;
  /** Who shouts at the bang (t5812): the barkeep, Eldgrim, Manni, Brundt, Bjorn. */
  const LONGHALL_SHOUTERS = new Set([
    api.core.NpcIdentifiers.THORA_THE_BARKEEP, // 3932 viking_longhall_barkeep
    api.core.NpcIdentifiers.ELDGRIM, // 3917 viking_reveller_2
    api.core.NpcIdentifiers.BJORN, // 3916 viking_reveller
    ...NPC.MANNI, // 3920 viking_reveller_3
    BRUNDT_PARENT,
    ...NPC.BRUNDT,
  ]);

  /** Wiki: the lit object explodes in the inventory after 70-100 s (117-167 ticks). */
  const FUSE_MIN_TICKS = 117;
  const FUSE_MAX_TICKS = 167;
  const FUSE_DAMAGE_FRACTION = 0.04;
  const FUSE_DAMAGE_MIN = 2;

  /** A drinking scene in progress: player -> true. */
  const drinking = new WeakMap();
  /** The lit objects' fuses: player -> tokens, oldest first. */
  const fuses = new WeakMap();
  /** Manni's win menu is showing: player -> true. */
  const winMenu = new WeakMap();

  const MANNI_ID = api.core.NpcIdentifiers.MANNI_THE_REVELLER;
  const isManni = (npcId) => NPC.MANNI.has(npcId);
  const started = (player) => ctx.quest.getStage(player) >= STAGE_STARTED;
  const switched = (player) => ctx.flag(player, FLAG.LOW_ALCOHOL);

  // ---- Manni ---------------------------------------------------------------------------------

  /** Manni's trial talk by trial state; also what "Ask about becoming a Fremennik" replays. */
  function manniTrialVariant(player) {
    const state = ctx.trialState(player, T.REVELLER);
    if (state === 2) return V.done;
    if (state === 0) return V.offer;
    if (ctx.held(player, I.KEG_OF_BEER)) return switched(player) ? V.win : V.again;
    return V.retry;
  }

  function manniVariant(player, stage) {
    if (stage < STAGE_STARTED) return null;
    return manniTrialVariant(player);
  }

  /** Manni's conditions key on the keg (live never hands out a tankard). */
  function manniCondition({ player, npcId, value }) {
    if (!isManni(npcId)) return null;
    const keg = ctx.held(player, I.KEG_OF_BEER);
    if (value.includes("does not already have the tankard")) return !keg;
    if (value.includes("does not have the beer tankards")) return !keg;
    if (value.includes("has the beer tankards")) return keg;
    if (value.includes("does not have a keg of beer")) return !keg;
    if (value.includes("has a regular keg of beer")) return keg && !switched(player);
    return null;
  }

  /** Accepting the contest starts the trial, keg or not (1001364 t2922/t2950 journal reads). */
  function acceptContest(player) {
    if (started(player) && ctx.trialState(player, T.REVELLER) === 0) ctx.setTrialState(player, T.REVELLER, 1);
  }

  /** The steps after the first speech line that starts with `prefix`, from the next speech on. */
  function tailAfter(prefix) {
    const speech = (step) => typeof step.player === "string" || typeof step.npc === "string"
      || (step.type === "line" && typeof step.text === "string");
    const text = (step) => String(step.player ?? step.npc ?? step.text ?? "");
    const find = (steps) => {
      for (let index = 0; index < (steps ?? []).length; index++) {
        const step = steps[index];
        if (speech(step) && text(step).startsWith(prefix)) {
          const rest = steps.slice(index + 1);
          const first = rest.findIndex(speech);
          return first >= 0 ? rest.slice(first) : [];
        }
        for (const option of step.options ?? []) {
          const found = find(option.steps);
          if (found) return found;
        }
        const found = find(step.steps);
        if (found) return found;
      }
      return undefined;
    };
    return (steps) => find(steps) ?? [];
  }

  /**
   * The drinking scene after "As you wish ..." (1002236 t3285-3300 lost, t5836-5848 won): the
   * chatbox closes, both drink, the keg goes, then the rest of the talk plays.
   */
  function startDrinking(player, npc, npcId) {
    if (drinking.get(player) || !ctx.held(player, I.KEG_OF_BEER)) return false;
    const win = switched(player);
    drinking.set(player, true);
    player.getPacketSender().sendInterfaceRemoval();
    player.getDialogueManager().reset();
    npc?.performAnimation?.(new Animation(SEQ_TANKARD_DRINK));
    const stop = () => drinking.delete(player);
    ctx.later(player, SCENE.MESSAGE, () => player.sendMessage(MSG.manniDrinks));
    ctx.later(player, SCENE.DRINK, () => {
      player.sendMessage(win ? MSG.sober : MSG.drunk);
      player.performAnimation(new Animation(SEQ_KEG_DRINK));
      if (!win) player.getPacketSender().sendSound(SYNTH_LIQUID, 0, 0);
    });
    ctx.later(player, SCENE.KEG_GONE, () => {
      if (!ctx.held(player, I.KEG_OF_BEER)) return stop();
      ctx.take(player, I.KEG_OF_BEER, 1);
      if (!win) CameraShake.send(player.getPacketSender(), "atmospheric", ...DRUNK_SHAKE);
      ctx.later(player, (win ? SCENE.WIN_TALK : SCENE.LOSS_TALK) - SCENE.KEG_GONE, () => {
        stop();
        const live = npc?.isRegistered?.() === true ? npc : null;
        startTranscript(api, player, npcId, ctx.PAGE, win ? V.win : V.again,
          tailAfter("As you wish"), live);
      });
    });
    return true;
  }

  /** Live ignores Talk-to on Manni while the contest plays (1002236 t5839). */
  function blockTalkWhileDrinking(event) {
    if (!isManni(event.npcId) || !drinking.get(event.player)) return;
    event.handled = true;
  }

  function manniLine(event) {
    const { player, npcId } = event;
    if (!player || !isManni(npcId)) return;
    const text = String(event.text ?? "");
    if (text.startsWith("A drinking contest? Easy.")) acceptContest(player);
    else if (text.startsWith("As you wish") && text.includes("I will drink first")) {
      const npc = event.npc;
      event.after = () => startDrinking(player, npc, npcId);
    } else if (text.startsWith("Come back if'n you fanshy a rematch!")) {
      event.before = () => player.getPacketSender().sendCameraReset();
    } else if (text.startsWith("I jusht can't (hic) believe it!")) {
      // Live sends it as this line opens; the trial is passed on its continue (KrSm12).
      event.before = () => {
        if (ctx.trialState(player, T.REVELLER) !== 2) player.sendMessage(MSG.won);
      };
    } else if (text.startsWith("Ah, I see you have your keg of beer.")) {
      if (switched(player) && ctx.held(player, I.KEG_OF_BEER)) winMenu.set(player, true);
    }
  }

  /** The win menu's "No" has a dangling jump; it is the again talk's "No" (Wiki: same as above). */
  function manniChoice(event, text) {
    const { player, npcId } = event;
    if (!isManni(npcId) || !winMenu.get(player)) return;
    winMenu.delete(player);
    if (text !== "no") return;
    event.end = true;
    ctx.later(player, 1, () => ctx.play(player, npcId, V.again, noOption));
  }

  /** The again talk's "No" branch, from its player line. */
  function noOption(steps) {
    const find = (list) => {
      for (const step of list ?? []) {
        for (const option of step.options ?? []) {
          if (option.text === "No" && option.steps?.[0]?.player === "I'm not quite ready yet...") return option.steps;
          const found = find(option.steps);
          if (found) return found;
        }
        const found = find(step.steps);
        if (found) return found;
      }
      return undefined;
    };
    return find(steps) ?? [];
  }

  function wonTrial(event) {
    event.handled = true;
    const { player } = event;
    if (ctx.trialState(player, T.REVELLER) === 2) return;
    ctx.completeTrial(player, T.REVELLER);
    ctx.setFlag(player, FLAG.LOW_ALCOHOL, false);
  }

  /** The talk's narrated steps: the scene plays them (startDrinking), so they say nothing here. */
  function sceneStep(event) {
    event.handled = true;
  }

  /** KniVWy: an old save's way in; the trial starts on accepting now. Nothing is handed out. */
  function offerAccepted(event) {
    acceptContest(event.player);
  }

  /** After the quest Manni buys the player a beer (Wiki). Ours: nothing when the pack is full. */
  function manniBeer(event) {
    event.handled = true;
    if (ctx.freeSlots(event.player) > 0) ctx.give(event.player, I.BEER, 1);
  }

  // ---- The keg on the table ------------------------------------------------------------------

  /** The keg respawns at once (t3262 obj_del + obj_add in one tick). Ours: one tick. */
  function kegSpawn() {
    return [{ id: I.KEG_OF_BEER, location: { ...KEG_TILE }, amt: 1, respawn: 1, members: true }];
  }

  function takeKeg(event) {
    if (event.groundItemId !== I.KEG_OF_BEER) return;
    const { x, y, z } = event.location;
    if (x !== KEG_TILE.x || y !== KEG_TILE.y || z !== KEG_TILE.z) return;
    if (!ctx.held(event.player, I.KEG_OF_BEER)) return;
    event.handled = true;
    event.player.sendMessage(MSG.haveKeg);
  }

  // ---- The council workman -------------------------------------------------------------------

  function workmanDrink(event) {
    const { player, itemId } = event;
    if (event.npcId !== NPC.COUNCIL_WORKMAN || (itemId !== I.BEER && itemId !== I.BEER_TANKARD)) return;
    event.handled = true;
    // The strange object takes the drink's slot as his first line opens (t4744).
    if (!ctx.swapInSlot(player, itemId, I.STRANGE_OBJECT, event.slot)) return;
    ctx.play(player, NPC.COUNCIL_WORKMAN, V.workmanBeer);
  }

  // ---- The strange object, the pipe and the kegs ---------------------------------------------

  function lightStrangeObject(event) {
    lightObject(event.player);
  }

  /** Either use order (1002236 t5811; the index shows 3712 on 3711 too). */
  function kegOnKeg(event) {
    const pair = new Set([event.usedItemId, event.usedWithItemId]);
    if (!pair.has(I.KEG_OF_BEER) || !pair.has(I.LOW_ALCOHOL_KEG)) return false;
    switchKegs(event.player);
    return true;
  }

  function lightObject(player) {
    if (!ctx.held(player, I.STRANGE_OBJECT)) return;
    ctx.take(player, I.STRANGE_OBJECT, 1);
    ctx.give(player, I.LIT_STRANGE_OBJECT, 1);
    player.sendMessage(MSG.lit);
    player.getPacketSender().sendSound(SYNTH_FUSE_LIGHT, 0, 0);
    lightFuse(player);
  }

  /** Wiki: a lit object still held after 70-100 s explodes: message, "Ow!", 4% hitpoints (min 2). */
  function lightFuse(player) {
    const token = {};
    if (!fuses.has(player)) fuses.set(player, []);
    fuses.get(player).push(token);
    const ticks = FUSE_MIN_TICKS + Math.floor(Math.random() * (FUSE_MAX_TICKS - FUSE_MIN_TICKS + 1));
    ctx.later(player, ticks, () => {
      const list = fuses.get(player) ?? [];
      const index = list.indexOf(token);
      if (index < 0) return;
      list.splice(index, 1);
      if (!ctx.held(player, I.LIT_STRANGE_OBJECT)) return;
      ctx.take(player, I.LIT_STRANGE_OBJECT, 1);
      player.sendMessage(MSG.exploded);
      player.forceChat("Ow!");
      const max = player.getSkillManager().getMaxLevel(Skill.HITPOINTS);
      const damage = Math.max(FUSE_DAMAGE_MIN, Math.floor(max * FUSE_DAMAGE_FRACTION));
      player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.RED)]);
    });
  }

  /** The steps inside one of the distraction page's condition branches. */
  const branch = (id) => (steps) => ctx.stepsById(id)(steps)[0]?.steps ?? [];

  function placeObject(event) {
    if (event.objectId !== PIPE || !ctx.inRellekka(event.player)) return false;
    const { player } = event;
    if (!ctx.held(player, I.LIT_STRANGE_OBJECT)) return;
    ctx.take(player, I.LIT_STRANGE_OBJECT, 1);
    fuses.get(player)?.shift();
    ctx.setFlag(player, FLAG.FIRECRACKER);
    // The message and the player's line (t5697); the bang waits for the keg switch.
    ctx.play(player, MANNI_ID, V.distraction, branch("8t8UoA"));
    return true;
  }

  /** Wiki: anything else in the pipe. An unlit strange object keeps "Nothing interesting happens.". */
  function placeOther(event) {
    if (event.objectId !== PIPE || event.itemId === I.STRANGE_OBJECT || !ctx.inRellekka(event.player)) return;
    event.handled = true;
    ctx.play(event.player, MANNI_ID, V.distraction, branch("ol9jjJ"));
  }

  function pipeLine(event) {
    if (String(event.text ?? "").startsWith("That is going to make a really loud bang")) event.expression = CHATHAP3;
  }

  /** The switch, with the object in the pipe: the bang, then the refill and the longhall's shout. */
  function switchKegs(player) {
    if (!ctx.flag(player, FLAG.FIRECRACKER)) {
      // Wiki: Manni catches the player at it.
      ctx.play(player, MANNI_ID, V.cheating);
      return;
    }
    ctx.setFlag(player, FLAG.FIRECRACKER, false);
    player.sendMessage(MSG.bang);
    player.getPacketSender().sendAreaSound(SOUND_EXPLOSION, EXPLOSION_TILE.x, EXPLOSION_TILE.y, EXPLOSION_TILE.z,
      1, 0, EXPLOSION_RANGE);
    ctx.later(player, 1, () => {
      if (!ctx.held(player, I.LOW_ALCOHOL_KEG) || !ctx.held(player, I.KEG_OF_BEER)) return;
      ctx.take(player, I.LOW_ALCOHOL_KEG, 1);
      ctx.setFlag(player, FLAG.LOW_ALCOHOL);
      player.sendMessage(MSG.switched);
      const shouters = longhallShouters(player);
      for (const npc of shouters) npc.forceChat(WHAT_WAS_THAT);
      // They turn to the pipe a tick later (t5813).
      ctx.later(player, 1, () => shouters.forEach((npc) => npc.setPositionToFace?.(PIPE_TILE)));
    });
  }

  /** The longhall NPCs near the pipe (Brundt and the revellers wander the hall). */
  function longhallShouters(player) {
    const shouters = [];
    for (const npc of api.core.World.getNpcs()) {
      if (!npc || npc.isRegistered?.() === false || !LONGHALL_SHOUTERS.has(npc.getId())) continue;
      if ((npc.getPrivateArea?.() ?? null) !== (player.getPrivateArea?.() ?? null)) continue;
      const at = npc.getLocation();
      if (at.getZ() === PIPE_TILE.getZ() && at.getDistance(PIPE_TILE) <= LONGHALL_RANGE) shouters.push(npc);
    }
    return shouters;
  }

  // ---- The poison salesman -------------------------------------------------------------------

  /**
   * While the quest runs every Talk-to opens on "Talk about the Murder Mystery Quest | Talk about the
   * Fremennik Trials" (rsprox 1002313 t1193, t1203, t1217). His own page otherwise.
   */
  function poisonVariant(player, stage) {
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return null;
    return V.poison;
  }

  const pitchHeard = (player) => ctx.readAttribute(player, PITCH_ATTRIBUTE) === 1 || ctx.flag(player, FLAG.LOW_ALCOHOL_BOUGHT);

  /**
   * Once the pitch was heard, the Fremennik option is the short offer ("I understand you have some low
   * alcohol beer for sale...?", 1002313 t1205, t1219), whose Yes/No are the pitch's own and answer in the
   * pick's tick (t1214, t1222). The again record's "jump above" is resolved to those options here. Ours:
   * which talks count as having heard it (the key).
   */
  function poisonMenu(notice) {
    const { player, npcId } = notice;
    if (npcId !== NPC.POISON_SALESMAN || !player || !pitchHeard(player)) return;
    // Only while the quest runs: after it (or before) the option is his own page's.
    const stage = ctx.quest?.getStage(player) ?? 0;
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return;
    const index = (notice.options ?? []).findIndex((option) => option.text === POISON_FREMENNIK_OPTION);
    if (index < 0) return;
    const options = [...notice.options];
    options[index] = { ...options[index], steps: againSteps() };
    notice.options = options;
  }
  const POISON_FREMENNIK_OPTION = "Talk about the Fremennik Trials";

  function againSteps() {
    const variants = loadTranscripts(api)[ctx.PAGE].variants;
    const pitch = variants[V.poison];
    const offer = (variants[V.poisonAgain] ?? []).flatMap((step) => step.type === "condition" ? step.steps ?? [] : [step]);
    return offer.map((step) => step.type !== "choice" ? step : {
      ...step,
      options: step.options.map((option) => ({ ...option, steps: pitchOption(pitch, option.text) })),
    });
  }

  function poisonCondition({ player, npcId, value }) {
    if (npcId !== NPC.POISON_SALESMAN) return null;
    if (value.includes("does not have 250 gp")) return player.getInventory().getAmount(I.COINS) < LOW_ALCOHOL_PRICE;
    if (value.includes("has 250 gp")) return player.getInventory().getAmount(I.COINS) >= LOW_ALCOHOL_PRICE;
    if (value.includes("does not have inventory space")) return ctx.freeSlots(player) <= 0;
    if (value.includes("has inventory space")) return ctx.freeSlots(player) > 0;
    // Ours: "again" is offered to anyone who heard the pitch, so a lost keg can be bought again.
    if (value.includes("did not receive the money")) return true;
    return null;
  }

  function poisonLine(event) {
    const { player, npcId } = event;
    if (!player || npcId !== NPC.POISON_SALESMAN) return;
    const text = String(event.text ?? "");
    if (text.startsWith("I'll sell you a keg of it for only 250 gold pieces!")) player.setAttribute(PITCH_ATTRIBUTE, 1);
  }

  /** The pitch's closing Yes/No option (the one after "I'll sell you a keg ..."). */
  function pitchOption(steps, text) {
    const find = (list) => {
      for (let index = 0; index < (list ?? []).length; index++) {
        const step = list[index];
        if (step.type === "choice" && String(list[index - 1]?.text ?? "").startsWith("I'll sell you a keg")) {
          return step.options?.find((option) => option.text === text)?.steps;
        }
        for (const option of step.options ?? []) {
          const found = find(option.steps);
          if (found) return found;
        }
      }
      return undefined;
    };
    return find(steps) ?? [];
  }

  function buyKeg(event) {
    event.handled = true;
    const { player } = event;
    if (!ctx.held(player, I.COINS, LOW_ALCOHOL_PRICE) || ctx.freeSlots(player) <= 0) return;
    ctx.take(player, I.COINS, LOW_ALCOHOL_PRICE);
    ctx.give(player, I.LOW_ALCOHOL_KEG, 1);
    ctx.setFlag(player, FLAG.LOW_ALCOHOL_BOUGHT);
  }

  /** Message boxes with a continue, not chat (1002236 t4534/t4588, 1001364 t3084). */
  function statementBox(event) {
    event.box = { statement: true };
  }

  // ---- Login / logout ------------------------------------------------------------------------

  /** A lit object kept over a relog gets a fresh fuse (Wiki timer; Ours: restarted on login). */
  function login({ player }) {
    const lit = player.getInventory().getAmount(I.LIT_STRANGE_OBJECT);
    for (let i = 0; i < lit; i++) lightFuse(player);
  }

  function logout({ player }) {
    drinking.delete(player);
    fuses.delete(player);
    winMenu.delete(player);
  }

  ctx.variant(NPC.MANNI, manniVariant);
  ctx.variant(NPC.POISON_SALESMAN, poisonVariant);
  ctx.offer(NPC.MANNI, manniTrialVariant);
  ctx.condition(manniCondition);
  ctx.condition(poisonCondition);
  ctx.conditionStep("KniVWy", offerAccepted);
  ctx.line(manniLine);
  ctx.line(poisonLine);
  ctx.line(pipeLine);
  ctx.choice(manniChoice);
  for (const id of ["-clH7k", "pImFVN", "OXJHvH", "FNLh6a", "vVyoip", "wGcoul"]) ctx.action(id, sceneStep);
  ctx.action("KrSm12", wonTrial);
  ctx.action("RSKxfK", manniBeer);
  ctx.action("Y--9Gn", sceneStep);
  ctx.action("PkDa1o", buyKeg);
  // The workman's winks: 8hS3hT and 5A_4Fr since osrsreboxed-db gave them their full stop (were QaYRK9, Tg1ehy).
  for (const id of ["ZlVgwR", "jYmXBQ", "Hgs1hR", "4nj5Ri", "8hS3hT", "5A_4Fr"]) ctx.action(id, statementBox);
  api.persistAttribute(PITCH_ATTRIBUTE, 0);
  api.registerDefinitionSource("ground_items", { name: "fremennik-trials-keg", load: kegSpawn });
  api.onGroundItemPickup(takeKeg);
  api.onNpcInteraction(blockTalkWhileDrinking);
  api.onCustomEvent("npc-dialogue:menu", poisonMenu);
  api.onItemOnNpc(workmanDrink);
  api.onItemOnItem("Tinderbox", "Strange object", lightStrangeObject);
  api.onItemOnItem("Keg of beer", "Low alcohol keg", kegOnKeg);
  api.onItemOnObject("Lit strange object", "Pipe", placeObject);
  api.onItemOnObject(placeOther, { fallback: true });
  api.onPlayerLogin(login);
  api.onPlayerLogout(logout);
};
