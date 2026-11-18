# Cerberus, Kalphite Queen and Dagannoth Kings Echo placeholders

These Leagues VI encounters deliberately reuse the normal boss controllers until
rsprox captures establish their real Echo mechanics. Each spawns the normal boss,
which EchoBosses dresses with its Echo appearance and Wiki combat profile for that
instance only ([echo-bosses.md](echo-bosses.md)); ordinary definitions are never
changed. This does not claim parity with the real Echo attack patterns.

- Cerberus retains the normal opening triple attack, counted souls/lava cycle,
  firewall and protection checks. Echo entry is available without a Slayer task;
  declining the orb prompt still rechecks the normal task requirement. Souls,
  projectiles and firewall belong to the private encounter. Echo death never
  increments the ordinary Cerberus kill count.
- The Queen retains the normal ground/air phases, molt protection, worker hatching,
  prayer drain and projectile attacks. Each form is re-dressed as it changes, in its
  own Echo models and level (see echo-bosses.md), with the Echo HP and
  the Wiki's separate melee, ranged and magic maxima (38, 35 and 49),
  including the post-molt HP restore. Only the final form can complete the Echo
  encounter; it does not award the normal 256-kill tattered head or ordinary KC.
- The three Kings retain their ordinary individual methods and attack ranges. Each
  has its own 1,800 HP; their health is not shared in this placeholder. Completion
  is emitted once after all three die. The normal room's spinolyps are copied into
  the private encounter and retain their existing combat/dive behavior.

Each module accepts the synchronous `echo-boss:start` protocol and claims a central
token before spawning. The shared service dresses each spawned boss and owns the
Echo equipment roll and progression; normal loot drops as from a normal kill. The encounter keeps its private area
alive for loot after completion. Exit, teleport, logout, death or shutdown destroys
the instance and releases its token; saved return attributes recover outside after
reconnect. Graves are placed outside the relevant entrance.
Entry, exit and recovery immediately save the return marker's current state.

`server/tests/echo-boss-controllers.test.cjs` verifies private actors and hazards,
normal combat reuse with Echo stats, failed entry/spawns, two-form Queen completion,
independent King health, duplicate death events and logout cleanup. Existing
Cerberus, Kalphite Queen and Dagannoth Kings suites cover the unchanged normal fights.
