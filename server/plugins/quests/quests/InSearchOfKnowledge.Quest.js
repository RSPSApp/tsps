/**
 * In Search of Knowledge (members miniquest, Forthos Dungeon).
 *
 * The monk Brother Aimeri (8704 injured / 8705 healed, one 8717 spawn whose transform
 * varbit 8393 is the feeding counter) is fed five pieces of cooked food, then starts the
 * miniquest. The three musty bookshelves (34847 sun, 34848 moon, 34849 temple, 34850
 * empty) hand out the tomes; pages drop from the dungeon's monsters and are used on
 * their tome (varbits 8399-8401 count 0-4). Completed tomes are given to Logosia (7044),
 * who hands over the lamp of knowledge (23516, 10,000 XP in a skill level 40+).
 *
 * State comes from the cache's Forthos varp 2231:
 *   8403 hosdun_knowledge_search  1 started, 2 tomes handed in, 3 complete
 *   8393 hosdun_aimeri_status     0-4 injured, 5 healed
 *   8399/8400/8401                sun/moon/temple pages, 0-4
 *   8404/8405/8406                moon/sun/temple tome returned
 *  10245 hosdun_page_prevention  1 stop receiving pages from dungeon drops
 * The varbits are mirrored from saved attributes so page/tome/fed progress survives a
 * relog (PacketSender's varp map is per session); the quest stage itself is persisted by
 * registerQuest. Behaviour follows the OSRS Wiki and Quick guide; the wording is from
 * Transcript:In Search of Knowledge and Transcript:Brother Aimeri, checked against
 * rsprox recording 1702 (rev 226).
 *
 * Not built: the tomes' Read option. Check and the page counters are implemented; the
 * Wiki tome text is not. The food filter is ours: the Wiki asks for cooked fish, meat or
 * vegetables, while the capture only exercises manta rays. The runtime's completion chat
 * line and the miniquest counter (14162) belong in QuestRuntime, a separate change.
 */
module.exports = function registerInSearchOfKnowledgeQuest(api) {
  const {
    Animation, DialogueChainBuilder, NpcDialogue,
    ItemIdentifiers: Items, NpcIdentifiers: Npcs, ObjectIdentifiers: Objects,
  } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  const VARBIT_STAGE = 8403;
  const VARBIT_AIMERI = 8393;
  const VARBIT_PAGE_PREVENTION = 10245;

  const STAGE_STARTED = 1;
  const STAGE_HANDED_IN = 2;
  const STAGE_COMPLETE = 3;
  const AIMERI_FED = 5;
  const PAGES_REQUIRED = 4;

  const SUN_PAGE = Items.TATTERED_SUN_PAGE; // 23512
  const MOON_PAGE = Items.TATTERED_MOON_PAGE; // 23510
  const TEMPLE_PAGE = Items.TATTERED_TEMPLE_PAGE; // 23514
  const SUN_TOME = Items.TOME_OF_THE_SUN; // 23506
  const MOON_TOME = Items.TOME_OF_THE_MOON; // 23504
  const TEMPLE_TOME = Items.TOME_OF_THE_TEMPLE; // 23508
  const LAMP_OF_KNOWLEDGE = Items.LAMP_OF_KNOWLEDGE; // 23516
  const COINS = Items.COINS; // 995

  /**
   * The cache's transformed Aimeri ids. Interaction events carry the resolved variant,
   * so both are accepted; 8717 itself is the nameless spawn.
   */
  const AIMERI_INJURED = Npcs.BROTHER_AIMERI; // 8704
  const AIMERI_HEALED = Npcs.BROTHER_AIMERI_2; // 8705
  const LOGOSIA = Npcs.LOGOSIA; // 7044

  const SUN_BOOKCASE = Objects.MUSTY_BOOKSHELF; // 34847
  const MOON_BOOKCASE = Objects.MUSTY_BOOKSHELF_2; // 34848
  const TEMPLE_BOOKCASE = Objects.MUSTY_BOOKSHELF_3; // 34849
  const EMPTY_BOOKCASE = Objects.MUSTY_BOOKSHELF_4; // 34850

  const AIMERI_PAGE = "Brother Aimeri";
  const LOGOSIA_PAGE = "Logosia";

  const PAGES_ATTRIBUTE = "in-search-of-knowledge:pages";
  const RETURNED_ATTRIBUTE = "in-search-of-knowledge:tomes-returned";
  const FED_ATTRIBUTE = "in-search-of-knowledge:aimeri-fed";
  const PREVENTION_ATTRIBUTE = "in-search-of-knowledge:page-prevention";
  const PAGES_DEFAULT = Object.freeze({ sun: 0, moon: 0, temple: 0 });

  const LAMP_MIN_LEVEL = 40;
  const LAMP_XP = 10_000;
  const PAGE_VALUE = 1_000;
  const MAX_STACK_AMOUNT = 0x7fffffff;

  const EAT_ANIMATION = 829; // human_eat
  /** Captured: Aimeri's bar gains 6 of its 30-wide default headbar per feed. */
  const FEED_HEADBAR = 0;
  const FEED_HEADBAR_WIDTH = 30;
  const FEED_HEADBAR_STEP = 6;
  /** The Forthos Dungeon zone from the Quest Helper route (surface reds are outside it). */
  const FORTHOS_BOUNDS = Object.freeze({ minX: 1792, maxX: 1856, minY: 9880, maxY: 9983, z: 0 });

  /** Logosia's generated using-a-forthos-tome-on-logosia conditions and messages. */
  const HANDIN_CONDITION_NOT_ALL = "PtKwvk";
  const HANDIN_CONDITION_ONE_OTHER = "zmZYKl";
  const HANDIN_CONDITION_TWO_OTHER = "CLmQgd";
  const HANDIN_CONDITION_STILL_NOT_ALL = "phoFZJ";
  const HANDIN_CONDITION_ALL = "jgDFoB";
  const HANDIN_MESSAGE_SHOW = "5vCu67";
  const HANDIN_MESSAGE_ONE = "tSjXLd";
  const HANDIN_MESSAGE_TWO = "6L2i6E";
  const HANDIN_MESSAGE_LAMP = "z_El-S";
  const HANDIN_CONDITIONS = new Set([
    HANDIN_CONDITION_NOT_ALL, HANDIN_CONDITION_ONE_OTHER, HANDIN_CONDITION_TWO_OTHER,
    HANDIN_CONDITION_STILL_NOT_ALL, HANDIN_CONDITION_ALL,
  ]);

  /**
   * Aimeri accepts cooked fish, meat and vegetables (Wiki). The cache only exposes
   * an Eat action, so classify by the item name: sweets, cakes, bread, fruit and
   * drinks are not in these families.
   */
  const FISH_FOOD_NAME = /fish|shrimp|sardine|anchov|herring|mackerel|trout|cod|pike|salmon|tuna|lobster|bass|swordfish|monkfish|shark|turtle|manta|angler|crab|eel|karambwan|jubbly|bluefin|bream|haddock|halibut|marlin|squid|paddlefish|loach|carp|krill|roe|caviar|fillet|yellowfin|brawk|pysk|leckish|kyren|mycil|roqed|suphi/i;
  const MEAT_FOOD_NAME = /meat|chicken|rabbit|kebbit|graahk|kyatt|larupia|chompy|oomlie|beef|steak|sausage|bacon|ham|turkey|carne|kebab|jerky|snail|frog|locust|antelope|lizard|fox|shish|bird|\bbat\b|worm|spider|grub|toad|snake/i;
  const VEGETABLE_FOOD_NAME = /cabbage|onion|potato|tomato|sweetcorn|corn|pumpkin|mushroom|seaweed|veg|vegetable|chilli|chili|spinach|eggplant|avocado|carrot|pepper|beet|artichoke|asparagus|broccoli|cauliflower|celery|cucumber|leek|lettuce|parsnip|\bpeas?\b|radish|turnip|zucchini|\btom\b/i;
  /** Stews, curries and pies whose name does not carry the ingredient word. */
  const WHOLE_DISH_FOOD_NAMES = new Set([
    "Admiral pie", "Botanical pie", "Curry", "Garden pie", "Stew", "Wild pie",
  ]);

  const TOMES = Object.freeze([
    {
      kind: "sun", name: "Tome of the Sun", tome: SUN_TOME, page: SUN_PAGE,
      pagesVarbit: 8399, returnedVarbit: 8405, bookshelf: SUN_BOOKCASE,
      found: "You find a tome with a symbol of the sun.",
    },
    {
      kind: "moon", name: "Tome of the Moon", tome: MOON_TOME, page: MOON_PAGE,
      pagesVarbit: 8400, returnedVarbit: 8404, bookshelf: MOON_BOOKCASE,
      found: "You find a tome with a symbol of the moon.",
    },
    {
      kind: "temple", name: "Tome of the Temple", tome: TEMPLE_TOME, page: TEMPLE_PAGE,
      pagesVarbit: 8401, returnedVarbit: 8406, bookshelf: TEMPLE_BOOKCASE,
      found: "You find a tome with a strange symbol on it.",
    },
  ]);
  const TOME_BY_ID = new Map(TOMES.map((entry) => [entry.tome, entry]));
  const TOME_BY_PAGE = new Map(TOMES.map((entry) => [entry.page, entry]));
  const SHELF_BY_ID = new Map(TOMES.map((entry) => [entry.bookshelf, entry]));
  const PAGE_IDS = new Set(TOMES.map((entry) => entry.page));

  const ARTEFACT_VARIANTS = new Map([
    [SUN_PAGE, "showing-temple-artifacts-tattered-sun-page"],
    [MOON_PAGE, "showing-temple-artifacts-tattered-moon-page"],
    [TEMPLE_PAGE, "showing-temple-artifacts-tattered-temple-page"],
    [SUN_TOME, "showing-temple-artifacts-tome-of-the-sun"],
    [MOON_TOME, "showing-temple-artifacts-tome-of-the-moon"],
    [TEMPLE_TOME, "showing-temple-artifacts-tome-of-the-temple"],
  ]);

  /** The tome whose "showing" transcript is playing, for its page-count condition. */
  const shownTome = new WeakMap();
  /** Logosia's hand-in in progress: used tome and the boxes waiting to be continued. */
  const pendingHandIn = new WeakMap();

  let quest;

  const isAimeri = (npcId) => npcId === AIMERI_INJURED || npcId === AIMERI_HEALED;
  const inventory = (player) => player.getInventory();
  const held = (player, itemId) => inventory(player).getAmount(itemId) > 0;
  const banked = (player, itemId) => {
    const banks = player.getBanks?.() ?? (player.getBank ? [player.getBank()] : []);
    return banks.some((bank) => Number(bank?.getAmount?.(itemId) ?? 0) > 0);
  };
  const owns = (player, itemId) => held(player, itemId) || banked(player, itemId);

  function numberAttribute(player, key) {
    const value = Number(player.getAttribute(key));
    return Number.isFinite(value) ? value : 0;
  }

  function readCounts(player, key) {
    const value = player.getAttribute(key);
    return {
      sun: Number(value?.sun) || 0,
      moon: Number(value?.moon) || 0,
      temple: Number(value?.temple) || 0,
    };
  }

  const pagesOf = (player) => readCounts(player, PAGES_ATTRIBUTE);
  const returnedOf = (player) => readCounts(player, RETURNED_ATTRIBUTE);
  const fedOf = (player) => numberAttribute(player, FED_ATTRIBUTE);
  const preventionOf = (player) => numberAttribute(player, PREVENTION_ATTRIBUTE);

  function setPageCount(player, entry, value) {
    const pages = pagesOf(player);
    pages[entry.kind] = value;
    player.setAttribute(PAGES_ATTRIBUTE, pages);
    player.getPacketSender().sendVarbit(entry.pagesVarbit, value);
  }

  function markReturned(player, entry) {
    const returned = returnedOf(player);
    returned[entry.kind] = 1;
    player.setAttribute(RETURNED_ATTRIBUTE, returned);
    player.getPacketSender().sendVarbit(entry.returnedVarbit, 1);
  }

  function setFed(player, value) {
    player.setAttribute(FED_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_AIMERI, value);
  }

  function setPrevention(player, value) {
    player.setAttribute(PREVENTION_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_PAGE_PREVENTION, value);
  }

  const returnedCount = (player) => {
    const returned = returnedOf(player);
    return TOMES.filter((entry) => returned[entry.kind] === 1).length;
  };

  /** The varbits the client's Forthos NPC/object transforms and dialogue read. */
  function syncVars({ player }) {
    if (!player?.getPacketSender) return;
    const sender = player.getPacketSender();
    const pages = pagesOf(player);
    const returned = returnedOf(player);
    for (const entry of TOMES) {
      sender.sendVarbit(entry.pagesVarbit, pages[entry.kind]);
      sender.sendVarbit(entry.returnedVarbit, returned[entry.kind]);
    }
    sender.sendVarbit(VARBIT_AIMERI, fedOf(player));
    sender.sendVarbit(VARBIT_PAGE_PREVENTION, preventionOf(player));
  }

  // ==========================================================================
  // Dialogue selection and conditions
  // ==========================================================================

  function selectVariant({ npcId, player }) {
    if (isAimeri(npcId)) {
      const healed = npcId === AIMERI_HEALED || fedOf(player) >= AIMERI_FED;
      return { page: AIMERI_PAGE, variant: healed ? "healed" : "injured" };
    }
    if (npcId === LOGOSIA) {
      return {
        page: LOGOSIA_PAGE,
        variant: quest.isComplete(player)
          ? "standard-dialogue-if-the-player-has-completed-the-in-search-of-knowledge-miniquest"
          : "standard-dialogue-if-the-player-has-not-completed-the-in-search-of-knowledge-miniquest-the-dialogue-will-always-go-to-the-next-two-options-regardless-of-which-option-is-chosen",
      };
    }
    return null;
  }

  function hasFood(player) {
    return inventory(player).getItems().some((item) =>
      item && isAimeriFood(item.getId?.() ?? item.id));
  }

  /** An edible item in Aimeri's accepted families: cooked fish, meat or vegetables. */
  function isAimeriFood(itemId) {
    const definition = api.core.CacheDefinitions.getItem(itemId);
    if (!definition || !(definition.inventoryActions ?? []).includes("Eat")) return false;
    const name = String(definition.name ?? "");
    return WHOLE_DISH_FOOD_NAMES.has(name)
      || FISH_FOOD_NAME.test(name)
      || MEAT_FOOD_NAME.test(name)
      || VEGETABLE_FOOD_NAME.test(name);
  }

  /** Completed, unreturned tomes still carried: what Logosia's hand-in can add to this one. */
  function otherCompletedTomes(player) {
    const pages = pagesOf(player);
    const returned = returnedOf(player);
    return TOMES.filter((entry) => pages[entry.kind] >= PAGES_REQUIRED
      && returned[entry.kind] !== 1 && held(player, entry.tome));
  }

  function handInTome(player, entry) {
    if (!entry || returnedOf(player)[entry.kind] === 1) return false;
    if (!inventory(player).deleteNumber(entry.tome, 1)) return false;
    markReturned(player, entry);
    return true;
  }

  /**
   * The capture hands a tome over when the player continues past its objectbox, not when
   * the box appears. Conditions are resolved after that continue, so settle there.
   */
  function settlePendingHandIn(player) {
    const pending = pendingHandIn.get(player);
    if (!pending) return;
    if (pending.usedTome) {
      handInTome(player, pending.usedTome);
      pending.usedTome = null;
    }
    if (pending.singleOther) {
      handInTome(player, pending.singleOther);
      pending.singleOther = null;
      if (quest.getStage(player) < STAGE_HANDED_IN) quest.setStage(player, STAGE_HANDED_IN);
    }
    if (pending.multiOthers?.length) {
      for (const entry of pending.multiOthers) handInTome(player, entry);
      pending.multiOthers = null;
      if (quest.getStage(player) < STAGE_HANDED_IN) quest.setStage(player, STAGE_HANDED_IN);
    }
  }

  function answerCondition({ npcId, player, text, stepId }) {
    const lower = String(text ?? "").toLowerCase();
    if (isAimeri(npcId)) {
      if (lower.includes("if the player has food in inventory")) return hasFood(player);
      if (lower.includes("if the player has no food in inventory")) return !hasFood(player);
      if (lower.includes("if player uses anything other than food on him")) return false;
      if (lower.includes("if the altar has been cursed")) return false;
      if (lower.includes("if the player has received a temple key")) return false;
      if (lower.includes("if the player has a pristine spider silk")) return false;
      if (lower.includes("if the tome is missing pages")) {
        const entry = shownTome.get(player);
        return !!entry && pagesOf(player)[entry.kind] < PAGES_REQUIRED;
      }
      if (lower.includes("if the final temple page has been added to the tome")) {
        const entry = shownTome.get(player);
        return !!entry && pagesOf(player)[entry.kind] >= PAGES_REQUIRED;
      }
      return null;
    }
    if (npcId === LOGOSIA) {
      if (HANDIN_CONDITIONS.has(stepId)) {
        settlePendingHandIn(player);
        const returned = returnedCount(player);
        if (stepId === HANDIN_CONDITION_NOT_ALL || stepId === HANDIN_CONDITION_STILL_NOT_ALL) {
          return returned < TOMES.length;
        }
        if (stepId === HANDIN_CONDITION_ONE_OTHER) return otherCompletedTomes(player).length === 1;
        if (stepId === HANDIN_CONDITION_TWO_OTHER) return otherCompletedTomes(player).length === 2;
        if (stepId === HANDIN_CONDITION_ALL) return returned >= TOMES.length;
      }
      if (lower.includes("if the player is currently looking for more tome pages")) {
        return preventionOf(player) === 0;
      }
      if (lower.includes("if the player is currently not looking for more tome pages")) {
        return preventionOf(player) === 1;
      }
      return null;
    }
    return null;
  }

  /**
   * The generated two-other branch ends in a "jump below" whose target the dump lost;
   * the runtime resolves it to end, which skips Logosia's reward. Strip the jumps and let
   * the sibling conditions run in order. The extra "Again..." line is not in the capture,
   * so settle the other tomes there and skip it.
   */
  function stripHandInJumps(steps) {
    return (steps ?? [])
      .filter((step) => step?.type !== "jump")
      .map((step) => (Array.isArray(step?.steps) ? { ...step, steps: stripHandInJumps(step.steps) } : step));
  }

  function handleLine(event) {
    if (isAimeri(event.npcId)) {
      if (event.text !== "I'll keep my eyes open.") return;
      const { player } = event;
      if (quest.getStage(player) !== 0 || fedOf(player) < AIMERI_FED) return;
      quest.setStage(player, STAGE_STARTED);
      return;
    }
    if (event.npcId === LOGOSIA && event.text === "Again, your donation to the library is appreciated") {
      const pending = pendingHandIn.get(event.player);
      if (pending?.multiOthers?.length) {
        settlePendingHandIn(event.player);
        event.skip = true;
      }
    }
  }

  function handleAction(event) {
    if (event.npcId !== LOGOSIA || !event.player) return;
    const { player, stepId } = event;
    const pending = pendingHandIn.get(player);

    if (pending) {
      if (stepId === HANDIN_MESSAGE_SHOW) {
        event.box = { items: [pending.usedTome.tome] };
        event.handled = true;
        return;
      }
      if (stepId === HANDIN_MESSAGE_ONE) {
        const other = otherCompletedTomes(player)[0];
        if (other) {
          pending.singleOther = other;
          event.box = { items: [other.tome] };
          event.handled = true;
        }
        return;
      }
      if (stepId === HANDIN_MESSAGE_TWO) {
        const others = otherCompletedTomes(player).slice(0, 2);
        if (others.length === 2) {
          pending.multiOthers = others;
          event.box = { items: [others[0].tome, others[1].tome] };
          event.handled = true;
        }
        return;
      }
      if (stepId === HANDIN_MESSAGE_LAMP) {
        if (returnedCount(player) >= TOMES.length && !quest.isComplete(player)) {
          if (quest.getStage(player) < STAGE_HANDED_IN) quest.setStage(player, STAGE_HANDED_IN);
          // Live has no completion jingle or scroll for this miniquest.
          quest.complete(player, { scroll: false });
        }
        event.box = { items: [LAMP_OF_KNOWLEDGE] };
        event.handled = true;
        pendingHandIn.delete(player);
        return;
      }
    }

    // WQyrhA is the "no longer receive pages" message inside the stop choice; XWXpa4
    // the "now receive pages" message inside the start choice.
    if (stepId === "WQyrhA") {
      setPrevention(player, 1);
      return;
    }
    if (stepId === "XWXpa4") setPrevention(player, 0);
  }

  // ==========================================================================
  // Aimeri: feeding and showing artefacts
  // ==========================================================================

  function say(player, npcId, text) {
    player.getDialogueManager().startDialogues(
      new DialogueChainBuilder().add(new NpcDialogue(0, npcId, text))
    );
  }

  function feedAimeri(player, itemId, slot, npc) {
    const fed = fedOf(player);
    if (fed >= AIMERI_FED) {
      say(player, AIMERI_HEALED, "No thanks, I'm not hungry anymore.");
      return;
    }
    const inv = inventory(player);
    if (slot >= 0 && inv.get(slot)?.getId?.() === itemId) inv.deleteAtSlot(slot, 1);
    else inv.deleteNumber(itemId, 1);
    const next = fed + 1;
    setFed(player, next);
    // Captured: Aimeri eats, his 30-wide headbar gains 6, and there is no chat line.
    npc?.performAnimation?.(new Animation(EAT_ANIMATION));
    npc?.showHeadbar?.(FEED_HEADBAR, {
      fill: Math.min(FEED_HEADBAR_WIDTH, next * FEED_HEADBAR_STEP),
      endFill: Math.min(FEED_HEADBAR_WIDTH, next * FEED_HEADBAR_STEP),
    });
    if (next >= AIMERI_FED) {
      say(player, AIMERI_HEALED, "Thanks for helping me. Is there anything you'd like to know about this temple? If you find anything in here, show it to me and I'll tell you what I know about it.");
    }
  }

  function useItemOnAimeri(event) {
    const { player, itemId } = event;
    if (!isAimeri(event.npcId) && event.definition?.getName?.() !== "Brother Aimeri") return;
    event.handled = true;
    const healed = event.npcId === AIMERI_HEALED || fedOf(player) >= AIMERI_FED;
    if (!healed) {
      if (isAimeriFood(itemId)) {
        feedAimeri(player, itemId, event.slot, event.target);
        return;
      }
      say(player, AIMERI_INJURED, "No thanks. I would rather eat fish, meat or vegetables.");
      return;
    }
    if (isAimeriFood(itemId)) {
      say(player, AIMERI_HEALED, "No thanks, I'm not hungry anymore.");
      return;
    }
    const variant = ARTEFACT_VARIANTS.get(itemId);
    if (variant) {
      shownTome.set(player, TOME_BY_ID.get(itemId) ?? null);
      startTranscript(api, player, event.npcId, AIMERI_PAGE, variant, undefined, event.target);
      return;
    }
    shownTome.delete(player);
    startTranscript(api, player, event.npcId, AIMERI_PAGE,
      "showing-temple-artifacts-using-an-unrelated-item", undefined, event.target);
  }

  // ==========================================================================
  // Musty bookshelves and the tomes
  // ==========================================================================

  function searchBookshelf(event) {
    const { player, objectId } = event;
    if (objectId === EMPTY_BOOKCASE) {
      event.handled = true;
      player.sendMessage("You search the bookshelf but find nothing useful.");
      return;
    }
    const entry = SHELF_BY_ID.get(objectId);
    if (!entry) return;
    event.handled = true;
    if (returnedOf(player)[entry.kind] === 1) {
      player.sendMessage("Logosia already has that tome.");
      return;
    }
    if (owns(player, entry.tome)) {
      player.sendMessage("You already have that tome.");
      return;
    }
    if (inventory(player).getFreeSlots() < 1) {
      inventory(player).full();
      return;
    }
    inventory(player).adds(entry.tome, 1);
    player.sendMessage(entry.found);
  }

  function usePageOnTome(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const page = TOME_BY_PAGE.get(usedItemId) ?? TOME_BY_PAGE.get(usedWithItemId);
    const tome = TOME_BY_ID.get(usedItemId) ?? TOME_BY_ID.get(usedWithItemId);
    if (!page || !tome) return;
    event.handled = true;
    if (page !== tome) {
      player.sendMessage(`That page does not belong in the ${tome.name}.`);
      return;
    }
    const current = pagesOf(player)[tome.kind];
    if (current >= PAGES_REQUIRED) {
      player.sendMessage(`The ${tome.name} already has all of its pages.`);
      return;
    }
    if (!held(player, tome.page)) return;
    inventory(player).deleteNumber(tome.page, 1);
    const next = current + 1;
    setPageCount(player, tome, next);
    const kind = tome.kind;
    player.sendMessage(next >= PAGES_REQUIRED
      ? `You add the final ${kind} page to the ${tome.name}. Perhaps Logosia would be interested in this?`
      : `You add a missing ${kind} page to the ${tome.name}.`);
  }

  function checkTome(event) {
    const entry = TOME_BY_ID.get(event.itemId);
    if (!entry) return;
    event.handled = true;
    const missing = PAGES_REQUIRED - pagesOf(event.player)[entry.kind];
    if (missing === 0) {
      event.player.sendMessage("There are 0 pages missing. Perhaps Logosia would be interested in this?");
    } else if (missing === 1) {
      event.player.sendMessage("There is 1 page missing.");
    } else {
      event.player.sendMessage(`There are ${missing} pages missing.`);
    }
  }

  // ==========================================================================
  // Logosia: the tome hand-in and spare-page trade
  // ==========================================================================

  /**
   * The item-on-NPC entry point: play the generated hand-in variant and answer its
   * conditions from the inventory/returned varbits. The capture's objectboxes are set on
   * the variant's message steps in handleAction.
   */
  function startHandIn(player, usedTomeId, npc) {
    if (quest.isComplete(player)) {
      player.sendMessage("Logosia already has the tomes.");
      return;
    }
    if (quest.getStage(player) < STAGE_STARTED) {
      player.sendMessage("You should speak to Brother Aimeri before donating the tomes.");
      return;
    }
    const used = TOME_BY_ID.get(usedTomeId);
    if (!used) return;
    if (pagesOf(player)[used.kind] < PAGES_REQUIRED) {
      player.sendMessage(`The ${used.name} is missing pages. You should find them before showing it to Logosia.`);
      return;
    }
    if (!held(player, used.tome) || returnedOf(player)[used.kind] === 1) {
      player.sendMessage("Logosia already has that tome.");
      return;
    }
    pendingHandIn.set(player, { usedTome: used, singleOther: null, multiOthers: null });
    const played = startTranscript(api, player, LOGOSIA, LOGOSIA_PAGE,
      "using-a-forthos-tome-on-logosia", stripHandInJumps, npc);
    if (!played) {
      pendingHandIn.delete(player);
      player.sendMessage("Logosia is not interested in that tome.");
    }
  }

  function sellPages(player, itemId) {
    const entry = TOMES.find((tome) => tome.page === itemId);
    if (!entry || !quest.isComplete(player)) return;
    const amount = inventory(player).getAmount(itemId);
    if (amount < 1) return;
    const payout = amount * PAGE_VALUE;
    // A capped coin stack would clamp adds() after the pages were already deleted.
    // Refuse first and keep the pages; a sale always frees the slot for a new stack.
    const coins = new api.core.Item(COINS, payout);
    const hasCoinStack = inventory(player).getAmount(COINS) > 0;
    if (payout > MAX_STACK_AMOUNT
      || (hasCoinStack && inventory(player).getAddableAmount(coins) < payout)) {
      player.sendMessage("You do not have enough room to carry all of those coins.");
      return;
    }
    inventory(player).deleteNumber(itemId, amount);
    inventory(player).adds(COINS, payout);
    player.sendMessage(`You sell ${amount} ${entry.kind} page${amount === 1 ? "" : "s"} to Logosia for ${payout.toLocaleString("en-US")} coins.`);
  }

  function useItemOnLogosia(event) {
    const { player, itemId } = event;
    if (event.npcId !== LOGOSIA) return;
    if (TOME_BY_ID.has(itemId)) {
      event.handled = true;
      startHandIn(player, itemId, event.target);
      return;
    }
    if (PAGE_IDS.has(itemId) && quest.isComplete(player)) {
      event.handled = true;
      sellPages(player, itemId);
    }
  }

  // ==========================================================================
  // Lamp of knowledge
  // ==========================================================================

  function rubLamp(event) {
    const { player, itemId } = event;
    if (itemId !== LAMP_OF_KNOWLEDGE) return false;
    event.handled = true;
    api.emitCustomEvent("xpreward:open", {
      player,
      minLevel: LAMP_MIN_LEVEL,
      title: "Choose the stat you wish to be advanced!",
      onConfirm: (skill, name) => {
        const manager = player.getSkillManager();
        const before = manager.getExperience(skill);
        manager.addExperience(skill, LAMP_XP, false);
        if (manager.getExperience(skill) === before) {
          player.sendMessage("You cannot gain experience in that skill right now.");
          return null;
        }
        const slot = player.getInventory().getSlotForItemId?.(itemId) ?? -1;
        if (slot >= 0) player.getInventory().deleteAtSlot(slot, 1);
        else player.getInventory().deleteNumber(itemId, 1);
        return `<col=0000ff>Your wish has been granted!</col> You have been awarded ${LAMP_XP.toLocaleString("en-GB")} ${name} experience!`;
      },
    });
    return true;
  }

  // ==========================================================================
  // Page drops after asking Logosia to stop them
  // ==========================================================================

  function inForthos(npc) {
    const at = npc?.getLocation?.();
    if (!at) return false;
    const x = at.getX?.() ?? at.x;
    const y = at.getY?.() ?? at.y;
    const z = at.getZ?.() ?? at.z ?? 0;
    return z === FORTHOS_BOUNDS.z
      && x >= FORTHOS_BOUNDS.minX && x <= FORTHOS_BOUNDS.maxX
      && y >= FORTHOS_BOUNDS.minY && y <= FORTHOS_BOUNDS.maxY;
  }

  function fewestPageEntry(player) {
    const pages = pagesOf(player);
    let best = TOMES[0];
    for (const entry of TOMES) {
      if (pages[entry.kind] < pages[best.kind]) best = entry;
    }
    return best;
  }

  /**
   * The imported tables roll the three pages independently and on surface red dragons.
   * The Wiki restricts them to Forthos kills, one page per kill, of the kind the player
   * has fewest of. The per-NPC rates remain the dumper's concern.
   */
  function filterPageDrops(event) {
    if (!event?.player || !Array.isArray(event.drops)) return;
    const pageDrops = event.drops.filter((drop) => PAGE_IDS.has(drop?.itemId));
    if (pageDrops.length === 0) return;
    if (preventionOf(event.player) === 1 || !inForthos(event.npc)) {
      for (let index = event.drops.length - 1; index >= 0; index--) {
        if (PAGE_IDS.has(event.drops[index]?.itemId)) event.drops.splice(index, 1);
      }
      return;
    }
    const keep = pageDrops[0];
    const target = fewestPageEntry(event.player);
    keep.itemId = target.page;
    keep.amount = 1;
    let kept = false;
    for (let index = event.drops.length - 1; index >= 0; index--) {
      if (!PAGE_IDS.has(event.drops[index]?.itemId)) continue;
      if (!kept && event.drops[index] === keep) {
        kept = true;
        continue;
      }
      event.drops.splice(index, 1);
    }
  }

  // ==========================================================================
  // Journal and registration
  // ==========================================================================

  function buildJournal(player) {
    if (quest.isComplete(player)) {
      return [
        "<str>I fed Brother Aimeri and recovered the three tomes from</str>",
        "<str>the Forthos Dungeon.</str>",
        "<str>I gave the completed tomes to Logosia in the Arceuus Library.</str>",
        "",
        "<col=ff0000>MINIQUEST COMPLETE!</col>",
      ];
    }
    if (quest.getStage(player) < STAGE_STARTED) {
      return [
        "I can start this miniquest by talking to",
        "<col=800000>Brother Aimeri</col> in the <col=800000>Forthos Dungeon</col>,",
        "beneath Hosidius.",
      ];
    }
    const lines = [];
    const pages = pagesOf(player);
    if (TOMES.some((entry) => !owns(player, entry.tome) && returnedOf(player)[entry.kind] !== 1)) {
      lines.push("I should search the <col=800000>musty bookshelves</col> in the",
        "temple library for the three tomes.");
    }
    if (TOMES.some((entry) => pages[entry.kind] < PAGES_REQUIRED)) {
      lines.push("I need to collect tattered pages from the dungeon's",
        "monsters and add them to the tomes.");
    } else {
      lines.push("I should take the completed tomes to <col=800000>Logosia</col>",
        "in the <col=800000>Arceuus Library</col>.");
    }
    return lines;
  }

  api.persistAttribute(PAGES_ATTRIBUTE, PAGES_DEFAULT);
  api.persistAttribute(RETURNED_ATTRIBUTE, PAGES_DEFAULT);
  api.persistAttribute(FED_ATTRIBUTE, 0);
  api.persistAttribute(PREVENTION_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "in_search_of_knowledge",
    name: "In Search of Knowledge",
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 0,
    rewardItemId: LAMP_OF_KNOWLEDGE,
    scrollItemId: LAMP_OF_KNOWLEDGE,
    otherRewards: ["Lamp of knowledge (10,000 XP in any skill level 40+)"],
    buildJournal,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-drops:roll", filterPageDrops);
  api.onItemOnNpc(useItemOnAimeri);
  api.onItemOnNpc(useItemOnLogosia);
  api.onItemOnItem(usePageOnTome, { noted: false });
  api.onObjectInteraction("Musty bookshelf", { Search: searchBookshelf });
  for (const entry of TOMES) api.onItemAction(entry.name, { Check: checkTome });
  api.onItemAction("Lamp of knowledge", { Rub: rubLamp });
  api.onPlayerLogin(syncVars);
  api.onCustomEvent("player:bootstrap-complete", syncVars);
};
