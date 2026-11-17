/**
 * The woodcutting stump in Neitiznot (loc iznot_shield_stump): Cut-wood splits arctic pine logs
 * and makes the Neitiznot shield. Facts in docs/split-logs.md.
 *
 * rsprox captures (rsprox.net recording 3027, rev 231, ticks 8906-11229):
 * - Cut-wood with arctic pine logs opens skillmulti mode 0, "How many do you wish to make?",
 *   with "Neitiznot shield" then "Arctic pine split log", up to the logs carried.
 * - Without arctic pine logs it sends "Only arctic pine may be cut here." and no menu.
 * - Choosing the split log: two ticks later, then every 3 ticks, one log in the inventory becomes
 *   a split log in the same slot, with "You split some arctic pine logs." (spam), the axe's
 *   human_woodcrafting_axe_* sequence (dragon axe: human_woodcrafting_axe_dragon), synth sound
 *   2101 and 5 Woodcutting XP.
 * - Choosing the shield without the parts sends "You need 2 arctic pine logs, a bronze nail and
 *   some rope to make a Neitiznot shield." The Fremennik Isles makes the shield itself
 *   ("woodcutting:stump-shield").
 *
 * Wiki (Split log): level 56 Woodcutting, boostable; 5 XP per log, with the lumberjack bonus;
 * 3 ticks per log.
 */
const SPLIT_LEVEL = 56;
const SPLIT_XP = 5;
const FIRST_TICK = 2;
const INTERVAL_TICKS = 3;
const SPLIT_SOUND = 2101;
const MENU_TITLE = "How many do you wish to make?";
const MENU_MODE = 0;
const NO_PINE = "Only arctic pine may be cut here.";
const SPLIT_MESSAGE = "You split some arctic pine logs.";
const NO_SHIELD_PARTS = "You need 2 arctic pine logs, a bronze nail and some rope to make a Neitiznot shield.";
const TASK_ATTRIBUTE = "woodcutting:split-logs-task";

/**
 * The axe's woodcrafting sequence, by the axe's gameval. Only the dragon axe's is captured; the
 * others are the cache's human_woodcrafting_axe_* / *_2h_axe sequence of the same axe (ours).
 */
const AXE_SEQUENCES = {
  BRONZE_AXE: "human_woodcrafting_axe_bronze",
  IRON_AXE: "human_woodcrafting_axe_iron",
  STEEL_AXE: "human_woodcrafting_axe_steel",
  BLACK_AXE: "human_woodcrafting_axe_black",
  MITHRIL_AXE: "human_woodcrafting_axe_mithril",
  ADAMANT_AXE: "human_woodcrafting_axe_adamant",
  RUNE_AXE: "human_woodcrafting_axe_rune",
  GILDED_AXE: "human_woodcrafting_axe_gilded",
  DRAGON_AXE: "human_woodcrafting_axe_dragon",
  _3RD_AGE_AXE: "human_woodcrafting_axe_3a",
  INFERNAL_AXE: "human_woodcrafting_axe_infernal",
  INFERNAL_AXE_UNCHARGED_: "human_woodcrafting_axe_infernal",
  INFERNAL_AXE_OR_: "human_woodcrafting_axe_trailblazer",
  INFERNAL_AXE_UNCHARGED__2: "human_woodcrafting_axe_trailblazer",
  INFERNAL_AXE_OR__3: "human_woodcrafting_axe_trailblazer_reloaded",
  INFERNAL_AXE_UNCHARGED__4: "human_woodcrafting_axe_trailblazer_reloaded",
  CRYSTAL_AXE: "human_woodcrafting_axe_crystal",
  CRYSTAL_AXE_INACTIVE_: "human_woodcrafting_axe_crystal",
  ECHO_AXE: "human_woodcrafting_axe_crystal",
  BRONZE_FELLING_AXE: "human_woodcrafting_bronze_2h_axe",
  IRON_FELLING_AXE: "human_woodcrafting_iron_2h_axe",
  STEEL_FELLING_AXE: "human_woodcrafting_steel_2h_axe",
  BLACK_FELLING_AXE: "human_woodcrafting_black_2h_axe",
  MITHRIL_FELLING_AXE: "human_woodcrafting_mithril_2h_axe",
  ADAMANT_FELLING_AXE: "human_woodcrafting_adamant_2h_axe",
  RUNE_FELLING_AXE: "human_woodcrafting_rune_2h_axe",
  DRAGON_FELLING_AXE: "human_woodcrafting_dragon_2h_axe",
  _3RD_AGE_FELLING_AXE: "human_woodcrafting_3a_2h_axe",
  CRYSTAL_FELLING_AXE: "human_woodcrafting_crystal_2h_axe",
  CRYSTAL_FELLING_AXE_INACTIVE_: "human_woodcrafting_crystal_inactive_2h_axe",
};

let api = null;
let core = null;
let deps = null;
let sequenceByAxeId = null;

function sequenceFor(axe) {
  if (!sequenceByAxeId) {
    sequenceByAxeId = new Map();
    for (const [gameval, seq] of Object.entries(AXE_SEQUENCES)) {
      const id = core.ItemIdentifiers[gameval];
      if (Number.isInteger(id)) sequenceByAxeId.set(id, core.CacheDefinitions.getSeqId(seq));
    }
  }
  return sequenceByAxeId.get(axe?.id) ?? sequenceByAxeId.get(core.ItemIdentifiers.BRONZE_AXE);
}

function stopSplitting(player) {
  player.getAttribute(TASK_ATTRIBUTE)?.stop();
}

/** Turns one carried arctic pine log into a split log in its own slot. */
function splitOne(player, axe) {
  const { ItemIdentifiers: I, Item, Skill, Animation, Sound, ChatType } = core;
  const inventory = player.getInventory();
  const slot = inventory.getSlotForItemId(I.ARCTIC_PINE_LOGS);
  if (slot < 0) return false;
  inventory.setItem(slot, new Item(I.SPLIT_LOG, 1));
  inventory.refreshItems();
  player.getPacketSender().sendTypedMessage(ChatType.SPAM, SPLIT_MESSAGE);
  player.performAnimation(new Animation(sequenceFor(axe)));
  player.getPacketSender().sendSoundEffect(SPLIT_SOUND, 1, 0, 0);
  const xp = SPLIT_XP * deps.lumberjackXpMultiplier(player);
  player.getSkillManager().addExperiences(Skill.WOODCUTTING, xp);
  api.emitCustomEvent("skills:produced", {
    player, skill: Skill.WOODCUTTING, itemId: I.SPLIT_LOG, amount: 1, xp, kind: "split-log",
    inputItemIds: [I.ARCTIC_PINE_LOGS], inputs: [{ itemId: I.ARCTIC_PINE_LOGS, amount: 1 }], outputItemId: I.SPLIT_LOG,
  });
  return true;
}

function startSplitting(player, amount) {
  if (player.getSkillManager().getCurrentLevel(core.Skill.WOODCUTTING) < SPLIT_LEVEL) {
    // Ours: not captured; the Wiki gives the level, not the refusal.
    player.sendMessage(`You need a Woodcutting level of ${SPLIT_LEVEL} to split arctic pine logs.`);
    return;
  }
  if (!deps.findBestUsableAxe(player)) {
    // Ours: not captured.
    player.sendMessage("You need an axe to split arctic pine logs.");
    return;
  }
  stopSplitting(player);
  const startLocation = player.getLocation().clone();
  const hasLog = () => player.getInventory().contains(core.ItemIdentifiers.ARCTIC_PINE_LOGS);

  class SplitTask extends core.Task {
    constructor() {
      super(1, player);
      this.ticks = 0;
      this.remaining = amount;
    }
    execute() {
      if (!player.isRegistered() || player.getHitpoints() <= 0 || player.getMovementQueue().size() > 0 ||
        !player.getLocation().equals(startLocation) || player.getInterfaceId() !== -1 || !hasLog()) {
        this.stop();
        return;
      }
      const tick = ++this.ticks;
      if (tick < FIRST_TICK || (tick - FIRST_TICK) % INTERVAL_TICKS !== 0) return;
      const axe = deps.findBestUsableAxe(player);
      if (player.getSkillManager().getCurrentLevel(core.Skill.WOODCUTTING) < SPLIT_LEVEL || !axe) {
        this.stop();
        return;
      }
      if (!splitOne(player, axe) || --this.remaining <= 0 || !hasLog()) this.stop();
    }
    stop() {
      super.stop();
      if (player.getAttribute(TASK_ATTRIBUTE) === this) player.setAttribute(TASK_ATTRIBUTE, null);
    }
  }

  const task = new SplitTask();
  player.setAttribute(TASK_ATTRIBUTE, task);
  api.getTaskManager().submit(task);
}

function makeShield(player) {
  const request = { player, handled: false };
  api.emitCustomEvent("woodcutting:stump-shield", request);
  if (request.handled) return;
  const inventory = player.getInventory();
  const I = core.ItemIdentifiers;
  if (inventory.getAmount(I.ARCTIC_PINE_LOGS) < 2 || !inventory.contains(I.BRONZE_NAILS) || !inventory.contains(I.ROPE)) {
    player.sendMessage(NO_SHIELD_PARTS);
  }
}

function cutWood(event) {
  const { player } = event;
  event.handled = true;
  const I = core.ItemIdentifiers;
  const logs = player.getInventory().getAmount(I.ARCTIC_PINE_LOGS);
  if (logs <= 0) {
    player.sendMessage(NO_PINE);
    return;
  }
  stopSplitting(player);
  const menu = new core.CreationMenu(
    MENU_TITLE,
    [I.NEITIZNOT_SHIELD, I.SPLIT_LOG],
    {
      execute: (itemId, amount) => {
        if (itemId === I.NEITIZNOT_SHIELD) makeShield(player);
        else if (itemId === I.SPLIT_LOG) startSplitting(player, amount);
      },
    },
    { labels: ["Neitiznot shield", "Arctic pine split log"], maxAmount: logs, mode: MENU_MODE }
  );
  player.getPacketSender().sendCreationMenu(menu);
}

function interruptSplitting({ player }) {
  stopSplitting(player);
}

function attach(pluginApi, woodcutting) {
  api = pluginApi;
  core = pluginApi.core;
  deps = woodcutting;
  sequenceByAxeId = null;
  api.onObjectInteraction("Woodcutting stump", { "Cut-wood": cutWood });
  api.onPlayerDisconnect(interruptSplitting);
  api.onCustomEvent("player:interaction-cleared", interruptSplitting);
  api.onCustomEvent("player:emote", interruptSplitting);
}

module.exports = { attach, SPLIT_MESSAGE, NO_PINE, NO_SHIELD_PARTS, SPLIT_XP, SPLIT_LEVEL };
