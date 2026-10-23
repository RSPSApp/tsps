import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { WorkerJs5Coordinator } from "../rs/cache/js5/Js5Coordinator";

type MessageHandler = ((event: MessageEvent<unknown>) => void) | null;

class FakeBroadcastChannel {
    static readonly channels = new Map<string, FakeBroadcastChannel[]>();
    onmessage: MessageHandler = null;

    constructor(readonly name: string) {
        const channels = FakeBroadcastChannel.channels.get(name) ?? [];
        channels.push(this);
        FakeBroadcastChannel.channels.set(name, channels);
    }

    postMessage(data: unknown): void {
        for (const channel of FakeBroadcastChannel.channels.get(this.name) ?? []) {
            if (channel !== this) channel.onmessage?.({ data } as MessageEvent<unknown>);
        }
    }

    close(): void {}
}

const realBroadcastChannel = globalThis.BroadcastChannel;
beforeEach(() => {
    (globalThis as { BroadcastChannel: typeof BroadcastChannel }).BroadcastChannel =
        FakeBroadcastChannel as unknown as typeof BroadcastChannel;
});
afterEach(() => {
    (globalThis as { BroadcastChannel: typeof BroadcastChannel }).BroadcastChannel = realBroadcastChannel;
    FakeBroadcastChannel.channels.clear();
});

test("worker coordinator resolves a completed cache group when its chunk arrives late", async () => {
    let present = false;
    const store = { isGroupPresent: () => present, onMiss: undefined } as any;
    const main = new BroadcastChannel("test-js5");
    main.onmessage = ({ data }: MessageEvent<any>) => {
        assert.equal(data.type, "request");
        main.postMessage({ type: "complete", indexId: data.indexId, archiveId: data.archiveId });
    };
    const coordinator = new WorkerJs5Coordinator(store, "test-js5");
    const request = coordinator.requestGroup(7, 123);
    present = true;
    coordinator.recheck();
    await request;
    assert.equal(present, true);
});

test("worker coordinator expires a lost reply so the next request can recover", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let present = false, requests = 0;
    const store = { isGroupPresent: () => present, onMiss: undefined } as any;
    const main = new BroadcastChannel("retry-js5");
    main.onmessage = ({ data }: MessageEvent<any>) => {
        if (++requests === 1) return;
        present = true;
        main.postMessage({ type: "complete", indexId: data.indexId, archiveId: data.archiveId });
    };
    const coordinator = new WorkerJs5Coordinator(store, "retry-js5");
    const first = coordinator.requestGroup(7, 123);
    assert.equal(coordinator.requestGroup(7, 123), first, "requests share the pending download");
    let timedOut = false;
    void first.catch(() => { timedOut = true; });
    const expired = assert.rejects(first, /timed out/);
    t.mock.timers.tick(30000);
    await Promise.resolve();
    assert.equal(timedOut, true, "a lost reply must release the pending request at its deadline");
    await expired;
    const retry = coordinator.requestGroup(7, 123);
    assert.notEqual(retry, first, "an expired promise must not poison later scene retries");
    await retry;
    assert.equal(requests, 2, "the retry must send a new request to the main thread");
    assert.equal(present, true);
    present = false;
    main.onmessage = () => { requests++; };
    const lostReply = coordinator.requestGroup(7, 124);
    present = true;
    t.mock.timers.tick(30000);
    await lostReply;
    assert.equal(requests, 3, "readable data needs no retry when only its completion reply was lost");
    await coordinator.settled();
});
