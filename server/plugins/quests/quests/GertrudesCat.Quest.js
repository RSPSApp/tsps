/**
 * Gertrude's Cat (members), as the revision 242 capture of a whole run plays it (docs/quests/gertrudes-cat).
 *
 * Gertrude (7284/7723) and the boys Shilop (3501) / Wilough (3503) talk from the "Gertrude's Cat"
 * transcript page, picked here by stage and by which boy was clicked (live words the talk from the
 * clicked boy's side). Fluffs (3497) is indexed only for her post-quest catspeak pages, so her quest
 * clicks, hand-overs and the return scene are played here, on the recorded ticks, with their words
 * read from the same page. The crates in the lumber yard are "Crate" NPCs (kittens_mew 3499).
 *
 * Stages (varp 180): 1 started, 2 paid the boy, 3 gave milk, 4 gave sardine, 5 returned the kitten,
 * 6 complete.
 */
module.exports = function registerGertrudesCatQuest(api) {
  const {
    Skill, ItemIdentifiers, NpcIdentifiers, Task, TaskManager, Area, Boundary, Sounds, Misc, Animation, Location,
    CacheDefinitions, CountdownTask, DialogueChainBuilder, StatementDialogue, ActionDialogue,
  } = api.core;
  const { registerQuest, startTranscript, loadTranscripts, giveReward, questStartMessage } = require("../QuestRuntime");

  const PAGE = "Gertrude's Cat";

  const GERTRUDE_NPC_IDS = new Set([NpcIdentifiers.GERTRUDE, NpcIdentifiers.GERTRUDE_2]);
  const SHILOP_NPC_ID = NpcIdentifiers.SHILOP;
  const WILOUGH_NPC_ID = NpcIdentifiers.WILOUGH;
  const FLUFFS_NPC_ID = NpcIdentifiers.GERTRUDES_CAT_2;
  /** lostkitten: Fluffs' kitten as an actor (dropped, or handed back to Fluffs). */
  const LOST_KITTEN_NPC_ID = NpcIdentifiers.KITTEN; // 3498
  const CRATE_NPC_ID = NpcIdentifiers.CRATE;
  const QUEST_NPC_IDS = new Set([...GERTRUDE_NPC_IDS, SHILOP_NPC_ID, WILOUGH_NPC_ID, FLUFFS_NPC_ID]);

  const VARP_GERTRUDES_CAT = 180;
  const STAGE_STARTED = 1;
  const STAGE_PAID_BOY = 2;
  const STAGE_GAVE_MILK = 3;
  const STAGE_GAVE_SARDINE = 4;
  const STAGE_RESCUED = 5;
  const STAGE_COMPLETE = 6;

  const RAW_SARDINE_ITEM_ID = ItemIdentifiers.RAW_SARDINE;
  const BUCKET_ITEM_ID = ItemIdentifiers.BUCKET;
  const MILK_ITEM_ID = ItemIdentifiers.BUCKET_OF_MILK;
  const BOTTOMLESS_MILK_ITEM_ID = ItemIdentifiers.BOTTOMLESS_MILK_BUCKET;
  const COINS_ITEM_ID = ItemIdentifiers.COINS;
  const SEASONED_SARDINE_ITEM_ID = ItemIdentifiers.SEASONED_SARDINE;
  const FLUFFS_KITTEN_ITEM_ID = ItemIdentifiers.FLUFFS_KITTEN;
  const DOOGLE_LEAVES_ITEM_ID = ItemIdentifiers.DOOGLE_LEAVES;
  const CHOCOLATE_CAKE_ITEM_ID = ItemIdentifiers.CHOCOLATE_CAKE;
  const STEW_ITEM_ID = ItemIdentifiers.STEW;
  const KITTEN_ITEMS = [ItemIdentifiers.PET_KITTEN, ItemIdentifiers.PET_KITTEN_2,
    ItemIdentifiers.PET_KITTEN_3, ItemIdentifiers.PET_KITTEN_4, ItemIdentifiers.PET_KITTEN_5,
    ItemIdentifiers.PET_KITTEN_6];
  const RING_OF_CHAROS_A = ItemIdentifiers.RING_OF_CHAROS_A_;
  const CATSPEAK_AMULETS = new Set([ItemIdentifiers.CATSPEAK_AMULET, ItemIdentifiers.CATSPEAK_AMULET_E_,
    ItemIdentifiers.CATSPEAK_AMULET_2, ItemIdentifiers.CATSPEAK_AMULET_E__2].filter(Number.isInteger));
  const COINS_PRICE = 100;

  /** Gamevals the capture names (the quest scroll's model, the player's and the cats' animations). */
  const SCROLL_KITTEN = "kittenobject_dummy";
  const PICKUP_SEQ = "human_pickupfloor";
  const CAT_ATTACK_SEQ = "cat_attack";
  const BUSY_VARBIT = 12393;
  const MEW_SOUND_ID = 339; // kittens_mew

  const lookupItem = (name) => CacheDefinitions.getObjId(name);
  const seq = (name) => CacheDefinitions.getSeqId(name);

  // ---------------------------------------------------------------------------------------------
  // Variants of the page, by stage and by boy
  // ---------------------------------------------------------------------------------------------

  /** The boys' talk is worded from the clicked boy's side (capture ticks 148-290, 765-782). */
  const BOY_VARIANTS = {
    [SHILOP_NPC_ID]: {
      first: "talking-to-shilop-and-wilough",
      paid: "talking-to-shilop-and-wilough-talking-to-them-again",
      found: "finding-fluffs-talking-to-shilop-and-wilough-again",
    },
    [WILOUGH_NPC_ID]: {
      first: "talking-to-shilop-and-wilough-talking-to-wilough",
      paid: "talking-to-shilop-and-wilough-talking-to-wilough-again",
      found: "finding-fluffs-talking-to-wilough-again",
    },
  };
  const FLUFFS_TALK_VARIANT = "finding-fluffs-talk-to-fluffs";
  const FLUFFS_STROKE_VARIANT = "finding-fluffs-stroke-fluffs";
  const FLUFFS_PICKUP_VARIANTS = {
    [STAGE_PAID_BOY]: "finding-fluffs-pick-up-fluffs",
    [STAGE_GAVE_MILK]: "finding-fluffs-pick-up-fluffs-2",
    [STAGE_GAVE_SARDINE]: "making-seasoned-sardines-pick-up-fluffs",
  };
  const FLUFFS_AFTER_PICKUP_VARIANT = "after-the-quest-pick-up-fluffs";
  const MILK_VARIANT = "finding-fluffs-giving-fluffs-milk";
  const SARDINE_VARIANT = "making-seasoned-sardines-giving-the-seasoned-sardines-to-fluffs";
  const SEASONING_VARIANT = "making-seasoned-sardines";
  const CRATES_VARIANT = "spooky-crates-in-the-lumberyard";
  const CRATE_FIND_VARIANT = "making-seasoned-sardines-searching-crates";
  const RETURN_VARIANT = "making-seasoned-sardines-returning-the-kitten-to-fluffs";

  const START_HOOK = "quest:gertrude-s-cat:start";
  const COINS_TEXT = "You give the lad 100 coins.";
  const COINS_BOX_ID = "gertrudes-cat:coins-box";
  /** The pay branch's last line; paying Wilough, the coins go and the stage moves once it is continued (tick 274). */
  const PAID_LAST_LINE = "Well, you'll have to find the broken fence to get in. I'm sure you can manage that.";
  const RECEIVE_KITTEN_ACTION_ID = "hXsla7";
  const FOOD_ACTION_ID = "LPHGJg";
  const COMPLETE_ACTION_ID = "Rf4BAK";
  const REPLACEMENT_KITTEN_ACTION_ID = "Q44J0B";

  // ---------------------------------------------------------------------------------------------
  // Recorded timings (ticks after the player reaches the target), capture GertrudesCat.bin
  // ---------------------------------------------------------------------------------------------

  /** Pick-up/Stroke: the reach at 0, Fluffs' swipe and hiss at 2, the player's "Ouch!" at 3, the hint at 7 (418-426). */
  const HISS_TICKS = 2;
  const OUCH_TICKS = 3;
  const HINT_TICKS = 7;
  /** Searching a crate, barrel or lumber-yard crate: the second line 4 ticks after the first (386-408, 569-577). */
  const SEARCH_TICKS = 4;
  /** Dropping the kitten: it mews a tick later, runs off at 6, and is gone 2 ticks after the box (606-615). */
  const DROP_MEW_TICKS = 1;
  const DROP_RUN_TICKS = 6;
  const DROP_GONE_TICKS = 2;
  /** Returning the kitten: purrs at 2 and 3, the walk away from 6 to 10, the box at 11 (665-676). */
  const RETURN_PURR_TICKS = [2, 3];
  const RETURN_WALK_TICKS = 6;
  const RETURN_BOX_TICKS = 11;
  const RETURN_WALK_STEPS = 5;
  /** Where the kitten was last seen, by the loft's ladder (tick 675). */
  const RETURN_KITTEN_GOAL = [3311, 3510];
  /** Ours: no capture shows when Fluffs is back on her spot for everyone else. */
  const FLUFFS_HOME_TICKS = 25;
  /** The reward: the kitten on continue (862), "... and some food!" 5 ticks later, the scroll 4 after (868, 872). */
  const FOOD_TICKS = 5;
  const SCROLL_TICKS = 9;
  const KITTEN_SPAWN_LINES = ["Miaow!", "Meeooow!"];

  // The helper marks the mewing "Crate" NPCs in the Lumber Yard.
  const LUMBERYARD_CRATE_BOUNDS = { minX: 3298, maxX: 3315, minY: 3499, maxY: 3515, z: 0 };
  const KITTEN_CRATE_ATTRIBUTE = "gertrudes-cat:kitten-crate";
  /** The cake and stew the reward still owes (logged out between the kitten and the food). */
  const FOOD_OWED_ATTRIBUTE = "gertrudes-cat:food-owed";
  const crateTiles = require("../../../data/definitions/npc-spawns.json")
    .filter((spawn) => isLumberyardCrate({ npcId: spawn.id, location: { x: spawn.x, y: spawn.y, z: spawn.level } }))
    .map((spawn) => `${spawn.x},${spawn.y}`);
  const mewCountdowns = new WeakMap();
  // shortcut: rsprox 3221/3222/3225 gives 25–49 tick gaps, refine uniform sampling when the retail distribution is known.
  const MEW_MIN_TICKS = 25;
  const MEW_MAX_TICKS = 49;
  /** The lumber yard's empty barrels and crate (locs), searched as the capture shows (386-398, 3222 tick 11648). */
  const EMPTY_SEARCH_LOCS = { gertrudeempty_barrel: "barrel", gertrudeempty_crate: "crate" };

  let quest;
  /** player -> the delay holding them (Fluffs' swipe, a search, a drop, the return scene). */
  const holds = new WeakMap();
  /** player -> true once the coins box showed: the payment commits on the last line. */
  const pendingPayments = new WeakMap();
  /** player -> the dropped or returned kitten actor. */
  const kittenActors = new WeakMap();
  /** player -> the reward in progress (so a second click can't start it twice). */
  const rewards = new WeakMap();
  const chosenKittens = new WeakMap();
  const scrollKittens = new WeakMap();
  const initialMenus = new WeakMap();
  /** player -> the rest of the milk or sardine hand-over (the stage moves a tick later); a logout runs it at once. */
  const handing = new WeakMap();
  /** Fluffs NPCs on their way home, and where to put them back. */
  const homeward = new WeakMap();

  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  /** Fluffs' kitten anywhere the player keeps it: the backpack or a bank tab. */
  const holdsKitten = (player) => hasItem(player, FLUFFS_KITTEN_ITEM_ID)
    || (player.getBanks?.() ?? []).some((bank) => bank?.contains?.(FLUFFS_KITTEN_ITEM_ID));
  const variantSteps = (variant) => loadTranscripts(api)?.[PAGE]?.variants?.[variant] ?? [];
  /** A variant's words by kind: the cat's overhead, the player's line, the message box. */
  function variantWords(variant) {
    const steps = variantSteps(variant);
    return {
      cat: steps.find((step) => step.type === "line")?.text,
      kitten: steps.filter((step) => step.type === "line")[1]?.text,
      player: steps.find((step) => typeof step.player === "string")?.player,
      message: steps.find((step) => step.type === "message")?.text,
      action: steps.find((step) => step.type === "action")?.text,
    };
  }

  function later(player, ticks, fn) {
    TaskManager.submit(new CountdownTask(player, ticks, () => {
      if (player.isRegistered?.() === false) return;
      fn();
    }));
  }

  // ---------------------------------------------------------------------------------------------
  // The player's delay: movement and clicks held, the client's BUSY varbit on (the capture's `busy`)
  // ---------------------------------------------------------------------------------------------

  function hold(player) {
    const token = {};
    holds.set(player, token);
    player.getMovementQueue().reset();
    player.getMovementQueue().setBlockMovement(true);
    player.getCombat?.().holdFullStall?.(false);
    player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
    return token;
  }

  function release(player, token) {
    if (holds.get(player) !== token) return;
    holds.delete(player);
    player.getMovementQueue().setBlockMovement(false);
    player.getCombat?.().releaseFullStall?.();
    player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
  }

  const held = (player) => holds.has(player);

  /** A message box; `onContinue` runs when it is continued, or when anything else closes it. */
  function boxThen(player, text, onContinue) {
    const manager = player.getDialogueManager();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onContinue();
    };
    const box = new StatementDialogue(0, text);
    const after = new ActionDialogue(1, { execute: () => {
      manager.reset?.();
      player.getPacketSender().sendInterfaceRemoval();
      finish();
    } });
    manager.startDialogues(new DialogueChainBuilder().add(box).add(after));
    // A box closed some other way still lets the player go.
    const watch = new (class extends Task {
      constructor() { super(1, player, false); }
      execute() {
        if (done) return this.stop();
        if (player.isRegistered?.() === false) { this.stop(); return finish(); }
        const current = manager.getCurrent?.();
        if (current !== box && current !== after) { this.stop(); finish(); }
      }
    })();
    TaskManager.submit(watch);
  }

  // ---------------------------------------------------------------------------------------------
  // Journal (capture ticks 73, 278, 601, 703)
  // ---------------------------------------------------------------------------------------------

  const ACCEPTED = "I accepted the challenge of finding Gertrude's lost cat.";
  const SPOKE = "I spoke to Shilop, Gertrude's Son.";
  const MILK_AND_SARDINES = "I gave the cat milk and sardines.";

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    const done = (line) => `<str>${line}`;
    if (stage >= STAGE_COMPLETE) {
      // Ours: no capture shows the finished journal; every recorded line struck, then the server's usual close.
      return [done(ACCEPTED), done(SPOKE), done("The cat didn't follow me back."), done(MILK_AND_SARDINES),
        done("I gave Fluffs her kitten back."), done("She ran off home."), "", "<col=ff0000>QUEST COMPLETE!"];
    }
    if (stage >= STAGE_RESCUED) {
      return [done(ACCEPTED), done(SPOKE), done("The cat didn't follow me back."), done(MILK_AND_SARDINES),
        done("I gave Fluffs her kitten back."), "", "<col=000080>She ran off home."];
    }
    if (stage >= STAGE_GAVE_SARDINE) {
      return [done(ACCEPTED), done(SPOKE), done("I found the lost cat but it won't come back."), done(MILK_AND_SARDINES), "",
        "<col=000080>I still need to <col=800000>get her to follow me home."];
    }
    if (stage >= STAGE_PAID_BOY) {
      // Stage 3 (milk given) is not recorded; it keeps the stage-2 page.
      return [done(ACCEPTED), done(SPOKE), "",
        "<col=000080>I need to <col=800000>go to their play area <col=000080>and <col=800000>find the lost cat and return",
        "<col=800000>it to Gertrude."];
    }
    if (stage >= STAGE_STARTED) {
      return [done(ACCEPTED), "",
        "<col=000080>I need to <col=800000>speak to Shilop and Wilough<col=000080> at the <col=800000>marketplace."];
    }
    return ["I can start this quest by talking to <col=800000>Gertrude</col> in her house just west of <col=800000>Varrock</col>."];
  }

  // ---------------------------------------------------------------------------------------------
  // Talking: Gertrude and the boys
  // ---------------------------------------------------------------------------------------------

  function gertrudeVariant(stage) {
    if (stage >= STAGE_COMPLETE) return { page: "Gertrude", variant: "standard-dialogue-on-pay-to-play-worlds" };
    if (stage >= STAGE_RESCUED) return "finishing-up";
    if (stage >= STAGE_GAVE_SARDINE) return "making-seasoned-sardines-talking-to-gertrude-after-giving-fluffs-the-sardine";
    if (stage >= STAGE_GAVE_MILK) return "finding-fluffs-talking-to-gertrude-again";
    if (stage >= STAGE_PAID_BOY) return "talking-to-shilop-and-wilough-talking-to-gertrude-again";
    if (stage >= STAGE_STARTED) return "starting-off-talking-to-gertrude-again";
    return "starting-off";
  }

  /**
   * Before paying: the first talk; after paying: where Fluffs is (tick 281-290); once Fluffs is found
   * (recorded at stage 5, tick 765; the Wiki puts it after the milk): the boy's boasting, after the quest too.
   */
  function boyVariant(npcId, stage) {
    const variants = BOY_VARIANTS[npcId];
    if (!variants || stage < STAGE_STARTED) return null;
    const variant = stage >= STAGE_GAVE_MILK ? variants.found : stage >= STAGE_PAID_BOY ? variants.paid : variants.first;
    return { page: PAGE, variant };
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (GERTRUDE_NPC_IDS.has(npcId)) return gertrudeVariant(stage);
    if (BOY_VARIANTS[npcId]) return boyVariant(npcId, stage);
    return null;
  }

  function handleGertrudeInteraction(event) {
    if (!GERTRUDE_NPC_IDS.has(event.npcId)) return false;
    const stage = quest.getStage(event.player);
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return false;
    event.handled = true;
    startTranscript(api, event.player, event.npcId, PAGE, gertrudeVariant(stage));
    return true;
  }

  function answerCondition({ npcId, player, text }) {
    // Gertrude's pages only; other quests share the same prose ("free inventory
    // space") and must answer it themselves.
    if (!GERTRUDE_NPC_IDS.has(npcId) && !BOY_VARIANTS[npcId]) return null;
    const value = String(text).toLowerCase();
    if (value.includes("does not have at least 100 coins")) return player.getInventory().getAmount(COINS_ITEM_ID) < COINS_PRICE;
    if (value.includes("at least 100 coins")) return player.getInventory().getAmount(COINS_ITEM_ID) >= COINS_PRICE;
    if (value.includes("no free inventory space")) return player.getInventory().isFull();
    if (value.includes("free inventory space")) return !player.getInventory().isFull();
    return null;
  }

  function handleStartHook({ player, hook }) {
    if (hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
    // With the stage, as the player's "Well, I suppose I could." is continued (capture tick 63).
    player.sendMessage(questStartMessage(player, quest.name));
  }

  const onPage = (event) => Array.isArray(event.pages) && event.pages.some((entry) => entry?.page === PAGE);

  function handleAction(event) {
    const { player, stepId } = event;
    if (!onPage(event) || !QUEST_NPC_IDS.has(event.npcId)) return handleGertrudePageAction(event);
    const stage = quest.getStage(player);
    // The dump wraps wiki conditionals as `unavailable` steps mid-branch (Gertrude's mDyVfF before
    // the completion action). The shared dialogue runtime closes on them; skip past them instead.
    if (event.step?.type === "unavailable" || event.step?.type === "reference") {
      event.handled = true;
      event.end = false;
      return;
    }
    if (event.kind === "message") {
      // Every box on the page is a message box as live shows it; the coins one carries the coins.
      event.box = stepId === COINS_BOX_ID ? { items: [COINS_ITEM_ID] } : { statement: true };
      event.handled = true;
      return;
    }
    if (event.text === COINS_TEXT) return payTheBoys(event, stage);
    if (stepId === RECEIVE_KITTEN_ACTION_ID) return handOverKitten(event, stage);
    if (stepId === FOOD_ACTION_ID || stepId === COMPLETE_ACTION_ID) {
      // The reward plays them on its own ticks (handOverKitten).
      event.handled = true;
      event.end = true;
    }
  }

  /** Gertrude's own page (her post-quest kitten sale). */
  function handleGertrudePageAction(event) {
    const { player, stepId } = event;
    if (stepId !== REPLACEMENT_KITTEN_ACTION_ID) return;
    event.handled = true;
    if (player.getInventory().getAmount(COINS_ITEM_ID) < COINS_PRICE) {
      player.sendMessage("You need 100 coins to buy another kitten.");
      event.end = true;
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory slot.");
      event.end = true;
      return;
    }
    player.getInventory().deleteNumber(COINS_ITEM_ID, COINS_PRICE);
    player.getInventory().adds(ItemIdentifiers.PET_KITTEN, 1);
    player.sendMessage("Gertrude gives you another kitten.");
  }

  /**
   * The coins box (an objectbox with the coins). Paying Shilop, the coins go and the stage moves as the
   * box shows (local recording 1001963 tick 9154); paying Wilough, once the branch's last line is
   * continued (the whole-quest capture, ticks 267-274).
   */
  function payTheBoys(event, stage) {
    const { player } = event;
    event.handled = true;
    if (stage >= STAGE_PAID_BOY) return;
    if (player.getInventory().getAmount(COINS_ITEM_ID) < COINS_PRICE) {
      // Ours: neither the capture nor the Wiki shows the boys' answer without the coins.
      event.end = true;
      return;
    }
    if (event.npcId === SHILOP_NPC_ID) pay(player);
    else pendingPayments.set(player, true);
    event.steps = [{ type: "message", id: COINS_BOX_ID, text: COINS_TEXT }];
  }

  function pay(player) {
    if (quest.getStage(player) !== STAGE_STARTED) return;
    if (player.getInventory().getAmount(COINS_ITEM_ID) < COINS_PRICE) return;
    player.getInventory().deleteNumber(COINS_ITEM_ID, COINS_PRICE);
    quest.setStage(player, STAGE_PAID_BOY);
  }

  /** Continuing the pay branch's last line takes the coins and moves the stage, as live does (tick 274). */
  function commitPaymentAfterLastLine(request) {
    const { player } = request;
    if (!pendingPayments.has(player) || request.step?.text !== PAID_LAST_LINE) return;
    request.after = () => {
      if (pendingPayments.delete(player)) pay(player);
    };
  }

  /** The page names her "Fluffs", the cache "Gertrude's cat": her overhead lines go over the Fluffs clicked. */
  function bindFluffsLine(request) {
    if (request.step?.presentation !== "overhead" || request.step?.speaker !== "Fluffs") return;
    if (request.npc?.getId?.() === FLUFFS_NPC_ID) request.actors = [request.npc];
  }

  // ---------------------------------------------------------------------------------------------
  // The reward (ticks 862-872)
  // ---------------------------------------------------------------------------------------------

  const wearingCharos = (player) => player.getEquipment?.().get(api.core.Equipment.RING_SLOT)?.getId?.() === RING_OF_CHAROS_A;

  /** "Gertrude gives you a kitten." was continued: the kitten, then the food, then the scroll. */
  function handOverKitten(event, stage) {
    const { player } = event;
    event.handled = true;
    event.end = true;
    if (stage !== STAGE_RESCUED || quest.isComplete(player) || rewards.has(player)) return;
    if (!wearingCharos(player)) return reward(player, null);
    // Wiki (Kitten): with the activated Ring of Charos worn she lets the player choose its colour.
    const token = {};
    initialMenus.set(player, token);
    const cancel = () => { if (initialMenus.get(player) === token) initialMenus.delete(player); };
    const request = { player, opened: false, cancel, choose: (kitten) => {
      if (initialMenus.get(player) !== token) return;
      initialMenus.delete(player);
      if (quest.isComplete(player) || quest.getStage(player) !== STAGE_RESCUED || rewards.has(player)) return;
      if (!wearingCharos(player)) {
        player.sendMessage("Wear your Ring of Charos(a) to choose a kitten. Talk to Gertrude again.");
        return;
      }
      if (!KITTEN_ITEMS.includes(kitten)) return;
      reward(player, kitten);
    } };
    api.emitCustomEvent("gertrude:initial-kitten-menu", request);
    if (!request.opened) {
      cancel();
      reward(player, null);
    }
  }

  function reward(player, chosen) {
    const kitten = chosen ?? KITTEN_ITEMS[Math.floor(Math.random() * KITTEN_ITEMS.length)];
    rewards.set(player, true);
    chosenKittens.set(player, kitten);
    player.setAttribute(FOOD_OWED_ATTRIBUTE, true);
    try {
      quest.complete(player, { scroll: false, announce: false });
    } finally {
      chosenKittens.delete(player);
    }
    later(player, FOOD_TICKS, () => {
      if (!payFood(player)) return;
      player.sendMessage(foodLine());
    });
    later(player, SCROLL_TICKS, () => {
      rewards.delete(player);
      quest.announceCompletion(player);
    });
  }

  const foodLine = () => variantSteps("finishing-up").find((step) => step.id === FOOD_ACTION_ID)?.text ?? "";

  function payFood(player) {
    if (player.getAttribute(FOOD_OWED_ATTRIBUTE) !== true) return false;
    player.setAttribute(FOOD_OWED_ATTRIBUTE, false);
    giveReward(player, CHOCOLATE_CAKE_ITEM_ID, 1);
    giveReward(player, STEW_ITEM_ID, 1);
    return true;
  }

  /** XP, and the kitten as the player's follower (the follower varps and its spawn on continue, tick 863). */
  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.COOKING, 1525);
    const kitten = chosenKittens.get(player) ?? KITTEN_ITEMS[Math.floor(Math.random() * KITTEN_ITEMS.length)];
    scrollKittens.set(player, kitten);
    const summon = { player, itemId: kitten, following: false, pet: null, summoned: false };
    api.emitCustomEvent("pets:summon", summon);
    if (summon.following && summon.pet) {
      // Its "Miaow!" as it appears and "Meeooow!" the tick after (ticks 863-864); a spawn still queued says them a tick on.
      const pet = summon.pet;
      const delay = pet.isRegistered?.() ? 0 : 1;
      KITTEN_SPAWN_LINES.forEach((line, index) => {
        const say = () => { if (pet.isRegistered?.()) pet.forceChat(line); };
        if (delay + index === 0) say();
        else later(player, delay + index, say);
      });
    } else if (!summon.summoned) {
      // No pet system answered: the kitten still has to reach the player.
      giveReward(player, kitten, 1);
    }
  }

  function scrollKitten() {
    return lookupItem(SCROLL_KITTEN);
  }

  // ---------------------------------------------------------------------------------------------
  // Fluffs
  // ---------------------------------------------------------------------------------------------

  /** Her swipe at the player, the "Ouch!", then the hint (Pick-up and Stroke, ticks 418-437). */
  function swipe(player, fluffs, variant) {
    const words = variantWords(variant);
    const token = hold(player);
    player.performAnimation(new Animation(seq(PICKUP_SEQ)));
    later(player, HISS_TICKS, () => {
      if (!fluffs?.isRegistered?.()) return;
      fluffs.performAnimation(new Animation(seq(CAT_ATTACK_SEQ)));
      fluffs.setPositionToFace?.(player.getLocation());
      if (words.cat) fluffs.forceChat(words.cat);
    });
    later(player, OUCH_TICKS, () => {
      if (words.player) player.forceChat(words.player);
    });
    later(player, HINT_TICKS, () => {
      if (holds.get(player) !== token) return;
      if (!words.message) return release(player, token);
      boxThen(player, words.message, () => release(player, token));
    });
  }

  function handleFluffsInteraction(event) {
    if (event.npcId !== FLUFFS_NPC_ID) return;
    const { player } = event;
    const stage = quest.getStage(player);
    const actions = event.definition?.getActions?.() ?? [];
    const action = String(actions[event.clickType - 1] ?? event.option ?? "").toLowerCase();
    if (held(player)) {
      event.handled = true;
      return;
    }
    if (action === "stroke") {
      // The same hint at every stage, before the quest is done and after it (rsprox.net 3222 tick 12362).
      event.handled = true;
      swipe(player, event.npc, FLUFFS_STROKE_VARIANT);
      return;
    }
    if (action === "pick-up") {
      event.handled = true;
      if (stage >= STAGE_RESCUED) {
        startTranscript(api, player, FLUFFS_NPC_ID, PAGE, FLUFFS_AFTER_PICKUP_VARIANT, null, event.npc);
        return;
      }
      // Ours: before the boys are paid (not recorded) she gives the first hint.
      swipe(player, event.npc, FLUFFS_PICKUP_VARIANTS[stage] ?? FLUFFS_PICKUP_VARIANTS[STAGE_PAID_BOY]);
      return;
    }
    if (action === "talk-to") {
      // With a catspeak amulet worn after the hand-in, her catspeak pages answer (Pets / NpcDialogues,
      // rsprox.net 3222 tick 12487). Otherwise only "Miaoww" over her head, no chatbox (tick 442).
      const amulet = player.getEquipment?.().get(api.core.Equipment.AMULET_SLOT)?.getId?.();
      if (stage >= STAGE_RESCUED && CATSPEAK_AMULETS.has(amulet)) return;
      event.handled = true;
      const words = variantWords(FLUFFS_TALK_VARIANT);
      if (words.cat && event.npc?.forceChat) event.npc.forceChat(words.cat);
    }
  }

  /** Milk, then the seasoned sardine, then her kitten (ticks 449-450, 479-480, 665). */
  function handleItemOnCat(event) {
    if ((event.npcId ?? event.target?.getId?.()) !== FLUFFS_NPC_ID) return;
    const { player, itemId } = event;
    const fluffs = event.target ?? event.npc;
    const stage = quest.getStage(player);
    if (held(player) || handing.has(player)) {
      event.handled = true;
      return;
    }
    if ((itemId === MILK_ITEM_ID || itemId === BOTTOMLESS_MILK_ITEM_ID) && stage === STAGE_PAID_BOY) {
      if (itemId === MILK_ITEM_ID) {
        player.getInventory().deleteNumber(MILK_ITEM_ID, 1);
      } else {
        // Wiki (Bottomless milk bucket): one use of its regular milk, not the whole bucket.
        const use = { player, type: MILK_ITEM_ID, item: event.item, spent: false };
        api.emitCustomEvent?.("bottomless-milk:spend", use);
        if (!use.spent) return;
      }
      event.handled = true;
      player.performAnimation(new Animation(seq(PICKUP_SEQ)));
      handOver(player, () => {
        if (itemId === MILK_ITEM_ID) player.getInventory().adds(BUCKET_ITEM_ID, 1);
        if (quest.getStage(player) === STAGE_PAID_BOY) quest.setStage(player, STAGE_GAVE_MILK);
      }, fluffs, MILK_VARIANT);
      return;
    }
    if (itemId === SEASONED_SARDINE_ITEM_ID && stage === STAGE_GAVE_MILK) {
      event.handled = true;
      player.getInventory().deleteNumber(SEASONED_SARDINE_ITEM_ID, 1);
      player.performAnimation(new Animation(seq(PICKUP_SEQ)));
      handOver(player, () => {
        if (quest.getStage(player) === STAGE_GAVE_MILK) quest.setStage(player, STAGE_GAVE_SARDINE);
      }, fluffs, SARDINE_VARIANT);
      return;
    }
    if (itemId === FLUFFS_KITTEN_ITEM_ID && stage === STAGE_GAVE_SARDINE) {
      event.handled = true;
      player.getInventory().deleteNumber(FLUFFS_KITTEN_ITEM_ID, 1);
      quest.setStage(player, STAGE_RESCUED);
      player.performAnimation(new Animation(seq(PICKUP_SEQ)));
      returnKitten(player, fluffs);
      return;
    }
    // Anything else (milk twice, a sardine after the quest): the game's line (Wiki, Seasoned sardine).
    event.handled = true;
    player.sendMessage("Nothing interesting happens.");
  }

  /** The item went at once; the stage (and the empty bucket) and her "Mew!" follow a tick later. */
  function handOver(player, finish, fluffs, variant) {
    handing.set(player, finish);
    later(player, 1, () => {
      if (handing.get(player) !== finish) return;
      handing.delete(player);
      finish();
      const words = variantWords(variant);
      if (words.cat && fluffs?.isRegistered?.()) fluffs.forceChat(words.cat);
    });
  }

  /** Fluffs and her kitten purr, walk off towards the ladder and are gone (ticks 665-676). */
  function returnKitten(player, fluffs) {
    removeKittenActor(player);
    const words = variantWords(RETURN_VARIANT);
    const token = hold(player);
    const at = player.getLocation();
    const kitten = api.spawnNpc({ id: LOST_KITTEN_NPC_ID, x: at.getX(), y: at.getY(), z: at.getZ(), owner: player, ownerOnly: true, wanderRadius: 0 });
    if (kitten) kittenActors.set(player, kitten);
    const fluffsHome = fluffs?.getLocation?.()?.clone?.();
    if (fluffs && fluffsHome && !homeward.has(fluffs)) homeward.set(fluffs, fluffsHome);
    later(player, RETURN_PURR_TICKS[0], () => fluffs?.isRegistered?.() && words.cat && fluffs.forceChat(words.cat));
    later(player, RETURN_PURR_TICKS[1], () => kitten?.isRegistered?.() && words.kitten && kitten.forceChat(words.kitten));
    // The kitten leads off towards the ladder and Fluffs follows its trail (ticks 671-675).
    let trail = at.clone();
    for (let step = 0; step < RETURN_WALK_STEPS; step++) {
      later(player, RETURN_WALK_TICKS + step, () => {
        const left = kitten?.isRegistered?.() ? kitten.getLocation().clone() : trail;
        if (kitten?.isRegistered?.()) stepToward(kitten, RETURN_KITTEN_GOAL[0], RETURN_KITTEN_GOAL[1]);
        if (fluffs?.isRegistered?.() && homeward.has(fluffs)) stepToward(fluffs, trail.getX(), trail.getY());
        trail = left;
      });
    }
    later(player, RETURN_BOX_TICKS, () => {
      removeKittenActor(player);
      if (fluffs) sendFluffsHome(fluffs);
      if (holds.get(player) !== token) return;
      if (!words.message) return release(player, token);
      boxThen(player, words.message, () => release(player, token));
    });
  }

  /** One walkable step towards a tile: straight at it, else along one axis. */
  function stepToward(npc, x, y) {
    const queue = npc.getMovementQueue();
    const at = npc.getLocation();
    const dx = Math.sign(x - at.getX());
    const dy = Math.sign(y - at.getY());
    for (const [sx, sy] of [[dx, dy], [dx, 0], [0, dy]]) {
      if ((sx !== 0 || sy !== 0) && queue.canWalk(sx, sy)) {
        queue.walkStep(sx, sy);
        return;
      }
    }
  }

  /** Fluffs leaves the loft and is back on her spot a little later (Ours: the delay). */
  function sendFluffsHome(fluffs) {
    const home = homeward.get(fluffs);
    if (!home || !fluffs.isVisible?.()) return;
    fluffs.setVisible(false);
    fluffs.getMovementQueue().reset();
    TaskManager.submit(new CountdownTask(fluffs, FLUFFS_HOME_TICKS, () => restoreFluffs(fluffs)));
  }

  function restoreFluffs(fluffs) {
    const home = homeward.get(fluffs);
    homeward.delete(fluffs);
    if (!home || !fluffs.isRegistered?.()) return;
    fluffs.moveTo(home);
    fluffs.setVisible(true);
  }

  // ---------------------------------------------------------------------------------------------
  // The kitten: crates, dropping it
  // ---------------------------------------------------------------------------------------------

  function isLumberyardCrate(event) {
    if ((event.npcId ?? event.npc?.getId?.()) !== CRATE_NPC_ID) return false;
    const location = event.npc?.getLocation?.() ?? event.location;
    if (!location) return false;
    const x = location.x ?? location.getX?.();
    const y = location.y ?? location.getY?.();
    const z = location.z ?? location.getZ?.() ?? 0;
    const bounds = LUMBERYARD_CRATE_BOUNDS;
    return z === bounds.z && x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
  }

  /** The Wiki: one crate per player holds the kitten, whatever the mews do. */
  function kittenCrate(player) {
    let tile = player.getAttribute(KITTEN_CRATE_ATTRIBUTE);
    if (!crateTiles.includes(tile)) {
      // Lazy selection also covers saves already at stage 4 when this fix is installed.
      tile = crateTiles[Misc.randomInclusive(0, crateTiles.length - 1)];
      player.setAttribute(KITTEN_CRATE_ATTRIBUTE, tile);
    }
    return tile;
  }

  function resetKittenCrate({ player, key, stage }) {
    if (key === "gertrudes_cat" && stage === 0) player.setAttribute(KITTEN_CRATE_ATTRIBUTE, null);
  }

  function createCrateArea() {
    class CrateArea extends Area {
      process(mobile) {
        if (!mobile.isNpc?.() || !isLumberyardCrate({ npc: mobile })) return;
        let remaining = mewCountdowns.get(mobile);
        if (remaining === undefined) remaining = Misc.randomInclusive(MEW_MIN_TICKS, MEW_MAX_TICKS);
        if (remaining > 1) {
          mewCountdowns.set(mobile, remaining - 1);
          return;
        }
        mew(mobile);
        mewCountdowns.delete(mobile);
      }
    }
    const { minX, maxX, minY, maxY, z } = LUMBERYARD_CRATE_BOUNDS;
    return new CrateArea([new Boundary(minX, maxX, minY, maxY, z)]);
  }

  function mew(npc) {
    npc.forceChat(variantWords(CRATES_VARIANT).cat ?? "Mew!");
    const at = npc.getLocation();
    Sounds.playAreaSound({ soundId: MEW_SOUND_ID, x: at.getX(), y: at.getY(), level: at.getZ(), radius: 10, source: npc });
  }

  /** "You search the crate.", then four ticks later the kitten or nothing (ticks 403-408, 569-579). */
  function handleCrateSearch(event) {
    if (!isLumberyardCrate(event)) return false;
    const action = event.definition?.getActions?.()[event.clickType - 1] ?? event.option;
    if (String(action ?? "").toLowerCase() !== "search") return false;
    const { player } = event;
    event.handled = true;
    if (held(player)) return true;
    const at = event.npc?.getLocation?.() ?? event.location;
    const tile = `${at.x ?? at.getX()},${at.y ?? at.getY()}`;
    player.sendMessage("You search the crate.");
    const token = hold(player);
    later(player, SEARCH_TICKS, () => {
      if (holds.get(player) !== token) return;
      const finds = quest.getStage(player) === STAGE_GAVE_SARDINE && !holdsKitten(player)
        && !kittenActors.has(player) && tile === kittenCrate(player);
      if (!finds) {
        player.sendMessage("You find nothing.");
        return release(player, token);
      }
      boxThen(player, variantWords(CRATE_FIND_VARIANT).message, () => {
        release(player, token);
        if (holdsKitten(player) || quest.getStage(player) !== STAGE_GAVE_SARDINE) return;
        // The kitten goes into the backpack as the box is continued (tick 579); a full one leaves it at the player's feet.
        giveReward(player, FLUFFS_KITTEN_ITEM_ID, 1);
      });
    });
    return true;
  }

  /** The lumber yard's barrels and loose crate: searched, nothing found (ticks 386-398, 3222 tick 11648). */
  function handleEmptySearch(event) {
    const entry = Object.entries(EMPTY_SEARCH_LOCS).find(([loc]) => CacheDefinitions.getLocId(loc) === event.objectId);
    if (!entry) return false;
    const { player } = event;
    if (held(player)) return true;
    player.sendMessage(`You search the ${entry[1]}.`);
    const token = hold(player);
    later(player, SEARCH_TICKS, () => {
      if (holds.get(player) !== token) return;
      player.sendMessage("You find nothing.");
      release(player, token);
    });
    return true;
  }

  /** The Wiki: a dropped kitten runs off into the crates again (ticks 606-615). */
  function dropKitten(event) {
    const { player } = event;
    if (!hasItem(player, FLUFFS_KITTEN_ITEM_ID) || held(player)) return;
    player.getInventory().deleteNumber(FLUFFS_KITTEN_ITEM_ID, 1);
    player.sendMessage("You place the kitten on the floor.");
    const token = hold(player);
    removeKittenActor(player);
    const at = player.getLocation();
    const kitten = api.spawnNpc({ id: LOST_KITTEN_NPC_ID, x: at.getX(), y: at.getY(), z: at.getZ(), owner: player, ownerOnly: true, wanderRadius: 0 });
    if (kitten) kittenActors.set(player, kitten);
    later(player, DROP_MEW_TICKS, () => kitten?.isRegistered?.() && mew(kitten));
    later(player, DROP_RUN_TICKS, () => {
      if (holds.get(player) !== token) return;
      boxThen(player, "The kitten has run off!", () => {
        release(player, token);
        later(player, DROP_GONE_TICKS, () => { if (kittenActors.get(player) === kitten) removeKittenActor(player); });
      });
    });
  }

  function removeKittenActor(player) {
    const kitten = kittenActors.get(player);
    if (!kitten) return;
    kittenActors.delete(player);
    api.removeNpc(kitten);
  }

  /** Seasoning a raw sardine with doogle leaves (either order); the Wiki's words. */
  function handleItemOnItem(event) {
    const ids = [event.usedItemId, event.usedWithItemId];
    if (!ids.includes(DOOGLE_LEAVES_ITEM_ID) || !ids.includes(RAW_SARDINE_ITEM_ID)) return;
    const { player } = event;
    player.getInventory().deleteNumber(DOOGLE_LEAVES_ITEM_ID, 1);
    player.getInventory().deleteNumber(RAW_SARDINE_ITEM_ID, 1);
    player.getInventory().adds(SEASONED_SARDINE_ITEM_ID, 1);
    player.sendMessage(variantWords(SEASONING_VARIANT).action ?? "");
    event.handled = true;
  }

  function handleLogout({ player }) {
    removeKittenActor(player);
    pendingPayments.delete(player);
    // A hand-over cut by the logout still lands, so the save never holds the item gone and the stage not moved.
    const finish = handing.get(player);
    handing.delete(player);
    finish?.();
    const token = holds.get(player);
    if (token) release(player, token);
    // The food the reward still owed comes with the save, and is handed over at the next login.
    rewards.delete(player);
  }

  function handleLogin({ player }) {
    if (player.getAttribute(FOOD_OWED_ATTRIBUTE) === true && quest.isComplete(player)) payFood(player);
  }

  quest = registerQuest(api, {
    key: "gertrudes_cat",
    name: "Gertrude's Cat",
    varpId: VARP_GERTRUDES_CAT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.COOKING.getIndex(), amount: 1525, label: "Cooking" }],
    scrollItemId: scrollKitten,
    rewardItemLabel: "A Kitten",
    otherRewards: ["A Chocolate Cake", "Some Stew"],
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(KITTEN_CRATE_ATTRIBUTE, null);
  api.persistAttribute(FOOD_OWED_ATTRIBUTE, false);
  api.registerArea(createCrateArea());
  api.onCustomEvent("quest:stage-changed", resetKittenCrate);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcInteraction("Gertrude", { "Talk-to": handleGertrudeInteraction });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", commitPaymentAfterLastLine);
  api.onCustomEvent("npc-dialogue:line", bindFluffsLine);
  api.onPlayerLogout(handleLogout);
  api.onPlayerLogin(handleLogin);
  api.onNpcInteraction(handleFluffsInteraction);
  api.onItemOnNpc(handleItemOnCat);
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction("Fluffs' kitten", { Drop: dropKitten });
  api.onNpcInteraction("Crate", { Search: handleCrateSearch });
  api.onObjectInteraction("Barrel", { Search: handleEmptySearch });
  api.onObjectInteraction("Crate", { Search: handleEmptySearch });
};
