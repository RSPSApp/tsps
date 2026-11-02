"use strict";

// Maze (random event, Mysterious Old Man): reach the strange shrine before the reward
// potential drains, opening chests for loot at the cost of 1% each. The reward scales with
// total level and remaining potential. Varp 531 drives the cache's reward HUD (interface
// 209, cs2 956). Packet detail: rsprox 1764. See SOURCES.md.
const Flow = require("./DialogueFlow.RandomEvents");
const Teleports = require("./Teleports.RandomEvents");

const REFUSAL = "You didn't come here to do that!";
const OVERHEADS = [name => `${name}!`, name => `Hello? ${name}?`, name => `Talk to me, ${name}!`,
  name => `${name}? Are you there?`, name => `I'd like to talk to you, ${name}!`];
const POTENTIAL_VARP = 531;
const HUD_INTERFACE = 209;
const HUD_UID = (161 << 16) | 8;
const DRAIN_TICKS = 5;
const ARRIVAL_SOUND = 1930;
const STARTS = [[2891, 4597], [2933, 4597], [2891, 4555], [2933, 4555]]; // Wiki map pins.
const CHEST_RECLOSE_TICKS = 100;
const CHEST_CLOSED = 14986;
const CHEST_OPEN = 14988;
const GATE_SOUND = 62;
const MAZE_GATES = [14979, 14980, 14981, 14982, 14983];
// rsprox 1764 tick 9096: from the junction's side this gate turns the player back. The wiki map
// routes it inward from the east; no recording shows the other three special gates refusing.
const ONE_WAY_GATE = 14981;
const SHRINE_ANIMATION = 862;
const SHRINE_JINGLE = 117;
const SHRINE_LEAVE_TICKS = 7;
// Wiki Chest (Maze)/Rewards. Attack and defence potions are members items.
const CHEST_LOOT = [
  [556, 15], [555, 10], [557, 10], [554, 10], [882, 20], [877, 10], [884, 15],
  [117, 1], [123, 1, true], [135, 1, true],
];
// Coins, feather, iron arrow, chaos rune, steel arrow, death rune, noted coal, noted mithril
// ore, nature rune.
const SHRINE_LOOT = [[995, 1], [314, 2], [884, 3], [562, 9], [886, 12], [560, 18],
  [454, 45], [448, 162], [561, 180]];

module.exports = function attach(api, Events) {
  const N = api.core.NpcIdentifiers;

  const definition = {
    id: N.MYSTERIOUS_OLD_MAN_4, // 6752, the maze invitation variant
    kind: "maze",
    // The same five overheads as his other forms (1637, 127, 1098), through the shared timeline.
    greet: name => OVERHEADS[Math.floor(Math.random() * OVERHEADS.length)](name),
    nags: OVERHEADS,
    goodbye: "Maybe later.",
    linger: true,
    otherPlayerLine: owner => `Sorry, I'm trying to speak to someone else, but ${owner.getAppearance().isMale() ? "he" : "she"} seems to be ignoring me.`,
    leavingLine: () => "Goodbye.",
    talk(active, { teleport, leave }) {
      const { player } = active;
      Flow.chat(api, {
        player,
        npcId: definition.id,
        title: "What would you like to say?",
        lines: [`Hey, ${player.getUsername()}, would you like to come and solve a maze for me?`],
        options: [
          ["Sure, I like exploring mazes.", () => Flow.chat(api, {
            player,
            pages: [{ player: true, text: "Sure, I like exploring mazes." }],
            onEnd: () => {
              const [x, y] = STARTS[Math.floor(Math.random() * STARTS.length)];
              teleport({ kind: "maze", arrive: { x, y, z: 0 }, hideTabs: true, teleportRefusal: REFUSAL, onStart: start });
            },
          })],
          ["Sorry, I'm busy.", () => { // 1637 t7516: looks away at once, gone on the next beat.
            leave(active);
            Flow.chat(api, { player, pages: [{ player: true, text: "Sorry, I'm busy." }] });
          }],
        ],
      });
    },
  };

  function start(session) {
    const { player } = session;
    session.data.potential = 100;
    session.data.chestCost = 0;
    session.data.startedAt = api.core.World.getProcessCycle();
    session.data.chests = new Map();
    session.tick = tick;
    const sender = player.getPacketSender();
    sender.sendConfig(POTENTIAL_VARP, 100);
    sender.sendSound(ARRIVAL_SOUND, 1, 0);
    Teleports.onEnd(session, () => {
      const packets = player.getPacketSender();
      packets.closeSubInterface?.(HUD_UID);
      packets.sendConfig(POTENTIAL_VARP, 0);
      for (const chest of session.data.chests.values()) Teleports.replaceObject(chest.object, CHEST_CLOSED);
      session.data.chests.clear();
    });
    player.sendMessage("Reach the maze centre as fast as possible.");
    Flow.chat(api, {
      player,
      npcId: definition.id,
      lines: ["Reach the maze centre as fast as possible. The faster you are, the better your reward."],
    });
  }

  function tick(session) {
    if (session.data.touched) return;
    const { player } = session;
    const cycle = api.core.World.getProcessCycle();
    // rsprox 1764 tick 9016: the HUD opens as the arrival line goes away.
    if (!session.data.hud && !player.getDialogueManager().isActive()) {
      session.data.hud = true;
      player.getPacketSender().sendSubInterface(HUD_UID, HUD_INTERFACE);
    }
    const potential = 100 - session.data.chestCost - Math.floor((cycle - session.data.startedAt) / DRAIN_TICKS);
    if (potential <= 0) {
      // The wiki gives no line for this: the player goes back with no reward.
      Teleports.finish(session);
      return;
    }
    if (potential !== session.data.potential) {
      session.data.potential = potential;
      player.getPacketSender().sendConfig(POTENTIAL_VARP, potential);
    }
    for (const [key, chest] of session.data.chests) {
      if (cycle >= chest.closeAt) {
        Teleports.replaceObject(chest.object, CHEST_CLOSED);
        session.data.chests.delete(key);
      }
    }
  }

  function openChest(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "maze") return false;
    event.handled = true;
    const object = event.object;
    if (object.getId() !== CHEST_CLOSED) return true;
    const player = event.player;
    const location = object.getLocation();
    const key = `${location.getX()},${location.getY()}`;
    const members = api.core.WorldDefinition.isMembersWorld();
    const table = CHEST_LOOT.filter(entry => members || !entry[2]);
    const loot = table[Math.floor(Math.random() * table.length)];
    player.getInventory().addItem(new api.core.Item(loot[0], loot[1]));
    session.data.chestCost++;
    session.data.potential = Math.max(0, session.data.potential - 1);
    player.getPacketSender().sendConfig(POTENTIAL_VARP, session.data.potential);
    const replacement = Teleports.replaceObject(object, CHEST_OPEN);
    // The chest shuts again after a minute, as OSRS does; the maze tick closes it.
    session.data.chests.set(key, { object: replacement, closeAt: api.core.World.getProcessCycle() + CHEST_RECLOSE_TICKS });
    return true;
  }

  // The gate stays shut in the world: the player alone is put on its other side.
  function openGate(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "maze" || !MAZE_GATES.includes(event.object.getId?.())) return false;
    event.handled = true;
    const player = event.player;
    const gate = event.object.getLocation();
    const standing = player.getLocation();
    const onGate = standing.getX() === gate.getX() && standing.getY() === gate.getY();
    if (event.object.getId() === ONE_WAY_GATE && onGate) {
      Flow.statement(api, player, "I don't think that's the right way.");
      return true;
    }
    // Shape 0 walls by rotation: 0 west edge, 1 north edge, 2 east edge, 3 south edge.
    const [dx, dy] = [[-1, 0], [0, 1], [1, 0], [0, -1]][event.object.getFace()];
    const target = onGate
      ? new api.core.Location(gate.getX() + dx, gate.getY() + dy, gate.getZ())
      : new api.core.Location(gate.getX(), gate.getY(), gate.getZ());
    player.getPacketSender().sendSound(GATE_SOUND, 1, 0);
    player.moveTo(target);
    return true;
  }

  function touchShrine(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "maze") return false;
    event.handled = true;
    if (session.data.touched) return true;
    session.data.touched = true;
    const player = event.player;
    const sender = player.getPacketSender();
    sender.closeSubInterface?.(HUD_UID);
    sender.sendJingle(SHRINE_JINGLE);
    player.performAnimation(new api.core.Animation(SHRINE_ANIMATION));
    // Three rolls scaled by Total level x potential, as the OSRS formula does (rsprox 1764: at
    // 75% the rolls came to 2423 feathers, 1615 iron arrows and 26 nature runes).
    const totalLevel = player.getSkillManager().getTotalLevel();
    const scale = Math.max(0, Math.floor(totalLevel * (session.data.potential / 100) * (10 / 3)));
    const rewards = [];
    for (let roll = 0; roll < 3; roll++) {
      const [item, divisor] = SHRINE_LOOT[Math.floor(Math.random() * SHRINE_LOOT.length)];
      rewards.push({ id: item, amount: Math.max(1, Math.floor(scale / divisor)) });
    }
    Teleports.later(session, SHRINE_LEAVE_TICKS, () => Teleports.finish(session, { reward: rewards }));
    return true;
  }

  api.onCustomEvent(Events.DEFINITIONS_EVENT, payload => payload.definitions.push(definition));
  api.onObjectInteraction("Chest", { Open: openChest });
  api.onObjectInteraction("Gate", { Open: openGate });
  api.onObjectInteraction("Strange shrine", { Touch: touchShrine });
};
