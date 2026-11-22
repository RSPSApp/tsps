/**
 * Daddy's Home (members quest from 3 November 2026, 1 Quest Point; a miniquest before).
 *
 * Sources, in order: the rsprox capture DaddysHome (rev 242.1, the whole quest as a quest: start, removal, the lecture,
 * the briefing, building, the sawmill, the reward, the crate and the lecture again after it), the older recordings in
 * the rsprox.net index for what it doesn't play (rev 226-241, when it was a miniquest: 1702, 1723, local 1000152,
 * 1000176, 1001562; 3218 and 3220 after it), then the OSRS Wiki. The Wiki's transcript predates the quest conversion
 * (it says so itself); by the user's call the capture wins where they differ, and docs/daddys-home.md lists each place.
 *
 * daddyshome_status (varbit 10570), as captured:
 *   0  not started                      1  Marlo's "Start the Daddy's Home quest?" Yes.
 *   2  Yarlo asks for the removal       3  "I've finished removing all the old furniture." (the line shows)
 *   4  "Now, I was just getting round to telling you about the furniture..." (after the lecture, or the skip)
 *   5  "You'll have to take three logs from the crate to the sawmill..."   6  the sawmill makes the waxwood planks
 *   10 Yarlo, with everything built     11 Marlo hears it      13 complete (the cache's threshold)  14 crate opened
 * 7-9 are never sent; a save from before this capture can hold 9 (everything built) and plays on as 6.
 *
 * The seven furniture varbits share varp 393 with other content, so they are read and written one by one:
 *   10563 stool 1, 10564 stool 2, 10565 chair, 10566 table 1, 10567 table 2, 10568 bed, 10569 carpet.
 * Loc transforms: 0 broken (no option), 1 broken (Demolish/Remove), 2 hotspot (Build), 3 built.
 * `daddys-home:furniture` keeps them, because varp 393 is rebuilt at login.
 */
const Saws = require("../../items/Saws");
const createLecture = require("../daddyshome/Lecture.DaddysHome");

module.exports = function registerDaddysHomeQuest(api) {
  const {
    ActionDialogue,
    Animation,
    CacheDefinitions,
    ChatType,
    CountdownTask,
    DialogueChainBuilder,
    DoubleItemStatementDialogue,
    EndDialogue,
    GraphicStatementDialogue,
    Item,
    ItemDefinition,
    ItemIdentifiers: Items,
    ItemStatementDialogue,
    NpcDialogue,
    NpcIdentifiers,
    OptionDialogue,
    PlayerDialogue,
    Skill,
    StatementDialogue,
    Task,
    TaskManager,
  } = api.core;
  const { registerQuest, refreshQuestList, questStartMessage, QUEST_POINTS_ATTRIBUTE, QUEST_POINTS_VARP } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");
  // Set once a player who finished the miniquest before rev 242 has been given its new Quest Point.
  const QP_CREDITED_ATTRIBUTE = "daddys-home:quest-point-credited";

  const MARLO_NPC_IDS = new Set([
    NpcIdentifiers.MARLO, // 10408, con_contractor_varrock_1op: before joining Mahogany Homes
    NpcIdentifiers.MARLO_2, // 10409, con_contractor_varrock_2op: after
  ]);
  const OLD_MAN_YARLO_NPC_ID = NpcIdentifiers.OLD_MAN_YARLO; // 10425, daddyshome_daddy
  const SAWMILL_OPERATOR_NPC_ID = NpcIdentifiers.SAWMILL_OPERATOR; // 3101, poh_sawmill_opp (Varrock Lumberyard)

  const obj = (name) => CacheDefinitions.getObjId(name);
  const WAXWOOD_LOG = obj("daddyshome_waxwood_logs"); // 24938
  const WAXWOOD_PLANK = obj("daddyshome_waxwood_plank"); // 24939
  const MARLOS_CRATE = obj("daddyshome_reward"); // 24940

  const VARP_DADDYS_HOME = 393;
  const VARBIT_STATUS = 10570;
  const FURNITURE_VARBITS = [10563, 10564, 10565, 10566, 10567, 10568, 10569];
  const FURNITURE_ATTRIBUTE = "daddys-home:furniture";
  // Before rev 242's status 14, the opened crate was this flag; a save that has it moves to 14 at login.
  const CRATE_OPENED_ATTRIBUTE = "daddys-home:crate-opened";
  const LECTURE_EXIT_ATTRIBUTE = "daddys-home:lecture-exit";

  const STAGE_STARTED = 1;
  const STAGE_REMOVE = 2;
  const STAGE_REMOVED = 3;
  const STAGE_BRIEFING = 4;
  const STAGE_BUILD = 5;
  const STAGE_PLANKS = 6;
  const STAGE_REWARD = 10;
  const STAGE_TOLD_MARLO = 11;
  const STAGE_COMPLETE = 13;
  const STAGE_CRATE_OPENED = 14;

  const STATE_BROKEN = 1;
  const STATE_HOTSPOT = 2;
  const STATE_BUILT = 3;

  const BUILD_ANIMATION = 3676; // human_poh_build, every piece (the carpet too, capture tick 1835)
  const REMOVE_ANIMATION = 3685; // human_throw_away
  // Capture ticks 1531-1571: the throw-away sequence's delay 10, demolish_1 or demolish_2 at delay 20.
  const REMOVE_ANIMATION_DELAY = 10;
  const REMOVE_SOUNDS = [2097, 2098];
  const REMOVE_SOUND_DELAY = 20;
  const BUILD_SOUND = 938; // poh_build_wood
  const FOUND_GEM_SOUND = 2655; // the crate opening (capture tick 2181)
  const SAWMILL_MAP_GRAPHIC = 1698; // graphicbox 633's sprite beside "Look on your World Map to find the sawmill."
  const SAWMILL_MAP_SIZE = 32;

  // poh_furniture_creation (458), one entry per hotspot: script 7988 (index, obj, level, "name|materials", can build),
  // then 1406 (count, flatpack off), the list's pause events and chatdefault_restoreinput (2158) once it closes.
  const BUILD_INTERFACE = CacheDefinitions.getInterfaceId("poh_furniture_creation");
  const BUILD_LIST_UID = (BUILD_INTERFACE << 16) | 2;
  const BUILD_ENTRY_SCRIPT = 7988;
  const BUILD_LIST_SCRIPT = 1406;
  const RESTORE_CHAT_INPUT_SCRIPT = 2158;
  const MISSING_COLOUR = "ef1020";

  /**
   * The seven pieces, in varbit order. `menu` is the build entry's name and obj (capture ticks 1833-2075); `xp` is the
   * capture's drops (stool 29, table 86, chair 57; the Wiki's infoboxes say 30, 87 and 58).
   */
  const PIECES = [
    { key: "stool-1", removalDescription: "A broken stool in the kitchen", planks: 1, nails: 2, xp: 29, menu: ["Wooden stool", "beta_elder_wand"] },
    { key: "stool-2", removalDescription: "A broken stool in the bedroom", planks: 1, nails: 2, xp: 29, menu: ["Wooden stool", "beta_elder_wand"] },
    { key: "chair", removalDescription: "A broken chair in the bedroom", planks: 2, nails: 2, xp: 57, menu: ["Wooden chair", "cert_beta_elder_wand"] },
    { key: "table-1", removalDescription: "A broken table in the kitchen", planks: 3, nails: 4, xp: 86, menu: ["Wooden table", "beta_elder_maul"] },
    { key: "table-2", removalDescription: "A broken table in the bedroom", planks: 3, nails: 4, xp: 86, menu: ["Wooden table", "beta_elder_maul"] },
    { key: "bed", removalDescription: "The old campbed", waxwood: 3, cloth: 2, xp: 207, menu: ["Waxwood bed", "cert_beta_elder_maul"] },
    { key: "carpet", removalDescription: "The rotten carpet", cloth: 3, xp: 45, menu: ["Carpet", "placeholder_beta_elder_maul"] },
  ];
  const BED = 5;

  // Base loc id -> piece index. The carpet is twelve placements sharing one transform.
  const PIECE_BY_LOC = new Map([
    [40300, 0], [40301, 1], [40302, 2], [40223, 3], [40224, 4], [40303, 5], [40304, 6], [40305, 6], [40306, 6],
  ]);

  // Yarlo's house: south-east Varrock, west of Aubury's Rune Shop (Quest Helper tiles).
  const HOUSE_BOUNDS = { minX: 3235, maxX: 3247, minY: 3390, maxY: 3400, z: 0 };
  const CRATE_OBJECT_ID = 40214;

  // Capture tick 2181: the crate's contents, the bulk ones noted.
  const CRATE_CONTENTS = [
    [Items.PLANK_2, 25],
    [Items.MITHRIL_NAILS, 50],
    [Items.STEEL_BAR_2, 5],
    [Items.OAK_PLANK_2, 10],
    [Items.BOLT_OF_CLOTH_2, 8],
    [Items.TELEPORT_TO_HOUSE, 5],
    [Items.FALADOR_TELEPORT, 1],
  ];

  const NAIL_BEND_BASE = new Map([
    [Items.BRONZE_NAILS, 0.50], [Items.IRON_NAILS, 0.45], [Items.STEEL_NAILS, 0.40], [Items.BLACK_NAILS, 0.35],
    [Items.MITHRIL_NAILS, 0.30], [Items.ADAMANTITE_NAILS, 0.25], [Items.RUNE_NAILS, 0.20], [Items.DRAGON_NAILS, 0.15],
  ]);
  // Best nails first, as Construction uses them.
  const NAIL_IDS = [
    Items.DRAGON_NAILS, Items.RUNE_NAILS, Items.ADAMANTITE_NAILS, Items.MITHRIL_NAILS,
    Items.BLACK_NAILS, Items.STEEL_NAILS, Items.IRON_NAILS, Items.BRONZE_NAILS,
  ];

  let quest;
  const Scenes = createQuestScenes(api, { onEnd: onSceneEnd, recoveryAttribute: LECTURE_EXIT_ATTRIBUTE });
  const Lecture = createLecture(api, Scenes);
  const pendingBuilds = new WeakMap();
  const pendingRemovals = new WeakSet();
  const houseOnScroll = new WeakMap();

  const inventory = (player) => player.getInventory();
  const has = (player, itemId) => inventory(player).getAmount(itemId) > 0;
  const hasSaw = (player) => Saws.holdsSaw(api.core, player);
  const stage = (player) => quest.getStage(player);
  const young = (player) => (player.getAppearance?.()?.isMale?.() === false ? "young lady" : "young man");
  const startMessage = (player) => questStartMessage(player, "Daddy's Home");

  function ownsCrate(player) {
    if (has(player, MARLOS_CRATE)) return true;
    const banks = player.getBanks?.() ?? (player.getBank ? [player.getBank()] : []);
    return banks.some((bank) => Number(bank?.getAmount?.(MARLOS_CRATE) ?? 0) > 0);
  }

  /** Construction's answer: { owns, location } (the house's town), or owns undefined without Construction. */
  function houseOf(player) {
    const request = { player, owns: undefined, location: null };
    api.emitCustomEvent("construction:owns-house", request);
    return request;
  }

  /** Mahogany Homes' answer: whether Amy has taken the player on (Marlo's greeting and menus follow it). */
  function joined(player) {
    const request = { player, joined: false };
    api.emitCustomEvent("mahogany-homes:joined", request);
    return request.joined === true;
  }

  function currentContract(player, npcId) {
    api.emitCustomEvent("mahogany-homes:contract", { player, npcId, handled: false });
  }

  // ==========================================================================
  // Furniture state
  // ==========================================================================

  function stateOf(player) {
    const saved = player.getAttribute(FURNITURE_ATTRIBUTE);
    const state = Array.isArray(saved) ? saved.slice(0, PIECES.length) : [];
    while (state.length < PIECES.length) state.push(0);
    const current = stage(player);
    for (let index = 0; index < state.length; index++) {
      const value = Number(state[index]) | 0;
      if (current < STAGE_REMOVE) state[index] = 0;
      else if (value <= 0 || value > STATE_BUILT) state[index] = STATE_BROKEN;
      else state[index] = value;
    }
    return state;
  }

  function sendFurniture(player) {
    const state = stateOf(player);
    player.setAttribute(FURNITURE_ATTRIBUTE, state);
    const sender = player.getPacketSender();
    FURNITURE_VARBITS.forEach((varbit, index) => sender.sendVarbit(varbit, state[index]));
  }

  function setPieceState(player, index, value) {
    const state = stateOf(player);
    state[index] = value;
    player.setAttribute(FURNITURE_ATTRIBUTE, state);
    player.getPacketSender().sendVarbit(FURNITURE_VARBITS[index], value);
    return state;
  }

  const allRemoved = (state) => state.every((value) => value >= STATE_HOTSPOT);
  const allBuilt = (state) => state.every((value) => value === STATE_BUILT);

  function inYarlosHouse(location) {
    if (!location) return true;
    return location.x >= HOUSE_BOUNDS.minX && location.x <= HOUSE_BOUNDS.maxX
      && location.y >= HOUSE_BOUNDS.minY && location.y <= HOUSE_BOUNDS.maxY && location.z === HOUSE_BOUNDS.z;
  }

  /** Login: the furniture bits, a pre-242 opened crate as status 14, and a pre-242 completion's Quest Point. */
  function onLogin({ player }) {
    if (stage(player) === STAGE_COMPLETE && Number(player.getAttribute(CRATE_OPENED_ATTRIBUTE)) === 1) {
      quest.setStage(player, STAGE_CRATE_OPENED);
    }
    sendFurniture(player);
    creditQuestPoint(player);
  }

  /**
   * Rev 242 made the miniquest a 1 QP quest: a save that finished it earlier gets the point once. The flag is set on the
   * first login either way, so a later completion (which awards the point itself) is never credited twice.
   */
  function creditQuestPoint(player) {
    if (player.getAttribute(QP_CREDITED_ATTRIBUTE) === true) return;
    player.setAttribute(QP_CREDITED_ATTRIBUTE, true);
    if (!quest?.isComplete(player)) return;
    const points = (Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0) + 1;
    player.setAttribute(QUEST_POINTS_ATTRIBUTE, points);
    player.getPacketSender().sendConfig(QUEST_POINTS_VARP, points);
    refreshQuestList(player);
  }

  // ==========================================================================
  // Dialogue helpers
  // ==========================================================================

  /**
   * A conversation. Each step is an NPC line (a string), `{ player }`, `{ item, text }` / `{ items: [a, b], text }` (an
   * item box), `{ graphic, text }`, `{ statement }`, or `{ run }`: an action on the tick the next line shows (a stage
   * set with its line, as captured). `then` runs once the player continues past the last line.
   */
  function talk(player, npcId, steps, then) {
    const chain = new DialogueChainBuilder();
    const manager = player.getDialogueManager();
    steps.forEach((step, index) => {
      if (typeof step === "string") chain.add(new NpcDialogue(index, npcId, step));
      else if (step.player) chain.add(new PlayerDialogue(index, step.player));
      else if (step.items) chain.add(new DoubleItemStatementDialogue(index, step.items[0], step.items[1], step.text));
      else if (step.item !== undefined) chain.add(new ItemStatementDialogue(index, step.item, step.text));
      else if (step.graphic !== undefined) {
        chain.add(new GraphicStatementDialogue(index, step.graphic, step.text, SAWMILL_MAP_SIZE, SAWMILL_MAP_SIZE));
      } else if (step.statement) chain.add(new StatementDialogue(index, step.statement));
      else if (step.run) chain.add(new ActionDialogue(index, { execute: () => { step.run(); manager.advance(); } }));
    });
    if (then) {
      // Past the last line the chatbox closes unless `then` opened something (a menu, the next conversation): a
      // completion's scroll waits for a closed chatbox.
      const last = new ActionDialogue(steps.length, { execute: () => {
        then();
        if (manager.getCurrent?.() !== last) return;
        manager.reset();
        player.getPacketSender().sendInterfaceRemoval();
      } });
      chain.add(last);
    } else chain.add(new EndDialogue(steps.length));
    manager.startDialogues(chain);
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

  /** A menu that comes back after each answer without the option just asked (capture ticks 1779-1817, 1422-1430). */
  function loopMenu(player, entries, last = -1, title = "Select an option") {
    const shown = entries.map((entry, index) => [entry, index]).filter(([, index]) => index !== last);
    choose(player, title, shown.map(([[label, answer], index]) => [label, () => answer(() => loopMenu(player, entries, index, title))]));
  }

  function close(player) {
    player.getPacketSender().sendInterfaceRemoval();
  }

  // ==========================================================================
  // Furniture: removal
  // ==========================================================================

  function handleObjectInteraction(event) {
    const index = PIECE_BY_LOC.get(event.objectId);
    if (index === undefined || !inYarlosHouse(event.location)) return false;
    const option = String(event.option ?? "").toLowerCase();
    if (option === "demolish" || option === "remove") return removePiece(event, index), true;
    if (option === "build") return buildPiece(event, index), true;
    return false;
  }

  /**
   * Capture ticks 1529-1572: on arrival the throw-away animation and a demolish sound, the hotspot the tick after; no
   * chat message, and the stage waits for Yarlo (status 3 comes with the player's line to him).
   */
  function removePiece(event, index) {
    event.handled = true;
    const { player } = event;
    if (stage(player) < STAGE_REMOVE || stateOf(player)[index] !== STATE_BROKEN || pendingRemovals.has(player)) return;
    const animation = new Animation(REMOVE_ANIMATION);
    animation.delay = REMOVE_ANIMATION_DELAY;
    player.performAnimation(animation);
    player.getPacketSender().sendSound(REMOVE_SOUNDS[Math.floor(Math.random() * REMOVE_SOUNDS.length)], 0, REMOVE_SOUND_DELAY);
    pendingRemovals.add(player);
    TaskManager.submit(new CountdownTask({}, 1, () => {
      pendingRemovals.delete(player);
      if (!player.isRegistered?.() || stateOf(player)[index] !== STATE_BROKEN) return;
      setPieceState(player, index, STATE_HOTSPOT);
    }));
  }

  // ==========================================================================
  // Furniture: building
  // ==========================================================================

  const itemName = (itemId) => ItemDefinition.forId(itemId).getName();

  /** Each material as [label, amount, missing], in the build menu's order. */
  function materials(player, piece, nails = piece.nails) {
    const stock = inventory(player);
    const list = [];
    if (piece.planks) list.push([itemName(Items.PLANK), piece.planks, stock.getAmount(Items.PLANK) < piece.planks]);
    if (piece.waxwood) list.push([itemName(WAXWOOD_PLANK), piece.waxwood, stock.getAmount(WAXWOOD_PLANK) < piece.waxwood]);
    if (piece.cloth) list.push([itemName(Items.BOLT_OF_CLOTH), piece.cloth, stock.getAmount(Items.BOLT_OF_CLOTH) < piece.cloth]);
    if (nails) list.push(["Nails", nails, NAIL_IDS.reduce((sum, id) => sum + stock.getAmount(id), 0) < nails]);
    return list;
  }

  /** Capture tick 1895: every material, the missing ones in red, as Construction words it. */
  function materialsBox(list) {
    return `You don't have the right materials:<br>${list.map(([label, amount, missing]) => {
      const text = `${amount} x ${label}`;
      return missing ? `<col=${MISSING_COLOUR}>${text}</col>` : text;
    }).join(", ")}`;
  }

  const missingTools = (player) => !has(player, Items.HAMMER) || !hasSaw(player);

  /**
   * Build on a hotspot (capture ticks 1832-2075): before the briefing a chat line; without the tools the saw-and-hammer
   * box (rev 227, local 1000152 tick 2742); otherwise the build menu with the one piece.
   */
  function buildPiece(event, index) {
    event.handled = true;
    const { player } = event;
    if (stage(player) < STAGE_BUILD) {
      player.sendMessage("You should get Yarlo to tell you about the furniture he wants, before you try building any.");
      return;
    }
    if (stateOf(player)[index] !== STATE_HOTSPOT) return;
    if (missingTools(player)) {
      talk(player, -1, [{ items: [Items.SAW, Items.HAMMER], text: "You need a saw and hammer in order to make furniture." }]);
      return;
    }
    openBuildMenu(player, index);
  }

  function openBuildMenu(player, index) {
    const piece = PIECES[index];
    const [name, model] = piece.menu;
    const lines = materials(player, piece).map(([label, amount]) => `${label}: ${amount}`);
    while (lines.length < 4) lines.push("");
    const canBuild = materials(player, piece).every(([, , missing]) => !missing);
    const sender = player.getPacketSender();
    sender.sendInterface(BUILD_INTERFACE);
    sender.sendClientScript(BUILD_ENTRY_SCRIPT, 1, obj(model), 1, `${name}|${lines.join("<br>")}`, canBuild ? 1 : 0)
      .sendClientScript(BUILD_LIST_SCRIPT, 1, 0)
      .sendInterfaceFlagsRange(BUILD_LIST_UID, 1, 1, 1);
    pendingBuilds.set(player, index);
  }

  /** The menu's one entry (RESUME_PAUSEBUTTON on 458:2, one-based). */
  function selectBuild(event) {
    if (event.groupId !== BUILD_INTERFACE || event.childId !== 2) return;
    const index = pendingBuilds.get(event.player);
    if (index === undefined || event.action !== 1) return;
    event.handled = true;
    const { player } = event;
    pendingBuilds.delete(player);
    player.getPacketSender().sendInterfaceRemoval();
    player.getPacketSender().sendClientScript(RESTORE_CHAT_INPUT_SCRIPT);
    if (stage(player) < STAGE_BUILD || stateOf(player)[index] !== STATE_HOTSPOT) return;
    if (missingTools(player)) {
      talk(player, -1, [{ items: [Items.SAW, Items.HAMMER], text: "You need a saw and hammer in order to make furniture." }]);
      return;
    }
    const list = materials(player, PIECES[index]);
    if (list.some(([, , missing]) => missing)) {
      talk(player, -1, [{ statement: materialsBox(list) }]);
      return;
    }
    if (!(player.getSkill() instanceof FurnitureBuild)) player.getSkillManager().startSkillable(new FurnitureBuild(player, index));
  }

  function buildMenuClosed({ player, interfaceId }) {
    if (interfaceId !== BUILD_INTERFACE || !pendingBuilds.has(player)) return;
    pendingBuilds.delete(player);
    player.getPacketSender().sendClientScript(RESTORE_CHAT_INPUT_SCRIPT);
  }

  function nailBendChance(player, nailId) {
    const level = Number(player.getSkillManager?.().getCurrentLevel?.(Skill.CONSTRUCTION) ?? 1);
    const base = NAIL_BEND_BASE.get(nailId) ?? 0.4;
    return Math.max(0, base * Math.max(0.05, 1 - (Math.max(1, level) - 1) * 0.06));
  }

  function consumeMaterials(player, piece) {
    const stock = inventory(player);
    if (piece.planks) stock.deleteNumber(Items.PLANK, piece.planks);
    if (piece.waxwood) stock.deleteNumber(WAXWOOD_PLANK, piece.waxwood);
    if (piece.cloth) stock.deleteNumber(Items.BOLT_OF_CLOTH, piece.cloth);
  }

  /**
   * Capture ticks 1835-2076: on the pick the build animation and sound (a piece without nails takes its materials then);
   * a nail a tick ("You use a nail.", spam), the animation after each but the last and the sound on every second; the
   * last nail takes the other materials; the built piece and its XP the tick after. Nails bend (rsprox index: "You
   * accidentally bend a nail.", spam); ours: the rate, which no source gives.
   */
  class FurnitureBuild extends Task {
    constructor(player, index) {
      super(1, player);
      this.player = player;
      this.index = index;
      this.location = player.getLocation().clone();
      this.remaining = PIECES[index].nails ?? 0;
      this.attempts = 0;
      this.taken = false;
    }

    hasRequirements() {
      return !missingTools(this.player) && materials(this.player, PIECES[this.index]).every(([, , missing]) => !missing);
    }

    start() {
      this.animate(0);
      if (this.remaining === 0) this.take();
      TaskManager.submit(this);
    }

    animate(nails) {
      this.player.performAnimation(new Animation(BUILD_ANIMATION));
      if (nails % 2 === 0) this.player.getPacketSender().sendSound(BUILD_SOUND, 0, 0);
    }

    take() {
      consumeMaterials(this.player, PIECES[this.index]);
      this.taken = true;
    }

    /** Once the materials are taken the piece is built, whatever interrupts the tick between (a click away, a logout). */
    cancel() {
      if (this.taken && !this.completed) return this.complete();
      this.stop();
      if (this.player.getSkill() !== this) return;
      this.player.setSkill(null);
      if (this.player.isRegistered() && this.player.getHitpoints() > 0) this.player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
    }

    spam(text) {
      this.player.getPacketSender().sendTypedMessage(ChatType.SPAM, text);
    }

    execute() {
      const player = this.player;
      const piece = PIECES[this.index];
      if (this.taken) return this.complete();
      if (player.getSkill() !== this || !player.isRegistered() || player.getHitpoints() <= 0
        || !player.getLocation().equals(this.location) || stage(player) < STAGE_BUILD
        || stateOf(player)[this.index] !== STATE_HOTSPOT) return this.cancel();
      if (missingTools(player)) {
        talk(player, -1, [{ items: [Items.SAW, Items.HAMMER], text: "You need a saw and hammer in order to make furniture." }]);
        return this.cancel();
      }
      const others = materials(player, piece, 0);
      if (others.some(([, , missing]) => missing)) {
        talk(player, -1, [{ statement: materialsBox(materials(player, piece, this.remaining)) }]);
        return this.cancel();
      }
      const nail = NAIL_IDS.find((id) => has(player, id));
      if (nail === undefined || this.attempts >= piece.nails * 10) {
        // rsprox index (local 1000152 tick 3331): Construction's line when the nails run out mid-build.
        player.sendMessage("You don't have enough nails left.");
        return this.cancel();
      }
      inventory(player).delete(nail, 1);
      this.attempts++;
      if (Math.random() < nailBendChance(player, nail)) this.spam("You accidentally bend a nail.");
      else {
        this.spam("You use a nail.");
        this.remaining--;
      }
      if (this.remaining > 0) this.animate(this.attempts);
      else this.take();
    }

    complete() {
      const player = this.player;
      const piece = PIECES[this.index];
      this.completed = true;
      this.stop();
      if (player.getSkill() === this) player.setSkill(null);
      if (stateOf(player)[this.index] !== STATE_HOTSPOT) return;
      setPieceState(player, this.index, STATE_BUILT);
      player.getSkillManager().addExperiences(Skill.CONSTRUCTION, piece.xp);
    }
  }

  function cancelBuild({ player }) {
    if (player.getSkill() instanceof FurnitureBuild) player.getSkillManager().stopSkillable();
  }

  // ==========================================================================
  // Waxwood crate and the sawmill
  // ==========================================================================

  /**
   * Capture tick 1890: three waxwood logs and the item box. Rev 227 (1723 tick 11752): too little room, the two-item box.
   * Recording 3218 (status 14): "You won't need any more waxwood for Old Man Yarlo's furniture." Ours: that line also
   * once the planks are made or three logs or planks are carried, and the line before the briefing.
   */
  function handleCrateSearch(event) {
    if (event.objectId !== CRATE_OBJECT_ID || !inYarlosHouse(event.location)) return false;
    event.handled = true;
    const { player } = event;
    const current = stage(player);
    if (current < STAGE_BUILD) return player.sendMessage("I've no reason to search through their crates."), true;
    const stock = inventory(player);
    if (current >= STAGE_PLANKS || stateOf(player)[BED] === STATE_BUILT
      || stock.getAmount(WAXWOOD_LOG) >= 3 || stock.getAmount(WAXWOOD_PLANK) >= 3) {
      player.sendMessage("You won't need any more waxwood for Old Man Yarlo's furniture.");
      return true;
    }
    if (stock.getFreeSlots() < 3) {
      talk(player, -1, [{ items: [WAXWOOD_LOG, WAXWOOD_PLANK], text: "The crate contains that water-repellent waxwood Old Man Yarlo described. He said you'd need three planks, so you'll need some more inventory space." }]);
      return true;
    }
    stock.adds(WAXWOOD_LOG, 3);
    talk(player, -1, [{ item: WAXWOOD_LOG, text: "The crate contains that water-repellent waxwood Old Man Yarlo described. You take some." }]);
    return true;
  }

  const WAXWOOD_OPTION = "I need some waxwood planks for Old Man Yarlo.";
  const isVarrockSawmill = (npcId) => npcId === SAWMILL_OPERATOR_NPC_ID;

  /**
   * Capture ticks 1971-2012: at status 5 the Varrock operator's own menu has the waxwood line third; from status 6 it
   * is gone. The rest of the menu stays the operator's (plugins/npcs/Sawmill.plugin.js and its transcript).
   */
  function sawmillMenu(notice) {
    if (!isVarrockSawmill(notice.npcId) || !Array.isArray(notice.options) || stage(notice.player) !== STAGE_BUILD) return;
    if (!notice.options.some((option) => option?.text === "Yes, please make me some planks.")) return;
    if (notice.options.some((option) => option?.text === WAXWOOD_OPTION)) return;
    const options = notice.options.slice();
    options.splice(Math.min(2, options.length), 0, { text: WAXWOOD_OPTION, steps: [] });
    notice.options = options;
  }

  function sawmillChoice(choice) {
    if (!isVarrockSawmill(choice.npcId) || choice.option !== WAXWOOD_OPTION) return;
    choice.end = true;
    const { player, npcId } = choice;
    if (stage(player) !== STAGE_BUILD) return close(player);
    if (inventory(player).getAmount(WAXWOOD_LOG) < 3) {
      // Ours: not captured; the operator's own line for missing logs.
      return talk(player, npcId, [{ player: WAXWOOD_OPTION }, "You'll need to bring me some more logs."]);
    }
    talk(player, npcId, [
      { player: WAXWOOD_OPTION },
      "That old geezer? Oh, alright. I won't charge for this, since it's for him.",
    ], () => {
      close(player);
      if (stage(player) !== STAGE_BUILD || inventory(player).getAmount(WAXWOOD_LOG) < 3) return;
      inventory(player).deleteNumber(WAXWOOD_LOG, 3);
      inventory(player).adds(WAXWOOD_PLANK, 3);
      quest.setStage(player, STAGE_PLANKS);
    });
  }

  // ==========================================================================
  // Old Man Yarlo
  // ==========================================================================

  function remaining(player) {
    const state = stateOf(player);
    return PIECES.filter((piece, index) => state[index] < STATE_HOTSPOT);
  }

  /** rsprox 226/01702.txt:27405: each line of the box is its own row; chat history shows the <br> as a space. */
  function describeRemaining(player) {
    const left = remaining(player).map((piece) => `- ${piece.removalDescription}`);
    const lines = [["You still need to remove:", ...left.slice(0, 3)].join("<br>")];
    for (let index = 3; index < left.length; index += 3) lines.push(left.slice(index, index + 3).join("<br>"));
    return lines;
  }

  function yarloIntro(player, npcId) {
    talk(player, npcId, [
      `What brings you here, ${young(player)}?`,
      { player: "Marlo sent me to fix your furniture." },
      { run: () => { quest.setStage(player, STAGE_REMOVE); sendFurniture(player); } },
      "My boy Marlo sent you? Oh yes, you've come to help with my furniture. It's in a terrible state. You'll want to start by removing all the tatty old furniture.",
      "There are two stools, two tables, a chair and a rotten carpet to replace. I need a better bed too. Let me know when you've removed all the old furniture.",
    ]);
  }

  function yarloRemoval(player, npcId) {
    const left = remaining(player);
    if (left.length === 0) return yarloAfterRemoval(player, npcId);
    const greeting = `Ah, ${young(player)}, how's the redecoration coming on?`;
    if (left.length === PIECES.length) {
      return talk(player, npcId, [
        greeting,
        { player: "What am I supposed to be doing again?" },
        "You'll want to start by removing all the tatty old furniture. There are two stools, two tables, a chair and a rotten carpet to remove, as well as the campbed. Let me know when you've done that.",
      ]);
    }
    talk(player, npcId, [greeting, { player: "I've been removing the old furniture." }, ...describeRemaining(player)]);
  }

  /**
   * Capture ticks 1577-1583 (and rev 241, local 1001562 tick 4411, for Skip): status 3 with the player's line, and an
   * owner's "Is this necessary?" naming the house's town (Rimmington; Rellekka in 1702).
   */
  function yarloAfterRemoval(player, npcId) {
    const house = houseOf(player);
    talk(player, npcId, [
      `Ah, ${young(player)}, how's the redecoration coming on?`,
      { run: () => { if (stage(player) < STAGE_REMOVED) quest.setStage(player, STAGE_REMOVED); } },
      { player: "I've finished removing all the old furniture." },
      `Jolly good, ${young(player)}. Now, we'll need to have a talk about what you'll build for me to replace it.`,
      "You see, I used to be a carpenter myself, before the arthritis got me. Such wonderful things I could build. Let me tell you about the things Construction can do for you...",
      ...(house.owns && house.location ? [{ player: `Is this necessary? I've got a house of my own, in ${house.location}, and I've been learning about Construction for a while.` }] : []),
    ], () => choose(player, "Select an option", [
      ["Listen to Yarlo.", () => listen(player, npcId)],
      ["Skip Yarlo's lecture. He'll offer it later if you like.", () => talk(player, npcId, [
        "You young people are always rushing around trying to optimise the fun out of life. There are other ways to enjoy the world, you know! But I'm sure you know best.",
      ], () => briefing(player, npcId))],
    ]));
  }

  /** The lecture (Lecture.DaddysHome.js), then the briefing; interrupted, the quest stays at status 3 (Wiki: rewatch). */
  function listen(player, npcId) {
    if (!Lecture.play(player, () => briefing(player, npcId))) close(player);
  }

  /** Capture ticks 1767-1774: status 4 with the first line, 5 with the sawmill line; the item boxes as captured. */
  function briefing(player, npcId) {
    talk(player, npcId, [
      { run: () => { if (stage(player) < STAGE_BRIEFING) quest.setStage(player, STAGE_BRIEFING); } },
      "Now, I was just getting round to telling you about the furniture I want you to build for me. For a start, I'd like two new stools, two new tables and a new chair.",
      { items: [Items.PLANK, Items.BRONZE_NAILS], text: "Some basic wooden planks and some nails should do, for those. I won't ask for anything more fancy - it'd only get stolen anyway, in this neighbourhood." },
      { item: Items.BOLT_OF_CLOTH, text: "I'll want a new carpet too. They can really change the atmosphere of a room, you know! You can buy cloth at the sawmill to make one." },
      "Now, for the bed, I've got something special in mind. This town's quite damp, and I don't want the moisture rising up the bed into my blankets. But I've found some wood that resists water.",
      { item: WAXWOOD_LOG, text: "Those abandoned crates in the kitchen were here when I moved in, and I found they contain waxwood logs. Waxwood isn't much used in carpentry, but it resists water, so I want a bed made from that." },
      { run: () => { if (stage(player) < STAGE_BUILD) { quest.setStage(player, STAGE_BUILD); sendFurniture(player); } } },
      { items: [WAXWOOD_LOG, WAXWOOD_PLANK], text: "You'll have to take three logs from the crate to the sawmill. The chap there will turn them into planks if you mention my name - I've known his family for years." },
      `I think that's everything - two stools, two tables, a chair, a bed and a carpet. Off you trot, ${young(player)}. I'll be here if you have any questions.`,
    ]);
  }

  /**
   * Capture ticks 1777-1817: "I've been working on your furniture." first, then the help menu, which comes back
   * without the option just asked. Tools (Wiki): one offer per missing tool.
   */
  function yarloBuilding(player, npcId) {
    if (allBuilt(stateOf(player))) {
      return talk(player, npcId, [
        { player: "I've been working on your furniture." },
        { run: () => { if (stage(player) < STAGE_REWARD) quest.setStage(player, STAGE_REWARD); } },
        `That's everything! Thank you so much, ${young(player)}. Trot off back to my boy Marlo, now. He'll have something for you.`,
        { player: "Okay, I'll head back to Marlo." },
      ]);
    }
    const sawmillTip = { graphic: SAWMILL_MAP_GRAPHIC, text: "Look on your World Map to find the sawmill." };
    talk(player, npcId, [
      { player: "I've been working on your furniture." },
      `Do you need some help with the building work, ${young(player)}?`,
    ], () => loopMenu(player, [
      ["How do I build furniture?", (back) => talk(player, npcId, [
        { player: "How do I build furniture?" },
        "Ah. Look in the place where the new furniture will go...",
        { item: obj("placeholder_beta_elder_wand"), text: "A talented builder will see a vision there of the furniture they could build. Interact with that, and you should find you can build furniture." },
        "You'll need a hammer and saw. I can supply those if you need them.",
      ], back)],
      ["Where do I get planks, nails and cloth?", (back) => talk(player, npcId, [
        { player: "Where do I get planks, nails and cloth?" },
        "From the sawmill! They sell nails and cloth at reasonable prices. You'd have to take your own logs there, though, to get planks, but there are plenty of trees to chop nearby.",
        "Watch out, though - nails can bend, if you're not careful. You should probably get some spares, just in case.",
        sawmillTip,
      ], back)],
      ["I need some tools.", (back) => offerTools(player, npcId, back)],
      ["Tell me about the waxwood for the bed.", (back) => talk(player, npcId, [
        { player: "Tell me about the waxwood for the bed." },
        "This town's quite damp, and I don't want the moisture rising up the bed into my blankets. But I've found some wood that resists water.",
        { item: WAXWOOD_LOG, text: "Those abandoned crates in the kitchen were here when I moved in, and I found they contain waxwood logs. Waxwood isn't much used in carpentry, but it resists water, so I want a bed made from that." },
        { items: [WAXWOOD_LOG, WAXWOOD_PLANK], text: "You'll have to take three logs from the crate to the sawmill. The chap there will turn them into planks if you mention my name." },
        sawmillTip,
      ], back)],
      ["I'll get on with it.", () => talk(player, npcId, [{ player: "I'll get on with it." }])],
    ]));
  }

  /** Capture tick 1795 (both carried); Wiki for the offers: "Would you like a hammer? I can spare one." */
  function offerTools(player, npcId, back) {
    const missing = [];
    if (!has(player, Items.HAMMER)) missing.push(Items.HAMMER);
    if (!hasSaw(player)) missing.push(Items.SAW);
    if (missing.length === 0) {
      return talk(player, npcId, [
        { player: "I need some tools." },
        "You've got a hammer and a saw. I wouldn't be able to offer you anything else.",
      ], back);
    }
    const offer = (first) => {
      const itemId = missing.shift();
      if (itemId === undefined) return back();
      const name = itemId === Items.HAMMER ? "hammer" : "saw";
      talk(player, npcId, [...(first ? [{ player: "I need some tools." }] : []), `Would you like a ${name}? I can spare one.`],
        () => choose(player, "Select an option", [
          ["Yes please.", () => giveTool(player, npcId, itemId, name, () => offer(false))],
          ["No thanks.", () => talk(player, npcId, [{ player: "No thanks." }], () => offer(false))],
        ]));
    };
    offer(true);
  }

  function giveTool(player, npcId, itemId, name, then) {
    const stock = inventory(player);
    if (stock.getFreeSlots() === 0) {
      // Ours: not captured.
      return talk(player, npcId, [{ player: "Yes please." }, { statement: "You don't have enough inventory space." }], then);
    }
    talk(player, npcId, [
      { player: "Yes please." },
      { run: () => stock.adds(itemId, 1) },
      { statement: `Yarlo gives you a ${name}.` },
    ], then);
  }

  function yarloAwaitingReward(player, npcId) {
    talk(player, npcId, [
      `Hello again, ${young(player)}. Has my boy Marlo rewarded you yet?`,
      { player: "Not yet. I'll get round to visiting him soon." },
      "Yes, you should do that. You've earned it.",
    ]);
  }

  /** Capture ticks 2223-2367: the menu, and the lecture again, then "Thank you!". */
  function yarloAfterQuest(player, npcId) {
    talk(player, npcId, [
      `Hello again, ${young(player)}. You really did wonders for my little home. I feel so much happier living here now.`,
    ], () => choose(player, "Select an option", [
      ["Tell me about more things I can do with Construction.", () => talk(player, npcId, [
        { player: "Tell me about more things I can do with Construction." },
      ], () => {
        if (!Lecture.play(player, () => talk(player, npcId, [{ player: "Thank you!" }]))) close(player);
      })],
      ["That's good to hear. Goodbye now.", () => talk(player, npcId, [{ player: "That's good to hear. Goodbye now." }])],
    ]));
  }

  function yarloTalk(event) {
    if (event.npcId !== OLD_MAN_YARLO_NPC_ID) return false;
    const option = String(event.definition?.getActions?.()?.[event.clickType - 1] ?? "").toLowerCase();
    if (option !== "talk-to") return false;
    const { player, npcId } = event;
    const current = stage(player);
    if (current === 0) return false;
    event.handled = true;
    if (current === STAGE_STARTED) return yarloIntro(player, npcId), true;
    if (current === STAGE_REMOVE) return yarloRemoval(player, npcId), true;
    // Ours: status 4 (a briefing left part way) plays the conversation after the removal again.
    if (current < STAGE_BUILD) return yarloAfterRemoval(player, npcId), true;
    if (current < STAGE_REWARD) return yarloBuilding(player, npcId), true;
    if (current < STAGE_COMPLETE) return yarloAwaitingReward(player, npcId), true;
    return yarloAfterQuest(player, npcId), true;
  }

  // ==========================================================================
  // Marlo
  // ==========================================================================

  const CONTRACT_OPTION = "What's my current construction contract?";

  /**
   * Capture ticks 1405-1460 (joined Mahogany Homes) and rev 241 (local 1001562 tick 4227, not joined): the greeting
   * and menu by membership; the favour's menu comes back without the question just asked; "Tell me more about the job."
   * ends in "Start the Daddy's Home quest?" (rev 242; rev 241 offered "Tell me where he lives, and I'll do the job.").
   */
  function marloStart(player, npcId) {
    const member = joined(player);
    talk(player, npcId, [member
      ? "Hello - it's lovely to see a Mahogany Homes contractor on their rounds! Now, can I help you with something? Or might you be able to do me a little favour?"
      : "Welcome to the Varrock branch of Mahogany Homes, Gielinor's first construction company. Would you like to work for us? Or might you be able to do me a little favour?",
    ], () => marloMainMenu(player, npcId, member));
  }

  function marloMainMenu(player, npcId, member) {
    choose(player, "Select an option", [
      member
        ? [CONTRACT_OPTION, () => currentContract(player, npcId)]
        // Ours: the answer is not captured; the Wiki's to "What does this Mahogany Homes company do?".
        : ["Tell me about working for Mahogany Homes.", () => talk(player, npcId, [
          { player: "Tell me about working for Mahogany Homes." },
          "Oh, we redecorate people's houses, fixing things and building new furniture. Mending cabinets, building new chairs and tables - things like that.",
          "When a client hires us to redecorate their house, we send a builder round to do the job, and we ensure the builder's paid for their work.",
          "We can't hire you for that kind of work now, but perhaps you could do me a little favour instead, if you're willing. I can pay!",
        ], () => marloMainMenu(player, npcId, member))],
      ["What kind of favour do you want me to do?", () => marloFavour(player, npcId)],
      ["Maybe another time.", () => talk(player, npcId, [{ player: "Maybe another time." }])],
    ]);
  }

  function marloFavour(player, npcId) {
    talk(player, npcId, [
      { player: "What kind of favour do you want me to do?" },
      "Well, you see, it's about my dad. His house is really decrepit. I need someone to rip out the broken furniture and build him some better stuff. I'll pay you if you do it.",
    ], () => loopMenu(player, [
      ["Aren't you in a construction company yourself though?", (back) => talk(player, npcId, [
        { player: "Aren't you in a construction company yourself though?" },
        "See, my dad just - um - found the house. No-one was using it, so he just settled in. It's all perfectly harmless, and he's a sick old man anyway, so...",
        "Basically, he's not really meant to be there. And we'd prefer that the landlord not find out, so we're keeping this job off the record. I'll pay you myself.",
      ], back)],
      ["Why has he got such a bad house?", (back) => talk(player, npcId, [
        { player: "Why has he got such a bad house?" },
        "Some kind of economic downturn wiped out his pension plans. It happens more often than you'd think. But I'd rather not talk about it. Can you help him, though?",
      ], back)],
      ["Tell me more about the job.", () => talk(player, npcId, [
        { player: "Tell me more about the job." },
        "Nothing too hard. You'll have to rip out the broken furniture, then build replacements. Dad will talk you through it - he's a retired carpenter himself. He loves talking about construction.",
      ], () => choose(player, "Start the Daddy's Home quest?", [
        ["Yes.", () => marloAccept(player, npcId)],
        ["No.", () => marloDecline(player, npcId)],
      ]))],
      ["I'd rather not.", () => marloDecline(player, npcId)],
    ]));
  }

  function marloDecline(player, npcId) {
    talk(player, npcId, [{ player: "I'd rather not." }, "Okay, suit yourself."]);
  }

  /** Capture tick 1460: status 1 and the start message on the tick Marlo's answer shows. */
  function marloAccept(player, npcId) {
    talk(player, npcId, [
      { player: "Tell me where he lives, and I'll do the job." },
      { run: () => {
        if (stage(player) >= STAGE_STARTED) return;
        quest.setStage(player, STAGE_STARTED);
        player.sendMessage(startMessage(player));
      } },
      "Fabulous! Dad lives in the south-east of Varrock, west of Aubury's Rune Shop. His name's Yarlo. Old Man Yarlo, they call him.",
    ]);
  }

  /** Wiki; the contract option is the capture's (joined). Ours: "Maybe another time." for a player who has not joined. */
  function marloProgress(player, npcId) {
    const member = joined(player);
    talk(player, npcId, ["How are you getting on with helping my dad?"], () => choose(player, "Select an option", [
      ["Where did you say he lived?", () => talk(player, npcId, [
        { player: "Where did you say he lived?" },
        "Dad lives in the south-east of Varrock, west of Aubury's Rune Shop. His name's Yarlo. Old Man Yarlo, they call him. He's sure to be at home, so keep looking around.",
      ])],
      member ? [CONTRACT_OPTION, () => currentContract(player, npcId)]
        : ["Maybe another time.", () => talk(player, npcId, [{ player: "Maybe another time." }])],
    ]));
  }

  /** Capture ticks 2145-2147: the player's line, then status 11 with Marlo's answer. */
  function marloFinished(player, npcId) {
    talk(player, npcId, [
      { player: "I've finished building the new furniture for your dad." },
      { run: () => { if (stage(player) < STAGE_TOLD_MARLO) quest.setStage(player, STAGE_TOLD_MARLO); } },
      "That's wonderful news! Dad's going to be so much happier. I'm very grateful! Now, I promised to pay you for your work...",
    ], () => marloRewardMenu(player, npcId));
  }

  /** Capture tick 2153: talking again at status 11. */
  function marloReminder(player, npcId) {
    talk(player, npcId, ["I haven't forgotten that I promised to pay you for your help. Is this a good time for that?"],
      () => marloRewardMenu(player, npcId));
  }

  /** The second option: the contract when joined (capture), "Can I do some other kind of building work..." (rev 241). */
  function marloRewardMenu(player, npcId) {
    choose(player, "Select an option", [
      ["Yeah, what have you got for me?", () => marloReward(player, npcId)],
      joined(player) ? [CONTRACT_OPTION, () => currentContract(player, npcId)]
        : ["Can I do some other kind of building work for you?", () => talk(player, npcId, [
          { player: "Can I do some other kind of building work for you?" },
          "I'm so sorry, but you're not qualified to do contracts for Mahogany Homes yet. Just keep helping my dad, for now, and perhaps I can sort that out for you.",
        ])],
    ]);
  }

  /**
   * Capture ticks 2155-2158 (owning a house): two lines, then status 13 as the player continues, the scroll, 1,000
   * coins and the crate. Without a house, rev 227 (local 1000176 tick 19420): three lines and the house.
   */
  function marloReward(player, npcId) {
    const lines = houseOf(player).owns === false
      ? [
        "Now, I can't spare very much money, but I've persuaded the Estate Agent to let me give you a house of your own. You'll be able to decorate it, like you did for my dad's house.",
        "Normally a new house costs 1,000 coins, so that's a bit of a saving. Also, I've got a crate of supplies to help you decorate it.",
        "I've included some handy spell tablets that'll take you to your house, to cut down on the walking a bit, as well as one for visiting my boss in Falador. Let me tell you some tricks of the trade too...",
      ]
      : [
        "Now, I can't spare very much money, but I've got some supplies in this crate that might help with your own Construction work.",
        "I've included some handy spell tablets that'll take you to your house, to cut down on the walking a bit, as well as one for visiting my boss in Falador. Hope you find it all useful.",
      ];
    talk(player, npcId, [{ player: "Yeah, what have you got for me?" }, ...lines], () => {
      if (stage(player) === STAGE_TOLD_MARLO) quest.complete(player);
      else close(player);
    });
  }

  function onReward(player) {
    player.getSkillManager().addExperiences(Skill.CONSTRUCTION, 400);
    const grant = { player, granted: false };
    api.emitCustomEvent("construction:grant-house", grant);
    houseOnScroll.set(player, grant.granted);
    // Already owned a house (or Construction did not answer): 1,000 coins (capture tick 2158).
    if (!grant.granted) player.getInventory().forceAdd(player, new Item(Items.COINS, 1000));
  }

  /** The scroll's lines after the Quest Point, in its order (capture tick 2158); the house is the Wiki's. */
  function scrollRewards(player) {
    return ["400 Construction XP", houseOnScroll.get(player) ? "A house in Rimmington" : "1,000 Coins", "A crate of supplies"];
  }

  /**
   * Capture ticks 2163-2173 (joined) and 3220 (rev 232, not joined) after the quest. Wiki: Marlo replaces a crate that
   * was lost unopened (status 13).
   */
  function marloAfterQuest(player, npcId) {
    if (stage(player) === STAGE_COMPLETE && !ownsCrate(player)) {
      return talk(player, npcId, [
        "I haven't forgotten that I promised to pay you for your help. Did you lose that crate I gave you?",
        { player: "Yes, I'm afraid so." },
        "Here, take another one. Try not to lose it this time!",
      ], () => {
        close(player);
        if (inventory(player).getFreeSlots() === 0) return player.sendMessage("You need a free inventory slot to take the crate.");
        inventory(player).adds(MARLOS_CRATE, 1);
      });
    }
    const member = joined(player);
    talk(player, npcId, [
      "Thanks again for helping my dad. He's so much more comfortable in his home now. You're a really good friend, you know!",
    ], () => choose(player, "Select an option", [
      member ? [CONTRACT_OPTION, () => currentContract(player, npcId)]
        // Ours: the answer is not captured; Mahogany Homes' own (Amy takes on new contractors).
        : ["So can I do some more building for you?", () => talk(player, npcId, [{ player: "So can I do some more building for you?" }],
          () => currentContract(player, npcId))],
      ["Great. I'll leave you to it.", () => talk(player, npcId, [{ player: "Great. I'll leave you to it." }])],
    ]));
  }

  function marloTalk(event) {
    if (!MARLO_NPC_IDS.has(event.npcId)) return false;
    const option = String(event.definition?.getActions?.()?.[event.clickType - 1] ?? "").toLowerCase();
    if (option !== "talk-to") return false;
    event.handled = true;
    const { player, npcId } = event;
    const current = stage(player);
    if (current === 0) return marloStart(player, npcId), true;
    if (current < STAGE_REWARD) return marloProgress(player, npcId), true;
    if (current === STAGE_REWARD) return marloFinished(player, npcId), true;
    if (current < STAGE_COMPLETE) return marloReminder(player, npcId), true;
    return marloAfterQuest(player, npcId), true;
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

  /**
   * Capture tick 2181: status 14, the contents, found_gem and the item box. A second crate (a replacement, or one from
   * a full bag) opens empty once status 14 is set.
   */
  function openCrate(event) {
    if (event.itemId !== MARLOS_CRATE) return false;
    const { player, item, slot } = event;
    if (inventory(player).get(slot) !== item) return false;
    if (stage(player) >= STAGE_CRATE_OPENED || Number(player.getAttribute(CRATE_OPENED_ATTRIBUTE)) === 1) {
      if (!inventory(player).deleteAtSlot(slot, 1)) return true;
      // Ours: not captured.
      player.sendMessage("You have already opened Marlo's crate.");
      return true;
    }
    // Opening the crate frees the slot it occupies. Ours: the refusal is not captured.
    const needed = Math.max(0, crateSlotsNeeded(player) - 1);
    if (inventory(player).getFreeSlots() < needed) {
      return player.sendMessage(`You need ${needed} free inventory slots to open Marlo's crate.`), true;
    }
    if (!inventory(player).deleteAtSlot(slot, 1)) return true;
    if (stage(player) >= STAGE_COMPLETE) quest.setStage(player, STAGE_CRATE_OPENED);
    else player.setAttribute(CRATE_OPENED_ATTRIBUTE, 1);
    for (const [itemId, amount] of CRATE_CONTENTS) inventory(player).adds(itemId, amount);
    player.getPacketSender().sendSound(FOUND_GEM_SOUND, 0, 0);
    talk(player, -1, [{ item: MARLOS_CRATE, text: "You find a variety of useful Construction supplies." }]);
    return true;
  }

  // ==========================================================================
  // Journal
  // ==========================================================================

  const DONE = (text) => `<str>${text}</str>`;

  /**
   * Capture ticks ~1828 (status 5) and ~2140 (status 10) give the journal at those stages: what is done struck through,
   * the current step in dark blue with its names in red. Ours: the current-step wording before status 5, at 6 and
   * at 11, and the strike-through of status 10's lines at 11.
   */
  function buildJournal(player, questHandle) {
    const current = questHandle.getStage(player);
    if (current === 0) {
      return ["I can start this quest by talking to <col=800000>Marlo<col=000080> in the", "<col=800000>Varrock Estate Agent's<col=000080> office."];
    }
    const lines = [];
    const part = (done, struck, live) => { if (done) lines.push(...struck.map(DONE)); else lines.push(...live); };
    part(current >= STAGE_REMOVE, [
      "Marlo asked me to go to his father's house and fix up the", "furniture for him.",
      "He said Old Man Yarlo lived in the south-east of Varrock, west", "of Aubury's Rune Shop.",
    ], [
      "<col=800000>Marlo<col=000080> asked me to go to his father's house and fix up the", "<col=000080>furniture for him.",
      "<col=000080>He said <col=800000>Old Man Yarlo<col=000080> lived in the south-east of <col=800000>Varrock<col=000080>, west",
      "<col=000080>of <col=800000>Aubury's Rune Shop<col=000080>.",
    ]);
    if (current < STAGE_REMOVE) return lines;
    part(current >= STAGE_REMOVED, ["Old Man Yarlo asked me to remove some tatty old furniture", "from his house."], [
      "<col=800000>Old Man Yarlo<col=000080> asked me to remove some <col=800000>tatty old furniture", "<col=000080>from his house.",
    ]);
    if (current < STAGE_REMOVED) return lines;
    part(current >= STAGE_BUILD, ["I told Old Man Yarlo I'd finished removing the tatty old", "furniture, and waited to learn what he wanted me to do next."], [
      "<col=000080>I told <col=800000>Old Man Yarlo<col=000080> I'd finished removing the tatty old",
      "<col=000080>furniture, and waited to learn what he wanted me to do next.",
    ]);
    if (current < STAGE_BUILD) return lines;
    part(current >= STAGE_REWARD, [
      "Old Man Yarlo asked me to build him some new furniture:",
      "Two stools, using basic wooden planks and some nails.",
      "A chair, using basic wooden planks and some nails.",
      "Two tables, using basic wooden planks and some nails.",
      "A carpet, using cloth from the sawmill.",
      "A bed, using waxwood. He said he'd got some waxwood logs in",
      "a crate in his kitchen, which the sawmill staff could turn into",
      "waxwood planks.",
    ], [
      "<col=800000>Old Man Yarlo<col=000080> asked me to build him some <col=800000>new furniture<col=000080>:",
      "<col=800000>Two stools<col=000080>, using basic <col=800000>wooden planks<col=000080> and some <col=800000>nails<col=000080>.",
      "<col=800000>A chair<col=000080>, using basic <col=800000>wooden planks<col=000080> and some <col=800000>nails<col=000080>.",
      "<col=800000>Two tables<col=000080>, using basic <col=800000>wooden planks<col=000080> and some <col=800000>nails<col=000080>.",
      "<col=800000>A carpet<col=000080>, using <col=800000>cloth<col=000080> from the <col=800000>sawmill<col=000080>.",
      "<col=800000>A bed<col=000080>, using <col=800000>waxwood<col=000080>. He said he'd got some <col=800000>waxwood logs<col=000080> in",
      "<col=000080><col=800000>crates<col=000080> in his kitchen, which the <col=800000>sawmill staff<col=000080> could turn into",
      "<col=000080><col=800000>waxwood planks<col=000080>.",
    ]);
    if (current >= STAGE_PLANKS) {
      part(current >= STAGE_REWARD, ["The sawmill operator agreed to convert waxwood logs to", "planks for me."], [
        "<col=000080>The <col=800000>sawmill operator<col=000080> agreed to convert <col=800000>waxwood logs<col=000080> to",
        "<col=000080>planks for me.",
      ]);
    }
    if (current < STAGE_REWARD) return lines;
    part(current >= STAGE_TOLD_MARLO, ["Old Man Yarlo thanked me for building his new furniture, and", "sent me back to Marlo for my reward."], [
      "<col=800000>Old Man Yarlo<col=000080> thanked me for building his <col=800000>new furniture<col=000080>, and",
      "<col=000080>sent me back to <col=800000>Marlo<col=000080> for my reward.",
    ]);
    if (current < STAGE_COMPLETE) {
      if (current >= STAGE_TOLD_MARLO) lines.push("<col=000080>I should collect my reward from <col=800000>Marlo<col=000080>.");
      return lines;
    }
    lines.push(DONE("Marlo rewarded me with a crate of Construction supplies."), "", "<col=ff0000>QUEST COMPLETE!</col>");
    return lines;
  }

  // ==========================================================================
  // Scene end and registration
  // ==========================================================================

  function onSceneEnd(player, scene, logout) {
    Lecture.onEnd(player, scene, logout);
  }

  function onLogout(event) {
    cancelBuild(event);
    Lecture.onLogout(event);
  }

  api.persistAttribute(FURNITURE_ATTRIBUTE, [0, 0, 0, 0, 0, 0, 0]);
  api.persistAttribute(CRATE_OPENED_ATTRIBUTE, 0);
  api.persistAttribute(QP_CREDITED_ATTRIBUTE, false);

  quest = registerQuest(api, {
    key: "daddys_home",
    name: "Daddy's Home",
    varpId: VARP_DADDYS_HOME,
    varbitId: VARBIT_STATUS,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    rewardItemId: MARLOS_CRATE,
    scrollItemId: Items.SAW, // poh_saw 8794 on the scroll
    otherRewards: scrollRewards,
    onReward,
    buildJournal,
  });

  api.onBeforeNpcInteraction(marloTalk);
  api.onBeforeNpcInteraction(yarloTalk);
  api.onObjectInteraction(handleObjectInteraction);
  api.onObjectInteraction(handleCrateSearch);
  api.onInterfaceActionClick(selectBuild);
  api.onCustomEvent("interface:closed", buildMenuClosed);
  api.onCustomEvent("npc-dialogue:menu", sawmillMenu);
  api.onCustomEvent("npc-dialogue:choice", sawmillChoice);
  api.onItemAction("Marlo's crate", { Open: openCrate });
  api.onPlayerLogin(onLogin);
  api.onPlayerLogout(onLogout);
};
