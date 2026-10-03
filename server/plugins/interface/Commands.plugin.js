const { TYPE_TEXT, createWidgetGroup } = require("./widgetGroup");

const GROUP_ID = 30004;
const MAIN_MODAL_UID = (161 << 16) | 16;
const COMPONENT = { ROOT: 0, FRAME: 1, LIST_VIEW: 2, LIST_SCROLLBAR: 3, ROW_START: 10 };
const ROW_COUNT = 128;
const ROW_HEIGHT = 16;
const LIST_CONTENT_HEIGHT = ROW_COUNT * ROW_HEIGHT + 4;
const uid = (component) => (GROUP_ID << 16) | component;

const COMMANDS = {
  player: [
    "::commands - Open this command list",
    "::players / ::online / ::who - List online players",
    "::claim - Purchase-claim information",
    "::store / ::donate - Open the store",
    "::kdr - Say your kill/death ratio",
    "::timeplayed - Say your play time",
    "::creationdate - Say your account creation date",
    "::changepassword [password] - Change password",
    "::lockxp - Toggle experience lock",
    "::mm / ::makeover / ::makeovermage - Change your appearance",
    "::maxhits / ::maxhit / ::mh - Open live combat max hits",
    "::maxrangehit / ::mrh - Open live combat max hits",
    "::maxmagehit / ::mmh - Open live combat max hits",
    "::thread [id] - Open a forum thread",
    "::title [text] - Set your title",
    "::skull - Apply a white skull",
    "::redskull - Apply a red skull",
    "::yell [message] - Staff and donors only",
    "::presets - Open the presets interface",
    "::shops - Browse custom shops",
  ],
  moderator: ["No moderator-only commands are currently registered."],
  admin: [
    "::tele x y [z] - Teleport to coordinates",
    "::coords - Show your coordinates",
    "::glow [preset] [intensity] [player] - Set glow",
    "::teleto [player] / ::teletome [player]",
    "::item [id] [amount] - Spawn an item",
    "::clearinv - Clear your inventory",
    "::saveall - Save all players",
    "::botme [on|off|toggle|status] - Control yourself as a bot",
    "::bh [player] [behaviour] - Set bot behaviour",
    "::bothotspots - Show bot hotspot counts",
    "::pluginperf [once|on|off|reset] [limit] [intervalMs]",
    "::serverperf [ticks] - Show server performance",
  ],
  developer: [
    "::toa - Teleport to the Tombs of Amascut lobby",
    "::toaskippuzzle - Complete the current ToA puzzle for the party",
    "::toaskipboss - Complete the current ToA boss encounter for the party",
    "::toaskiptowarden - Mark every ToA path complete (in the Nexus) to open the Wardens",
    "::toaskiptoreward [points] [raid level] [purple|lightbearer|fang|ward|masori|mask|body|chaps|shadow] [pet] - End the ToA raid and go to the chest",
    "::kick [player] - Disconnect player",
    "::exit [player] - Close player client",
    "::copybank [player] - Copy player bank",
    "::bank - Open bank",
    "::runes - Add runes",
    "::master - Max all skills",
    "::reset - Reset skills",
    "::normal - Set normal spellbook",
    "::lunar - Set lunar spellbook",
    "::ancients - Set ancient spellbook",
    "::arceuus - Set Arceuus spellbook",
    "::pnpc [npc-id] - Transform into NPC",
    "::npc [id] [amount] - Spawn NPC",
    "::npcanim [npc-id] - Set NPC animations",
    "::npcanims [npc-id] - Set NPC animations",
    "::npcanimscan [npc-id] [first] [last] - Scan animations",
    "::npcperm [id] [radius] [facing] - Spawn permanent NPC",
    "::object [id] [type] [rotation] - Spawn object",
    "::mypos - Show current location",
    "::config [id] [value] - Send config",
    "::spec [amount] - Set special energy",
    "::gfx [id] - Play graphic",
    "::sound [id] - Play sound",
    "::anim [id] - Play animation",
    "::interface [id] - Open interface",
    "::chatboxinterface [id] - Open chatbox interface",
    "::update [ticks] - Start server update",
    "::area - Show current area",
    "::infhp - Toggle infinite health",
    "::poisonme [type] - Apply poison",
    "::taskdebug - Show task count",
    "::noclip - Enable noclip",
    "::up - Move up one plane",
    "::down - Move down one plane",
    "::save - Save your account",
    "::reprocorruptsave [player] - Corrupt save test",
    "::cwar [x] [y] - Move clan-war interface",
    "::listsizes - Show world counts",
    "::atkrange [distance] - Show attack range",
    "::attackrange [distance] - Show attack range",
    "::unlockprayers [0|1|2] - Unlock prayer",
    "::gesell [item-id] - Preview Grand Exchange item",
    "::flood [amount] - Start login flood",
    "::reloadpunishments - Reload punishments",
    "::reloadshops - Reload shops",
    "::shop [id] - Open a shop for testing",
    "::reloaddrops - Reload NPC drops",
    "::reloadnpcspawns - Reload NPC spawns",
    "::reloadnpcdefs - Reload NPC definitions",
    "::reloaditems - Reload item definitions",
    "::logstatus - Show log settings",
    "::loglevels [levels] - Set log levels",
    "::logtypeon [types] - Enable log types",
    "::logtypeoff [types] - Disable log types",
    "::logtypeclear [enabled|all] - Clear log types",
    "::mute [player] - Mute player",
    "::unmute [player] - Unmute player",
    "::ipmute [player] - IP mute player",
    "::unipmute [player] - Remove IP mute",
    "::ban [player] - Ban player",
    "::unban [player] - Unban player",
    "::ipban [player] - IP ban player",
    "::t - Test wall collision",
    "::barrage - Legacy test command",
    "::dialogue - Legacy test command",
    "::items - Open item spawner",
    "::ground - Spawn ground coins",
    "::procregion [x] [y] [seed] - Load generated region",
    "::procregionhere [seed] - Generate current region",
    "::cleargen - Clear generated region",
    "::procregscan [radius] - Scan region",
    "::procreglearn [radius] - Learn region style",
    "::dumphouse [tag] [type] - Save house example",
    "::dumpterrain [biome] - Save terrain data",
    "::genterrain [biome] [seed] - Generate terrain",
    "::buildhouse [style] [index] - Build saved house",
    "::genhouse [style] [type] [seed] - Generate house",
    "::genstreet [style] [type] [seed] - Generate street",
    "::checkhouse - Check house bounds",
  ],
};

function rightsLevel(player) {
  const id = player?.getRights?.()?.getId?.();
  if (id === 4 || id === 3) return 3;
  return Number.isInteger(id) ? Math.max(0, Math.min(2, id)) : 0;
}

function commandRows(player) {
  const level = rightsLevel(player);
  const sections = [["Player commands", COMMANDS.player]];
  if (level >= 1) sections.push(["Moderator commands", COMMANDS.moderator]);
  if (level >= 2) sections.push(["Administrator commands", COMMANDS.admin]);
  if (level >= 3) sections.push(["Developer commands", COMMANDS.developer]);
  return sections.flatMap(([title, commands]) => [
    `<col=ffd27f>${title}</col>`,
    ...commands.map((command) => `<col=e8ded0>${command}</col>`),
    "",
  ]);
}

function buildWidgetGroup() {
  const { widgets, add } = createWidgetGroup(GROUP_ID);
  const root = add(COMPONENT.ROOT, -1, {
    rawWidth: 18,
    rawHeight: 18,
    widthMode: 1,
    heightMode: 1,
    width: 494,
    height: 316,
    xPositionMode: 1,
    yPositionMode: 1,
  });
  add(COMPONENT.FRAME, root, { widthMode: 1, heightMode: 1, width: 494, height: 316 });
  const list = add(COMPONENT.LIST_VIEW, root, {
    rawX: 18,
    rawY: 30,
    rawWidth: 442,
    rawHeight: 270,
    width: 442,
    height: 270,
    scrollWidth: 442,
    scrollHeight: LIST_CONTENT_HEIGHT,
  });
  add(COMPONENT.LIST_SCROLLBAR, root, {
    rawX: 464,
    rawY: 30,
    rawWidth: 16,
    rawHeight: 270,
    width: 16,
    height: 270,
    noClickThrough: true,
  });
  for (let row = 0; row < ROW_COUNT; row++) {
    add(COMPONENT.ROW_START + row, list, {
      type: TYPE_TEXT,
      rawY: row * ROW_HEIGHT,
      rawWidth: 442,
      rawHeight: 14,
      width: 442,
      height: 14,
      text: "",
      fontId: 494,
      textColor: 0xe8ded0,
      textShadowed: true,
      yTextAlignment: 1,
    });
  }
  return { groupId: GROUP_ID, widgets };
}

const INTERFACE_DEFINITION = {
  ...buildWidgetGroup(),
  scroll: [{ viewComponent: COMPONENT.LIST_VIEW, scrollbarComponent: COMPONENT.LIST_SCROLLBAR, contentHeight: LIST_CONTENT_HEIGHT }],
};

function openCommands(player) {
  const sender = player.getPacketSender();
  const rows = commandRows(player);
  player.setInterfaceId(GROUP_ID);
  sender.sendSubInterface(MAIN_MODAL_UID, GROUP_ID, 0, {
    postScripts: [{ scriptId: 227, args: [uid(COMPONENT.FRAME), "Commands"] }],
  });
  for (let row = 0; row < ROW_COUNT; row++) {
    sender
      .sendString(rows[row] ?? "", uid(COMPONENT.ROW_START + row))
      .sendInterfaceDisplayState(uid(COMPONENT.ROW_START + row), row >= rows.length);
  }
}

module.exports = {
  name: "Commands",
  register(api) {
    api.registerCustomInterface(INTERFACE_DEFINITION);
    api.registerCommand("commands", ({ player }) => {
      openCommands(player);
      return true;
    });
  },
  _test: { COMMANDS, commandRows, GROUP_ID, COMPONENT, ROW_COUNT, LIST_CONTENT_HEIGHT, uid },
};
