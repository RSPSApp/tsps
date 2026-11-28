/**
 * Eagles' Peak's native state, as live keeps it (RSProx capture EaglesPeak+AllUnlocks, rev 243;
 * facts in docs/quests/eagles-peak/README.md):
 * - eaglepeak_quest (2780, varp 934 bits 0-5) is the quest's own stage and the saved stage here:
 *   0, 5 accepted (t86), 10 bird book read (t245), 15 cliff opened (t280), 20 last feather in the
 *   eagle door (t1941), 25 disguise given (t2025), 30 out of the cave (t2094), 35 ferret caught
 *   (t2247), 40 complete (t2438);
 * - the side varbits the cache's multilocs and multinpcs read: the camp, the cave entrance, the
 *   eagle door leaves (3106, 3099), the gold room's levers (3090-3093), the silver room's footprints
 *   (3099), Nickolaus (2023/2024) and the far eyries' eagles (1491-1493) all show from these alone.
 * Each side varbit the quest owns is saved in one attribute and sent again at login.
 * eaglepeak_unblocked_jungle/desert and eaglepeak_jungle_vine belong to EagleTransport.
 */
module.exports = function createEaglesPeakState(api) {
  const { ItemIdentifiers: I, NpcIdentifiers: N } = api.core;

  const STAGE = Object.freeze({
    NOT_STARTED: 0,
    STARTED: 5,
    BOOK_READ: 10,
    CAVE_OPEN: 15,
    DOOR_OPEN: 20,
    DISGUISE_GIVEN: 25,
    LEFT_NEST: 30,
    FERRET_CAUGHT: 35,
    COMPLETE: 40,
  });

  const VARP = Object.freeze({ MAIN: 934 });

  const VARBIT = Object.freeze({
    QUEST: 2780,
    /** puzzle1_reset: gate1-4 (1, 2, 4, 8) then mechbird1-5 (16 ... 256). */
    GOLD: 3089,
    TRACKING: 3099,
    /** puzzle3_allwinches: winch1-4 (1, 2, 4, 8). */
    WINCHES: 3100,
    NET_TRAP: 3105,
    /** eagledoor_status: feather1 (the golden one) 1, feather3 (the bronze one) 2. */
    DOOR: 3106,
    NICKOLAUS_CHAT: 3110,
    ENTERED_GOLD: 3111,
    ENTERED_SILVER: 3112,
    ENTERED_BRONZE: 3113,
  });
  /** Saved and sent at login; the order only matters for readability. */
  const OWNED_VARBITS = Object.freeze([
    VARBIT.GOLD, VARBIT.TRACKING, VARBIT.WINCHES, VARBIT.NET_TRAP, VARBIT.DOOR, VARBIT.NICKOLAUS_CHAT,
    VARBIT.ENTERED_GOLD, VARBIT.ENTERED_SILVER, VARBIT.ENTERED_BRONZE,
  ]);

  const DOOR_GOLD = 1;
  const DOOR_BRONZE = 2;
  const DOOR_BOTH = DOOR_GOLD | DOOR_BRONZE;
  const ALL_WINCHES = 15;
  /** 3099 values: pedestal seen 1, first rock 2, second rock 3, kebbit out 4, kebbit dealt with 5, feather in the door 6. */
  const TRACK = Object.freeze({ PEDESTAL: 1, ROCK_1: 2, ROCK_2: 3, KEBBIT_OUT: 4, FEATHER_DROPPED: 5, IN_DOOR: 6 });
  /** 3110 values: seen across the chasm 1, first menu 2, disguise asked for 3, told Asyff 4, costumes made 5. */
  const CHAT = Object.freeze({ SPOTTED: 1, TALKED: 2, AGREED: 3, ASKED_ASYFF: 4, COSTUMES_MADE: 5 });

  const ITEM = Object.freeze({
    BIRD_BOOK: I.BIRD_BOOK, // 10173 hunting_book_of_birds
    METAL_FEATHER: I.METAL_FEATHER, // 10174
    GOLDEN_FEATHER: I.GOLDEN_FEATHER_2, // 10175 eaglepeak_crystal_feather1
    SILVER_FEATHER: I.SILVER_FEATHER, // 10176 eaglepeak_crystal_feather2
    BRONZE_FEATHER: I.BRONZE_FEATHER, // 10177 eaglepeak_crystal_feather3
    BIRD_SEED: I.ODD_BIRD_SEED, // 10178
    JOURNAL: I.FEATHERED_JOURNAL, // 10179 ep_transport_book01
    EAGLE_FEATHER: I.EAGLE_FEATHER, // 10167
    EAGLE_CAPE: I.EAGLE_CAPE, // 10171
    FAKE_BEAK: I.FAKE_BEAK, // 10172
    FERRET: I.FERRET, // 10092 hunting_ferret
    BOX_TRAP: I.BOX_TRAP, // 10008
    SWAMP_TAR: I.SWAMP_TAR,
    YELLOW_DYE: I.YELLOW_DYE,
    COINS: I.COINS,
    BONES: I.BONES,
  });

  const NPC = Object.freeze({
    CHARLIE: N.CHARLIE_2, // 1495 eaglepeak_zookeeper_charlie
    ASYFF: N.ASYFF, // 2887 tailorp
    NICKOLAUS_NEST: 2023, // eaglepeak_nickolaus: 1484 at 15, 1485 at 20, 1486 at 25
    NICKOLAUS_CAMP: 2024, // eaglepeak_nickolaus_campsite: 1485 at 0 and 25+
    NICKOLAUS_CRAWL: N.NICKOLAUS, // 1483, the ferret lesson's actor
    NICKOLAUS_SHOUT: N.NICKOLAUS_2, // 1484
    NICKOLAUS_NORMAL: N.NICKOLAUS_3, // 1485
    NICKOLAUS_DISGUISE: N.NICKOLAUS_4, // 1486
    EAGLE: N.EAGLE, // 1490 eaglepeak_eagle_guard
    KEBBIT: N.KEBBIT, // 1494 eaglepeak_uber_kebbit
    FERRET: N.FERRET, // 1505 hunting_ferret
  });

  const STATE_ATTRIBUTE = "eagles-peak:varbits";
  const FORMAT_ATTRIBUTE = "eagles-peak:stage-format";
  const FORMAT = 1;
  /** The older plugin's own attributes, read once by convertOldSave and cleared. */
  const OLD_BITS_ATTRIBUTE = "quest.eagles_peak.bits";
  const OLD_GOLD_FED_ATTRIBUTE = "quest.eagles_peak.gold-fed";
  const OLD_GOLD_LEVERS_ATTRIBUTE = "quest.eagles_peak.gold-levers";

  let quest = null;

  function values(player) {
    const saved = player.getAttribute(STATE_ATTRIBUTE);
    return saved && typeof saved === "object" ? saved : {};
  }

  function get(player, varbit) {
    return Number(values(player)[varbit]) || 0;
  }

  function set(player, varbit, value) {
    player.setAttribute(STATE_ATTRIBUTE, { ...values(player), [varbit]: value | 0 });
    player.getPacketSender().sendVarbit(varbit, value | 0);
  }

  function stage(player) {
    return quest ? quest.getStage(player) : 0;
  }

  function setStage(player, value) {
    quest.setStage(player, value);
  }

  function sendAll(player) {
    const sender = player.getPacketSender();
    for (const varbit of OWNED_VARBITS) sender.sendVarbit(varbit, get(player, varbit));
  }

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const has = (player, itemId) => held(player, itemId) || player.getEquipment().contains?.(itemId) === true;

  // ==========================================================================
  // Saves from the older plugin (stages 1-8 and one bit attribute)
  // ==========================================================================

  const OLD_STAGE_NATIVE = { 1: STAGE.STARTED, 2: STAGE.BOOK_READ, 3: STAGE.CAVE_OPEN, 4: STAGE.CAVE_OPEN, 5: STAGE.CAVE_OPEN,
    6: STAGE.LEFT_NEST, 7: STAGE.FERRET_CAUGHT, 8: STAGE.COMPLETE };
  const OLD = Object.freeze({ TRAP: 1 << 2, WINCHES: [1 << 3, 1 << 4, 1 << 5, 1 << 6], TRAIL_1: 1 << 7, TRAIL_2: 1 << 8,
    KEBBIT_DEALT: 1 << 9, KEBBIT_OUT: 1 << 10, ASYFF_ASKED: 1 << 11, BRONZE: 1 << 13, SILVER: 1 << 14, GOLD: 1 << 15, PEDESTAL: 1 << 16 });

  function convertOldSave(player) {
    if (Number(player.getAttribute(FORMAT_ATTRIBUTE)) === FORMAT) return;
    const old = stage(player);
    if (old >= 1 && old <= 8) {
      const bits = Number(player.getAttribute(OLD_BITS_ATTRIBUTE)) || 0;
      const done = old >= 6;
      const winches = OLD.WINCHES.reduce((sum, bit, index) => sum | ((bits & bit) ? 1 << index : 0), 0);
      let tracking = 0;
      if (bits & OLD.PEDESTAL) tracking = TRACK.PEDESTAL;
      if (bits & OLD.TRAIL_1) tracking = TRACK.ROCK_1;
      if (bits & OLD.TRAIL_2) tracking = TRACK.ROCK_2;
      if (bits & OLD.KEBBIT_OUT) tracking = TRACK.KEBBIT_OUT;
      if (bits & OLD.KEBBIT_DEALT) tracking = TRACK.FEATHER_DROPPED;
      if ((bits & OLD.SILVER) || done) tracking = TRACK.IN_DOOR;
      const door = done ? DOOR_BOTH : ((bits & OLD.GOLD) ? DOOR_GOLD : 0) | ((bits & OLD.BRONZE) ? DOOR_BRONZE : 0);
      let chat = 0;
      if (old >= 4) chat = (bits & OLD.ASYFF_ASKED) ? CHAT.ASKED_ASYFF : CHAT.AGREED;
      if (old >= 5) chat = CHAT.COSTUMES_MADE;
      let native = OLD_STAGE_NATIVE[old];
      if (native === STAGE.CAVE_OPEN && door === DOOR_BOTH && tracking === TRACK.IN_DOOR) native = STAGE.DOOR_OPEN;
      quest.setStage(player, native);
      set(player, VARBIT.WINCHES, done ? ALL_WINCHES : winches);
      set(player, VARBIT.NET_TRAP, !done && (bits & OLD.TRAP) && winches !== ALL_WINCHES ? 1 : 0);
      set(player, VARBIT.TRACKING, tracking);
      set(player, VARBIT.DOOR, door);
      set(player, VARBIT.NICKOLAUS_CHAT, chat);
    }
    player.setAttribute(OLD_BITS_ATTRIBUTE, 0);
    player.setAttribute(OLD_GOLD_FED_ATTRIBUTE, 0);
    player.setAttribute(OLD_GOLD_LEVERS_ATTRIBUTE, 0);
    player.setAttribute(FORMAT_ATTRIBUTE, FORMAT);
  }

  function persist() {
    api.persistAttribute(STATE_ATTRIBUTE, {});
    api.persistAttribute(FORMAT_ATTRIBUTE, 0);
    api.persistAttribute(OLD_BITS_ATTRIBUTE, 0);
    api.persistAttribute(OLD_GOLD_FED_ATTRIBUTE, 0);
    api.persistAttribute(OLD_GOLD_LEVERS_ATTRIBUTE, 0);
  }

  return {
    STAGE, VARP, VARBIT, TRACK, CHAT, ITEM, NPC, DOOR_GOLD, DOOR_BRONZE, DOOR_BOTH, ALL_WINCHES,
    STATE_ATTRIBUTE, FORMAT_ATTRIBUTE, OLD_BITS_ATTRIBUTE,
    get, set, stage, setStage, sendAll, held, has, convertOldSave, persist,
    bindQuest(handle) { quest = handle; },
    get quest() { return quest; },
  };
};
