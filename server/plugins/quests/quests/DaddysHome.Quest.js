/**
 * Daddy's Home (members miniquest, Mahogany Homes prerequisite content).
 *
 * Source of truth: the OSRS Wiki walkthrough/quick guide and Transcript:Daddy's Home.
 * Quest Helper `helpers/miniquests/daddyshome/DaddysHome.java` supplies the stage map:
 *   0  talk to Marlo
 *   1  talk to Old Man Yarlo
 *   2  remove the seven old furnishings
 *   3/4 all removed, talk to Yarlo again
 *   5-9 rebuild the furniture (stools, tables, chair, carpet, waxwood bed)
 *   10-12 talk to Marlo for the reward
 * Cache DB row 159 (type 1 = miniquest) completes at varbit 10570 (varp 393 bits 19-22) = 13.
 *
 * The seven furniture varbits live in the same shared varp as Karamja/Kalphite/God Wars
 * bits, so they are read and written individually:
 *   10563 stool 1, 10564 stool 2, 10565 chair, 10566 table 1,
 *   10567 table 2, 10568 bed, 10569 carpet.
 * Loc transforms: 0 broken (no option), 1 broken (Demolish/Remove), 2 hotspot (Build), 3 fixed.
 * The plugin stores the durable state in `daddys-home:furniture` because varp 393 is rebuilt on
 * login; `syncFurniture` reconciles the saved state with the stage and resends the varbits.
 *
 * The generated npc-dialogues export has no "Daddy's Home" transcript page, so the quest
 * conversations are replayed here from the Wiki transcript (Marlo, Old Man Yarlo and the
 * Varrock sawmill operator). The generic Old Man Yarlo/Marlo pages remain the fallback outside
 * the quest's stage windows.
 *
 * Known difference: Yarlo's Construction demonstration follows RSProx 3218's beats, camera and
 * message lines but plays in Yarlo's house rather than instantiating the capture's POH template
 * room. Nails bend per nail, with the captured "You accidentally bend a nail." message.
 */
module.exports = function registerDaddysHomeQuest(api) {
  const {
    ActionDialogue,
    Animation,
    DialogueChainBuilder,
    EndDialogue,
    Equipment,
    Item,
    ItemDefinition,
    ItemIdentifiers: Items,
    ItemStatementDialogue,
    Location,
    NpcDialogue,
    NpcIdentifiers,
    OptionDialogue,
    PlayerDialogue,
    Skill,
    StatementDialogue,
  } = api.core;
  const { registerQuest } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");

  // Cache ids (gamevals from osrs-241_2026-10-20).
  const MARLO_NPC_IDS = new Set([
    NpcIdentifiers.MARLO, // 10408, one-op form before joining Mahogany Homes
    NpcIdentifiers.MARLO_2, // 10409, contract form after joining
  ]);
  const OLD_MAN_YARLO_NPC_ID = NpcIdentifiers.OLD_MAN_YARLO; // 10425
  const SAWMILL_OPERATOR_NPC_ID = NpcIdentifiers.SAWMILL_OPERATOR; // 3101, Varrock Lumberyard

  const WAXWOOD_LOG = 24938;
  const WAXWOOD_PLANK = 24939;
  const MARLOS_CRATE = 24940;

  const VARP_DADDYS_HOME = 393;
  const VARBIT_STATUS = 10570;
  const FURNITURE_VARBITS = [10563, 10564, 10565, 10566, 10567, 10568, 10569];
  const FURNITURE_ATTRIBUTE = "daddys-home:furniture";
  const CRATE_OPENED_ATTRIBUTE = "daddys-home:crate-opened";

  const STAGE_STARTED = 1;
  const STAGE_REMOVE = 2;
  const STAGE_REMOVED = 3;
  const STAGE_BUILD = 5;
  const STAGE_BUILT = 9;
  const STAGE_REWARD = 10;
  const STAGE_COMPLETE = 13;

  const STATE_BROKEN = 1;
  const STATE_HOTSPOT = 2;
  const STATE_BUILT = 3;

  const BUILD_ANIMATION = 3676; // human_poh_build
  const REMOVE_ANIMATION = 3685; // human_throw_away
  const BUILD_SOUND = 938;
  const REMOVE_SOUNDS = [2097, 2098];

  // RSProx 3218 (rev 232): the cutscene's builder variants and the POH demo room.
  const CUTSCENE_BUILDER_PLAIN = NpcIdentifiers.OLD_MAN_YARLO_2; // 10426
  const CUTSCENE_BUILDER_HAMMER = NpcIdentifiers.OLD_MAN_YARLO_3; // 10427
  const CUTSCENE_BOUNDS = [[3237, 3246, 3391, 3399, 0]];
  const CUTSCENE_HOME = new Location(3240, 3395, 0);
  const CUTSCENE_LINES = [
    "As a builder, in your own house, you can create your own rooms full of furniture. A house may start out very basic...",
    "... but in Building Mode, you'll see what you can add to it...",
    "Old Man Yarlo builds a fully furnished parlour.",
    "... with fancier options available as your Construction level rises.",
    "Old Man Yarlo removes several furniture and builds fancier ones.",
    "You can add lots more rooms, and build their furniture too, unlocking really handy features.",
    "For example, in a study, you could build a lectern for creating spell tablets, powerful items that can cast spells without runes. You could sell your tablets to other people too.",
    "A Teleport Nexus can take you to a huge range of destinations, making your home a powerful travel hub.",
    "Show your dedication to the gods by building an altar, where you can sacrifice bones for bonus Prayer XP.",
    "With a regeneration pool, you can get healed quickly, before you teleport back to the action.",
    "The Estate Agents can redecorate your house in different styles, if you want something a bit more impressive.",
    "And, of course, to make your house feel truly like a home, you can fill it with adorable critters...",
    "... and drop your guests into the monster pit beneath your throne room.",
    "All this could be yours, if you train Construction!",
  ];
  const LECTURE_TICKS = 8;
  const NAIL_BEND_BASE = new Map([
    [Items.BRONZE_NAILS, 0.50],
    [Items.IRON_NAILS, 0.45],
    [Items.STEEL_NAILS, 0.40],
    [Items.BLACK_NAILS, 0.35],
    [Items.MITHRIL_NAILS, 0.30],
    [Items.ADAMANTITE_NAILS, 0.25],
    [Items.RUNE_NAILS, 0.20],
    [Items.DRAGON_NAILS, 0.15],
  ]);

  const SAW_IDS = [Items.SAW, Items.CRYSTAL_SAW, Items.AMYS_SAW];
  const NAIL_IDS = [
    Items.DRAGON_NAILS,
    Items.RUNE_NAILS,
    Items.ADAMANTITE_NAILS,
    Items.MITHRIL_NAILS,
    Items.BLACK_NAILS,
    Items.STEEL_NAILS,
    Items.IRON_NAILS,
    Items.BRONZE_NAILS,
  ];

  /** The seven pieces, in varbit order. */
  const PIECES = [
    { key: "stool-1", name: "stool", planks: 1, nails: 2, xp: 29 },
    { key: "stool-2", name: "stool", planks: 1, nails: 2, xp: 29 },
    { key: "chair", name: "chair", planks: 2, nails: 2, xp: 58 },
    { key: "table-1", name: "table", planks: 3, nails: 4, xp: 87 },
    { key: "table-2", name: "table", planks: 3, nails: 4, xp: 87 },
    { key: "bed", name: "bed", waxwood: 3, cloth: 2, xp: 207 },
    { key: "carpet", name: "carpet", cloth: 3, xp: 45 },
  ];

  // Base loc id -> piece index. The carpet is twelve placements sharing one transform.
  const PIECE_BY_LOC = new Map([
    [40300, 0],
    [40301, 1],
    [40302, 2],
    [40223, 3],
    [40224, 4],
    [40303, 5],
    [40304, 6],
    [40305, 6],
    [40306, 6],
  ]);

  // Yarlo's house: south-east Varrock, west of Aubury's Rune Shop (Quest Helper tiles).
  const HOUSE_BOUNDS = { minX: 3235, maxX: 3247, minY: 3390, maxY: 3400, z: 0 };

  const CRATE_OBJECT_ID = 40214;
  // Wiki contents, with the noted forms for the bulk materials so they fit in a normal bag.
  const CRATE_CONTENTS = [
    [Items.PLANK_2, 25],
    [Items.MITHRIL_NAILS, 50],
    [Items.STEEL_BAR_2, 5],
    [Items.OAK_PLANK_2, 10],
    [Items.BOLT_OF_CLOTH_2, 8],
    [Items.TELEPORT_TO_HOUSE, 5],
    [Items.FALADOR_TELEPORT, 1],
  ];

  const START_MESSAGE = "You've started a new miniquest: <col=081190>Daddy's Home</col>";

  let quest;
  const Scenes = createQuestScenes(api, { onEnd: onCutsceneEnd });

  const inventory = (player) => player.getInventory();
  const has = (player, itemId) => inventory(player).getAmount(itemId) > 0;
  const ownsCrate = (player) => {
    if (has(player, MARLOS_CRATE)) return true;
    const banks = player.getBanks?.() ?? (player.getBank ? [player.getBank()] : []);
    return banks.some((bank) => Number(bank?.getAmount?.(MARLOS_CRATE) ?? 0) > 0);
  };
  const hasSaw = (player) => {
    if (SAW_IDS.some((id) => has(player, id))) return true;
    // Amy's saw is an off-hand item.
    const offhand = player.getEquipment?.()?.getItems?.()[Equipment.SHIELD_SLOT];
    return SAW_IDS.includes(offhand?.getId?.());
  };

  function stateOf(player) {
    const saved = player.getAttribute(FURNITURE_ATTRIBUTE);
    const state = Array.isArray(saved) ? saved.slice(0, PIECES.length) : [];
    while (state.length < PIECES.length) state.push(0);
    const stage = quest.getStage(player);
    for (let index = 0; index < state.length; index++) {
      const value = Number(state[index]) | 0;
      if (stage < STAGE_REMOVE) state[index] = 0;
      else if (value === 0) state[index] = STATE_BROKEN;
      else if (value < 0 || value > STATE_BUILT) state[index] = STATE_BROKEN;
      else state[index] = value;
    }
    return state;
  }

  function saveState(player, state) {
    player.setAttribute(FURNITURE_ATTRIBUTE, state);
  }

  function sendFurniture(player) {
    const state = stateOf(player);
    saveState(player, state);
    const sender = player.getPacketSender();
    FURNITURE_VARBITS.forEach((varbit, index) => sender.sendVarbit(varbit, state[index]));
  }

  function syncFurniture({ player }) {
    sendFurniture(player);
  }

  function setPieceState(player, index, value) {
    const state = stateOf(player);
    state[index] = value;
    saveState(player, state);
    player.getPacketSender().sendVarbit(FURNITURE_VARBITS[index], value);
    return state;
  }

  function allRemoved(state) {
    return state.every((value) => value >= STATE_HOTSPOT);
  }

  function allBuilt(state) {
    return state.every((value) => value === STATE_BUILT);
  }

  function inYarlosHouse(location) {
    if (!location) return true;
    return location.x >= HOUSE_BOUNDS.minX && location.x <= HOUSE_BOUNDS.maxX
      && location.y >= HOUSE_BOUNDS.minY && location.y <= HOUSE_BOUNDS.maxY
      && location.z === HOUSE_BOUNDS.z;
  }

  function close(player) {
    player.getPacketSender().sendInterfaceRemoval();
  }

  function say(player, npcId, lines, then) {
    const chain = new DialogueChainBuilder();
    lines.forEach((line, index) => {
      if (typeof line === "object") chain.add(new PlayerDialogue(index, line.player));
      else chain.add(new NpcDialogue(index, npcId, line));
    });
    if (then) chain.add(new ActionDialogue(lines.length, { execute: then }));
    else chain.add(new EndDialogue(lines.length));
    player.getDialogueManager().startDialogues(chain);
  }

  /** A menu whose entries are [label, handler]; handlers are one-based, as DialogueManager passes them. */
  function choose(player, title, entries) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new OptionDialogue(0, {
        executeOption(option) {
          const entry = entries[Number(option) - 1];
          if (entry && entry[1]) entry[1]();
          else close(player);
        },
      }, ...entries.map((entry) => entry[0])).setTitle(title),
    ));
  }

  function nailBendChance(player, nailId) {
    const level = Number(player.getSkillManager?.().getCurrentLevel?.(Skill.CONSTRUCTION) ?? 1);
    const base = NAIL_BEND_BASE.get(nailId) ?? 0.4;
    return Math.max(0, base * Math.max(0.05, 1 - (Math.max(1, level) - 1) * 0.06));
  }

  /** Each nail is hammered in turn; a bent nail is consumed and does not count (RSProx 1723). */
  function consumeNails(player, amount) {
    const stock = inventory(player);
    let remaining = amount;
    let attempts = 0;
    while (remaining > 0 && attempts < amount * 10) {
      const id = NAIL_IDS.find((nail) => stock.getAmount(nail) > 0);
      if (id === undefined) return false;
      stock.delete(id, 1);
      attempts++;
      if (Math.random() < nailBendChance(player, id)) {
        player.sendMessage("You accidentally bend a nail.");
      } else {
        player.sendMessage("You use a nail.");
        remaining--;
      }
    }
    return remaining === 0;
  }

  function buildRequirements(piece) {
    const parts = [];
    const name = (amount, singular, plural = `${singular}s`) => `${amount} ${amount === 1 ? singular : plural}`;
    if (piece.planks) parts.push(name(piece.planks, "plank"));
    if (piece.waxwood) parts.push(name(piece.waxwood, "waxwood plank"));
    if (piece.cloth) parts.push(name(piece.cloth, "bolt of cloth", "bolts of cloth"));
    if (piece.nails) parts.push(name(piece.nails, "nail"));
    return parts.join(", ");
  }

  function canBuild(player, piece) {
    const stock = inventory(player);
    if (piece.planks && stock.getAmount(Items.PLANK) < piece.planks) return false;
    if (piece.waxwood && stock.getAmount(WAXWOOD_PLANK) < piece.waxwood) return false;
    if (piece.cloth && stock.getAmount(Items.BOLT_OF_CLOTH) < piece.cloth) return false;
    if (piece.nails && NAIL_IDS.reduce((sum, id) => sum + stock.getAmount(id), 0) < piece.nails) return false;
    return true;
  }

  function consumeMaterials(player, piece) {
    if (piece.nails && !consumeNails(player, piece.nails)) return false;
    const stock = inventory(player);
    if (piece.planks) stock.deleteNumber(Items.PLANK, piece.planks);
    if (piece.waxwood) stock.deleteNumber(WAXWOOD_PLANK, piece.waxwood);
    if (piece.cloth) stock.deleteNumber(Items.BOLT_OF_CLOTH, piece.cloth);
    return true;
  }

  function missingToolMessage(player) {
    const missing = [];
    if (!has(player, Items.HAMMER)) missing.push("a hammer");
    if (!hasSaw(player)) missing.push("a saw");
    if (missing.length === 0) return null;
    if (missing.length === 2) return "You need a hammer and a saw to build that.";
    return `You need ${missing[0]} to build that.`;
  }

  function giveTool(player, itemId) {
    const stock = inventory(player);
    if (stock.getFreeSlots() === 0) {
      player.sendMessage("You need a free inventory slot to take that.");
      return;
    }
    stock.adds(itemId, 1);
    player.sendMessage(itemId === Items.HAMMER ? "Yarlo gives you a hammer." : "Yarlo gives you a saw.");
  }

  // ==========================================================================
  // Furniture hotspots
  // ==========================================================================

  function handleObjectInteraction(event) {
    const index = PIECE_BY_LOC.get(event.objectId);
    if (index === undefined || !inYarlosHouse(event.location)) return false;
    const { player } = event;
    const stage = quest.getStage(player);
    const piece = PIECES[index];
    const state = stateOf(player)[index];

    if (event.option === "demolish" || event.option === "remove") {
      event.handled = true;
      if (stage < STAGE_REMOVE || state >= STATE_HOTSPOT) return true;
      setPieceState(player, index, STATE_HOTSPOT);
      player.performAnimation(new Animation(REMOVE_ANIMATION));
      player.getPacketSender().sendSound(REMOVE_SOUNDS[Math.floor(Math.random() * REMOVE_SOUNDS.length)], 0, 0);
      player.sendMessage(`You remove the broken ${piece.name}.`);
      if (allRemoved(stateOf(player)) && stage < STAGE_REMOVED) {
        quest.setStage(player, STAGE_REMOVED);
      }
      return true;
    }

    if (event.option === "build") {
      event.handled = true;
      if (stage < STAGE_BUILD) return player.sendMessage("I should talk to Old Man Yarlo about his plans first."), true;
      if (state !== STATE_HOTSPOT) return true;
      const toolMessage = missingToolMessage(player);
      if (toolMessage) return player.sendMessage(toolMessage), true;
      if (!canBuild(player, piece)) {
        const verbal = buildRequirements(piece);
        return player.sendMessage(`You need ${verbal}${piece.nails ? " of any type" : ""} to build that.`), true;
      }
      if (!consumeMaterials(player, piece)) {
        return player.sendMessage("You need more nails to finish that."), true;
      }
      setPieceState(player, index, STATE_BUILT);
      player.performAnimation(new Animation(BUILD_ANIMATION));
      player.getPacketSender().sendSound(BUILD_SOUND, 0, 0);
      player.getSkillManager().addExperiences(Skill.CONSTRUCTION, piece.xp);
      if (allBuilt(stateOf(player)) && stage < STAGE_BUILT) {
        quest.setStage(player, STAGE_BUILT);
      }
      return true;
    }

    return false;
  }

  // ==========================================================================
  // Waxwood crate and sawmill
  // ==========================================================================

  function handleCrateSearch(event) {
    if (event.objectId !== CRATE_OBJECT_ID || !inYarlosHouse(event.location)) return false;
    event.handled = true;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_BUILD) return player.sendMessage("I've no reason to search through their crates."), true;
    if (stateOf(player)[5] === STATE_BUILT) return player.sendMessage("The crate is empty."), true;
    const stock = inventory(player);
    if (stock.getAmount(WAXWOOD_LOG) >= 3 || stock.getAmount(WAXWOOD_PLANK) >= 3) {
      return player.sendMessage("You already have the waxwood you need."), true;
    }
    if (stock.getFreeSlots() < 3) {
      stock.full();
      return true;
    }
    stock.adds(WAXWOOD_LOG, 3);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ItemStatementDialogue(0, WAXWOOD_LOG,
        "The crate contains that water-repellant waxwood Old Man Yarlo described. You take some."),
    ));
    return true;
  }

  function hasWaxwoodReady(player) {
    const stage = quest.getStage(player);
    return stage >= STAGE_BUILD && stateOf(player)[5] !== STATE_BUILT
      && inventory(player).getAmount(WAXWOOD_LOG) >= 3;
  }

  function convertWaxwood(player, npcId) {
    const stock = inventory(player);
    if (stock.getAmount(WAXWOOD_LOG) < 3) {
      say(player, npcId, ["You'll need to bring me some more of that waxwood."]);
      return;
    }
    stock.deleteNumber(WAXWOOD_LOG, 3);
    stock.adds(WAXWOOD_PLANK, 3);
    say(player, npcId, ["That old geezer? Oh, alright. I won't charge for this, since it's for him."], () => {
      player.sendMessage("The sawmill operator gives you three waxwood planks.");
    });
  }

  function sawmillTalk(event) {
    if (event.npcId !== SAWMILL_OPERATOR_NPC_ID) return false;
    const option = String(event.definition?.getActions?.()?.[event.clickType - 1] ?? "").toLowerCase();
    if (option !== "talk-to" || !hasWaxwoodReady(event.player)) return false;
    event.handled = true;
    const { player, npcId } = event;
    say(player, npcId, [
      "Do you want me to make some planks for you? I can make planks from wood, oak, teak and mahogany logs. Or would you like to buy some other housing supplies?",
    ], () => {
      choose(player, "Select an Option", [
        ["I need some waxwood planks for Old Man Yarlo.", () => convertWaxwood(player, npcId)],
        ["Nothing, thanks.", () => say(player, npcId, ["Well come back when you want some. You'll struggle to find quality planks anywhere but here!"])],
      ]);
    });
    return true;
  }

  // ==========================================================================
  // Old Man Yarlo
  // ==========================================================================

  function remainingFurniture(player) {
    const state = stateOf(player);
    return PIECES.map((piece, index) => ({ piece, index, state: state[index] }))
      .filter(({ state: value }) => value < STATE_HOTSPOT);
  }

  function describeRemaining(player) {
    const left = remainingFurniture(player);
    const lines = left.slice(0, 3).map(({ piece }) => `- A broken ${piece.name}`);
    for (let index = 3; index < left.length; index += 3) {
      lines.push(left.slice(index, index + 3).map(({ piece }) => `- A broken ${piece.name}`).join("  "));
    }
    return lines;
  }

  function startRemoval(player) {
    quest.setStage(player, STAGE_REMOVE);
    sendFurniture(player);
  }

  function yarloIntro(player, npcId) {
    say(player, npcId, [
      "What brings you here, young man?",
      { player: "Marlo sent me to fix your furniture." },
      "My boy Marlo sent you? Oh yes, you've come to help with my furniture. It's in a terrible state. You'll want to start by removing all the tatty old furniture.",
      "There are two stools, two tables, a chair and a rotten carpet to replace. I need a better bed too. Let me know when you've removed all the old furniture.",
    ], () => startRemoval(player));
  }

  function yarloRemovalProgress(player, npcId) {
    const left = remainingFurniture(player);
    if (left.length === 0) return yarloAfterRemoval(player, npcId);
    if (left.length === PIECES.length) {
      return say(player, npcId, [
        "Ah, young man, how's the redecoration coming on?",
        { player: "What am I supposed to be doing again?" },
        "You'll want to start by removing all the tatty old furniture. There are two stools, two tables, a chair and a rotten carpet to remove, as well as the campbed. Let me know when you've done that.",
      ]);
    }
    say(player, npcId, [
      "Ah, young man, how's the redecoration coming on?",
      { player: "I've been removing the old furniture." },
      ...describeRemaining(player),
    ]);
  }

  function yarloLecture(player, npcId, listen) {
    if (listen) return playLectureCutscene(player, npcId);
    say(player, npcId, [
      "You young people are always rushing around trying to optimise the fun out of life. There are other ways to enjoy the world, you know! But I'm sure you know best.",
    ], () => furnitureBriefing(player, npcId));
  }

  /** The furniture list Yarlo gives after the Construction demonstration. */
  function furnitureBriefing(player, npcId) {
    say(player, npcId, [
      "Now, I was just getting round to telling you about the furniture I want you to build for me. For a start, I'd like two new stools, two new tables and a new chair.",
      "Some basic wooden planks and some nails should do, for those. I won't ask for anything more fancy - it'd only get stolen anyway, in this neighbourhood.",
      "I'll want a new carpet too. They can really change the atmosphere of a room, you know! You can buy cloth at the sawmill to make one.",
      "Now, for the bed, I've got something special in mind. This town's quite damp, and I don't want the moisture rising up the bed into my blankets. But I've found some wood that resists water.",
      "Those abandoned crates in the kitchen were here when I moved in, and I found they contain waxwood logs. Waxwood isn't much used in carpentry, but it resists water, so I want a bed made from that.",
      "You'll have to take three logs from the crate to the sawmill. The chap there will turn them into planks if you mention my name - I've known his family for years.",
      "I think that's everything - two stools, two tables, a chair, a bed and a carpet. Off you trot, young man. I'll be here if you have any questions.",
    ], () => {
      quest.setStage(player, STAGE_BUILD);
      sendFurniture(player);
    });
  }

  /**
   * Yarlo's Construction demonstration, from RSProx 3218 (rev 232): fade out, the builder
   * assembling a parlour, the slow camera pan and fourteen messagebox lines. The capture runs
   * this in the POH template; the server keeps the same beats in Yarlo's own house so the
   * surrounding map and collision are the ones the player already has.
   */
  function playLectureCutscene(player, npcId) {
    if (Scenes.get(player)) return;
    Scenes.fade(player, true);
    Scenes.hold(player);
    Scenes.controls(player, true, true);
    player.getPacketSender().sendSong(147);
    const scene = Scenes.open(player, "daddys-home-lecture", CUTSCENE_BOUNDS);
    scene.npcId = npcId;
    scene.finished = false;
    player.moveTo(CUTSCENE_HOME);
    const builder = Scenes.actor(scene, CUTSCENE_BUILDER_PLAIN, [3244, 3392, 0], [3241, 3395]);
    if (builder) builder.setPositionToFace(new Location(3241, 3395, 0));
    Scenes.later(scene, 2, () => {
      if (Scenes.get(player) !== scene) return;
      player.getPacketSender().sendJingle(20, 0).sendSong(454);
      Scenes.camera(player, [3241, 3401, 350], [3241, 3394, 50]);
      Scenes.fade(player, false);
      Scenes.loc(scene, { id: 6752, x: 3244, y: 3395, type: 10, face: 2 });
      Scenes.loc(scene, { id: 6768, x: 3244, y: 3394, type: 10, face: 0 });
      Scenes.loc(scene, { id: 6780, x: 3241, y: 3392, type: 10, face: 1 });
    });
    CUTSCENE_LINES.forEach((line, index) => {
      Scenes.later(scene, 8 + index * LECTURE_TICKS, () => {
        if (Scenes.get(player) !== scene) return;
        StatementDialogue.send(player, line, false);
      });
    });
    Scenes.later(scene, 8 + CUTSCENE_LINES.length * LECTURE_TICKS + 20, () => finishLecture(player, scene));
  }

  function finishLecture(player, scene) {
    if (!scene || scene.finished) return;
    scene.finished = true;
    Scenes.fade(player, true);
    Scenes.later(scene, 2, () => {
      Scenes.end(player, false);
      player.moveTo(CUTSCENE_HOME);
      Scenes.fade(player, false);
      Scenes.controls(player, false);
      player.getPacketSender().sendSong(454);
      quest.setStage(player, STAGE_BUILD);
      sendFurniture(player);
      furnitureBriefing(player, scene.npcId);
    });
  }

  /** A logout or walk-out during the demonstration still unlocks the building stage. */
  function onCutsceneEnd(player, scene, logout) {
    if (scene?.name !== "daddys-home-lecture" || scene.finished) return;
    if (!logout) player.moveTo(CUTSCENE_HOME);
    quest.setStage(player, STAGE_BUILD);
    sendFurniture(player);
    if (!logout) player.sendMessage("You can ask Old Man Yarlo about Construction again.");
  }

  function yarloAfterRemoval(player, npcId) {
    say(player, npcId, [
      "Ah, young man, how's the redecoration coming on?",
      { player: "I've finished removing all the old furniture." },
      "Jolly good, young man. Now, we'll need to have a talk about what you'll build for me to replace it.",
    ], () => {
      choose(player, "Select an Option", [
        ["Listen to Yarlo.", () => yarloLecture(player, npcId, true)],
        ["Skip Yarlo's lecture. He'll offer it later if you like.", () => yarloLecture(player, npcId, false)],
      ]);
    });
  }

  function offerTools(player, npcId) {
    const missing = [];
    if (!has(player, Items.HAMMER)) missing.push(Items.HAMMER);
    if (!hasSaw(player)) missing.push(Items.SAW);
    if (missing.length === 0) {
      return say(player, npcId, ["You've got a hammer and a saw. I wouldn't be able to offer you anything else."]);
    }
    const offerNext = () => {
      const itemId = missing.shift();
      if (itemId === undefined) return close(player);
      const name = itemId === Items.HAMMER ? "hammer" : "saw";
      say(player, npcId, [`Would you like a ${name}? I can spare one.`], () => {
        choose(player, "Select an Option", [
          ["Yes please.", () => { giveTool(player, itemId); offerNext(); }],
          ["No thanks.", () => offerNext()],
        ]);
      });
    };
    offerNext();
  }

  function yarloBuildingHelp(player, npcId) {
    choose(player, "Select an Option", [
      ["How do I build furniture?", () => say(player, npcId, [
        "Ah. Look in the place where the new furniture will go...",
        "A talented builder will see a vision there of the furniture they could build. Interact with that, and you should find you can build furniture.",
        "You'll need a hammer and saw. I can supply those if you need them.",
      ])],
      ["Where do I get planks, nails and cloth?", () => say(player, npcId, [
        "From the sawmill! They sell nails and cloth at reasonable prices. You'd have to take your own logs there, though, to get planks, but there are plenty of trees to chop nearby.",
        "Watch out, though - nails can bend, if you're not careful. You should probably get some spares, just in case.",
      ])],
      ["I need some tools.", () => offerTools(player, npcId)],
      ["Tell me about the waxwood for the bed.", () => say(player, npcId, [
        "This town's quite damp, and I don't want the moisture rising up the bed into my blankets. But I've found some wood that resists water.",
        "Those abandoned crates in the kitchen were here when I moved in, and I found they contain waxwood logs. Waxwood isn't much used in carpentry, but it resists water, so I want a bed made from that.",
        "You'll have to take three logs from the crate to the sawmill. The chap there will turn them into planks if you mention my name.",
      ])],
      ["I'll get on with it.", () => close(player)],
    ]);
  }

  function yarloBuilding(player, npcId) {
    if (allBuilt(stateOf(player))) {
      if (quest.getStage(player) < STAGE_REWARD) quest.setStage(player, STAGE_REWARD);
      return say(player, npcId, [
        "That's everything! Thank you so much, young man. Trot off back to my boy Marlo, now. He'll have something for you.",
        { player: "Okay, I'll head back to Marlo." },
      ]);
    }
    say(player, npcId, ["Do you need some help with the building work, young man?"], () => {
      yarloBuildingHelp(player, npcId);
    });
  }

  function yarloAwaitingReward(player, npcId) {
    say(player, npcId, [
      "Hello again, young man. Has my boy Marlo rewarded you yet?",
      { player: "Not yet. I'll get round to visiting him soon." },
      "Yes, you should do that. You've earned it.",
    ]);
  }

  function yarloAfterQuest(player, npcId) {
    say(player, npcId, [
      "Hello again, young man. You really did wonders for my little home. I feel so much happier living here now.",
    ], () => {
      choose(player, "Select an Option", [
        ["That's good to hear. Goodbye now.", () => close(player)],
        ["Tell me about more things I can do with Construction.", () => {
          say(player, npcId, [
            "As a builder, in your own house, you can create your own rooms full of furniture.",
            "All this could be yours, if you train Construction!",
          ]);
        }],
      ]);
    });
  }

  function yarloTalk(event) {
    if (event.npcId !== OLD_MAN_YARLO_NPC_ID) return false;
    const option = String(event.definition?.getActions?.()?.[event.clickType - 1] ?? "").toLowerCase();
    if (option !== "talk-to") return false;
    const { player } = event;
    const stage = quest.getStage(player);

    if (stage === 0) return false;
    event.handled = true;
    if (stage === STAGE_STARTED) return yarloIntro(player, event.npcId), true;
    if (stage < STAGE_BUILD) return yarloRemovalProgress(player, event.npcId), true;
    if (stage < STAGE_REWARD) return yarloBuilding(player, event.npcId), true;
    if (stage < STAGE_COMPLETE) return yarloAwaitingReward(player, event.npcId), true;
    return yarloAfterQuest(player, event.npcId), true;
  }

  // ==========================================================================
  // Marlo
  // ==========================================================================

  function marloCompanyInfo(player, npcId, back) {
    say(player, npcId, [
      "Oh, we redecorate people's houses, fixing things and building new furniture. Mending cabinets, building new chairs and tables - things like that.",
      "When a client hires us to redecorate their house, we send a builder round to do the job, and we ensure the builder's paid for their work.",
      "We can't hire you for that kind of work now, but perhaps you could do me a little favour instead, if you're willing. I can pay!",
    ], back);
  }

  function marloMainMenu(player, npcId) {
    choose(player, "Select an Option", [
      ["What kind of favour do you want me to do?", () => marloFavour(player, npcId)],
      ["What does this Mahogany Homes company do?", () => marloCompanyInfo(player, npcId, () => marloMainMenu(player, npcId))],
      ["Maybe another time.", () => close(player)],
    ]);
  }

  function marloFavour(player, npcId) {
    say(player, npcId, [
      "Well, you see, it's about my dad. His house is really decrepit. I need someone to rip out the broken furniture and build him some better stuff. I'll pay you if you do it.",
    ], () => {
      choose(player, "Select an Option", [
        ["Aren't you in a construction company yourself though?", () => marloFavourConcern(player, npcId, "company")],
        ["Why has he got such a bad house?", () => marloFavourConcern(player, npcId, "house")],
        ["Tell me more about the job.", () => marloJobDetails(player, npcId)],
        ["I'd rather not.", () => say(player, npcId, ["Okay, suit yourself."])],
      ]);
    });
  }

  function marloFavourConcern(player, npcId, concern) {
    const lines = concern === "company"
      ? [
        "See, my dad just - um - found the house. No-one was using it, so he just settled in. It's all perfectly harmless, and he's a sick old man anyway, so...",
        "Basically, he's not really meant to be there. And we'd prefer that the landlord not find out, so we're keeping this job off the record. I'll pay you myself.",
      ]
      : [
        "Some kind of economic downturn wiped out his pension plans. It happens more often than you'd think. But I'd rather not talk about it. Can you help him, though?",
      ];
    say(player, npcId, lines, () => marloFavour(player, npcId));
  }

  function marloJobDetails(player, npcId) {
    say(player, npcId, [
      "Nothing too hard. You'll have to rip out the broken furniture, then build replacements. Dad will talk you through it - he's a retired carpenter himself. He loves talking about construction.",
    ], () => {
      choose(player, "Select an Option", [
        ["Aren't you in a construction company yourself though?", () => marloFavourConcern(player, npcId, "company")],
        ["Why has he got such a bad house?", () => marloFavourConcern(player, npcId, "house")],
        ["Tell me where he lives, and I'll do the job.", () => marloAccept(player, npcId)],
        ["I'd rather not.", () => say(player, npcId, ["Okay, suit yourself."])],
      ]);
    });
  }

  function marloAccept(player, npcId) {
    say(player, npcId, [
      "Fabulous! Dad lives in the south-east of Varrock, west of Aubury's Rune Shop. His name's Yarlo. Old Man Yarlo, they call him.",
    ], () => {
      if (quest.getStage(player) < STAGE_STARTED) {
        quest.setStage(player, STAGE_STARTED);
        player.sendMessage(START_MESSAGE);
      }
    });
  }

  function marloProgress(player, npcId) {
    say(player, npcId, ["How are you getting on with helping my dad?"], () => {
      choose(player, "Select an Option", [
        ["Where did you say he lived?", () => say(player, npcId, [
          "Dad lives in the south-east of Varrock, west of Aubury's Rune Shop. His name's Yarlo. Old Man Yarlo, they call him. He's sure to be at home, so keep looking around.",
        ])],
        ["Maybe another time.", () => close(player)],
      ]);
    });
  }

  function marloReward(player, npcId, ownsHouse) {
    const lines = ownsHouse === false
      ? [
        "Now, I can't spare very much money, but I've persuaded the Estate Agent to let me give you a house of your own. You'll be able to decorate it, like you did for my dad's house.",
        "Normally a new house costs 1,000 coins, so that's a bit of a saving. Also, I've got a crate of supplies to help you decorate it.",
        "I've included some handy spell tablets that'll take you to your house, to cut down on the walking a bit, as well as one for visiting my boss in Falador. Let me tell you some tricks of the trade too...",
      ]
      : [
        "Now, I can't spare very much money, but I've got some supplies in this crate that might help with your own Construction work.",
        "I've included some handy spell tablets that'll take you to your house, to cut down on the walking a bit, as well as one for visiting my boss in Falador. Now, let me tell you some tricks of the trade too...",
      ];
    say(player, npcId, lines, () => quest.complete(player));
  }

  function onReward(player) {
    player.getSkillManager().addExperiences(Skill.CONSTRUCTION, 400);
    const grant = { player, granted: false };
    api.emitCustomEvent("construction:grant-house", grant);
    if (!grant.granted) {
      // Already owned a house (or Construction did not answer): the Wiki's 1,000 coins.
      player.getInventory().forceAdd(player, new Item(Items.COINS, 1000));
    }
  }

  function marloRewardMenu(player, npcId) {
    const owns = { player, owns: undefined };
    api.emitCustomEvent("construction:owns-house", owns);
    say(player, npcId, [
      { player: "I've finished building the new furniture for your dad." },
      "That's wonderful news! Dad's going to be so much happier. I'm very grateful! Now, I promised to pay you for your work...",
    ], () => {
      choose(player, "Select an Option", [
        ["Yeah, what have you got for me?", () => marloReward(player, npcId, owns.owns)],
        ["Can I do some other kind of building work for you?", () => say(player, npcId, [
          "I'm so sorry, but you're not qualified to do contracts for Mahogany Homes yet. Just keep helping my dad, for now, and perhaps I can sort that out for you.",
        ])],
        ["Maybe another time.", () => close(player)],
      ]);
    });
  }

  function marloTalk(event) {
    if (!MARLO_NPC_IDS.has(event.npcId)) return false;
    const option = String(event.definition?.getActions?.()?.[event.clickType - 1] ?? "").toLowerCase();
    if (option !== "talk-to") return false;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      // Wiki: Marlo replaces a lost crate, but not one that has already been opened.
      if (ownsCrate(player) || Number(player.getAttribute(CRATE_OPENED_ATTRIBUTE)) === 1) return false;
      event.handled = true;
      say(player, event.npcId, [
        "I haven't forgotten that I promised to pay you for your help. Did you lose that crate I gave you?",
        { player: "Yes, I'm afraid so." },
        "Here, take another one. Try not to lose it this time!",
      ], () => {
        if (player.getInventory().getFreeSlots() === 0) {
          player.sendMessage("You need a free inventory slot to take the crate.");
          return;
        }
        player.getInventory().adds(MARLOS_CRATE, 1);
      });
      return true;
    }
    event.handled = true;

    if (stage === 0) {
      say(player, event.npcId, [
        "Hello - it's lovely to see a Mahogany Homes contractor on their rounds! Now, can I help you with something? Or might you be able to do me a little favour?",
      ], () => marloMainMenu(player, event.npcId));
      return true;
    }
    if (stage < STAGE_REWARD) return marloProgress(player, event.npcId), true;
    return marloRewardMenu(player, event.npcId), true;
  }

  // ==========================================================================
  // Reward crate
  // ==========================================================================

  function crateSlotsNeeded(player) {
    const stock = inventory(player);
    let needed = 0;
    for (const [itemId, amount] of CRATE_CONTENTS) {
      if (ItemDefinition.forId(itemId).isStackable()) needed += stock.getAmount(itemId) > 0 ? 0 : 1;
      else needed += amount;
    }
    return needed;
  }

  function openCrate(event) {
    if (event.itemId !== MARLOS_CRATE) return false;
    const { player, item, slot } = event;
    if (inventory(player).get(slot) !== item) return false;
    // A full-bag completion or Marlo's replacement can leave more than one physical crate in
    // play. Only the first one ever pays; later copies are consumed without contents.
    if (Number(player.getAttribute(CRATE_OPENED_ATTRIBUTE)) === 1) {
      if (!inventory(player).deleteAtSlot(slot, 1)) return true;
      player.sendMessage("You have already opened Marlo's crate.");
      return true;
    }
    // Opening the crate frees the slot it occupies.
    const needed = Math.max(0, crateSlotsNeeded(player) - 1);
    if (inventory(player).getFreeSlots() < needed) {
      return player.sendMessage(`You need ${needed} free inventory slots to open Marlo's crate.`), true;
    }
    if (!inventory(player).deleteAtSlot(slot, 1)) return true;
    player.setAttribute(CRATE_OPENED_ATTRIBUTE, 1);
    for (const [itemId, amount] of CRATE_CONTENTS) inventory(player).adds(itemId, amount);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ItemStatementDialogue(0, MARLOS_CRATE,
        "You open Marlo's crate and take out the Construction supplies inside."),
    ));
    return true;
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped Marlo's father renovate his house.</str>",
        "<str>Marlo rewarded me with a crate of Construction supplies.</str>",
        "",
        "<col=ff0000>MINIQUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_REWARD) {
      return ["Old Man Yarlo is pleased with his new furniture.", "I should return to <col=800000>Marlo</col> in Varrock for my reward."];
    }
    if (stage >= STAGE_BUILT) {
      return ["I've rebuilt all the furniture in <col=800000>Old Man Yarlo's</col> house.", "I should talk to him again."];
    }
    if (stage >= STAGE_BUILD) {
      return [
        "I need to build two stools, two tables, a chair, a carpet and a bed.",
        "The bed needs <col=800000>waxwood planks</col>; the crate in the kitchen has the logs.",
      ];
    }
    if (stage >= STAGE_REMOVED) {
      return ["I've removed all the old furniture.", "I should talk to <col=800000>Old Man Yarlo</col> again."];
    }
    if (stage >= STAGE_REMOVE) {
      return ["I need to remove the broken furniture in Yarlo's house:", "two stools, two tables, a chair, the campbed and the rotten carpet."];
    }
    if (stage >= STAGE_STARTED) {
      return ["Marlo asked me to help his father, <col=800000>Old Man Yarlo</col>,", "in his house in south-east Varrock, west of Aubury's Rune Shop."];
    }
    return [
      "I can start this miniquest by talking to <col=800000>Marlo</col> in the",
      "<col=800000>Varrock Estate Agent's</col> office.",
    ];
  }

  api.persistAttribute(FURNITURE_ATTRIBUTE, [0, 0, 0, 0, 0, 0, 0]);
  api.persistAttribute(CRATE_OPENED_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "daddys_home",
    name: "Daddy's Home",
    varpId: VARP_DADDYS_HOME,
    varbitId: VARBIT_STATUS,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 0,
    rewardItemId: MARLOS_CRATE,
    scrollItemId: MARLOS_CRATE,
    otherRewards: [
      "400 Construction XP",
      "Marlo's crate (Construction supplies)",
      "A house in Rimmington, or 1,000 coins",
    ],
    onReward,
    buildJournal,
  });

  api.onBeforeNpcInteraction(marloTalk);
  api.onBeforeNpcInteraction(yarloTalk);
  api.onBeforeNpcInteraction(sawmillTalk);
  api.onObjectInteraction(handleObjectInteraction);
  api.onObjectInteraction(handleCrateSearch);
  api.onItemAction("Marlo's crate", { Open: openCrate });
  api.onPlayerLogin(syncFurniture);
};
