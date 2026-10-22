export type ClientLogLevel = "debug" | "log" | "info" | "warn" | "error";

/** One console line, as a bug report sends it. */
export type ClientLogEntry = { time: number; level: ClientLogLevel; text: string };

const LEVELS: readonly ClientLogLevel[] = ["debug", "log", "info", "warn", "error"];

/** How far back a report's logs reach. */
export const LOG_WINDOW_MS = 5 * 60_000;
const MAX_ENTRY_CHARS = 2000;
const MAX_ITEMS = 20;
const MAX_DEPTH = 2;

export type LogLimits = { entries: number; chars: number };

/**
 * The client logs every widget event, so ordinary lines can fill any budget within a minute:
 * warnings and errors get one of their own, and no stream of chatter pushes them out.
 */
const CHATTER_LIMITS: LogLimits = { entries: 3000, chars: 500_000 };
const ALERT_LIMITS: LogLimits = { entries: 1000, chars: 250_000 };

/**
 * Console lines that carry what the player typed, up to where the text starts: chat, friends
 * chat and ::commands (sendChat logs each one twice), and what goes into a name or text dialog.
 * A report keeps the line, so it still shows that a message went, but not what it said.
 */
const TYPED_TEXT: readonly RegExp[] = [
    /^\[sendChat\] [^"]*(?=")/,
    /^\[InputDialog\] (?:Name|String) dialog submitted: (?=")/,
    /^\[InputDialog\] Complete: type=(?:name|obj|string), value=/,
];

/** A console line with anything the player typed left out. */
export function withoutTypedText(text: string): string {
    for (const pattern of TYPED_TEXT) {
        const kept = pattern.exec(text)?.[0];
        if (kept !== undefined) return `${kept}(text left out)`;
    }
    return text;
}

/** Lines of one kind, oldest first, within a count and a character budget. */
class LogQueue {
    private entries: ClientLogEntry[] = [];
    private first = 0;
    private chars = 0;

    constructor(private readonly limits: LogLimits) {}

    push(entry: ClientLogEntry): void {
        this.entries.push(entry);
        this.chars += entry.text.length;
        while (this.size() > this.limits.entries || this.chars > this.limits.chars) this.drop();
    }

    prune(cutoff: number): void {
        while (this.size() > 0 && this.entries[this.first].time < cutoff) this.drop();
        if (this.first > 256 && this.first * 2 > this.entries.length) {
            this.entries = this.entries.slice(this.first);
            this.first = 0;
        }
    }

    live(): ClientLogEntry[] {
        return this.entries.slice(this.first);
    }

    private size(): number {
        return this.entries.length - this.first;
    }

    private drop(): void {
        this.chars -= this.entries[this.first].text.length;
        this.first++;
    }
}

/**
 * The client's console over the last five minutes. Each line becomes text when it's logged, at
 * most 2,000 characters, so the buffer holds no game objects and costs no more than the line.
 * What the player typed is left out then, so the buffer never holds it.
 */
export class ClientLogBuffer {
    private readonly chatter: LogQueue;
    private readonly alerts: LogQueue;

    constructor(
        private readonly now: () => number = Date.now,
        private readonly windowMs = LOG_WINDOW_MS,
        chatterLimits = CHATTER_LIMITS,
        alertLimits = ALERT_LIMITS,
    ) {
        this.chatter = new LogQueue(chatterLimits);
        this.alerts = new LogQueue(alertLimits);
    }

    add(level: ClientLogLevel, args: readonly unknown[]): void {
        const queue = level === "warn" || level === "error" ? this.alerts : this.chatter;
        queue.push({ time: this.now(), level, text: withoutTypedText(formatLogArgs(args)) });
        queue.prune(this.now() - this.windowMs);
    }

    /** The lines from the last five minutes, oldest first. */
    recent(): ClientLogEntry[] {
        const cutoff = this.now() - this.windowMs;
        this.chatter.prune(cutoff);
        this.alerts.prune(cutoff);
        return [...this.chatter.live(), ...this.alerts.live()].sort((a, b) => a.time - b.time);
    }
}

type ConsoleLike = Record<ClientLogLevel, (...args: unknown[]) => void>;

/**
 * Copies every console line, uncaught error and unhandled rejection into `buffer`; the console
 * itself is unchanged. Returns the function that puts the console back.
 */
export function captureConsole(
    buffer: ClientLogBuffer,
    target: ConsoleLike = console as unknown as ConsoleLike,
    events: Pick<EventTarget, "addEventListener" | "removeEventListener"> | undefined =
        typeof window === "undefined" ? undefined : window,
): () => void {
    const wrappers = new Map<ClientLogLevel, { original: (...args: unknown[]) => void; wrapper: (...args: unknown[]) => void }>();
    for (const level of LEVELS) {
        const original = target[level];
        if (typeof original !== "function") continue;
        const wrapper = function (this: unknown, ...args: unknown[]): void {
            try {
                buffer.add(level, args);
            } catch {}
            original.apply(this, args);
        };
        target[level] = wrapper;
        wrappers.set(level, { original, wrapper });
    }
    const onError = (event: Event): void => {
        const error = event as ErrorEvent;
        buffer.add("error", ["Uncaught", error.error ?? error.message]);
    };
    const onRejection = (event: Event): void => {
        buffer.add("error", ["Unhandled rejection", (event as PromiseRejectionEvent).reason]);
    };
    events?.addEventListener("error", onError);
    events?.addEventListener("unhandledrejection", onRejection);
    return () => {
        for (const [level, { original, wrapper }] of wrappers) {
            if (target[level] === wrapper) target[level] = original;
        }
        events?.removeEventListener("error", onError);
        events?.removeEventListener("unhandledrejection", onRejection);
    };
}

/** A console call's arguments as one line: `%c` styles dropped, objects shortened. */
export function formatLogArgs(args: readonly unknown[]): string {
    let rest = args;
    let head = "";
    if (typeof args[0] === "string" && args[0].includes("%c")) {
        const styles = args[0].split("%c").length - 1;
        head = args[0].replace(/%c/g, "");
        rest = args.slice(1 + styles);
        if (rest.length === 0) return truncate(head);
    }
    const parts = rest.map((value) => describe(value, 0));
    return truncate(head ? `${head} ${parts.join(" ")}` : parts.join(" "));
}

function truncate(text: string): string {
    return text.length > MAX_ENTRY_CHARS ? `${text.slice(0, MAX_ENTRY_CHARS - 1)}…` : text;
}

function describe(value: unknown, depth: number): string {
    try {
        if (typeof value === "string") return depth === 0 ? value : JSON.stringify(shorten(value));
        if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
        if (value === null || typeof value !== "object") return String(value);
        if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
        const name = Object.prototype.toString.call(value).slice(8, -1);
        if (ArrayBuffer.isView(value)) return `${name}(${(value as unknown as ArrayLike<unknown>).length ?? value.byteLength})`;
        if (value instanceof Map || value instanceof Set) return `${name}(${value.size})`;
        if (Array.isArray(value)) {
            if (depth >= MAX_DEPTH) return `Array(${value.length})`;
            const items = value.slice(0, MAX_ITEMS).map((item) => describe(item, depth + 1));
            if (value.length > MAX_ITEMS) items.push(`… ${value.length - MAX_ITEMS} more`);
            return `[${items.join(", ")}]`;
        }
        if (depth >= MAX_DEPTH) return `{${name}}`;
        const keys = Object.keys(value);
        const fields = keys
            .slice(0, MAX_ITEMS)
            .map((key) => `${key}: ${describe((value as Record<string, unknown>)[key], depth + 1)}`);
        if (keys.length > MAX_ITEMS) fields.push(`… ${keys.length - MAX_ITEMS} more`);
        const constructorName = (value as { constructor?: { name?: string } }).constructor?.name;
        const prefix = constructorName && constructorName !== "Object" ? `${constructorName} ` : "";
        return `${prefix}{${fields.join(", ")}}`;
    } catch {
        return "[unreadable]";
    }
}

function shorten(text: string): string {
    return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}
