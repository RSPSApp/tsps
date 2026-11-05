// travel_to: walks a player anywhere on the main map the way a player would, through every door,
// staircase, shortcut and boat on the way. Routes come from TravelRoutes over the server's
// collision and the live-game transport table (plugins/agent/data/transports.json, see
// scripts/import-shortest-path.cjs); every hop is a normal client click (move, object_option,
// npc_option), so a door or boat that doesn't work here stops the trip and says where.
//
// skipWalks (unwatched runs): the walking between transports is moved over in hops along the
// planned path instead of walked, except a few tiles either side of every Area change and every
// wilderness tile. Transports are still clicked. Every hop is listed in the result's legs.
const path = require("node:path");
const { planTravel, toLegs, indexTransports, unmetRequirements, skipPlan, key, BLOCKED } = require("./TravelRoutes.AgentMcp");

const DATA_FILE = path.join(__dirname, "..", "data", "transports.json");
// Path tiles walked per click: well inside the route finder's 128-tile window.
const WALK_STEP = 30;
// Ticks one walk click may take before it counts as stuck.
const WALK_TICKS = 40;
// Transports are clicked from their origin tile; their loc or NPC is this close.
const CLICK_RADIUS = 10;
// Landing within this of a transport's destination counts (boats and stairs place loosely).
const ARRIVE_REACH = 2;
// What NPC boats offer before a quest renames the option (Travel -> "Port Sarim").
const TRAVEL_OPTIONS = ["travel", "pay-fare", "take-boat", "board", "sail"];
const DEFAULT_BUDGET_TICKS = 100;
const MAX_BUDGET_TICKS = 300;
// A call made mid-voyage waits this long for the ride to land.
const LANDING_TICKS = 30;

// The table's account unlocks the server tracks, and the custom event that answers each.
// Unlisted ones (MOR_UL_REK, DRAGONTOOTH, ...) count as not unlocked.
const UNLOCK_QUERIES = {
  CANOE_AXE: { event: "canoes:stored-axe", request: { stored: false }, answer: "stored" },
  KARAMJA_ELITE: { event: "diary:is-complete", request: { diary: "karamja", tier: "elite", complete: false }, answer: "complete" },
};

let transportIndex = null;
const transports = () => (transportIndex ??= indexTransports(require(DATA_FILE)));
// username -> { goal, failed: Map(transport key -> reason) }: transports that failed on this
// trip are routed around on the next call, and reported.
const trips = new Map();

const transportKey = (t) => `${t.type}:${t.from.join(",")}>${t.to.join(",")}:${t.menu}`;
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const asTile = ([x, y, z]) => ({ x, y, z });

function describe(transport) {
  const out = { type: transport.type, menu: transport.menu, id: transport.id, from: transport.from, to: transport.to };
  for (const field of ["skills", "items", "quests", "varbits", "varps", "ticks", "info"]) {
    if (transport[field] != null) out[field] = transport[field];
  }
  return out;
}

function describeLeg(leg) {
  if (leg.kind === "walk") return { walk: leg.tiles.length - 1, to: leg.tiles[leg.tiles.length - 1] };
  return { transport: describe(leg.transport) };
}

module.exports = function registerTravelTools(ctx, { areas }) {
  const {
    core, tool, z, player, find, send, tile, settle, sleepTicks, takeMessages, takeClient, area,
    nearby, npcClick, items, activity, waitingOn, movementBlocked,
  } = ctx;
  const { World, Skill, RegionManager, MapObjects, ObjectDefinition, PluginManager, Location, Wilderness } = core;

  // Missing map squares are off the map, not open floor.
  const regions = new Map();
  const getFlag = (x, y, z) => {
    const region = (x >> 6) * 256 + (y >> 6);
    if (!regions.has(region)) regions.set(region, RegionManager.getRegion(x, y) !== undefined);
    return regions.get(region) ? RegionManager.getClipping(x, y, z, null) : BLOCKED;
  };

  // A closed door or gate on the map, for walls no transport row crosses.
  const doorAt = (p) => (x, y, z) => {
    RegionManager.getClipping(x, y, z, null);
    for (const object of MapObjects.mapObjects.get(MapObjects.getHash(x, y, z)) ?? []) {
      const at = object.getLocation();
      if (at.getX() !== x || at.getY() !== y || at.getZ() !== z) continue;
      const definition = ObjectDefinition.forPlayer(object.getId(), p);
      const name = definition?.getName?.() ?? "";
      const option = definition?.getInteractions?.()?.find((value) => /^(open|release|pay-toll\(\d+gp\))$/i.test(value ?? ""));
      if (/door|gate/i.test(name) && option) return { type: "map-door", menu: `${option} ${name}`, id: object.getId(), object: { x, y, z } };
    }
    return null;
  };

  // The requirements of a transport this player doesn't meet, as readable reasons.
  const unmet = (p, transport, itemGroups) => {
    const carried = [...items(p.getInventory()), ...items(p.getEquipment())];
    const sender = p.getPacketSender();
    return unmetRequirements(transport, itemGroups, {
      level: (name) => {
        const skill = Skill.values().find((s) => s.getName().toLowerCase() === name.toLowerCase());
        return skill ? p.getSkillManager().getCurrentLevel(skill) : undefined;
      },
      count: (ids) => carried.filter((e) => ids.includes(e.id)).reduce((sum, e) => sum + e.amount, 0),
      unlocked: (name) => {
        const ask = UNLOCK_QUERIES[name];
        if (!ask) return false;
        const request = { player: p, ...ask.request };
        PluginManager.emitCustomEvent(ask.event, request);
        return request[ask.answer] === true;
      },
      questComplete: (name) => {
        const request = { player: p, name, complete: false };
        PluginManager.emitCustomEvent("quest:is-complete", request);
        return request.complete === true;
      },
      varbit: (id) => sender.getVarbit(id),
      varp: (id) => sender.getVarp(id),
    });
  };

  const plan = (p, goal, { exact, failed, ignoreRequirements }) => {
    const index = transports();
    const itemGroups = require(DATA_FILE).itemGroups;
    const reasons = new Map();
    const usable = (transport) => {
      if (failed.has(transportKey(transport))) return false;
      if (ignoreRequirements || transport.type === "map-door") return true;
      if (!reasons.has(transport)) reasons.set(transport, unmet(p, transport, itemGroups));
      return reasons.get(transport).length === 0;
    };
    const route = planTravel({
      from: tile(p.getLocation()), to: goal, getFlag,
      transportsAt: (x, y, z) => index.get(key(x, y, z)) ?? [],
      doorAt: doorAt(p), usable, goalReach: exact ? 0 : undefined,
    });
    return route && { legs: toLegs(route.steps), cost: route.cost };
  };

  // Finds the loc or NPC a transport clicks, near the player, and the option to click.
  const resolveClick = (p, transport) => {
    const { npcs, objects } = nearby(p, CLICK_RADIUS);
    const menu = transport.menu.toLowerCase();
    const from = asTile(transport.from);
    const optionFor = (thing, fallback) => {
      const name = String(thing.name ?? "").toLowerCase();
      const options = thing.options ?? [];
      const exact = options.find((o) => `${o.toLowerCase()} ${name}` === menu);
      if (exact) return exact;
      const prefix = options.filter((o) => menu.startsWith(`${o.toLowerCase()} `)).sort((a, b) => b.length - a.length)[0];
      if (prefix) return prefix;
      return fallback ? options.find((o) => TRAVEL_OPTIONS.includes(o.toLowerCase())) : undefined;
    };
    const named = (thing) => thing.name && menu.endsWith(` ${String(thing.name).toLowerCase()}`);
    const byDistance = (a, b) => chebyshev(a, from) - chebyshev(b, from);
    const objectMatches = transport.object
      ? objects.filter((o) => o.x === transport.object.x && o.y === transport.object.y && o.id === transport.id)
      : objects.filter((o) => transport.id != null && (o.id === transport.id || o.displayId === transport.id));
    // By id first; by name when this cache's id differs from the live data's.
    const candidates = [
      ...objectMatches.sort(byDistance).map((thing) => ({ kind: "object", thing })),
      ...npcs.filter((n) => transport.id != null && n.id === transport.id).sort(byDistance).map((thing) => ({ kind: "npc", thing })),
      ...objects.filter(named).sort(byDistance).map((thing) => ({ kind: "object", thing, byName: true })),
      ...npcs.filter(named).sort(byDistance).map((thing) => ({ kind: "npc", thing, byName: true })),
    ];
    if (!candidates.length) return { error: `no "${transport.menu}" (id ${transport.id}) within ${CLICK_RADIUS} tiles` };
    for (const candidate of candidates) {
      const option = optionFor(candidate.thing, candidate.kind === "npc");
      if (option) return { ...candidate, option, renamed: `${option} ${candidate.thing.name}`.toLowerCase() !== menu };
    }
    const { thing } = candidates[0];
    return { error: `${thing.name} (id ${thing.id}) has no option for "${transport.menu}"; options: ${(thing.options ?? []).join(", ") || "none"}` };
  };

  const clickPacket = (p, { kind, thing, option }) => kind === "npc"
    ? npcClick(p, World.getNpcs().get(thing.index), option)
    : { type: "object_option", id: thing.id, x: thing.x, y: thing.y, action: option };

  // Waits after a transport click until the player lands near `arrive`, a dialogue or
  // interface opens, they stand still for longer than the transport takes, or the call's
  // budget runs out mid-ride (the next call waits for the landing).
  const ride = async (username, transport, arrive, deadline, messages) => {
    const patience = Math.max(4, (transport.ticks ?? 1) + 4);
    // A door's far side is a step away: only that tile counts. Longer rides land loosely.
    const from = asTile(transport.from);
    const reach = from.z === arrive.z && chebyshev(from, arrive) <= ARRIVE_REACH ? 0 : ARRIVE_REACH;
    const limit = (transport.ticks ?? 1) * 2 + 30;
    let last = tile(find(username).getLocation());
    let idle = 0;
    for (let ticks = 1; ticks <= limit; ticks++) {
      if (World.getProcessCycle() >= deadline) return { result: "budget", ticks: ticks - 1 };
      await sleepTicks(1);
      const p = find(username);
      messages.push(...takeMessages(p));
      const here = tile(p.getLocation());
      if (here.z === arrive.z && chebyshev(here, arrive) <= reach && !p.getPrivateArea?.()) return { result: "arrived", ticks };
      // A dialogue needs answering; an interface may be the ride's own (a boat's fade, a cutscene).
      const open = waitingOn(p);
      if (open === "dialogue") return { result: open, ticks };
      const moved = here.x !== last.x || here.y !== last.y || here.z !== last.z;
      idle = moved || activity(p).length || movementBlocked(p) || p.getPrivateArea?.() ? 0 : idle + 1;
      last = here;
      if (idle >= patience) return { result: open ?? "stopped", ticks };
    }
    return { result: "timeout", ticks: limit };
  };

  const walkLeg = async (username, leg, run, deadline, messages, done) => {
    const tiles = leg.tiles;
    const last = tiles.length - 1;
    let stuckAt = null;
    while (World.getProcessCycle() < deadline) {
      const here = tile(find(username).getLocation());
      if (here.x === tiles[last].x && here.y === tiles[last].y && here.z === tiles[last].z) return { result: "arrived" };
      // Pick up from the path tile nearest the player (the route finder may cut corners).
      let at = 0;
      tiles.forEach((t, i) => {
        if (t.z === here.z && chebyshev(t, here) <= chebyshev(tiles[at], here)) at = i;
      });
      const target = tiles[Math.min(last, at + WALK_STEP)];
      send(find(username), { type: "move", worldX: target.x, worldY: target.y, modifierFlags: 0, ...(run ? { run: true } : {}) });
      const result = await settle(username, Math.max(1, Math.min(WALK_TICKS, deadline - World.getProcessCycle())), target);
      messages.push(...result.messages);
      if (result.result === "dialogue" || result.result === "interface") return { result: result.result };
      if (result.result === "arrived") {
        done.walked += chebyshev(here, target);
        stuckAt = null;
        continue;
      }
      if (result.result === "timeout") continue;
      const now = { x: result.x, y: result.y, z: result.z };
      // Stuck twice on the same tile: something the map says is open isn't.
      if (stuckAt && stuckAt.x === now.x && stuckAt.y === now.y && stuckAt.z === now.z) {
        return { result: "blocked", reason: `walk to ${target.x},${target.y},${target.z} stopped at ${now.x},${now.y},${now.z}` };
      }
      stuckAt = now;
    }
    return { result: "budget" };
  };

  // skipWalks: hop over the stretches skipPlan allows, walk the rest with walkLeg.
  const skipLeg = async (username, leg, run, deadline, messages, done) => {
    const here = tile(find(username).getLocation());
    // From the path tile nearest the player, as walkLeg picks up.
    let start = 0;
    leg.tiles.forEach((t, i) => {
      if (t.z === here.z && chebyshev(t, here) <= chebyshev(leg.tiles[start], here)) start = i;
    });
    const tiles = leg.tiles.slice(start);
    const at = (t) => new Location(t.x, t.y, t.z);
    const steps = skipPlan(tiles, { areaAt: (t) => areas.get(at(t)), unsafe: (t) => Wilderness.isInLocation(at(t)) });
    let from = 0;
    for (const step of steps) {
      if (World.getProcessCycle() >= deadline) return { result: "budget" };
      if ("walk" in step) {
        const result = await walkLeg(username, { kind: "walk", tiles: tiles.slice(from, step.walk + 1) }, run, deadline, messages, done);
        if (result.result !== "arrived") return result;
        from = step.walk;
        continue;
      }
      const to = tiles[step.skip];
      find(username).moveTo(at(to));
      await sleepTicks(1);
      messages.push(...takeMessages(find(username)));
      done.skipped += step.skip - from;
      done.legs.push({ skipped: step.skip - from, from: tiles[from], to });
      from = step.skip;
    }
    return { result: "arrived" };
  };

  const transportLeg = async (username, leg, deadline, messages) => {
    const p = find(username);
    const { transport, arrive } = leg;
    const click = resolveClick(p, transport);
    if (click.error) return { result: "blocked", reason: click.error };
    send(p, clickPacket(p, click));
    const notes = [
      ...(click.byName && transport.id != null ? [`found by name; the live data's id is ${transport.id}`] : []),
      ...(click.renamed ? [`the live game's menu entry is "${transport.menu}"`] : []),
    ];
    const clicked = { kind: click.kind, name: click.thing.name, id: click.thing.id, option: click.option, x: click.thing.x, y: click.thing.y,
      ...(notes.length ? { note: notes.join("; ") } : {}) };
    let outcome = await ride(username, transport, arrive, deadline, messages);
    if (outcome.result === "budget") return { ...outcome, clicked };
    const here = tile(find(username).getLocation());
    const from = asTile(transport.from);
    // A door opens and leaves the player in front of it: step through.
    if (outcome.result === "stopped" && arrive.z === from.z && chebyshev(arrive, from) <= 1
      && here.x === from.x && here.y === from.y && here.z === from.z) {
      const left = deadline - World.getProcessCycle();
      if (left < 1) return { result: "budget", ticks: outcome.ticks, clicked };
      send(find(username), { type: "move", worldX: arrive.x, worldY: arrive.y, modifierFlags: 0 });
      const step = await settle(username, Math.min(5, left), arrive);
      messages.push(...step.messages);
      if (step.result === "timeout" && World.getProcessCycle() >= deadline) return { result: "budget", ticks: outcome.ticks + step.ticks, clicked };
      outcome = step.result === "arrived" ? { result: "arrived", ticks: outcome.ticks + step.ticks } : outcome;
    }
    if (outcome.result === "arrived" || outcome.result === "dialogue" || outcome.result === "interface") return { ...outcome, clicked };
    // Taken somewhere else (a ship's deck instead of the dock): carry on from there, and say so.
    if (here.z !== from.z || chebyshev(here, from) > ARRIVE_REACH) {
      return { result: "arrived", ticks: outcome.ticks, clicked, landed: here,
        note: `landed at ${here.x},${here.y},${here.z}; the live data has ${arrive.x},${arrive.y},${arrive.z}` };
    }
    return { result: "blocked", clicked, reason: `nothing happened after "${click.option}" on ${click.thing.name}` };
  };

  tool(
    "travel_to",
    "Travel to a tile like a player: plans over the map's collision plus the live game's doors, stairs, ladders, shortcuts, boats and other transports (requirements checked: skills, items, quests, varbits), then walks it with normal clicks, opening and climbing on the way. Returns after arriving, when a dialogue or interface needs answering (answer it with the dialogue tools, then call again), when a leg fails (blocked: what was clicked, the reason and game messages; the next call routes around it), or when the tick budget runs out (call again to continue). Never teleports, unless skipWalks is set. Main world only.",
    {
      player, x: z.number().int().min(0).max(16383), y: z.number().int().min(0).max(16383), z: z.number().int().min(0).max(3).default(0),
      exact: z.boolean().default(false).describe("Require the exact tile, not one next to it"),
      run: z.boolean().default(false).describe("Force running (otherwise the player's run setting)"),
      budgetTicks: z.number().int().min(10).max(MAX_BUDGET_TICKS).default(DEFAULT_BUDGET_TICKS)
        .describe("Game ticks to spend this call before returning progress"),
      retryFailed: z.boolean().default(false).describe("Forget transports that failed on this trip and try them again"),
      skipWalks: z.boolean().default(false).describe(
        "Unwatched runs only: move over the walking between transports in hops along the planned path instead of walking it. "
        + "Tiles near an Area change and wilderness tiles are still walked, and transports still clicked. Each hop is listed in legs; "
        + "record the travel as walks skipped."),
    },
    async ({ player: username, x, y, z: level, exact, run, budgetTicks, retryFailed, skipWalks }) => {
      const deadline = World.getProcessCycle() + budgetTicks;
      let p = find(username);
      // Still riding from the last call (a boat, a cutscene, a climb): let it land first.
      const riding = (q) => !!q.getPrivateArea?.() || movementBlocked(q) || activity(q).length > 0;
      for (let ticks = 0; riding(p) && ticks < LANDING_TICKS && World.getProcessCycle() < deadline; ticks++) {
        await sleepTicks(1);
        p = find(username);
      }
      if (p.getPrivateArea?.() && World.getProcessCycle() >= deadline) {
        return { result: "in-progress", ...tile(p.getLocation()), area: area(p), reason: "still riding; call again", messages: takeMessages(p) };
      }
      if (p.getPrivateArea?.()) throw new Error("travel_to plans main-world routes; leave the instance first.");
      const goal = { x, y, z: level };
      const goalKey = `${x},${y},${level}`;
      let trip = trips.get(username.toLowerCase());
      if (!trip || trip.goal !== goalKey || retryFailed) {
        trip = { goal: goalKey, failed: new Map() };
        trips.set(username.toLowerCase(), trip);
      }
      const messages = [...takeMessages(p)];
      const done = { walked: 0, skipped: 0, legs: [] };
      const taken = new Set();
      const report = (result, extra = {}) => {
        const now = find(username);
        if (result === "arrived") trips.delete(username.toLowerCase());
        return {
          result, ...tile(now.getLocation()), area: area(now), ...extra,
          walkedTiles: done.walked, ...(skipWalks ? { skippedTiles: done.skipped } : {}), legs: done.legs,
          ...(trip.failed.size ? { routedAround: [...trip.failed.values()] } : {}),
          messages, client: takeClient(now),
        };
      };

      while (World.getProcessCycle() < deadline) {
        const here = find(username);
        const position = tile(here.getLocation());
        if (position.z === level && chebyshev(position, goal) <= (exact ? 0 : 1)) return report("arrived");
        const route = plan(here, goal, { exact, failed: trip.failed });
        if (!route) {
          // Would a route exist without the requirements? Then say which ones it needs.
          const unrestricted = plan(here, goal, { exact, failed: trip.failed, ignoreRequirements: true });
          if (!unrestricted) return report("no-route");
          const itemGroups = require(DATA_FILE).itemGroups;
          const needs = unrestricted.legs.filter((leg) => leg.kind === "transport")
            .map((leg) => ({ ...describe(leg.transport), unmet: unmet(here, leg.transport, itemGroups) }))
            .filter((entry) => entry.unmet.length);
          return report("needs-requirements", { needs });
        }
        const [leg, ...rest] = route.legs;
        if (!leg) return report("arrived");
        // Planned again after taking it: it didn't get the player past it.
        if (leg.kind === "transport" && taken.has(transportKey(leg.transport))) {
          const reason = `${leg.transport.menu} was taken but the route still starts with it`;
          trip.failed.set(transportKey(leg.transport), { ...describe(leg.transport), reason });
          return report("blocked", { reason, transport: describe(leg.transport) });
        }
        if (leg.kind === "transport") taken.add(transportKey(leg.transport));
        const result = leg.kind === "transport"
          ? await transportLeg(username, leg, deadline, messages)
          : await (skipWalks ? skipLeg : walkLeg)(username, leg, run, deadline, messages, done);
        if (leg.kind === "transport") {
          done.legs.push({
            ...describe(leg.transport), result: result.result, clicked: result.clicked,
            ...(result.reason ? { reason: result.reason } : {}), ...(result.note ? { note: result.note } : {}),
          });
        }
        if (result.result === "budget") break;
        if (result.result === "dialogue" || result.result === "interface") {
          return report(result.result, { next: rest.slice(0, 5).map(describeLeg) });
        }
        if (result.result === "blocked") {
          if (leg.kind === "transport") trip.failed.set(transportKey(leg.transport), { ...describe(leg.transport), reason: result.reason });
          return report("blocked", { reason: result.reason, ...(leg.kind === "transport" ? { transport: describe(leg.transport) } : {}) });
        }
      }
      const now = find(username);
      const route = !now.getPrivateArea?.() && plan(now, goal, { exact, failed: trip.failed });
      return report("in-progress", route ? { next: route.legs.slice(0, 5).map(describeLeg) } : {});
    }
  );
};

// For tests: plan over these transports (the same shape as transports.json) instead of the
// imported table; null goes back to it.
module.exports._test = {
  setTransports: (data) => { transportIndex = data ? indexTransports(data) : null; },
};
