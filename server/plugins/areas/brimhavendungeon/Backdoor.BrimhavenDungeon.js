/**
 * Banisoch (karam_dungeon_backdoor) and the Brimhaven Dungeon's back entrance west of Tai Bwo
 * Wannai (brimhaven_backdoor_entrance), down to the bronze dragons, as the OSRS Wiki (Banisoch,
 * Brimhaven Dungeon) and rsprox recording 1002134 (ticks 5793-5843, 8373, 10114) have them:
 *
 * - The fee: 5,000 trading sticks, once. Paying sets karam_dungeon_backdoor to 1, which turns
 *   Banisoch into his paid form and the hole (brimhaven_backdoor_disabled, no options) into the
 *   rope (brimhaven_backdoor_enabled, Climb).
 * - Talk-to plays his transcript (npc-dialogues.json "Banisoch"): before paying or after, by the
 *   varbit. This unit answers its trading-stick conditions and takes the sticks on its payment
 *   line, which shows in an item box with the sticks and a rope, with the sticks' sound.
 * - Climb: until the player picks "Enter, and don't see this warning again." (the varbit's 2),
 *   his "I think there's dragons down there." and the three-way menu first. Going down is a fade
 *   out, the move to (2734, 9478, 0) a tick later with the tightrope sound, and the fade back in
 *   two ticks after that, the overlay closed with it.
 * - Using an item on the hole: a rope before paying, or anything on the rope after, gets his
 *   transcript's line for it.
 * - The crevice inside (brimhaven_backdoor_exit, Use): back up to the hole, for players who have
 *   paid (the Wiki: the fee is needed "either entering or exiting").
 */
const BACKDOOR_ATTRIBUTE = "brimhaven-dungeon:backdoor";

const BANISOCH = "Banisoch";
/** His two forms; the base npc (karam_dungeon_backdoor) has no name of its own. */
const BANISOCH_UNPAID_NPC = "karam_dungeon_backdoor_unpaid";
const BANISOCH_PAID_NPC = "karam_dungeon_backdoor_paid";
const ENTRANCE_LOC = "brimhaven_backdoor_entrance";
const EXIT_LOC = "brimhaven_backdoor_exit";
const BACKDOOR_VARBIT = "karam_dungeon_backdoor";
const STICKS = "village_trade_sticks";
/** The item box's stack of sticks (objectbox_double model1, recording 1002134 tick 5827). */
const STICKS_STACK = "village_trade_sticks4";
const ROPE = "rope";

const UNPAID = 0;
const PAID = 1;
const PAID_NO_WARNING = 2;
const FEE = 5000;

const INSIDE = [2734, 9478, 0];
/**
 * Ours: no recording or Wiki page gives where the crevice leaves the player. The tile beside the
 * hole the recording climbed down from (1002134 tick 5843).
 */
const OUTSIDE = [2760, 3061, 0];

/** synth_sound slug_dry_sticks, on the payment (1002134 tick 5827). */
const PAY_SOUND = 3023;
/** synth_sound tightrope, on the move (1002134 ticks 5843, 8375). */
const CLIMB_SOUND = 2495;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
/** Script 948's cycles as recorded: 15 for the fade out, 50 for the fade back in. */
const FADE_OUT_CYCLES = 15;
const FADE_IN_CYCLES = 50;
/** From the fade out: the move a tick later, the fade back in two ticks after that. */
const MOVE_TICK = 1;
const FADE_IN_TICK = 3;

const PAY_MESSAGE = "You pay 5,000 trading sticks. Banisoch adds a climbing rope to the hole for you.";
const WARNING = "I think there's dragons down there.<br>Make sure you're prepared.";
const WARNING_OPTIONS = ["Enter the dungeon.", "Enter, and don't see this warning again.", "Stay out."];
const OPTIONS_TITLE = "Select an option";

const VARIANTS = {
  unpaid: "standard-dialogue-before-having-paid-banisoch",
  paid: "standard-dialogue-after-having-paid-banisoch",
  ropeUnpaid: "standard-dialogue-when-using-a-rope-on-the-nearby-hole-before-having-paid-banisoch",
  itemPaid: "standard-dialogue-when-using-an-item-on-the-nearby-hole-after-having-paid-banisoch",
};

let core = null;
let pluginApi = null;
/** Players on their way down or up, between the fade out and the move. */
const travelling = new WeakSet();

const state = (player) => {
  const value = player.getAttribute(BACKDOOR_ATTRIBUTE);
  return value === PAID || value === PAID_NO_WARNING ? value : UNPAID;
};
const hasPaid = (player) => state(player) !== UNPAID;
const sticks = (player) => player.getInventory().getAmount(core.CacheDefinitions.getObjId(STICKS));

function isBanisoch(definition) {
  return definition?.getName?.() === BANISOCH;
}

const locIs = (event, name) => core.CacheDefinitions.getLocNames().get(event.objectId) === name;

function setState(player, value) {
  player.setAttribute(BACKDOOR_ATTRIBUTE, value);
  syncVarbit(player);
}

/** The varbit Banisoch's form and the hole read. */
function syncVarbit(player) {
  player.getPacketSender().sendVarbit(core.CacheDefinitions.getVarbitId(BACKDOOR_VARBIT), state(player));
}

function syncOnLogin({ player }) {
  syncVarbit(player);
}

function selectVariant({ player, definition }) {
  if (!isBanisoch(definition)) return null;
  return hasPaid(player) ? VARIANTS.paid : VARIANTS.unpaid;
}

function answerCondition({ player, definition, text }) {
  if (!isBanisoch(definition)) return null;
  if (text === "If the player does have 5,000 trading sticks:") return sticks(player) >= FEE;
  if (text === "If the player does not have 5,000 trading sticks:") return sticks(player) < FEE;
  return null;
}

/** His payment line: take the sticks and show them, with the rope, in the item box. */
function dialogueAction(action) {
  if (action.kind !== "message" || !isBanisoch(action.definition) || action.text !== PAY_MESSAGE) return;
  const { player } = action;
  if (hasPaid(player)) return;
  const inventory = player.getInventory();
  // They may have dropped sticks mid-conversation: then the payment doesn't happen.
  if (sticks(player) < FEE) {
    action.handled = true;
    action.end = true;
    return;
  }
  inventory.deleteNumber(core.CacheDefinitions.getObjId(STICKS), FEE);
  inventory.refreshItems();
  setState(player, PAID);
  player.getPacketSender().sendSound(PAY_SOUND, 1, 0);
  action.box = { items: [core.CacheDefinitions.getObjId(STICKS_STACK), core.CacheDefinitions.getObjId(ROPE)] };
}

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_OUT_CYCLES] : [0, 0, 0, 255, FADE_IN_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
}

/**
 * The fade out now, the move a tick later, the fade back in two ticks after that (the overlay
 * closed on the same tick, as recorded). Stops if the player is moved, dies or leaves first.
 */
function travel(player, destination) {
  if (travelling.has(player)) return;
  travelling.add(player);
  const movement = player.getMovementQueue();
  movement.setBlockMovement(true).reset();
  fade(player, true);
  const start = player.getLocation().clone();
  let tick = 0;
  const done = () => {
    travelling.delete(player);
    movement.setBlockMovement(false);
  };
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1, player, false);
    }

    execute() {
      tick++;
      if (!player.isRegistered() || player.getHitpoints() <= 0 || (tick <= MOVE_TICK && !player.getLocation().equals(start))) {
        player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID);
        done();
        this.stop();
        return;
      }
      if (tick === MOVE_TICK) {
        player.moveTo(new core.Location(...destination));
        player.getPacketSender().sendSound(CLIMB_SOUND, 1, 0);
      }
      if (tick < FADE_IN_TICK) return;
      fade(player, false);
      player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID);
      done();
      this.stop();
    }
  })());
}

/** His warning before the climb, and its three-way menu. */
function warn(player) {
  const { CacheDefinitions, DialogueChainBuilder, NpcDialogue, OptionDialogue } = core;
  const chain = new DialogueChainBuilder();
  chain.add(new NpcDialogue(0, CacheDefinitions.getNpcId(BANISOCH_PAID_NPC), WARNING, BANISOCH, CacheDefinitions.getSeqId("chatshifty2") ?? undefined));
  chain.add(new OptionDialogue(1, {
    executeOption(option) {
      const chosen = Number(option);
      if (chosen !== 1 && chosen !== 2) {
        player.getPacketSender().sendInterfaceRemoval();
        return;
      }
      if (chosen === 2) setState(player, PAID_NO_WARNING);
      player.getPacketSender().sendInterfaceRemoval();
      if (hasPaid(player)) travel(player, INSIDE);
    },
  }, ...WARNING_OPTIONS).setTitle(OPTIONS_TITLE));
  player.getDialogueManager().startDialogues(chain);
}

function climb(event) {
  if (!locIs(event, ENTRANCE_LOC)) return false;
  const { player } = event;
  if (!hasPaid(player)) return true;
  if (state(player) === PAID) warn(player);
  else travel(player, INSIDE);
  return true;
}

function useCrevice(event) {
  if (!locIs(event, EXIT_LOC)) return false;
  const { player } = event;
  // Not paid: nothing of ours; the default "Nothing interesting happens." stays.
  if (!hasPaid(player)) return false;
  travel(player, OUTSIDE);
  return true;
}

function startBanisoch(player, variant) {
  pluginApi.emitCustomEvent("npc-dialogue:start", {
    player,
    npc: null,
    npcId: core.CacheDefinitions.getNpcId(hasPaid(player) ? BANISOCH_PAID_NPC : BANISOCH_UNPAID_NPC),
    variant,
    exact: true,
    handled: false,
  });
}

/** A rope on the hole before paying, or any item on the rope after: his line for it. */
function useItemOnHole(event) {
  if (!locIs(event, ENTRANCE_LOC)) return;
  const { player } = event;
  if (hasPaid(player)) startBanisoch(player, VARIANTS.itemPaid);
  else if (event.itemId === core.CacheDefinitions.getObjId(ROPE)) startBanisoch(player, VARIANTS.ropeUnpaid);
  else return;
  event.handled = true;
  return true;
}

function attach(api) {
  core = api.core;
  pluginApi = api;
  api.persistAttribute(BACKDOOR_ATTRIBUTE, UNPAID);
  api.onPlayerLogin(syncOnLogin);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", dialogueAction);
  api.onObjectInteraction("Rope", { Climb: climb });
  api.onObjectInteraction("Crevice", { Use: useCrevice });
  api.onItemOnObject(useItemOnHole);
}

module.exports = {
  attach,
  selectVariant,
  answerCondition,
  dialogueAction,
  climb,
  useCrevice,
  useItemOnHole,
  BACKDOOR_ATTRIBUTE,
  INSIDE,
  OUTSIDE,
  FEE,
};
