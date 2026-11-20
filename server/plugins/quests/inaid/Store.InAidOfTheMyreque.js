/**
 * In Aid of the Myreque: Store (see ../quests/InAidOfTheMyreque.Quest.js for the unit map).
 *
 * Stages 110-229 of Aurel, 110-219 of the citizens: the general store's roof and wall, the stock
 * crate, the bank's booth and wall, Cornelius the banker and the furnace's chimney and fuel. Live's
 * capture (revision 242, ticks 1293-2196) is the model; the repaired locs are the cache's own
 * multilocs (12751, 12752, 12759, 12760, 12805), driven per player by the quest varbits:
 *
 * - Talk-to Aurel at 110, "I'd like to help fix up the town.": the stage goes 110 -> 140 with Aurel's
 *   "Please can you fix the roof, then the walls..." (t1305), not on the option (Razvan's same option
 *   leaves it, t1174).
 * - A repair (roof t1318-1325, store wall t1333-1341, booth t2041-2046, bank wall t2048-2060, chimney
 *   t2166-2179): Inspect, the loc's mesbox, then "Fix the ...?" Yes./No.; Yes plays pest_repair 3931
 *   and three hammer sounds (delays 0/20/40); two ticks later the varbit and the stage are set, the
 *   materials go, m2_build 1710 plays, the result box shows and Crafting gains 100 xp.
 * - The crate (7630) never changes item: its contents are varbits 1991-1993 (t1527, t1556, t1593),
 *   filled from a "Would you like to fill the crate with ...?" menu. Its hand-in sets 1984 and 170 on
 *   "Aurel quickly puts the stock out around the shop." (t1995).
 * - Cornelius (multinpcs 6214/6215 on varbit 1979) is recruited during a fade (t2088-2091): 1979 = 1
 *   and 200 two ticks after the fade-out.
 * - A citizen's "...the old furnace were up and working again." sets 205 (t2119); fuel (t2193-2194)
 *   is varbit 1980 = 2 only.
 */
module.exports = function attachStore(context) {
  const { api, state, common, STAGE, VARBIT, PAGE } = context;
  const { ItemIdentifiers: I, NpcIdentifiers: N, Skill, Item } = api.core;
  const { loadTranscripts } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");
  const Scenes = createQuestScenes(api);

  // ---------------------------------------------------------------------------
  // Ids (cache gamevals in comments)
  // ---------------------------------------------------------------------------

  const ROOF_LOC = 12751; // burgh_general_store_roof_multiloc (varbit 1974)
  const STORE_WALL_LOC = 12752; // burgh_general_store_wall_multiloc (varbit 1975)
  const BOOTH_LOC = 12759; // burgh_bank_booth_multiloc (varbit 1977)
  const BANK_WALL_LOC = 12760; // burgh_bank_wall_multiloc (varbit 1978)
  const FURNACE_LOC = 12805; // burgh_furnace_multiloc (varbit 1980)

  const CRATE = I.CRATE; // 7630 burgh_generalstore_crate
  const PLANK = I.PLANK; // 960 woodplank
  const STEEL_NAILS = I.STEEL_NAILS; // 1539 nails
  const NAILS = [I.BRONZE_NAILS, I.IRON_NAILS, I.STEEL_NAILS, I.BLACK_NAILS, I.MITHRIL_NAILS, I.ADAMANTITE_NAILS, I.RUNE_NAILS];
  const HAMMERS = [I.HAMMER, I.HAMMER_2];
  const SWAMP_PASTE = I.SWAMP_PASTE; // 1941
  const STEEL_BAR = I.STEEL_BAR; // 2353
  const COAL = I.COAL; // 453
  const TINDERBOX = I.TINDERBOX; // 590
  const BRONZE_AXE = I.BRONZE_AXE; // 1351
  /** "10 snails of any type" (capture t1364, raw snail_corpse1 3363 accepted at t1591); the Wiki: raw or cooked. */
  const SNAILS = [I.THIN_SNAIL, I.LEAN_SNAIL, I.FAT_SNAIL, I.THIN_SNAIL_MEAT, I.LEAN_SNAIL_MEAT, I.FAT_SNAIL_MEAT];
  /** The Wiki's other request: 10 mackerel, raw or cooked. */
  const MACKEREL = [I.RAW_MACKEREL, I.MACKEREL];

  const AUREL = N.AUREL; // 4445
  const CORNELIUS = N.CORNELIUS; // 4470 burgh_potential_bank_teller (6214 while 1979 = 0)

  const PEST_REPAIR = 3931; // seq pest_repair
  const PICKUP_TABLE = 832; // seq human_pickuptable
  const HAMMER_WOOD = 2101; // synth hammer_wood
  const HAMMER_STEEL = 2099; // synth hammer_steel
  const BUILD = 1710; // synth m2_build
  const FILL_COAL = 1709; // synth m2_fillcoal
  const HAMMER_DELAYS = [0, 20, 40];
  const REPAIR_TICKS = 2;
  /** update_stat_v2 crafting +100 at t1325, t1341, t2046, t2060, t2179 (the Wiki gives no value). */
  const REPAIR_XP = 100;

  /** Aurel's request: varbit, amount, the item ids it takes, and its words. */
  const CRATE_TINDERBOXES = { varbit: VARBIT.CRATE_TINDERBOXES, needed: 3, ids: [TINDERBOX], one: "tinderbox", many: "tinderboxes", full: "tinderboxes" };
  const CRATE_AXES = { varbit: VARBIT.CRATE_AXES, needed: 10, ids: [BRONZE_AXE], one: "bronze axe", many: "bronze axes", full: "bronze axes" };
  const CRATE_SNAILS = { varbit: VARBIT.CRATE_FOOD, needed: 10, ids: SNAILS, one: "snail", many: "snails", full: "food", asked: "snails of any type" };
  const CRATE_MACKEREL = { varbit: VARBIT.CRATE_FOOD, needed: 10, ids: MACKEREL, one: "mackerel", many: "mackerel", full: "food", asked: "raw mackerel" };
  const FOOD_SNAILS = 1;
  const FOOD_MACKEREL = 2;
  /** Which food Aurel asked for (the Wiki: randomly snails or mackerel, rerolled until the crate is handed over). */
  const CRATE_FOOD_ATTRIBUTE = "in-aid-of-the-myreque:crate-food";
  const pendingFood = new WeakMap();

  const CITIZENS = [
    "Florin", "Vasile", "Razvan", "Luminata", "Elisabeta", "Teodor", "Gabriela", "Cornelius",
    "Luscion", "Sergiu", "Sorin", "Ileana", "Radu", "Valeria", "Grigore", "Emilia", "Simona", "Calin", "Nicoleta", "Mihail",
  ];

  const VARIANT = Object.freeze({
    aurel: "entering-burgh-de-rott-fixing-the-general-store-aurel",
    handIn: "entering-burgh-de-rott-fixing-the-general-store-handing-in-store-stock",
    afterInn: "entering-burgh-de-rott-speaking-to-citizens-while-clearing-the-inn-speaking-to-citizens-after-clearing-the-inn",
    storeCitizens: "entering-burgh-de-rott-fixing-the-general-store-speaking-to-citizens-while-fixing-the-general-store",
    bankCitizens: "entering-burgh-de-rott-fixing-the-bank-speaking-to-citizens-while-fixing-the-bank",
    recruit: "entering-burgh-de-rott-fixing-the-bank-recruiting-cornelius",
    furnaceCitizens: "entering-burgh-de-rott-fixing-the-furnace-speaking-to-citizens-while-fixing-the-furnace",
  });

  /** The words of the repairs, from the transcript page (step ids), as live showed them. */
  const TEXT = Object.freeze({
    roof: "The roof looks like it's seen better days. The planks are all rotten and the nails have gone rusty.", // PrBgdV
    roofFixed: "You use some wooden planks and nails to patch up the hole in the roof.", // dCmiPs
    wall: "The wall has a large hole in it surrounded by rotten wood and rusty metal. It looks like it was once boarded up with nails and wooden planks.", // FshL1-, 6hKiDA
    wallFixed: "You use some wooden planks and nails to fix up the wall.", // 2TCJ1Y, rGZmBx
    noPlanks: "You do not have the required items to do that. You need a hammer, 3 basic planks and 12 nails of any kind.", // sGhWty
    booth: "This bank booth is in an awful condition. There's a lot of broken glass and most of the wooden structure of the booth has been destroyed.", // DGksPr
    boothFixed: "You use some swamp paste to fix the bits of glass back together and then repair the structure of the booth with some wooden planks and nails.", // ougJmJ
    noBooth: "You do not have the required items to do that. You need a hammer, 1 swamp paste, 2 basic planks and 8 nails of any kind.", // D7Z4t9
    noBanker: "While the booth looks functional, there still isn't anyone working behind the booth to serve you.", // NxSizb
    furnace: "There's a large hole in the chimney of the furnace which is probably why it doesn't work.", // VOBL_n
    furnaceFixed: "You use some steel bars to fix the hole in the furnace chimney.", // XVO4rp
    noBars: "You do not have the required items to do that. You need a hammer and 2 steel bars.", // 47pDqU
    fuel: "The furnace has been repaired now. However, it needs some fuel before it can be used.", // k2GaUk
    fuelled: "You place some coal into the newly fixed furnace.", // eBvDAy
    noCoal: "You need some coal to refuel the furnace.", // krqsxG
    crateEmpty: "The crate is empty.", // TUZfB5
    crateFull: "The crate is packed with stock. You should return it to the store.", // p-AP3b
    noStock: "I'm sorry my friend, but I cannot open a store which has no stock.", // q11mmS
    stockLine: "I need 3 tinderboxes, 10 snails of any type/raw mackerel and 10 bronze axes.", // A1yJWY
    stockAgain: "You need to collect 10 bronze axes, 10 [snails of any type/raw mackerel] and 3 tinderboxes.", // IWXcv-
    agreed: "Please can you fix the roof, then the walls. Once that's done, come and have a chat with me regarding the stores stock.", // JUDmdl
    furnaceTold: "You've already done quite a lot and we're all super grateful. That said, I overheard someone saying how great it would be if the old furnace were up and working again.",
    recruitCue: "Well, the bank is all fixed now, but it isn't going to serve people all on its own. You'll have to recruit someone!", // XNcdpB
    helpOption: "I'd like to help fix up the town.",
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const stage = (player) => state.stage(player);
  const inRange = (player, from, until) => { const s = stage(player); return s >= from && s < until; };
  const ownsPage = (pages) => !Array.isArray(pages) || pages.some((entry) => entry?.page === PAGE);
  const hasHammer = (player) => HAMMERS.some((id) => common.held(player, id));
  const countOf = (player, ids) => ids.reduce((sum, id) => sum + player.getInventory().getAmount(id), 0);
  const npcIdOf = (event) => event.definition?.getId?.() ?? event.npcId;

  function removeAcross(player, ids, amount, first = null) {
    let left = amount;
    for (const id of first == null ? ids : [first, ...ids.filter((other) => other !== first)]) {
      if (left <= 0) break;
      const take = Math.min(player.getInventory().getAmount(id), left);
      if (take > 0) {
        player.getInventory().deleteNumber(id, take);
        left -= take;
      }
    }
    return amount - left;
  }

  /** Repairs under way (player -> varbits), so a second Yes in the two ticks repairs nothing more. */
  const repairing = new WeakMap();

  /**
   * Live's repair: Yes plays the hammering, the result lands two ticks later (capture t1323 -> t1325).
   * `varbit` is the repair's own: once it is set (or one is under way) a stale menu's Yes does nothing.
   */
  function repair(player, { varbit, hammer = HAMMER_WOOD, has, take, done, box }) {
    const pending = repairing.get(player) ?? new Set();
    if (state.get(player, varbit) || pending.has(varbit) || !has(player)) return;
    pending.add(varbit);
    repairing.set(player, pending);
    common.anim(player, PEST_REPAIR);
    for (const delay of HAMMER_DELAYS) common.sound(player, hammer, delay);
    common.later(player, REPAIR_TICKS, (p) => {
      pending.delete(varbit);
      if (state.get(p, varbit) || !has(p)) return common.anim(p, -1);
      take(p);
      done(p);
      common.anim(p, -1);
      common.sound(p, BUILD);
      p.getSkillManager().addExperiences(Skill.CRAFTING, REPAIR_XP);
      box(p);
    });
  }

  /** Inspect: the loc's mesbox, then live's titled Yes./No. menu (or the missing-items mesbox). */
  function inspectThenAsk(player, text, title, has, missing, onYes) {
    common.mesbox(player, text, (p) => common.menu(p, title, [
      ["Yes.", (q) => (has(q) ? onYes(q) : common.mesbox(q, missing))],
      ["No.", (q) => q.getPacketSender().sendInterfaceRemoval()],
    ]));
  }

  const planksAndNails = (planks, nails) => (player) =>
    hasHammer(player) && common.held(player, PLANK, planks) && countOf(player, NAILS) >= nails;
  const takePlanksAndNails = (planks, nails) => (player) => {
    player.getInventory().deleteNumber(PLANK, planks);
    removeAcross(player, NAILS, nails, STEEL_NAILS);
  };

  // ---------------------------------------------------------------------------
  // The general store: roof and wall (140 -> 160)
  // ---------------------------------------------------------------------------

  function inspectRoof(event) {
    const { player } = event;
    if (event.objectId !== ROOF_LOC || !inRange(player, STAGE.CELLAR_CLEARED, STAGE.COMPLETE)) return false;
    // Ours: before Aurel asks, the inspect text alone (no capture of an early inspect).
    if (stage(player) < STAGE.STORE_AGREED) return common.mesbox(player, TEXT.roof), true;
    const has = planksAndNails(3, 12);
    inspectThenAsk(player, TEXT.roof, "Fix the roof?", has, TEXT.noPlanks, (p) => repair(p, {
      varbit: VARBIT.STORE_ROOF,
      has, take: takePlanksAndNails(3, 12),
      done: (q) => { state.set(q, VARBIT.STORE_ROOF, 1); state.advance(q, STAGE.ROOF_FIXED); },
      box: (q) => common.doubleBox(q, [PLANK, STEEL_NAILS], TEXT.roofFixed),
    }));
    return true;
  }

  function inspectWall(event) {
    if (event.objectId === STORE_WALL_LOC) return inspectStoreWall(event);
    if (event.objectId === BANK_WALL_LOC) return inspectBankWall(event);
    return false;
  }

  function inspectStoreWall({ player }) {
    if (!inRange(player, STAGE.CELLAR_CLEARED, STAGE.COMPLETE)) return false;
    if (stage(player) < STAGE.STORE_AGREED) return common.mesbox(player, TEXT.wall), true; // Ours, as the roof
    // Aurel asks for "the roof, then the walls" (t1305), and the stages run 150 roof, 160 wall (live fixed
    // them in that order, t1325 then t1341). Ours: the wall's text alone until the roof is done.
    if (!state.get(player, VARBIT.STORE_ROOF)) return common.mesbox(player, TEXT.wall), true;
    const has = planksAndNails(3, 12);
    inspectThenAsk(player, TEXT.wall, "Fix the wall?", has, TEXT.noPlanks, (p) => repair(p, {
      varbit: VARBIT.STORE_WALL,
      has, take: takePlanksAndNails(3, 12),
      done: (q) => { state.set(q, VARBIT.STORE_WALL, 1); state.advance(q, STAGE.WALL_FIXED); },
      box: (q) => common.doubleBox(q, [PLANK, STEEL_NAILS], TEXT.wallFixed),
    }));
    return true;
  }

  // ---------------------------------------------------------------------------
  // The crate (160 -> 170)
  // ---------------------------------------------------------------------------

  function foodChoice(player) {
    const saved = Number(player.getAttribute(CRATE_FOOD_ATTRIBUTE)) || 0;
    if (saved) return saved;
    if (!pendingFood.has(player)) pendingFood.set(player, Math.random() < 0.5 ? FOOD_SNAILS : FOOD_MACKEREL);
    return pendingFood.get(player);
  }
  // A crate from before the food choice was saved takes snails, as live asked.
  const savedFood = (player) => (Number(player.getAttribute(CRATE_FOOD_ATTRIBUTE)) === FOOD_MACKEREL ? CRATE_MACKEREL : CRATE_SNAILS);
  const crateParts = (player) => [CRATE_TINDERBOXES, CRATE_AXES, savedFood(player)];
  const crateCount = (player, part) => state.get(player, part.varbit);
  const crateFull = (player) => crateParts(player).every((part) => crateCount(player, part) >= part.needed);
  const crateEmpty = (player) => crateParts(player).every((part) => crateCount(player, part) === 0);

  function searchCrate({ player }) {
    if (!inRange(player, STAGE.CRATE_GIVEN, STAGE.STORE_STOCKED)) return false;
    if (crateEmpty(player)) return common.mesbox(player, TEXT.crateEmpty), true;
    if (crateFull(player)) return common.mesbox(player, TEXT.crateFull), true;
    const [tinder, axes, food] = crateParts(player).map((part) => part.needed - crateCount(player, part));
    // eNm9WM, its blanks filled with what is still missing (Ours: the food named as asked).
    common.mesbox(player, `More still needs adding to the crate. You need to collect ${axes} bronze axes, ${food} ${savedFood(player).many}, and ${tinder} tinderboxes.`);
    return true;
  }

  function useOnCrate(event) {
    const { player } = event;
    const other = event.usedItemId === CRATE ? event.usedWithItemId : event.usedWithItemId === CRATE ? event.usedItemId : -1;
    if (other < 0 || !inRange(player, STAGE.CRATE_GIVEN, STAGE.STORE_STOCKED)) return false;
    const part = crateParts(player).find((entry) => entry.ids.includes(other));
    if (!part) return false;
    event.handled = true;
    const missing = part.needed - crateCount(player, part);
    if (missing <= 0) return common.mesbox(player, `You've already filled the crate with ${part.many}.`), true; // lzk2tt
    common.menu(player, `Would you like to fill the crate with ${part.full}?`, [
      ["Yes, I'll fill the crate.", (p) => addToCrate(p, part, other, missing)],
      ["No, I just want to add one.", (p) => addToCrate(p, part, other, 1)],
    ]);
    return true;
  }

  function addToCrate(player, part, used, wanted) {
    const added = removeAcross(player, part.ids, Math.min(wanted, countOf(player, part.ids)), used);
    if (added <= 0) return;
    const total = crateCount(player, part) + added;
    state.set(player, part.varbit, total);
    const words = added === 1 ? `You add a ${part.one} to the crate.` : `You add ${added} ${part.many} to the crate.`;
    const left = part.needed - total;
    const after = left <= 0 ? `The crate is now full of ${part.full}.` // z8ah6T
      : wanted > 1 ? `You need another ${left} ${left === 1 ? part.one : part.many} to fill this crate.` // dh_zZJ
        : null; // MnQgIR/WrMlsj: no line after adding one
    common.chain(player, after ? [{ item: used, text: words }, { text: after }] : [{ item: used, text: words }]);
  }

  // ---------------------------------------------------------------------------
  // The bank: booth, wall, Cornelius (170 -> 200)
  // ---------------------------------------------------------------------------

  function inspectBooth(event) {
    const { player } = event;
    if (event.objectId !== BOOTH_LOC || !inRange(player, STAGE.CELLAR_CLEARED, STAGE.COMPLETE)) return false;
    if (stage(player) < STAGE.STORE_STOCKED) return common.mesbox(player, TEXT.booth), true; // Ours
    const has = (p) => planksAndNails(2, 8)(p) && common.held(p, SWAMP_PASTE);
    inspectThenAsk(player, TEXT.booth, "Fix the booth?", has, TEXT.noBooth, (p) => repair(p, {
      varbit: VARBIT.BANK_BOOTH,
      has,
      take: (q) => { takePlanksAndNails(2, 8)(q); q.getInventory().deleteNumber(SWAMP_PASTE, 1); },
      done: (q) => { state.set(q, VARBIT.BANK_BOOTH, 1); state.advance(q, STAGE.BOOTH_FIXED); },
      box: (q) => common.doubleBox(q, [SWAMP_PASTE, PLANK], TEXT.boothFixed),
    }));
    return true;
  }

  /** 1977 = 1 shows 12798 "Bank Booth" (Bank, Collect) at once; the Wiki: nobody serves until Cornelius is recruited. */
  function useBooth(event) {
    const { player } = event;
    if (event.objectId !== BOOTH_LOC) return false;
    if (!state.get(player, VARBIT.BANK_TELLER)) return common.mesbox(player, TEXT.noBanker), true;
    return false; // BankBooths opens the bank once bankBoothClosed answers open
  }

  /** "bank:booth-closed": Burgh's booth has nobody serving until Cornelius is recruited (1979). */
  function bankBoothClosed(request) {
    if (request.objectId !== BOOTH_LOC || !request.player) return;
    if (!state.get(request.player, VARBIT.BANK_TELLER)) request.closed = true;
  }

  function inspectBankWall({ player }) {
    if (!inRange(player, STAGE.CELLAR_CLEARED, STAGE.COMPLETE)) return false;
    // The wall waits for the booth (live fixed the booth first, t2046 then t2060). Ours: the text alone before.
    if (!state.get(player, VARBIT.BANK_BOOTH)) return common.mesbox(player, TEXT.wall), true;
    const has = planksAndNails(3, 12);
    inspectThenAsk(player, TEXT.wall, "Fix the wall?", has, TEXT.noPlanks, (p) => repair(p, {
      varbit: VARBIT.BANK_WALL,
      has, take: takePlanksAndNails(3, 12),
      done: (q) => { state.set(q, VARBIT.BANK_WALL, 1); state.advance(q, STAGE.BANK_WALL_FIXED); },
      box: (q) => common.doubleBox(q, [PLANK, STEEL_NAILS], TEXT.wallFixed),
    }));
    return true;
  }

  /** "Cornelius gets changed...": fade out with the mesbox (t2088), 1979 and 200 two ticks on, fade in a tick later. */
  function recruitCornelius(event) {
    const { player } = event;
    event.box = { statement: true, holdTicks: 3 };
    Scenes.fade(player, true);
    common.later(player, 2, (p) => {
      state.set(p, VARBIT.BANK_TELLER, 1);
      state.advance(p, STAGE.BANKER);
    });
    common.later(player, 3, (p) => Scenes.fade(p, false));
  }

  // ---------------------------------------------------------------------------
  // The furnace: chimney (-> 210) and fuel (1980 = 2)
  // ---------------------------------------------------------------------------

  function inspectBrokenFurnace(event) {
    const { player } = event;
    if (event.objectId !== FURNACE_LOC || !inRange(player, STAGE.CELLAR_CLEARED, STAGE.COMPLETE)) return false;
    if (stage(player) < STAGE.BANKER) return common.mesbox(player, TEXT.furnace), true; // Ours
    const has = (p) => hasHammer(p) && common.held(p, STEEL_BAR, 2);
    inspectThenAsk(player, TEXT.furnace, "Fix the chimney?", has, TEXT.noBars, (p) => repair(p, {
      varbit: VARBIT.FURNACE,
      hammer: HAMMER_STEEL, has,
      take: (q) => q.getInventory().deleteNumber(STEEL_BAR, 2),
      done: (q) => { state.set(q, VARBIT.FURNACE, 1); state.advance(q, STAGE.FURNACE_FIXED); },
      box: (q) => common.itemBox(q, STEEL_BAR, TEXT.furnaceFixed),
    }));
    return true;
  }

  function inspectRepairedFurnace(event) {
    const { player } = event;
    if (event.objectId !== FURNACE_LOC || state.get(player, VARBIT.FURNACE) !== 1) return false; // 2 is Tithe's lighting
    inspectThenAsk(player, TEXT.fuel, "Refuel the furnace?", (p) => common.held(p, COAL), TEXT.noCoal, refuel);
    return true;
  }

  /** t2193: pickup-table anim, the coal goes, m2_fillcoal; t2194: 1980 = 2 and the coal box. No stage change. */
  function refuel(player) {
    common.anim(player, PICKUP_TABLE);
    player.getInventory().deleteNumber(COAL, 1);
    common.sound(player, FILL_COAL);
    common.later(player, 1, (p) => {
      state.set(p, VARBIT.FURNACE, 2);
      common.itemBox(p, COAL, TEXT.fuelled);
    });
  }

  // ---------------------------------------------------------------------------
  // Talks
  // ---------------------------------------------------------------------------

  function talkAurel(event) {
    const { player } = event;
    if (!inRange(player, STAGE.CELLAR_CLEARED, STAGE.GADDERANKS)) return false;
    const handIn = stage(player) === STAGE.CRATE_GIVEN && common.held(player, CRATE) && crateFull(player);
    common.play(player, AUREL, handIn ? VARIANT.handIn : VARIANT.aurel, null, PAGE, event.npc);
    return true;
  }

  /** Aurel's Trade before the stock is in: his refusal (Ours: the transcript's line, no capture). */
  function tradeAurel({ player }) {
    if (!inRange(player, STAGE.CELLAR_CLEARED, STAGE.STORE_STOCKED)) return false;
    common.chain(player, [{ npc: AUREL, text: TEXT.noStock }]);
    return true;
  }

  function citizenVariant(player) {
    const s = stage(player);
    if (s < STAGE.STORE_AGREED) return VARIANT.afterInn;
    if (s < STAGE.STORE_STOCKED) return VARIANT.storeCitizens;
    if (s < STAGE.BANKER) return VARIANT.bankCitizens;
    return VARIANT.furnaceCitizens;
  }

  function talkCitizen(event) {
    const { player } = event;
    if (!inRange(player, STAGE.CELLAR_CLEARED, STAGE.FURNACE_LIT)) return false;
    common.play(player, npcIdOf(event), citizenVariant(player), null, PAGE, event.npc);
    return true;
  }

  /** The recruiting page after the bank citizens' "...You'll have to recruit someone!" (t2078-2088). */
  function playRecruiting(player, npc) {
    common.play(player, CORNELIUS, VARIANT.recruit, (raw) => {
      const choice = raw.find((step) => step?.type === "choice");
      return choice?.options?.[0]?.steps?.slice(2) ?? [];
    }, PAGE, npc);
  }

  // ---------------------------------------------------------------------------
  // Dialogue events
  // ---------------------------------------------------------------------------

  function onLine(request) {
    const { player, text } = request;
    if (!player || !ownsPage(request.pages) || typeof text !== "string") return;
    const npcId = request.definition?.getId?.() ?? request.npcId;
    if (text === TEXT.agreed && npcId === AUREL && inRange(player, STAGE.CELLAR_CLEARED, STAGE.STORE_AGREED)) {
      request.before = () => state.advance(player, STAGE.STORE_AGREED);
    } else if (text === TEXT.stockLine && inRange(player, STAGE.WALL_FIXED, STAGE.STORE_STOCKED)) {
      const asked = foodChoice(player) === FOOD_MACKEREL ? CRATE_MACKEREL.asked : CRATE_SNAILS.asked;
      request.text = text.replace("snails of any type/raw mackerel", asked);
    } else if (text === TEXT.stockAgain && inRange(player, STAGE.CRATE_GIVEN, STAGE.STORE_STOCKED)) {
      request.text = text.replace("[snails of any type/raw mackerel]", savedFood(player).asked);
    } else if (text === TEXT.furnaceTold && inRange(player, STAGE.BANKER, STAGE.FURNACE_TOLD)) {
      request.before = () => state.advance(player, STAGE.FURNACE_TOLD);
    } else if (text === TEXT.recruitCue && stage(player) === STAGE.BANK_WALL_FIXED
      && (npcId === CORNELIUS || request.definition?.getName?.() === "Cornelius")) {
      request.after = () => playRecruiting(player, request.npc);
    }
  }

  function onAction(event) {
    const { player, stepId } = event;
    if (!player || !ownsPage(event.pages)) return;
    switch (stepId) {
      case "LM3qbj": // "Aurel gives you a crate." (t1369: 165, the crate and its objectbox together)
        if (stage(player) !== STAGE.WALL_FIXED) return;
        if (common.freeSlots(player) < 1 && !common.held(player, CRATE)) {
          // Ours: no capture of a full bag; the stage stays so Aurel can be asked again.
          event.handled = true;
          event.end = true;
          player.sendMessage("You don't have enough inventory space.");
          return;
        }
        if (!common.held(player, CRATE)) player.getInventory().add(new Item(CRATE, 1));
        player.setAttribute(CRATE_FOOD_ATTRIBUTE, foodChoice(player));
        pendingFood.delete(player);
        state.advance(player, STAGE.CRATE_GIVEN);
        event.box = { items: [CRATE] };
        return;
      case "UsJ9P-": // "You show the full crate to Aurel..." (t1991, an objectbox; nothing changes yet)
        if (stage(player) === STAGE.CRATE_GIVEN) event.box = { items: [CRATE] };
        return;
      case "WMcYsv": // "Aurel quickly puts the stock out around the shop." (t1995)
        if (stage(player) !== STAGE.CRATE_GIVEN || !common.held(player, CRATE)) return;
        player.getInventory().deleteNumber(CRATE, 1);
        state.set(player, VARBIT.STORE_STOCKED, 1);
        state.advance(player, STAGE.STORE_STOCKED);
        event.box = { statement: true };
        return;
      case "rqRnfa": // Cornelius gets changed (t2088-2091)
        if (stage(player) === STAGE.BANK_WALL_FIXED) recruitCornelius(event);
        return;
      default:
    }
  }

  /** "Asking again" with no crate on you: Aurel's crate again, emptied (Ours: no capture of a lost crate). */
  function onChosen({ player, stepId }) {
    if (stepId !== "IWXcv-" || !player || stage(player) !== STAGE.CRATE_GIVEN || common.held(player, CRATE)) return;
    if (common.freeSlots(player) < 1) return;
    for (const part of crateParts(player)) state.set(player, part.varbit, 0);
    player.getInventory().add(new Item(CRATE, 1));
  }

  /** Branch guards of Aurel's and the citizens' pages for 110-229 (live's menus at t1296, t1349, t2018, t2066). */
  function answer({ player, npcId, stepId, pages }) {
    if (!player || !stepId || !ownsPage(pages)) return null;
    const s = stage(player);
    if (s < STAGE.CELLAR_CLEARED || s >= STAGE.GADDERANKS) return null;
    switch (stepId) {
      // Aurel's greetings.
      case "UXJgpJ": return s < STAGE.STORE_AGREED;
      case "_npW-_": return s >= STAGE.STORE_AGREED && s < STAGE.WALL_FIXED;
      case "tg-CGu": return s === STAGE.WALL_FIXED;
      case "otUEZ9": return s === STAGE.CRATE_GIVEN;
      case "4l7-ER": return s >= STAGE.STORE_STOCKED;
      // Options that only show once earned.
      case "b7ccV7": case "L1-zEZ": return s >= STAGE.STORE_STOCKED;
      case "YHTmxL": return s >= STAGE.STORE_AGREED;
      // Aurel's answers.
      case "q11mmS": return s < STAGE.STORE_STOCKED;
      case "0EKc0N": return s >= STAGE.STORE_STOCKED;
      case "I7YCBd": return s < STAGE.STORE_AGREED;
      case "LaTy2V": return s >= STAGE.STORE_AGREED && s < STAGE.WALL_FIXED;
      case "Dc8raD": return s >= STAGE.WALL_FIXED;
      case "JUDmdl": return s < STAGE.STORE_AGREED;
      case "p6H5tu": return s >= STAGE.STORE_AGREED;
      case "1DySuL": return false; // a missing step in the transcript
      case "J1ZK_f": return s < STAGE.WALL_FIXED;
      case "A1yJWY": return s === STAGE.WALL_FIXED;
      case "IWXcv-": return s >= STAGE.CRATE_GIVEN;
      // The store citizens.
      case "FKIrpJ": case "g5f2rH": case "cYi4uy": return s < STAGE.WALL_FIXED;
      case "z5DSgt": case "Vvvn5u": case "ISchD_": return s >= STAGE.WALL_FIXED;
      // The bank citizens.
      case "R_OWWb": return s >= STAGE.BOOTH_FIXED && s < STAGE.BANK_WALL_FIXED;
      case "A9Xs3G": return s >= STAGE.BANK_WALL_FIXED;
      case "Wrtbva": return false; // live at 170 went back to the menu after the store line (t2026-2029)
      case "Ku941Z": return s < STAGE.BOOTH_FIXED;
      case "lUjsKV": return s >= STAGE.BOOTH_FIXED && s < STAGE.BANK_WALL_FIXED;
      case "XNcdpB": return s >= STAGE.BANK_WALL_FIXED;
      // The furnace citizens.
      case "uiO8O9": return npcId === CORNELIUS || npcId === N.CORNELIUS_2;
      default: return null;
    }
  }

  /**
   * Menus as live drew them: Aurel stops offering "I'd like to help fix up the town." once the roof and
   * wall are done (t1349); the bank citizens' two half-menus (split in the transcript dump) are one
   * five-option menu (t2018).
   */
  function onMenu(notice) {
    const { player } = notice;
    if (!player || !Array.isArray(notice.options) || !inRange(player, STAGE.CELLAR_CLEARED, STAGE.GADDERANKS)) return;
    const texts = notice.options.map((option) => option?.text);
    if (notice.npcId === AUREL && stage(player) >= STAGE.WALL_FIXED && texts.includes(TEXT.helpOption)) {
      notice.options = notice.options.filter((option) => option?.text !== TEXT.helpOption);
      return;
    }
    if (inRange(player, STAGE.STORE_STOCKED, STAGE.BANKER) && texts.length === 2
      && texts[0] === "What do you do here?" && texts[1] === "What do you think of your town?") {
      const steps = loadTranscripts(api)?.[PAGE]?.variants?.[VARIANT.bankCitizens] ?? [];
      const choices = steps.filter((step) => step?.type === "choice");
      const half = (choice) => choice.options.map((option) => option.text).join("|");
      if (choices.length === 2 && half(choices[0]) === texts.join("|")) {
        notice.options = [...notice.options, ...choices[1].options];
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  api.persistAttribute(CRATE_FOOD_ATTRIBUTE, 0);
  api.onObjectInteraction("Broken Roof", { Inspect: inspectRoof });
  api.onObjectInteraction("Damaged wall", { Inspect: inspectWall });
  api.onObjectInteraction("Bank Booth", { Inspect: inspectBooth, Bank: useBooth, Collect: useBooth });
  api.onObjectInteraction("Broken furnace", { Inspect: inspectBrokenFurnace });
  api.onObjectInteraction("Repaired furnace", { Inspect: inspectRepairedFurnace });
  api.onItemAction("Crate", { Search: searchCrate });
  api.onItemOnItem(useOnCrate);
  api.onNpcInteraction("Aurel", { "Talk-to": talkAurel, Trade: tradeAurel });
  api.onNpcsInteraction(CITIZENS, { "Talk-to": talkCitizen });
  api.onNpcDialogueCondition(answer);
  api.onCustomEvent("bank:booth-closed", bankBoothClosed);
  api.onCustomEvent("npc-dialogue:line", onLine);
  api.onCustomEvent("npc-dialogue:action", onAction);
  api.onCustomEvent("npc-dialogue:condition", onChosen);
  api.onCustomEvent("npc-dialogue:menu", onMenu);
};
