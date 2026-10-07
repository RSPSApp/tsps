// Logging players in and out without a client.
module.exports = function registerSessionTools(ctx) {
  const { core, tool, z, player, find, send, status, sleepTicks } = ctx;
  const { World } = core;

  tool(
    "login",
    "Log a player in with no client attached, through the normal login (a new name creates the account with this password). They stay online until logout; drive them with the other tools.",
    { username: z.string().min(1).max(12), password: z.string().min(1).max(64) },
    async ({ username, password }) => {
      const { player: p, error } = await core.connectHeadlessClient(username, password);
      if (!p) throw new Error(error);
      await sleepTicks(1);
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
};
