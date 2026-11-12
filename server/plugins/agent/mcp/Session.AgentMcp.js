// Logging players in and out without a client.
module.exports = function registerSessionTools(ctx) {
  const { core, tool, z, player, find, send, status, sleepTicks } = ctx;
  const { World } = core;

  tool(
    "login",
    "Log a player in with no client attached, through the normal login (a new name creates the account with this password). They stay online until logout; drive them with the other tools. A new account's first-login screens (the character designer, the Ironman setup) are skipped unless onboarding is \"show\": they hold every world click until answered.",
    {
      username: z.string().min(1).max(12),
      password: z.string().min(1).max(64),
      onboarding: z.enum(["skip", "show"]).default("skip")
        .describe("skip: close a new account's character designer and Ironman setup (default look, no Ironman mode); show: leave them for the test"),
    },
    async ({ username, password, onboarding }) => {
      const { player: p, error } = await core.connectHeadlessClient(username, password);
      if (!p) throw new Error(error);
      await sleepTicks(1);
      core.PluginManager.emitCustomEvent("agent-mcp:normal-player", { player: p });
      // "account:skip-onboarding" { player }: the first-login screens step aside (MakeOverMage, Ironman).
      if (onboarding === "skip") core.PluginManager.emitCustomEvent("account:skip-onboarding", { player: p });
      return { username: p.getUsername(), ...status(find(p.getUsername())) };
    }
  );

  tool(
    "logout",
    "Log a player out as if they clicked the logout button; returns the refusal message if they can't leave yet.",
    { player },
    async ({ player: username }) => {
      send(find(username), { type: "logout" });
      await sleepTicks(2);
      const p = World.getPlayerByName(username);
      return p ? { loggedOut: false, ...status(p) } : { loggedOut: true };
    }
  );

  tool(
    "disconnect",
    "Drop a player's connection without logging out, as a closed tab or lost connection does. A player hit in the last 10 seconds stays in the world (and can still be attacked) until combat ends or 60 seconds pass.",
    { player },
    async ({ player: username }) => {
      find(username).getSession().getChannel().close();
      await sleepTicks(2);
      const p = World.getPlayerByName(username);
      return p ? { inWorld: true, ...status(p) } : { inWorld: false };
    }
  );
};
