import assert from "node:assert/strict";
import { test } from "node:test";
import {randomBytes} from 'node:crypto';
import * as pako from 'pako';
import { encodeChunkedPluginMessage, ChunkedPluginMessageAssembler } from "../common/network/ChunkedPluginMessages";
const noise=()=>randomBytes(30000).toString('base64');

test("small messages remain compatible with the existing plugin codec", () => {
    const data = { type: "catalog", protocol: 1, session: "account-1" };
    assert.deepEqual(encodeChunkedPluginMessage(data), [data]);
    assert.deepEqual(new ChunkedPluginMessageAssembler("account-1").accept(data), data);
});

test("large Unicode snapshots round-trip out of order within the packet limit", () => {
    const data = { type: "evaluate", protocol: 1, session: "account-1", text: "雪🌟\"\n".repeat(9000),noise:noise() };
    const frames = encodeChunkedPluginMessage(data);
    assert.ok(frames.length > 1);
    for (const frame of frames) assert.ok(new TextEncoder().encode(JSON.stringify({ channel: "quest-helper", data: frame })).length <= 16384);
    const receiver = new ChunkedPluginMessageAssembler("account-1");
    let result: Record<string, unknown> | null = null;
    for (const frame of [...frames].reverse()) result = receiver.accept(frame, 1);
    assert.deepEqual(result, data);
});

test("duplicates are idempotent but conflicting chunks are rejected", () => {
    const frames = encodeChunkedPluginMessage({ session: "a", text: noise() });
    const receiver = new ChunkedPluginMessageAssembler("a");
    assert.equal(receiver.accept(frames[0], 1), null);
    assert.equal(receiver.accept(frames[0], 2), null);
    assert.throws(() => receiver.accept({ ...frames[0], payload: "AAAA" }, 3));
});

test("foreign sessions and malformed envelopes cannot contaminate assemblies", () => {
    const frames = encodeChunkedPluginMessage({ session: "a", text: noise() });
    const receiver = new ChunkedPluginMessageAssembler("a");
    receiver.accept(frames[0], 0);
    assert.throws(() => receiver.accept({ ...frames[1], session: "b" }, 1));
    assert.throws(() => receiver.accept({ ...frames[1], index: -1 }, 1));
    assert.throws(() => receiver.accept({ ...frames[1], total: 65 }, 1));
    assert.throws(() => receiver.accept({ ...frames[1], payload: "%invalid" }, 1));
});

test("bounds apply before encoding and after reassembly", () => {
    assert.throws(() => encodeChunkedPluginMessage({ session: "a", text: "x".repeat(4*1024*1024) }));
    const bomb=Buffer.from(pako.deflate(new Uint8Array(4*1024*1024+1))).toString('base64');
    assert.throws(()=>new ChunkedPluginMessageAssembler('a').accept({type:'chunk',protocol:1,session:'a',id:'bomb',index:0,total:1,encoding:'deflate-base64-json',payload:bomb}),/limit/);
    const receiver = new ChunkedPluginMessageAssembler("a");
    assert.throws(() => receiver.accept({ type: "chunk", protocol: 1, session: "a", id: "id", index: 0, total: 1, encoding: "base64-json", payload: "A".repeat(12001) }));
});

test("expired and explicitly cleared assemblies release their session state", () => {
    const first = encodeChunkedPluginMessage({ session: "a", text: noise() });
    const second = encodeChunkedPluginMessage({ session: "a", text: noise() });
    const receiver = new ChunkedPluginMessageAssembler("a");
    receiver.accept(first[0], 0);
    assert.throws(() => receiver.accept(second[0], 1));
    assert.equal(receiver.accept(second[0], 10001), null);
    receiver.clear();
    assert.equal(receiver.accept(first[0], 10002), null);
});
