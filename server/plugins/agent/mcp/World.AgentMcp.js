// Looking around, moving, and clicking things in the world or inventory.
module.exports = function registerWorldTools(ctx) {
  const {
    core, tool, z, player, find, send, items, tile, settle, status, sleepTicks, takeMessages,
    nearby, nearest, npcClick, inventorySlot, MAX_WAIT_TICKS,
  } = ctx;
  const { World, Skill } = core;

  tool("list_players", "Online players and where they are.", {}, () =>
    World.getPlayers().stream().filter(Boolean).map((p) => ({
      username: p.getUsername(), bot: !!p.isPlayerBot?.(), ...tile(p.getLocation()),
    })));

  tool(
    "observe",
    "Snapshot of a player: position, stats, inventory, equipment, nearby NPCs/objects/ground items, and game messages since the last observe/wait.",
    { player, radius: z.number().int().min(1).max(32).default(15) },
    ({ player: username, radius }) => {
      const p = find(username);
      const skills = p.getSkillManager();
      return {
        ...tile(p.getLocation()),
        hitpoints: p.getHitpoints(),
        runEnergy: p.getRunEnergy(),
        skills: Object.fromEntries(Skill.values().map((skill) => [skill.getName(), {
          level: skills.getCurrentLevel(skill), max: skills.getMaxLevel(skill), xp: skills.getExperience(skill),
        }])),
        inventory: items(p.getInventory()),
        equipment: items(p.getEquipment()),
        ...nearby(p, radius),
        messages: takeMessages(p),
      };
    }
  );

  tool(
    "walk_to",
    "Walk to a world tile (like a minimap click) and wait until the player arrives or gets stuck. run=true forces running. Returns result (arrived/stuck/timeout), position, hitpoints and new game messages.",
    {
      player, x: z.number().int(), y: z.number().int(), run: z.boolean().default(false),
      maxTicks: z.number().int().min(1).max(MAX_WAIT_TICKS).default(MAX_WAIT_TICKS),
    },
    async ({ player: username, x, y, run, maxTicks }) => {
      send(find(username), { type: "move", worldX: x, worldY: y, modifierFlags: run ? 2 : 0 });
      return settle(username, maxTicks, { x, y });
    }
  );

  tool(
    "interact",
    "Click an option on the nearest NPC, object or ground item with this name, then wait until the player is idle (done walking, fighting and skilling) or a dialogue/interface opens. E.g. target \"Guard\" option \"Attack\", \"Tree\"/\"Chop down\", \"Bones\"/\"Take\". Returns what was clicked, result (idle/dialogue/interface/timeout), position, hitpoints, busy reasons and new game messages.",
    {
      player, target: z.string().min(1), option: z.string().min(1),
      radius: z.number().int().min(1).max(32).default(15),
      maxTicks: z.number().int().min(1).max(MAX_WAIT_TICKS).default(20),
    },
    async ({ player: username, target, option, radius, maxTicks }) => {
      const p = find(username);
      const pick = nearest(p, target, option, radius);
      const { kind, thing } = pick;
      if (kind === "npc") send(p, npcClick(p, World.getNpcs().get(thing.index), option));
      else if (kind === "object") {
        const action = thing.options.find((o) => o.toLowerCase() === option.toLowerCase());
        send(p, { type: "object_option", id: thing.id, x: thing.x, y: thing.y, action });
      } else send(p, { type: "ground_item_action", itemId: thing.id, x: thing.x, y: thing.y, option });
      return { clicked: { kind, name: thing.name, x: thing.x, y: thing.y }, ...(await settle(username, maxTicks)) };
    }
  );

  tool(
    "npc_option",
    "Click a menu option (e.g. Talk-to, Attack, Pickpocket) on an NPC by its index from observe.",
    { player, index: z.number().int(), option: z.string() },
    ({ player: username, index, option }) => {
      const p = find(username);
      const npc = World.getNpcs().get(index);
      if (!npc) throw new Error(`No NPC at index ${index}`);
      return send(p, npcClick(p, npc, option));
    }
  );

  tool(
    "object_option",
    "Click a menu option (e.g. Chop down, Open, Climb-up) on an object at a tile.",
    { player, id: z.number().int(), x: z.number().int(), y: z.number().int(), option: z.string() },
    ({ player: username, id, x, y, option }) =>
      send(find(username), { type: "object_option", id, x, y, action: option })
  );

  tool(
    "ground_item_option",
    "Click a menu option (default Take) on a ground item.",
    { player, itemId: z.number().int(), x: z.number().int(), y: z.number().int(), option: z.string().default("Take") },
    ({ player: username, itemId, x, y, option }) =>
      send(find(username), { type: "ground_item_action", itemId, x, y, option })
  );

  tool(
    "inventory_option",
    "Click a menu option (e.g. Eat, Wield, Drop, Bury) on an inventory item, chosen by item name or slot.",
    {
      player, option: z.string(),
      item: z.string().optional().describe("Item name, e.g. Shrimps; the first matching slot is used"),
      slot: z.number().int().min(0).max(27).optional(),
    },
    ({ player: username, item: name, slot, option }) => {
      const p = find(username);
      if (name !== undefined) slot = inventorySlot(p, name);
      if (slot === undefined) throw new Error("item or slot is required");
      const item = p.getInventory().getItems()[slot];
      if (!item || item.getId() <= 0) throw new Error(`Inventory slot ${slot} is empty`);
      return send(p, { type: "inventory_action", slot, itemId: item.getId(), widgetId: 3214, option });
    }
  );

  tool(
    "use_item",
    "Use an inventory item on something, then wait until the player is idle or a dialogue/interface opens. By name: item \"Tinderbox\" with targetItem \"Logs\" (another inventory item) or target \"Fire\" (nearest NPC, object or ground item). Raw form: slot plus on=inventory/npc/loc/ground/player with targetSlot or id (+ x, y).",
    {
      player,
      item: z.string().optional().describe("Inventory item name to use"),
      slot: z.number().int().min(0).max(27).optional(),
      targetItem: z.string().optional().describe("Another inventory item, by name"),
      target: z.string().optional().describe("Nearest NPC, object or ground item, by name"),
      on: z.enum(["inventory", "npc", "loc", "ground", "player"]).optional(),
      targetSlot: z.number().int().optional(),
      id: z.number().int().optional(),
      x: z.number().int().optional(),
      y: z.number().int().optional(),
      maxTicks: z.number().int().min(1).max(MAX_WAIT_TICKS).default(20),
    },
    async ({ player: username, item: name, slot, targetItem, target: targetName, on, targetSlot, id, x, y, maxTicks }) => {
      const p = find(username);
      if (name !== undefined) slot = inventorySlot(p, name);
      if (slot === undefined) throw new Error("item or slot is required");
      const inventory = p.getInventory().getItems();
      const item = inventory[slot];
      if (!item || item.getId() <= 0) throw new Error(`Inventory slot ${slot} is empty`);
      const level = p.getLocation().getZ();
      let target;
      if (targetItem !== undefined) {
        const other = inventorySlot(p, targetItem, slot);
        target = { kind: "inventory", slot: other, itemId: inventory[other].getId() };
      } else if (targetName !== undefined) {
        const { kind, thing } = nearest(p, targetName, undefined, 15);
        target = kind === "npc" ? { kind: "npc", id: thing.index }
          : { kind: kind === "object" ? "loc" : "ground", id: thing.id, x: thing.x, y: thing.y, level };
      } else if (on === "inventory") {
        const other = inventory[targetSlot];
        if (!other || other.getId() <= 0) throw new Error(`Inventory slot ${targetSlot} is empty`);
        target = { kind: "inventory", slot: targetSlot, itemId: other.getId() };
      } else if (on) {
        if (id === undefined) throw new Error("id is required");
        target = { kind: on, id, x, y, level };
      } else throw new Error("Give targetItem, target, or on");
      send(p, { type: "inventory_use_on", slot, itemId: item.getId(), target });
      return settle(username, maxTicks);
    }
  );

  tool(
    "close_interface",
    "Close the open interface or dialogue (bank, shop, ...), like pressing Esc.",
    { player },
    ({ player: username }) => send(find(username), { type: "interface_close" })
  );

  tool(
    "chat",
    "Say something in public chat. Text starting with :: runs a command (e.g. ::tele 3222 3218, ::item 1351) if the player has the rights.",
    { player, text: z.string().min(1).max(200) },
    ({ player: username, text }) => send(find(username), { type: "chat", text, messageType: "public" })
  );

  tool(
    "send_packet",
    "Escape hatch: send any decoded client message (see ClientMessage in net/protocol/ClientProtocol.ts), e.g. {\"type\":\"dialogue_continue\",\"widgetId\":15138821,\"childIndex\":-1}.",
    { player, message: z.object({ type: z.string() }).passthrough() },
    ({ player: username, message }) => send(find(username), message)
  );

  tool(
    "wait_ticks",
    "Wait some game ticks (0.6s each), then return position, hitpoints, busy reasons, any open dialogue/interface and new game messages.",
    { player, ticks: z.number().int().min(1).max(MAX_WAIT_TICKS).default(3) },
    async ({ player: username, ticks }) => {
      find(username);
      await sleepTicks(ticks);
      return status(find(username));
    }
  );
};
