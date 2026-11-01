/**
 * The pact tree (talent_tree, 647), as the Leagues VI recordings show it (data `interface`): View
 * Demonic Pacts opens it in the toplevel floater; a node bought through the client's script trigger
 * on the data layer (payload [1, 2 x node]) pays a point, sets its bit and its effect, plays the
 * unlock and closes the tree, which comes back five ticks later; the panel's trigger asks to
 * reset the whole tree (a message, then Yes / No). The client draws everything else from the
 * varps and varbits Common sends.
 */
const Common = require("./Common.LeaguePacts");

/** if_setevents bits: OP1, and IF_SCRIPT_TRIGGER (bit 23, as RSProx names it). */
const FLAG_OP1 = 1 << 1;
const FLAG_SCRIPT_TRIGGER = 1 << 23;

/** Players with the tree open. */
const open = new WeakSet();

function ui() {
  return Common.data.interface;
}

/** if_triggeroplocal arguments: ints as zigzag varints. */
function triggerInts(argsData) {
  const ints = [];
  let value = 0;
  let shift = 0;
  for (const byte of argsData ?? []) {
    value |= (byte & 0x7f) << shift;
    shift += 7;
    if ((byte & 0x80) !== 0) continue;
    ints.push((value >>> 1) ^ -(value & 1));
    value = 0;
    shift = 0;
  }
  return ints;
}

/** The tree in the floater, as captured: the pulse stopped, its events, then its init scripts. */
function show(player) {
  const { group, highlight, floater, overlay, frame, frameSlot, dataLayer, panel, scripts } = ui();
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(scripts.pulseStop, [Common.uid(highlight[0], highlight[1])]);
  sender.sendSubInterface(Common.uid(floater[0], floater[1]), group, overlay);
  sender.sendInterfaceFlagsRange(Common.uid(group, frame), frameSlot, frameSlot, FLAG_OP1);
  sender.sendInterfaceFlagsRange(Common.uid(group, dataLayer), -1, -1, FLAG_SCRIPT_TRIGGER);
  sender.sendInterfaceFlagsRange(Common.uid(group, panel), -1, -1, FLAG_OP1 | FLAG_SCRIPT_TRIGGER);
  sender.sendInterfaceScript(scripts.init, scripts.initArgs);
  sender.sendInterfaceScript(scripts.after, []);
  open.add(player);
}

function openTree({ player }) {
  if (!Common.isPacts(player)) return false;
  if (open.has(player) && player.getPacketSender().isSubInterfaceOpen?.(ui().group)) {
    player.sendMessage(Common.message("alreadyOpen"));
    return true;
  }
  // The floater is an overlay: a main modal (the relics, the areas) is closed first, as captured.
  player.getPacketSender().sendInterfaceRemoval();
  Common.sendState(player);
  show(player);
  return true;
}

function close(player) {
  if (!open.has(player)) return;
  open.delete(player);
  player.getPacketSender().closeInterface(ui().group);
}

function frameClicked({ player, slot }) {
  if (!open.has(player) || Number(slot) !== ui().frameSlot) return false;
  close(player);
  return true;
}

/** Why a node cannot be bought (a message key), or null. */
function refusal(player, index) {
  const owned = Common.pacts(player);
  if (Common.nodes[index] === undefined || owned.includes(index)) return "notLinked";
  if (owned.length >= Common.data.spendCap) return "capReached";
  if (Common.spendable(player) <= 0) return "noPoints";
  const linked = owned.length === 0 ? index === Common.data.rootNode : Common.nodes[index].links.some((link) => owned.includes(link));
  return linked ? null : "notLinked";
}

/** Buys node `index`: the varps and its effect, the captured unlock, the tree again five ticks on. */
function buy(player, index) {
  const why = refusal(player, index);
  if (why) {
    player.sendMessage(Common.message(why, { cap: Common.data.spendCap }));
    return false;
  }
  const owned = [...Common.pacts(player), index];
  Common.save(player, owned);
  const { core } = Common;
  const sender = player.getPacketSender();
  const node = Common.nodes[index];
  const ids = Common.ids;
  sender.sendConfig(ids.varps.spent, owned.length);
  const slot = Math.floor(index / 32);
  sender.sendConfig(ids.unlocked[slot], Common.unlockBits(owned)[slot]);
  sender.sendVarbit(Common.effectVarbits.get(node.varbit), Common.effect(player, node.varbit));
  const { buyAnimation, buyGraphic, buyGraphicHeight, buySounds, scripts, reopenTicks } = ui();
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId(buyAnimation)));
  player.performGraphic(new core.Graphic(core.CacheDefinitions.getSpotanimId(buyGraphic), 0, buyGraphicHeight));
  sender.sendInterfaceScript(scripts.combatLevel, [player.getSkillManager().getCombatLevel()]);
  close(player);
  for (const [sound, delay] of buySounds) sender.sendSound(sound, 1, delay);
  Common.api.emitCustomEvent("league:pact-unlocked", { player, node: index, effect: node.varbit });
  later(player, reopenTicks, () => {
    if (Common.isPacts(player) && !open.has(player)) show(player);
  });
  return true;
}

function later(player, ticks, action) {
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(ticks, player, false);
    }

    execute() {
      this.stop();
      if (player.isRegistered?.() !== false) action();
    }
  })());
}

function dataLayerTriggered(event) {
  const { player } = event;
  if (!event.scriptTrigger || !open.has(player) || !Common.isPacts(player)) return false;
  const [action, component] = triggerInts(event.argsData);
  if (action !== ui().buyAction || !Number.isInteger(component) || component % 2 !== 0) return true;
  buy(player, component / 2);
  return true;
}

/** Resets the whole tree: every pact and its effect gone, the points back, one reset used. */
function reset(player) {
  if (Common.resets(player) <= 0) {
    player.sendMessage(Common.message("noResets"));
    return false;
  }
  const refund = Common.pacts(player).length;
  if (refund === 0) {
    player.sendMessage(Common.message("nothingToReset"));
    return false;
  }
  player.setAttribute(Common.RESETS_ATTRIBUTE, Common.resets(player) - 1);
  Common.save(player, []);
  Common.sendState(player);
  const { DialogueChainBuilder, StatementDialogue } = Common.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, Common.message("resetDone", { count: Common.spendable(player) })),
  ));
  Common.api.emitCustomEvent("league:pacts-reset", { player });
  return true;
}

function panelTriggered(event) {
  const { player } = event;
  if (!event.scriptTrigger || !open.has(player) || !Common.isPacts(player)) return false;
  const { DialogueChainBuilder, StatementDialogue, OptionDialogue } = Common.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, Common.message("resetConfirm")),
    new OptionDialogue(1, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        if (Number(option) === 1) reset(player);
      },
    }, "Yes", "No").setTitle(Common.message("resetTitle")),
  ));
  return true;
}

function interfaceClosed({ player, interfaceId }) {
  if (interfaceId === ui().group) open.delete(player);
}

function logout({ player }) {
  open.delete(player);
}

module.exports = function attach(api) {
  const { group, openButton, frame, dataLayer, panel } = ui();
  api.onInterfaceActionButton(Common.uid(openButton[0], openButton[1]), openTree);
  api.onInterfaceActionButton(Common.uid(group, frame), frameClicked);
  api.onInterfaceActionButton(Common.uid(group, dataLayer), dataLayerTriggered);
  api.onInterfaceActionButton(Common.uid(group, panel), panelTriggered);
  api.onCustomEvent("interface:closed", interfaceClosed);
  api.onPlayerLogout(logout);
};

Object.assign(module.exports, { buy, reset, refusal, openTree, triggerInts });
