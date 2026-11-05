const Layout = require("./Layout.SideJournalDefaults");

const NATIVE_SUMMARY_GROUP_ID = 712;
const SIDE_JOURNAL_GROUP_ID = 629;
const JOURNAL_CONTENT_UID = (SIDE_JOURNAL_GROUP_ID << 16) | 43;
const COMBAT_XP_LOCKED_ATTRIBUTE = "skills:combat-xp-locked";
const ALL_XP_LOCKED_ATTRIBUTE = "skills:xp-locked";
const COMBAT_SKILLS = ["ATTACK", "STRENGTH", "DEFENCE", "RANGED", "MAGIC", "HITPOINTS", "PRAYER"];
const NUMBER = new Intl.NumberFormat("en-US");
const RATIO = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const panels = new WeakMap();
let pluginApi;
let core;

function escaped(value) {
  return String(value).replaceAll("<", "(").replaceAll(">", ")");
}

function combatXpEnabled(player) {
  return player.getAttribute(COMBAT_XP_LOCKED_ATTRIBUTE) !== true && player.getAttribute(ALL_XP_LOCKED_ATTRIBUTE) !== true;
}

function availableCommands(player) {
  return new Set(pluginApi.getRegisteredCommands(player).map(({ command }) => command));
}

function renderButtons(player, panel) {
  const commands = availableCommands(player);
  const signature = Layout.BUTTONS.filter(button => commands.has(button.command)).map(button => button.component).join(",");
  if (panel.buttons === signature) return;
  const sender = player.getPacketSender();
  for (const button of Layout.BUTTONS) {
    for (const offset of [0, 6, 10]) {
      sender.sendInterfaceDisplayState(Layout.uid(button.component + offset), !commands.has(button.command));
    }
  }
  for (const { component, x, y } of Layout.buttonPositions(commands)) {
    for (const offset of [0, 6, 10]) sender.sendInterfacePosition(Layout.uid(component + offset), x, y);
  }
  panel.buttons = signature;
}

function wealth(player) {
  const balances = new Map();
  let bankValue = 0n;
  let bankCoins = 0;
  for (let tab = 0; tab < core.Bank.TOTAL_BANK_TABS; tab++) {
    // Search results duplicate the real bank items; placeholders have zero quantity.
    if (tab === core.Bank.BANK_SEARCH_TAB_INDEX) continue;
    for (const item of player.getBank(tab).getItems()) {
      if (!item || item.getId() < 0 || item.getAmount() <= 0) continue;
      const amount = item.getAmount();
      balances.set(item.getId(), (balances.get(item.getId()) ?? 0) + amount);
      if (item.getId() === core.ItemIdentifiers.COINS) bankCoins += amount;
      const value = item.getDefinition().getGrandExchangeValue();
      if (Number.isFinite(value) && value > 0) bankValue += BigInt(Math.floor(value)) * BigInt(amount);
    }
  }
  for (const item of player.getInventory().getValidItems()) {
    balances.set(item.getId(), (balances.get(item.getId()) ?? 0) + item.getAmount());
  }
  const amount = (name) => balances.get(core.ItemIdentifiers[name]) ?? 0;
  return {
    bankValue,
    bankCoins,
    bloodMoney: amount("BLOOD_MONEY"),
    platinumTokens: amount("PLATINUM_TOKEN"),
    tokkul: amount("TOKKUL"),
    stardust: amount("STARDUST"),
    marksOfGrace: amount("MARK_OF_GRACE"),
  };
}

function render(player) {
  const panel = panels.get(player);
  if (!panel) return;
  const pvp = { player, stats: null };
  const slayer = { player, task: null, points: 0 };
  pluginApi.emitCustomEvent("pvp:stats", pvp);
  pluginApi.emitCustomEvent("slayer:current-task", slayer);
  const values = {
    ...pvp.stats,
    ...wealth(player),
    kdr: RATIO.format(pvp.stats?.kdr ?? 0),
    task: slayer.task?.name ?? "None",
    remaining: slayer.task?.count ?? "N/A",
    slayerPoints: slayer.points,
  };
  const sender = player.getPacketSender();
  renderButtons(player, panel);
  const send = (component, text) => {
    if (panel.text.get(component) === text) return;
    sender.sendString(text, Layout.uid(component));
    panel.text.set(component, text);
  };
  send(Layout.COMPONENT.USERNAME, escaped(player.getDisplayName()));
  send(Layout.COMPONENT.XP + 10, `Combat XP: ${combatXpEnabled(player) ? "<col=00ff00>On" : "<col=ff5050>Off"}</col>`);
  for (const { key, label, component, multiline } of Layout.ROWS) {
    const value = values[key] ?? 0;
    const text = typeof value === "number" || typeof value === "bigint" ? NUMBER.format(value) : escaped(value);
    send(component, `${label}:${multiline ? "<br>" : " "}<col=ffffff>${text}</col>`);
  }
  panel.nextRefresh = Date.now() + 2000;
}

function resolveContent(request) {
  if (request.groupId !== NATIVE_SUMMARY_GROUP_ID) return;
  // The client runtime owns one custom interface at a time. Close a custom main modal
  // before mounting the summary, so a visible modal cannot lose its search/tab state.
  const modalId = request.player.getInterfaceId?.() ?? -1;
  if (modalId >= 0 && core.CustomInterfaceRegistry.get(modalId)) {
    request.player.getPacketSender().sendInterfaceRemoval();
  }
  request.groupId = Layout.GROUP_ID;
}

function mounted({ player, groupId }) {
  if (groupId !== Layout.GROUP_ID) {
    panels.delete(player);
    return;
  }
  panels.set(player, { text: new Map(), nextRefresh: 0 });
  render(player);
}

function interfaceOpened({ player, groupId, targetUid }) {
  if (targetUid === JOURNAL_CONTENT_UID && groupId !== Layout.GROUP_ID) panels.delete(player);
}

function refresh({ player }) {
  const panel = panels.get(player);
  if (panel && Date.now() >= panel.nextRefresh) render(player);
}

function logout({ player }) {
  panels.delete(player);
}

function statsChanged({ player }) {
  render(player);
}

function click({ player, buttonId }) {
  if (!panels.has(player)) return false;
  const component = buttonId & 0xffff;
  const button = Layout.BUTTONS.find(button => component === button.component || component === button.component + 10);
  if (!button || !availableCommands(player).has(button.command)) return false;
  if (button.event) {
    pluginApi.emitCustomEvent(button.event, { player });
    return true;
  }
  switch (component) {
    case Layout.COMPONENT.XP:
    case Layout.COMPONENT.XP + 10: {
      const enable = !combatXpEnabled(player);
      player.setAttribute(COMBAT_XP_LOCKED_ATTRIBUTE, !enable);
      // An existing ::lockxp must be released to make the requested On state work.
      if (enable && player.getAttribute(ALL_XP_LOCKED_ATTRIBUTE) === true) player.setAttribute(ALL_XP_LOCKED_ATTRIBUTE, false);
      pluginApi.emitCustomEvent("persistence:save", { player, reason: "combat-xp-toggle" });
      player.getPacketSender().sendMessage(`Combat experience is now ${enable ? "enabled" : "disabled"}.`);
      render(player);
      return true;
    }
    default:
      return false;
  }
}

function canGainExperience(event) {
  if (event.player.getAttribute(COMBAT_XP_LOCKED_ATTRIBUTE) === true && COMBAT_SKILLS.some((name) => core.Skill[name] === event.skill)) {
    event.allow = false;
  }
}

function initialize(api) {
  pluginApi = api;
  core = api.core;
}

/** Keep the saved choice across opt-outs without installing an invisible XP gate. */
function persistCombatXpChoice(api) {
  api.persistAttribute(COMBAT_XP_LOCKED_ATTRIBUTE, false);
}

module.exports = function attachSummary(api) {
  initialize(api);
  api.registerCustomInterface(Layout.DEFINITION);
  api.onCustomEvent("side-journal:resolve-content", resolveContent);
  api.onCustomEvent("side-journal:mounted", mounted);
  api.onCustomEvent("interface:opened", interfaceOpened);
  api.onCustomEvent("pvp:stats-changed", statsChanged);
  api.onInterfaceActionButton(Layout.BUTTONS.flatMap(({ component }) => [Layout.uid(component), Layout.uid(component + 10)]), click);
  api.onCanGainExperience(canGainExperience);
  api.onPlayerProcess(refresh);
  api.onPlayerLogout(logout);
};

module.exports.persistCombatXpChoice = persistCombatXpChoice;
