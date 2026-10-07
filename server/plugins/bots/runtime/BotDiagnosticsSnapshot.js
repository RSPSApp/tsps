const { readPoint, readTile, formatPoint } = require("../lib/BotValueUtils");

const CURRENT_PRESET_ATTRIBUTE = "pvp:current-preset";

const STUCK_THRESHOLDS_MS = Object.freeze({
  ditchTransition: 10000,
  pendingMove: 12000,
  overdueAction: 12000,
});

const HISTORY_LOOP_THRESHOLDS = Object.freeze({
  ditchRequested: 8,
  ditchCompleted: 3,
  ditchRetargets: 3,
  bankBlockedNoTraversal: 6,
  ditchPostRetryWaitMs: 9000,
});

function msRemainingLabel(targetMs, nowMs) {
  if (!Number.isFinite(targetMs) || targetMs <= 0) {
    return "n/a";
  }
  const remaining = Math.max(0, targetMs - nowMs);
  return `${remaining}ms`;
}

function msElapsedLabel(sinceMs, nowMs) {
  if (!Number.isFinite(sinceMs) || sinceMs <= 0) {
    return "n/a";
  }
  return `${Math.max(0, nowMs - sinceMs)}ms`;
}

function normalizePendingMovement(request) {
  const point = readPoint(request);
  if (!point) {
    return null;
  }
  return {
    point,
    requestedAtMs: Number.isFinite(request?.requestedAtMs) ? request.requestedAtMs : null,
    reason: request?.reason ?? null,
    maxRouteSegmentTiles: Number.isFinite(request?.maxRouteSegmentTiles)
      ? request.maxRouteSegmentTiles
      : null,
  };
}

function formatPendingMovement(request, nowMs) {
  if (!request?.point) {
    return "none";
  }
  const ageMs = Number.isFinite(request.requestedAtMs)
    ? Math.max(0, nowMs - request.requestedAtMs)
    : null;
  return `${formatPoint(request.point)} age=${ageMs ?? "n/a"}ms reason=${
    request.reason ?? "n/a"
  }`;
}

function chatTrim(text, max = 200) {
  if (typeof text !== "string") {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 3)}...`;
}

function resolveModeActionAt(state) {
  switch (state?.mode) {
    case "roaming":
      return state?.roaming?.nextWalkAt ?? null;
    case "pvp":
      return state?.pvp?.nextActionAt ?? null;
    default:
      return null;
  }
}

function isQueueMoving(queue) {
  return queue?.isMovings?.() === true;
}

function resolveQueueSize(queue) {
  const size = queue?.size?.();
  return Number.isFinite(size) ? size : 0;
}

function parseHistoryEntry(entry) {
  if (typeof entry !== "string" || entry.length === 0) {
    return null;
  }
  const eventMatch = entry.match(/^\[[^\]]+\]\s+([^\s]+)/);
  if (!eventMatch) {
    return null;
  }
  const event = eventMatch[1];
  const jsonStart = entry.indexOf("{");
  let payload = null;
  if (jsonStart >= 0) {
    try {
      payload = JSON.parse(entry.slice(jsonStart));
    } catch (_) {
      payload = null;
    }
  }
  return { event, payload };
}

function getHistorySignals(recentHistory) {
  const signals = {
    ditchRequested: 0,
    ditchCompleted: 0,
    ditchRetargets: 0,
    bankBlockedNoTraversal: 0,
    ditchTimeoutSeen: false,
    maxDitchPostRetryWaitMs: 0,
  };

  if (!Array.isArray(recentHistory) || recentHistory.length === 0) {
    return signals;
  }

  for (const line of recentHistory) {
    const parsed = parseHistoryEntry(line);
    if (!parsed) {
      continue;
    }
    const { event, payload } = parsed;

    if (event === "ditch_cross_requested") {
      signals.ditchRequested += 1;
      continue;
    }
    if (event === "ditch_cross_completed_delay_retry_walk") {
      signals.ditchCompleted += 1;
      continue;
    }
    if (event === "ditch_cross_timeout_delay_retry_walk") {
      signals.ditchTimeoutSeen = true;
      continue;
    }
    if (event === "ditch_post_delay_retry_waiting") {
      const waitedMs = Number(payload?.waitedMs ?? 0);
      if (Number.isFinite(waitedMs) && waitedMs > signals.maxDitchPostRetryWaitMs) {
        signals.maxDitchPostRetryWaitMs = waitedMs;
      }
      continue;
    }
    if (event === "path_blocked_retarget") {
      const reason = String(payload?.reason ?? "");
      if (reason.startsWith("ditch_")) {
        signals.ditchRetargets += 1;
      }
      continue;
    }
  }

  return signals;
}

function buildStuckDiagnosis(snapshot) {
  const {
    state,
    nowMs,
    queue,
    pendingMovement,
    awaitingDitch,
    autonomy,
    recentHistory,
  } = snapshot;
  const moving = isQueueMoving(queue);
  const queueSize = resolveQueueSize(queue);

  if (awaitingDitch) {
    const startedAtMs =
      Number(awaitingDitch?.startedAtMs) ||
      Number(awaitingDitch?.startedAt) ||
      Number(awaitingDitch?.requestedAtMs) ||
      0;
    const elapsedMs = startedAtMs > 0 ? Math.max(0, nowMs - startedAtMs) : 0;
    if (elapsedMs >= STUCK_THRESHOLDS_MS.ditchTransition) {
      return {
        stuck: true,
        reason: `ditch transition pending for ${elapsedMs}ms`,
      };
    }
    return {
      stuck: false,
      reason: `crossing ditch (${elapsedMs}ms elapsed)`,
    };
  }

  if (pendingMovement?.point) {
    const ageMs = Number.isFinite(pendingMovement.requestedAtMs)
      ? Math.max(0, nowMs - pendingMovement.requestedAtMs)
      : null;
    if (Number.isFinite(ageMs) && ageMs >= STUCK_THRESHOLDS_MS.pendingMove) {
      return {
        stuck: true,
        reason: `movement request unresolved for ${ageMs}ms`,
      };
    }
    return {
      stuck: false,
      reason: `movement request in-flight (${ageMs ?? "n/a"}ms)`,
    };
  }

  const signals = getHistorySignals(recentHistory);
  if (signals.ditchTimeoutSeen) {
    return {
      stuck: true,
      reason: "ditch transition timed out recently",
    };
  }
  if (signals.maxDitchPostRetryWaitMs >= HISTORY_LOOP_THRESHOLDS.ditchPostRetryWaitMs) {
    return {
      stuck: true,
      reason: `ditch retry wait reached ${signals.maxDitchPostRetryWaitMs}ms`,
    };
  }
  if (
    signals.ditchRequested >= HISTORY_LOOP_THRESHOLDS.ditchRequested &&
    signals.ditchCompleted >= HISTORY_LOOP_THRESHOLDS.ditchCompleted &&
    signals.ditchRetargets >= HISTORY_LOOP_THRESHOLDS.ditchRetargets
  ) {
    return {
      stuck: true,
      reason: `ditch loop detected (requests=${signals.ditchRequested}, completed=${signals.ditchCompleted}, retargets=${signals.ditchRetargets})`,
    };
  }
  const nextActionAt = Number(resolveModeActionAt(state));
  if (Number.isFinite(nextActionAt) && nextActionAt > 0) {
    if (nowMs < nextActionAt) {
      return {
        stuck: false,
        reason: `waiting for mode cooldown (${msRemainingLabel(nextActionAt, nowMs)})`,
      };
    }
    const overdueMs = nowMs - nextActionAt;
    if (!moving && queueSize <= 0 && overdueMs >= STUCK_THRESHOLDS_MS.overdueAction) {
      return {
        stuck: true,
        reason: `mode action overdue by ${overdueMs}ms with no movement`,
      };
    }
  }

  if (moving) {
    return { stuck: false, reason: "currently moving" };
  }
  if (queueSize > 0) {
    return { stuck: false, reason: `movement queue has ${queueSize} step(s)` };
  }
  if (autonomy && nowMs < Number(autonomy.nextDecisionAt ?? 0)) {
    return {
      stuck: false,
      reason: `waiting for next mode decision (${msRemainingLabel(
        autonomy.nextDecisionAt,
        nowMs
      )})`,
    };
  }
  return { stuck: false, reason: "no stuck indicators detected" };
}

/** One line of "what is it waiting on" so a standstill is readable, not guessed. */
function describeModeState(state, nowMs) {
  if (!state?.mode) {
    return null;
  }
  const next = (value) => `next=${msRemainingLabel(value, nowMs)}`;
  if (state.mode === "roaming" && state.roaming) {
    return `target=${formatPoint(state.roaming.target)} nextWalk=${msRemainingLabel(
      state.roaming.nextWalkAt,
      nowMs
    )}`;
  }
  if (state.mode === "pvp" && state.pvp) {
    return `phase=${state.pvp.phase ?? "n/a"} target=${
      state.pvp.targetUsername ?? "none"
    } ${next(state.pvp.nextActionAt)}`;
  }
  return null;
}

function createBotDiagnosticsSnapshot({
  bot,
  state,
  nowMs = Date.now(),
  peekMovementRequest,
  recentBotLogsByUsername,
}) {
  const username = bot?.getUsername?.() ?? null;
  const queue = bot?.getMovementQueue?.();
  const autonomy = state?.autonomy ?? null;
  const awaitingDitch = state?.awaitingDitchTransition ?? null;
  const rawPendingMovement =
    typeof peekMovementRequest === "function" ? peekMovementRequest(bot) : null;
  const pendingMovement = normalizePendingMovement(rawPendingMovement);
  const currentTile = readTile(bot?.getLocation?.());
  const faceTile = readTile(bot?.getPositionToFace?.());
  const followUsername = bot?.getFollowing?.()?.getUsername?.() ?? null;
  const recruitOwnerUsername = bot?.getAttribute?.("bot-recruit-owner-username") ?? null;
  const queueSize = resolveQueueSize(queue);
  const moving = isQueueMoving(queue);
  const recentHistory =
    username && recentBotLogsByUsername instanceof Map
      ? recentBotLogsByUsername.get(username) ?? []
      : [];

  const snapshot = {
    username,
    state,
    nowMs,
    queue,
    autonomy,
    awaitingDitch,
    pendingMovement,
    currentTile,
    faceTile,
    followUsername,
    recruitOwnerUsername,
    queueSize,
    moving,
    recentHistory,
  };
  snapshot.stuckDiagnosis = buildStuckDiagnosis(snapshot);
  return snapshot;
}

function renderBotDiagnosticsLines({
  bot,
  snapshot,
  runtimeEventLoggingEnabled,
  recentLogLines = 8,
}) {
  const lines = [];
  if (!snapshot) {
    return lines;
  }

  const {
    username,
    state,
    nowMs,
    pendingMovement,
    currentTile,
    faceTile,
    followUsername,
    recruitOwnerUsername,
    queueSize,
    moving,
    recentHistory,
  } =
    snapshot;
  const diagnosis = snapshot.stuckDiagnosis ?? {
    stuck: false,
    reason: "no stuck diagnosis available",
  };
  const statusLabel = diagnosis.stuck ? "STUCK" : "OK";

  lines.push(
    chatTrim(
      `[Bot Status] ${username ?? "unknown"} idx=${bot?.getIndex?.() ?? "n/a"} mode=${
        state?.mode ?? "n/a"
      } ${statusLabel}`
    )
  );
  lines.push(chatTrim(`[Bot Status] Position: ${formatPoint(currentTile)}`));
  const modeDetail = describeModeState(state, nowMs);
  if (modeDetail) {
    lines.push(chatTrim(`[Bot Status] Mode: ${modeDetail}`));
  }
  const pvpLoadoutId = state?.pvp?.loadoutId ?? "n/a";
  const equipmentItems = bot?.getEquipment?.()?.getCopiedItems?.() ?? [];
  const equipped = Array.isArray(equipmentItems)
    ? equipmentItems.filter((item) => item && item.getId?.() > 0)
    : [];
  lines.push(
    chatTrim(
      `[Bot Status] Loadout: pvp=${pvpLoadoutId} preset=${
        bot?.getAttribute?.(CURRENT_PRESET_ATTRIBUTE)?.getName?.() ?? "none"
      } equipped=${equipped.length} primaryWeaponId=${
        state?.pvp?.generatedPrimaryWeaponId ?? "n/a"
      }`
    )
  );
  lines.push(chatTrim(`[Bot Status] Reason: ${diagnosis.reason}`));

  if (state?.mode === "follow_back" || recruitOwnerUsername) {
    lines.push(
      chatTrim(
        `[Bot Status] Follow: target=${state?.followTargetUsername ?? followUsername ?? "n/a"} recruitOwner=${
          recruitOwnerUsername ?? "n/a"
        } face=${formatPoint(faceTile)}`
      )
    );
    lines.push(
      chatTrim(
        `[Bot Status] Movement: queue=${queueSize} moving=${moving === true ? "yes" : "no"} pending=${formatPendingMovement(
          pendingMovement,
          nowMs
        )} manualMode=${state?.autonomy?.manualMode ?? "n/a"}`
      )
    );
  }

  if (diagnosis.stuck) {
    lines.push(
      chatTrim(
        `[Bot Status] Context: tile=${formatPoint(currentTile)} follow=${
          followUsername ?? "n/a"
        } pending=${formatPendingMovement(pendingMovement, nowMs)}`
      )
    );
    const ditchElapsed = msElapsedLabel(snapshot?.awaitingDitch?.startedAtMs, nowMs);
    if (ditchElapsed !== "n/a") {
      lines.push(chatTrim(`[Bot Status] Ditch pending elapsed=${ditchElapsed}`));
    }
    if (runtimeEventLoggingEnabled && Array.isArray(recentHistory) && recentHistory.length > 0) {
      const linesToShow = Math.min(2, Math.max(1, recentLogLines), recentHistory.length);
      for (const line of recentHistory.slice(-linesToShow)) {
        lines.push(chatTrim(`[Bot Status] Log: ${line}`, 220));
      }
    }
  }

  return lines;
}

module.exports = {
  createBotDiagnosticsSnapshot,
  renderBotDiagnosticsLines,
};
