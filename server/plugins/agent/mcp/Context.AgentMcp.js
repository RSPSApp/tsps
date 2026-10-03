const { z } = require("zod");

// Shared helpers for the AgentMcp tool files: finding and driving players, waiting for them to
// finish, and resolving things by name.

const MAX_MESSAGES = 100;
const MAX_WAIT_TICKS = 50;
// Idle this many ticks in a row (no activity, same tile) before a wait counts as finished.
const STILL_TICKS = 2;
// Shop clicks move fixed amounts (1/5/10/50), so larger amounts are sent as several clicks.
const MAX_CLICKS = 50;
// Skilling plugins replay their animation every 4-5 ticks, so one this recent means still at it.
const ANIMATION_TICKS = 5;
const tracked = new WeakMap();

// Records game messages and animation timing for players an agent has touched; the client
// still receives everything.
function track(player, World) {
  let state = tracked.get(player);
  if (state) return state;
  state = { messages: [], animatedAt: -Infinity };
  tracked.set(player, state);
  const sender = player.getPacketSender();
  const send = sender.sendMessage.bind(sender);
  sender.sendMessage = (message) => {
    state.messages.push(String(message));
    if (state.messages.length > MAX_MESSAGES) state.messages.shift();
    return send(message);
  };
  const animate = player.performAnimation?.bind(player);
  if (animate) {
    player.performAnimation = (animation) => {
      if (animation) state.animatedAt = World.getProcessCycle?.() ?? 0;
      return animate(animation);
    };
  }
  return state;
}

const tile = (location) => ({ x: location.getX(), y: location.getY(), z: location.getZ() });

function createContext(core, server) {
  const {
    World, MapObjects, ObjectDefinition, ItemDefinition, GameConstants, TaskManager, MultiChatboxPrompt,
  } = core;

  const find = (username) => {
    const player = World.getPlayerByName(username);
    if (!player) throw new Error(`${username} is not online`);
    track(player, World);
    return player;
  };
  const sendAll = (player, messages) => {
    if (!core.dispatchClientMessages(player, messages)) {
      throw new Error(`${player.getUsername()} has no client connection (bots cannot be driven)`);
    }
  };
  const send = (player, message) => {
    sendAll(player, [message]);
    return { sent: message };
  };
  const items = (container) => container.getItems()
    .map((item, slot) => item && item.getId() > 0 && item.getAmount() > 0
      ? { slot, id: item.getId(), name: ItemDefinition.forId(item.getId()).getName(), amount: item.getAmount() }
      : null)
    .filter(Boolean);

  const sleepTicks = (ticks) =>
    new Promise((resolve) => setTimeout(resolve, ticks * GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE));
  // What the player is in the middle of; empty means idle.
  const activity = (p) => {
    const busy = [];
    if (p.getMovementQueue?.()?.hasPendingWork()) busy.push("moving");
    if (TaskManager?.hasActiveTask(p.getIndex(), "MovementTask")) busy.push("walking to interact");
    if (p.getCombat?.()?.hasPendingWork()) busy.push("combat");
    const now = World.getProcessCycle?.();
    if (now !== undefined && now - track(p, World).animatedAt <= ANIMATION_TICKS) busy.push("animating");
    return busy;
  };
  // An open dialogue or interface needs the agent's input before anything else happens.
  const waitingOn = (p) => p.getDialogueManager?.()?.isActive() || MultiChatboxPrompt?.getPending(p)
    ? "dialogue" : p.getInterfaceId?.() > 0 ? "interface" : null;
  // Game messages since the last call; each message is returned once.
  const takeMessages = (p) => track(p, World).messages.splice(0);
  const status = (p) => ({
    ...tile(p.getLocation()), hitpoints: p.getHitpoints(), busy: activity(p), open: waitingOn(p),
    messages: takeMessages(p),
  });
  // Polls each tick until the player reaches `target`, opens a dialogue/interface, or has been
  // idle (no activity, same tile) for STILL_TICKS; gives up after maxTicks.
  const settle = async (username, maxTicks, target) => {
    let last = tile(find(username).getLocation());
    let idle = 0;
    for (let ticks = 1; ticks <= maxTicks; ticks++) {
      await sleepTicks(1);
      const p = find(username);
      const here = tile(p.getLocation());
      if (target && here.x === target.x && here.y === target.y) return { result: "arrived", ticks, ...status(p) };
      const open = waitingOn(p);
      if (open) return { result: open, ticks, ...status(p) };
      const moved = here.x !== last.x || here.y !== last.y || here.z !== last.z;
      idle = moved || activity(p).length ? 0 : idle + 1;
      last = here;
      if (idle >= STILL_TICKS) return { result: target ? "stuck" : "idle", ticks, ...status(p) };
    }
    return { result: "timeout", ticks: maxTicks, ...status(find(username)) };
  };
  const npcClick = (p, npc, option) => {
    const actions = npc.getCurrentDefinition(p)?.getActions() ?? [];
    const clickType = actions.findIndex((action) => action?.toLowerCase() === option.toLowerCase()) + 1;
    if (!clickType) throw new Error(`NPC has no "${option}" option; options: ${actions.filter(Boolean).join(", ")}`);
    return { type: "npc_option", index: npc.getIndex(), clickType };
  };
  // Everything with a menu within `radius` tiles of the player.
  const nearby = (p, radius) => {
    const here = p.getLocation();
    const near = (loc) => loc.getZ() === here.getZ()
      && Math.abs(loc.getX() - here.getX()) <= radius && Math.abs(loc.getY() - here.getY()) <= radius;

    const objects = [];
    for (let x = here.getX() - radius; x <= here.getX() + radius; x++) {
      for (let y = here.getY() - radius; y <= here.getY() + radius; y++) {
        for (const object of MapObjects.mapObjects.get(MapObjects.getHash(x, y, here.getZ())) ?? []) {
          const loc = object.getLocation();
          if (loc.getX() !== x || loc.getY() !== y || loc.getZ() !== here.getZ()) continue;
          const definition = ObjectDefinition.forPlayer(object.getId(), p);
          const options = definition?.getInteractions()?.filter(Boolean);
          if (options?.length) objects.push({ id: object.getId(), name: definition.getName(), options, x, y });
        }
      }
    }

    return {
      npcs: World.getNpcs().stream().filter((npc) => npc && near(npc.getLocation())).map((npc) => {
        const definition = npc.getCurrentDefinition(p);
        return {
          index: npc.getIndex(), id: npc.getId(), name: definition?.getName(),
          options: (definition?.getActions() ?? []).filter(Boolean), ...tile(npc.getLocation()),
        };
      }),
      objects,
      groundItems: World.getItems().filter((item) => near(item.getPosition())).map((item) => ({
        id: item.getItem().getId(), name: item.getItem().getDefinition().getName(),
        amount: item.getItem().getAmount(), ...tile(item.getPosition()),
      })),
    };
  };
  // Nearest NPC/object/ground item called `target` (that has `option`, when given). Errors name
  // what is nearby so the agent can correct itself.
  const nearest = (p, target, option, radius) => {
    const here = p.getLocation();
    const { npcs, objects, groundItems } = nearby(p, radius);
    const named = (thing) => thing.name?.toLowerCase() === target.toLowerCase();
    const hasOption = (thing) => !option || thing.options.some((o) => o.toLowerCase() === option.toLowerCase());
    // Ground items carry no option list, so any option is allowed on them.
    const candidates = [
      ...npcs.filter(named).filter(hasOption).map((thing) => ({ kind: "npc", thing })),
      ...objects.filter(named).filter(hasOption).map((thing) => ({ kind: "object", thing })),
      ...groundItems.filter(named).map((thing) => ({ kind: "ground item", thing })),
    ];
    const distance = ({ thing }) => Math.max(Math.abs(thing.x - here.getX()), Math.abs(thing.y - here.getY()));
    const pick = candidates.sort((a, b) => distance(a) - distance(b))[0];
    if (pick) return pick;
    const matches = [...npcs, ...objects].filter(named);
    if (matches.length) {
      const options = [...new Set(matches.flatMap((thing) => thing.options))];
      throw new Error(`No nearby "${target}" has a "${option}" option; options: ${options.join(", ")}`);
    }
    const names = [...new Set([...npcs, ...objects, ...groundItems].map((thing) => thing.name).filter(Boolean))];
    throw new Error(`Nothing named "${target}" within ${radius} tiles; nearby: ${names.join(", ")}`);
  };
  const inventorySlot = (p, name, exceptSlot) => {
    const inventory = items(p.getInventory());
    const entry = inventory.find((e) => e.slot !== exceptSlot && e.name?.toLowerCase() === name.toLowerCase());
    if (!entry) throw new Error(`No "${name}" in inventory; have: ${inventory.map((e) => e.name).join(", ") || "nothing"}`);
    return entry.slot;
  };
  const carried = (p, itemId) =>
    items(p.getInventory()).filter((e) => e.id === itemId).reduce((sum, e) => sum + e.amount, 0);
  const byName = (list, name, where) => {
    const entry = list.find((e) => e.name?.toLowerCase() === name.toLowerCase());
    if (!entry) throw new Error(`No "${name}" in ${where}; it has: ${list.map((e) => e.name).join(", ") || "nothing"}`);
    return entry;
  };
  // Splits `amount` into the fixed click sizes an interface offers, largest first.
  const clicks = (amount, sizes) => {
    const out = [];
    for (const size of sizes) while (amount >= size) { out.push(size); amount -= size; }
    if (out.length > MAX_CLICKS) throw new Error(`That needs ${out.length} clicks; use a smaller amount or "all"`);
    return out;
  };
  // Sends one packet per step. `oneByOne` spaces them a tick apart and re-resolves each, for
  // non-stackable items where a click empties the slot the next one would use.
  const clickEach = async (username, steps, message, oneByOne) => {
    if (!oneByOne) {
      const p = find(username);
      sendAll(p, steps.map((step) => message(p, step)).filter(Boolean));
      await sleepTicks(1);
      return status(find(username));
    }
    for (const step of steps) {
      const p = find(username);
      const packet = message(p, step);
      if (!packet) break;
      send(p, packet);
      await sleepTicks(1);
    }
    return status(find(username));
  };

  const tool = (name, description, inputSchema, handler) =>
    server.registerTool(name, { description, inputSchema }, async (args) => {
      try {
        return { content: [{ type: "text", text: JSON.stringify(await handler(args)) }] };
      } catch (error) {
        return { content: [{ type: "text", text: String(error?.message ?? error) }], isError: true };
      }
    });

  return {
    core, z, tool, MAX_WAIT_TICKS,
    player: z.string().describe("Username of an online player"),
    amountSchema: z.union([z.number().int().min(1), z.literal("all")]).default(1),
    find, send, items, tile, sleepTicks, takeMessages, status, settle, npcClick, nearby, nearest,
    inventorySlot, carried, byName, clicks, clickEach,
  };
}

module.exports = { createContext };
