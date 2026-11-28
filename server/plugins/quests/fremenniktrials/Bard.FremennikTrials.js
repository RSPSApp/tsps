/**
 * The Fremennik Trials: Bard unit (Olaf the Bard's trial; see State.FremennikTrials.js for the shared context).
 *
 * The lyre (rsprox 1002236 rev 242, 1002247, 1002250, 1001364 rev 241):
 * - Swaying tree "Cut-branch": the axe's swing and spam line on arrival, the branch 3 ticks later.
 * - Knife on the branch: message + fletching seq at once, the unstrung lyre in the branch's slot a tick later.
 * - Lalli: the plan (a message box), then the rock soup in his cauldron (Lalli asks after each item), then the
 *   golden fleece. Askeladden hands over the pet rock on his last line and shows his "Claim Pet Rock" form.
 * - Spinning the fleece (item on the wheel or the wheel's Spin): seq + loc anim + sound, the wool 3 ticks later.
 * - Golden wool on the unstrung lyre: the strung lyre at once.
 * - Fossegrimen: a worthy raw fish on her altar with the strung lyre held. She rises south of the altar, the
 *   lyre is enchanted into the fish's slot and she speaks. The altar's Summon plays her talk.
 * - The longhall: the backstage door swaps open for the player, the bouncer speaks, then the performance on
 *   stage (overheads, jingles, Olaf's two lines) passes the trial on its last continue. Off stage the lyre is
 *   only tuned.
 */
module.exports = function attachFremennikTrialsBard(api, ctx) {
  const { NPC, T, FLAG, I } = ctx;
  const { Location, Animation, Graphic, GameObject, Skill } = api.core;
  const { ObjectIdentifiers, NpcIdentifiers } = api.core;
  const { startTranscript, loadTranscripts, QUEST_POINTS_ATTRIBUTE } = require("../QuestRuntime");

  /** Bard-only progress bits: Lalli's plan heard, Askeladden's rock handed over. */
  const BARD_ATTRIBUTE = "quest.fremennik_trials.bard";
  const BIT_PLAN = 0;
  const BIT_ROCK_GIVEN = 1;
  /**
   * Olaf's long walkthrough was heard: later re-talks are the short reminder (1002313 t642; the long
   * one in 1002236 t3545 on the first talk after accepting). Ours: what switches it.
   */
  const BIT_OLAF_EXPLAINED = 2;

  const PAGE_BOUNCER = "Longhall Bouncer";
  const PAGE_LALLI = "Lalli";
  const P = "the-council-members-olaf-the-bard";
  const SOUP = `${P}-talking-to-lalli-again-with-the-pet-rock-making-rock-soup`;
  const V = {
    olafOffer: P,
    olafAgain: `${P}-talking-to-him-again`,
    olafReminder: `${P}-talking-to-him-again-talking-to-him-again-afterwards`,
    olafDone: `${P}-subsequent-dialogue-with-olaf`,
    lalliFirst: `${P}-talking-to-lalli`,
    lalliRock: `${P}-talking-to-lalli-again-with-the-pet-rock`,
    lalliAgain: `${P}-talking-to-lalli-again-with-the-pet-rock-talking-to-lalli-again`,
    soup: SOUP,
    lalliSoup: `${SOUP}-talking-to-lalli-after-making-the-soup`,
    askeladdenBase: "the-non-council-members-askeladden",
    askeladdenOlaf: `${P}-talking-to-askeladden`,
    askeladdenAgain: `${P}-talking-to-askeladden-talking-to-askeladden-again`,
    fossegrimen: `${P}-talking-to-the-fossegrimen`,
    bouncerBlessed: `${P}-talking-to-the-longhall-with-the-blessed-lyre`,
    bouncerBackstage: `${P}-entering-the-backstage`,
    bouncerRefuse: "before-the-fremennik-trials-talking-to-him-or-attempting-to-open-the-door-to-the-long-hall-backstage",
    bouncerAfter: "after-completing-the-bard-s-trial",
    stewRefuse: "attempting-to-put-anything-in-lalli-s-stew",
  };
  /** Transcript step ids. */
  const STEP = {
    soupVegetable: "WwON6z",
    soupDone: "2e7LZD",
    rockAction: "rXjJ1K",
    rockAgainAction: "vLCBvq",
    fleeceAction: "-ZyXnW",
    planMessage: "AV9cY0",
    noFish: ["ByZWQV", "hzBqYH", "WIEH0J", "v7PrP3"],
    hasFish: ["9_VkoD", "duG1Kr", "kry7KZ", "JGFwga"],
  };

  // Sequences, spotanims, sounds and jingles (cache gamevals).
  const SEQ_FLETCHING = 1248; // human_fletching
  const SEQ_RESET = -1;
  const SEQ_LYRE_READY = 1318; // viking_lyre_ready
  const SEQ_LYRE_LOOP = 1321; // viking_lyre_playing_loop
  const SEQ_LYRE_ONCE = 1320; // viking_lyre_play_once
  const SEQ_LYRE_PUTAWAY = 1319; // viking_lyre_putaway
  const SEQ_LYRE_ENCHANT = 8315; // viking_lyre_enchant
  const SEQ_SPINNING = 13138; // human_spinningwheel_90
  const LOC_ANIM_SPINNING_WHEEL = 466;
  const SPOTANIM_ENCHANT = 758; // xbows_diamond_tips_spotanim
  const SOUND_ENCHANT = 136; // enchant_sapphire_amulet
  const SOUND_SPINNING = 2590; // spinning
  const SOUND_DOOR_OPEN = 62; // door_open
  const SONG_SILENCE = 147; // silence
  const JINGLE_REFRAIN_START = 165; // refrain start
  const JINGLE_REFRAIN_LOOP = 164; // refrain loop
  const JINGLE_REFRAIN_END = 163; // refrain end
  const CHATNEU2 = 589;
  const CHATNEU3 = 590;
  const CHATQUIZ1 = 554;
  const ASKELADDEN_HASOP_VARBIT = 6486; // askelladen_hasop: 3927 shows as 8403 (askelladen_rockop)
  const LOC_INVISWALL = 38848; // inviswall
  const LOC_DOOR_INACTIVE = 4249; // viking_door_inactive
  const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping"; // MovementQueue.IGNORE_CLIPPING_FLAG
  const FRIDGEIR = NpcIdentifiers.FRIDGEIR; // viking_heckler_4

  // Capture XP deltas (whole numbers in the transcripts; no Wiki values): branch 1 Woodcutting (1002236 t3756),
  // unstrung lyre 1 Crafting (t3762), stringing 1 Fletching (t4419). Golden wool: Wiki 2.5 Crafting.
  const BRANCH_XP = 1;
  const UNSTRUNG_LYRE_XP = 1;
  const STRING_LYRE_XP = 1;
  const GOLDEN_WOOL_XP = 2.5;
  const STRING_FLETCHING_LEVEL = 25;
  const CHAMPIONS_GUILD_QUEST_POINTS = 32;

  const WORTHY_FISH = [I.RAW_SHARK, I.RAW_MANTA_RAY, I.RAW_SEA_TURTLE];
  const FOSSEGRIMEN_TILE = [2626, 3596, 0]; // 2 south of the altar (1002236 t4800)
  const FOSSEGRIMEN_VIEW = 16;
  const DOOR = { x: 2667, y: 3683, z: 0 };
  const BACKSTAGE_TILE = [2666, 3683, 0];
  /** The player faces down the hall while playing (1002250 t814). */
  const AUDIENCE_FACE = [2658, 3665, 0];
  const STAGE = [2655, 2662, 3683, 3685, 0];

  const SOUP_ITEMS = new Map([
    [I.PET_ROCK, { bit: FLAG.SOUP_ROCK, message: "You put your pet rock into the cauldron." }],
    [I.CABBAGE, { bit: FLAG.SOUP_CABBAGE, message: "You put a cabbage into the cauldron." }],
    [I.POTATO, { bit: FLAG.SOUP_POTATO, message: "You put a potato into the cauldron." }],
    [I.ONION, { bit: FLAG.SOUP_ONION, message: "You put an onion into the cauldron." }],
  ]);

  /** Tuning (1001364 t2712): the lines' ticks after the click, as live sends them ("Doh", not the data's "Dor"). */
  const TUNING = ["Doh Ray Me So.", "Fah La Ti Doh.", "La La La La.", "De-Doo-De-Doo."];
  /** The Champions' Guild ballad as live sings it (1002236/1002250/1001364). */
  const CHAMPIONS_BALLAD = ["The thought of lots of questing,", "Leaves some people unfulfilled,",
    "But I have done my simple best, in", "Entering the Champions' Guild."];
  const HECKLES = ["Is that supposed to impress us outerlander?", "I do such feats before breakfast!"];
  const OLAF_LINES = [
    ["Wow! That was awesome! You are one of the greatest bards I have ever had the pleasure of watching performing!", CHATNEU3],
    ["You have certainly earned my vote! I hope we can duet together soon!", CHATNEU2],
  ];
  const FOSSEGRIMEN_BLESSING = "Many thanks for the offering outerlander. Please accept as a gift the ability to play your lyre...";

  const fossegrimen = new WeakMap();
  const playing = new WeakMap();
  const busy = new WeakSet();

  // --------------------------------------------------------------------------------------------------------------
  // State

  const bard = (player, bit) => ((ctx.readAttribute(player, BARD_ATTRIBUTE) >>> bit) & 1) === 1;
  function setBard(player, bit) {
    player.setAttribute(BARD_ATTRIBUTE, ctx.readAttribute(player, BARD_ATTRIBUTE) | (1 << bit));
  }
  const started = (player) => ctx.trialState(player, T.BARD) >= 1;
  const active = (player) => ctx.trialState(player, T.BARD) === 1;
  const soupDone = (player) => [...SOUP_ITEMS.values()].every(({ bit }) => ctx.flag(player, bit));
  const soupStarted = (player) => [...SOUP_ITEMS.values()].some(({ bit }) => ctx.flag(player, bit));
  /** Old saves have no plan bit: any soup ingredient means the plan was heard. */
  const planHeard = (player) => bard(player, BIT_PLAN) || soupStarted(player);
  const rockGiven = (player) => bard(player, BIT_ROCK_GIVEN) || ctx.flag(player, FLAG.SOUP_ROCK);
  const onStage = (player) => ctx.inBox(player, ...STAGE);
  const at = ([x, y, z]) => new Location(x, y, z);
  const animate = (mobile, id) => mobile.performAnimation(new Animation(id));
  const spam = (player, text) => player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, text);

  function slotOf(player, itemId, preferred) {
    const inventory = player.getInventory();
    if (Number.isInteger(preferred) && inventory.forSlot(preferred)?.getId() === itemId) return preferred;
    const slot = inventory.getSlotForItemId(itemId);
    return Number.isInteger(slot) && slot >= 0 ? slot : -1;
  }

  const empty = () => new api.core.Item(-1, 0);

  function setInSlot(player, slot, itemId) {
    const inventory = player.getInventory();
    inventory.setItem(slot, itemId === null ? empty() : new api.core.Item(itemId, 1));
    inventory.refreshItems();
  }

  function xp(player, skill, amount) {
    player.getSkillManager().addExperiences(skill, amount);
  }

  function sendRockVarbit(player) {
    player.getPacketSender().sendVarbit(ASKELADDEN_HASOP_VARBIT, rockGiven(player) ? 1 : 0);
  }

  // --------------------------------------------------------------------------------------------------------------
  // Dialogue

  function olafVariant(player, stage) {
    const state = ctx.trialState(player, T.BARD);
    if (state === 2) return V.olafDone;
    if (stage >= ctx.STAGE_STARTED) return state >= 1 ? olafRunning(player) : V.olafOffer;
    return null;
  }

  function olafOffer(player) {
    const state = ctx.trialState(player, T.BARD);
    return state === 2 ? V.olafDone : state === 1 ? olafRunning(player) : V.olafOffer;
  }

  const olafRunning = (player) => bard(player, BIT_OLAF_EXPLAINED) ? V.olafReminder : V.olafAgain;

  function lalliVariant(player) {
    const state = ctx.trialState(player, T.BARD);
    if (state === 2 || soupDone(player)) return V.lalliSoup;
    if (state < 1) return null;
    // Wiki: once the plan is made, Lalli only asks for food until the soup is done.
    if (planHeard(player)) return V.lalliAgain;
    if (ctx.held(player, I.PET_ROCK)) return V.lalliRock;
    return V.lalliFirst;
  }

  /** Once the Bard's trial has passed he is back to his own talk (1002313 t2883). */
  function askeladdenVariant(player) {
    if (!started(player) || ctx.trialState(player, T.BARD) === 2) return V.askeladdenBase;
    return ctx.held(player, I.PET_ROCK) || rockGiven(player) ? V.askeladdenAgain : V.askeladdenOlaf;
  }

  /** Talk-to on the bouncer: the blessed-lyre line while the enchanted lyre is held; otherwise his own page. */
  function bouncerVariant(player) {
    if (ctx.held(player, I.ENCHANTED_LYRE)) return V.bouncerBlessed;
    // His own page's after-the-trial talk (1002313 t7825, after the quest; the door already uses it).
    return ctx.trialState(player, T.BARD) === 2 ? { page: PAGE_BOUNCER, variant: V.bouncerAfter } : undefined;
  }

  function startTrial(event, text) {
    if (!NPC.OLAF.has(event.npcId) || (text !== "yes" && text !== "yes.")) return;
    if (ctx.trialState(event.player, T.BARD) === 0) ctx.setTrialState(event.player, T.BARD, 1);
  }

  function balladTargets(player) {
    const complete = (name) => {
      const request = { player, name, complete: false };
      api.emitCustomEvent("quest:is-complete", request);
      return request.complete === true;
    };
    const points = Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0;
    // Wiki trivia: the 99 ballad is for a non-melee skill.
    const melee = new Set([Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE].map((s) => s.getIndex()));
    const skill99 = Skill.values().find((s) => s.getIndex() >= 0 && !melee.has(s.getIndex())
      && player.getSkillManager().getMaxLevel(s) >= 99) ?? null;
    return {
      champions: points >= CHAMPIONS_GUILD_QUEST_POINTS,
      heroes: complete("Heroes' Quest"),
      legends: complete("Legends' Quest"),
      skill99,
    };
  }

  function answerCondition({ player, npcId, value }) {
    const has = (id) => ctx.held(player, id);
    if (value.includes("does not have the pet rock")) return !has(I.PET_ROCK);
    if (value.includes("has the pet rock")) return has(I.PET_ROCK);
    if (value.includes("does not have the golden fleece")) return !has(I.GOLDEN_FLEECE);
    if (value.includes("already has golden fleece")) return has(I.GOLDEN_FLEECE);
    if (npcId === NPC.FOSSEGRIMEN) {
      if (value.includes("does not have a raw shark")) return !has(I.RAW_SHARK);
      if (value.includes("has a raw shark")) return has(I.RAW_SHARK);
      if (value.includes("does not have a raw manta ray")) return !has(I.RAW_MANTA_RAY);
      if (value.includes("has a manta ray")) return has(I.RAW_MANTA_RAY);
      if (value.includes("does not have a raw sea turtle")) return !has(I.RAW_SEA_TURTLE);
      if (value.includes("has a raw sea turtle")) return has(I.RAW_SEA_TURTLE);
      if (value.includes("does not have a raw bass")) return !has(I.RAW_BASS);
      if (value.includes("has a raw bass")) return has(I.RAW_BASS);
      if (value.includes("deposits a raw fish")) return WORTHY_FISH.some(has);
    }
    if (NPC.OLAF.has(npcId)) {
      const targets = balladTargets(player);
      if (value.includes("entrance to the champions guild")) return targets.champions;
      if (value.includes("entrance to the heroes' guild")) return targets.heroes;
      if (value.includes("entrance to the legends' guild")) return targets.legends;
      if (value.includes("level 99 in any skill")) return targets.skill99 !== null;
      if (value.includes("doesn't have any achievements")) {
        return !targets.champions && !targets.heroes && !targets.legends && targets.skill99 === null;
      }
    }
    return null;
  }

  /** Askeladden hands the rock over as his last line shows, and his form changes (1002236 t4008, 1002247 t5422). */
  function handleLine(event) {
    const { player, npcId } = event;
    if (!player) return;
    const text = String(event.text ?? "");
    // The runner builds a run of lines ahead, so the rock goes as the player's line before it is continued.
    // The lost-rock branch is the same: the rock arrives as "Sure thing buddy!..." shows (1002313 t119).
    if (NPC.ASKELADDEN.has(npcId) && (text === "Do you have any spare rocks then?" || text === "Can I have another rock? I lost mine...")) {
      event.after = () => {
        if (!ctx.held(player, I.PET_ROCK)) ctx.give(player, I.PET_ROCK, 1);
        setBard(player, BIT_ROCK_GIVEN);
        sendRockVarbit(player);
      };
      return;
    }
    // The fleece comes with "Here you go. Hah! Me trick you human!..." (1002236 t4213).
    if (NPC.LALLI.has(npcId) && text.startsWith("Here you go. Hah! Me trick you human!")) {
      if (!ctx.held(player, I.GOLDEN_FLEECE)) ctx.give(player, I.GOLDEN_FLEECE, 1);
      return;
    }
    if (npcId === NPC.FOSSEGRIMEN && text === "What can I do for you?") event.expression = CHATQUIZ1; // 1001364 t2661
    if (NPC.OLAF.has(npcId) && text === "So how would I go about writing this epic?") setBard(player, BIT_OLAF_EXPLAINED);
  }

  /** The data's receive step sits before "What pet is this then?": the rock comes with the last line instead. */
  function rockOnLastLine(event) {
    event.handled = true;
  }

  function rockAgain(event) {
    const { player } = event;
    if (!ctx.held(player, I.PET_ROCK)) ctx.give(player, I.PET_ROCK, 1);
    setBard(player, BIT_ROCK_GIVEN);
    sendRockVarbit(player);
    event.handled = true;
  }

  function fleeceOnLine(event) {
    event.handled = true;
  }

  /** "You have a cunning plan..." is a message box (229:3, 1002236 t4129). */
  function planBox(event) {
    setBard(event.player, BIT_PLAN);
    event.box = { statement: true };
  }

  /** Summon menu: a fish not held is a message box (1001364 t2686). */
  function noFishBox(event) {
    event.box = { statement: true };
  }

  /**
   * Summon menu: a held fish is the altar's blessing, all on the tick it is picked (rsprox 1002313
   * t524: the menu closes, the message, spotanim, seq, sound, the slot swap and her line together).
   */
  function presentFish(event) {
    const { player } = event;
    const fish = WORTHY_FISH.find((id) => ctx.held(player, id));
    if (!fish || !ctx.held(player, I.LYRE) || !active(player)) {
      // Ours: a bass, or no strung lyre to enchant: the talk just ends.
      return;
    }
    enchantLyre(player, slotOf(player, fish), true);
  }

  // --------------------------------------------------------------------------------------------------------------
  // The lyre

  /** Cut-branch: 1002236 t3749-3756, 1001364 t2102 (no axe), t2295-2319 (several branches). */
  function cutBranch(event) {
    const { player } = event;
    if (busy.has(player)) return true;
    const request = { player, itemId: null, axe: null };
    api.emitCustomEvent("woodcutting:axe", request);
    if (!request.axe) {
      player.sendMessage("You need an axe to chop down this tree.<br>You do not have an axe that you have the Woodcutting level to use.");
      return true;
    }
    if (ctx.freeSlots(player) < 1) {
      // The data's line (Wiki); no capture.
      player.sendMessage("You do not have enough free space in your inventory to chop this tree.");
      return true;
    }
    const from = player.getLocation().clone();
    busy.add(player);
    spam(player, "You swing your axe at the tree.");
    animate(player, request.axe.animationId);
    ctx.later(player, 3, () => {
      busy.delete(player);
      // Ours: walking off cancels it (live never shows an interrupted cut).
      if (!player.getLocation().equals(from)) return;
      animate(player, SEQ_RESET);
      if (ctx.freeSlots(player) < 1) return;
      ctx.give(player, I.BRANCH, 1);
      xp(player, Skill.WOODCUTTING, BRANCH_XP);
      player.sendMessage("You cut a branch from the strangely musical tree.");
    });
    return true;
  }

  /** Knife on the branch (either way): 1002236 t3761-3762. */
  function carveLyre(event) {
    const { player } = event;
    const used = event.usedItemId === I.BRANCH ? event.usedItemSlot : event.usedWithItemSlot;
    const slot = slotOf(player, I.BRANCH, used);
    if (slot < 0) return true;
    player.sendMessage("You craft an unstrung lyre out of the branch.");
    animate(player, SEQ_FLETCHING);
    ctx.later(player, 1, () => {
      const now = slotOf(player, I.BRANCH, slot);
      if (now < 0 || !ctx.held(player, I.KNIFE)) return;
      setInSlot(player, now, I.UNSTRUNG_LYRE);
      xp(player, Skill.CRAFTING, UNSTRUNG_LYRE_XP);
    });
    return true;
  }

  /**
   * Golden wool on the unstrung lyre, all in the click tick: both go and the lyre takes the lower of
   * their two slots (1002313 t331 wool 12 + lyre 13 -> 12; 1002247 t5862 -> 0; 1002236 t4419 -> 0).
   */
  function stringLyre(event) {
    const { player } = event;
    if (player.getSkillManager().getMaxLevel(Skill.FLETCHING) < STRING_FLETCHING_LEVEL) {
      player.sendMessage("You need to have a Fletching level of 25 to string the lyre.");
      return true;
    }
    const lyreSlot = slotOf(player, I.UNSTRUNG_LYRE,
      event.usedItemId === I.UNSTRUNG_LYRE ? event.usedItemSlot : event.usedWithItemSlot);
    const woolSlot = slotOf(player, I.GOLDEN_WOOL,
      event.usedItemId === I.GOLDEN_WOOL ? event.usedItemSlot : event.usedWithItemSlot);
    if (lyreSlot < 0 || woolSlot < 0) return true;
    player.sendMessage("You attach the golden strings to the lyre.");
    const inventory = player.getInventory();
    inventory.setItem(Math.max(woolSlot, lyreSlot), empty());
    inventory.setItem(Math.min(woolSlot, lyreSlot), new api.core.Item(I.LYRE, 1));
    inventory.refreshItems();
    xp(player, Skill.FLETCHING, STRING_LYRE_XP);
    return true;
  }

  /** Spinning the fleece: 1002236 t4412-4415 (used on the wheel), 1001364 t2419 (the wheel's Spin). No message. */
  function spinFleece(player, wheel, preferredSlot) {
    if (busy.has(player)) return;
    if (ctx.inRellekka(player) && !ctx.quest.isComplete(player)) {
      player.sendMessage("Only Fremenniks may use this spinning wheel."); // the data's line (Wiki)
      return;
    }
    const slot = slotOf(player, I.GOLDEN_FLEECE, preferredSlot);
    if (slot < 0) return;
    busy.add(player);
    animate(player, SEQ_SPINNING);
    if (wheel) player.getPacketSender().sendObjectAnimation(wheel, new Animation(LOC_ANIM_SPINNING_WHEEL));
    player.getPacketSender().sendSound(SOUND_SPINNING, 1, 0);
    ctx.later(player, 3, () => {
      busy.delete(player);
      // Only the fleece still in that slot is spun, in place.
      if (player.getInventory().forSlot(slot)?.getId() !== I.GOLDEN_FLEECE) return;
      setInSlot(player, slot, I.GOLDEN_WOOL);
      xp(player, Skill.CRAFTING, GOLDEN_WOOL_XP);
    });
  }

  /** The fleece used on the wheel spins two ticks after arrival (1002313 t317 -> t319, 1002236 t4410 -> t4412). */
  function spinFleeceOnWheel(event) {
    event.handled = true;
    const { player } = event;
    const from = player.getLocation().clone();
    ctx.later(player, 2, () => {
      // Spin only the fleece still in the used slot, and only if the player stayed at the wheel.
      if (!player.getLocation().equals(from)) return;
      if (player.getInventory().forSlot(event.itemSlot)?.getId() !== I.GOLDEN_FLEECE) return;
      spinFleece(player, event.object, event.itemSlot);
    });
  }

  function spinAtWheel(event) {
    if (!ctx.held(event.player, I.GOLDEN_FLEECE)) return false;
    spinFleece(event.player, event.object);
    return true;
  }

  /** Play on the strung lyre before its enchantment (1001364 t2435). */
  function playStrungLyre(event) {
    startLines(event.player, [{ player: "I really wouldn't know where to begin playing anything on this..." }]);
    return true;
  }

  /** A short chat of our own lines; `done` runs on the last continue. */
  function startLines(player, lines, done) {
    const { DialogueChainBuilder, NpcDialogue, PlayerDialogue, ActionDialogue } = api.core;
    const builder = new DialogueChainBuilder();
    lines.forEach((line, index) => builder.add(line.player !== undefined
      ? new PlayerDialogue(index, line.player)
      : new NpcDialogue(index, line.npcId, line.text, line.name, line.expression)));
    builder.add(new ActionDialogue(lines.length, { execute: () => {
      player.getPacketSender().sendInterfaceRemoval();
      done?.();
    } }));
    player.getDialogueManager().startDialogues(builder);
  }

  // --------------------------------------------------------------------------------------------------------------
  // Rock soup

  /** Lalli's cauldron: 1002236 t4140-4186, 1001364 t1975-2064. */
  function addToSoup(event) {
    const entry = SOUP_ITEMS.get(event.itemId);
    if (!entry) return false;
    event.handled = true;
    const { player } = event;
    if (!active(player)) {
      startTranscript(api, player, [...NPC.LALLI][0], PAGE_LALLI, V.stewRefuse); // Wiki
      return true;
    }
    if (ctx.flag(player, entry.bit) || slotOf(player, event.itemId, event.itemSlot) < 0) {
      player.sendMessage("Nothing interesting happens."); // Ours: a second of the same item
      return true;
    }
    ctx.take(player, event.itemId, 1);
    ctx.setFlag(player, entry.bit);
    setBard(player, BIT_PLAN);
    player.sendMessage(entry.message);
    const lalli = [...NPC.LALLI][0];
    if (soupDone(player)) {
      ctx.play(player, lalli, V.soup, (steps) => ctx.stepsById(STEP.soupDone)(steps)[0]?.steps ?? []);
    } else if (event.itemId !== I.PET_ROCK) {
      // "It am ready now?" / "Not just yet..." (the put message step itself was sent above).
      ctx.play(player, lalli, V.soup, (steps) => (ctx.stepsById(STEP.soupVegetable)(steps)[0]?.steps ?? []).slice(1));
    } else {
      player.getPacketSender().sendInterfaceRemoval();
    }
    return true;
  }

  // --------------------------------------------------------------------------------------------------------------
  // Fossegrimen

  function spawnFossegrimen(player) {
    const current = fossegrimen.get(player);
    if (current && current.isRegistered?.() !== false) return current;
    const [x, y, z] = FOSSEGRIMEN_TILE;
    const npc = api.spawnNpc({ id: NPC.FOSSEGRIMEN, x, y, z, wanderRadius: 0, owner: player, ownerOnly: true });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    fossegrimen.set(player, npc);
    watchFossegrimen(player, npc);
    return npc;
  }

  /** She stays until the player leaves her view (1002236 t4825, 1001364 t2728). */
  function watchFossegrimen(player, npc) {
    const task = new api.core.Task(1, false);
    task.execute = () => {
      const gone = player.isRegistered?.() === false || npc.isRegistered?.() === false;
      const far = !gone && (player.getLocation().getZ() !== npc.getLocation().getZ()
        || Math.max(Math.abs(player.getLocation().getX() - npc.getLocation().getX()),
          Math.abs(player.getLocation().getY() - npc.getLocation().getY())) > FOSSEGRIMEN_VIEW);
      if (!gone && !far) return;
      task.stop();
      removeFossegrimen(player, npc);
    };
    api.core.TaskManager.submit(task);
  }

  function removeFossegrimen(player, npc = fossegrimen.get(player)) {
    if (fossegrimen.get(player) === npc) fossegrimen.delete(player);
    if (npc && npc.isRegistered?.() !== false) api.removeNpc(npc);
  }

  function faceEachOther(player, npc) {
    npc.setPositionToFace(player.getLocation().clone());
    player.setPositionToFace(npc.getLocation().clone());
  }

  /** The blessing, all in one tick (1002236 t4800): the enchanted lyre goes into the fish's slot. */
  function enchantLyre(player, fishSlot, blessingAfterRunner = false) {
    const fish = player.getInventory().forSlot(fishSlot)?.getId();
    if (!WORTHY_FISH.includes(fish)) return false;
    const lyreSlot = slotOf(player, I.LYRE);
    if (lyreSlot < 0) return false;
    const inventory = player.getInventory();
    inventory.setItem(lyreSlot, empty());
    inventory.setItem(fishSlot, new api.core.Item(I.ENCHANTED_LYRE, 1));
    inventory.refreshItems();
    player.sendMessage("Fossegrimen has enchanted your lyre so that you may play it.");
    animate(player, SEQ_LYRE_ENCHANT);
    player.performGraphic(new Graphic(SPOTANIM_ENCHANT));
    player.getPacketSender().sendSound(SOUND_ENCHANT, 1, 0);
    const npc = spawnFossegrimen(player);
    if (npc) faceEachOther(player, npc);
    const bless = () => startLines(player, [{ npcId: NPC.FOSSEGRIMEN, name: "Fossegrimen", text: FOSSEGRIMEN_BLESSING, expression: CHATNEU2 }]);
    // From the Summon menu the runner is still finishing the menu's branch (its jump leaves the record and
    // ends the chat): the blessing opens once it has, in the same tick.
    if (blessingAfterRunner) queueMicrotask(bless);
    else bless();
    return true;
  }

  /** A worthy raw fish on the altar with the strung lyre held (1002236 t4795, 1001364 t2690, 1002247). */
  function offerFish(event) {
    const { player } = event;
    if (!active(player) || !ctx.held(player, I.LYRE)) return false; // no source: "Nothing interesting happens."
    if (player.getInventory().forSlot(event.itemSlot)?.getId() !== event.itemId) return true;
    event.handled = true;
    enchantLyre(player, event.itemSlot);
    return true;
  }

  /** Summon (1001364 t2661): she rises (once) and asks what the player wants. */
  function summonFossegrimen(event) {
    const { player } = event;
    if (!active(player)) return false;
    const npc = spawnFossegrimen(player);
    if (npc) faceEachOther(player, npc);
    startTranscript(api, player, NPC.FOSSEGRIMEN, ctx.PAGE, V.fossegrimen, undefined, npc);
    return true;
  }

  /** Talk-to on her (1001364 t2700) plays the same talk. */
  function talkToFossegrimen(event) {
    const { player, npc } = event;
    if (!npc || fossegrimen.get(player) !== npc) return false;
    faceEachOther(player, npc);
    startTranscript(api, player, NPC.FOSSEGRIMEN, ctx.PAGE, V.fossegrimen, undefined, npc);
    return true;
  }

  // --------------------------------------------------------------------------------------------------------------
  // The longhall

  function nearbyNpc(player, id) {
    const list = player.getLocalNpcs?.();
    const npcs = Array.isArray(list) ? list : list ? [...list.values()] : [];
    return npcs.find((npc) => npc?.getId?.() === id && npc.isRegistered?.() !== false) ?? null;
  }

  /** The door swaps open for the player, who walks through (1002250 t805-808, 1002236 t5715, t5761). */
  function swapDoorOpen(player, destination) {
    const out = player.getPacketSender();
    const door = new GameObject(ObjectIdentifiers.DOOR_118, new Location(DOOR.x, DOOR.y, DOOR.z), 0, 0, null);
    const wall = new GameObject(LOC_INVISWALL, new Location(DOOR.x, DOOR.y, DOOR.z), 0, 0, null);
    const open = new GameObject(LOC_DOOR_INACTIVE, at(BACKSTAGE_TILE), 0, 1, null);
    out.sendObject(wall).sendObject(open);
    out.sendSound(SOUND_DOOR_OPEN, 1, 0);
    const flag = IGNORE_CLIPPING_FLAG;
    const had = player.hasFlag?.(flag) === true;
    player.setFlag?.(flag, true);
    const queue = player.getMovementQueue();
    queue.reset();
    queue.addSteps(destination);
    ctx.later(player, 2, () => {
      if (!had) player.removeFlag?.(flag);
      out.sendObject(door);
      out.sendObjectRemoval(open);
    });
  }

  function handleLonghallDoor(event) {
    const { player, location } = event;
    if (event.objectId !== ObjectIdentifiers.DOOR_118 || event.clickType !== 1 ||
        location.x !== DOOR.x || location.y !== DOOR.y || location.z !== DOOR.z) return;
    event.handled = true;
    const entering = player.getLocation().getX() >= DOOR.x;
    if (!entering) {
      swapDoorOpen(player, new Location(DOOR.x, DOOR.y, DOOR.z));
      return;
    }
    const bouncer = NPC.LONGHALL_BOUNCER;
    if (!ctx.held(player, I.ENCHANTED_LYRE)) {
      // Never captured: the bouncer page's lines (Wiki).
      startTranscript(api, player, bouncer, PAGE_BOUNCER,
        ctx.trialState(player, T.BARD) === 2 ? V.bouncerAfter : V.bouncerRefuse);
      return;
    }
    swapDoorOpen(player, at(BACKSTAGE_TILE));
    ctx.later(player, 1, () => {
      // The next tick the two face each other (1002313 t805, 1002250, 1002236).
      ctx.play(player, bouncer, V.bouncerBackstage);
      const npc = nearbyNpc(player, bouncer);
      if (!npc) return;
      npc.setPositionToFace(player.getLocation().clone());
      player.setPositionToFace(npc.getLocation().clone());
    });
  }

  // --------------------------------------------------------------------------------------------------------------
  // Playing the lyre

  /** The ballad the data's conditions pick, first true in its order (all captures: Champions' Guild). */
  function ballad(player) {
    const targets = balladTargets(player);
    if (targets.champions) return CHAMPIONS_BALLAD;
    const lines = (stepId) => {
      const step = ctx.stepsById(stepId)(loadTranscripts(api)[ctx.PAGE].variants[`${P}-performing-with-the-lyre`])[0];
      return (step?.steps ?? []).filter((entry) => typeof entry.player === "string").map((entry) => entry.player);
    };
    const name = player.getDisplayName?.() ?? player.getUsername();
    // Wiki only: the data's lines as written.
    if (targets.heroes) return lines("HeMAL8");
    if (targets.legends) return lines("g5Bq3g");
    if (targets.skill99) return lines("4GIcyv").map((line) => line.replace("[skill]", targets.skill99.getName()));
    return lines("8aIq_J").map((line) => line.replace("[player name]", name));
  }

  function stopPlaying(player, session) {
    if (playing.get(player) !== session) return;
    playing.delete(player);
    if (session.locked) player.getMovementQueue().setBlockMovement(false);
  }

  /**
   * Off stage (or without the trial to pass) the lyre is only tuned, W = the withdraw: W+1/4/7/10 the scale,
   * W+13 the last strum, W+15 "perfectly tuned" (1001364 t2712-2728). Standing, W is the click tick
   * (1002313 t536); 1001364's T+1/T+2 withdraws came after a step. Walking stops it (t2723, 1002313 t539).
   */
  function tune(player) {
    const session = { locked: false };
    playing.set(player, session);
    const from = player.getLocation().clone();
    const alive = () => playing.get(player) === session && player.getLocation().equals(from)
      && (player.getMovementQueue().size?.() ?? 0) === 0;
    const at = (tick, fn) => ctx.later(player, tick, () => {
      if (!alive()) return stopPlaying(player, session);
      fn();
    });
    const out = player.getPacketSender();
    player.sendMessage("You withdraw your lyre.");
    animate(player, SEQ_LYRE_READY);
    TUNING.forEach((line, index) => at(1 + index * 3, () => {
      player.forceChat(line);
      animate(player, SEQ_LYRE_LOOP);
      out.sendSong(SONG_SILENCE).sendJingle(index === 0 ? JINGLE_REFRAIN_START : JINGLE_REFRAIN_LOOP);
    }));
    at(13, () => {
      animate(player, SEQ_LYRE_ONCE);
      out.sendJingle(JINGLE_REFRAIN_END);
    });
    at(15, () => {
      player.sendMessage("Your lyre is perfectly tuned.");
      stopPlaying(player, session);
    });
  }

  /**
   * The performance (1002250 t814-846, 1002236 t5724-5752, 1001364 t2844-2868), M = the withdraw tick:
   * M+1 ready, M+2/6/10/14 the ballad with silence + refrain jingles, M+18 the three messages, the putaway,
   * the refrain end and Olaf's two lines. The last continue passes the trial. No camera; the player is held.
   */
  function perform(player) {
    const session = { locked: true, finished: false };
    playing.set(player, session);
    const out = player.getPacketSender();
    player.getMovementQueue().reset().setBlockMovement(true);
    player.setPositionToFace(at(AUDIENCE_FACE));
    player.sendMessage("You withdraw your lyre.");
    const step = (tick, fn) => ctx.later(player, tick, () => {
      if (playing.get(player) === session) fn();
    });
    step(1, () => animate(player, SEQ_LYRE_READY));
    ballad(player).forEach((line, index) => step(2 + index * 4, () => {
      player.forceChat(line);
      animate(player, SEQ_LYRE_LOOP);
      out.sendSong(SONG_SILENCE).sendJingle(index === 0 ? JINGLE_REFRAIN_START : JINGLE_REFRAIN_LOOP);
    }));
    heckle(player, session);
    step(18, () => {
      player.sendMessage("Your lyre is perfectly tuned.");
      player.sendMessage("Congratulations! You have completed the Bard's Trial!");
      player.sendMessage("As you finished playing you felt Fossegrimen's power leave you...");
      animate(player, SEQ_LYRE_PUTAWAY);
      out.sendSong(SONG_SILENCE).sendJingle(JINGLE_REFRAIN_END);
      const olaf = [...NPC.OLAF][0];
      startLines(player, OLAF_LINES.map(([text, expression]) => ({ npcId: olaf, name: "Olaf the Bard", text, expression })),
        () => finishPerformance(player, session));
      watchOlafLines(player, session);
    });
  }

  /** Ours: a chat closed some other way than its continue still ends the performance, so nobody stays held. */
  function watchOlafLines(player, session) {
    const task = new api.core.Task(1, false);
    task.execute = () => {
      if (session.finished || playing.get(player) !== session || player.isRegistered?.() === false) {
        task.stop();
        return;
      }
      if (!player.getDialogueManager().isActive?.()) {
        task.stop();
        finishPerformance(player, session);
      }
    };
    api.core.TaskManager.submit(task);
  }

  /** On the last continue, in one tick (1002250 t846): the message, the vote, the lyre back to strung. */
  function finishPerformance(player, session) {
    if (session.finished) return;
    session.finished = true;
    stopPlaying(player, session);
    // Rev 243 dropped "the" (1002313 t863; rev 241/242 said "from the Fossegrimen").
    player.sendMessage("You feel the musical ability from Fossegrimen leave you...");
    ctx.completeTrial(player, T.BARD);
    // Every enchanted lyre held loses it (Wiki); each strung lyre goes to the first free slot (slot 0/12 live).
    let count = player.getInventory().getAmount(I.ENCHANTED_LYRE);
    while (count-- > 0) {
      ctx.take(player, I.ENCHANTED_LYRE, 1);
      ctx.give(player, I.LYRE, 1);
    }
  }

  /**
   * Fridgeir heckles from the crowd at a random point (1002236 M+21/M+24, 1002250 M+14/M+17), but not every
   * time: none in 1001364 or 1002313 though he stood in view. Ours: half the performances.
   */
  function heckle(player, session) {
    if (Math.random() >= HECKLE_CHANCE) return;
    const start = 14 + Math.floor(Math.random() * 8); // Ours: the window between the two captured starts
    HECKLES.forEach((line, index) => ctx.later(player, start + index * 3, () => {
      if (playing.get(player) !== session && !session.finished) return;
      nearbyNpc(player, FRIDGEIR)?.forceChat(line);
    }));
  }

  const HECKLE_CHANCE = 0.5;

  function playEnchantedLyre(event) {
    const { player } = event;
    if (playing.has(player)) return true;
    if (onStage(player) && active(player)) perform(player);
    else tune(player);
    return true;
  }

  // --------------------------------------------------------------------------------------------------------------
  // Login / logout

  function handleLogin({ player }) {
    if (rockGiven(player)) sendRockVarbit(player);
  }

  function handleLogout({ player }) {
    const session = playing.get(player);
    if (session) stopPlaying(player, session);
    busy.delete(player);
    removeFossegrimen(player);
  }

  api.persistAttribute(BARD_ATTRIBUTE, 0);
  ctx.variant(NPC.OLAF, olafVariant);
  ctx.variant(NPC.LALLI, lalliVariant);
  ctx.variant(NPC.ASKELADDEN, askeladdenVariant);
  ctx.variant([NPC.LONGHALL_BOUNCER], bouncerVariant);
  ctx.offer(NPC.OLAF, olafOffer);
  // Askeladden is no council member, but his chain menu's second option is his own (pet rock) talk.
  ctx.offer(NPC.ASKELADDEN, askeladdenVariant);
  ctx.choice(startTrial);
  ctx.condition(answerCondition);
  ctx.line(handleLine);
  ctx.action(STEP.rockAction, rockOnLastLine);
  ctx.action(STEP.rockAgainAction, rockAgain);
  ctx.action(STEP.fleeceAction, fleeceOnLine);
  ctx.action(STEP.planMessage, planBox);
  for (const id of STEP.noFish) ctx.action(id, noFishBox);
  for (const id of STEP.hasFish) ctx.conditionStep(id, presentFish);
  api.onObjectInteraction("Swaying tree", { "Cut-branch": cutBranch });
  api.onItemOnItem("Knife", "Branch", carveLyre);
  api.onItemOnItem("Golden wool", "Unstrung lyre", stringLyre);
  api.onItemOnObject("Golden fleece", "Spinning wheel", spinFleeceOnWheel);
  api.onObjectInteraction("Spinning wheel", { Spin: spinAtWheel });
  api.onItemAction("Lyre", { Play: playStrungLyre });
  api.onItemAction("Enchanted lyre", { Play: playEnchantedLyre });
  api.onItemOnObject("Raw shark", "Strange altar", offerFish);
  api.onItemOnObject("Raw manta ray", "Strange altar", offerFish);
  api.onItemOnObject("Raw sea turtle", "Strange altar", offerFish);
  api.onObjectInteraction("Strange altar", { Summon: summonFossegrimen });
  api.onNpcInteraction("Fossegrimen", { "Talk-to": talkToFossegrimen });
  api.onItemOnObject("Pet rock", "Lalli's Stew", addToSoup);
  api.onItemOnObject("Cabbage", "Lalli's Stew", addToSoup);
  api.onItemOnObject("Potato", "Lalli's Stew", addToSoup);
  api.onItemOnObject("Onion", "Lalli's Stew", addToSoup);
  api.onBeforeObjectInteraction(handleLonghallDoor);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
