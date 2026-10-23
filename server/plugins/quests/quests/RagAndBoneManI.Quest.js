/**
 * Rag and Bone Man I (members).
 *
 * The words come from the "Rag and Bone Man I" transcript page plus the
 * "Odd Old Man" and "Fortunato" pages, which hold the post-quest variants the
 * quest page itself lacks. The plugin owns the start hook, the eight bone
 * hand-ins (the quest page carries no action steps for them), the vinegar
 * chain, the pot-boiler and the wish-list run-down of the bones still owed.
 *
 * Stage varp: 714 ("rag_quest" in the cache gameval dump; `dump:cs2 4024`'s
 * quest-value getter returns get_varp 714 for the Rag and Bone Man entry). The
 * durable stage is 0 not started, 1 started, 2 complete. Quest DB row 114
 * (table 0, column 19) completes at 4, which is the value script 4029 compares
 * against, so the wire mapping is 0/1/4 rather than 0/1/2. Rag and Bone Man II
 * shares the same varp and takes it over from 4 once this quest is complete.
 * Which of the eight bones have been handed in lives in the persisted
 * "quest.rag_and_bone_man_i.handed" bit attribute, because varp 714 has no
 * varbits to carry them.
 *
 * Bones (raw / bone in vinegar / cleaned), cache item dump:
 *   goblin 7812/7813/7814, bear 7815/7816/7817, ram 7818/7819/7820,
 *   unicorn 7821/7822/7823, giant rat 7824/7825/7826, giant bat 7827/7828/7829,
 *   monkey 7854/7855/7856, big frog 7908/7909/7910.
 *
 * Pot-boiler (dump:loc): map object 14004 "null" at 3360,3505 transforms by
 * varbit 2046 ("rag_boiler", varp 716 bits 21-28) into 14006 empty / 14005 logs
 * / 14007 pot (Remove-Pot) / 14008 lit / 14009 done (Remove-Bone); the Wish-list
 * is object 14010 at 3361,3507.
 *
 * Source: OSRS Wiki "Rag and Bone Man I", its Quick guide and Transcript,
 * "Pot of vinegar", "Pot-boiler", "Wish-list" and "Transcript:Wish-list".
 *
 * Gaps / approximations:
 *  - The post-quest Odd Old Man and Fortunato variants come from their own
 *    transcript pages; the quest page has none.
 *  - The wish-list "Read" plays the wiki's phase text as-is (no per-bone
 *    strike-through); the Odd Old Man's run-down is the place that skips
 *    already-handed bones.
 *  - Drops are suppressed for bones already handed in and only while the quest
 *    is in progress (stage 1); the wiki only says each is a guaranteed drop.
 *  - The wiki does not document the boiler's Remove-Pot mid-boil, so it hands
 *    the bone in vinegar back; the item's Empty option (the wiki's bone-loss
 *    warning) is not implemented, so bones cannot be destroyed here.
 *  - The boil timer is not persisted: logging out mid-boil refunds the bone in
 *    vinegar on the next login (the server keeps varps per session only).
 *  - Logs are accepted by name ("... logs", pyre logs excluded), matching the
 *    wiki's "any logs capable of being set aflame on the ground"; the log's
 *    Firemaking level is not enforced, and lighting grants no XP as on OSRS.
 */
module.exports = function registerRagAndBoneManIQuest(api) {
  const {
    Animation,
    CountdownTask,
    DialogueChainBuilder,
    EndDialogue,
    GameObject,
    Item,
    ItemDefinition,
    ItemIdentifiers,
    Location,
    NpcDefinition,
    NpcIdentifiers,
    ObjectDefinition,
    ObjectIdentifiers,
    ShopManager,
    Skill,
    StatementDialogue,
    TaskManager,
  } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const ODD_OLD_MAN_NPC_ID = NpcIdentifiers.ODD_OLD_MAN; // 1259
  const FORTUNATO_NPC_ID = NpcIdentifiers.FORTUNATO; // 1260

  const VARP_RAG_AND_BONE_MAN_I = 714; // "rag_quest"
  const STAGE_STARTED = 1;
  const STAGE_COMPLETE = 2;
  const WIRE_STARTED = 1;
  const WIRE_COMPLETE = 4; // quest DB row 114, column 19 (script 4029 threshold)

  const START_HOOK = "quest:rag-and-bone-man-i:start";
  const LOAD_SHARED_VINEGAR_BONE_EVENT = "rag-and-bone-man-i:load-vinegar-bone";

  const JUG_OF_VINEGAR_ITEM_ID = ItemIdentifiers.JUG_OF_VINEGAR; // 7810
  const POT_OF_VINEGAR_ITEM_ID = ItemIdentifiers.POT_OF_VINEGAR; // 7811
  const POT_ITEM_ID = ItemIdentifiers.POT; // 1931
  const TINDERBOX_ITEM_ID = ItemIdentifiers.TINDERBOX; // 590
  const WINE_SHOP_ID = 1383; // shops.json "Wine Shop." (Fortunato, npc 1260)

  // The map places the neutral transform object; its states carry the options.
  const POT_BOILER_BASE_OBJECT_ID = 14004; // map object "null" at 3360,3505
  const POT_BOILER_TILE = new Location(3360, 3505, 0);
  const POT_BOILER_VARBIT = 2046; // "rag_boiler", varp 716 bits 21-28
  const POT_BOILER_STATE_OBJECT_IDS = new Set([
    ObjectIdentifiers.POT_BOILER, // 14005 logs
    ObjectIdentifiers.POT_BOILER_2, // 14006 empty
    ObjectIdentifiers.POT_BOILER_3, // 14007 pot, Remove-Pot
    ObjectIdentifiers.POT_BOILER_4, // 14008 lit
    ObjectIdentifiers.POT_BOILER_5, // 14009 done, Remove-Bone
  ]);
  const BOILER_EMPTY = 0;
  const BOILER_LOGS = 1;
  const BOILER_BONE = 2;
  const BOILER_LIT = 3;
  const BOILER_READY = 4;
  const BOIL_TICKS = 20; // OSRS Wiki: 12 seconds
  const LIGHT_FIRE_ANIMATION = new Animation(733); // firemaking (Firemaking.plugin.js)

  const BIT_GOBLIN = 1 << 0;
  const BIT_BEAR = 1 << 1;
  const BIT_BIG_FROG = 1 << 2;
  const BIT_RAM = 1 << 3;
  const BIT_UNICORN = 1 << 4;
  const BIT_MONKEY = 1 << 5;
  const BIT_GIANT_RAT = 1 << 6;
  const BIT_GIANT_BAT = 1 << 7;
  const ALL_BONES = (1 << 8) - 1;

  const BONES = [
    { bit: BIT_GOBLIN, label: "Goblin", raw: ItemIdentifiers.GOBLIN_SKULL, vinegar: ItemIdentifiers.BONE_IN_VINEGAR, cleaned: ItemIdentifiers.GOBLIN_SKULL_2, monsters: ["Goblin"] },
    { bit: BIT_BEAR, label: "Bear", raw: ItemIdentifiers.BEAR_RIBS, vinegar: ItemIdentifiers.BONE_IN_VINEGAR_2, cleaned: ItemIdentifiers.BEAR_RIBS_2, monsters: ["Black bear", "Grizzly bear"] },
    { bit: BIT_BIG_FROG, label: "Big Frog", raw: ItemIdentifiers.BIG_FROG_LEG, vinegar: ItemIdentifiers.BONE_IN_VINEGAR_33, cleaned: ItemIdentifiers.BIG_FROG_LEG_2, monsters: ["Big frog"] },
    { bit: BIT_RAM, label: "Ram", raw: ItemIdentifiers.RAM_SKULL, vinegar: ItemIdentifiers.BONE_IN_VINEGAR_3, cleaned: ItemIdentifiers.RAM_SKULL_2, monsters: ["Ram"] },
    { bit: BIT_UNICORN, label: "Unicorn", raw: ItemIdentifiers.UNICORN_BONE, vinegar: ItemIdentifiers.BONE_IN_VINEGAR_4, cleaned: ItemIdentifiers.UNICORN_BONE_2, monsters: ["Unicorn"] },
    { bit: BIT_MONKEY, label: "Monkey", raw: ItemIdentifiers.MONKEY_PAW, vinegar: ItemIdentifiers.BONE_IN_VINEGAR_15, cleaned: ItemIdentifiers.MONKEY_PAW_2, monsters: ["Monkey"] },
    { bit: BIT_GIANT_RAT, label: "Giant Rat", raw: ItemIdentifiers.GIANT_RAT_BONE, vinegar: ItemIdentifiers.BONE_IN_VINEGAR_5, cleaned: ItemIdentifiers.GIANT_RAT_BONE_2, monsters: ["Giant rat"] },
    { bit: BIT_GIANT_BAT, label: "Giant Bat", raw: ItemIdentifiers.GIANT_BAT_WING, vinegar: ItemIdentifiers.BONE_IN_VINEGAR_6, cleaned: ItemIdentifiers.GIANT_BAT_WING_2, monsters: ["Giant bat"] },
  ];
  const RAW_BONE_BY_ITEM = new Map(BONES.map((bone) => [bone.raw, bone]));
  const VINEGAR_BONE_BY_ITEM = new Map(BONES.map((bone) => [bone.vinegar, bone]));
  const CLEANED_BONE_BY_ITEM = new Map(BONES.map((bone) => [bone.cleaned, bone]));
  const BONE_BY_MONSTER_NAME = new Map();
  for (const bone of BONES) for (const name of bone.monsters) BONE_BY_MONSTER_NAME.set(name, bone);

  /** The wish-list run-down, one need-line and one hint per bone. */
  const WISH_LIST_LINE_PREFIXES = [
    ["You still need to bring me a Goblin bone.", BIT_GOBLIN],
    ["Goblins are relatively common.", BIT_GOBLIN],
    ["You still need to bring me a Bear bone.", BIT_BEAR],
    ["I heard that there are some Bears over", BIT_BEAR],
    ["You still need to bring me a Big Frog bone.", BIT_BIG_FROG],
    ["This might be a little tricky", BIT_BIG_FROG],
    ["You still need to bring me a Ram bone.", BIT_RAM],
    ["I'm sure you will be able to find a ram", BIT_RAM],
    ["You still need to bring me a Unicorn bone.", BIT_UNICORN],
    ["I seem to remember that there were Unicorns", BIT_UNICORN],
    ["You still need to bring me a Monkey bone.", BIT_MONKEY],
    ["Monkeys tend to live in Jungle areas", BIT_MONKEY],
    ["You still need to bring me a Giant Rat bone.", BIT_GIANT_RAT],
    ["If you can't find one in a sewer", BIT_GIANT_RAT],
    ["You still need to bring me a Giant Bat bone.", BIT_GIANT_BAT],
    ["Giant bats tend to live underground", BIT_GIANT_BAT],
  ];
  const HAND_IN_LINES = new Set([
    "Wonderful! I'll put this with the rest.",
    "That's the last of them!",
  ]);
  const COMPLETE_ACTION_ID = "TzmM_e"; // "Quest complete!" on finishing-up
  const WINE_SHOP_ACTION_IDS = new Set([
    "gW205J", // R&B I page, "getting-the-vinegar-need-more-vinegar" Yes
    "QsclKe", // Fortunato page, standard before the quest
    "CeVOhV", // Fortunato page, standard after the quest
  ]);

  const WISH_LIST_BEFORE = "Wish List: Goblin, Bear, Big Frog, Ram, Unicorn, Monkey, Giant Rat, and Giant Bat.";
  const WISH_LIST_AFTER = "Wish List: Wolf, Bat, Rat, Baby Blue Dragon, Ogre, Jogre, Zogre, Mogre, Dagannoth, Snake, Zombie, Werewolf, Moss Giant, Fire Giant, Ice Giant, Terrorbird, Ghoul, Troll, Seagull, Undead Cow, Experiment, Rabbit, Basilisk, Massive Desert Lizard, Cave Goblin, Vulture and Jackal.";

  const HANDED_ATTRIBUTE = "quest.rag_and_bone_man_i.handed";
  const DECLINED_ATTRIBUTE = "quest.rag_and_bone_man_i.declined";
  const VINEGAR_ASKED_ATTRIBUTE = "quest.rag_and_bone_man_i.vinegar-asked";
  const BOILER_ATTRIBUTE = "quest.rag_and_bone_man_i.boiler";

  let quest;
  const boilerStates = new WeakMap(); // player -> { state, bone }
  const wishListSkips = new WeakMap(); // player -> bone bit whose block is skipped

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  function handedBits(player) {
    return Number(player.getAttribute(HANDED_ATTRIBUTE)) || 0;
  }

  function hasHanded(player, bit) {
    return (handedBits(player) & bit) !== 0;
  }

  /** Durable stage -> the value native getState compares against threshold 4. */
  function wireValue(stage) {
    if (stage >= STAGE_COMPLETE) return WIRE_COMPLETE;
    if (stage >= STAGE_STARTED) return WIRE_STARTED;
    return 0;
  }

  function allBonesHandedIn(player) {
    return (handedBits(player) & ALL_BONES) === ALL_BONES;
  }

  function setHanded(player, bit) {
    player.setAttribute(HANDED_ATTRIBUTE, handedBits(player) | bit);
  }

  function isDeclined(player) {
    return (Number(player.getAttribute(DECLINED_ATTRIBUTE)) || 0) !== 0;
  }

  function isVinegarAsked(player) {
    return (Number(player.getAttribute(VINEGAR_ASKED_ATTRIBUTE)) || 0) !== 0;
  }

  function hasUnhandedItem(player, byItem) {
    for (const [itemId, bone] of byItem) {
      if (!hasHanded(player, bone.bit) && held(player, itemId)) return true;
    }
    return false;
  }

  function wouldFinishCollection(player) {
    let bits = handedBits(player);
    for (const [itemId, bone] of CLEANED_BONE_BY_ITEM) {
      if (!hasHanded(player, bone.bit) && held(player, itemId)) bits |= bone.bit;
    }
    return (bits & ALL_BONES) === ALL_BONES;
  }

  /** "I have some bones for you." consumes one cleaned bone per missing type. */
  function handInCleanedBones(player) {
    const inventory = player.getInventory();
    for (const bone of BONES) {
      if (hasHanded(player, bone.bit) || inventory.getAmount(bone.cleaned) <= 0) continue;
      inventory.deleteNumber(bone.cleaned, 1);
      setHanded(player, bone.bit);
    }
  }

  // ==========================================================================
  // Dialogue branch selection
  // ==========================================================================

  function selectVariant({ npcId, player }) {
    if (npcId === ODD_OLD_MAN_NPC_ID) return selectOddOldManVariant(player);
    if (npcId === FORTUNATO_NPC_ID) return selectFortunatoVariant(player);
    return null;
  }

  function selectOddOldManVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "after-rag-and-bone-man-i";
    if (stage < STAGE_STARTED) {
      return isDeclined(player)
        ? "starting-off-after-initally-declining-the-quest"
        : "starting-off";
    }
    if (allBonesHandedIn(player)) return "finishing-up"; // hand-in was cut short
    if (hasUnhandedItem(player, CLEANED_BONE_BY_ITEM)) {
      return wouldFinishCollection(player) ? "finishing-up" : "handing-in-some-bones";
    }
    if (hasUnhandedItem(player, RAW_BONE_BY_ITEM)) return "trying-to-hand-in-unclean-bones";
    if (hasUnhandedItem(player, VINEGAR_BONE_BY_ITEM)) {
      return "trying-to-hand-in-a-bone-while-its-in-a-pot-of-vinegar";
    }
    return "before-having-any-bones";
  }

  function selectFortunatoVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-rag-and-bone-man-i";
    if (stage >= STAGE_STARTED) {
      if (!isVinegarAsked(player)) {
        player.setAttribute(VINEGAR_ASKED_ATTRIBUTE, 1);
        return "getting-the-vinegar";
      }
      return "getting-the-vinegar-need-more-vinegar";
    }
    return null; // "Fortunato" default: standard-dialogue-before-starting-...
  }

  function handleDialogueChoice(event) {
    if (event.npcId !== ODD_OLD_MAN_NPC_ID) return;
    if (quest.getStage(event.player) !== 0) return;
    if (event.option === "No") event.player.setAttribute(DECLINED_ATTRIBUTE, 1);
  }

  function handleStartHook(event) {
    if (event.npcId !== ODD_OLD_MAN_NPC_ID || event.hook !== START_HOOK) return;
    if (quest.getStage(event.player) !== 0) return;
    // A fresh start also clears side-state left by a test reset.
    for (const attribute of [DECLINED_ATTRIBUTE, HANDED_ATTRIBUTE, VINEGAR_ASKED_ATTRIBUTE, BOILER_ATTRIBUTE]) {
      event.player.setAttribute(attribute, 0);
    }
    quest.setStage(event.player, STAGE_STARTED);
  }

  function skippedBoneBit(text) {
    for (const [prefix, bit] of WISH_LIST_LINE_PREFIXES) {
      if (text.startsWith(prefix)) return bit;
    }
    return undefined;
  }

  /** Skip the wish-list block (need line, hint, Sack mumble) for handed-in bones. */
  function handleDialogueLine(event) {
    if (event.npcId !== ODD_OLD_MAN_NPC_ID) return;
    const { player, text } = event;
    const pending = wishListSkips.get(player);
    if (pending !== undefined) {
      if (text === "Mumblemumble") {
        wishListSkips.delete(player);
        event.skip = true;
        return;
      }
      if (skippedBoneBit(text) === pending) {
        event.skip = true;
        return;
      }
      wishListSkips.delete(player);
    }
    const bit = skippedBoneBit(text);
    if (bit !== undefined && hasHanded(player, bit)) {
      event.skip = true;
      wishListSkips.set(player, bit);
      return;
    }
    if (HAND_IN_LINES.has(text)) handInCleanedBones(player);
  }

  function openWineShop(player) {
    const open = () => {
      if (player.isRegistered?.() === false) return;
      ShopManager.open(player, WINE_SHOP_ID, true);
    };
    if (!CountdownTask || !TaskManager) {
      open();
      return;
    }
    // The dialogue runtime sends its interface removal right after the action.
    TaskManager.submit(new CountdownTask(player, 1, open));
  }

  function handleDialogueAction(event) {
    const { player, npcId, stepId } = event;
    if (npcId === ODD_OLD_MAN_NPC_ID && stepId === COMPLETE_ACTION_ID) {
      event.handled = true;
      event.end = true;
      if (allBonesHandedIn(player) && !quest.isComplete(player)) quest.complete(player);
      return;
    }
    if (npcId === FORTUNATO_NPC_ID && WINE_SHOP_ACTION_IDS.has(stepId)) {
      event.handled = true;
      event.end = true;
      openWineShop(player);
    }
  }

  // ==========================================================================
  // Vinegar and pot-boiler
  // ==========================================================================

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const jugOnPot =
      (usedItemId === JUG_OF_VINEGAR_ITEM_ID && usedWithItemId === POT_ITEM_ID) ||
      (usedWithItemId === JUG_OF_VINEGAR_ITEM_ID && usedItemId === POT_ITEM_ID);
    if (jugOnPot) {
      event.handled = true;
      player.getInventory().deleteNumber(JUG_OF_VINEGAR_ITEM_ID, 1);
      player.getInventory().deleteNumber(POT_ITEM_ID, 1);
      player.getInventory().adds(POT_OF_VINEGAR_ITEM_ID, 1);
      return;
    }
    const bone = RAW_BONE_BY_ITEM.get(usedItemId) ?? RAW_BONE_BY_ITEM.get(usedWithItemId);
    const withPotOfVinegar =
      usedItemId === POT_OF_VINEGAR_ITEM_ID || usedWithItemId === POT_OF_VINEGAR_ITEM_ID;
    if (!bone || !withPotOfVinegar) return;
    event.handled = true;
    player.getInventory().deleteNumber(bone.raw, 1);
    player.getInventory().deleteNumber(POT_OF_VINEGAR_ITEM_ID, 1);
    player.getInventory().adds(bone.vinegar, 1);
  }

  function getBoiler(player) {
    let boiler = boilerStates.get(player);
    if (!boiler) {
      boiler = { state: BOILER_EMPTY, bone: null };
      boilerStates.set(player, boiler);
    }
    return boiler;
  }

  function showBoiler(player, state) {
    getBoiler(player).state = state;
    player.getPacketSender().sendVarbit(POT_BOILER_VARBIT, state);
    player
      .getPacketSender()
      .sendObject(new GameObject(POT_BOILER_BASE_OBJECT_ID, POT_BOILER_TILE, 10, 0, null));
  }

  function finishBoil(player) {
    if (getBoiler(player).state !== BOILER_LIT) return;
    showBoiler(player, BOILER_READY);
  }

  function scheduleBoil(player) {
    if (!CountdownTask || !TaskManager) {
      finishBoil(player);
      return;
    }
    TaskManager.submit(
      new CountdownTask(player, BOIL_TICKS, () => {
        if (player.isRegistered?.() === false) return;
        finishBoil(player);
      })
    );
  }

  function isPotBoiler(event) {
    const definition = ObjectDefinition.forPlayer(event.objectId, event.player);
    const objectId = definition?.id ?? event.objectId;
    return objectId === POT_BOILER_BASE_OBJECT_ID || POT_BOILER_STATE_OBJECT_IDS.has(objectId);
  }

  function isBurnableLogs(itemId) {
    const name = String(ItemDefinition.forId(itemId)?.getName?.() ?? "");
    return /\blogs$/i.test(name) && !/pyre/i.test(name);
  }

  function loadVinegarBone(event, bone) {
    if (!isPotBoiler(event)) return;
    const { player, itemId } = event;
    if (itemId !== bone.vinegar) return;
    if (player.getInventory().getAmount(itemId) <= 0) return;
    const boiler = getBoiler(player);
    event.handled = true;
    if (boiler.state === BOILER_EMPTY) {
      player.sendMessage("You need to add some logs to the pot-boiler first.");
      return;
    }
    if (boiler.state !== BOILER_LOGS) {
      player.sendMessage("There is already a pot in the pot-boiler.");
      return;
    }
    player.getInventory().deleteNumber(itemId, 1);
    boiler.bone = bone;
    player.setAttribute(BOILER_ATTRIBUTE, bone.vinegar);
    showBoiler(player, BOILER_BONE);
  }

  function handleLoadSharedVinegarBone({ event, bone }) {
    if (!event || !bone || !Number.isInteger(bone.vinegar) || !Number.isInteger(bone.cleaned)) return;
    loadVinegarBone(event, bone);
  }

  function handleItemOnObject(event) {
    if (!isPotBoiler(event)) return;
    const { player, itemId } = event;
    const boiler = getBoiler(player);
    if (isBurnableLogs(itemId)) {
      event.handled = true;
      if (boiler.state === BOILER_EMPTY) {
        player.getInventory().deleteNumber(itemId, 1);
        showBoiler(player, BOILER_LOGS);
      } else if (boiler.state === BOILER_LOGS) {
        player.sendMessage("There are already logs in the pot-boiler.");
      } else {
        player.sendMessage("There is already a pot in the pot-boiler.");
      }
      return;
    }
    const bone = VINEGAR_BONE_BY_ITEM.get(itemId);
    if (bone) {
      loadVinegarBone(event, bone);
      return;
    }
    if (itemId === TINDERBOX_ITEM_ID) {
      event.handled = true;
      if (boiler.state === BOILER_EMPTY || boiler.state === BOILER_LOGS) {
        player.sendMessage("You need to put a bone in the pot-boiler first.");
        return;
      }
      if (boiler.state === BOILER_BONE) {
        player.performAnimation(LIGHT_FIRE_ANIMATION);
        showBoiler(player, BOILER_LIT);
        scheduleBoil(player);
      }
    }
  }

  function handleRemovePot(event) {
    const { player } = event;
    const boiler = getBoiler(player);
    if (boiler.state !== BOILER_BONE || !boiler.bone) return;
    if (player.getInventory().getFreeSlots() <= 0) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    const bone = boiler.bone;
    boiler.bone = null;
    player.setAttribute(BOILER_ATTRIBUTE, 0);
    showBoiler(player, BOILER_EMPTY);
    player.getInventory().adds(bone.vinegar, 1);
  }

  function handleRemoveBone(event) {
    const { player } = event;
    const boiler = getBoiler(player);
    if (boiler.state !== BOILER_READY || !boiler.bone) return;
    if (player.getInventory().getFreeSlots() <= 0) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    const bone = boiler.bone;
    boiler.bone = null;
    player.setAttribute(BOILER_ATTRIBUTE, 0);
    showBoiler(player, BOILER_EMPTY);
    player.getInventory().adds(bone.cleaned, 1);
  }

  function handleReadWishList({ player }) {
    const text = quest.getStage(player) >= STAGE_COMPLETE ? WISH_LIST_AFTER : WISH_LIST_BEFORE;
    const builder = new DialogueChainBuilder();
    builder.add(new StatementDialogue(0, text));
    builder.add(new EndDialogue(1));
    player.getDialogueManager().startDialogues(builder);
  }

  // ==========================================================================
  // Bones from monsters
  // ==========================================================================

  function handleNpcDeath(event) {
    const { killer, npc, npcId } = event;
    if (!killer?.isPlayer?.() || !npc) return;
    if (quest.getStage(killer) !== STAGE_STARTED) return;
    const bone = BONE_BY_MONSTER_NAME.get(NpcDefinition.forId(npcId)?.getName?.());
    if (!bone || hasHanded(killer, bone.bit)) return;
    const location = npc.getLocation?.() ?? npc.getSpawnLocation?.();
    if (!location) return;
    api.getItemOnGroundManager().registerLocation(killer, new Item(bone.raw, 1), location);
  }

  function handleLogin({ player }) {
    // The boiler state does not survive a relog; hand the bone in vinegar back.
    const pending = Number(player.getAttribute(BOILER_ATTRIBUTE)) || 0;
    const boiler = getBoiler(player);
    boiler.bone = null;
    showBoiler(player, BOILER_EMPTY);
    if (pending > 0 && player.getInventory().getFreeSlots() > 0) {
      player.setAttribute(BOILER_ATTRIBUTE, 0);
      player.getInventory().adds(pending, 1);
    }
    refreshQuestList(player);
  }

  // ==========================================================================
  // Journal and reward
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped the Odd Old Man complete his collection of bones</str>",
        "<str>for the museum displays in Silvarea.</str>",
        "<str>I cleaned each bone in a pot of vinegar before handing it over.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_STARTED) {
      const lines = [
        "The <col=800000>Odd Old Man</col> in Silvarea asked me to collect",
        "fresh bones for the museum, cleaning them in a pot of vinegar.",
        "",
      ];
      for (const bone of BONES) {
        lines.push(
          hasHanded(player, bone.bit)
            ? `<str>${bone.label} bone</str>`
            : `I still need to bring him a <col=800000>${bone.label} bone</col>.`
        );
      }
      return lines;
    }
    return [
      "I can start this quest by speaking to the",
      "<col=800000>Odd Old Man</col> at the bone pit in <col=800000>Silvarea</col>,",
      "north-east of Varrock.",
      "",
      "There aren't any requirements for this quest.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.COOKING, 500);
    player.getSkillManager().addExperiences(Skill.PRAYER, 500);
  }

  api.persistAttribute(HANDED_ATTRIBUTE);
  api.persistAttribute(DECLINED_ATTRIBUTE);
  api.persistAttribute(VINEGAR_ASKED_ATTRIBUTE);
  api.persistAttribute(BOILER_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "rag_and_bone_man_i",
    name: "Rag and Bone Man I",
    varpId: VARP_RAG_AND_BONE_MAN_I,
    varpValue: wireValue,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.COOKING.getIndex(), amount: 500, label: "Cooking" },
      { skillId: Skill.PRAYER.getIndex(), amount: 500, label: "Prayer" },
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onCustomEvent(LOAD_SHARED_VINEGAR_BONE_EVENT, handleLoadSharedVinegarBone);
  api.onObjectInteraction("Pot-boiler", {
    "Remove-Pot": handleRemovePot,
    "Remove-Bone": handleRemoveBone,
  });
  api.onObjectInteraction("Wish-list", { Read: handleReadWishList });
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
};
