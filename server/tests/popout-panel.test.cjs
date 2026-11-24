// Run after `yarn build`: node --test tests/popout-panel.test.cjs
// The popout panel (popout, 728): its buttons' events on mount and what each click sends.
// rsprox_transcripts/227/02148.txt (sub 0), 241/911590.txt and 237/04116.txt (sub 1), 227/02137.txt (sub 2).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

// Accounts writes its file to this path; keep it off the real data/saves, before `dist` is required.
process.env.TSPS_ACCOUNTS_FILE = path.join(require("node:fs").mkdtempSync(path.join(require("node:os").tmpdir(), "accounts-")), "accounts.json");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const {
  decodeClientPackets,
  encodeGameframeBootstrap,
  encodeRunClientScript,
  encodeWidgetCloseSub,
  encodeWidgetOpenSub,
  encodeWidgetSetFlagsRange,
  MOBILE_GAMEFRAME_ROOT,
} = require("../dist/net/protocol/ClientProtocol");
const { ClientPacketId: NativeClientPacket } = require("../dist/net/protocol/NativeClientPackets");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PluginManager } = require("../dist/plugins/PluginManager");

const core = PluginManager.getCoreApi();
const C = () => core.CacheDefinitions;
const OP1 = 1 << 1;
const OP6 = 1 << 6;
const TARGET = 1 << 21;
const TOPLEVEL_SETUP_POPOUT = 5354;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/interface/PopoutPanel.plugin").register(PluginManager.createApi("PopoutPanelTest"));
});

let nextIndex = 9610;

function realPlayer(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  player.setIndex(nextIndex++);
  player.setUsername(`popout${player.getIndex()}`);
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  const connection = new ClientConnection(channel);
  connection.player = player;
  const sent = [];
  const send = session.sendClientPacket.bind(session);
  session.sendClientPacket = (frame) => { sent.push(Buffer.from(frame)); return send(frame); };
  t.after(() => {
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
  });
  return { player, connection, sent };
}

/** A native IF_BUTTON1 on one dynamic child of a component. */
function buttonFrame(widgetId, slot) {
  const frame = Buffer.alloc(9);
  frame[0] = NativeClientPacket.IF_BUTTON1;
  frame.writeInt32BE(widgetId | 0, 1);
  frame.writeUInt16BE(slot, 5);
  frame.writeUInt16BE(65535, 7);
  return frame;
}

async function click(connection, sent, name, slot) {
  sent.length = 0;
  const messages = decodeClientPackets(buttonFrame(C().getComponentId(name), slot));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "widget_action");
  assert.equal(messages[0].slot, slot);
  await connection.dispatch(messages, true);
  return sent.slice();
}

const popoutOpen = (player) => player.getPacketSender().getVarbit(C().getVarbitId("popout_open"));
const has = (packets, expected) => packets.some((p) => p.equals(expected));
const index = (packets, expected) => packets.findIndex((p) => p.equals(expected));

function lootToolsEvents() {
  const events = [
    encodeWidgetSetFlagsRange(C().getComponentId("loottools:ground_items_top"), 0, 0, OP1),
    encodeWidgetSetFlagsRange(C().getComponentId("loottools:dropdown_content"), 0, 4, OP1),
  ];
  for (const kind of ["source", "drop"]) {
    for (let row = 0; row < 10; row++) {
      const uid = C().getComponentId(`loottools:loottracker_display_${kind}_${row}`);
      for (let slot = 9; slot <= 107; slot += 2) events.push(encodeWidgetSetFlagsRange(uid, slot, slot, TARGET));
      events.push(encodeWidgetSetFlagsRange(uid, 3, 3, TARGET));
    }
  }
  return events;
}

test("the mobile gameframe enables op1 on the popout buttons as it mounts the panel; desktop mounts neither", () => {
  const buttons = C().getComponentId("popout:buttons");
  const osmButtons = C().getComponentId("popout:osm_buttons");
  const mobile = encodeGameframeBootstrap("Headless", MOBILE_GAMEFRAME_ROOT);
  // 227/02137.txt:3010 (every capture): if_setevents popout:buttons (728:6) 0-2 OP1 right after the mount.
  const desktopEvents = encodeWidgetSetFlagsRange(buttons, 0, 2, OP1);
  // toplevel_osm_setup_popout_buttons: the mobile buttons are popout:osm_buttons' even children 0, 2, 4.
  const mobileEvents = encodeWidgetSetFlagsRange(osmButtons, 0, 4, OP1);
  const mount = mobile.findIndex((p) => p[0] === 103 && p.readUInt16BE(7) === C().getInterfaceId("popout"));
  assert.ok(mount >= 0, "the popout panel is mounted");
  assert.equal(index(mobile, desktopEvents), mount + 1, "popout:buttons 0-2 op1, after the mount as live");
  assert.equal(index(mobile, mobileEvents), mount + 2, "popout:osm_buttons 0-4 op1");
  for (const root of [161, 164, 548]) {
    const desktop = encodeGameframeBootstrap("Headless", root);
    assert.equal(has(desktop, desktopEvents) || has(desktop, mobileEvents), false, `no popout events on ${root}`);
  }
});

test("as captured: Open on the XP tracker (sub 0) sets popout_open 1, opens xptracker in the container and lays it out", async (t) => {
  const { player, connection, sent } = realPlayer(t);
  const packets = await click(connection, sent, "popout:buttons", 0);
  assert.equal(popoutOpen(player), 1);
  const open = index(packets, encodeWidgetOpenSub(C().getComponentId("popout:container"), C().getInterfaceId("xptracker"), 1));
  const events = index(packets, encodeWidgetSetFlagsRange(C().getComponentId("xptracker:tracker_border"), 0, 24, OP6));
  const script = index(packets, encodeRunClientScript(TOPLEVEL_SETUP_POPOUT));
  assert.ok(open >= 0 && events === open + 1 && script === events + 1, "opensub, tracker_border 0-24 op6, then script 5354");
});

test("as captured: Open on the loot tools (sub 1) sets popout_open 2 and opens loottools with its 1022 events", async (t) => {
  const { player, connection, sent } = realPlayer(t);
  const packets = await click(connection, sent, "popout:buttons", 1);
  assert.equal(popoutOpen(player), 2);
  const open = index(packets, encodeWidgetOpenSub(C().getComponentId("popout:container"), C().getInterfaceId("loottools"), 1));
  assert.ok(open >= 0);
  const events = lootToolsEvents();
  assert.equal(events.length, 1022);
  events.forEach((event, i) => assert.ok(packets[open + 1 + i].equals(event), `event ${i} in live's order`));
  assert.ok(packets[open + 1 + events.length].equals(encodeRunClientScript(TOPLEVEL_SETUP_POPOUT)));
});

test("as captured: Open on the hiscores (sub 2) sets popout_open 3, opens hiscores and lays it out", async (t) => {
  const { player, connection, sent } = realPlayer(t);
  const packets = await click(connection, sent, "popout:buttons", 2);
  assert.equal(popoutOpen(player), 3);
  const open = index(packets, encodeWidgetOpenSub(C().getComponentId("popout:container"), C().getInterfaceId("hiscores"), 1));
  assert.ok(open >= 0);
  assert.ok(packets[open + 1].equals(encodeRunClientScript(TOPLEVEL_SETUP_POPOUT)), "no events, as live");
});

test("the mobile buttons (popout:osm_buttons 0, 2, 4) open the same panels; the icons between them do nothing", async (t) => {
  const { player, connection, sent } = realPlayer(t);
  for (const [slot, value, name] of [[0, 1, "xptracker"], [2, 2, "loottools"], [4, 3, "hiscores"]]) {
    const packets = await click(connection, sent, "popout:osm_buttons", slot);
    assert.equal(popoutOpen(player), value, `osm slot ${slot}`);
    assert.ok(has(packets, encodeWidgetOpenSub(C().getComponentId("popout:container"), C().getInterfaceId(name), 1)));
  }
  for (const slot of [1, 3, 5, 6]) {
    const packets = await click(connection, sent, "popout:osm_buttons", slot);
    assert.equal(popoutOpen(player), 3, `osm slot ${slot} is not a button`);
    assert.equal(packets.length, 0);
  }
  assert.equal((await click(connection, sent, "popout:buttons", 3)).length, 0, "popout:buttons has three");
});

test("Close on the open panel (the cache names that op Close) empties the container", async (t) => {
  const { player, connection, sent } = realPlayer(t);
  await click(connection, sent, "popout:buttons", 0);
  const packets = await click(connection, sent, "popout:buttons", 0);
  assert.equal(popoutOpen(player), 0);
  const close = index(packets, encodeWidgetCloseSub(C().getComponentId("popout:container")));
  assert.ok(close >= 0);
  assert.ok(packets[close + 1].equals(encodeRunClientScript(TOPLEVEL_SETUP_POPOUT)));
  // Another panel's Open swaps the container's interface.
  await click(connection, sent, "popout:buttons", 0);
  const swap = await click(connection, sent, "popout:buttons", 2);
  assert.equal(popoutOpen(player), 3);
  assert.ok(has(swap, encodeWidgetOpenSub(C().getComponentId("popout:container"), C().getInterfaceId("hiscores"), 1)));
});
