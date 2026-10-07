// Tools for checking behaviour in-game: set a scene up with admin commands, act on other
// players, cast spells, ask the real attack/teleport rules for a verdict, and skip time.
// Every result carries what the client was told (varbits, varps, interfaces) via status().

const PLAYER_OPTIONS = { attack: 1, trade: 2, follow: 3 };

module.exports = function registerTestingTools(ctx) {
  const { core, tool, z, player, find, send, status, sleepTicks, takeMessages, MAX_WAIT_TICKS } = ctx;
  const { World, PlayerRights, CombatFactory, CanAttackResponse, TeleportHandler, Location, CacheDefinitions, PluginManager } = core;

  const target = z.union([
    z.object({ player: z.string().describe("Username of an online player") }),
    z.object({ npc: z.number().int().describe("NPC index, as observe lists it") }),
  ]);
  const resolve = (spec) => {
    if ("player" in spec) return find(spec.player);
    const npc = World.getNpcs().get(spec.npc);
    if (!npc) throw new Error(`No NPC at index ${spec.npc}`);
    return npc;
  };
  const ticks = z.number().int().min(0).max(MAX_WAIT_TICKS).default(3).describe("Ticks to wait before reporting");

  tool(
    "command",
    "Run a ::command (without the ::) as a developer for this one call, e.g. \"tele 3093 3493\", \"item 995 1000\", \"master\", \"cwar\". The player's own rank is restored afterwards. Returns status, including what the command said.",
    { player, text: z.string().min(1).max(200), ticks },
    async ({ player: username, text, ticks: wait }) => {
      const p = find(username);
      const rights = p.getRights();
      p.setRights(PlayerRights.DEVELOPER);
      try {
        send(p, { type: "chat", text: `::${text.replace(/^::/, "")}`, messageType: "public" });
        await sleepTicks(Math.max(1, wait));
      } finally {
        p.setRights(rights);
      }
      return status(find(username));
    }
  );

  tool(
    "can_attack",
    "Ask the real combat permission check whether `attacker` may attack `target` right now, without starting a fight. Returns the CanAttackResponse name and any message the check sent (some are throttled to one per 1.2 s).",
    { attacker: player, target },
    ({ attacker, target: spec }) => {
      const a = find(attacker);
      const response = CombatFactory.canAttackPermission(a, resolve(spec), false);
      return { response: CanAttackResponse[response], allowed: response === CanAttackResponse.CAN_ATTACK, messages: takeMessages(a) };
    }
  );

  tool(
    "can_teleport",
    "Ask the real teleport check whether the player may teleport right now (to x/y/z if given), without teleporting. Returns the verdict and any message it sent.",
    {
      player,
      x: z.number().int().optional(), y: z.number().int().optional(), z: z.number().int().min(0).max(3).default(0),
      wildernessLevelLimit: z.number().int().min(0).default(20),
    },
    ({ player: username, x, y, z: plane, wildernessLevelLimit }) => {
      const p = find(username);
      const destination = x != null && y != null ? new Location(x, y, plane) : p.getLocation().clone();
      const allowed = TeleportHandler.checkReqs(p, destination, wildernessLevelLimit);
      return { allowed, messages: takeMessages(p) };
    }
  );

  tool(
    "player_option",
    "Click Attack, Trade or Follow (or another player menu slot by number) on another online player, then wait and report.",
    {
      player,
      target: z.string().describe("Username of the other player"),
      option: z.union([z.enum(["Attack", "Trade", "Follow"]), z.number().int().min(1).max(8)]),
      ticks,
    },
    async ({ player: username, target: other, option, ticks: wait }) => {
      const p = find(username);
      const index = find(other).getIndex();
      send(p, { type: "player_option", index, option: typeof option === "number" ? option : PLAYER_OPTIONS[option.toLowerCase()] });
      await sleepTicks(wait);
      return status(find(username));
    }
  );

  tool(
    "cast_spell",
    "Cast a spell by its spellbook name (e.g. \"Varrock Teleport\", \"Humidify\", \"Ice Barrage\"), on a player or NPC if given, otherwise as a self-cast. The spellbook must be the right one for the spell.",
    { player, spell: z.string().min(1), target: target.optional(), ticks },
    async ({ player: username, spell, target: spec, ticks: wait }) => {
      const found = CacheDefinitions.getSpellByName(spell);
      if (!found) throw new Error(`No spell named "${spell}" in the cache`);
      const { widgetId, itemId } = found;
      const p = find(username);
      if (!spec) {
        send(p, { type: "widget_action", widgetId, groupId: widgetId >>> 16, childId: widgetId & 0xffff, buttonNum: 1, option: "Cast", itemId });
      } else {
        const victim = resolve(spec);
        send(p, {
          type: "player" in spec ? "spell_on_player" : "spell_on_npc",
          targetIndex: victim.getIndex(), spellWidget: widgetId, spellChild: -1, spellItemId: itemId,
        });
      }
      await sleepTicks(wait);
      return status(find(username));
    }
  );

  tool(
    "advance_time",
    "Skip a player's timed content forward by `minutes` (farming growth, seedlings, bird houses) instead of waiting. Plugins with timed state opt in through the agent:advance-time event; the result lists which ones moved.",
    { player, minutes: z.number().int().min(1).max(7 * 24 * 60), ticks: ticks.default(2) },
    async ({ player: username, minutes, ticks: wait }) => {
      const p = find(username);
      const event = { player: p, ms: minutes * 60_000, handledBy: [] };
      PluginManager.emitCustomEvent("agent:advance-time", event);
      await sleepTicks(wait);
      return { advancedMinutes: minutes, handledBy: event.handledBy, ...status(find(username)) };
    }
  );
};
