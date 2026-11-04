/**
 * Death Plateau (members).
 *
 * The words come from the "Death Plateau" transcript page; this plugin supplies
 * the variant selector for Denulth, Eohric, Harold, Saba, Tenzing, Dunstan and
 * the castle archers (all indexed), the start hook, the prose-condition answers,
 * the item hand-outs keyed off transcript message ids, and the final map +
 * combination hand-in that completes the quest.
 *
 * Stages (varp 314): 10 started, 20 spoken to Eohric, 30 met Harold, 40 learned his weakness,
 * 50 given ale, 55 IOU, 60 read combination, 65 equipment room unlocked,
 * 70 Saba, 72 climbing boots, 73 met Dunstan, 75 spiked boots, 77 map, 78 scouted,
 * 80 complete.
 *
 * shortcut: the optional Transcendent archer detour is not wired.
 */
module.exports = function registerDeathPlateauQuest(api) {
  const { Skill, Item, Location, Boundary, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, CacheDefinitions } = api.core;
  const { registerQuest, refreshQuestList, getRegisteredQuests, startTranscript } = require("../QuestRuntime");

  const DENULTH_NPC_IDS = new Set([NpcIdentifiers.DENULTH, NpcIdentifiers.DENULTH_2]);
  const EOHRIC_NPC_ID = NpcIdentifiers.EOHRIC;
  const HAROLD_NPC_ID = NpcIdentifiers.HAROLD;
  const SABA_NPC_ID = NpcIdentifiers.SABA;
  const TENZING_NPC_ID = NpcIdentifiers.TENZING;
  const DUNSTAN_NPC_ID = NpcIdentifiers.DUNSTAN;
  const ARCHER_NPC_IDS = new Set([
    NpcIdentifiers.ARCHER_3,
    NpcIdentifiers.ARCHER_4,
    NpcIdentifiers.ARCHER_5,
  ]);

  const VARP_DEATH_PLATEAU = 314;
  const STAGE_STARTED = 10;
  const STAGE_EOHRIC = 20;
  const STAGE_HAROLD = 30;
  const STAGE_WEAKNESS = 40;
  const STAGE_ALE = 50;
  const STAGE_IOU = 55;
  const STAGE_COMBINATION = 60;
  const STAGE_ROOM = 65;
  const STAGE_SABA = 70;
  const STAGE_CLIMBING_BOOTS = 72;
  const STAGE_DUNSTAN = 73;
  const STAGE_BOOTS = 75;
  const STAGE_MAP = 77;
  const STAGE_SCOUTED = 78;
  const STAGE_COMPLETE = 80;

  const BREAD_ITEM_ID = ItemIdentifiers.BREAD;
  const TROUT_ITEM_ID = ItemIdentifiers.TROUT;
  const IRON_BAR_ITEM_ID = ItemIdentifiers.IRON_BAR;
  const ASGARNIAN_ALE_ITEM_ID = ItemIdentifiers.ASGARNIAN_ALE;
  const BLURBERRY_SPECIAL_ITEM_ID = ItemIdentifiers.BLURBERRY_SPECIAL;
  const PREMADE_BLURBERRY_ITEM_ID = ItemIdentifiers.PREMADE_BLURB_SP;
  const DRUNK_ATTRIBUTE = "death-plateau:harold-drunk";
  const GAMBLE_BANK_ATTRIBUTE = "death-plateau:harold-coins";
  const GAMBLE_IOU_ATTRIBUTE = "death-plateau:harold-owes-iou";
  const CERTIFICATE_DELIVERED_ATTRIBUTE = "death-plateau:certificate-delivered";
  const CERTIFICATE_ISSUED_ATTRIBUTE = "death-plateau:certificate-issued";
  const PUZZLE_ATTRIBUTE = "death-plateau:stone-balls";
  const MAP_RECEIVED_ATTRIBUTE = "death-plateau:map-received";
  const MAP_DELIVERED_ATTRIBUTE = "death-plateau:map-delivered";
  const COMBINATION_DELIVERED_ATTRIBUTE = "death-plateau:combination-delivered";
  const EQUIPMENT_DOOR_ID = ObjectIdentifiers.LARGE_DOOR_23;
  const MECHANISM_IDS = new Set([ObjectIdentifiers.STONE_MECHANISM, ObjectIdentifiers.STONE_MECHANISM_2]);
  // Cache 241 ball colours; Wiki's arrangement on the cache's six mechanism tiles.
  const BALL_IDS = [ItemIdentifiers.STONE_BALL, ItemIdentifiers.STONE_BALL_2, ItemIdentifiers.STONE_BALL_3, ItemIdentifiers.STONE_BALL_4, ItemIdentifiers.STONE_BALL_5];
  const BALL_SOLUTION = new Map([
    ["2894,3563", BALL_IDS[0]], ["2894,3562", BALL_IDS[1]],
    ["2895,3562", BALL_IDS[2]], ["2895,3563", BALL_IDS[3]], ["2895,3564", BALL_IDS[4]],
  ]);
  const PUZZLE_BOUNDS = new Boundary(2893, 2896, 3561, 3565, 0);
  // Wiki: continue east past the second goat. Quest Helper marks the endpoint at 2865,3609.
  const SCOUT_BOUNDS = new Boundary(2864, 2870, 3608, 3612, 0);
  const COMBINATION_ITEM_ID = ItemIdentifiers.COMBINATION;
  const IOU_ITEM_ID = ItemIdentifiers.IOU;
  const SECRET_WAY_MAP_ITEM_ID = ItemIdentifiers.SECRET_WAY_MAP;
  const CLIMBING_BOOTS_ITEM_ID = ItemIdentifiers.CLIMBING_BOOTS;
  const SPIKED_BOOTS_ITEM_ID = ItemIdentifiers.SPIKED_BOOTS;
  const CERTIFICATE_ITEM_ID = ItemIdentifiers.CERTIFICATE_2;
  const COINS_ITEM_ID = ItemIdentifiers.COINS;
  const HAROLD_DOOR_ID = ObjectIdentifiers.DOOR_115;
  const CLIMBING_BOOTS_PRICE = 12;
  const BUY_CLIMBING_BOOTS_IDS = new Set(["FgkYXO", "7mwtJo"]);

  const START_HOOK = "quest:death-plateau:start";

  const COMPLETE_ACTION_IDS = new Set(["-0mf7N", "IRymYG"]);

  /** Transcript message ids that hand the player a key item (the dump repeats each line). */
  const GIVE_IOU_IDS = new Set(["4p9H2-", "MBm6Sz", "mhKulF", "wAz_jn", "23tpMt", "mUS50D"]);
  const GIVE_MAP_IDS = new Set(["yDYvE0", "MtULDz", "TgL2Wy"]);
  const GIVE_CLIMBING_BOOTS_IDS = new Set(["aZ5-DY", "FG69_B", "gUxInm"]);
  const GIVE_SPIKED_BOOTS_IDS = new Set(["AuWfYt", "MKP0WU", "1TFYaK", "WryBLk"]);
  const GIVE_CERTIFICATE_IDS = new Set(["KZG0PG", "VuuQKK"]);

  /** Hand-over lines that consume what the transcript says the player gives. */
  const READ_IOU_STEP_ID = "abx6jE";
  const GIVE_DENULTH_MAP_STEP_ID = "sdE5c5";
  const GIVE_DENULTH_COMBINATION_STEP_ID = "liaDgz";
  const GIVE_ALE_STEP_IDS = new Set(["_ELP6x", "7gOtrA"]);
  const GIVE_BLURBERRY_STEP_ID = "VZS4Rq";
  const GIVE_CERTIFICATE_STEP_ID = "jmuuX8";

  const GAMBLE_IOU_MINIMUM = 60;
  const GAMBLE_MAXIMUM = 1000;
  // Wiki quick guide: a 101-coin win immediately bankrupts Harold.
  const HAROLD_STARTING_COINS = 100;
  const GAMBLING_INTERFACE = "Gambling";
  const GAMBLE_GROUP = CacheDefinitions.getInterfaceId("death_dice");
  const GAMBLE_FINISH_VARIANT = "finding-the-combination-finishing-a-gamble";
  const gambles = new WeakMap();
  const TENZING_SUPPLY_AMOUNT = 10;

  let quest;

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;
  const hasBoots = (player) =>
    held(player, CLIMBING_BOOTS_ITEM_ID) || held(player, SPIKED_BOOTS_ITEM_ID);
  const hasMap = (player) => held(player, SECRET_WAY_MAP_ITEM_ID);
  const hasCombination = (player) => held(player, COMBINATION_ITEM_ID);
  const hasCertificate = (player) => held(player, CERTIFICATE_ITEM_ID);

  function giveIou(player) {
    const itemId = quest.getStage(player) >= STAGE_COMBINATION ? COMBINATION_ITEM_ID : IOU_ITEM_ID;
    if (!held(player, itemId)) player.getInventory().adds(itemId, 1);
    if (quest.getStage(player) < STAGE_IOU) quest.setStage(player, STAGE_IOU);
    if (held(player, itemId)) player.setAttribute(GAMBLE_IOU_ATTRIBUTE, false);
  }

  const gambleComponent = name => CacheDefinitions.getComponentId(`death_dice:death_gamble_${name}`);
  const gambleBank = player => player.getAttribute(GAMBLE_BANK_ATTRIBUTE) ?? HAROLD_STARTING_COINS;
  const canGamble = player => quest.getStage(player) >= STAGE_ALE && quest.getStage(player) < STAGE_IOU;
  const atGamble = (player, gamble) => {
    const location = player.getLocation();
    return location.x === gamble.x && location.y === gamble.y && location.z === gamble.z;
  };

  function enterWager(player) {
    player.getPacketSender().sendInterfaceRemoval();
    const gamble = { phase: "input", ...player.getLocation() };
    gambles.set(player, gamble);
    const input = { acceptsZero: true, acceptsNegative: true, execute(amount) {
      if (gambles.get(player) !== gamble || gamble.phase !== "input" || player.getEnteredAmountAction() !== input || !canGamble(player) || !atGamble(player, gamble)) return;
      if (!Number.isSafeInteger(amount) || amount < 0) amount = 0;
      gamble.amount = amount;
      gamble.phase = "offer";
      const variant = player.getAttribute(DRUNK_ATTRIBUTE) === true
        ? "finding-the-combination-talking-to-harold-after-giving-him-a-blurberry-special"
        : "finding-the-combination-talking-to-harold-after-learning-his-weakness";
      // Resume the canonical validation and pre-roll lines after the amount prompt.
      startTranscript(api, player, HAROLD_NPC_ID, "Death Plateau", variant, steps => {
        const branch = steps.find(step => step.type === "choice")?.options.find(option => option.text === "Would you like to gamble?")?.steps ?? [];
        return branch.slice(branch.findIndex(step => step.type === "input") + 1);
      });
    } };
    player.setEnteredAmountAction(input);
    player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
  }

  function openGamble(player) {
    const gamble = gambles.get(player);
    if (!gamble || gamble.phase !== "offer" || !canGamble(player) || !atGamble(player, gamble)) return;
    const amount = gamble.amount;
    if (amount < 1 || amount > GAMBLE_MAXIMUM || !held(player, COINS_ITEM_ID, amount)) return;
    player.getPacketSender().sendInterfaceRemoval();
    gamble.phase = "roll";
    gamble.bank = gambleBank(player);
    gamble.drunk = player.getAttribute(DRUNK_ATTRIBUTE) === true;
    gamble.harold = [rollDie(), rollDie()];
    // Harold's warning: leaving after his first roll forfeits the stake.
    player.getInventory().deleteNumber(COINS_ITEM_ID, amount);
    player.setAttribute(GAMBLE_BANK_ATTRIBUTE, gamble.bank + amount);
    const sender = player.getPacketSender();
    sender.sendInterface(GAMBLE_GROUP);
    sender.sendString(player.getDisplayName(), gambleComponent("playername"));
    sender.sendString(String(amount), gambleComponent("player_stake"));
    sender.sendString(String(amount), gambleComponent("harold_stake"));
    for (const side of ["harold", "player"]) {
      for (let pile = 1; pile <= 10; pile++) sender.sendInterfaceDisplayState(gambleComponent(`${side}_gold${pile}`), pile !== 1);
      sender.sendItemOnInterfaces(gambleComponent(`${side}_gold1`), COINS_ITEM_ID, amount);
      sender.sendInterfaceAngle(gambleComponent(`${side}_gold1`), 149, 1698, 445);
    }
    sender.sendInterfaceDisplayState(gambleComponent("result"), true);
    sender.sendInterfaceDisplayState(gambleComponent("continue"), true);
    sender.sendInterfaceDisplayState(gambleComponent("roll"), false);
    for (let die = 1; die <= 2; die++) {
      sender.sendInterfaceAnimation(gambleComponent(`harold_dice${die}`), CacheDefinitions.getSeqId(`dice_roll_${gamble.harold[die - 1]}`));
      sender.sendInterfaceAnimation(gambleComponent(`player_dice${die}`), CacheDefinitions.getSeqId("dice_idle"));
    }
  }

  const rollDie = () => Math.floor(Math.random() * 6) + 1;

  function gambleClick(event) {
    const { player, buttonId } = event;
    if ((buttonId >>> 16) !== GAMBLE_GROUP) return;
    const roll = buttonId === gambleComponent("roll_button");
    const next = buttonId === gambleComponent("continue_button");
    if (!roll && !next) return;
    event.handled = true;
    const gamble = gambles.get(player);
    if (!gamble || player.getInterfaceId() !== GAMBLE_GROUP || !canGamble(player) || !atGamble(player, gamble)) return;
    if (roll && gamble.phase === "roll") {
      gamble.phase = "result";
      const dice = [rollDie(), rollDie()];
      const total = dice[0] + dice[1], opponent = gamble.harold[0] + gamble.harold[1];
      // shortcut: no OSRS tie capture is available; refund equal totals until verified.
      gamble.draw = !gamble.drunk && total === opponent;
      gamble.won = gamble.drunk || total > opponent;
      gamble.outOfMoney = gamble.won && gamble.amount > gamble.bank && gamble.amount >= GAMBLE_IOU_MINIMUM;
      if (gamble.won || gamble.draw) {
        const winnings = gamble.won ? Math.min(gamble.amount, gamble.bank) : 0;
        player.getInventory().forceAdd(player, new Item(COINS_ITEM_ID, gamble.amount + winnings));
        player.setAttribute(GAMBLE_BANK_ATTRIBUTE, gamble.bank - winnings);
      }
      if (gamble.outOfMoney) player.setAttribute(GAMBLE_IOU_ATTRIBUTE, true);
      const sender = player.getPacketSender();
      for (let die = 1; die <= 2; die++) sender.sendInterfaceAnimation(gambleComponent(`player_dice${die}`), CacheDefinitions.getSeqId(`dice_roll_${dice[die - 1]}`));
      sender.sendString(gamble.draw ? "It's a draw!" : gamble.won ? "You win!" : "You lose!", gambleComponent("result"));
      sender.sendInterfaceDisplayState(gambleComponent("result"), false);
      sender.sendInterfaceDisplayState(gambleComponent("roll"), true);
      sender.sendInterfaceDisplayState(gambleComponent("continue"), false);
    } else if (next && gamble.phase === "result") {
      gamble.phase = "outro";
      player.getPacketSender().sendInterfaceRemoval();
      if (!gamble.draw) startTranscript(api, player, HAROLD_NPC_ID, "Death Plateau", GAMBLE_FINISH_VARIANT);
    }
  }

  function closeGamble({ player, interfaceId }) {
    if (interfaceId !== GAMBLE_GROUP) return;
    if (gambles.get(player)?.phase !== "outro") gambles.delete(player);
  }

  function forgetGamble({ player }) {
    gambles.delete(player);
  }

  const mapReceived = player => player.getAttribute(MAP_RECEIVED_ATTRIBUTE) === true || quest.getStage(player) >= STAGE_MAP || hasMap(player);
  const readyToFinish = player => quest.getStage(player) >= STAGE_SCOUTED &&
    (hasMap(player) || player.getAttribute(MAP_DELIVERED_ATTRIBUTE) === true) &&
    (hasCombination(player) || player.getAttribute(COMBINATION_DELIVERED_ATTRIBUTE) === true);

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I found a secret route to Death Plateau.</str>",
        "<str>The Burthorpe Imperial Guard can use the route.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_SCOUTED) {
      return [
        "I checked the secret path. It is safe for the Imperial Guard.",
        "I should report back to <col=800000>Denulth</col>.",
      ];
    }
    if (mapReceived(player)) return ["I should follow the secret path north and east from Tenzing's hut before returning to Denulth."];
    if (stage >= STAGE_BOOTS) return ["I should bring the spiked boots, ten bread and ten trout to Tenzing."];
    if (stage >= STAGE_SABA) {
      return [
        "Tenzing showed me the secret route.",
        "I need <col=800000>Dunstan</col> to add spikes to the climbing boots.",
      ];
    }
    if (stage >= STAGE_ROOM) {
      return [
        "I unlocked the equipment room.",
        "I should ask <col=800000>Saba</col> about another route.",
      ];
    }
    if (stage >= STAGE_COMBINATION) return ["I should use the combination to arrange the stone balls in Burthorpe Castle."];
    if (stage >= STAGE_IOU) return ["I should read Harold's IOU."];
    if (stage >= STAGE_ALE) return ["I can gamble with Harold, or offer him a Blurberry special."];
    if (stage >= STAGE_WEAKNESS) {
      return ["I should buy <col=800000>Harold</col> an Asgarnian ale."];
    }
    if (stage >= STAGE_HAROLD) {
      return ["Harold won't talk. I should ask <col=800000>Eohric</col> for help."];
    }
    if (stage >= STAGE_EOHRIC) {
      return [
        "Harold may know how the trolls reach the plateau.",
        "He drinks in the <col=800000>Toad and Chicken</col> in Burthorpe.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<col=800000>Denulth</col> needs a secret route to Death Plateau.",
        "I should speak to <col=800000>Eohric</col> in Burthorpe Castle.",
      ];
    }
    return [
      "I can start this quest by speaking to",
      "<col=800000>Denulth</col> in the Burthorpe training camp.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.ATTACK, 3000);
  }

  /** Denulth, Tenzing and Dunstan also front Troll Stronghold once Death Plateau is done. */
  function trollStrongholdActive(player) {
    const trollStronghold = getRegisteredQuests().find((entry) => entry.key === "troll_stronghold");
    return Boolean(trollStronghold && trollStronghold.isStarted(player) && !trollStronghold.isComplete(player));
  }

  function sharedWithTrollStronghold(npcId) {
    return DENULTH_NPC_IDS.has(npcId) || npcId === TENZING_NPC_ID || npcId === DUNSTAN_NPC_ID;
  }

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === TENZING_NPC_ID && quest.isComplete(player) && !trollStrongholdActive(player)) {
      return { page: "Tenzing", variant: "after-death-plateau" };
    }
    if (sharedWithTrollStronghold(npcId) && (quest.isComplete(player) || trollStrongholdActive(player))) {
      return null;
    }
    if (DENULTH_NPC_IDS.has(npcId)) {
      if (stage === 0) return "getting-started-talking-to-denulth";
      if (stage < STAGE_ROOM) return "getting-started-talking-to-denulth-again";
      if (stage >= STAGE_SCOUTED) {
        return "finishing-up-talking-to-denulth-after-opening-the-equipment-room-and-exploring-the-path";
      }
      if (stage >= STAGE_DUNSTAN && stage < STAGE_BOOTS && !hasCertificate(player)
        && player.getAttribute(CERTIFICATE_DELIVERED_ATTRIBUTE) !== true) {
        return player.getAttribute(CERTIFICATE_ISSUED_ATTRIBUTE) === true
          ? "new-route-up-death-plateau-talking-to-denulth-after-losing-the-certificate"
          : "new-route-up-death-plateau-talking-to-denulth-after-talking-to-dunstan";
      }
      return "new-route-up-death-plateau-talking-to-denulth-after-opening-the-equipment-room";
    }
    if (npcId === EOHRIC_NPC_ID) {
      if (stage === STAGE_STARTED) quest.setStage(player, STAGE_EOHRIC);
      if (stage >= STAGE_ROOM) {
        return "finding-the-combination-talking-to-eohric-after-opening-the-equipment-room";
      }
      if (stage >= STAGE_WEAKNESS) return "finding-the-combination-talking-to-eohric-again-after-learning-harold-s-weakness";
      if (stage >= STAGE_HAROLD) {
        quest.setStage(player, STAGE_WEAKNESS);
        return "finding-the-combination-talking-to-eohric-after-talking-to-harold";
      }
      if (stage >= STAGE_EOHRIC) return "finding-the-combination-talking-to-eohric-talking-to-eohric-again";
      return "finding-the-combination-talking-to-eohric";
    }
    if (npcId === HAROLD_NPC_ID) {
      if (stage >= STAGE_ALE && stage < STAGE_COMBINATION && !held(player, IOU_ITEM_ID) && !hasCombination(player) && player.getAttribute(GAMBLE_IOU_ATTRIBUTE) === true) {
        gambles.set(player, { phase: "outro", won: true, outOfMoney: true, drunk: player.getAttribute(DRUNK_ATTRIBUTE) === true });
        return GAMBLE_FINISH_VARIANT;
      }
      if (stage >= STAGE_IOU) {
        if (!hasCombination(player) && !held(player, IOU_ITEM_ID)) return "finding-the-combination-talking-to-harold-after-losing-the-iou";
        return player.getAttribute(DRUNK_ATTRIBUTE) === true
          ? "finding-the-combination-talking-to-harold-while-still-holding-the-iou-if-harold-is-drunk"
          : "finding-the-combination-talking-to-harold-while-still-holding-the-iou-if-harold-is-not-drunk";
      }
      if (player.getAttribute(DRUNK_ATTRIBUTE) === true) return "finding-the-combination-talking-to-harold-after-giving-him-a-blurberry-special";
      if (stage >= STAGE_ALE) return "finding-the-combination-talking-to-harold-after-giving-him-an-asgarnian-ale";
      if (stage >= STAGE_WEAKNESS) return "finding-the-combination-talking-to-harold-after-learning-his-weakness";
      if (stage >= STAGE_HAROLD) return "finding-the-combination-talking-to-harold-again";
      if (stage >= STAGE_EOHRIC) quest.setStage(player, STAGE_HAROLD);
      return "finding-the-combination-talking-to-harold";
    }
    if (npcId === SABA_NPC_ID) {
      if (stage === STAGE_ROOM) quest.setStage(player, STAGE_SABA);
      if (stage >= STAGE_SABA) return "new-route-up-death-plateau-talking-to-saba-after-getting-the-map";
      if (stage >= STAGE_ROOM) return "new-route-up-death-plateau-talking-to-saba";
      return "new-route-up-death-plateau-talking-to-saba-before-visiting-tenzing";
    }
    if (npcId === TENZING_NPC_ID) {
      if (mapReceived(player) && !hasMap(player)) return "new-route-up-death-plateau-talking-to-tenzing-after-losing-the-map";
      if (stage >= STAGE_SCOUTED) return "finishing-up-talking-to-tenzing-after-scouting-the-path";
      if (hasMap(player)) return "new-route-up-death-plateau-talking-to-tenzing-while-holding-the-map";
      if (stage >= STAGE_SABA) {
        if (!hasBoots(player)) {
          return stage >= STAGE_CLIMBING_BOOTS
            ? "new-route-up-death-plateau-talking-to-tenzing-without-climbing-or-spiked-boots"
            : "new-route-up-death-plateau-talking-to-tenzing";
        }
        return "new-route-up-death-plateau-talking-to-tenzing-while-holding-climbing-or-spiked-boots";
      }
      return "new-route-up-death-plateau-talking-to-tenzing-before-fixing-the-boots";
    }
    if (npcId === DUNSTAN_NPC_ID) {
      if (stage >= STAGE_BOOTS) {
        return held(player, SPIKED_BOOTS_ITEM_ID)
          ? "new-route-up-death-plateau-talking-to-dunstan-after-getting-the-spiked-boots"
          : "new-route-up-death-plateau-talking-to-dunstan-before-getting-the-spiked-boots";
      }
      if (stage >= STAGE_DUNSTAN) {
        if (player.getAttribute(CERTIFICATE_DELIVERED_ATTRIBUTE) === true) return "new-route-up-death-plateau-talking-to-dunstan-before-getting-the-spiked-boots";
        if (hasCertificate(player)) return "new-route-up-death-plateau-talking-to-dunstan-while-holding-the-certificate";
        return "new-route-up-death-plateau-talking-to-dunstan-again";
      }
      if (stage >= STAGE_CLIMBING_BOOTS) quest.setStage(player, STAGE_DUNSTAN);
      return "new-route-up-death-plateau-talking-to-dunstan";
    }
    if (ARCHER_NPC_IDS.has(npcId)) {
      return "finding-the-combination-talking-to-archer-upstairs-in-the-equipment-room";
    }
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, npcId, text }) {
    const value = String(text).toLowerCase();
    if (npcId === TENZING_NPC_ID && quest.isComplete(player)) {
      if (value.includes("does not have enough coins") || value.includes("does not have enough money")) return !held(player, COINS_ITEM_ID, CLIMBING_BOOTS_PRICE);
      if (value.includes("has enough coins") || value.includes("has 12 gp")) return held(player, COINS_ITEM_ID, CLIMBING_BOOTS_PRICE);
    }
    // Same shared speakers as selectVariant: once Troll Stronghold owns them, its conditions are not ours.
    if (sharedWithTrollStronghold(npcId) && (quest.isComplete(player) || trollStrongholdActive(player))) {
      return null;
    }
    const has = (itemId, amount = 1) => held(player, itemId, amount);
    const gamble = gambles.get(player);
    if (npcId === HAROLD_NPC_ID) {
      if (value === "if harold is not drunk and harold wins:") return !!gamble && !gamble.drunk && !gamble.won;
      if (value === "if harold is not drunk and the player wins:") return !!gamble && !gamble.drunk && gamble.won;
      if (value === "if harold still has money:") return !!gamble && !gamble.outOfMoney;
      if (value === "if harold is out of money:") return !!gamble?.outOfMoney;
      if (value.includes("if the player enters 0")) return gamble?.amount === 0;
      if (value.includes("if the player enters more than they are holding")) return gamble?.amount > player.getInventory().getAmount(COINS_ITEM_ID);
      if (value.includes("if the player enters more than 1000")) return gamble?.amount > GAMBLE_MAXIMUM;
    }
    if (value === "if harold is drunk:") return player.getAttribute(DRUNK_ATTRIBUTE) === true;
    if (value === "if harold is not drunk:") return player.getAttribute(DRUNK_ATTRIBUTE) !== true;
    if (value.includes("does not have an asgarnian ale")) return !has(ASGARNIAN_ALE_ITEM_ID);
    if (value.includes("has an asgarnian ale")) return has(ASGARNIAN_ALE_ITEM_ID);
    if (value.includes("does not have a blurberry special")) return !has(BLURBERRY_SPECIAL_ITEM_ID) && !has(PREMADE_BLURBERRY_ITEM_ID);
    if (value.includes("has not yet read the iou")) return quest.getStage(player) < STAGE_COMBINATION;
    if (value.includes("has read the iou")) return quest.getStage(player) >= STAGE_COMBINATION;
    if (value.includes("has the boots and an iron bar")) return hasBoots(player) && has(IRON_BAR_ITEM_ID);
    if (value.includes("neither climbing boots nor iron bar"))
      return !hasBoots(player) && !has(IRON_BAR_ITEM_ID);
    if (value.includes("does not have the climbing boots")) return !hasBoots(player);
    if (value.includes("does not have an iron bar")) return !has(IRON_BAR_ITEM_ID);
    if (value.includes("missing spiked boots, bread, and trout"))
      return !has(SPIKED_BOOTS_ITEM_ID) && !has(BREAD_ITEM_ID, TENZING_SUPPLY_AMOUNT) && !has(TROUT_ITEM_ID, TENZING_SUPPLY_AMOUNT);
    if (value.includes("missing spiked boots and bread"))
      return !has(SPIKED_BOOTS_ITEM_ID) && !has(BREAD_ITEM_ID, TENZING_SUPPLY_AMOUNT);
    if (value.includes("missing spiked boots and trout"))
      return !has(SPIKED_BOOTS_ITEM_ID) && !has(TROUT_ITEM_ID, TENZING_SUPPLY_AMOUNT);
    if (value.includes("missing bread and trout"))
      return !has(BREAD_ITEM_ID, TENZING_SUPPLY_AMOUNT) && !has(TROUT_ITEM_ID, TENZING_SUPPLY_AMOUNT);
    if (value.includes("missing spiked boots")) return !has(SPIKED_BOOTS_ITEM_ID);
    if (value.includes("missing bread")) return !has(BREAD_ITEM_ID, TENZING_SUPPLY_AMOUNT);
    if (value.includes("missing trout")) return !has(TROUT_ITEM_ID, TENZING_SUPPLY_AMOUNT);
    if (value.includes("doesn't have the map")) return !hasMap(player) && player.getAttribute(MAP_DELIVERED_ATTRIBUTE) !== true;
    if (value.includes("has the map")) return hasMap(player) || player.getAttribute(MAP_DELIVERED_ATTRIBUTE) === true;
    if (value.includes("doesn't have the combination")) return !hasCombination(player) && player.getAttribute(COMBINATION_DELIVERED_ATTRIBUTE) !== true;
    if (value.includes("has the combination")) return hasCombination(player) || player.getAttribute(COMBINATION_DELIVERED_ATTRIBUTE) === true;
    if (value.startsWith("if the player has not turned in all the items"))
      return !readyToFinish(player);
    if (value.startsWith("if the player has turned in all the items"))
      return readyToFinish(player);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!DENULTH_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** Transcript message hand-outs and the final hand-in. */
  function handleAction(request) {
    const { player, npcId, stepId, step, action, target, kind } = request;

    if (npcId === HAROLD_NPC_ID && step?.type === "input") {
      request.handled = request.end = true;
      if (canGamble(player)) enterWager(player);
      return;
    }
    if (npcId === HAROLD_NPC_ID && action === "open_interface" && target === GAMBLING_INTERFACE) {
      request.handled = request.end = true;
      openGamble(player);
      return;
    }
    if (DENULTH_NPC_IDS.has(npcId) && COMPLETE_ACTION_IDS.has(stepId)) {
      if (readyToFinish(player)) {
        player.getInventory().deleteNumber(SECRET_WAY_MAP_ITEM_ID, 1);
        player.getInventory().deleteNumber(COMBINATION_ITEM_ID, 1);
        player.getInventory().deleteNumber(IOU_ITEM_ID, 1);
        quest.complete(player);
      }
      return;
    }
    // Only message events consume and hand out items.
    if (kind !== "message") return;
    if (npcId === HAROLD_NPC_ID && stepId === READ_IOU_STEP_ID && held(player, IOU_ITEM_ID)) {
      player.getInventory().deleteNumber(IOU_ITEM_ID, 1);
      if (!hasCombination(player)) player.getInventory().adds(COMBINATION_ITEM_ID, 1);
      if (quest.getStage(player) < STAGE_COMBINATION) quest.setStage(player, STAGE_COMBINATION);
      return;
    }
    if (stepId === GIVE_DENULTH_MAP_STEP_ID && DENULTH_NPC_IDS.has(npcId) && quest.getStage(player) >= STAGE_SCOUTED && hasMap(player)) {
      player.getInventory().deleteNumber(SECRET_WAY_MAP_ITEM_ID, 1);
      player.setAttribute(MAP_DELIVERED_ATTRIBUTE, true);
    }
    if (stepId === GIVE_DENULTH_COMBINATION_STEP_ID && DENULTH_NPC_IDS.has(npcId) && quest.getStage(player) >= STAGE_SCOUTED && hasCombination(player)) {
      player.getInventory().deleteNumber(COMBINATION_ITEM_ID, 1);
      player.setAttribute(COMBINATION_DELIVERED_ATTRIBUTE, true);
    }
    if (npcId === TENZING_NPC_ID && BUY_CLIMBING_BOOTS_IDS.has(stepId)) {
      const inventory = player.getInventory();
      const coins = inventory.getAmount(COINS_ITEM_ID);
      if (!quest.isComplete(player) || coins < CLIMBING_BOOTS_PRICE) {
        request.handled = request.end = true;
        return;
      }
      if (inventory.isFull() && coins > CLIMBING_BOOTS_PRICE) {
        inventory.full();
        request.handled = request.end = true;
        return;
      }
      inventory.deleteNumber(COINS_ITEM_ID, CLIMBING_BOOTS_PRICE);
      inventory.adds(CLIMBING_BOOTS_ITEM_ID, 1);
      return;
    }
    if (GIVE_ALE_STEP_IDS.has(stepId)) {
      player.getInventory().deleteNumber(ASGARNIAN_ALE_ITEM_ID, 1);
      if (quest.getStage(player) < STAGE_ALE) quest.setStage(player, STAGE_ALE);
      return;
    }
    if (stepId === GIVE_BLURBERRY_STEP_ID) {
      player.getInventory().deleteNumber(held(player, BLURBERRY_SPECIAL_ITEM_ID) ? BLURBERRY_SPECIAL_ITEM_ID : PREMADE_BLURBERRY_ITEM_ID, 1);
      player.setAttribute(DRUNK_ATTRIBUTE, true);
      return;
    }
    if (stepId === GIVE_CERTIFICATE_STEP_ID) {
      player.getInventory().deleteNumber(CERTIFICATE_ITEM_ID, 1);
      player.setAttribute(CERTIFICATE_DELIVERED_ATTRIBUTE, true);
      return;
    }
    if (GIVE_IOU_IDS.has(stepId)) {
      giveIou(player);
      return;
    }
    if (GIVE_CLIMBING_BOOTS_IDS.has(stepId)) {
      if (!hasBoots(player)) player.getInventory().adds(CLIMBING_BOOTS_ITEM_ID, 1);
      if (quest.getStage(player) < STAGE_CLIMBING_BOOTS) quest.setStage(player, STAGE_CLIMBING_BOOTS);
      return;
    }
    if (npcId === TENZING_NPC_ID && GIVE_MAP_IDS.has(stepId)) {
      if (!mapReceived(player)) {
        if (!held(player, SPIKED_BOOTS_ITEM_ID) || !held(player, BREAD_ITEM_ID, TENZING_SUPPLY_AMOUNT) || !held(player, TROUT_ITEM_ID, TENZING_SUPPLY_AMOUNT)) {
          request.handled = request.end = true;
          return;
        }
        // Exchange together so closing the dialogue cannot strand the quest without boots.
        player.getInventory().deleteNumber(SPIKED_BOOTS_ITEM_ID, 1);
        player.getInventory().deleteNumber(BREAD_ITEM_ID, TENZING_SUPPLY_AMOUNT);
        player.getInventory().deleteNumber(TROUT_ITEM_ID, TENZING_SUPPLY_AMOUNT);
      }
      player.setAttribute(MAP_RECEIVED_ATTRIBUTE, true);
      if (!hasMap(player)) player.getInventory().adds(SECRET_WAY_MAP_ITEM_ID, 1);
      if (quest.getStage(player) < STAGE_MAP) quest.setStage(player, STAGE_MAP);
      return;
    }
    if (npcId === DUNSTAN_NPC_ID && GIVE_SPIKED_BOOTS_IDS.has(stepId)) {
      if (!held(player, SPIKED_BOOTS_ITEM_ID)) {
        if (!held(player, CLIMBING_BOOTS_ITEM_ID) || !held(player, IRON_BAR_ITEM_ID)) {
          request.handled = request.end = true;
          return;
        }
        player.getInventory().deleteNumber(IRON_BAR_ITEM_ID, 1);
        player.getInventory().deleteNumber(CLIMBING_BOOTS_ITEM_ID, 1);
        player.getInventory().adds(SPIKED_BOOTS_ITEM_ID, 1);
      }
      if (quest.getStage(player) < STAGE_BOOTS) quest.setStage(player, STAGE_BOOTS);
      return;
    }
    if (GIVE_CERTIFICATE_IDS.has(stepId)) {
      if (!hasCertificate(player) && player.getAttribute(CERTIFICATE_DELIVERED_ATTRIBUTE) !== true) {
        player.getInventory().adds(CERTIFICATE_ITEM_ID, 1);
        if (hasCertificate(player)) player.setAttribute(CERTIFICATE_ISSUED_ATTRIBUTE, true);
        else request.handled = true;
      }
    }
  }

  function readIou(event) {
    if (event.itemId !== IOU_ITEM_ID || !held(event.player, IOU_ITEM_ID)) return false;
    return startTranscript(api, event.player, HAROLD_NPC_ID, "Death Plateau", "finding-the-combination-reading-the-iou");
  }

  function readCombination({ player, itemId }) {
    if (itemId !== COMBINATION_ITEM_ID || !hasCombination(player)) return false;
    for (const line of ["Red is north of Blue.", "Yellow is south of Purple.", "Green is north of Purple.", "Blue is west of Yellow.", "Purple is east of Red."]) player.sendMessage(line);
    return true;
  }

  function useDrinkOnHarold(event) {
    if (event.npcId !== HAROLD_NPC_ID || ![ASGARNIAN_ALE_ITEM_ID, BLURBERRY_SPECIAL_ITEM_ID, PREMADE_BLURBERRY_ITEM_ID].includes(event.itemId)) return;
    const stage = quest.getStage(event.player);
    if (stage < STAGE_WEAKNESS || stage >= STAGE_IOU || !held(event.player, event.itemId)) return;
    if (event.itemId === ASGARNIAN_ALE_ITEM_ID && stage >= STAGE_ALE) return;
    if (event.itemId !== ASGARNIAN_ALE_ITEM_ID && stage < STAGE_ALE) return;
    const variant = "finding-the-combination-talking-to-harold-after-learning-his-weakness";
    const select = event.itemId === ASGARNIAN_ALE_ITEM_ID ? undefined : steps => steps
      .filter(step => step.type === "choice")
      .flatMap(step => step.options.find(option => option.text === "Can I buy you a drink?")?.steps ?? []);
    event.handled = startTranscript(api, event.player, HAROLD_NPC_ID, "Death Plateau", variant, select);
  }

  function mechanismKey(location) {
    const tile = new Location(location.x, location.y, location.z);
    return location.x >= 2894 && location.x <= 2895 && location.y >= 3562 && location.y <= 3564 && PUZZLE_BOUNDS.inside(tile)
      ? `${location.x},${location.y}` : null;
  }

  function syncPuzzle(player) {
    const manager = api.getItemOnGroundManager();
    for (const [key, itemId] of Object.entries(player.getAttribute(PUZZLE_ATTRIBUTE) ?? {})) {
      const [x, y] = key.split(",").map(Number);
      const tile = new Location(x, y, 0);
      if (!manager.getGroundItem(player.getUsername(), itemId, tile, player.getPrivateArea())) manager.registerNonGlobals(player, new Item(itemId, 1), tile);
    }
  }

  function placeBall(event) {
    if (!MECHANISM_IDS.has(event.objectId) || !BALL_IDS.includes(event.itemId)) return;
    const key = mechanismKey(event.location);
    if (!key || !held(event.player, event.itemId)) return;
    event.handled = true;
    const { player } = event;
    const inventory = player.getInventory();
    const balls = { ...(player.getAttribute(PUZZLE_ATTRIBUTE) ?? {}) };
    const previous = balls[key];
    const manager = api.getItemOnGroundManager();
    const tile = new Location(event.location.x, event.location.y, 0);
    if (previous) {
      const ground = manager.getGroundItem(player.getUsername(), previous, tile, player.getPrivateArea());
      if (ground) manager.deregister(ground);
    }
    inventory.deleteNumber(event.itemId, 1);
    if (previous) inventory.adds(previous, 1);
    balls[key] = event.itemId;
    player.setAttribute(PUZZLE_ATTRIBUTE, balls);
    syncPuzzle(player);
    if (quest.getStage(player) === STAGE_COMBINATION && Object.keys(balls).length === BALL_SOLUTION.size && [...BALL_SOLUTION].every(([position, id]) => balls[position] === id)) {
      quest.setStage(player, STAGE_ROOM);
      player.sendMessage("The equipment room door has unlocked.");
    }
  }

  function takePlacedBall(event) {
    const key = mechanismKey(event.location);
    const balls = { ...(event.player.getAttribute(PUZZLE_ATTRIBUTE) ?? {}) };
    if (!key || balls[key] !== event.groundItemId || event.groundItem.getOwner() !== event.player.getUsername()) return;
    event.handled = true;
    const inventory = event.player.getInventory();
    if (inventory.isFull()) { inventory.full(); return; }
    delete balls[key];
    event.player.setAttribute(PUZZLE_ATTRIBUTE, balls);
    inventory.adds(event.groundItemId, 1);
    api.getItemOnGroundManager().deregister(event.groundItem);
  }

  function createPuzzleArea() {
    class PuzzleArea extends api.core.Area {
      process(mobile) {
        if (mobile.isPlayer()) syncPuzzle(mobile.getAsPlayer());
      }
    }
    return new PuzzleArea([PUZZLE_BOUNDS]);
  }

  function scoutPath(player) {
    if (quest.getStage(player) < STAGE_BOOTS || quest.getStage(player) >= STAGE_SCOUTED || !hasMap(player) || !SCOUT_BOUNDS.inside(player.getLocation())) return;
    quest.setStage(player, STAGE_SCOUTED);
    startTranscript(api, player, TENZING_NPC_ID, "Death Plateau", "new-route-up-death-plateau-walking-far-enough-up-the-death-plateau-trail");
  }

  function createScoutArea() {
    class ScoutArea extends api.core.Area {
      postEnter(mobile) { if (mobile.isPlayer()) scoutPath(mobile.getAsPlayer()); }
      process(mobile) { if (mobile.isPlayer()) scoutPath(mobile.getAsPlayer()); }
    }
    return new ScoutArea([SCOUT_BOUNDS]);
  }

  function guardFinalReport({ player }) {
    if (quest.isComplete(player) || quest.getStage(player) < STAGE_BOOTS || quest.getStage(player) >= STAGE_SCOUTED || !mapReceived(player)) return false;
    player.sendMessage("I should follow Tenzing's secret path north and east and check it is safe before reporting to Denulth.");
    return true;
  }

  function guardQuestDoors(request) {
    if (request.objectId === EQUIPMENT_DOOR_ID && quest.getStage(request.player) < STAGE_ROOM) {
      request.player.sendMessage("The equipment room door is locked. I should read the combination and arrange the stone balls.");
      request.handled = true;
      return;
    }
    if (request.objectId !== HAROLD_DOOR_ID || quest.getStage(request.player) >= STAGE_EOHRIC) return;
    request.player.sendMessage("I'd better not go into someone's bedroom without a reason!");
    request.handled = true;
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "death_plateau",
    name: "Death Plateau",
    varpId: VARP_DEATH_PLATEAU,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.ATTACK.getIndex(), amount: 3000, label: "Attack" }],
    rewardItemId: ItemIdentifiers.STEEL_CLAWS,
    rewardItemLabel: "Steel claws",
    otherRewards: ["The ability to make climbing boots and steel claws"],
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(DRUNK_ATTRIBUTE);
  api.persistAttribute(GAMBLE_BANK_ATTRIBUTE, HAROLD_STARTING_COINS);
  api.persistAttribute(GAMBLE_IOU_ATTRIBUTE, false);
  api.persistAttribute(CERTIFICATE_DELIVERED_ATTRIBUTE);
  api.persistAttribute(CERTIFICATE_ISSUED_ATTRIBUTE, false);
  api.persistAttribute(PUZZLE_ATTRIBUTE);
  api.persistAttribute(MAP_RECEIVED_ATTRIBUTE);
  api.persistAttribute(MAP_DELIVERED_ATTRIBUTE);
  api.persistAttribute(COMBINATION_DELIVERED_ATTRIBUTE);
  api.registerArea(createPuzzleArea());
  api.registerArea(createScoutArea());
  api.onItemAction("Iou", { Read: readIou });
  api.onItemAction("Combination", { Read: readCombination });
  api.onItemOnNpc(useDrinkOnHarold, { noted: false });
  api.onItemOnObject("Stone ball", "Stone Mechanism", placeBall, { noted: false });
  api.onGroundItemPickup(takePlacedBall);
  api.onNpcInteraction("Denulth", { "Talk-to": guardFinalReport });
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onInterfaceActionClick(gambleClick);
  api.onCustomEvent("interface:closed", closeGamble);
  api.onCustomEvent("door:toggle", guardQuestDoors);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(forgetGamble);
  api.onPlayerDisconnect(forgetGamble);
};
