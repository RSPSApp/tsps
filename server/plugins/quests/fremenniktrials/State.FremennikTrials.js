/**
 * The Fremennik Trials: the state and helpers every trial unit shares.
 *
 * Live keeps all trial progress on the server: the only quest var it sends is `viking` (varp
 * 347), 1 + the number of trials passed while the quest runs and 10 once Brundt accepts the
 * player (rsprox 1002236, rev 242: 0->1 t3169 ... 8->10 t10305). Our durable stage is 1..7 with
 * 8 complete (`quest.fremennik_trials.stage`), and the trials (0 none / 1 started / 2 done) are
 * three bits each in `quest.fremennik_trials.trials`.
 *
 * The units hook the dialogue engine through the registries here, so the main file's single
 * set of "npc-dialogue:*" listeners asks each unit in turn:
 *
 * - `variant(ids, fn)`: `fn(player, stage, npcId)` picks a variant for those NPCs (or null).
 *   `chainVariant(fn)` runs before every NPC's own (Sigmund's trading chain).
 * - `condition(fn)`: `fn({ player, npcId, text, value })` answers a prose condition (or null).
 * - `conditionStep(id, fn)`, `action(id, fn)`, `choice(fn)`, `line(fn)`: transcript events.
 * - `offer(ids, fn)`: the trial offer that "Ask about becoming a Fremennik" replays.
 */
function createFremennikTrialsState(api) {
  const { ItemIdentifiers, NpcIdentifiers, Location, Skill } = api.core;
  const { startTranscript } = require("../QuestRuntime");

  const PAGE = "The Fremennik Trials";
  const VARP = 347;
  const STAGE_STARTED = 1;
  const STAGE_COMPLETE = 8;
  const VOTES_REQUIRED = 7;

  const TRIALS_ATTRIBUTE = "quest.fremennik_trials.trials";
  const FLAGS_ATTRIBUTE = "quest.fremennik_trials.flags";

  const T = { REVELLER: 0, BARD: 1, MERCHANT: 2, NAVIGATOR: 3, SEER: 4, WARRIOR: 5, HUNTER: 6 };

  const FLAG = {
    FIRECRACKER: 0,
    LOW_ALCOHOL: 1,
    SOUP_ROCK: 2,
    SOUP_CABBAGE: 3,
    SOUP_POTATO: 4,
    SOUP_ONION: 5,
    DRAUGEN: 6,
    NAVIGATOR: 7,
    LOW_ALCOHOL_BOUGHT: 8,
    SEER_RIDDLE: 9,
    MURAL_OLD_DISK: 10,
    MURAL_RED_DISK: 11,
  };

  const ids = (...list) => new Set(list.filter((id) => Number.isInteger(id)));
  const N = NpcIdentifiers;
  const NPC = {
    BRUNDT: ids(N.BRUNDT_THE_CHIEFTAIN, N.BRUNDT_THE_CHIEFTAIN_2, N.BRUNDT_THE_CHIEFTAIN_3, N.BRUNDT_THE_CHIEFTAIN_4,
      N.BRUNDT_THE_CHIEFTAIN_5, N.BRUNDT_THE_CHIEFTAIN_6, N.BRUNDT_THE_CHIEFTAIN_7, N.BRUNDT_THE_CHIEFTAIN_8,
      N.BRUNDT_THE_CHIEFTAIN_9, N.BRUNDT_THE_CHIEFTAIN_10, N.BRUNDT_THE_CHIEFTAIN_11, N.BRUNDT_THE_CHIEFTAIN_12),
    OLAF: ids(N.OLAF_THE_BARD, N.OLAF_THE_BARD_2),
    LALLI: ids(N.LALLI),
    MANNI: ids(N.MANNI_THE_REVELLER, N.MANNI_THE_REVELLER_2),
    SIGLI: ids(N.SIGLI_THE_HUNTSMAN),
    SIGMUND: ids(N.SIGMUND_THE_MERCHANT),
    THORVALD: ids(N.THORVALD_THE_WARRIOR, N.THORVALD_THE_WARRIOR_2, N.THORVALD_THE_WARRIOR_3),
    PEER: ids(N.PEER_THE_SEER, N.PEER_THE_SEER_2),
    SWENSEN: ids(N.SWENSEN_THE_NAVIGATOR, N.SWENSEN_THE_NAVIGATOR_2),
    ASKELADDEN: ids(N.ASKELADDEN, N.ASKELADDEN_2, N.ASKELADDEN_3, N.ASKELADDEN_4),
    THORA: ids(N.THORA_THE_BARKEEP, N.THORA_THE_BARKEEP_2),
    YRSA: ids(N.YRSA_2),
    FISHERMAN: ids(N.FISHERMAN),
    SKULGRIMEN: ids(N.SKULGRIMEN),
    SAILOR: ids(N.SAILOR, N.SAILOR_2),
    COUNCIL_WORKMAN: N.COUNCIL_WORKMAN,
    POISON_SALESMAN: N.POISON_SALESMAN,
    LONGHALL_BOUNCER: N.LONGHALL_BOUNCER,
    FOSSEGRIMEN: N.FOSSEGRIMEN,
  };

  /** NPCs whose transcripts this quest owns; dialogue conditions from anyone else are not ours. */
  const DIALOGUE_NPC_IDS = new Set([
    ...NPC.BRUNDT, ...NPC.OLAF, ...NPC.LALLI, ...NPC.MANNI, ...NPC.SIGMUND, ...NPC.SIGLI, ...NPC.SWENSEN,
    ...NPC.PEER, ...NPC.THORVALD, ...NPC.ASKELADDEN, ...NPC.THORA, ...NPC.YRSA, ...NPC.FISHERMAN,
    ...NPC.SKULGRIMEN, ...NPC.SAILOR, NPC.COUNCIL_WORKMAN, NPC.POISON_SALESMAN, NPC.LONGHALL_BOUNCER,
    NPC.FOSSEGRIMEN,
  ].filter((id) => Number.isInteger(id)));

  const SIGMUND = "the-council-members-sigmund-the-merchant-s-small-favour";
  const SAILOR_FAVOR = `${SIGMUND}-the-sailor-s-favor`;
  const SWENSEN_FAVOR = `${SAILOR_FAVOR}-talking-to-swensen-the-navigator`;

  let quest = null;

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const give = (player, itemId, amount = 1) => player.getInventory().adds(itemId, amount);
  const take = (player, itemId, amount = 1) => player.getInventory().deleteNumber(itemId, amount);
  const skill = (player, s) => player.getSkillManager().getCurrentLevel(s);

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull?.() === true ? 0 : 1;
  }

  /** Replaces the item in `slot` (or the first of `fromId`) with `toId`, as live swaps in place. */
  function swapInSlot(player, fromId, toId, slot) {
    const inventory = player.getInventory();
    let index = Number.isInteger(slot) && inventory.forSlot(slot)?.getId() === fromId ? slot : inventory.getSlot?.(fromId);
    if (!Number.isInteger(index) || index < 0) return false;
    inventory.setItem(index, new api.core.Item(toId, 1));
    inventory.refreshItems();
    return true;
  }

  function readAttribute(player, key) {
    const value = Number(player.getAttribute(key));
    return Number.isFinite(value) ? value | 0 : 0;
  }

  function trialState(player, index) {
    return (readAttribute(player, TRIALS_ATTRIBUTE) >>> (index * 3)) & 0x7;
  }

  function setTrialState(player, index, value) {
    const shift = index * 3;
    const current = readAttribute(player, TRIALS_ATTRIBUTE);
    player.setAttribute(TRIALS_ATTRIBUTE, (current & ~(0x7 << shift)) | ((value & 0x7) << shift));
  }

  function flag(player, bit) {
    return ((readAttribute(player, FLAGS_ATTRIBUTE) >>> bit) & 1) === 1;
  }

  function setFlag(player, bit, on = true) {
    const current = readAttribute(player, FLAGS_ATTRIBUTE);
    player.setAttribute(FLAGS_ATTRIBUTE, on ? current | (1 << bit) : current & ~(1 << bit));
  }

  function votesFor(player) {
    let count = 0;
    for (let index = 0; index <= T.HUNTER; index++) if (trialState(player, index) === 2) count++;
    return count;
  }

  /** Live: 1 + trials passed while running, 10 once complete (cache DB completion threshold). */
  function nativeProgress(stage, player) {
    if (stage >= STAGE_COMPLETE) return 10;
    if (stage <= 0) return 0;
    return Math.max(stage, Math.min(8, 1 + votesFor(player)));
  }

  /**
   * A trial passed: its vote counts and `viking` goes up by one. Live sends no generic message;
   * each trial's own line (a dialogue message step or the unit) says it.
   */
  function completeTrial(player, index) {
    if (trialState(player, index) === 2) return false;
    setTrialState(player, index, 2);
    const stage = quest.getStage(player);
    if (stage < STAGE_COMPLETE - 1) quest.setStage(player, stage + 1);
    else player.getPacketSender().sendConfig(VARP, nativeProgress(stage, player));
    return true;
  }

  function inBox(player, minX, maxX, minY, maxY, z) {
    const location = player.getLocation();
    const x = location.getX();
    const y = location.getY();
    if (z !== undefined && location.getZ() !== z) return false;
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }

  const inRellekka = (player) => inBox(player, 2590, 2760, 3610, 3710);
  const carryingAnything = (player) =>
    player.getInventory().getValidItems().length > 0 || player.getEquipment().getValidItems().length > 0;

  /** Plays one of this quest's variants for `npcId` (optionally only the steps `select` keeps). */
  function play(player, npcId, variant, select) {
    return startTranscript(api, player, npcId, PAGE, variant, select);
  }

  /** The steps with `id` anywhere in a variant's tree (a branch replayed on its own). */
  function stepsById(id) {
    const find = (steps) => {
      for (const step of steps ?? []) {
        if (step.id === id) return [step];
        for (const option of step.options ?? []) {
          const found = find(option.steps);
          if (found) return found;
        }
        const found = find(step.steps);
        if (found) return found;
      }
      return undefined;
    };
    return (steps) => find(steps) ?? [];
  }

  /** Runs `callback` after `ticks` game ticks for a still-online player. */
  function later(player, ticks, callback) {
    api.core.TaskManager.submit(new api.core.CountdownTask(player, ticks, () => {
      if (player.isRegistered?.() === false) return;
      callback();
    }));
  }

  const registry = {
    chain: [],
    variants: [],
    conditions: [],
    conditionSteps: new Map(),
    actions: new Map(),
    choices: [],
    lines: [],
    offers: [],
  };

  const ctx = {
    api,
    PAGE,
    VARP,
    STAGE_STARTED,
    STAGE_COMPLETE,
    VOTES_REQUIRED,
    TRIALS_ATTRIBUTE,
    FLAGS_ATTRIBUTE,
    T,
    FLAG,
    NPC,
    DIALOGUE_NPC_IDS,
    I: ItemIdentifiers,
    Location,
    Skill,
    SIGMUND,
    SAILOR_FAVOR,
    SWENSEN_FAVOR,
    get quest() { return quest; },
    setQuest(value) { quest = value; },
    held, give, take, skill, freeSlots, swapInSlot, readAttribute, trialState, setTrialState, flag, setFlag,
    votesFor, nativeProgress, completeTrial, inBox, inRellekka, carryingAnything, play, stepsById, later,
    registry,
    chainVariant(fn) { registry.chain.push(fn); },
    variant(npcIds, fn) {
      const set = npcIds instanceof Set ? npcIds : new Set([].concat(npcIds));
      registry.variants.push({ ids: set, fn });
    },
    condition(fn) { registry.conditions.push(fn); },
    conditionStep(id, fn) { registry.conditionSteps.set(id, fn); },
    action(id, fn) { registry.actions.set(id, fn); },
    choice(fn) { registry.choices.push(fn); },
    line(fn) { registry.lines.push(fn); },
    offer(npcIds, fn) {
      const set = npcIds instanceof Set ? npcIds : new Set([].concat(npcIds));
      registry.offers.push({ ids: set, fn });
    },
  };

  api.persistAttribute(TRIALS_ATTRIBUTE, 0);
  api.persistAttribute(FLAGS_ATTRIBUTE, 0);
  return ctx;
}

module.exports = { createFremennikTrialsState };
