// A dock crewmate banking a boat's cargo hold, as live (rsprox, Cabin Boy Jenkins at Port Sarim
// and the Pandemonium):
//   Bank-cargo, or "Can you help bank my cargo hold contents?": with no boat at this dock, the
//   crewmate says so (only Jenkins' lines are captured); with every hold empty, their "nothing to
//   move" line; otherwise "Move all available items from your cargo hold to your bank?" (Yes/No),
//   after the boat selection in its bank cargo mode (11) when more than one boat is docked here.
//   Yes: their first line without "Click here to continue" as the screen fades; 3 ticks later the
//   box "Your crew start moving the contents of the cargo hold..." (no continue either); at 7 the
//   cargo goes to the bank and the screen fades back in; at 10 their closing line, by whether the
//   bank had room. The lines are the crewmate's transcript's.
// Wiki (Crew Management): "At least one crewmate must have Deckhandiness level 2 or higher to use the "Bank Cargo"
// option." The refusal was never captured, so its line is this server's.
const common = require("./Common.Crew");
const lines = require("./Lines.Crew");
const { openBoatSelection, MODE } = require("../BoatSelection.Sailing");
const { dockNear, fade } = require("../SailingContent.Sailing");

const MOVE_CARGO = "Move Cargo to Bank";
const PROMPT = "Move all available items from your cargo hold to your bank?";
/** Where the dock crewmates stand: next to the boat's dock. */
const DOCK_RANGE = 16;
/** No boat here, for a crewmate whose lines weren't captured. */
const NO_BOAT = "Your boat isn't docked here.";
const FADE_CYCLES = 50;
/** TSPS wording: no recording shows the Deckhandiness refusal. */
const NO_DECKHAND = "None of your crew is a good enough deckhand to bank your cargo.";
/** TSPS wording, once after the crewmate's closing line: what the bank refused stayed aboard. */
const KEPT_IN_HOLD = "Your crew left some cargo in the hold: it can't be put in your bank.";
const MOVING_TICKS = 3;
const MOVED_TICKS = 7;
const DONE_TICKS = 10;
/** chat_left: its continue line, cleared for a line the player can't click past. */
const CHAT_LEFT_CONTINUE = (231 << 16) | 5;

let pluginApi;

function cache() {
  return common.core();
}

/** The player's boats docked at a dock. */
function boatsAt(player, dock) {
  return player.getSailing().boats.filter((boat) => boat.location.kind === "docked" && boat.location.dock === dock.id);
}

function holdEmpty(boat) {
  return !boat || boat.cargo.every((slot) => !slot || slot.amount <= 0);
}

/**
 * Moves a boat's cargo into the bank, as much as fits: a full bank, or a stack at its maximum,
 * leaves the rest in the hold, and so does what the bank refuses. `fitted`: everything the bank
 * accepts went; `kept`: the slots it refused (asked quietly, so no refusal per slot).
 */
function moveToBank(player, boat) {
  const { Bank, Item } = cache();
  let all = true;
  let kept = 0;
  boat.cargo.forEach((slot, index) => {
    if (!slot || slot.amount <= 0) return;
    // The bank's own rules apply: a courier crate (Port Tasks) or an unbankable item stays in the hold.
    const held = new Item(slot.id, slot.amount);
    if (held.isUnbankable?.() || pluginApi?.emitCanBankItem?.(player, held, { quiet: true }) === false) {
      kept++;
      return;
    }
    const tab = Bank.getTabForItem(player, slot.id);
    const bank = player.getBank(tab);
    const moving = bank.getAddableAmount(new Item(slot.id, slot.amount));
    if (moving > 0) bank.add(new Item(slot.id, moving), false);
    if (moving >= slot.amount) {
      boat.cargo[index] = null;
      return;
    }
    slot.amount -= moving;
    all = false;
  });
  if (Bank.isOpen(player)) player.getBank(player.getCurrentBankTab()).refreshItems();
  return { fitted: all, kept };
}

/** The crewmate's at-port variant: where their bank-cargo conversation lives. */
function portSteps(player, crew) {
  const variant = crew.variants.find((rule) => rule.at === "dock"
    && (rule.ghostspeak === undefined || rule.ghostspeak === common.hearsGhosts(player)))?.variant;
  return variant ? lines.variantSteps(crew.page, variant) : undefined;
}

/** The NPC lines under a transcript condition, in order. */
function linesUnder(steps, condition) {
  const found = lines.findStep(steps, (step) => step?.type === "condition" && condition.test(String(step.text ?? "")));
  return (found?.steps ?? []).filter((step) => typeof step.npc === "string").map((step) => step.npc);
}

/** What the transcript says once Yes is chosen: the first line, the message, and the result lines. */
function yesBranch(player, crew) {
  const steps = portSteps(player, crew);
  const choice = lines.findStep(steps, (step) => step?.type === "choice" && /move all available items/i.test(String(step.prompt ?? "")));
  const yes = (choice?.options ?? []).find((option) => /^yes/i.test(String(option.text ?? "")))?.steps ?? [];
  return {
    prompt: choice?.prompt ?? PROMPT,
    working: yes.find((step) => typeof step.npc === "string")?.npc,
    moving: yes.find((step) => step.type === "message")?.text,
    fitted: linesUnder(yes, /(bank has space|there is sufficient room)/i)[0],
    full: linesUnder(yes, /(doesn't have space|insufficient room)/i)[0],
  };
}

function headOf(npc, crew) {
  return npc?.getId?.() ?? crew.npcs.dock;
}

function say(player, npcId, crew, text, { canContinue = true } = {}) {
  const { DialogueChainBuilder, NpcDialogue, ActionDialogue } = cache();
  if (canContinue) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, npcId, text, crew.name)));
    return undefined;
  }
  // Shown without "Click here to continue", and kept as the current dialogue so nothing closes it.
  const waiting = new ActionDialogue(0, {
    execute: () => {
      new NpcDialogue(0, npcId, text, crew.name).send(player);
      player.getPacketSender().sendString("", CHAT_LEFT_CONTINUE).sendInterfaceFlagsRange(CHAT_LEFT_CONTINUE, -1, -1, 0);
    },
  });
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(waiting));
  return waiting;
}

/** No boat at this dock: Jenkins' captured lines, or a plain message for the others. */
function noBoat(player, npcId, crew) {
  const said = crew.noBoat?.[common.hearsGhosts(player) ? "ghostspeak" : "withoutGhostspeak"];
  if (!said) {
    player.sendMessage(NO_BOAT);
    return;
  }
  const { DialogueChainBuilder, NpcDialogue, StatementDialogue } = cache();
  const chain = new DialogueChainBuilder();
  said.forEach((step, i) => chain.add(step.npc ? new NpcDialogue(i, npcId, step.npc, crew.name) : new StatementDialogue(i, step.message)));
  player.getDialogueManager().startDialogues(chain);
}

/** Yes: the crew move the cargo, timed as live. */
function bankBoat(player, npcId, crew, boat) {
  const { CountdownTask, StatementDialogue, TaskManager } = cache();
  const branch = yesBranch(player, crew);
  const waiting = say(player, npcId, crew, branch.working ?? "", { canContinue: false });
  const busy = () => player.getDialogueManager().getCurrent?.() === waiting;
  fade(player, true, FADE_CYCLES, { minimap: false });
  player.getPacketSender().sendVarbit(common.VARBIT.BUSY, 1);
  let moved = { fitted: true, kept: 0 };
  TaskManager.submit(new CountdownTask(player, MOVING_TICKS, () => {
    if (busy() && branch.moving) StatementDialogue.send(player, branch.moving, false);
  }));
  TaskManager.submit(new CountdownTask(player, MOVED_TICKS, () => {
    moved = moveToBank(player, boat);
    fade(player, false, FADE_CYCLES, { minimap: false });
  }));
  TaskManager.submit(new CountdownTask(player, DONE_TICKS, () => {
    player.getPacketSender().sendVarbit(common.VARBIT.BUSY, 0);
    const result = moved.fitted ? branch.fitted : branch.full;
    if (moved.kept > 0) player.sendMessage(KEPT_IN_HOLD);
    if (!busy()) return;
    if (result) say(player, npcId, crew, result);
    else player.getPacketSender().sendInterfaceRemoval();
  }));
}

function confirm(player, npcId, crew, boat) {
  pluginApi.sendMultiChatboxPrompt(player, yesBranch(player, crew).prompt,
    "Yes.", () => bankBoat(player, npcId, crew, boat),
    "No.", () => {});
}

/**
 * Banking from the dock: the boat docked here (or the one chosen when there are several), then
 * the confirmation. `checked`: the transcript has already answered whether the hold is empty.
 */
function startBanking(player, npc, crew, { checked = false } = {}) {
  const npcId = headOf(npc, crew);
  if (!common.all().some((member) => common.isRecruited(player, member.id) && member.stats[common.STAT.DECKHANDINESS] >= 2)) {
    player.sendMessage(NO_DECKHAND);
    return undefined;
  }
  const dock = dockNear(player, DOCK_RANGE);
  const boats = dock ? boatsAt(player, dock) : [];
  if (!boats.length) return noBoat(player, npcId, crew);
  const loaded = boats.filter((boat) => !holdEmpty(boat));
  if (!loaded.length) {
    if (checked) return undefined;
    const empty = linesUnder(portSteps(player, crew), /cargo hold is already empty/i)[0];
    return empty ? say(player, npcId, crew, empty) : undefined;
  }
  if (boats.length === 1) return confirm(player, npcId, crew, boats[0]);
  return openBoatSelection(player, MODE.BANK_CARGO, dock, (slot) => {
    const boat = boats.find((candidate) => candidate.slot === slot);
    if (boat) confirm(player, npcId, crew, boat);
  });
}

function crewOnDock(npcId) {
  const found = common.byNpc(npcId);
  return found?.at === "dock" ? found.crew : undefined;
}

/** The transcript's "Move Cargo to Bank" interface: the rest is this unit's, a tick later (the chat closes first). */
function onAction(event) {
  const crew = crewOnDock(event.npcId);
  if (!crew || event.action !== "open_interface" || event.target !== MOVE_CARGO) return;
  event.handled = true;
  event.end = true;
  const { player, npc } = event;
  const { CountdownTask, TaskManager } = cache();
  TaskManager.submit(new CountdownTask(player, 1, () => startBanking(player, npc, crew, { checked: true })));
}

/** "If cargo hold is already empty:" / "If there are items in the cargo hold:", over the boats docked here. */
function answerCondition({ player, npcId, text }) {
  if (!crewOnDock(npcId)) return null;
  const condition = String(text ?? "").toLowerCase();
  const dock = dockNear(player, DOCK_RANGE);
  const empty = !dock || boatsAt(player, dock).every(holdEmpty);
  if (/cargo hold is already empty/.test(condition)) return empty;
  if (/items in the cargo hold/.test(condition)) return !empty;
  return null;
}

/** The Bank-cargo option: straight to banking (rsprox). */
function bankCargo({ player, npc, npcId }) {
  const crew = crewOnDock(npcId);
  if (!crew) return false;
  startBanking(player, npc, crew);
  return true;
}

function attach(api) {
  pluginApi = api;
  common.init(api);
  api.onNpcsInteraction(common.all().map((crew) => crew.name), { "Bank-cargo": bankCargo });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", onAction);
}

module.exports = attach;
module.exports.moveToBank = moveToBank;
module.exports.answerCondition = answerCondition;
module.exports.startBanking = startBanking;
