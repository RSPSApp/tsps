# AI bots

AI bots are PlayerBots bots whose decisions come from a language model: what to do next,
what to say, and how to trade. Between decisions the normal bot brain plays them. They chop,
mine, fish and fight like any other bot, but they also talk to players, follow them, give
small gifts and keep notes between sessions.

Code: `plugins/bots/ai/`, wired from `PlayerBots.plugin.js`. Tests: `tests/ai-bots.test.cjs`.

## Turning them on

1. Put a provider's key in the root `.env` (never in world config):

   ```
   ANTHROPIC_API_KEY=sk-ant-...          # Claude
   OLLAMA_URL=http://localhost:11434      # a local model through Ollama, free to run
   ```

2. Enable them in `data/definitions/world.local.json` (PlayerBots must not be disabled):

   ```json
   "pluginConfig": { "PlayerBots:ai": { "enabled": true, "count": 3, "places": ["lumbridge"] } }
   ```

On startup the server says which providers it uses, or that none is configured. Failed model
calls (a wrong key, Ollama not running) are printed at most once a minute per provider. Bots
whose calls fail keep playing on their brain and just don't talk. `::aibots` (owner) lists
them and what they're doing. Decisions, with token usage, go to the PlayerBots log with
`BOT_RUNTIME_EVENT_LOGGING=1`.

Chat that players send to AI bots goes to whichever provider the owner configured. Say so in
your server's rules or privacy notice.

## Settings

All of them live under `"PlayerBots:ai"`; see `AiBotConfig.js` for the defaults.

| Setting | Default | |
| --- | --- | --- |
| `enabled` | `false` | |
| `count` | `3` | AI bots online. Each keeps its name, save and notes. |
| `places` | `lumbridge`, `draynor_village`, `varrock` | Where new bots start, round-robin (`plugins/bots/data/ai-places.json`). |
| `names` | `"realistic"` | Player-like names (`Its Kenny`, `Moist Toast`, `Torag57`, `J0nas Walrus`), or `"numbered"` (`AiBot1`). |
| `disclose` | `false` | `false`: bots never say they're an AI or name a model; asked, they laugh it off or change the subject (without insisting they're human). `true`: they say so plainly. |
| `providers` | Claude Haiku 4.5, then Ollama `llama3.1` | Each new bot takes the next entry whose key is set. `{ "provider", "model", "effort" }`; `effort` (`"low"` ...) only for models that take it, such as `claude-sonnet-5-5` and `claude-opus-5-5`. |
| `chat` | | Who answers chat (below). |
| `limits.callsPerBotPerMinute` / `callsPerMinute` | `4` / `30` | Hard caps on model calls. |
| `checkInMinutes` | `[8, 15]` | How often a bot reconsiders what it's doing. |
| `watchTiles` | `64` | A bot with no real player this near makes no model calls of its own (check-ins, idle choices, login); its brain plays on. Chat, private messages and trades are still answered. |
| `logoutWhenEmptyMinutes` | `0` (off) | Minutes without any real player online before AI bots log out. They log back in, one every 1.5 seconds, when someone arrives; with it on and nobody online at startup, they wait. |
| `pacing` | | Pauses so a bot doesn't act every tick, in ms ranges: `actionPauseMs` `[600, 2400]` after each action, `activityPauseMs` `[2000, 8000]` before a new activity, `walkPauseChance` `0.3` / `walkPauseMs` `[600, 2400]` between walk legs, `dropsPerTick` `[1, 2]`. |
| `gifts.perTrade` / `gifts.perPlayerPerDay` | `10000` / `25000` | The most a bot gives away (Grand Exchange value). |

## How a bot decides

A bot asks its model only when there's a reason: it's spoken to, it's idle, there's a trade,
it logged in, or a check-in comes due. Each call is a single request: a system prompt that is
the same for every bot (cached by Claude), and the bot's situation. The situation covers where
it is, what it's doing, its stats, items and notes, nearby players, recent chat and events.
The model answers with tool calls (`AiBotTools.js`): `say`, `reply_private`, `start_activity`,
`follow_player`, `hang_around`, `trade_request`, `trade_offer`, `trade_accept`,
`trade_decline` and `remember`. Every call is checked again before it runs. Calls run in the
background and their results are applied on a later tick, so the game loop never waits on a model.

`start_activity` runs one of the activities in `bot-activities.json` that the bot's levels
allow, optionally at a place: the bot walks there first. When an activity ends, the brain asks
the bot for its next one (`BotBrain` `chooseNext`). If the model doesn't answer within 25
seconds, the brain picks one itself.

## Quiet worlds

Model calls follow the players. A bot no real player is within `watchTiles` of asks its
model nothing on its own: no check-ins, no choice after an activity (its brain picks), no
login decision. A world nobody is playing on costs no calls, however many bots it has.
`logoutWhenEmptyMinutes` goes further and logs the bots out, which also saves server time.
Bots log in one every 1.5 seconds, at startup too.

## Who answers chat

Every AI bot within `chat.radius` hears public chat, but `AiBotChat.js` picks who answers:

1. A bot named in the message ("hey lazy", "dave83 what lvl").
2. Else the bot the speaker was just talking with (`chat.conversationSeconds`).
3. Else, with `chat.replyChance` (higher for questions and greetings), one bot, nearer ones
   more likely; rarely a second joins in.

Bots hear each other, but answer one another only with a real player nearby and at most
`chat.maxBotChain` times in a row. Replies go out after a typing pause, and never faster than
`chat.cooldownSeconds`. A walking or idle bot stands still while it types; a skilling or
fighting one carries on, as those do by themselves in OSRS. Private messages always reach
their bot, and a bot answers privately only someone who messaged it.

## Trading and gifts

Players trade with AI bots as with anyone. The model decides what to offer and whether to
accept, and `AiBotTrade.js` enforces rules it can't talk its way past:

- No trade that loses the bot more than `gifts.perTrade`, nor more than `gifts.perPlayerPerDay`
  to one player in a day (in memory: resets on restart).
- Only inventory items, never the tools its activities use.
- The second screen is accepted only if both sides still hold exactly what was agreed.

## Accounts

AI bots have normal player saves, so their levels and items carry over. Their names, personas,
providers and notes are in `data/saves/ai-bots.json`. A new bot never takes a name that has a
save, and its password is random and never stored in a usable form, so no one can log in as an
AI bot. They are always ordinary players (no staff rank or crown), and recruiting and duel
auto-accept, which other bots have, are off for them. Names are formatted the way login
formats a real player's, so they never stand out.

## Adding a provider

A provider is a class with `static isConfigured(env)` and
`generate({ system, prompt, tools }) -> { calls: [{ name, input }], text, usage }`, listed in
`AiBotProviders.js`. Tools come as `{ name, description, parameters }` with flat JSON schemas.
OpenAI and Gemini adapters are the next ones planned.
