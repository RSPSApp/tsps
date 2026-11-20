/**
 * In Aid of the Myreque: Rod (stages 360-430; see ../quests/InAidOfTheMyreque.Quest.js for the unit map).
 *
 * The Paterdomus library, Ivandis' tomb, the Rod of Ivandis and its hand-in to Veliaf in the new
 * Burgh de Rott hideout, as the live capture (revision 242) plays them; capture ticks in the docs:
 * - Ivandis' bookcase gives The Sleeping Seven (360 -> 370, t4323); reading it 370 -> 375 (t4358).
 *   The bookcases and the books are as rsprox.net recording 365 shows them.
 * - A hammer on the tomb boards (multiloc 12772): three ticks of human_poh_build with
 *   poh_build_wood, then varbit 1983 and an objectbox with the hammer; the stage stays (t4479-4483).
 * - The tomb entrance: human_longcrawl, a fade, the climbing loop, (3491, 9876) two ticks later;
 *   375 -> 380, no message (t4488-4494).
 * - Soft clay on the coffin: the clay becomes the mould in its slot, objectbox; 380 -> 390 (t4513).
 * - The silvthrill rod is Crafting's (silver_crafting "ivandis"); its "crafting:made" sets 400 (t4551).
 * - Lvl-1 Enchant on the rod: 410 the tick of the cast, the enchant itself nine ticks later with its
 *   own animation, spotanim and sound, the rod enchanted in its slot and an objectbox (t4562-4572).
 * - The rod in the Salve well: human_pickuptable and pool_plop at once, four ticks later the Rod of
 *   Ivandis in its slot and an objectbox; 410 -> 420 (t4706-4710).
 * - Veliaf (8277, multinpc 9489): "You give the Rod of Ivandis to Veliaf." takes the rod and shows
 *   430 and templetrek_npcs_visible (t4942); the rewards, chat line, jingle and scroll come on the
 *   continue after "Well [player name]..." (t4953), and once the scroll closes Veliaf goes on with
 *   Darkness of Hallowvale's start (t4963).
 */
module.exports = function attachRod(context) {
  const { api, state, common, STAGE, VARBIT, PAGE } = context;
  const { ItemIdentifiers: I, ObjectIdentifiers: O, NpcIdentifiers: N, Location, Skill, Equipment } = api.core;
  const { openBook, bookPagesFromSpreads, giveReward, loadTranscripts, startTranscript } = require("../QuestRuntime");
  const LIBRARY_BOOKS = require("../data/in-aid-of-the-myreque-books.json");

  // --- Ids (cache gamevals)

  const BOOKCASE_IVANDIS = O.BOOKCASE_52; // 12767 burgh_library_bookcase_ivandis
  const BOOKCASE_HISTORY = O.BOOKCASE_51; // 12766 burgh_library_bookcase_history
  const TOMB_BOARDS = 12772; // burgh_ivandis_tombdoor_board_multiloc (1983: 0 Wooden boards 12773, 1 none)
  const TOMB_ENTRANCE = O.CAVE_ENTRANCE_47; // 12770 burgh_ivandis_tomb_entrance
  const COFFIN = O.COFFIN_16; // 12802 burgh_ancient_coffin
  const SALVE_WELL = O.WELL_6; // 3485 priestperil_well under Paterdomus

  const SLEEPING_SEVEN = I.THE_SLEEPING_SEVEN; // 7633
  const HISTORIES = I.HISTORIES_OF_THE_HALLOWLAND; // 7634
  const MODERN_DAY = I.MODERN_DAY_MORYTANIA; // 7635
  const SOFT_CLAY = I.SOFT_CLAY; // 1761
  const ROD_MOULD = I.ROD_MOULD; // 7649 burgh_rod_clay
  const ROD = I.SILVTHRILL_ROD_2; // 7637 burgh_rod_command1
  const ENCHANTED_ROD = I.SILVTHRILL_ROD_3; // 7638 burgh_rod_command2
  const ROD_OF_IVANDIS = I.ROD_OF_IVANDIS_10_; // 7639 burgh_rod_command_final_10
  /** The Rod of Ivandis at any charge (10 down to 1). */
  const ROD_OF_IVANDIS_IDS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((charges) => I[`ROD_OF_IVANDIS_${charges}_`]); // 7639-7648
  const ROPE = I.ROPE; // 954

  /** myq5_veliaf_burgh_hideout 8277 shows as this one (varbit 10352 = 0). */
  const VELIAF = N.VELIAF_HURTZ_3; // 9489
  /** The Burgh hideout's Radigad 8283 and Polmafi 8286 (varbit 7255). */
  const RADIGAD = N.RADIGAD_PONFIT_2; // 9551
  const POLMAFI = N.POLMAFI_FERDYGRIS_2; // 9554

  // --- Live's animations, spotanims, sounds and timings (capture)

  const BOARDS_ANIM = 3676; // human_poh_build, t4480-4482
  const BOARDS_SOUND = 938; // poh_build_wood, t4480
  const BOARDS_TICKS = 3;
  const CRAWL_ANIM = 2796; // human_longcrawl, t4489
  const CRAWL_SOUND = 2454; // climbing_loop, loops 3, delay 4
  const TOMB_TILE = [3491, 9876, 0]; // t4491
  const CRAWL_TELEPORT_TICKS = 2;
  const FADE_IN_TICKS = 3; // t4492
  const FADE_CLOSE_TICKS = 5; // t4494
  const FADE_UID = (161 << 16) | 1;
  const FADE_INTERFACE = 174;
  const FADE_SCRIPT = 948;
  const ENCHANT_ANIM = 3566; // burgh_human_quest_enchanting_rod
  const ENCHANT_GFX = 609; // burgh_enchanting_rod_glow_spotanim, height 92
  const ENCHANT_GFX_HEIGHT = 92;
  const ENCHANT_SOUND = 136; // enchant_sapphire_amulet
  const ENCHANT_TICKS = 9; // the cast's tick (t4563) to the enchant (t4572)
  const SIDE_BUTTON_SWITCH_SCRIPT = 915; // toplevel_sidebutton_switch [6], t4563
  const MAGIC_TAB = 6;
  const WELL_ANIM = 832; // human_pickuptable, t4706
  const WELL_SOUND = 1658; // pool_plop
  const WELL_TICKS = 4; // t4710
  const COMPLETED_SCROLL = 153;

  const DARKNESS_PAGE = "Darkness of Hallowvale";
  const DARKNESS_START = "starting-the-quest-talking-to-veliaf-hurtz";

  const BOOKS_BY_ITEM = new Map([
    [SLEEPING_SEVEN, "burgh_book_sevenwarriors"],
    [HISTORIES, "burgh_book_historiesofhallowland"],
    [MODERN_DAY, "burgh_book_moderndaymorytania"],
  ].map(([itemId, key]) => [itemId, { title: LIBRARY_BOOKS[key].title, pages: bookPagesFromSpreads(LIBRARY_BOOKS[key].spreads) }]));

  /** Players crawling into the tomb (Ours: a second Enter meanwhile does nothing). */
  const crawling = new WeakSet();
  /** Players whose enchant is under way (live ignores a second cast meanwhile, t4569). */
  const enchanting = new WeakSet();
  /** Players whose completion scroll leads on to Darkness of Hallowvale, with the Veliaf they spoke to. */
  const continuingToDarkness = new WeakMap();
  /** Players whose Darkness of Hallowvale talk runs straight on from the hand-in (its "So what now?"). */
  const continuingTalk = new WeakSet();
  const DARKNESS_CONTINUING_CONDITION = "5iTY3c";

  const stage = (player) => state.stage(player);
  const handedIn = (player) => stage(player) < STAGE.COMPLETE && state.get(player, VARBIT.TEMPLE_TREK_NPCS) === 1;

  // --- Transcript words

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

  /** A step of one of the page's variants (its words for a box this unit sends itself). */
  function transcriptStep(variant, id) {
    return findStep(loadTranscripts(api)?.[PAGE]?.variants?.[variant], id);
  }

  const words = (variant, id) => String(transcriptStep(variant, id)?.text ?? "");

  // --- The library (rsprox.net recording 365 for the boxes; the live capture for the stages)

  /**
   * "You search the bookcase...", then each of its books the player does not carry with its own
   * objectbox; a book that does not fit goes on the floor under the player. Carrying them all, only
   * the search line is sent. The Sleeping Seven bookcase opens its box on the search tick (t4323),
   * the history bookcase a tick later (recording 365 t3878-3879).
   */
  function searchBookcase(player, itemIds, boxDelayTicks = 0) {
    common.message(player, "You search the bookcase...");
    const found = itemIds.filter((itemId) => !common.held(player, itemId));
    if (!found.length) return;
    for (const itemId of found) giveReward(player, itemId, 1);
    if (found.includes(SLEEPING_SEVEN) && stage(player) >= STAGE.LIBRARY_OPEN) state.advance(player, STAGE.BOOK_FOUND);
    const boxes = found.map((itemId) => ({ item: itemId, text: `You find a book called ${BOOKS_BY_ITEM.get(itemId).title}.` }));
    common.later(player, boxDelayTicks, (p) => common.chain(p, boxes));
  }

  function searchIvandisBookcase({ player, objectId }) {
    if (objectId !== BOOKCASE_IVANDIS) return false;
    // Ours: the library can only be reached once the trapdoor is open.
    if (stage(player) < STAGE.LIBRARY_OPEN) {
      common.message(player, "You can't reach this bookcase yet.");
      return true;
    }
    searchBookcase(player, [SLEEPING_SEVEN]);
    return true;
  }

  function searchHistoryBookcase({ player, objectId }) {
    if (objectId !== BOOKCASE_HISTORY) return false;
    searchBookcase(player, [HISTORIES, MODERN_DAY], 1);
    return true;
  }

  function searchLibraryBookcase(event) {
    return searchIvandisBookcase(event) || searchHistoryBookcase(event);
  }

  /** Read opens book 392 with live's pages; The Sleeping Seven moves 370 -> 375 as it opens (t4358). */
  function readBook({ player, itemId }) {
    const book = BOOKS_BY_ITEM.get(itemId);
    if (!book) return false;
    if (itemId === SLEEPING_SEVEN && stage(player) >= STAGE.LIBRARY_OPEN) state.advance(player, STAGE.BOOK_READ);
    openBook(player, book.title, book.pages);
    return true;
  }

  // --- Ivandis' tomb

  const isHammer = (itemId) => itemId === I.HAMMER || itemId === I.HAMMER_2;

  /** Three ticks of building with the hammer, then the boards are gone for this player (t4480-4483). */
  function breakBoards(player, hammerId) {
    common.anim(player, BOARDS_ANIM);
    common.sound(player, BOARDS_SOUND);
    for (let tick = 1; tick < BOARDS_TICKS; tick++) common.later(player, tick, (p) => common.anim(p, BOARDS_ANIM));
    common.later(player, BOARDS_TICKS, (p) => {
      state.set(p, VARBIT.TOMB_BOARDS, 1);
      common.anim(p, -1);
      common.itemBox(p, hammerId, words("rod-of-ivandis-making-a-new-rod-ivandis-tomb-removing-the-boards", "o_HD4c"));
    });
  }

  function hammerOnBoards({ player, objectId, itemId }) {
    if (objectId !== TOMB_BOARDS || state.get(player, VARBIT.TOMB_BOARDS) === 1) return false;
    if (stage(player) < STAGE.BOOK_READ) return false;
    breakBoards(player, itemId);
    return true;
  }

  function fade(player, out) {
    return player.getPacketSender().mountSubInterface(FADE_UID, FADE_INTERFACE, 1, {
      postScripts: [{ scriptId: FADE_SCRIPT, args: out ? [0, 255, 0, 0, 50] : [0, 0, 0, 255, 50] }],
    });
  }

  /** Live's crawl into the tomb (t4489-4494): 380 on the crawl, the move two ticks on, no message. */
  function crawlIntoTomb(player) {
    if (crawling.has(player)) return;
    crawling.add(player);
    state.advance(player, STAGE.TOMB_ENTERED);
    const movement = player.getMovementQueue();
    movement.reset().setBlockMovement(true);
    common.anim(player, CRAWL_ANIM);
    fade(player, true);
    player.getPacketSender().sendSoundEffect(CRAWL_SOUND, 3, 4, 255);
    common.later(player, CRAWL_TELEPORT_TICKS, (p) => {
      crawling.delete(p);
      p.getMovementQueue().setBlockMovement(false);
      p.moveTo(new Location(...TOMB_TILE));
      common.anim(p, -1);
    });
    let mount = null;
    common.later(player, FADE_IN_TICKS, (p) => { mount = fade(p, false); });
    common.later(player, FADE_CLOSE_TICKS, (p) => { if (mount) p.getPacketSender().closeSubInterfaceMount(mount); });
  }

  function enterTomb({ player, objectId }) {
    if (objectId !== TOMB_ENTRANCE) return false;
    if (state.get(player, VARBIT.TOMB_BOARDS) === 1) {
      crawlIntoTomb(player);
      return true;
    }
    // The boards are still up: the transcript's "Remove the boards?" with a hammer to hand.
    const hammer = [I.HAMMER, I.HAMMER_2].find((id) => common.held(player, id));
    if (stage(player) >= STAGE.BOOK_READ && hammer !== undefined) {
      common.play(player, VELIAF, "rod-of-ivandis-making-a-new-rod-ivandis-tomb-removing-the-boards");
    } else {
      common.message(player, words("rod-of-ivandis-making-a-new-rod-ivandis-tomb-removing-the-boards", "iLlucK"));
    }
    return true;
  }

  function inspectCoffin({ player, objectId }) {
    if (objectId !== COFFIN) return false;
    // Ours: not captured; the transcript's message goes to chat.
    common.message(player, words("rod-of-ivandis-making-a-new-rod-ivandis-tomb-inspecting-the-coffin", "FCC3-v"));
    return true;
  }

  /** Soft clay on the coffin: the mould in the clay's slot and its objectbox; 380 -> 390 (t4513). */
  function clayOnCoffin({ player, objectId }) {
    if (objectId !== COFFIN || stage(player) < STAGE.TOMB_ENTERED) return false;
    if (!common.replaceInSlot(player, SOFT_CLAY, ROD_MOULD)) return false;
    state.advance(player, STAGE.MOULD);
    common.itemBox(player, ROD_MOULD, words("rod-of-ivandis-making-a-new-rod-ivandis-tomb-using-soft-clay-on-the-coffin", "6RzpFr"));
    return true;
  }

  // --- The silvthrill rod (Crafting's silver_crafting "ivandis", t4549-4551)

  function rodCrafted({ player, itemId }) {
    if (!player || itemId !== ROD || stage(player) < STAGE.MOULD) return;
    state.advance(player, STAGE.ROD_MADE);
  }

  // --- Lvl-1 Enchant (Spells.EnchantJewellery.js "magic:enchant-item": the spell's runes, level and XP)

  function enchantRod(event) {
    const { player, spell, spellName, itemId, slot } = event;
    if (itemId !== ROD || spellName !== "Lvl-1 Enchant" || stage(player) < STAGE.ROD_MADE) return;
    event.handled = true;
    if (enchanting.has(player)) return;
    if (player.getInventory().getItems()[slot]?.getId() !== ROD || !spell.canCast(player, false)) return;
    enchanting.add(player);
    state.advance(player, STAGE.ROD_ENCHANTED);
    player.getPacketSender().sendClientScript(SIDE_BUTTON_SWITCH_SCRIPT, MAGIC_TAB);
    common.later(player, ENCHANT_TICKS, (p) => {
      enchanting.delete(p);
      if (!common.held(p, ROD) || !spell.canCast(p, true)) return;
      common.anim(p, ENCHANT_ANIM);
      common.gfx(p, ENCHANT_GFX, ENCHANT_GFX_HEIGHT);
      common.replaceInSlot(p, ROD, ENCHANTED_ROD);
      common.sound(p, ENCHANT_SOUND);
      p.getSkillManager().addExperiences(Skill.MAGIC, spell.baseExperience());
      common.itemBox(p, ENCHANTED_ROD, words("rod-of-ivandis-making-a-new-rod-empowering-the-rod-enchanting-the-rod", "ET0SD9"));
    });
  }

  // --- The Salve well (t4706-4710)

  function rodInWell({ player, objectId, itemId }) {
    if (objectId !== SALVE_WELL) return false;
    const variant = "rod-of-ivandis-making-a-new-rod-empowering-the-rod-blessing-the-rod";
    if (itemId === ROD) {
      // Ours: not captured; the transcript's line goes to chat.
      common.message(player, words(variant, "E5JaWk"));
      return true;
    }
    if (itemId !== ENCHANTED_ROD) return false;
    if (!common.held(player, ROPE)) {
      // Wiki and transcript: a rope is needed (the capture's player carried one). Ours: to chat.
      common.message(player, words(variant, "JmywEU"));
      return true;
    }
    common.anim(player, WELL_ANIM);
    common.sound(player, WELL_SOUND);
    common.later(player, WELL_TICKS, (p) => {
      if (!common.replaceInSlot(p, ENCHANTED_ROD, ROD_OF_IVANDIS)) return;
      state.advance(p, STAGE.ROD_BLESSED);
      common.itemBox(p, ROD_OF_IVANDIS, words(variant, "SaJL9k"));
    });
    return true;
  }

  // --- Inspecting the rod

  function inspectRod({ player, itemId }) {
    const variant = "rod-of-ivandis-inspecting-the-rod";
    if (itemId === ROD) common.message(player, words(variant, "Ns-Iu5"));
    else if (itemId === ENCHANTED_ROD) common.message(player, words(variant, "f04ETj"));
    else return false;
    return true;
  }

  // --- Veliaf in the Burgh de Rott hideout

  function tasteNeedsVeliafRod(player) {
    const request = { player, needsRod: false };
    api.emitCustomEvent("taste-of-hope:needs-veliaf-rod", request);
    return request.needsRod === true;
  }

  const rodOfIvandisSlot = (player) => player.getInventory().getItems()
    .findIndex((item) => item && ROD_OF_IVANDIS_IDS.includes(item.getId()));
  const wieldingRod = (player) => ROD_OF_IVANDIS_IDS.includes(player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.());

  /** The silvthrill-rod talk without its two framing conditions: talked to, or a rod used on him. */
  function silvthrillTalk(steps, used) {
    const talk = steps.find((step) => step.id === "iot756")?.steps ?? [];
    if (!used) return talk;
    const handOver = steps.find((step) => step.id === "dHh3ct")?.steps?.[0];
    return [handOver, ...talk.slice(2)].filter(Boolean);
  }

  /** The finalized-rod talk from Veliaf's thanks on, for a hand-in whose conversation was cut short. */
  function afterHandIn(steps) {
    const given = findStep(steps, "io8V2U")?.steps ?? [];
    const index = given.findIndex((step) => step.id === "ruxiLW");
    return index >= 0 ? given.slice(index + 1) : [];
  }

  function veliafVariant(player, npcId, npc, used = false) {
    const s = stage(player);
    if (s < STAGE.IVAN_DELIVERED) return false;
    if (s < STAGE.TOMB_ENTERED) {
      common.play(player, npcId, "rod-of-ivandis-at-the-new-myreque-hideout-veliaf-before-finding-the-tomb", undefined, PAGE, npc);
    } else if (s < STAGE.MOULD) {
      common.play(player, npcId, "rod-of-ivandis-at-the-new-myreque-hideout-veliaf-after-finding-the-tomb", undefined, PAGE, npc);
    } else if (s < STAGE.ROD_MADE) {
      common.play(player, npcId, "rod-of-ivandis-at-the-new-myreque-hideout-veliaf-after-making-a-mould", undefined, PAGE, npc);
    } else if (handedIn(player)) {
      // Ours: the rod was handed over but the conversation stopped before the rewards.
      common.play(player, npcId, "rod-of-ivandis-talking-to-veliaf-with-the-finalized-rod", afterHandIn, PAGE, npc);
    } else if (s >= STAGE.ROD_BLESSED && (rodOfIvandisSlot(player) >= 0 || wieldingRod(player))) {
      common.play(player, npcId, "rod-of-ivandis-talking-to-veliaf-with-the-finalized-rod", undefined, PAGE, npc);
    } else {
      // 400-419, or 420 without the rod (Ours, as before the alignment).
      common.play(player, npcId, "rod-of-ivandis-at-the-new-myreque-hideout-veliaf-after-making-a-silvthrill-rod",
        (steps) => silvthrillTalk(steps, used), PAGE, npc);
    }
    return true;
  }

  function talkVeliaf({ player, npcId, npc }) {
    if (npcId !== VELIAF) return false;
    if (stage(player) >= STAGE.COMPLETE) {
      // A Taste of Hope's rod step needs Veliaf on its own transcript; Darkness of Hallowvale, loaded
      // first, otherwise has him. Ours: the page has no post-quest talk, so his greeting only.
      if (tasteNeedsVeliafRod(player)) return false;
      common.play(player, npcId, "rod-of-ivandis-talking-to-veliaf-with-the-finalized-rod", (steps) => steps.slice(0, 1), PAGE, npc);
      return true;
    }
    return veliafVariant(player, npcId, npc);
  }

  /** A rod used on Veliaf: the silvthrill rods hand over with "Here you go..."; Ours: the finished rod as a talk. */
  function rodOnVeliaf(event) {
    const { player, npcId, itemId } = event;
    if (npcId !== VELIAF || stage(player) >= STAGE.COMPLETE || stage(player) < STAGE.ROD_MADE) return;
    if (itemId !== ROD && itemId !== ENCHANTED_ROD && !ROD_OF_IVANDIS_IDS.includes(itemId)) return;
    event.handled = true;
    if (ROD_OF_IVANDIS_IDS.includes(itemId)) {
      veliafVariant(player, npcId, event.target);
      return;
    }
    common.play(player, npcId, "rod-of-ivandis-at-the-new-myreque-hideout-veliaf-after-making-a-silvthrill-rod",
      (steps) => silvthrillTalk(steps, true), PAGE, event.target);
  }

  function talkRadigad({ player, npcId, npc }) {
    if (npcId !== RADIGAD || stage(player) < STAGE.IVAN_DELIVERED || stage(player) >= STAGE.COMPLETE) return false;
    common.play(player, npcId, "rod-of-ivandis-at-the-new-myreque-hideout-radigad-ponfit", undefined, PAGE, npc);
    return true;
  }

  function talkPolmafi({ player, npcId, npc }) {
    if (npcId !== POLMAFI || stage(player) < STAGE.IVAN_DELIVERED || stage(player) >= STAGE.COMPLETE) return false;
    common.play(player, npcId, "rod-of-ivandis-at-the-new-myreque-hideout-polmafi-ferdygris", undefined, PAGE, npc);
    return true;
  }

  const ownsPage = (pages) => !Array.isArray(pages) || pages.some((entry) => entry?.page === PAGE);

  /** The rod conditions of Veliaf's talks. */
  function answerRodCondition({ player, stepId, pages }) {
    if (!player || !ownsPage(pages)) return null;
    switch (stepId) {
      case "NqM8Y3": return common.held(player, ROD);
      case "ymxsId": return common.held(player, ENCHANTED_ROD) && !common.held(player, ROD);
      case "RaJqfs": return wieldingRod(player);
      case "io8V2U": return !wieldingRod(player);
      default: return null;
    }
  }

  /**
   * "You give the Rod of Ivandis to Veliaf." (t4942): the rod goes and the client sees 430 and
   * templetrek_npcs_visible on that box. The stage itself is set with the rewards (the quest's
   * completion), on the continue after "Well [player name]..." (t4953): `quest.complete` keeps the
   * stage, points and XP together.
   */
  function handIn(event) {
    const { player } = event;
    if (stage(player) !== STAGE.ROD_BLESSED || handedIn(player)) {
      event.end = true;
      return;
    }
    const slot = rodOfIvandisSlot(player);
    if (slot < 0) {
      event.end = true;
      return;
    }
    const inventory = player.getInventory();
    const rodId = inventory.getItems()[slot].getId();
    player.getPacketSender().sendVarbit(VARBIT.QUEST, STAGE.COMPLETE);
    state.set(player, VARBIT.TEMPLE_TREK_NPCS, 1);
    inventory.deleteNumber(rodId, 1);
    event.box = { items: [rodId] };
  }

  /** The continue after "Well [player name]..." (t4953): points, chat line, jingle 154, the scroll, the XP. */
  function completeQuest(event) {
    const { player } = event;
    event.handled = true;
    event.end = true;
    if (!handedIn(player)) return;
    continuingToDarkness.set(player, event.npc ?? null);
    state.own(player, () => context.quest().complete(player));
  }

  function handleDialogueAction(event) {
    if (!event?.player || !ownsPage(event.pages)) return;
    switch (event.stepId) {
      case "ruxiLW": return handIn(event);
      case "NoQoo2": return completeQuest(event);
      case "o_HD4c": {
        // "Remove the boards?" Yes: the hammer use itself.
        event.handled = true;
        event.end = true;
        const hammer = [I.HAMMER, I.HAMMER_2].find((id) => common.held(event.player, id));
        if (hammer !== undefined && state.get(event.player, VARBIT.TOMB_BOARDS) !== 1) breakBoards(event.player, hammer);
        return;
      }
      default:
    }
  }

  /** The scroll closed (t4963): Veliaf goes on with Darkness of Hallowvale's "So what now?". */
  function scrollClosed({ player, interfaceId }) {
    if (interfaceId !== COMPLETED_SCROLL || !continuingToDarkness.has(player)) return;
    const npc = continuingToDarkness.get(player);
    continuingToDarkness.delete(player);
    continuingTalk.add(player);
    startTranscript(api, player, VELIAF, DARKNESS_PAGE, DARKNESS_START, undefined, npc);
  }

  /**
   * "in-aid-of-the-myreque:continuing" { player, continuing }: whether this Veliaf talk is the one that
   * follows the scroll (live t4963) rather than a later one ("Hello again. How's things?", t4988).
   */
  function answerContinuing(request) {
    if (request?.player && continuingTalk.has(request.player)) request.continuing = true;
  }

  /** The continuation's branch has been taken: later talks are ordinary ones. */
  function continuationTaken({ player, stepId }) {
    if (stepId === DARKNESS_CONTINUING_CONDITION && player) continuingTalk.delete(player);
  }

  // --- Registration

  api.onObjectInteraction("Bookcase", { Search: searchLibraryBookcase });
  api.onItemAction("The sleeping seven", { Read: readBook });
  api.onItemAction("Histories of the Hallowland", { Read: readBook });
  api.onItemAction("Modern day morytania", { Read: readBook });
  api.onItemOnObject("Hammer", "Wooden boards", hammerOnBoards);
  api.onObjectInteraction("Cave entrance", { Enter: enterTomb });
  api.onObjectInteraction("Coffin", { Inspect: inspectCoffin });
  api.onItemOnObject("Soft clay", "Coffin", clayOnCoffin);
  api.onCustomEvent("crafting:made", rodCrafted);
  api.onCustomEvent("in-aid-of-the-myreque:continuing", answerContinuing);
  api.onCustomEvent("npc-dialogue:condition", continuationTaken);
  api.onCustomEvent("magic:enchant-item", enchantRod);
  api.onItemOnObject("Silvthrill rod", "Well", rodInWell);
  api.onItemAction("Silvthrill rod", { Inspect: inspectRod });
  api.onNpcInteraction("Veliaf Hurtz", { "Talk-to": talkVeliaf });
  api.onNpcInteraction("Radigad Ponfit", { "Talk-to": talkRadigad });
  api.onNpcInteraction("Polmafi Ferdygris", { "Talk-to": talkPolmafi });
  api.onItemOnNpc(rodOnVeliaf);
  api.onNpcDialogueCondition(answerRodCondition);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("interface:closed", scrollClosed);
};
