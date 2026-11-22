/**
 * Rum Deal (members), aligned with a whole run of the quest on live: the user's RSProx capture
 * RumDeal.bin (revision 242.1; docs/quests/rum-deal/README.md, with every capture fact the plugin
 * relies on and the recording's ticks). The words are the Wiki's: the "Rum Deal" transcript (with the
 * lines it lacks added from the capture in osrsreboxed-db's capture-sources.json), and the Pirate Pete,
 * 50% Luke, Captain Braindeath, Brewer, Davey and Captain Donnie pages for the start, the gate and
 * everything after the quest.
 *
 * The units in plugins/quests/rumdeal/: State (stages, varbits, ids), Journal, Patch (the blindweed
 * patch), Brewery (hopper, barrel and lever, controls and the Evil Spirit, tap, lake, squid spot) and
 * Scenes (the knock-out with cutscene 1, the window, Davey's blessing, the brew, Pete's lifts).
 *
 * Rewards (the capture's scroll, tick 2813; the Wiki): 2 Quest points, 7,000 Prayer, Fishing and
 * Farming XP and the holy wrench Davey has already blessed.
 */
module.exports = function registerRumDealQuest(api) {
  const { DialogueChainBuilder, Equipment, ItemIdentifiers: I, Skill, StatementDialogue } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, loadTranscripts } = require("../QuestRuntime");
  const { STAGES, VARP_QUEST, VARBITS, ATTRIBUTES, PAGE, NPCS, BREWER_NUMBER, TILES } = require("../rumdeal/State.RumDeal");
  const { journal } = require("../rumdeal/Journal.RumDeal");

  const PETE_PAGE = "Pirate Pete";
  const LUKE_PAGE = "50% Luke";
  const SLAYER_GLOVES = new Set([I.SLAYER_GLOVES, I.SLAYER_GLOVES_2]);
  const RINGS_OF_CHAROS = new Set([4202, 6465]); // Ring of charos, Ring of charos (a)
  const TINDERBOX = I.TINDERBOX;
  const GATE = 10172;
  const SWABS = new Set(NPCS.SWABS);
  const PROTESTERS = new Set(NPCS.PROTESTERS);
  const BREWERS = new Set(NPCS.BREWERS);
  const DIALOGUE_NPCS = new Set([
    NPCS.PETE, NPCS.ISLAND_PETE, NPCS.BRAINDEATH, NPCS.LUKE, NPCS.DAVEY, NPCS.DONNIE, ...SWABS, ...PROTESTERS, ...BREWERS,
  ]);
  /** Braindeath Island's box (the quest's NPCs and locs), and Port Phasmatys's dock where Pete waits. */
  const onIsland = (player) => {
    const at = player.getLocation();
    return at.getX() >= 2100 && at.getX() <= 2200 && at.getY() >= 5050 && at.getY() <= 5170;
  };

  const REQUIRED_SKILLS = [
    [Skill.FARMING, 40], [Skill.FISHING, 50], [Skill.PRAYER, 47], [Skill.CRAFTING, 42], [Skill.SLAYER, 42],
  ];

  let quest;
  const intimidated = new WeakMap();
  const gateRequests = new Map();

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const freeSlots = (player) => {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function" ? inventory.getFreeSlots() : inventory.isFull() ? 0 : 28;
  };
  const hasFreeSlot = (player) => freeSlots(player) > 0;
  const level = (player, skill) => player.getSkillManager().getCurrentLevel(skill);
  const giveIfMissing = (player, itemId) => {
    if (!held(player, itemId) && hasFreeSlot(player)) player.getInventory().adds(itemId, 1);
  };
  const statement = (player, text) => player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
  /** Holds the player still for `ticks`, as the capture's busy actions do. */
  function hold(player, ticks) {
    const queue = player.getMovementQueue();
    queue.reset();
    queue.setBlockMovement(true);
    const generation = queue.getBlockMovementGeneration?.();
    api.getTaskManager().submit(new api.core.CountdownTask(player, ticks, () => {
      if (generation === undefined || queue.getBlockMovementGeneration() === generation) queue.setBlockMovement(false);
    }));
  }

  /** The varbits the stage implies (the brewing controls, the drunk pirates) and the barrel's. */
  function syncVarbits(player) {
    const stage = quest.getStage(player);
    const sender = player.getPacketSender();
    const hopper = stage >= STAGES.COLLECT_SWILL ? 2
      : stage === STAGES.PRESSURISED || stage === STAGES.BLESS_WRENCH ? 1 : 0;
    sender.sendVarbit(VARBITS.MULTI_HOPPER, hopper);
    for (const varbit of VARBITS.PIRATES) sender.sendVarbit(varbit, stage >= STAGES.TOLD_DONNIE ? 1 : 0);
    brewery.showBarrel(player);
  }

  const ctx = { quest: () => quest, held, hasFreeSlot, level, statement, hold, syncVarbits };
  const patch = require("../rumdeal/Patch.RumDeal")(api, ctx);
  const brewery = require("../rumdeal/Brewery.RumDeal")(api, ctx);
  const scenes = require("../rumdeal/Scenes.RumDeal")(api, ctx);

  function questIsComplete(player, key) {
    const request = { player, key, complete: undefined };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }
  const questsDone = (player) => questIsComplete(player, "zogre_flesh_eaters") && questIsComplete(player, "priest_in_peril");
  const skillsMet = (player) => REQUIRED_SKILLS.every(([skill, required]) => level(player, skill) >= required);
  const meetsRequirements = (player) => skillsMet(player) && questsDone(player);

  function notifyRequirements(player) {
    for (const [skill, required] of REQUIRED_SKILLS) {
      if (level(player, skill) < required) player.sendMessage(`You need ${required} ${skill.getName()} to start this quest.`);
    }
    if (!questIsComplete(player, "zogre_flesh_eaters")) player.sendMessage("You must complete Zogre Flesh Eaters to start this quest.");
    if (!questIsComplete(player, "priest_in_peril")) player.sendMessage("You must complete Priest in Peril to start this quest.");
  }

  const wearingSlayerGloves = (player) => SLAYER_GLOVES.has(player.getEquipment().get(Equipment.HANDS_SLOT)?.getId?.());
  const wearingCharos = (player) => RINGS_OF_CHAROS.has(player.getEquipment().get(Equipment.RING_SLOT)?.getId?.());
  const knockedOut = (player) => Number(player.getAttribute(ATTRIBUTES.KNOCKED_OUT)) === 1;

  function findNpc(id, [x, y, z], range = 12) {
    let best = null;
    for (const npc of api.core.World.getNpcs()) {
      if (!npc || npc.getId() !== id) continue;
      const at = npc.getLocation();
      if (at.getZ() !== z || Math.abs(at.getX() - x) > range || Math.abs(at.getY() - y) > range) continue;
      best = npc;
    }
    return best;
  }

  // ------------------------------------------------------------------ which conversation plays

  function selectVariant({ npcId, player }) {
    if (!DIALOGUE_NPCS.has(npcId)) return null;
    const stage = quest.getStage(player);
    const complete = quest.isComplete(player);
    if (npcId === NPCS.PETE) {
      // The requirements are checked on "Yes." (the repo's start rule), so everyone hears the offer.
      if (stage === 0) return "setting-out-talking-to-pirate-pete";
      if (stage === STAGES.STARTED) return "setting-out-talking-to-pirate-pete-talking-to-pete-again";
      if (stage === STAGES.AGREED && !knockedOut(player)) {
        return { page: PETE_PAGE, variant: "starting-rum-deal-talking-to-pirate-after-asking-him-for-a-reward" };
      }
      return { page: PETE_PAGE, variant: "standard-dialogue" };
    }
    if (npcId === NPCS.ISLAND_PETE) return { page: PETE_PAGE, variant: "standard-dialogue" };
    if (npcId === NPCS.BRAINDEATH) return braindeathVariant(player, stage, complete);
    if (npcId === NPCS.LUKE) return { page: LUKE_PAGE, variant: "standard-dialogue" };
    if (npcId === NPCS.DAVEY) {
      if (complete) {
        return { page: "Davey", variant: ownsHolyWrench(player) ? "after-rum-deal" : "after-rum-deal-without-a-holy-wrench-in-the-inventory-or-bank" };
      }
      if (stage >= STAGES.BLESS_WRENCH) {
        // A wrench is blessed every time (the capture blesses a second one, tick 2266).
        return held(player, I.HOLY_WRENCH) && !held(player, I.WRENCH)
          ? "evil-spirit-talking-to-davey-after-getting-the-holy-wrench"
          : "evil-spirit-talking-to-davey";
      }
      return "getting-your-beer-ings-talking-to-davey";
    }
    if (npcId === NPCS.DONNIE) {
      if (complete) return { page: "Captain Donnie", variant: "standard-dialogue-after-rum-deal" };
      if (held(player, I.UNSANITARY_SWILL)) {
        if (stage === STAGES.COLLECT_SWILL) return "dissolving-the-protest-talking-to-captain-donnie";
        if (stage === STAGES.TOLD_DONNIE) return "dissolving-the-protest-talking-to-captain-donnie-again-while-having-rum-with-you";
      }
      return "getting-your-beer-ings-talking-to-captain-donnie";
    }
    if (PROTESTERS.has(npcId)) {
      return stage >= STAGES.TOLD_DONNIE
        ? { page: "Zombie protester", variant: "standard-dialogue" }
        : "getting-your-beer-ings-talking-to-zombie-protesters";
    }
    if (SWABS.has(npcId)) return "getting-your-beer-ings-trying-to-talk-to-zombie-swabs";
    if (BREWERS.has(npcId)) {
      const number = BREWER_NUMBER[npcId];
      return complete
        ? { page: "Brewer", variant: `standard-dialogue-after-rum-deal-brewer-${number}` }
        : `getting-your-beer-ings-talking-to-brewers-around-the-facility-brewer-${number}`;
    }
    return null;
  }

  function braindeathVariant(player, stage, complete) {
    if (complete) return { page: "Captain Braindeath", variant: "standard-dialogue-after-rum-deal" };
    switch (stage) {
      case STAGES.AGREED:
      case STAGES.MET_BRAINDEATH:
        // Only reached on the island: the knock-out's meeting, played again if it was cut short.
        return stage === STAGES.AGREED ? "setting-out-meeting-captain-braindeath" : "getting-your-beer-ings-talking-to-captain-braindeath-again";
      case STAGES.GIVEN_SEEDS: return "getting-your-beer-ings-talking-to-captain-braindeath-again";
      case STAGES.GROWN_BLINDWEED:
        return held(player, I.BLINDWEED)
          ? "brewing-rum-talking-to-captain-braindeath-after-getting-blindweed"
          : "brewing-rum-if-the-player-has-lost-the-blindweed";
      case STAGES.SHOWN_BLINDWEED: return "brewing-rum-before-putting-blindweed-in-the-hopper";
      case STAGES.BLINDWEED_ADDED: return "stagnant-water-talking-to-captain-braindeath-after-using-blindweed-on-the-hopper";
      case STAGES.FETCH_WATER: return "stagnant-water-talking-to-captain-braindeath-again-before-getting-stagnant-water";
      case STAGES.COLLECTED_WATER: return "stagnant-water-talking-to-captain-braindeath-before-pouring-in-the-stagnant-in-the-hopper";
      case STAGES.WATER_ADDED: return "sluglings-talking-to-captain-braindeath-after-using-the-water-on-the-hopper";
      case STAGES.CATCH_CREATURES: return "sluglings-talking-to-captain-braindeath-again-before-catching-the-sluglings";
      case STAGES.PRESSURISED: return "evil-spirit-talking-to-captain-braindeath-after-filling-the-pressure-barrel";
      case STAGES.BLESS_WRENCH:
        return held(player, I.HOLY_WRENCH)
          ? "evil-spirit-talking-to-captain-braindeath-with-the-holy-wrench"
          : "evil-spirit-talking-to-captain-braindeath-again";
      case STAGES.SPIRIT_BANISHED: return "fever-spider-talking-to-captain-braindeath-after-killing-the-evil-spirit";
      case STAGES.KILL_SPIDER: return "fever-spider-talking-to-captain-braindeath-again-before-getting-the-spider-corpse";
      case STAGES.SPIDER_ADDED: return "dissolving-the-protest-talking-to-captain-braindeath-after-using-the-spider-carcass-on-the-hopper";
      case STAGES.COLLECT_SWILL: return "dissolving-the-protest-talking-to-captain-braindeath-before-talking-to-captain-donnie";
      case STAGES.TOLD_DONNIE: return "dissolving-the-protest-talking-to-captain-braindeath-after-talking-to-captain-donnie";
      default: return null;
    }
  }

  /** The Wiki's Davey: "Without a holy wrench in the inventory or bank". */
  function ownsHolyWrench(player) {
    if (held(player, I.HOLY_WRENCH)) return true;
    const bank = player.getBank?.(0);
    if (typeof player.getBanks === "function") {
      return player.getBanks().some((tab) => tab?.getAmount?.(I.HOLY_WRENCH) > 0);
    }
    return bank?.getAmount?.(I.HOLY_WRENCH) > 0;
  }

  // ------------------------------------------------------------------ the Wiki's prose conditions

  function answerCondition({ player, npcId, text }) {
    if (!DIALOGUE_NPCS.has(npcId)) return null;
    const value = String(text ?? "").toLowerCase();
    const has = (itemId) => player.getInventory().getAmount(itemId) > 0;
    if (value.includes("one or more levels less")) return !skillsMet(player);
    if (value.includes("second thoughts")) return quest.getStage(player) >= STAGES.STARTED && !quest.isComplete(player);
    // Pete's lifts: the Wiki's dock branch at Port Phasmatys, its island branch on the island.
    if (value.includes("dock north of port phasmatys")) return !onIsland(player);
    if (value.includes("on braindeath island")) return onIsland(player);
    if (value.includes("ring of charos")) return value.includes("not wearing") ? !wearingCharos(player) : wearingCharos(player);
    if (value.includes("tinderbox")) return value.includes("not have") ? !has(TINDERBOX) : has(TINDERBOX);
    if (value.includes("lost the blindweed seed")) return !has(I.BLINDWEED_SEED);
    if (value.includes("free inventory space") || value.includes("inventory space") || value.includes("room in their inventory")) {
      const negative = value.includes("no inventory") || value.includes("no free") || value.includes("does not have")
        || value.includes("doesn't have") || value.includes("don't have");
      return negative ? !hasFreeSlot(player) : hasFreeSlot(player);
    }
    if (value.includes("lost the blindweed") || value.includes("loses the blindweed")) return !has(I.BLINDWEED);
    if (value.includes("already has a rake")) return has(I.RAKE);
    if (value.includes("already has a seed dibber")) return has(I.SEED_DIBBER);
    if (value.includes("already has a watering can")) return has(I.WATERING_CAN);
    if (value.includes("already has all the tools")) return has(I.RAKE) && has(I.SEED_DIBBER) && has(I.WATERING_CAN);
    if (value.includes("not planted the seed")) return !patch.planted(player);
    if (value.includes("already planted the seed")) return patch.planted(player);
    if (value.includes("not have level 40 farming")) return level(player, Skill.FARMING) < 40;
    if (value.includes("has level 40 farming")) return level(player, Skill.FARMING) >= 40;
    if (value.includes("lost the bucket of water")) return !has(I.BUCKET_OF_WATER_3);
    if (value.includes("completed sea slug")) return questIsComplete(player, "sea_slug");
    if (value.includes("fishbowl and net")) return !has(I.FISHBOWL_AND_NET);
    if (value.includes("lost the wrench") || value.includes("without the wrench")) return !has(I.WRENCH) && !has(I.HOLY_WRENCH);
    if (value.includes("47 prayer")) return level(player, Skill.PRAYER) < 47;
    if (value.includes("not wearing slayer gloves")) return !wearingSlayerGloves(player);
    if (value.includes("wearing slayer gloves")) return wearingSlayerGloves(player);
    if (value.includes("gotten 'rum'")) return !has(I.UNSANITARY_SWILL);
    if (value.includes("empty bucket")) {
      const negative = value.includes("doesn't have") || value.includes("does not have");
      return negative ? !has(I.BUCKET) : has(I.BUCKET);
    }
    return null;
  }

  // ------------------------------------------------------------------ menus, lines and actions

  /** Agreeing to fight Barrelor is stage 2 (capture tick 242); "Yes." starts it through its hook (175). */
  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (npcId !== NPCS.PETE) return;
    const text = String(option ?? "");
    const stage = quest.getStage(player);
    if (stage === STAGES.STARTED && (text === "Of course, I fear no demon!" || text === "Because I came to offer to help.")) {
      quest.setStage(player, STAGES.AGREED);
    }
  }

  /** "Yes." on "Start the Rum Deal quest?" carries the dump's start hook: the requirements, then stage 1. */
  function handleHook(event) {
    const { player, npcId, hook } = event;
    if (npcId !== NPCS.PETE || hook !== "quest:rum-deal:start" || quest.getStage(player) !== 0) return;
    if (!meetsRequirements(player)) {
      event.end = true;
      notifyRequirements(player);
      return;
    }
    quest.setStage(player, STAGES.STARTED);
  }

  const cutsceneLines = () => (loadTranscripts(api)?.[PAGE]?.variants?.["setting-out-cutscene-1"] ?? [])
    .map((step) => step.text ?? step.npc ?? step.player).filter((text) => typeof text === "string");

  function startMeeting(player) {
    const braindeath = findNpc(NPCS.BRAINDEATH, [2144, 5109, 1]);
    startTranscript(api, player, NPCS.BRAINDEATH, PAGE, "setting-out-meeting-captain-braindeath", undefined, braindeath);
  }

  /** The player's last line in each of the Pirate Pete page's lift talks, before "Pirate Pete hits the player on the head." */
  const BEFORE_THE_BLOW = new Set(["One...", "Where?", "What friend?", "Thanks!", "What? Where?"]);

  /** Stage changes and hand-outs on the lines that carry them, as the capture sets them. */
  function handleLine(request) {
    const { player, npcId } = request;
    if (!player || !DIALOGUE_NPCS.has(npcId)) return;
    const text = String(request.text ?? "");
    const stage = quest.getStage(player);
    const isPlayer = typeof request.step?.player === "string";
    if (npcId === NPCS.PETE && isPlayer && text === "What diversion?") {
      // The blow, cutscene 1 and the meeting (tick 268 on). The transcript's own knock-out steps follow
      // this line; the scene takes the chat over, so they don't play.
      if (stage === STAGES.AGREED && !knockedOut(player)) {
        request.before = () => scenes.turnAway(player, request.npc);
        request.after = () => scenes.knockOut(player, request.npc, cutsceneLines(), startMeeting);
      }
      return;
    }
    if ((npcId === NPCS.PETE || npcId === NPCS.ISLAND_PETE) && isPlayer && BEFORE_THE_BLOW.has(text)) {
      // The player's back to Pete as their last line before his blow shows (ticks 3084, 3114).
      request.before = () => scenes.turnAway(player, request.npc);
      return;
    }
    if (npcId === NPCS.BRAINDEATH) return braindeathLine(request, player, text, stage, isPlayer);
    if (npcId === NPCS.DONNIE && !isPlayer) {
      if (stage === STAGES.COLLECT_SWILL && text === "Hand it over or I'll run ye through!") {
        request.after = () => {
          if (quest.getStage(player) !== STAGES.COLLECT_SWILL) return;
          if (held(player, I.UNSANITARY_SWILL)) player.getInventory().deleteNumber(I.UNSANITARY_SWILL, 1);
          quest.setStage(player, STAGES.TOLD_DONNIE);
          syncVarbits(player);
        };
      } else if (stage === STAGES.TOLD_DONNIE && text.startsWith("If it isn't in my belly")) {
        request.after = () => { if (held(player, I.UNSANITARY_SWILL)) player.getInventory().deleteNumber(I.UNSANITARY_SWILL, 1); };
      }
      return;
    }
    if (npcId === NPCS.LUKE) {
      const gate = gateRequests.get(player);
      if (!gate) return;
      // The gate opens with Luke's "Where?" and when his north-side warning is continued (ticks 1467, 1579).
      if (gate.side === "south" && !isPlayer && text === "Where?") request.before = () => openGate(player);
      else if (gate.side === "north" && text === "So get yerself back in here, or yer for it!") request.after = () => openGate(player);
    }
  }

  function braindeathLine(request, player, text, stage, isPlayer) {
    if (isPlayer) {
      if (stage === STAGES.BLINDWEED_ADDED && text === "When is it ever...") {
        request.after = () => { if (quest.getStage(player) === STAGES.BLINDWEED_ADDED) quest.setStage(player, STAGES.FETCH_WATER); };
      }
      return;
    }
    if (text.includes("I'll give ye the seed you'll need") && stage <= STAGES.MET_BRAINDEATH) {
      // Tick 455: both stages and the seed as the line shows.
      if (hasFreeSlot(player)) {
        giveIfMissing(player, I.BLINDWEED_SEED);
        quest.setStage(player, STAGES.MET_BRAINDEATH);
        quest.setStage(player, STAGES.GIVEN_SEEDS);
      } else if (stage < STAGES.MET_BRAINDEATH) {
        quest.setStage(player, STAGES.MET_BRAINDEATH);
      }
      return;
    }
    if (stage === STAGES.GROWN_BLINDWEED && (text.startsWith("Splendid,") || text === "Here, I've been savin' some fer an emergency.")) {
      // Tick 1210: the lost blindweed's replacement and stage 6 as the line shows.
      if (!text.startsWith("Splendid,")) giveIfMissing(player, I.BLINDWEED);
      quest.setStage(player, STAGES.SHOWN_BLINDWEED);
      return;
    }
    if (stage === STAGES.SHOWN_BLINDWEED && text.includes("savin' a little fer an emergency")) {
      giveIfMissing(player, I.BLINDWEED);
      return;
    }
    if (stage === STAGES.WATER_ADDED && (text === "Here. Ye'll need this to catch them." || text === "Pity ye ain't got any free space to carry one.")) {
      // Tick 1726: the fishbowl and net and stage 11 as the line shows.
      if (text.startsWith("Here.")) giveIfMissing(player, I.FISHBOWL_AND_NET);
      quest.setStage(player, STAGES.CATCH_CREATURES);
      return;
    }
    if (stage === STAGES.PRESSURISED && text === "Give the controls a couple of belts with this wrench.") {
      giveIfMissing(player, I.WRENCH); // tick 2067
      quest.setStage(player, STAGES.BLESS_WRENCH);
      return;
    }
    if (stage === STAGES.SPIRIT_BANISHED
      && (text.startsWith("I see yer already wearin' some Slayer Gloves") || text.startsWith("These Fever Spiders carry a nasty disease"))) {
      request.after = () => { if (quest.getStage(player) === STAGES.SPIRIT_BANISHED) quest.setStage(player, STAGES.KILL_SPIDER); };
      return;
    }
    if (stage === STAGES.SPIDER_ADDED && text === "Took us a lot of dissolvin' to work that one out.") {
      request.after = () => {
        if (quest.getStage(player) !== STAGES.SPIDER_ADDED) return;
        quest.setStage(player, STAGES.COLLECT_SWILL);
        syncVarbits(player);
      };
    }
  }

  const WINDOW_BOX = /^The capt(?:ia|ai)n points out of the window/;
  /** The basement cupboard's boxes: what each one hands over. */
  const CUPBOARD_TAKES = new Map([
    ["You take an old rake.", [I.RAKE]],
    ["You take an old seed dibber.", [I.SEED_DIBBER]],
    ["You take an old watering can.", [I.WATERING_CAN]],
    ["You help yourself to what you need.", [I.RAKE, I.SEED_DIBBER, I.WATERING_CAN]],
  ]);

  /** Transcript actions and message boxes the plugin plays itself or hands items out on. */
  function handleAction(event) {
    const { player, npcId } = event;
    if (!player || !DIALOGUE_NPCS.has(npcId)) return;
    const text = String(event.text ?? "");
    const stage = quest.getStage(player);
    if (event.kind === "message") {
      // The window's box is shown by the scene, held while it plays.
      if (npcId === NPCS.BRAINDEATH && WINDOW_BOX.test(text)) event.handled = true;
      for (const itemId of CUPBOARD_TAKES.get(text) ?? []) giveIfMissing(player, itemId);
      return;
    }
    if (npcId === NPCS.BRAINDEATH) {
      if (text === "Cutscene begins") {
        const box = (loadTranscripts(api)?.[PAGE]?.variants?.["setting-out-meeting-captain-braindeath"] ?? [])
          .find((step) => WINDOW_BOX.test(String(step.text ?? "")))?.text ?? "The captian points out of the window....";
        event.wait = (resume) => scenes.windowScene(player, box, resume);
      } else if (text === "Cutscene ends") {
        event.handled = true;
      } else if (text === "(The player is handed another seed.)") {
        event.handled = true;
        giveIfMissing(player, I.BLINDWEED_SEED);
        if (stage === STAGES.MET_BRAINDEATH && held(player, I.BLINDWEED_SEED)) quest.setStage(player, STAGES.GIVEN_SEEDS);
      } else if (text === "another blindweed") {
        event.handled = true;
        giveIfMissing(player, I.BLINDWEED);
      } else if (text.startsWith("(The player is given an empty bucket.")) {
        event.handled = true;
        giveIfMissing(player, I.BUCKET);
      } else if (text === "The brewing control starts to rumble.") {
        event.wait = (resume) => scenes.brew(player, resume);
      } else if (text === "Congratulations! Quest complete!" && stage === STAGES.TOLD_DONNIE) {
        quest.complete(player);
        event.handled = true;
        event.end = true;
      }
      return;
    }
    if (npcId === NPCS.DAVEY) {
      if (text.startsWith("Davey cheers.")) {
        event.wait = (resume) => scenes.blessing(player, event.npc, () => blessWrench(player), resume);
      } else if (event.action === "receive" && text === "holy wrench") {
        // After the quest: Davey's kept wrench, when there is room (the Wiki's no-room branch ends before this).
        event.handled = true;
        if (hasFreeSlot(player)) player.getInventory().adds(I.HOLY_WRENCH, 1);
      }
      return;
    }
    if (npcId !== NPCS.PETE && npcId !== NPCS.ISLAND_PETE) return;
    if (text === "Pirate Pete hits the player on the head.") {
      event.handled = true;
      scenes.hit(player, event.npc);
    } else if (text.startsWith("Fades to black, player appears on")) {
      const to = onIsland(player) ? TILES.PORT_PHASMATYS : TILES.ISLAND_DOCK;
      event.wait = (resume) => scenes.lift(player, to, resume);
    }
  }

  function blessWrench(player) {
    if (!held(player, I.WRENCH)) return;
    player.getInventory().deleteNumber(I.WRENCH, 1);
    player.getInventory().adds(I.HOLY_WRENCH, 1);
  }

  /** Condition branches that hand an item over (the transcript has no action for them). */
  function handleCondition({ player, npcId, text }) {
    if (!player || npcId !== NPCS.BRAINDEATH) return;
    const value = String(text ?? "").toLowerCase();
    const stage = quest.getStage(player);
    if (!hasFreeSlot(player)) return;
    // The lost wrench comes with "Arr! I'd get more work out of a minty flavoured brick!" (tick 2088).
    if (value.includes("lost the wrench") && stage === STAGES.BLESS_WRENCH) giveIfMissing(player, I.WRENCH);
    if (value.includes("lost the bucket of water") && stage === STAGES.COLLECTED_WATER) giveIfMissing(player, I.BUCKET_OF_WATER_3);
    if (value.includes("fishbowl and net") && stage === STAGES.CATCH_CREATURES) giveIfMissing(player, I.FISHBOWL_AND_NET);
  }

  // ------------------------------------------------------------------ items on NPCs

  function handleItemOnNpc(event) {
    const { player, itemId, target } = event;
    const npcId = event.npcId ?? target?.getId?.();
    if (!player || npcId !== NPCS.BRAINDEATH) return;
    const stage = quest.getStage(player);
    const play = (variant) => {
      event.handled = true;
      startTranscript(api, player, NPCS.BRAINDEATH, PAGE, variant, undefined, target);
    };
    if (itemId === I.SLUGLINGS) return play("sluglings-using-sluglings-on-captain-braindeath");
    if (itemId === I.KARAMTHULHU) return play("sluglings-using-karamthultu-on-captain-braindeath");
    if (itemId === I.FEVER_SPIDER_BODY) return play("fever-spider-using-the-spider-corpse-on-captain-braindeath");
    if (itemId === I.BLINDWEED_SEED && stage === STAGES.GIVEN_SEEDS) {
      return play("getting-your-beer-ings-talking-to-captain-braindeath-again-using-the-blindweed-seed-on-captain-braindeath");
    }
    if (itemId === I.BUCKET_OF_WATER_3 && stage === STAGES.COLLECTED_WATER) {
      return play("stagnant-water-talking-to-captain-braindeath-before-pouring-in-the-stagnant-in-the-hopper-using-the-bucket-of-stagnant-water-on-captain-braindeath");
    }
    if (itemId === I.HOLY_WRENCH && stage === STAGES.BLESS_WRENCH) return play("evil-spirit-using-the-holy-wrench-on-captain-braindeath");
  }

  // ------------------------------------------------------------------ objects

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (!player) return;
    if (objectId === brewery.HOPPER) return brewery.hopper(event);
    if (objectId === brewery.BARREL) return brewery.stuffBarrel(event);
    if (objectId === brewery.STAGNANT_LAKE && itemId === I.BUCKET) return brewery.scoopLake(event);
    if (objectId === brewery.OUTPUT_TAP && itemId === I.BUCKET) return brewery.turnTap(event);
    if (brewery.CONTROL_IDS.has(objectId)) return brewery.smiteControls(event);
    if (PATCH_IDS.has(objectId) && itemId === I.RAKE) return patch.rake(event);
    if (PATCH_IDS.has(objectId) && itemId === I.BLINDWEED_SEED) return patch.plant(event);
    if (objectId === TRASHED_PATCH && itemId === I.RAKE) {
      event.handled = true;
      player.sendMessage("You will probably have a hard time raking that.");
    }
  }

  const PATCH_IDS = new Set([10096, ...patch.CHILDREN]);
  const TRASHED_PATCH = 10103;

  function handleObjectInteraction(event) {
    const { player, objectId, clickType } = event;
    if (!player) return;
    if (brewery.LEVER_IDS.has(objectId)) return brewery.pullLever(event);
    if (objectId === brewery.BARREL && clickType === 2) return brewery.countBarrel(event);
    if (objectId === brewery.OUTPUT_TAP) return brewery.turnTap(event);
    if (objectId === TRASHED_PATCH) {
      event.handled = true;
      player.sendMessage("The soil here is too poor to farm on.");
      return;
    }
    if (PATCH_IDS.has(objectId)) {
      // Op 1 is Pick on the grown child only; op 2 is Inspect.
      if (clickType === 1) patch.pick(event);
      else patch.inspect(event);
      return;
    }
    if (objectId === CUPBOARD_IDS[0] || objectId === CUPBOARD_IDS[1]) {
      event.handled = true;
      startTranscript(api, player, NPCS.BRAINDEATH, PAGE, "getting-your-beer-ings-searching-the-basement-cupboard-for-farming-supplies");
    }
  }
  const CUPBOARD_IDS = [10162, 10163];

  // ------------------------------------------------------------------ 50% Luke's gate

  /**
   * The gate north of the compound (10172 at 2120,5098): Luke stops the player before the water step
   * (the Wiki), and from then on is distracted going north and shouts coming back, the gate opening
   * as the capture shows (ticks 1456-1469, 1570-1581) and in recording 3034 after the quest.
   */
  function guardGate(request) {
    const { player, objectId, location, object } = request;
    if (objectId !== GATE || !location || location.x !== TILES.GATE[0] || location.y !== TILES.GATE[1]) return;
    const stage = quest.getStage(player);
    if (stage < STAGES.STARTED) return;
    request.handled = true;
    const luke = findNpc(NPCS.LUKE, TILES.GATE);
    const south = player.getLocation().getY() <= location.y;
    if (stage < STAGES.FETCH_WATER && !quest.isComplete(player)) {
      gateRequests.delete(player);
      startTranscript(api, player, NPCS.LUKE, PAGE, "getting-your-beer-ings-trying-to-sneak-past-50-luke-too-early", undefined, luke);
      return;
    }
    gateRequests.set(player, { side: south ? "south" : "north", object });
    startTranscript(api, player, NPCS.LUKE, LUKE_PAGE,
      south ? "using-the-gate-near-50-luke-from-the-south-side" : "using-the-gate-near-50-luke-from-the-north-side", undefined, luke);
  }

  function openGate(player) {
    const gate = gateRequests.get(player);
    gateRequests.delete(player);
    if (gate?.object) api.emitCustomEvent("door:open", { player, object: gate.object, handled: false });
  }

  // ------------------------------------------------------------------ NPCs: swabs, the squid spot, deaths, drops

  function handleNpcInteraction(event) {
    const { player, npcId, npc, clickType } = event;
    if (npcId === NPCS.FISHING_SPOT && onIsland(player)) return brewery.fish(event);
    if (SWABS.has(npcId) && clickType === 3) return intimidate(event, player, npc, npcId);
  }

  /** Intimidate: the Wiki's insult for each swab, once per swab. */
  function intimidate(event, player, npc, npcId) {
    event.handled = true;
    let done = intimidated.get(player);
    if (!done) intimidated.set(player, done = new WeakSet());
    if (npc && done.has(npc)) {
      player.sendMessage("I don't think he will be causing any more trouble.");
      return;
    }
    if (npc) done.add(npc);
    startTranscript(api, player, npcId, PAGE, `blinding-the-weed-intimidating-the-zombie-swabs-zombie-swab-${npcId - NPCS.SWABS[0] + 1}`, undefined, npc);
  }

  function handleNpcDeath({ killer, npcId, npc }) {
    if (npcId === NPCS.EVIL_SPIRIT) brewery.spiritDied(killer, npc);
  }

  /** The Fever spider body: "only dropped during Rum Deal" (the Wiki; the capture's drop at tick 2435). */
  function questDrop(request) {
    if (request.itemId !== I.FEVER_SPIDER_BODY || request.npcId !== NPCS.FEVER_SPIDER || !request.player) return;
    const stage = quest.getStage(request.player);
    request.allowed = stage >= STAGES.KILL_SPIDER && !quest.isComplete(request.player);
  }

  // ------------------------------------------------------------------ the fishbowl and net

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = [usedItemId, usedWithItemId];
    if (!pair.includes(I.EMPTY_FISHBOWL) || !pair.includes(I.BIG_FISHING_NET)) return;
    if (!held(player, I.EMPTY_FISHBOWL) || !held(player, I.BIG_FISHING_NET)) return;
    event.handled = true;
    player.getInventory().deleteNumber(I.EMPTY_FISHBOWL, 1);
    player.getInventory().deleteNumber(I.BIG_FISHING_NET, 1);
    player.getInventory().adds(I.FISHBOWL_AND_NET, 1);
    player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, "You wrap the net around the empty bowl."); // tick 1797
  }

  function unwrapFishbowl({ player }) {
    if (!held(player, I.FISHBOWL_AND_NET)) return;
    if (!hasFreeSlot(player)) {
      player.sendMessage("You do not have enough space to unwrap the net from the fishbowl.");
      return;
    }
    player.getInventory().deleteNumber(I.FISHBOWL_AND_NET, 1);
    player.getInventory().adds(I.EMPTY_FISHBOWL, 1);
    player.getInventory().adds(I.BIG_FISHING_NET, 1);
    player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, "You unwrap the net from the fishbowl."); // tick 1793
  }

  // ------------------------------------------------------------------ journal, login, rewards

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage <= 0) {
      const line = (skill, amount, label) => (level(player, skill) >= amount ? `<str>${label}</str>` : `<col=800000>${label}</col>`);
      return [
        "I can start this quest by speaking to <col=800000>Pirate Pete</col>",
        "in <col=800000>Port Phasmatys</col>.",
        "",
        "To complete this quest I need:",
        line(Skill.FARMING, 40, "40 Farming"),
        line(Skill.FISHING, 50, "50 Fishing"),
        line(Skill.PRAYER, 47, "47 Prayer"),
        line(Skill.CRAFTING, 42, "42 Crafting"),
        line(Skill.SLAYER, 42, "42 Slayer"),
        "To have completed <col=800000>Zogre Flesh Eaters</col>.",
        "To have completed <col=800000>Priest in Peril</col>.",
        "To be able to defeat a level 150 monster.",
      ];
    }
    return journal(stage, { planted: patch.planted(player), holyWrench: held(player, I.HOLY_WRENCH) });
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.PRAYER, 7000);
    player.getSkillManager().addExperiences(Skill.FISHING, 7000);
    player.getSkillManager().addExperiences(Skill.FARMING, 7000);
    player.setAttribute(ATTRIBUTES.SLUGLINGS, 0);
    player.setAttribute(ATTRIBUTES.KARAMTHULHU, 0);
    brewery.stop(player);
  }

  function handleLogin({ player }) {
    brewery.finishPressurising(player);
    refreshQuestList(player);
    if (Number(player.getAttribute(ATTRIBUTES.SPIRIT)) === 1) player.setAttribute(ATTRIBUTES.SPIRIT, 0);
    if (quest.getStage(player) > 0) syncVarbits(player);
    if (Number(player.getAttribute(ATTRIBUTES.WEEDS)) > 0 || patch.planted(player)) patch.sync(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    brewery.stop(player);
    patch.stop(player);
    scenes.stop(player);
    gateRequests.delete(player);
  }

  api.persistAttribute(ATTRIBUTES.KNOCKED_OUT, 0);
  api.persistAttribute(ATTRIBUTES.WEEDS, 0);
  api.persistAttribute(ATTRIBUTES.WEEDS_AT, 0);
  api.persistAttribute(ATTRIBUTES.PLANTED, 0);
  api.persistAttribute(ATTRIBUTES.SLUGLINGS, 0);
  api.persistAttribute(ATTRIBUTES.KARAMTHULHU, 0);
  api.persistAttribute(ATTRIBUTES.PRESSURISING, 0);
  api.persistAttribute(ATTRIBUTES.SPIRIT, 0);

  quest = registerQuest(api, {
    key: "rum_deal",
    name: "Rum Deal",
    varpId: VARP_QUEST,
    startedValue: STAGES.STARTED,
    completionValue: STAGES.COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.PRAYER.getIndex(), amount: 7000, label: "Prayer" },
      { skillId: Skill.FISHING.getIndex(), amount: 7000, label: "Fishing" },
      { skillId: Skill.FARMING.getIndex(), amount: 7000, label: "Farming" },
    ],
    // Davey's blessing already hands over the holy wrench; the scroll shows it (tick 2813).
    scrollItemId: I.HOLY_WRENCH,
    rewardItemLabel: "A Holy Wrench",
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:hook", handleHook);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("door:toggle", guardGate);
  api.onCustomEvent("npc-drops:quest-item", questDrop);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction("Fishbowl and net", { Untangle: unwrapFishbowl });
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcInteraction(handleNpcInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onCustomEvent("agent:advance-time", patch.advanceTime);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
