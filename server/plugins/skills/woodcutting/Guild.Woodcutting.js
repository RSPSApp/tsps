/**
 * Woodcutting Guild (OSRS Wiki): level 60 Woodcutting to go in through the gates, and an
 * invisible +7 Woodcutting boost to the cut chance anywhere inside. From
 * data/definitions/woodcutting-guild.json, as captured:
 * - a gate pass swaps both halves for invisible walls with the open gates beside them (sound
 *   62), the player steps through, the east gate's guard welcomes them in, and two ticks later
 *   the gates are shut;
 * - the cave goes down to the Ent dungeon a tick later; its vine (828) climbs back out;
 * - the dungeon's roots are stepped over (1603), to the tile across.
 * Going in completes "Enter the Woodcutting Guild", and a redwood log "Chop some Redwood logs".
 */
const ObstacleRunner = require("../agility/ObstacleRunner");
const GuildData = require("./GuildData.Woodcutting");

const GUILD_LEVEL = 60;
const INVISIBLE_BOOST = 7;

// OSRS Wiki map outline of the guild grounds.
const GUILD_OUTLINE = [
  [1565, 3499], [1563, 3497], [1563, 3478], [1564, 3477], [1582, 3477], [1587, 3472], [1595, 3472],
  [1596, 3473], [1596, 3480], [1601, 3485], [1601, 3497], [1607, 3497], [1607, 3492], [1612, 3487],
  [1617, 3487], [1623, 3493], [1632, 3493], [1633, 3492], [1633, 3490], [1634, 3489], [1648, 3489],
  [1656, 3497], [1656, 3502], [1657, 3502], [1658, 3503], [1658, 3507], [1655, 3510], [1655, 3516],
  [1654, 3517], [1633, 3517], [1631, 3519], [1624, 3519], [1621, 3516], [1612, 3516], [1610, 3514],
  [1608, 3514], [1607, 3513], [1607, 3511], [1604, 3511], [1604, 3506], [1607, 3506], [1607, 3501],
  [1601, 3501], [1601, 3503], [1600, 3504], [1582, 3504], [1577, 3499],
];

let core = null;
let api = null;
let DATA = null;
let guildBoundary = null;

function isInGuild(player) {
  return !!guildBoundary && guildBoundary.inside(player.getLocation());
}

function invisibleBoost(player) {
  return isInGuild(player) ? INVISIBLE_BOOST : 0;
}

function later(ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

function place(id, x, y, face) {
  const object = new core.GameObject(id, new core.Location(x, y, 0), 0, face, null);
  core.ObjectManager.register(object, true);
  return object;
}

/** The gate's guard (the east gate has one) greets a player coming in. */
function welcome(player, pair) {
  const gates = DATA.gates;
  const guard = (player.getLocalNpcs?.() ?? []).find((npc) => npc?.getId?.() === gates.guard
    && Math.abs(npc.getLocation().getX() - pair.x) <= 3
    && pair.halves.some((half) => Math.abs(npc.getLocation().getY() - half.y) <= 3));
  guard?.forceChat(gates.welcome);
}

/** The gates open as the player steps through (a tick after arriving), and shut two ticks later. */
function passGate(player, pair, entering, y) {
  const gates = DATA.gates;
  ObstacleRunner.run({ player }, [
    { wait: 1 },
    {
      run: () => {
        const opened = pair.halves.map((half) => {
          place(gates.invisibleWall, pair.x, half.y, gates.face);
          return place(gates.open[half.id], pair.openX, half.y, gates.openFace[half.id]);
        });
        player.getPacketSender().sendSound(gates.sound, 1, 0);
        if (entering) welcome(player, pair);
        later(gates.shutTicks, () => {
          for (const object of opened) core.ObjectManager.deregister(object, true);
          for (const half of pair.halves) place(half.id, pair.x, half.y, gates.face);
        });
      },
    },
    { walk: [[entering ? pair.insideX : pair.outsideX, y]] },
  ]);
  if (entering) api.emitCustomEvent("diary:task", { player, ...DATA.diary.enter });
}

/** Doors asks before toggling a gate: these are the guild's, so it passes the player instead. */
function guildGate(request) {
  if (!DATA.gates.ids.includes(request.objectId)) return;
  const { x, y } = request.location;
  const pair = DATA.gates.pairs.find((entry) => entry.x === x && entry.halves.some((half) => half.y === y));
  if (!pair) return;
  request.handled = true;
  const { player } = request;
  if (ObstacleRunner.isBusy(player)) return;
  const entering = player.getLocation().getX() !== pair.insideX;
  if (entering && player.getSkillManager().getCurrentLevel(core.Skill.WOODCUTTING) < GUILD_LEVEL) {
    player.sendMessage(`You need a Woodcutting level of ${GUILD_LEVEL} to enter the Woodcutting Guild.`);
    return;
  }
  const at = player.getLocation().getY();
  passGate(player, pair, entering, pair.halves.some((half) => half.y === at) ? at : y);
}

const toLocation = ({ x, y, z }) => new core.Location(x, y, z ?? 0);

function enterCave(event) {
  if (event.objectId !== DATA.cave.id) return false;
  later(1, () => event.player.isRegistered() && event.player.moveTo(toLocation(DATA.cave.to)));
  return true;
}

function climbVine(event) {
  if (event.objectId !== DATA.vine.id) return false;
  event.player.performAnimation(new core.Animation(DATA.vine.anim));
  later(1, () => event.player.isRegistered() && event.player.moveTo(toLocation(DATA.vine.to)));
  return true;
}

/** Over the root to the tile across from the player. */
function stepOverRoot(event) {
  const roots = DATA.roots;
  if (!roots.ids.includes(event.objectId)) return false;
  const { player } = event;
  if (ObstacleRunner.isBusy(player)) return true;
  const at = player.getLocation();
  const { x, y } = event.location;
  const to = [x + (x - at.getX()), y + (y - at.getY())];
  player.getPacketSender().sendSound(roots.sound, 1, 0);
  ObstacleRunner.run({ player }, [{ move: to, anim: roots.anim, speed: roots.cycles }]);
  return true;
}

function redwoodChopped({ player, logId }) {
  if (logId === DATA.diary.redwood.logId) api.emitCustomEvent("diary:task", { player, diary: DATA.diary.redwood.diary, task: DATA.diary.redwood.task });
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  DATA = GuildData.load(core);
  guildBoundary = new core.PolygonalBoundary(GUILD_OUTLINE);
  pluginApi.onCustomEvent("door:toggle", guildGate);
  pluginApi.onCustomEvent("woodcutting:success", redwoodChopped);
  pluginApi.onObjectInteraction("Cave", { Enter: enterCave });
  pluginApi.onObjectInteraction("Vine", { Climb: climbVine });
  pluginApi.onObjectInteraction("Root", { "Step-over": stepOverRoot });
}

module.exports = { attach, isInGuild, invisibleBoost, guildGate, enterCave, climbVine, stepOverRoot, redwoodChopped };
