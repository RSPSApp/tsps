"use strict";

/**
 * What an AI bot can do, as tools the model calls. The list is the same for every bot (so
 * the prompt prefix caches); what a bot can do right now (levels, who is nearby, an open
 * trade) is in its situation, and each call is checked again before it runs.
 *
 * Schemas stay flat and fully `required` so every backend's tool calling can express them;
 * lengths and amounts are enforced in validate(), not in the schema.
 */
const MAX_CHAT_LENGTH = 80;
const MAX_TRADE_ITEMS = 8;

const object = (properties = {}) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const string = (description) => ({ type: "string", description });

function buildTools({ activityIds, placeIds }) {
  return [
    {
      name: "say",
      description: `Say something in public chat (everyone nearby sees it). At most ${MAX_CHAT_LENGTH} characters.`,
      parameters: object({ text: string("The message.") }),
    },
    {
      name: "reply_private",
      description: "Answer a private message. Only to a player who private messaged you.",
      parameters: object({ player: string("Their name."), text: string("The message.") }),
    },
    {
      name: "start_activity",
      description:
        "Start doing an activity, and keep doing it until you choose something else. With a place, " +
        "walk there first; 'here' starts where you are.",
      parameters: object({
        activity: { type: "string", enum: activityIds, description: "The activity." },
        place: { type: "string", enum: ["here", ...placeIds], description: "Where to do it." },
      }),
    },
    {
      name: "follow_player",
      description: "Walk with a nearby player until you choose to do something else.",
      parameters: object({ player: string("Their name.") }),
    },
    {
      name: "hang_around",
      description: "Stop what you are doing and wander around where you are.",
      parameters: object(),
    },
    {
      name: "trade_request",
      description: "Send a nearby player a trade request, or accept the one they sent you.",
      parameters: object({ player: string("Their name.") }),
    },
    {
      name: "trade_offer",
      description: "Put items from your inventory into the open trade.",
      parameters: object({
        items: {
          type: "array",
          description: `Up to ${MAX_TRADE_ITEMS} items.`,
          items: object({
            item: string("Item name, as in your inventory."),
            amount: { type: "integer", description: "How many." },
          }),
        },
      }),
    },
    {
      name: "trade_accept",
      description: "Accept the open trade as it stands now. Changes to the offer undo it.",
      parameters: object(),
    },
    {
      name: "trade_decline",
      description: "Close the open trade.",
      parameters: object(),
    },
    {
      name: "remember",
      description: "Keep a short note for later sessions: a goal, someone you met, a promise.",
      parameters: object({ note: string("The note, one short sentence.") }),
    },
  ];
}

const isText = (value) => typeof value === "string" && value.trim().length > 0;
const clean = (value, max) => String(value).replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Checks one call against its schema. Returns { name, input } with cleaned input, or
 * { error } for a call that can't run (unknown tool, missing fields, a value off the lists).
 */
function validateCall(call, { activityIds, placeIds }) {
  const input = call?.input && typeof call.input === "object" ? call.input : {};
  switch (call?.name) {
    case "say":
      return isText(input.text) ? { name: "say", input: { text: clean(input.text, MAX_CHAT_LENGTH) } } : { error: "say needs text" };
    case "reply_private":
      return isText(input.player) && isText(input.text)
        ? { name: "reply_private", input: { player: clean(input.player, 12), text: clean(input.text, MAX_CHAT_LENGTH) } }
        : { error: "reply_private needs a player and text" };
    case "start_activity": {
      const place = input.place ?? "here";
      if (!activityIds.includes(input.activity)) return { error: `unknown activity ${input.activity}` };
      if (place !== "here" && !placeIds.includes(place)) return { error: `unknown place ${place}` };
      return { name: "start_activity", input: { activity: input.activity, place } };
    }
    case "follow_player":
    case "trade_request":
      return isText(input.player) ? { name: call.name, input: { player: clean(input.player, 12) } } : { error: `${call.name} needs a player` };
    case "trade_offer": {
      const items = (Array.isArray(input.items) ? input.items : [])
        .filter((entry) => isText(entry?.item) && Number.isInteger(entry?.amount) && entry.amount > 0)
        .slice(0, MAX_TRADE_ITEMS)
        .map((entry) => ({ item: clean(entry.item, 60), amount: entry.amount }));
      return items.length > 0 ? { name: "trade_offer", input: { items } } : { error: "trade_offer needs items" };
    }
    case "hang_around":
    case "trade_accept":
    case "trade_decline":
      return { name: call.name, input: {} };
    case "remember":
      return isText(input.note) ? { name: "remember", input: { note: clean(input.note, 120) } } : { error: "remember needs a note" };
    default:
      return { error: `unknown tool ${call?.name}` };
  }
}

module.exports = { MAX_CHAT_LENGTH, buildTools, validateCall };
