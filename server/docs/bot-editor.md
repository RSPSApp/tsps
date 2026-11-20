# Code-defined bot routines

The visual editor is retired. Author routines and reusable deployment presets in trusted server plugins, not JSON graphs. The web **Bots** panel and `::bots` deploy configurations; neither edits a routine's behavior. Registration by itself never creates a bot.

**Online bots** lists characters currently in the world, including native minigame bots. **Spawn rules** is separate: an enabled rule can be waiting for players or a match with no bots online.

## Deploy and save in game

Open `::bots` as a developer. **Saved** lists saved routine setups plus code-registered routines. **Routines** matches the web panel's Single routine catalog. **Deployment plans** lists the same plans as the separate web Deployment plans card.

1. Select a row. **Deploy** immediately uses the selected configuration: one bot for an unsaved routine, the saved count and overrides for a saved setup, or every row of a deployment plan.
2. **Configure** shows only the fields the routine or plan advertises. Click a variant to cycle choices; click an editable count to type a number or use `−`/`+`. Setup fields accept `default` to clear an override. All plan rows are in the same scrollable screen.
3. **Save as…** asks for a name. Saving a routine records the concrete routine ID, bot count, and permitted setup overrides in `server/data/saves/bot-routine-setups.json`. Find it in **Saved**. Saving a plan writes a new copy to `server/data/saves/bot-deployment-plans.json`; it appears in **Deployment plans** and the web panel. It preserves each team's match context. Neither action starts any bots or modifies the original routine or preset.

A successful deployment closes `::bots`. A failure stays open and reports the reason. Routine launches report the spawn tile, which may be away from the developer's character.

## Optional deployment caps

Local worlds have no deployment-policy cap by default. Leave these variables unset or set them to `0` in the checkout's `.env`:

```dotenv
BOT_MAX_DEPLOY_COUNT=0
BOT_MAX_MANAGED_BOTS=0
```

A hosted environment can set either variable to a positive integer. `BOT_MAX_DEPLOY_COUNT` applies to an entire launch (for a plan or roster, the sum of its rows), not to each row separately. `BOT_MAX_MANAGED_BOTS` limits the combined number of tracked manual or scheduled bots, including pending native deployments. These are world-wide settings, not per-account or billing-tier policy. Restart the game server after changing them. The real player-slot capacity, allowed-activity policy, and minigame queue, balance, and admission checks still apply when both caps are off. Saving a configuration does not reserve capacity or guarantee that it can deploy later.

## Register a routine and a deployment preset

Add a normal plugin under `server/plugins/`, enable it for the world, and restart. Use the `bots:collect-definitions` event; the bot plugin collects definitions once at startup, before startup deployments, regardless of plugin registration order.

```js
"use strict";

function createRestActions({ action }) {
  // Reuse a built-in Brain action, or return custom action objects here.
  return [action({ type: "wait", seconds: 5 })];
}

function collectDefinitions({ registerRoutine, registerPlan }) {
  registerRoutine({
    id: "rest_stop",
    name: "Rest stop",
    repeat: false,
    deploymentOverrides: ["location"],
    createActions: createRestActions,
  });
  registerPlan({
    id: "plugin-rest-pair",
    name: "Rest stop pair",
    rows: [{ routine: "rest_stop", count: 2 }],
    launchOverrides: [{ count: true }],
  });
}

module.exports = {
  name: "RestStopBots",
  register(api) {
    api.onCustomEvent("bots:collect-definitions", collectDefinitions);
  },
};
```

- Use a stable, unique routine ID such as `rest_stop` (1–55 lowercase letters, digits, or underscores, beginning with a letter). No prefix is required; already-published `plugin_…` IDs are still valid. The registry rejects collisions with built-in routines, reserved IDs and other registrations. Code **preset** IDs still use `plugin-` to keep them separate from offline saved plans. A rejected definition is logged as `bot_code_definition_failed`.
- `createActions({ api, core, action, condition })` runs once and returns one or more synchronous Brain actions. Put complex decisions in named functions as with any plugin. Actions may implement `start`, `update`, `stop`, `madeProgress`, and `describe`. `update(ctx)` returns `running`, `success`, `failed`, or `wait` (`ctx.waitTicks` controls a wait). Brain owns scheduling, pacing and recovery. For state across ticks, use a `WeakMap` keyed by `ctx.player` and clear per-run state on stop; actions are shared across actors.
- An optional `spawnSetup` supplies `location: { x, y, z }`, `skills`, `inventory`, and `equipment`; the latter two use `{ slot, id, amount }` entries. Only newly spawned bots receive the setup.
- `deploymentOverrides` opts a code routine into any of `location`, `skills`, `inventory`, or `equipment`. Omit it to keep the start setup fixed. Legacy built-ins retain their start setup overrides; the server advertises variant choices such as Tree type alongside those fields. A variant still launches its original routine ID.
- Code presets appear in the plan dropdown while the world is running. `launchOverrides` has one entry per row: `{ count: true }` permits editing the count, and `{ routines: ["other_id"] }` advertises specific routine alternatives. Omit the list to keep all rows fixed. These only affect one launch; the server enforces the allowed values and normal match admission. For a personal saved plan, change counts at launch or use **Edit saved plan** to change its routines.

## Responsibilities and migration

| Component | Owns | Does not own |
| --- | --- | --- |
| Content plugin | Stable IDs, behavior, initial kit, optional allowed overrides, and optional reusable plans | Creating characters during registration |
| Brain | Running actions, pacing, interruption/resumption and teardown | Match admission or gameplay rules |
| Gameplay helpers | Real gathering, combat, movement and match rules | Scheduling a bot's routine |
| Deployment layer | Catalog, configuration, limits, queues and tracking | Implementing a second behavior language |

`bots:collect-definitions` follows the same event-driven pattern as content plugins. Register a named collector in `register(api)`. The bot plugin calls collectors after plugin registration, validates routines before validating preset references, and activates the resulting catalog before applying `PlayerBots:startupRoutines`. To run bots automatically, configure a startup rule with a concrete `{ id, count }`; merely registering definitions or saving a launch setup never arms a rule. `capacity` on a routine is a Brain scheduling preference, not a deployment cap. Prefer existing gameplay helpers via `api.core` rather than synthesizing client packets or adding a bot-only copy of game rules.

The Castle Wars, Soul Wars, and Pest Control presets use their native match behavior. Deploying a team plan does not let bots bypass portals, queue rules or team balance. Castle Wars practice remains available separately; the old bot prompt is opt-in.

Shipped routines keep their original code and IDs. Neither legacy flat activities nor graph routines are loaded; their source files are not modified or deleted. To restore an old routine, port its behavior to a normal server plugin and register it under the same ID. Existing saved setups, plans, and startup rules can then resolve the ID without edits. Plans remain editable offline, but a routine not registered in the running world cannot be deployed. The graph-specific MCP tools and `::bots` self-routines have been removed.
