const { CombatFactory } = require("../../src/main/typescript/elvarg/game/content/combat/CombatFactory");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Boundary } = require("../../src/main/typescript/elvarg/game/model/Boundary");
const { RegionManager } = require("../../src/main/typescript/elvarg/game/collision/RegionManager");
const { World } = require("../../src/main/typescript/elvarg/game/World");
const { DuelRule, DuelState } = require("../../src/main/typescript/elvarg/game/content/Duelling");
const { WORLD_ZONE_BOUNDARIES } = require("../../src/main/typescript/elvarg/game/definition/WorldDefinition");
const { PlayerStatus } = require("../../src/main/typescript/elvarg/game/model/PlayerStatus");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { ItemOnGroundManager } = require("../../src/main/typescript/elvarg/game/entity/impl/grounditem/ItemOnGroundManager");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../src/main/typescript/elvarg/game/task/TaskManager");
const { FLAG_OP1, TYPE_GRAPHIC, TYPE_TEXT, createWidgetGroup } = require("../interface/widgetGroup");
const { EQUIPMENT_SLOTS, addEquipmentWidgets } = require("../modes/pvp/presetsWidget");

// Cache 237: confirmation group 756 and rule config varp 286.
const ARENA = new Boundary(3326, 3383, 3197, 3295, 0);
const EXIT = new Location(3366, 3266, 0);
// The offer stage is server-defined; the cache-native confirmation screen remains group 756.
const OPTIONS = 30011;
const CACHE_OPTIONS = 755;
const CACHE_ACCEPT = 86;
const CACHE_DECLINE = 87;
const COINS = 995;
const PVP_LAYOUT_SCRIPT = 386;
const VARBIT_PVPA_BATTLEAREA_STATUS = 14017;
const VARBIT_PVPA_TRANSMIT_CHALLENGE_OR_BATTLEAREA = 14022;
const CACHE_HIDDEN = [2, 3, 5, 29, 42, 70, 82, 83, 84, 88, 98]
  .map(component => (CACHE_OPTIONS << 16) | component);
const CONFIRM = 756;
const MAIN_MODAL_UID = (161 << 16) | 16;
const UI = {
  ROOT: 0, TITLE: 6,
  YOUR_STAKE_LABEL: 10, OPPONENT_STAKE_LABEL: 11,
  YOUR_ITEMS: 12, YOUR_SCROLLBAR: 13, OPPONENT_ITEMS: 14, OPPONENT_SCROLLBAR: 15,
};
const EQUIPMENT_UI = { backgroundStart: 100, placeholderStart: 120, itemStart: 140 };
const RULE_ROWS = [
  [30, DuelRule.NO_RANGED, "No Ranged", 15, 164],
  [31, DuelRule.NO_MELEE, "No Melee", 15, 186],
  [32, DuelRule.NO_MAGIC, "No Magic", 15, 208],
  [33, DuelRule.NO_SPECIAL_ATTACKS, "No Sp. Atk", 15, 230],
  [34, DuelRule.FUN_WEAPONS, "Fun Weapons", 15, 252],
  [35, DuelRule.NO_FORFEIT, "No Forfeit", 15, 274],
  [36, DuelRule.NO_POTIONS, "No Drinks", 364, 171],
  [37, DuelRule.NO_FOOD, "No Food", 364, 193],
  [38, DuelRule.NO_PRAYER, "No Prayer", 364, 215],
  [39, DuelRule.NO_MOVEMENT, "No Movement", 364, 237],
  [40, new DuelRule(10, -1), "Obstacles", 364, 259],
].map(([component, rule, text, x, y]) => ({ component, rule, text, x, y }));
const OPTION_RULE_BUTTONS = new Map(RULE_ROWS.map(({ component, rule }) => [component, rule]));
const RULE_ICON_START = 220;
const RULE_CHECK_START = 240;
const RULE_LABEL_START = 260;
for (const [index, { rule }] of RULE_ROWS.entries()) {
  for (const component of [RULE_ICON_START + index, RULE_CHECK_START + index, RULE_LABEL_START + index]) {
    OPTION_RULE_BUTTONS.set(component, rule);
  }
}
const DUEL_INTERFACE = buildDuelInterface();
const DUEL_OPTION = 4; // OPPLAYER1/2/3 are Attack/Trade/Follow.
const FORFEIT_OPTION = 6;
const uid = (group, child) => (group << 16) | child;
const EQUIPMENT_RULES = [
  DuelRule.NO_HELM, DuelRule.NO_CAPE, DuelRule.NO_AMULET, DuelRule.NO_WEAPON,
  DuelRule.NO_BODY, DuelRule.NO_SHIELD, DuelRule.NO_LEGS, DuelRule.NO_GLOVES,
  DuelRule.NO_BOOTS, DuelRule.NO_RING, DuelRule.NO_AMMUNITION,
];
const CACHE_RULE_BUTTONS = new Map([
  [30, DuelRule.NO_RANGED], [31, DuelRule.NO_MELEE], [32, DuelRule.NO_MAGIC], [33, DuelRule.NO_SPECIAL_ATTACKS], [34, DuelRule.FUN_WEAPONS], [35, DuelRule.NO_FORFEIT], [36, DuelRule.NO_PRAYER], [37, DuelRule.NO_POTIONS], [38, DuelRule.NO_FOOD], [39, DuelRule.NO_MOVEMENT], [40, DuelRule.LOCK_WEAPON], [41, DuelRule.SHOW_INVENTORIES], [48, DuelRule.NO_HELM], [49, DuelRule.NO_CAPE], [50, DuelRule.NO_AMULET], [51, DuelRule.NO_WEAPON], [52, DuelRule.NO_BODY], [53, DuelRule.NO_SHIELD], [54, DuelRule.NO_LEGS], [55, DuelRule.NO_GLOVES], [56, DuelRule.NO_BOOTS], [57, DuelRule.NO_RING], [58, DuelRule.NO_AMMUNITION],
]);
const sessions = new Map();
const requests = new WeakMap();
const requestDelay = new WeakMap();
const menuState = new WeakMap();
const presets = new WeakMap();
const lastRules = new WeakMap();
const pendingSafeDeaths = new WeakSet();
const duelIconVisible = new WeakMap();
const OPPONENT_INVENTORY = 2000; // Server-supplied snapshot used only by the duel confirmation.
let pluginApi;
let stakingEnabled = false;
function enableStaking() { stakingEnabled = true; }

function buildDuelInterface() {
  const { widgets, add } = createWidgetGroup(OPTIONS);
  const root = add(UI.ROOT, -1, {
    rawWidth: 0, rawHeight: 0, widthMode: 1, heightMode: 1,
    width: 508, height: 330, xPositionMode: 1, yPositionMode: 1,
  });

  const text = (component, x, y, width, value, overrides = {}) => add(component, root, {
    type: TYPE_TEXT, rawX: x, rawY: y, rawWidth: width, rawHeight: 16,
    width, height: 16, text: value, fontId: 494, textColor: 0xffff00,
    textShadowed: true, yTextAlignment: 1, ...overrides,
  });
  text(UI.TITLE, 9, 8, 440, "Dueling with:", { textColor: 0xffb83f });
  const panel = (labelComponent, title, view, scrollbar, x, width) => {
    text(labelComponent, x + 4, 35, width - 8, title);
    const viewWidth = width - 22;
    add(view, root, {
      rawX: x + 2, rawY: 54, rawWidth: viewWidth, rawHeight: 102,
      width: viewWidth, height: 102, scrollWidth: viewWidth, scrollHeight: 252,
    });
    add(scrollbar, root, {
      rawX: x + width - 18, rawY: 36, rawWidth: 16, rawHeight: 122,
      width: 16, height: 122, noClickThrough: true,
    });
  };
  panel(UI.YOUR_STAKE_LABEL, "Your Stake:", UI.YOUR_ITEMS, UI.YOUR_SCROLLBAR, 5, 158);
  panel(UI.OPPONENT_STAKE_LABEL, "Opponents Stake:", UI.OPPONENT_ITEMS, UI.OPPONENT_SCROLLBAR, 334, 152);

  addEquipmentWidgets(add, root, 178, 35, {
    ...EQUIPMENT_UI, columnPitch: 56, rowPitch: 40,
  });

  for (const widget of widgets) {
    if ([113, 133, 153].includes(widget.fileId)) widget.rawX -= 16;
  }

  for (const [index, row] of RULE_ROWS.entries()) {
    add(RULE_ICON_START + index, root, {
      type: TYPE_GRAPHIC, rawX: row.x + 4, rawY: row.y + 1, rawWidth: 16, rawHeight: 16,
      width: 16, height: 16, spriteId: 697, actions: ["Toggle"], flags: FLAG_OP1,
    });
    add(RULE_CHECK_START + index, root, {
      type: TYPE_GRAPHIC, rawX: row.x + 4, rawY: row.y + 1, rawWidth: 16, rawHeight: 16,
      width: 16, height: 16, spriteId: 699, isHidden: true, hidden: true,
      actions: ["Toggle"], flags: FLAG_OP1,
    });
    text(RULE_LABEL_START + index, row.x + 24, row.y + 2, 112, row.text, {
      actions: ["Toggle"], flags: FLAG_OP1,
    });
  }

  return {
    groupId: OPTIONS,
    widgets,
    scroll: [
      { viewComponent: UI.YOUR_ITEMS, scrollbarComponent: UI.YOUR_SCROLLBAR, contentHeight: 252 },
      { viewComponent: UI.OPPONENT_ITEMS, scrollbarComponent: UI.OPPONENT_SCROLLBAR, contentHeight: 252 },
    ],
  };
}

// The cache-native duel controls retain their textured backing and hover behaviour.
function renderAccept(player, accepted = false) {
  player.getPacketSender().sendInterfaceScript(2425, [
    accepted ? "<col=9f9f9f>Accepted</col>" : "<col=00ff00>Accept</col>", uid(CACHE_OPTIONS, CACHE_ACCEPT), 495, 0,
  ]);
}
function stakeText(player) {
  return [...sessions.get(player).offers.get(player).values()]
    .map(item => `${item.getDefinition().getName()} x ${item.getAmount().toLocaleString("en-US")}`)
    .join(", ") || "Nothing";
}
function renderStakes(player, session) {
  for (const [component, owner, inventoryId] of [
    [UI.YOUR_ITEMS, player, 2001],
    [UI.OPPONENT_ITEMS, session.players.find(p => p !== player), 2002],
  ]) {
    const own = owner === player;
    const slots = [...session.offers.get(owner).values()].map((item, slot) =>
      ({ slot, itemId: item.getId(), quantity: item.getAmount() }));
    player.getPacketSender().sendInterfaceScript(149,
      [uid(OPTIONS, component), inventoryId, 4, 7, 1, -1,
        ...["Remove-1", "Remove-5", "Remove-10", "Remove-All", "Remove-X"].map(action => own ? action : "")],
      undefined, undefined, { [inventoryId]: { capacity: 28, slots } })
      .sendInterfaceFlagsRange(uid(OPTIONS, component), 0, 27, own ? 1180734 : 0);
  }
}
function handleStake(event) {
  event.handled = true;
  const { player, buttonId, itemId, slot } = event;
  const session = sessions.get(player);
  if (!session || session.stage !== "options" || player.getInterfaceId() !== OPTIONS) return;
  if (session.players.some((p, i) => snapshot(p) !== session.snapshots[i])) {
    return showOptions(session, "Items changed. Please review the duel again.");
  }
  if (!Number.isInteger(slot) || slot < 0 || slot >= 28) return;
  const removing = buttonId === uid(OPTIONS, UI.YOUR_ITEMS);
  const offer = session.offers.get(player);
  const inventorySlot = removing ? [...offer.keys()][slot] : slot;
  const item = removing ? offer.get(inventorySlot) : player.getInventory().getItems()[slot];
  if (!item?.isValid() || item.getId() !== itemId) return;
  if (item.getId() !== COINS && !item.isTradeable()) {
    player.sendMessage("You cannot stake that item.");
    return;
  }
  const action = event.opId ?? event.action;
  if (![1, 2, 3, 4, 5].includes(action)) return;
  const snapshots = session.players.map(snapshot);
  const revision = session.revision;
  const change = amount => {
    if (sessions.get(player) !== session || session.revision !== revision || session.stage !== "options"
        || player.getInterfaceId() !== OPTIONS || session.offers.get(player) !== offer
        || session.players.some((p, i) => snapshot(p) !== snapshots[i])) return;
    if (!Number.isSafeInteger(amount) || amount <= 0) return;
    const previous = offer.get(inventorySlot)?.getAmount() ?? 0;
    const quantity = removing ? Math.max(0, previous - amount) : Math.min(2147483647, item.getAmount(), previous + amount);
    if (quantity === previous) return;
    if (quantity) offer.set(inventorySlot, item.clone().setAmount(quantity));
    else offer.delete(inventorySlot);
    setRules(session, session.mask, false);
    session.snapshots = session.players.map(snapshot);
    for (const viewer of session.players) renderStakes(viewer, session);
    acceptBots(session, "duelarena:rules-changed");
  };
  if (action === 5) {
    player.setEnteredAmountAction({ execute: change });
    player.getPacketSender().sendEnterAmountPrompt(removing ? "Remove how many?" : "Stake how many?");
  } else change([0, 1, 5, 10, 2147483647][action]);
}

function renderEquipment(player) {
  const sender = player.getPacketSender();
  const equipment = player.getEquipment().getItems();
  for (const slot of EQUIPMENT_SLOTS) {
    const item = equipment[slot];
    const valid = item?.isValid?.() ?? item?.getId?.() > 0;
    sender.sendItemOnInterfaces(uid(OPTIONS, EQUIPMENT_UI.itemStart + slot), valid ? item.getId() : -1, valid ? item.getAmount() : 1);
    sender.sendInterfaceDisplayState(uid(OPTIONS, EQUIPMENT_UI.placeholderStart + slot), valid);
  }
}

function renderRules(player, mask) {
  for (const [index, row] of RULE_ROWS.entries()) {
    const checked = (mask & row.rule.getConfigId()) !== 0;
    player.getPacketSender().sendInterfaceDisplayState(uid(OPTIONS, RULE_CHECK_START + index), !checked);
  }
}

function inZone(player) {
  return WORLD_ZONE_BOUNDARIES.duel.some(boundary => boundary.inside(player.getLocation()));
}
function nearby(a, b) {
  return a.getLocation().getZ() === b.getLocation().getZ()
    && a.getPrivateArea() === b.getPrivateArea()
    && a.getLocation().getDistance(b.getLocation()) <= 16;
}
function hasRule(player, rule) {
  return player.getDueling().getRules()[rule.getButtonId()] === true;
}
function acceptBots(session, eventName) {
  for (const player of session.players) {
    if (!player.isPlayerBot() || session.accepted.has(player)) continue;
    const event = { player, session, accept: false };
    pluginApi.emitCustomEvent(eventName, event);
    if (event.accept) accept(player, session);
  }
}
function setRules(session, mask, notifyBots = true) {
  session.revision = (session.revision ?? 0) + 1;
  session.mask = mask;
  session.accepted.clear();
  for (const player of session.players) {
    const state = player.getDueling();
    for (let bit = 0; bit < 28; bit++) state.getRules()[bit] = (mask & (1 << bit)) !== 0;
    state.setState(DuelState.DUEL_SCREEN);
    player.getPacketSender().sendConfig(286, mask).sendConfig(3465, 0);
    if (player.getInterfaceId() === OPTIONS) {
      renderRules(player, mask);
      renderAccept(player);
    }
  }
  if (notifyBots) acceptBots(session, "duelarena:rules-changed");
}
function updateMenu({ player }) {
  const active = player.getDueling().inDuel();
  const mode = active ? "fight" : inZone(player) ? "offer" : "none";
  if (menuState.get(player) === mode) return;
  menuState.set(player, mode);
  player.getPacketSender().sendPlayerOption(DUEL_OPTION, mode === "offer" ? "Challenge" : "")
    .sendPlayerOption(1, active ? "Attack" : "", true)
    .sendPlayerOption(FORFEIT_OPTION, active && !hasRule(player, DuelRule.NO_FORFEIT) ? "Forfeit" : "");
}
function syncDuelIcon(player) {
  if (player.isPlayerBot()) return;
  const visible = inZone(player);
  if (duelIconVisible.get(player) === visible) return;
  const sender = player.getPacketSender();
  if (visible) {
    // pvp_icons is mounted for the whole session by the Wilderness plugin, which also owns
    // the block's visibility. Re-mounting it here reset every widget in the group to its
    // cache defaults behind that plugin's back, stranding a crossed skull and a level row.
    sender.sendVarbit(VARBIT_PVPA_BATTLEAREA_STATUS, 0)
      .sendVarbit(VARBIT_PVPA_TRANSMIT_CHALLENGE_OR_BATTLEAREA, 1)
      .sendClientScript(PVP_LAYOUT_SCRIPT);
  } else {
    sender.sendVarbit(VARBIT_PVPA_TRANSMIT_CHALLENGE_OR_BATTLEAREA, 0)
      .sendClientScript(PVP_LAYOUT_SCRIPT);
  }
  duelIconVisible.set(player, visible);
}
function resetCombat(player) {
  const combat = player.getCombat();
  combat.reset();
  combat.getHitQueue().clear();
  combat.setUnderAttack(null);
  combat.getKiller(true);
}
function inCombat(player) {
  return CombatFactory.inCombat(player) || player.getCombat().getHitQueue().hasPendingWork();
}
function resetState(player) {
  const state = player.getDueling();
  if (state.getRules().some(Boolean)) player.getPacketSender().sendConfig(286, 0);
  state.setState(DuelState.NONE);
  state.setInteract(null);
  state.getRules().fill(false);
  state.getButtonDelay().stop();
  requests.delete(player);
  requestDelay.delete(player);
}
function end(session, loser) {
  if (sessions.get(session.players[0]) !== session) return;
  session.task?.stop();
  const fought = session.stage === "fight";
  // Remove both links before resetting players: death/close/disconnect may re-enter.
  for (const player of session.players) sessions.delete(player);
  for (const player of session.players) {
    if (fought && player.getHitpoints() <= 0) pendingSafeDeaths.add(player);
    resetState(player);
    if (fought) resetCombat(player);
    else player.getCombat().reset();
    player.getPacketSender().sendInterfaceRemoval();
    if (fought) {
      player.resetAttributes();
      player.moveTo(EXIT.clone());
    }
    if (fought && (!loser || player !== loser)) {
      const owners = loser ? session.players : [player];
      if (owners.some(owner => session.offers.get(owner).size)) {
        const winnings = { player, session, owners, handled: false };
        pluginApi.emitCustomEvent("duelarena:settle-winnings", winnings);
        if (!winnings.handled) for (const owner of owners) for (const item of session.offers.get(owner).values()) {
        const inventory = player.getInventory();
        const fits = item.getDefinition().isStackable()
          ? (inventory.getFreeSlots() > 0 || inventory.getItems().some(existing => existing.getId() === item.getId()
            && JSON.stringify(existing.getMeta?.() ?? null) === JSON.stringify(item.getMeta?.() ?? null)))
            && inventory.getAmount(item.getId()) + item.getAmount() <= 2147483647
          : inventory.getFreeSlots() >= item.getAmount();
        if (fits) inventory.add(item.clone(), false);
        else {
          ItemOnGroundManager.registerNonGlobal(player, item.clone());
          player.sendMessage("Your inventory is full. Your duel stake is on the ground beneath you.");
        }
        }
        if (!winnings.handled) player.getInventory().refreshItems();
      }
    }
    player.setStatus(PlayerStatus.NONE);
    player.getPacketSender().sendEntityHintRemoval(true);
    player.sendMessage(loser ? player === loser ? "You lost the duel!" : "You won the duel!" : "Duel declined.");
    menuState.delete(player);
    updateMenu({ player });
  }
}
function snapshot(player) {
  return [player.getInventory(), player.getEquipment()].map(container =>
    container.getItems().map(item => `${item.getId()}:${item.getAmount()}:${JSON.stringify(item.getMeta?.() ?? null)}`).join(",")).join(";");
}
function inventorySnapshot(container) {
  return { capacity: container.capacity(), slots: container.getItems().map((item, slot) =>
    ({ slot, itemId: item.getId(), quantity: item.getAmount() })) };
}
function showOptions(session, info = "") {
  if (session.snapshots && session.players.some((p, i) => snapshot(p) !== session.snapshots[i])) {
    for (const player of session.players) session.offers.set(player, new Map());
  }
  session.stage = "options";
  setRules(session, session.mask, false);
  session.snapshots = session.players.map(snapshot);
  if (!stakingEnabled) {
    for (const player of session.players) {
      const other = session.players.find(p => p !== player);
      player.getPacketSender().sendConfiguredInterface("duel-offer");
      player.setStatus(PlayerStatus.DUELING);
      player.getPacketSender().sendString(other.getUsername(), uid(CACHE_OPTIONS, 6))
        .sendString(`Combat level: ${other.getSkillManager().getCombatLevel()}`, uid(CACHE_OPTIONS, 7))
        .sendString(info, uid(CACHE_OPTIONS, 83));
      for (const [i, skill] of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.HITPOINTS, Skill.RANGED, Skill.PRAYER, Skill.MAGIC].entries()) player.getPacketSender().sendString(String(other.getSkillManager().getMaxLevel(skill)), uid(CACHE_OPTIONS, 10 + i * 3));
      for (const child of [...CACHE_RULE_BUTTONS.keys(), 86, 87, 89, 90, 92, 94, 96]) player.getPacketSender().sendInterfaceFlags(uid(CACHE_OPTIONS, child), 2);
      updateMenu({ player });
    }
    return acceptBots(session, "duelarena:accept");
  }
  for (const player of session.players) {
    player.setInterfaceId(OPTIONS);
    if (!player.isPlayerBot()) {
      player.getPacketSender()
        .sendSubInterface(MAIN_MODAL_UID, CACHE_OPTIONS, 0, {
          hiddenUids: CACHE_HIDDEN,
          postScripts: [{ scriptId: 227, args: [uid(CACHE_OPTIONS, 1), ""] }],
        })
        .sendSubInterface(uid(CACHE_OPTIONS, 0), OPTIONS, 1);
    }
    // The duel screens leave the sidebar alone: nothing mounts into the side modal
    // (161:74), so the tabs stay up throughout instead of blinking out here and
    // back on at the start of the fight. Rule enforcement lives in the onCan* hooks.
    player.getPacketSender()
      .sendString(`Dueling with: ${session.players.find(p => p !== player).getUsername()}`, uid(OPTIONS, UI.TITLE));
    player.setStatus(PlayerStatus.DUELING);
    if (info) player.sendMessage(info);
    renderStakes(player, session);
    renderEquipment(player);
    renderRules(player, session.mask);
    updateMenu({ player });
  }
  acceptBots(session, "duelarena:accept");
}
function request({ player, target }) {
  // Revalidate both players after walking; zone edits and other requests can race the route.
  if (!target || player === target || !inZone(player) || !inZone(target) || !nearby(player, target) || player.getPrivateArea() != null) return;
  if (sessions.has(player) || sessions.has(target) || player.busy() || target.busy() || player.isTeleportingReturn() || target.isTeleportingReturn()
      || player.getHitpoints() <= 0 || target.getHitpoints() <= 0 || inCombat(player) || inCombat(target)) {
    player.sendMessage("That player is currently busy.");
    return;
  }
  const reciprocal = requests.get(target) === player;
  if (!reciprocal && Date.now() < (requestDelay.get(player) ?? 0)) return;
  requestDelay.set(player, Date.now() + 2000);
  requests.set(player, target);
  player.getDueling().setState(DuelState.REQUESTED_DUEL);
  if (reciprocal) {
    const session = { players: [player, target], mask: 0, accepted: new Set(), offers: new Map([[player, new Map()], [target, new Map()]]), stage: "options" };
    for (const p of session.players) {
      sessions.set(p, session);
      requests.delete(p);
      p.getMovementQueue().reset();
      resetCombat(p);
      p.getDueling().setInteract(p === player ? target : player);
    }
    showOptions(session);
  } else {
    player.sendMessage(`You've sent a duel challenge to ${target.getUsername()}.`);
    target.sendMessage(`${player.getUsername()} challenges you to a duel. Right-click them and choose Challenge to accept.`);
    if (!target.isPlayerBot()) return;
    const event = { player: target, challenger: player, accept: false };
    pluginApi.emitCustomEvent("duelarena:request", event);
    if (event.accept) request({ player: target, target: player });
  }
}
function equipmentToRemove(player) {
  const slots = new Set(EQUIPMENT_RULES.filter(rule => hasRule(player, rule)).map(rule => rule.getEquipmentSlot()));
  const weapon = player.getEquipment().getItems()[Equipment.WEAPON_SLOT];
  if (hasRule(player, DuelRule.NO_SHIELD) && weapon.isValid() && weapon.getDefinition().isDoubleHanded()) slots.add(Equipment.WEAPON_SLOT);
  return [...slots].filter(slot => player.getEquipment().getItems()[slot].isValid());
}
function isFunWeapon(item) {
  // https://oldschool.runescape.wiki/w/Duel_Arena#Combat: negative melee attack bonuses.
  const bonuses = item?.isValid() ? item.getDefinition().getBonuses() : null;
  return !!bonuses && bonuses.length >= 3 && bonuses.slice(0, 3).every(bonus => bonus < 0);
}
function reportBlockedAcceptance(player, message, botMessage) {
  if (!player.isPlayerBot()) {
    player.sendMessage(message);
    return;
  }
  player.forceChat(botMessage);
  for (const opponent of sessions.get(player).players) {
    if (!opponent.isPlayerBot()) {
      opponent.getPacketSender().sendPublicChat(botMessage, player.getUsername(), player.getIndex());
    }
  }
}
function canStart(session) {
  for (const player of session.players) {
    const other = session.players.find(p => p !== player);
    const winnings = [...session.offers.get(other).values()];
    if (winnings.length || session.offers.get(player).size) {
      const capacity = { player, session, winnings, handled: false };
      pluginApi.emitCustomEvent("duelarena:validate-winnings", capacity);
      if (!capacity.handled) {
      // ponytail: reserve one slot per offered stack and worn item; simulate stacking if too restrictive.
      const required = winnings.reduce((n, item) => n + (item.getDefinition().isStackable() ? 1 : item.getAmount()), 0)
        + player.getEquipment().getValidItems().length;
      if (player.getInventory().getFreeSlots() < required) {
        reportBlockedAcceptance(player, `Leave ${required} inventory slots free for winnings and equipment.`,
          "I need more inventory space for the winnings.");
        return false;
      }
      for (const item of winnings) {
        const total = player.getInventory().getAmount(item.getId()) + player.getEquipment().getAmount(item.getId())
          + winnings.filter(i => i.getId() === item.getId()).reduce((n, i) => n + i.getAmount(), 0);
        if (total > 2147483647) {
          reportBlockedAcceptance(player, "Your winnings would exceed the item stack limit.", "I can't hold that stake.");
          return false;
        }
      }
      }
    }
    const slots = equipmentToRemove(player);
    // ponytail: conservatively reserve one slot per item; simulate stacking if this becomes restrictive.
    if (player.getInventory().getFreeSlots() < slots.length) {
      reportBlockedAcceptance(player,
        `You need ${slots.length} free inventory slots for the disabled equipment.`,
        `I can't accept: I need ${slots.length} free inventory slot${slots.length === 1 ? "" : "s"} to remove my equipment.`);
      return false;
    }
    if (slots.some(slot => {
      const item = player.getEquipment().getItems()[slot];
      return item.getDefinition().isStackable() && player.getInventory().getAmount(item.getId()) + item.getAmount() > 2147483647;
    })) {
      reportBlockedAcceptance(player, "Your inventory cannot hold the removed equipment stack.",
        "I can't accept: my inventory can't hold the removed equipment stack.");
      return false;
    }
    if (hasRule(player, DuelRule.NO_MELEE) && hasRule(player, DuelRule.NO_RANGED) && hasRule(player, DuelRule.NO_MAGIC)) {
      reportBlockedAcceptance(player, "Enable at least one combat style.",
        "I can't accept: enable at least one combat style.");
      return false;
    }
    if (hasRule(player, DuelRule.FUN_WEAPONS) && (slots.includes(Equipment.WEAPON_SLOT)
        || !isFunWeapon(player.getEquipment().getItems()[Equipment.WEAPON_SLOT]))) {
      reportBlockedAcceptance(player, "Equip a fun weapon and allow the weapon slot, or disable Fun Weapons.",
        "I can't accept: I need a fun weapon and an allowed weapon slot, or disable Fun Weapons.");
      return false;
    }
  }
  return true;
}
function showConfirm(session) {
  session.stage = "confirm";
  session.accepted.clear();
  for (const player of session.players) {
    player.getDueling().setState(DuelState.CONFIRM_SCREEN);
    player.getPacketSender().sendConfig(3465, 0).sendConfiguredInterface("duel-confirm");
    player.setStatus(PlayerStatus.DUELING);
    for (const child of [50, 51]) player.getPacketSender().sendInterfaceFlags(uid(CONFIRM, child), 2);
    const other = session.players.find(p => p !== player);
    // The cache renders your worn items from inventory 94 and the opponent's via 6190.
    player.getPacketSender().sendInterfaceScript(6177,
      [uid(CONFIRM, 0), uid(CONFIRM, 11), uid(CONFIRM, 12), uid(CONFIRM, 13), uid(CONFIRM, 14), uid(CONFIRM, 31), uid(CONFIRM, 51), uid(CONFIRM, 50), uid(CONFIRM, 56)],
      { 286: session.mask }, undefined, { 94: inventorySnapshot(player.getEquipment()) });
    if (hasRule(player, DuelRule.SHOW_INVENTORIES)) {
      player.getPacketSender().sendClientScript(6190, ...other.getEquipment().getItems().map(item => item.getId()));
      player.getPacketSender().sendInterfaceScript(149,
        [uid(CONFIRM, 13), OPPONENT_INVENTORY, 4, 7, 0, -1, "", "", "", "", ""],
        undefined, undefined, { [OPPONENT_INVENTORY]: inventorySnapshot(other.getInventory()) });
    }
    confirmText(player, other);
  }
}
function confirmText(player, other, status = "") {
  // Cache script 6193 builds and sizes the scrollable summary in component 53.
  player.getPacketSender().sendInterfaceScript(6193, [
    sessions.get(player).mask, presets.get(player) ?? -1, lastRules.get(player) ?? -1,
    `${other.getUsername()}<br>Your stake: ${stakeText(player)}<br>Opponent stake: ${stakeText(other)}${status ? `<br>${status}` : ""}<br>Hitpoints and boosted stats will be restored.`,
  ]);
}
class DuelCountdown extends Task {
  constructor(session) { super(1, session); this.session = session; this.ticks = 0; }
  execute() {
    const session = this.session;
    if (sessions.get(session.players[0]) !== session) return this.stop();
    if (session.players.some(player => !ARENA.inside(player.getLocation()))) return end(session, session.players.find(player => !ARENA.inside(player.getLocation())));
    if (this.ticks % 2 === 0) {
      const left = 3 - this.ticks / 2;
      for (const player of session.players) {
        player.forceChat(left > 0 ? `${left}..` : "FIGHT!!");
        if (left === 0) player.getDueling().setState(DuelState.IN_DUEL);
      }
      if (left === 0) this.stop();
    }
    this.ticks++;
  }
}
function arenaSpawns() {
  // Java's unobstructed arena bounds, validated against this cache's collision map.
  const available = [];
  for (let x = 3335; x <= 3346; x++) for (let y = 3246; y <= 3252; y++) {
    if (RegionManager.canMove(x, y, x - 1, y, 0, 1, 1, null)
        && RegionManager.canMove(x - 1, y, x, y, 0, 1, 1, null)
        && !World.isPlayerOccupyingTile(new Location(x, y, 0), null, 1, null)
        && !World.isPlayerOccupyingTile(new Location(x - 1, y, 0), null, 1, null)) available.push(new Location(x, y, 0));
  }
  const first = available[Math.floor(Math.random() * available.length)];
  return first ? [first, first.clone().add(-1, 0)] : null;
}
function start(session) {
  const spawns = arenaSpawns();
  if (!spawns) return showOptions(session, "No space is currently available in the arena.");
  for (const player of session.players) {
    for (const [slot, item] of session.offers.get(player)) {
      player.getInventory().deleteAtSlot(slot, item.getAmount(), false);
    }
    player.getInventory().refreshItems();
  }
  session.stage = "fight";
  for (const player of session.players) {
    lastRules.set(player, session.mask);
    player.getDueling().setState(DuelState.STARTING_DUEL);
    player.getPacketSender().sendInterfaceRemoval();
    for (const slot of equipmentToRemove(player)) {
      player.getEquipment().switchItems(player.getInventory(), player.getEquipment().getItems()[slot].clone(), false, false);
    }
    player.resetAttributes();
    player.moveTo(spawns[session.players.indexOf(player)]);
    player.setStatus(PlayerStatus.NONE);
    player.getPacketSender().sendEntityHint(player.getDueling().getInteract());
    updateMenu({ player });
  }
  session.task = new DuelCountdown(session);
  TaskManager.submit(session.task);
}
function accept(player, session, botEvent = "duelarena:accept") {
  if (!session.players.every(inZone) || !nearby(...session.players) || session.players.some(p => p.getHitpoints() <= 0 || inCombat(p))) return end(session);
  if (session.players.some((p, i) => snapshot(p) !== session.snapshots[i])) return showOptions(session, "Items changed. Please review the duel again.");
  if (!canStart(session)) return;
  if (session.accepted.has(player)) return acceptBots(session, botEvent);
  session.accepted.add(player);
  const confirm = session.stage === "confirm";
  player.getDueling().setState(confirm ? DuelState.ACCEPTED_CONFIRM_SCREEN : DuelState.ACCEPTED_DUEL_SCREEN);
  player.getPacketSender().sendVarbit(confirm ? 14030 : 14027, 1);
  const other = session.players.find(p => p !== player);
  if (confirm) confirmText(other, player, "Your opponent has accepted.");
  else {
    renderAccept(player, true);
    other.sendMessage(`${player.getUsername()} has accepted.`);
  }
  if (session.accepted.size === 2) {
    if (confirm) start(session); else showConfirm(session);
  } else acceptBots(session, botEvent);
}
function handleInterface(event) {
  const { player, buttonId } = event;
  const group = buttonId >>> 16;
  const child = buttonId & 0xffff;
  if (stakingEnabled && (buttonId === (85 << 16) && sessions.has(player)
      || group === OPTIONS && child === UI.YOUR_ITEMS)) return handleStake(event);
  if (group !== CACHE_OPTIONS && group !== CONFIRM && (group !== OPTIONS || !stakingEnabled)) return;
  event.handled = true;
  if (event.opId !== undefined && event.opId !== 1) return;
  const session = sessions.get(player);
  if (!session || session.stage === "fight") return;
  if (player.getInterfaceId() !== (session.stage === "options" ? (stakingEnabled ? OPTIONS : CACHE_OPTIONS) : CONFIRM)) return;
  if (session.stage === "options" && group !== (stakingEnabled ? OPTIONS : CACHE_OPTIONS) && group !== CACHE_OPTIONS
      || session.stage === "confirm" && group !== CONFIRM) return;
  if (child === (group === CACHE_OPTIONS ? CACHE_DECLINE : group === CONFIRM ? 50 : -1)
      || child === 1) return end(session);
  if (child === (group === CACHE_OPTIONS ? CACHE_ACCEPT : group === CONFIRM ? 51 : -1)) {
    return accept(player, session, "duelarena:accept-clicked");
  }
  if (group !== (stakingEnabled ? OPTIONS : CACHE_OPTIONS)) return;
  const rule = (stakingEnabled ? OPTION_RULE_BUTTONS : CACHE_RULE_BUTTONS).get(child);
  if (rule) {
    setRules(session, session.mask ^ rule.getConfigId());
    return;
  }
  // The cache screen's preset row: store the current rules, recall them, recall the last
  // duel's, and the two bulk presets. Only that screen has these components - showOptions
  // flags them clickable - so the staking UI never reaches them.
  if (group !== CACHE_OPTIONS) return;
  if (child === 89) {
    presets.set(player, session.mask);
  } else if (child === 90 || child === 92) {
    setRules(session, (child === 90 ? presets : lastRules).get(player) ?? 0);
  } else if (child === 94 || child === 96) {
    const rules = [DuelRule.NO_RANGED, DuelRule.NO_MAGIC, DuelRule.NO_SPECIAL_ATTACKS, DuelRule.NO_PRAYER, DuelRule.NO_POTIONS, DuelRule.NO_FOOD];
    rules.push(...EQUIPMENT_RULES.filter(rule => child === 96 || rule !== DuelRule.NO_WEAPON));
    if (child === 94) rules.push(DuelRule.LOCK_WEAPON);
    setRules(session, rules.reduce((mask, rule) => mask | rule.getConfigId(), 0));
  }
}
function handleOption(event) {
  if (event.option === DUEL_OPTION) {
    event.handled = true;
    const session = sessions.get(event.player);
    const expectedInterface = session?.stage === "options" ? (stakingEnabled ? OPTIONS : CACHE_OPTIONS) : CONFIRM;
    if (session && session.stage !== "fight" && session.players.some(player => !player.isPlayerBot()
      && (player.getInterfaceId() !== expectedInterface || player.getStatus() !== PlayerStatus.DUELING))) {
      end(session);
    }
    if (sessions.has(event.player)) return;
    if (inZone(event.player) && inZone(event.target) && nearby(event.player, event.target)) {
      request(event);
    }
  }
  if (event.option === FORFEIT_OPTION) {
    const session = sessions.get(event.player);
    if (session?.stage === "fight" && event.player.getDueling().getInteract() === event.target) {
      event.handled = true;
      if (!hasRule(event.player, DuelRule.NO_FORFEIT)) end(session, event.player);
    }
  }
}
function processPlayer({ player }) {
  syncDuelIcon(player);
  const session = sessions.get(player);
  if (session) {
    const expectedInterface = session.stage === "options" ? (stakingEnabled ? OPTIONS : CACHE_OPTIONS) : CONFIRM;
    const outside = session.players.find(p => session.stage === "fight" ? !ARENA.inside(p.getLocation()) : !inZone(p));
    if (outside) end(session, session.stage === "fight" ? outside : undefined);
    else if (session.stage !== "fight" && session.players.some(p => !p.isPlayerBot()
      && (p.getInterfaceId() !== expectedInterface || p.getStatus() !== PlayerStatus.DUELING))) end(session);
  }
  if (!inZone(player) && !sessions.has(player)) resetState(player);
  updateMenu({ player });
}
function disconnect({ player }) {
  const session = sessions.get(player);
  if (session) end(session, session.stage === "fight" ? player : undefined);
  resetState(player);
  menuState.delete(player);
}
function handleDeath(event) {
  if (pendingSafeDeaths.has(event.player)) {
    pendingSafeDeaths.delete(event.player);
    event.handled = true;
    return;
  }
  const session = sessions.get(event.player);
  if (session?.stage !== "fight") return;
  event.handled = true;
  end(session, event.player);
  pendingSafeDeaths.delete(event.player);
}
function preventDuringDuel(event) {
  if (sessions.has(event.player)) event.allow = false;
}
function canEat(event) {
  if (event.player.getDueling().inDuel() && hasRule(event.player, DuelRule.NO_FOOD)) event.allow = false;
}
function canDrink(event) {
  if (event.player.getDueling().inDuel() && hasRule(event.player, DuelRule.NO_POTIONS)) event.allow = false;
}
function canEquip(event) {
  if (!event.player.getDueling().inDuel()) return;
  if (EQUIPMENT_RULES.some(rule => rule.getEquipmentSlot() === event.slot && hasRule(event.player, rule))
      || event.slot === Equipment.WEAPON_SLOT && (hasRule(event.player, DuelRule.LOCK_WEAPON)
        || hasRule(event.player, DuelRule.FUN_WEAPONS) && !isFunWeapon(event.item)
        || hasRule(event.player, DuelRule.NO_SHIELD) && event.item.getDefinition().isDoubleHanded())) event.allow = false;
}
function canUnequip(event) {
  if (event.player.getDueling().inDuel() && event.slot === Equipment.WEAPON_SLOT
      && (hasRule(event.player, DuelRule.LOCK_WEAPON) || hasRule(event.player, DuelRule.FUN_WEAPONS))) event.allow = false;
}
function shouldDrop(event) {
  if (event.player.getDueling().inDuel() || pendingSafeDeaths.has(event.player)) event.shouldDrop = false;
}
function canAttack(event) {
  const a = event.attacker.getAsPlayer?.();
  const b = event.target.getAsPlayer?.();
  if ((a && sessions.has(a)) || (b && sessions.has(b))) {
    event.allow = !!a && !!b && a.getDueling().getState() === DuelState.IN_DUEL
      && b.getDueling().getState() === DuelState.IN_DUEL
      && a.getDueling().getInteract() === b && b.getDueling().getInteract() === a;
  }
}
function shutdown() {
  for (const session of new Set(sessions.values())) end(session);
}
module.exports = {
  name: "DuelArena",
  enableStaking,
  register(api) {
    pluginApi = api;
    api.registerCustomInterface(DUEL_INTERFACE);
    api.onPlayerLogin(processPlayer);
    api.onPlayerProcess(processPlayer);
    api.onPlayerOption(handleOption);
    api.onInterfaceActionClick(handleInterface);
    api.onButtonClick(handleInterface);
    api.onPlayerDisconnect(disconnect);
    api.onPlayerLogout(disconnect);
    api.onPlayerDeath(handleDeath);
    api.onShouldDropItemsOnDeath(shouldDrop);
    api.onCanAttack(canAttack);
    api.onCanTeleport(preventDuringDuel);
    api.onCanTrade(preventDuringDuel);
    api.onCanBank(preventDuringDuel);
    api.onCanShop(preventDuringDuel);
    api.onCanEat(canEat);
    api.onCanDrink(canDrink);
    api.onCanEquip(canEquip);
    api.onCanUnequip(canUnequip);
    api.onServerShutdown(shutdown);
  },
};
