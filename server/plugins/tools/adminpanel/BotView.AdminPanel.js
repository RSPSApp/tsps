const Bots = require("./Bots.AdminPanel");
const { FLAG_OP1, TYPE_TEXT } = require("../../interface/widgetGroup");
const BOTS_TAB = 6;

const C = {
  BACKGROUND: 6998, BORDER: 6999, CATEGORY: 7000, CATEGORY_LABEL: 7010, VIEW: 7020, SCROLLBAR: 7021, TITLE: 7022, NOTE: 7023,
  COUNT_LABEL: 7024, MINUS: 7025, MINUS_LABEL: 7026, COUNT: 7027, PLUS: 7028, PLUS_LABEL: 7029,
  LOCATION: 7030, LOCATION_LABEL: 7031, LOCATION_INFO: 7032, LEVELS: 7033, LEVELS_LABEL: 7034,
  OPTION: 7040, OPTION_LABEL: 7050, HEIGHT: 7060, MANAGE: 7070, MANAGE_LABEL: 7110,
  PRIMARY: 7150, PRIMARY_LABEL: 7151, BACK: 7152, BACK_LABEL: 7153, FEEDBACK: 7154,
};
const CATEGORIES = ["Spawn bots", "Active bots", "My character"];
const MANAGE_SLOTS = 32;
const categoryComponents = CATEGORIES.flatMap((_, i) => [C.CATEGORY + i, C.CATEGORY_LABEL + i]);
const setupComponents = [C.COUNT_LABEL, C.MINUS, C.MINUS_LABEL, C.COUNT, C.PLUS, C.PLUS_LABEL,
  C.LOCATION, C.LOCATION_LABEL, C.LOCATION_INFO, C.LEVELS, C.LEVELS_LABEL,
  ...Array.from({ length: 3 }, (_, i) => [C.OPTION + i, C.OPTION_LABEL + i]).flat()];
const managementComponents = Array.from({ length: MANAGE_SLOTS }, (_, i) => [C.MANAGE + i, C.MANAGE_LABEL + i]).flat();
const components = [C.BACKGROUND, C.BORDER, ...categoryComponents, C.VIEW, C.SCROLLBAR, C.TITLE, C.NOTE, C.FEEDBACK,
  C.PRIMARY, C.PRIMARY_LABEL, C.BACK, C.BACK_LABEL, ...setupComponents, ...managementComponents];
const hidden = { hidden: true, isHidden: true };

function build(add, root, text, box, button) {
  CATEGORIES.forEach((name, i) => button(C.CATEGORY + i, C.CATEGORY_LABEL + i, root, 18 + i * 126, 88, 122, 22, name, hidden));
  add(C.BACKGROUND, root, box(18, 32, 36, 112, { widthMode: 1, heightMode: 1, ...hidden }));
  add(C.BORDER, root, box(18, 32, 36, 112, { widthMode: 1, heightMode: 1, filled: false, color: 0x806845, ...hidden }));
  const view = add(C.VIEW, root, { rawX: 18, rawY: 32, rawWidth: 54, rawHeight: 112,
    widthMode: 1, heightMode: 1, scrollHeight: 400, ...hidden });
  add(C.SCROLLBAR, root, { rawX: 18, rawY: 32, rawWidth: 14, rawHeight: 112, xPositionMode: 2,
    heightMode: 1, noClickThrough: true, ...hidden });
  add(C.HEIGHT, root, { type: TYPE_TEXT, ...hidden });
  add(C.TITLE, view, text(12, 8, 24, 44, { widthMode: 1, fontId: 496, textColor: 0xffd27f }));
  add(C.NOTE, view, text(12, 56, 24, 48, { widthMode: 1, textColor: 0xb9ab96 }));
  add(C.COUNT_LABEL, view, text(12, 112, 150, 24, { text: "Bots to spawn", yTextAlignment: 1, ...hidden }));
  button(C.MINUS, C.MINUS_LABEL, view, 168, 112, 28, 24, "-", hidden);
  add(C.COUNT, view, text(200, 112, 48, 24, { flags: FLAG_OP1, actions: ["Set quantity"], xTextAlignment: 1, yTextAlignment: 1, ...hidden }));
  button(C.PLUS, C.PLUS_LABEL, view, 252, 112, 28, 24, "+", hidden);
  button(C.LOCATION, C.LOCATION_LABEL, view, 12, 146, 24, 26, "", { widthMode: 1, ...hidden });
  add(C.LOCATION_INFO, view, text(12, 178, 24, 30, { widthMode: 1, textColor: 0xb9ab96, ...hidden }));
  button(C.LEVELS, C.LEVELS_LABEL, view, 12, 216, 24, 26, "", { widthMode: 1, ...hidden });
  for (let i = 0; i < 3; i++) button(C.OPTION + i, C.OPTION_LABEL + i, view, 12, 254 + i * 34, 24, 28, "", { widthMode: 1, ...hidden });
  for (let i = 0; i < MANAGE_SLOTS; i++) button(C.MANAGE + i, C.MANAGE_LABEL + i, view, 12, 112 + Math.floor(i / 2) * 34, 7600, 28, "", { widthMode: 2, xPositionMode: i % 2 ? 2 : 0, ...hidden });
  button(C.PRIMARY, C.PRIMARY_LABEL, root, 18, 18, 160, 26, "", { xPositionMode: 2, yPositionMode: 2, ...hidden });
  button(C.BACK, C.BACK_LABEL, root, 18, 18, 122, 26, "Back to bots", { yPositionMode: 2, ...hidden });
  add(C.FEEDBACK, root, text(18, 48, 36, 28, { widthMode: 1, yPositionMode: 2, textColor: 0xffd27f, ...hidden }));
}

function render(api, player, state, uid, hide) {
  const active = state.tab === BOTS_TAB, config = Bots.config(state), form = active && config.view !== "browse";
  const data = state.botSnapshot ?? {}, controls = data.controls ?? {};
  const sender = player.getPacketSender(), send = (component, value) => sender.sendString(String(value ?? ""), uid(component));
  hide(components, true);
  hide(categoryComponents, !active || form);
  CATEGORIES.forEach((name, i) => send(C.CATEGORY_LABEL + i, `${Bots.CATEGORIES[i] === config.category ? "<col=ffffff>" : "<col=ffd27f>"}${name}</col>`));
  if (!form) return;
  hide([C.BACKGROUND, C.BORDER, C.VIEW, C.SCROLLBAR, C.TITLE, C.NOTE, C.FEEDBACK, C.BACK, C.BACK_LABEL], false);
  const self = config.view === "self";
  send(C.FEEDBACK, (config.feedback ?? "").slice(0, 120));
  state.botButtons = new Map();
  if (config.view === "setup") {
    const launcher = data.launchers?.find(item => item.key === config.key);
    if (!launcher) { send(C.TITLE, "Launcher unavailable"); send(C.NOTE, "Go back and choose another bot behavior or routine."); return; }
    send(C.TITLE, `Configure ${launcher.name}`);
    send(C.NOTE, launcher.description);
    hide(setupComponents.slice(0, -6), false);
    hide([C.LOCATION, C.LOCATION_LABEL], launcher.allowLocation === false);
    hide([C.LEVELS, C.LEVELS_LABEL], launcher.allowSkills === false);
    send(C.COUNT, config.count);
    send(C.LOCATION_LABEL, `Spawn location: ${config.usePlayerLocation ? "My current tile" : "Saved location"}`);
    const at = config.usePlayerLocation ? player.getLocation() : launcher.location;
    send(C.LOCATION_INFO, at ? `Tile ${at.getX?.() ?? at.x}, ${at.getY?.() ?? at.y}, plane ${at.getZ?.() ?? at.z}` : "No saved location. Uses your current tile.");
    send(C.LEVELS_LABEL, `Copy my levels: ${config.copyOwnerSkills ? "On" : "Off"}`);
    const values = config.setup[launcher.key] ?? {};
    launcher.setupFields.forEach((field, i) => {
      hide([C.OPTION + i, C.OPTION_LABEL + i], false);
      send(C.OPTION_LABEL + i, `${field.label}: ${field.choices.find(choice => choice.value === (values[field.id] ?? field.defaultValue))?.label ?? "Choose"}`);
      state.botButtons.set(C.OPTION + i, `field:${field.id}`);
      state.botButtons.set(C.OPTION_LABEL + i, `field:${field.id}`);
    });
    send(C.HEIGHT, 260 + launcher.setupFields.length * 34);
    const managed = data.capacity === null ? data.managed : `${data.managed}/${data.capacity}`;
    send(C.FEEDBACK, (config.feedback || `${managed} managed bots. Limit ${data.limit} per spawn.`).slice(0, 120));
    send(C.PRIMARY_LABEL, `Spawn ${config.count} bot${config.count === 1 ? "" : "s"}`);
    hide([C.PRIMARY, C.PRIMARY_LABEL], false);
    return;
  }
  if (self) {
    send(C.TITLE, "My character");
    send(C.NOTE, `Your bot controller is ${controls.selfEnabled ? "on" : "off"}. Start it to let your character run bot behavior. Stop it to resume manual play.`);
    hide([C.PRIMARY, C.PRIMARY_LABEL], !controls.allowed?.self);
    send(C.PRIMARY_LABEL, controls.selfEnabled ? "Stop bot control" : "Start bot control");
    send(C.HEIGHT, 120);
    return;
  }
  const bot = controls.bots?.find(item => item.username === config.bot);
  send(C.TITLE, bot ? `Manage ${bot.name}` : "Bot offline");
  send(C.NOTE, bot ? `Current behavior: ${bot.mode}. Choose an action below. Manual control returns with ::botback.` : "Go back to Active bots and choose an online bot.");
  const actions = bot ? [
    ...[["stats", "Copy my stats"], ["gear", "Copy my equipment"], ["rename", "Rename bot"], ["info", "Inspect bot"], ["control", "Take manual control"]]
      .filter(([key]) => controls.allowed?.[key]).map(([key, name]) => ({ key: `control:${key}`, name })),
    ...(controls.allowed?.behavior ? (controls.modes ?? []).map(mode => ({ key: `control:behavior:${mode}`,
      name: mode === "manual" ? "Pause AI" : mode === "recruit" ? "Follow me" : `Behavior: ${mode.replace(/_/g, " ")}` })) : []),
  ].slice(0, MANAGE_SLOTS) : [];
  actions.forEach((action, i) => {
    hide([C.MANAGE + i, C.MANAGE_LABEL + i], false);
    send(C.MANAGE_LABEL + i, action.name);
    state.botButtons.set(C.MANAGE + i, action.key); state.botButtons.set(C.MANAGE_LABEL + i, action.key);
  });
  send(C.HEIGHT, 120 + Math.ceil(actions.length / 2) * 34);
}

module.exports = { C, CATEGORIES, components, categoryComponents, setupComponents, managementComponents, build, render };
