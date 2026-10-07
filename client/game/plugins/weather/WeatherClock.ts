// Ported to TypeScript from ScreteMonge/3D-Weather (BSD-2-Clause).
const JAGEX_TIME_ZONE = "Europe/London";

const PARTS_FORMAT = new Intl.DateTimeFormat("en-GB", {
    timeZone: JAGEX_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
});

export interface JagexTime {
    /** Day of the year, as RuneLite's `DDD` format field. */
    days: number;
    hours: number;
    minutes: number;
}

/** `CyclesClock.getTimeDays/Hours/Minutes` in one call. */
export function jagexTime(now: Date = new Date()): JagexTime {
    const parts: Record<string, number> = {};
    for (const part of PARTS_FORMAT.formatToParts(now)) {
        if (part.type !== "literal") parts[part.type] = Number(part.value);
    }
    const year = parts.year | 0;
    const month = parts.month | 0;
    const day = parts.day | 0;
    const days = Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
    return { days, hours: parts.hour | 0, minutes: parts.minute | 0 };
}

/** Twelve 15-minute segments per day, as `syncWeather` computes. */
export function cycleSegment(now: Date = new Date()): number {
    const { hours, minutes } = jagexTime(now);
    return Math.floor((hours * 60 + minutes) / 15) % 12;
}
