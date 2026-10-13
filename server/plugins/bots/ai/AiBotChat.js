"use strict";

const { distance, plainName, playersNear } = require("./AiBotObserver");

/**
 * Decides which AI bot, if any, answers public chat. Every AI bot in range hears every line
 * (it goes into their chat history), but the rules here pick who is asked to answer, so five
 * bots near one player never reply at once:
 *
 * 1. A bot named in the message answers ("hey zezima", "lazy u there?").
 * 2. Else, the bot the speaker was just talking with answers.
 * 3. Else, now and then one bot joins in (nearer bots more often), and rarely a second.
 *
 * Bots hear each other too, but answer one another only with a real player nearby and only a
 * couple of lines in a row, so two bots never chat on their own.
 */
const QUESTION = /\?\s*$|^(any|anyone|anybody|who|what|how|where|why|wanna|want|can|does|is|are|u)\b/i;
const GREETING = /^(hi|hey|hello|yo|sup|hiya|howdy|ello)\b/i;

/** Whether `text` names `botName`: the whole name, or a clear start of it. */
function addresses(text, botName) {
  const key = plainName(botName);
  if (key.length === 0) return false;
  if (plainName(text).includes(key)) return true;
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((word) => word.length >= 4 && word.length * 2 >= key.length && key.startsWith(word));
}

class AiBotChatRouter {
  constructor({ core, config, minds, random = Math.random }) {
    this.core = core;
    this.config = config.chat;
    this.minds = minds; // Map lower-case name -> AiBotMind
    this.random = random;
    this.conversations = new Map(); // speaker (lower case) -> { bot, at }
    this.botChain = 0;
  }

  mindOf(player) {
    return this.minds.get(String(player?.getUsername?.() ?? "").toLowerCase()) ?? null;
  }

  /** A player, or bot, said `text` in public chat. */
  onPublicChat(speaker, text, nowMs = Date.now()) {
    const speakerName = speaker.getUsername();
    const near = playersNear(this.core, speaker, this.config.radius);
    const listeners = near.map((player) => this.mindOf(player)).filter(Boolean);
    if (listeners.length === 0) return;
    for (const mind of listeners) {
      mind.hear({ at: nowMs, from: speakerName, text });
    }
    const speakerMind = this.mindOf(speaker);
    if (speakerMind) {
      this.onBotChat(speaker, listeners, near);
      return;
    }
    this.botChain = 0;
    const named = listeners.filter((mind) => addresses(text, mind.name)).slice(0, 2);
    if (named.length > 0) {
      for (const mind of named) mind.requestDecision("addressed", { reply: true, from: speakerName });
      return;
    }
    const talk = this.conversations.get(speakerName.toLowerCase());
    const partner = talk && nowMs - talk.at < this.config.conversationSeconds * 1000
      ? listeners.find((mind) => mind.name === talk.bot)
      : null;
    if (partner) {
      partner.requestDecision("conversation", { reply: true, from: speakerName });
      return;
    }
    const chance = QUESTION.test(text) || GREETING.test(text) ? this.config.questionReplyChance : this.config.replyChance;
    if (this.random() >= chance) return;
    const first = this.pick(listeners, speaker, nowMs);
    if (!first) return;
    first.requestDecision("chat", { from: speakerName });
    if (this.random() < this.config.joinInChance) {
      const second = this.pick(listeners.filter((mind) => mind !== first), speaker, nowMs);
      second?.requestDecision("chat", { from: speakerName, delayMs: 4000 + this.random() * 4000 });
    }
  }

  /** Bot-to-bot: only with a real player around, and only a short exchange. */
  onBotChat(speaker, listeners, near) {
    const realPlayerNear = near.some((player) => player.isPlayerBot?.() !== true);
    if (!realPlayerNear || this.botChain >= this.config.maxBotChain) return;
    if (this.random() >= this.config.botReplyChance) return;
    const mind = this.pick(listeners, speaker, Date.now());
    if (!mind) return;
    this.botChain++;
    mind.requestDecision("chat", { from: speaker.getUsername(), delayMs: 2000 + this.random() * 4000 });
  }

  /** One listener, nearer ones more likely; bots busy trading or still on chat cooldown sit out. */
  pick(listeners, speaker, nowMs) {
    const here = speaker.getLocation();
    const cooldownMs = this.config.cooldownSeconds * 1000;
    const candidates = listeners.filter(
      (mind) => !mind.trade.open && !mind.want && !mind.inFlight && nowMs - mind.lastSpokeAt >= cooldownMs
    );
    if (candidates.length === 0) return null;
    const weights = candidates.map((mind) => 1 / (1 + distance(mind.bot.getLocation(), here)));
    let roll = this.random() * weights.reduce((sum, weight) => sum + weight, 0);
    return candidates.find((_, index) => (roll -= weights[index]) < 0) ?? candidates[0];
  }

  /** A bot answered `speaker`: their next lines go to that bot. */
  noteConversation(speakerName, botName, at) {
    this.conversations.set(String(speakerName).toLowerCase(), { bot: botName, at });
  }
}

/** Model calls per bot and in total, over a sliding minute. */
class AiBotCallLimiter {
  constructor(limits) {
    this.limits = limits;
    this.all = [];
    this.byBot = new Map();
  }

  allow(name, nowMs = Date.now()) {
    const cutoff = nowMs - 60000;
    this.all = this.all.filter((at) => at > cutoff);
    const mine = (this.byBot.get(name) ?? []).filter((at) => at > cutoff);
    if (this.all.length >= this.limits.callsPerMinute || mine.length >= this.limits.callsPerBotPerMinute) {
      this.byBot.set(name, mine);
      return false;
    }
    this.all.push(nowMs);
    mine.push(nowMs);
    this.byBot.set(name, mine);
    return true;
  }
}

module.exports = { AiBotCallLimiter, AiBotChatRouter, addresses };
