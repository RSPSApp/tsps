import { strict as assert } from "node:assert";

import { ConfigChanged, GameTick } from "@runelite/api/events";
import { EventBus } from "@runelite/client/eventbus/EventBus";

const bus = new EventBus();
const order: string[] = [];

class HighPriority {
    static subscribe = { onGameTick: { priority: 5 } };
    onGameTick(_event: GameTick): void {
        order.push("high");
    }
}

class Throwing {
    onGameTick(): void {
        order.push("throwing");
        throw new Error("boom");
    }
}

class Other {
    onGameTick(): void {
        order.push("other");
    }
    onConfigChanged(event: ConfigChanged): void {
        order.push(`config:${event.getGroup()}.${event.getKey()}`);
    }
}

const other = new Other();
bus.register(new Throwing());
bus.register(other);
bus.register(new HighPriority());
bus.post(new GameTick());
assert.deepEqual(order, ["high", "throwing", "other"], "priority first; one throwing subscriber is isolated");

order.length = 0;
bus.post(new ConfigChanged("grounditems", "highlightedItems", undefined, "[]"));
assert.deepEqual(order, ["config:grounditems.highlightedItems"]);

order.length = 0;
const unsubscribe = bus.subscribe(GameTick, () => order.push("sub"), -1);
bus.post(new GameTick());
assert.equal(order[order.length - 1], "sub");
unsubscribe();
order.length = 0;
bus.post(new GameTick());
assert.ok(!order.includes("sub"), "subscribe() returns an unsubscribe function");

const second = new Other();
order.length = 0;
bus.register(second);
bus.unregister(second);
bus.unregister(other);
bus.post(new ConfigChanged("g", "k", "1", "2"));
assert.deepEqual(order, [], "unregister removes every handler");

assert.equal(bus.hasSubscribers(GameTick), true);
assert.equal(bus.hasSubscribers(ConfigChanged), false);

console.log("runelite event bus tests passed");
