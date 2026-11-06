// Close buttons that the cache leaves to the server: each is a static transmit op1 "Close" with no
// client-side close script (rev 241), and no plugin handles it, so clicking it did nothing.
// A click closes that interface if it is the one open. Plugins that own an interface's close
// (a book's page state, a minigame panel) handle it themselves and don't belong here.
const CLOSE_BUTTONS = [
  "indexed_book:close_button", // 680:7
  "gauntlet_recipes:close", // 640:2
  "trailblazer_areas:close_button", // 512:5
  "warguild_defence:close", // 410:3
  "warguild_dummy:close", // 412:18
];

function closeButtonIds(api) {
  return CLOSE_BUTTONS.map((name) => {
    const id = api.core.CacheDefinitions.getComponentId(name);
    if (id == null) throw new Error(`CloseButtons: the cache has no component ${name}`);
    return id;
  });
}

function close({ player, buttonId }) {
  player.getPacketSender().closeInterface(buttonId >>> 16);
  return true;
}

module.exports = {
  name: "CloseButtons",
  CLOSE_BUTTONS,
  register(api) {
    api.onInterfaceActionButton(closeButtonIds(api), close);
  },
};
