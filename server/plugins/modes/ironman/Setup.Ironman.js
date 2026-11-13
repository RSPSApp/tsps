/**
 * Choosing a mode in game, as captured on Tutorial Island: the Ironman tutor opens the setup
 * interface (`ironman:open-setup` { player, upgrades, onClosed? }), a mode button asks for
 * confirmation, and Proceed sets the mode.
 * On the island any mode can be picked; afterwards Adam only allows downgrades. OSRS also has you
 * set a bank PIN there; this server has none, so the confirmation leaves it out. Adam's "Armour"
 * option hands out the mode's armour.
 *
 * Other plugins ask a player's mode with `ironman:mode` ({ player } -> mode, label), and may lock
 * it: every choice first asks `ironman:change-mode` ({ player, from, to, upgrades, allowed, reason }:
 * `upgrades` is true on Tutorial Island), and
 * one answered `allowed: false` is refused with its reason. Opening the setup at all first asks
 * `ironman:can-open-setup` ({ player, allowed, reason }): refused, it stays shut and the reason
 * is said.
 */
const Ironman = require("./Common.Ironman");

/** Adam, the Ironman tutor in Lumbridge: the spawned parent, and from rev 242 the variant only Iron
 * accounts see (`ironman` varbit 1777 = 1-6); interactions carry the variant. */
const ADAM = 311;
const ADAM_VARIANT = 16814;
const isAdam = (npcId) => npcId === ADAM || npcId === ADAM_VARIANT;
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
  // A world or mode without Ironmen (a Hardcore World) keeps the setup shut, with its reason.
  const query = { player, allowed: true, reason: null };
  Ironman.api.emitCustomEvent("ironman:can-open-setup", query);
  if (query.allowed === false) {
    // The automatic first-login offer just doesn't happen; a setup asked for says why.
    if (query.reason && request.initial !== true) player.sendMessage(query.reason);
    request.onClosed?.();
    return;
  }
  const setup = setupData();
  for (const [varp, value] of Object.entries(setup.varps)) player.getPacketSender().sendConfig(Number(varp), value);
  openSetups.set(player, { upgrades: request.upgrades === true, initial: request.initial === true, onClosed: request.onClosed });
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
  const open = openSetups.get(player);
  if (!open) return;
  const { upgrades } = open;
  const current = Ironman.modeOf(player);
  if (!upgrades && Ironman.data.modes[mode].islandOnly && mode !== current) {
    player.sendMessage(Ironman.message("groupIslandOnly"));
    return;
  }
  if (mode === current) {
    if (open.initial && mode === "none") {
      player.getPacketSender().sendInterfaceRemoval();
      endSetup(player);
      return;
    }
    player.sendMessage(Ironman.message("modeAlready", { mode: Ironman.data.modes[mode].label }));
    return;
  }
  const change = { player, from: current, to: mode, upgrades, allowed: true, reason: null };
  Ironman.api.emitCustomEvent("ironman:change-mode", change);
  if (change.allowed === false) {
    if (change.reason) player.sendMessage(change.reason);
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
      if (openSetups.get(player) !== open) return;
      closePopup(player);
      if (answer !== 1) return;
      if (Ironman.modeOf(player) !== current) return;
      const commit = { player, from: current, to: mode, upgrades, allowed: true, reason: null };
      Ironman.api.emitCustomEvent("ironman:change-mode", commit);
      if (commit.allowed === false) {
        if (commit.reason) player.sendMessage(commit.reason);
        return;
      }
      Ironman.setMode(player, mode);
      player.getPacketSender().sendVarbit(Ironman.data.varbits.downgradePermitted, 1);
      player.getPacketSender().sendInterfaceRemoval();
      endSetup(player);
      const { DialogueChainBuilder, StatementDialogue } = core;
      player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, Ironman.message("modeUpdated"))));
    },
  });
}

/**
 * The mode's armour, if the inventory has room; returns the line Adam says. "ironman:armour"
 * { player, items } lets a mode hand out its own set (Group Ironman: the platebody of the group's size).
 */
function handOutArmour(player) {
  const armour = Ironman.data.modes[Ironman.modeOf(player)]?.armour;
  if (!armour) return Ironman.message("armourNotIron");
  const request = { player, items: null };
  Ironman.api.emitCustomEvent("ironman:armour", request);
  const items = request.items ?? armour.map((name) => core.ItemIdentifiers[name]);
  const inv = player.getInventory();
  if (inv.getFreeSlots() < items.length) return Ironman.message("armourFull");
  for (const id of items) inv.adds(id, 1);
  return Ironman.message("armour");
}

/** Adam's "Armour" option. */
function giveArmour({ player }) {
  if (!player) return false;
  const line = handOutArmour(player);
  const { DialogueChainBuilder, NpcDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, ADAM_VARIANT, line)));
  return true;
}

/** Adam's talk: the Wiki transcript for an Ironman, or for everyone else. */
function adamVariant({ player, npcId }) {
  if (!isAdam(npcId)) return null;
  return Ironman.isIron(player)
    ? "standard-dialogue-dialogue-with-iron-man-woman-status"
    : "standard-dialogue-dialogue-without-iron-man-woman-status";
}

/** "Have you any armour for me, please?": the transcript says the line; hand the armour over with it. */
function onDialogueChoice(event) {
  if (!isAdam(event?.npcId) || !String(event.option ?? "").startsWith("Have you any armour")) return;
  if (Ironman.isIron(event.player)) {
    const line = handOutArmour(event.player);
    if (line !== Ironman.message("armour")) event.player.sendMessage(line);
  }
}

/** Adam's transcript opens the setup too; off the island it only allows downgrades. */
function onDialogueAction(event) {
  if (!isAdam(event?.npcId) || event.kind !== undefined) return;
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

/** Disconnecting does not choose None for an unfinished initial setup. */
function abandonSetup({ player }) { openSetups.delete(player); }

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
  api.onPlayerLogout(abandonSetup);
  api.onPlayerDisconnect(abandonSetup);
  api.onCustomEvent("ironman:mode", answerMode);
  api.onCustomEvent("npc-dialogue:action", onDialogueAction);
  api.onNpcClick([ADAM, ADAM_VARIANT], ARMOUR_OPTION, giveArmour);
  api.onNpcDialogueVariant(adamVariant);
  api.onCustomEvent("npc-dialogue:choice", onDialogueChoice);
};
