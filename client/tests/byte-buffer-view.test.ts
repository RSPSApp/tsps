import assert from "node:assert/strict";
import { test } from "node:test";

import { ByteBuffer } from "../rs/io/ByteBuffer";

test("signed bulk reads retain the input view and advance the cursor", () => {
    const backing = new Int8Array([10, 20, -30, 40, 50]);
    const buffer = new ByteBuffer(backing.subarray(1, 4));
    buffer.offset = 1;

    const bytes = buffer.readBytes(2);
    assert.deepEqual(Array.from(bytes), [-30, 40]);
    assert.equal(buffer.offset, 3);
    assert.equal(buffer.remaining, 0);
    assert.equal(bytes.buffer, backing.buffer);
    bytes[0] = 31;
    assert.equal(backing[2], 31);
});

test("unsigned bulk reads work with a zero-offset view", () => {
    const backing = new Int8Array([10, -30, 40]);
    const buffer = new ByteBuffer(backing);
    buffer.offset = 1;

    const bytes = buffer.readUnsignedBytes(2);
    assert.deepEqual(Array.from(bytes), [226, 40]);
    assert.equal(buffer.offset, 3);
    assert.equal(buffer.remaining, 0);
    assert.equal(bytes.buffer, backing.buffer);
    bytes[0] = 31;
    assert.equal(backing[1], 31);
});

for (const kind of ["signed", "unsigned"] as const) {
    test(`unsigned bulk reads respect a ${kind} input subview`, () => {
        const backing = new Uint8Array([10, 20, 226, 40, 50]);
        const buffer = kind === "signed"
            ? new ByteBuffer(new Int8Array(backing.buffer, 1, 3))
            : new ByteBuffer(backing.subarray(1, 4));
        buffer.offset = 1;

        const bytes = buffer.readUnsignedBytes(2);
        assert.deepEqual(Array.from(bytes), [226, 40]);
        assert.equal(buffer.offset, 3);
        assert.equal(buffer.remaining, 0);
        assert.equal(bytes.buffer, backing.buffer);
        bytes[0] = 31;
        assert.equal(backing[2], 31);
    });
}

test("readSignedMedium reads a signed 24-bit value (loc opcodes 97/98)", () => {
    const buffer = new ByteBuffer(new Int8Array([-1, -1, -1, 0x00, 0x24, 0x1b, -128, 0, 0]));
    assert.equal(buffer.readSignedMedium(), -1);
    assert.equal(buffer.readSignedMedium(), 0x241b);
    assert.equal(buffer.readSignedMedium(), -0x800000);
    assert.equal(buffer.offset, 9);
});
