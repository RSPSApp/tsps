import { EVENT_CLASSES, type EventClass, type EventInstance } from "../../api/events";

export type EventHandler<E> = (event: E) => void;

type HandlerEntry = {
    handler: EventHandler<unknown>;
    priority: number;
    subscriber: object | undefined;
};

/**
 * RuneLite-shaped event bus.
 *
 * Subscribers register with object instances and expose handlers named
 * `on<EventName>` (RuneLite's `@Subscribe` convention). Priorities come from an
 * optional `static subscribe = { onGameTick: { priority: 5 } }` map; higher
 * runs first, as in RuneLite.
 */
export class EventBus {
    private readonly handlers = new Map<EventClass, HandlerEntry[]>();
    private profiling = false;
    private readonly timings = new Map<string, number>();

    register(subscriber: object): void {
        let prototype: object | null = subscriber;
        while (prototype && prototype !== Object.prototype) {
            for (const name of Object.getOwnPropertyNames(prototype)) {
                if (!name.startsWith("on") || name === "on") continue;
                const eventName = name.slice(2);
                const EventCtor = EVENT_CLASSES[eventName];
                if (!EventCtor) continue;
                const handler = (subscriber as Record<string, unknown>)[name];
                if (typeof handler !== "function") continue;
                const priority = this.priorityOf(subscriber, name);
                this.add(EventCtor, {
                    handler: handler.bind(subscriber) as EventHandler<unknown>,
                    priority,
                    subscriber,
                });
            }
            prototype = Object.getPrototypeOf(prototype);
        }
    }

    unregister(subscriber: object): void {
        for (const [eventClass, entries] of this.handlers) {
            const remaining = entries.filter((entry) => entry.subscriber !== subscriber);
            if (remaining.length === 0) this.handlers.delete(eventClass);
            else this.handlers.set(eventClass, remaining);
        }
    }

    /** For non-plugin code. Returns an unsubscribe function. */
    subscribe<E extends EventInstance>(
        eventClass: EventClass<E>,
        handler: EventHandler<E>,
        priority = 0,
    ): () => void {
        const entry: HandlerEntry = {
            handler: handler as EventHandler<unknown>,
            priority,
            subscriber: undefined,
        };
        this.add(eventClass as EventClass, entry);
        return () => {
            const entries = this.handlers.get(eventClass as EventClass);
            if (!entries) return;
            const index = entries.indexOf(entry);
            if (index >= 0) entries.splice(index, 1);
        };
    }

    post<E extends EventInstance>(event: E): void {
        const entries = this.handlers.get(event.constructor as EventClass);
        if (!entries || entries.length === 0) return;
        for (const entry of entries.slice()) {
            const start = this.profiling ? performance.now() : 0;
            try {
                entry.handler(event);
            } catch (error) {
                const name =
                    entry.subscriber && entry.subscriber.constructor
                        ? entry.subscriber.constructor.name
                        : "subscriber";
                console.error(`[EventBus] ${name} threw handling ${(event as object).constructor.name}`, error);
            }
            if (this.profiling) {
                const key = (event as object).constructor.name;
                this.timings.set(key, (this.timings.get(key) ?? 0) + (performance.now() - start));
            }
        }
    }

    /** True when at least one subscriber handles the event class. */
    hasSubscribers(eventClass: EventClass): boolean {
        const entries = this.handlers.get(eventClass);
        return entries !== undefined && entries.length > 0;
    }

    getTimings(): ReadonlyMap<string, number> {
        return this.timings;
    }

    setProfiling(enabled: boolean): void {
        this.profiling = enabled;
        if (!enabled) this.timings.clear();
    }

    private add(eventClass: EventClass, entry: HandlerEntry): void {
        const entries = this.handlers.get(eventClass);
        if (!entries) {
            this.handlers.set(eventClass, [entry]);
            return;
        }
        entries.push(entry);
        entries.sort((a, b) => b.priority - a.priority);
    }

    private priorityOf(subscriber: object, methodName: string): number {
        const config = (subscriber.constructor as { subscribe?: Record<string, { priority?: number }> })
            .subscribe;
        const priority = config?.[methodName]?.priority;
        return typeof priority === "number" ? priority : 0;
    }
}
