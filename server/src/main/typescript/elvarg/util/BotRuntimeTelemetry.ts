type TelemetryPair = {
  key: string;
  count: number;
};

type TelemetrySnapshot = {
  windowStartedAt: string;
  windowMs: number;
  totalEvents: number;
  topEvents: TelemetryPair[];
  topReasons: TelemetryPair[];
  topUsers: TelemetryPair[];
};

type CounterBucket = {
  startedAt: number;
  totalEvents: number;
  eventCounts: Map<string, number>;
  reasonCounts: Map<string, number>;
  userCounts: Map<string, number>;
};

const TRACKED_EVENTS = new Set<string>([
  "bot_mode_switch",
  "bot_movement_node_dispatch",
  "path_blocked_retarget",
  "path_blocked_retarget_failed",
  "path_blocked_backoff_applied",
  "ditch_cross_requested",
  "ditch_cross_execute",
  "ditch_cross_waiting_force_movement",
  "ditch_cross_cooldown_active",
  "ditch_cross_completed_delay_retry_walk",
  "ditch_cross_timeout_delay_retry_walk",
  "ditch_post_delay_retry_walk",
]);

const EVENT_SAMPLE_STRIDE = new Map<string, number>([
  // Extremely high-frequency events; sample to keep telemetry overhead low.
  ["bot_movement_node_dispatch", 4],
  ["ditch_cross_requested", 2],
  ["ditch_cross_cooldown_active", 4],
  ["ditch_cross_waiting_force_movement", 3],
]);

const TRACK_REASON_EVENTS = new Set<string>([
  "path_blocked_retarget",
  "path_blocked_retarget_failed",
  "path_blocked_backoff_applied",
  "ditch_cross_timeout_delay_retry_walk",
  "bot_mode_switch",
]);

const TRACK_USER_EVENTS = new Set<string>([
  "ditch_cross_requested",
  "path_blocked_retarget",
  "bot_mode_switch",
]);

export class BotRuntimeTelemetry {
  private static readonly MAX_EVENT_KEYS = 256;
  private static readonly MAX_REASON_KEYS = 512;
  private static readonly MAX_USER_KEYS = 512;
  private static sampledEventCounters = new Map<string, number>();

  private static intervalBucket: CounterBucket = BotRuntimeTelemetry.createBucket(
    Date.now()
  );

  private static createBucket(startedAt: number): CounterBucket {
    return {
      startedAt,
      totalEvents: 0,
      eventCounts: new Map<string, number>(),
      reasonCounts: new Map<string, number>(),
      userCounts: new Map<string, number>(),
    };
  }

  private static normalizeKey(value: unknown): string {
    const normalized = String(value ?? "").trim();
    return normalized.length > 0 ? normalized : "unknown";
  }

  private static incrementWithCap(
    map: Map<string, number>,
    key: string,
    maxKeys: number
  ): void {
    const existing = map.get(key);
    if (existing !== undefined) {
      map.set(key, existing + 1);
      return;
    }
    if (map.size >= maxKeys) {
      map.set("__other__", (map.get("__other__") ?? 0) + 1);
      return;
    }
    map.set(key, 1);
  }

  private static topPairs(map: Map<string, number>, limit: number): TelemetryPair[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 8;
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, safeLimit)
      .map(([key, count]) => ({ key, count }));
  }

  public static record(event: unknown, payload?: Record<string, unknown> | null): void {
    const eventName = BotRuntimeTelemetry.normalizeKey(event);
    if (!TRACKED_EVENTS.has(eventName)) {
      return;
    }
    const sampleStride = EVENT_SAMPLE_STRIDE.get(eventName) ?? 1;
    if (sampleStride > 1) {
      const sampleCounter =
        (BotRuntimeTelemetry.sampledEventCounters.get(eventName) ?? 0) + 1;
      BotRuntimeTelemetry.sampledEventCounters.set(eventName, sampleCounter);
      if (sampleCounter % sampleStride !== 0) {
        return;
      }
    }
    const bucket = BotRuntimeTelemetry.intervalBucket;
    bucket.totalEvents += 1;
    BotRuntimeTelemetry.incrementWithCap(
      bucket.eventCounts,
      eventName,
      BotRuntimeTelemetry.MAX_EVENT_KEYS
    );

    if (TRACK_REASON_EVENTS.has(eventName)) {
      const reason = BotRuntimeTelemetry.normalizeKey(
        payload?.reason ?? payload?.phase ?? payload?.error
      );
      BotRuntimeTelemetry.incrementWithCap(
        bucket.reasonCounts,
        `${eventName}:${reason}`,
        BotRuntimeTelemetry.MAX_REASON_KEYS
      );
    }

    if (TRACK_USER_EVENTS.has(eventName)) {
      const username = BotRuntimeTelemetry.normalizeKey(payload?.username);
      BotRuntimeTelemetry.incrementWithCap(
        bucket.userCounts,
        `${eventName}:${username}`,
        BotRuntimeTelemetry.MAX_USER_KEYS
      );
    }
  }

  public static getIntervalSnapshot(limit = 8): TelemetrySnapshot {
    const nowMs = Date.now();
    const bucket = BotRuntimeTelemetry.intervalBucket;
    return {
      windowStartedAt: new Date(bucket.startedAt).toISOString(),
      windowMs: Math.max(0, nowMs - bucket.startedAt),
      totalEvents: bucket.totalEvents,
      topEvents: BotRuntimeTelemetry.topPairs(bucket.eventCounts, limit),
      topReasons: BotRuntimeTelemetry.topPairs(bucket.reasonCounts, limit),
      topUsers: BotRuntimeTelemetry.topPairs(bucket.userCounts, limit),
    };
  }

  public static flushIntervalSnapshot(limit = 8): TelemetrySnapshot {
    const snapshot = BotRuntimeTelemetry.getIntervalSnapshot(limit);
    BotRuntimeTelemetry.intervalBucket = BotRuntimeTelemetry.createBucket(Date.now());
    return snapshot;
  }
}
