"use strict";

const { AiBotTrade } = require("./AiBotTrade");
const { buildSituation } = require("./AiBotPrompt");
const { validateCall } = require("./AiBotTools");
const { findPlayerNear, observe } = require("./AiBotObserver");
const { createFollowActivity, createTravelActivity } = require("./AiBotActivities");

/**
 * One AI bot. It collects what the bot hears and what happens to it, asks the model when
 * there is a reason to (spoken to, idle, a trade, a periodic check-in), and carries out the
 * answer on a later game tick. Model calls never block the tick: they run in the background
 * and land in `results`, which tick() applies.
 *
 * Between calls the bot's BotBrain plays as any bot does; a decision only swaps its activity.
 */
const MAX_CHAT = 16;
const MAX_EVENTS = 10;
// A reply that comes back this late is dropped: the moment has passed.
const STALE_REPLY_MS = 30000;
// How long an idle bot waits for the model before the brain picks something itself.
const IDLE_WAIT_MS = 25000;
// Places this close count as "here": no walk first.
const ARRIVED_TILES = 12;
// A bot answers private messages only from someone who messaged it this recently.
const PRIVATE_REPLY_MS = 10 * 60000;
// How long the brain stays held after each tick of a fight, so it resumes soon after.
const DEFEND_HOLD_MS = 1800;
// An attacker further off than this (it walked home) is no longer a fight.
const DEFEND_RANGE_TILES = 15;
// Decisions no player asked for. A bot no real player is near skips them: the brain plays
// on and nobody misses a choice no one sees, so quiet worlds cost no model calls.
const UNWATCHED_REASONS = new Set(["login", "idle", "checkIn"]);

const ASKS = Object.freeze({
  reply: "Someone is talking to you or dealing with you. Answer them (say, or reply_private for a private message) and act if you want to.",
  chat: "Players are chatting near you. Join in only if you have something to add; staying quiet is fine.",
  trade: "There is a trade going on: decide what to do with it (trade_request, trade_offer, trade_accept or trade_decline), and say something if it helps.",
  idle: "You aren't doing anything. Choose what to do next with start_activity, follow_player or hang_around. Say something only if it fits.",
  checkIn: "You've been at this a while. Keep going (make no call), or do something else.",
  login: "You just logged in. Choose what to do (start_activity, follow_player or hang_around). Say hi only if people you know are around.",
});

class AiBotMind {
  /**
   * services: { core, config, roster, registry, places (Map id -> place), placeList, catalog,
   * system, tools, toolContext, limiter, router, givenToday, getEntry(), log, emitCustomEvent }
   */
  constructor({ bot, profile, provider, services }) {
    this.bot = bot;
    this.profile = profile;
    this.provider = provider;
    this.services = services;
    this.chat = [];
    this.events = [];
    this.want = null;
    this.inFlight = false;
    this.results = [];
    this.sayQueue = [];
    this.lastSpokeAt = 0;
    this.plan = null;
    this.idleSince = 0;
    this.doing = { label: "just logged in", since: Date.now() };
    this.nextCheckInAt = Date.now() + this.checkInDelay();
    this.trade = new AiBotTrade({
      mind: this,
      core: services.core,
      gifts: services.config.gifts,
      givenToday: services.givenToday,
    });
  }

  get name() {
    return this.bot.getUsername();
  }

  checkInDelay() {
    const [min, max] = this.services.config.checkInMinutes ?? [8, 15];
    return (min + Math.random() * Math.max(0, max - min)) * 60000;
  }

  entry() {
    return this.services.getEntry(this.name);
  }

  brain() {
    return this.entry()?.brain ?? null;
  }

  pauseBrain(paused) {
    const brain = this.brain();
    if (brain) brain.paused = paused;
  }

  hear(line) {
    this.chat.push(line);
    if (this.chat.length > MAX_CHAT) this.chat.shift();
  }

  addEvent(text) {
    this.events.push({ at: Date.now(), text });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  /**
   * Asks for a decision. Several reasons before the call goes out merge into one call.
   * `reply`: someone expects an answer (spoken to, a trade). `from`: who, for the conversation.
   */
  requestDecision(reason, { reply = false, from = null, delayMs = 0 } = {}) {
    const now = Date.now();
    if (!this.want) {
      this.want = { reasons: new Set(), reply: false, from: null, at: now, notBefore: now };
    }
    this.want.reasons.add(reason);
    this.want.reply = this.want.reply || reply;
    this.want.from = from ?? this.want.from;
    this.want.notBefore = Math.max(this.want.notBefore, now + delayMs);
  }

  /** BotBrain.chooseNext: the planned activity, "wait" while the model decides, or null. */
  chooseNext(nowMs) {
    if (this.plan) {
      const { activity, home } = this.plan;
      this.plan = null;
      this.setHome(home);
      this.doing = { label: activity.label ?? activity.id, since: nowMs };
      return activity;
    }
    if (!this.services.watched(this.bot)) {
      return null;
    }
    if (!this.idleSince) {
      this.idleSince = nowMs;
      this.addEvent("You finished what you were doing.");
      this.requestDecision("idle");
    }
    if (nowMs - this.idleSince > IDLE_WAIT_MS) {
      // The model is slow or out of calls: let the brain carry on with its own pick.
      this.idleSince = 0;
      return null;
    }
    return "wait";
  }

  setHome(location) {
    const state = this.entry()?.state;
    if (state && location) state.home = { x: location.x, y: location.y, z: location.z ?? 0 };
  }

  describeDoing(nowMs) {
    const minutes = Math.round((nowMs - this.doing.since) / 60000);
    return minutes > 0 ? `${this.doing.label} (for ${minutes} min)` : this.doing.label;
  }

  tick(nowMs) {
    if (this.bot.isRegistered?.() !== true) return;
    this.trade.tick(nowMs);
    this.defend(nowMs);
    while (this.results.length > 0) {
      this.apply(this.results.shift(), nowMs);
    }
    while (this.sayQueue.length > 0 && this.sayQueue[0].at <= nowMs) {
      this.speak(this.sayQueue.shift().text, nowMs);
    }
    if (nowMs >= this.nextCheckInAt) {
      this.nextCheckInAt = nowMs + this.checkInDelay();
      this.requestDecision("checkIn");
    }
    if (this.want && !this.want.reply && !this.services.watched(this.bot) &&
        [...this.want.reasons].every((reason) => UNWATCHED_REASONS.has(reason))) {
      this.want = null;
      this.idleSince = 0;
    }
    if (this.want && !this.inFlight && nowMs >= this.want.notBefore) {
      if (this.want.reply && nowMs - this.want.at > STALE_REPLY_MS) {
        this.want.reply = false;
      }
      if (this.services.limiter.allow(this.name, nowMs)) {
        this.startCall(nowMs);
      }
    }
  }

  askFor(want) {
    const order = ["reply", "trade", "login", "idle", "checkIn", "chat"];
    const reasons = new Set();
    for (const reason of want.reasons) {
      if (reason.startsWith("trade")) reasons.add("trade");
      else if (reason === "addressed" || reason === "conversation" || reason === "private") reasons.add("reply");
      else reasons.add(reason);
    }
    return order.filter((key) => reasons.has(key)).map((key) => ASKS[key]).join("\n");
  }

  startCall(nowMs) {
    const want = this.want;
    this.want = null;
    this.inFlight = true;
    const { system, tools, log } = this.services;
    let prompt;
    try {
      prompt = buildSituation(observe(this, this.askFor(want), nowMs));
    } catch (error) {
      this.inFlight = false;
      log("ai_bot_observe_failed", { bot: this.name, error: String(error?.message ?? error) });
      return;
    }
    const startedAt = Date.now();
    this.provider
      .generate({ system, prompt, tools })
      .then((result) => this.results.push({ want, result, ms: Date.now() - startedAt }))
      .catch((error) => {
        log("ai_bot_call_failed", { bot: this.name, provider: this.provider.name, error: String(error?.message ?? error) });
        this.results.push({ want, result: null, ms: Date.now() - startedAt });
      })
      .finally(() => {
        this.inFlight = false;
      });
  }

  apply({ want, result, ms }, nowMs) {
    const { log, toolContext } = this.services;
    if (!result) return;
    log("ai_bot_decision", {
      bot: this.name,
      reasons: [...want.reasons],
      calls: result.calls.map((call) => call.name),
      ms,
      usage: result.usage,
      refused: result.refused,
    });
    let calls = result.calls;
    // A local model that answers in plain text instead of calling say.
    if (calls.length === 0 && want.reply && result.text && !result.text.includes("\n") && result.text.length <= 120) {
      calls = [{ name: "say", input: { text: result.text.replace(/^["']|["']$/g, "") } }];
    }
    const stale = nowMs - want.at > STALE_REPLY_MS;
    for (const call of calls) {
      const checked = validateCall(call, toolContext);
      if (checked.error) {
        log("ai_bot_bad_call", { bot: this.name, error: checked.error });
        continue;
      }
      if (stale && (checked.name === "say" || checked.name === "reply_private")) {
        continue;
      }
      const problem = this.execute(checked, want, nowMs);
      if (problem) {
        this.addEvent(`You couldn't do that: ${problem}.`);
      }
    }
  }

  /** Runs one checked call. Returns why it couldn't, or null. */
  execute({ name, input }, want, nowMs) {
    const { core, registry, places, roster } = this.services;
    switch (name) {
      case "say":
        this.queueSay(input.text, want.from, nowMs);
        return null;
      case "reply_private": {
        const wanted = input.player.toLowerCase();
        const messaged = this.chat.some((line) => line.private && line.from.toLowerCase() === wanted && nowMs - line.at < PRIVATE_REPLY_MS);
        if (!messaged) return `${input.player} hasn't messaged you`;
        const recipient = core.World.getPlayerByName(input.player);
        if (!recipient) return `${input.player} isn't online`;
        const event = { sender: this.bot, recipient, text: input.text, sent: false };
        this.services.emitCustomEvent("friends:send-private-message", event);
        if (event.sent) this.hear({ at: nowMs, from: `You to ${recipient.getUsername()}`, text: input.text, private: true });
        return event.sent ? null : `${input.player} can't get private messages from you`;
      }
      case "start_activity": {
        const activity = registry.byId.get(input.activity);
        if (!activity) return `there's no ${input.activity}`;
        if (!activity.requires.every((condition) => condition.check({ player: this.bot }))) {
          return `your levels are too low for ${input.activity}`;
        }
        const here = this.bot.getLocation();
        const place = input.place === "here" ? null : places.get(input.place);
        const home = place ?? { x: here.getX(), y: here.getY(), z: here.getZ() };
        if (place && (place.z ?? 0) === here.getZ() && Math.max(Math.abs(place.x - here.getX()), Math.abs(place.y - here.getY())) > ARRIVED_TILES) {
          this.plan = { activity, home };
          this.startRoot(createTravelActivity(place), `walking to ${place.name} to do ${activity.id}`, nowMs);
        } else {
          this.setHome(home);
          this.startRoot(activity, activity.id, nowMs);
        }
        return null;
      }
      case "follow_player": {
        const target = findPlayerNear(core, this.bot, input.player);
        if (!target) return `${input.player} isn't near you`;
        const targetName = target.getUsername();
        this.plan = null;
        this.startRoot(createFollowActivity(targetName, (who) => core.World.getPlayerByName(who)), `following ${targetName}`, nowMs);
        return null;
      }
      case "hang_around": {
        const roam = registry.byId.get("roam");
        if (!roam) return "you can't wander here";
        const here = this.bot.getLocation();
        this.plan = null;
        this.setHome({ x: here.getX(), y: here.getY(), z: here.getZ() });
        this.startRoot(roam, "hanging around", nowMs);
        return null;
      }
      case "trade_request": {
        const target = findPlayerNear(core, this.bot, input.player);
        if (!target) return `${input.player} isn't near you`;
        return this.trade.requestWith(target);
      }
      case "trade_offer":
        return this.trade.offer(input.items) || null;
      case "trade_accept":
        return this.trade.accept();
      case "trade_decline":
        return this.trade.decline();
      case "remember":
        roster.remember(this.name, input.note);
        this.profile = roster.get(this.name) ?? this.profile;
        return null;
      default:
        return `unknown action ${name}`;
    }
  }

  startRoot(activity, label, nowMs) {
    const brain = this.brain();
    if (!brain) return;
    this.idleSince = 0;
    this.doing = { label, since: nowMs };
    if (!this.trade.open) brain.paused = false;
    brain.replaceRoot(activity, nowMs);
  }

  /** Public chat goes out after a typing pause, and never faster than the chat cooldown. */
  queueSay(raw, to, nowMs) {
    // Public chat starting with :: runs a command; a bot's line never does.
    const text = raw.replace(/^[\s:]+/, "");
    if (!text) return;
    const cooldownMs = (this.services.config.chat.cooldownSeconds ?? 6) * 1000;
    const last = Math.max(this.lastSpokeAt, this.sayQueue.at?.(-1)?.at ?? 0);
    const typingMs = Math.min(6000, 700 + text.length * 80);
    const at = Math.max(nowMs + typingMs, last + cooldownMs);
    this.sayQueue.push({ at, text });
    this.lastSpokeAt = at;
    this.holdWhileTyping(at);
    if (to) this.services.router.noteConversation(to, this.name, at);
  }

  /**
   * Attacked by an NPC, a player stops what they're doing and fights back. The brain's
   * activity is held (it would keep walking the bot off, which also stops the core's
   * auto-retaliate) until the fight is over; combat training runs its own fights.
   */
  defend(nowMs) {
    const combat = this.bot.getCombat?.();
    const attacker = combat?.getAttacker?.();
    const brain = this.brain();
    if (!brain || this.trade.open || attacker?.isNpc?.() !== true || brain.isRunningActivity?.("combat_training")) {
      this.attackedBy = null;
      return;
    }
    const there = attacker.getLocation?.();
    const here = this.bot.getLocation();
    const far = !there || there.getZ() !== here.getZ() ||
      Math.max(Math.abs(there.getX() - here.getX()), Math.abs(there.getY() - here.getY())) > DEFEND_RANGE_TILES;
    if (far || attacker.isRegistered?.() === false || (attacker.getHitpoints?.() ?? 0) <= 0) {
      this.attackedBy = null;
      return;
    }
    if (this.attackedBy !== attacker) {
      this.attackedBy = attacker;
      this.addEvent(`A ${attacker.getDefinition?.()?.getName?.() ?? "monster"} attacked you.`);
    }
    brain.restUntil = Math.max(brain.restUntil ?? 0, nowMs + DEFEND_HOLD_MS);
    if (!combat.getTarget?.()) {
      this.bot.getMovementQueue?.()?.reset?.();
      combat.attack(attacker);
    }
  }

  /**
   * A player who types stops clicking: a walking or idle bot stands still until its line is
   * out. Skilling and fighting carry on by themselves in OSRS, so those bots keep going.
   */
  holdWhileTyping(until) {
    const combat = this.bot.getCombat?.();
    const busy = this.services.world?.isBusy?.(this.bot) === true || combat?.getTarget?.() || combat?.getAttacker?.();
    const brain = this.brain();
    if (busy || this.trade.open || !brain) return;
    brain.restUntil = Math.max(brain.restUntil ?? 0, until);
    this.bot.getMovementQueue?.()?.reset?.();
  }

  speak(text, nowMs) {
    this.hear({ at: nowMs, from: "You", text });
    this.services.core.ChatPacketListener.handleText(this.bot, text);
  }
}

module.exports = { AiBotMind, ASKS };
