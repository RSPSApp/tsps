/**
 * Choosing a mode in game, as captured on Tutorial Island: the Ironman tutor opens the setup
 * interface (`ironman:open-setup` { player, upgrades, onClosed? }), a mode button asks for
 * confirmation, and Proceed sets the mode.
 * On the island any mode can be picked; afterwards Adam only allows downgrades. OSRS also has you
 * set a bank PIN there; this server has none, so the confirmation leaves it out. Adam's "Armour"
 * option hands out the mode's armour.
 *
 * Other plugins ask a player's mode with `ironman:mode` ({ player } -> mode, label).
 */
const Ironman = require("./Common.Ironman");

/** Adam, the Ironman tutor in Lumbridge. */
const ADAM = 311;
const ARMOUR_OPTION = 3;

let core;

function setupData() {
  return Ironman.data.setup;
}

function rank(mode) {
  return Ironman.data.modes[mode]?.rank ?? 0;
}

/**
 * Player -> the open setup: whether it allows upgrades (only on Tutorial Island), and the
 * requester's `onClosed`, called once it closes however it closes.
 */
const openSetups = new WeakMap();

function openSetup(request) {
  const { player } = request;
  if (!player) return;
  request.handled = true;
  const setup = setupData();
  for (const [varp, value] of Object.entries(setup.varps)) player.getPacketSender().sendConfig(Number(varp), value);
  openSetups.set(player, { upgrades: request.upgrades === true, onClosed: request.onClosed });
  player.getPacketSender().sendInterface(setup.interface);
}

/** Forgets the open setup and tells its requester, once, whichever way it ended. */
function endSetup(player) {
  const open = openSetups.get(player);
  openSetups.delete(player);
  open?.onClosed?.();
}

function closePopup(player) {
  const setup = setupData();
  player.getPacketSender().closeSubInterface((setup.interface << 16) | setup.popupComponent);
}

function choose(player, mode) {
  const upgrades = openSetups.get(player)?.upgrades;
  if (upgrades === undefined) return;
  const current = Ironman.modeOf(player);
  if (mode === "group") {
    player.sendMessage(Ironman.message("groupUnavailable"));
    return;
  }
  if (mode === current) {
    player.sendMessage(Ironman.message("modeAlready", { mode: Ironman.data.modes[mode].label }));
    return;
  }
  if (!upgrades && rank(mode) >= rank(current)) {
    player.sendMessage(Ironman.message("upgradeRefused"));
    return;
  }
  const setup = setupData();
  const popup = (setup.interface << 16) | setup.popupComponent;
  player.getPacketSender().sendSubInterface(popup, setup.popupInterface, 1);
  // None leaves Ironman mode, so its popup names the mode being left.
  const prompt = mode === "none"
    ? Ironman.message("setupLeave", { mode: Ironman.data.modes[current].label })
    : Ironman.message("setupConfirm", { mode: Ironman.data.modes[mode].label });
  player.getPacketSender().sendClientScript(setup.popupScript, prompt, popup);
  // The popup answers through the count dialog: 1 is Proceed, 0 is Cancel.
  player.setEnteredAmountAction({
    acceptsZero: true,
    execute(answer) {
      closePopup(player);
      if (answer !== 1) return;
      Ironman.setMode(player, mode);
      player.getPacketSender().sendVarbit(Ironman.data.varbits.downgradePermitted, 1);
      player.getPacketSender().sendInterfaceRemoval();
      endSetup(player);
      const { DialogueChainBuilder, StatementDialogue } = core;
      player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, Ironman.message("modeUpdated"))));
    },
  });
}

/** The mode's armour, if the inventory has room; returns the line Adam says. */
function handOutArmour(player) {
  const armour = Ironman.data.modes[Ironman.modeOf(player)]?.armour;
  if (!armour) return Ironman.message("armourNotIron");
  const inv = player.getInventory();
  if (inv.getFreeSlots() < armour.length) return Ironman.message("armourFull");
  for (const name of armour) inv.adds(core.ItemIdentifiers[name], 1);
  return Ironman.message("armour");
}

/** Adam's "Armour" option. */
function giveArmour({ player }) {
  if (!player) return false;
  const line = handOutArmour(player);
  const { DialogueChainBuilder, NpcDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, ADAM, line)));
  return true;
}

/** Adam's talk: the Wiki transcript for an Ironman, or for everyone else. */
function adamVariant({ player, npcId }) {
  if (npcId !== ADAM) return null;
  return Ironman.isIron(player)
    ? "standard-dialogue-dialogue-with-iron-man-woman-status"
    : "standard-dialogue-dialogue-without-iron-man-woman-status";
}

/** "Have you any armour for me, please?": the transcript says the line; hand the armour over with it. */
function onDialogueChoice(event) {
  if (event?.npcId !== ADAM || !String(event.option ?? "").startsWith("Have you any armour")) return;
  if (Ironman.isIron(event.player)) {
    const line = handOutArmour(event.player);
    if (line !== Ironman.message("armour")) event.player.sendMessage(line);
  }
}

/** Adam's transcript opens the setup too; off the island it only allows downgrades. */
function onDialogueAction(event) {
  if (event?.npcId !== ADAM || event.kind !== undefined) return;
  if (event.step?.action !== "open_interface" || event.step?.target !== "Ironman") return;
  // End the talk first: closing it closes every interface, the setup included.
  event.handled = true;
  event.end = true;
  queueMicrotask(() => openSetup({ player: event.player, upgrades: false, handled: false }));
}

function answerMode(query) {
  if (!query?.player) return;
  query.mode = Ironman.modeOf(query.player);
  query.label = Ironman.data.modes[query.mode].label;
}

module.exports = function attach(api) {
  core = api.core;
  const setup = setupData();
  for (const [child, mode] of Object.entries(setup.buttons)) {
    api.onInterfaceActionButton((setup.interface << 16) | Number(child), ({ player }) => {
      choose(player, mode);
      return true;
    });
  }
  api.onCustomEvent("interface:closed", ({ player, interfaceId }) => {
    if (interfaceId === setup.interface) endSetup(player);
  });
  api.onCustomEvent("ironman:open-setup", openSetup);
  api.onCustomEvent("ironman:mode", answerMode);
  api.onCustomEvent("npc-dialogue:action", onDialogueAction);
  api.onNpcClick([ADAM], ARMOUR_OPTION, giveArmour);
  api.onNpcDialogueVariant(adamVariant);
  api.onCustomEvent("npc-dialogue:choice", onDialogueChoice);
};
