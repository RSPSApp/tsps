"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ByteBuffer = void 0;
const FloatUtil_1 = require("../../common/utils/FloatUtil");
class ByteBuffer {
    constructor(dataOrSize) {
        this.offset = 0;
        if (dataOrSize instanceof Int8Array) {
            this._data = dataOrSize;
        } else if (dataOrSize instanceof ArrayBuffer) {
            this._data = new Int8Array(dataOrSize);
        } else {
            this._data = new Int8Array(dataOrSize);
        }
    }
    readByte() {
        if (this.offset > this._data.length - 1) {
            throw new Error("Buffer overflow");
        }
        return this._data[this.offset++];
    }
    readUnsignedByte() {
        return this.readByte() & 0xff;
    }
    readShort() {
        return (((this.readUnsignedByte() << 8) | this.readUnsignedByte()) << 16) >> 16;
    }
    readUnsignedShort() {
        return this.readShort() & 0xffff;
    }
    // cg2
    readSignedShort() {
        const v = this.readUnsignedShort();
        if (v > 32767) {
            return v - 0x10000;
        }
        return v;
    }
    readMedium() {
        return (
            (this.readUnsignedByte() << 16) |
            (this.readUnsignedByte() << 8) |
            this.readUnsignedByte()
        );
    }
    readUnsignedMedium() {
        return this.readMedium() & 0xffffff;
    }
    /** A signed 24-bit value (g3s): 0xFFFFFF reads as -1. */
    readSignedMedium() {
        return (this.readMedium() << 8) >> 8;
    }
    readInt() {
        return (
            (this.readUnsignedByte() << 24) |
            (this.readUnsignedByte() << 16) |
            (this.readUnsignedByte() << 8) |
            this.readUnsignedByte()
        );
    }
    readFloat() {
        return FloatUtil_1.FloatUtil.intBitsToFloat(this.readInt());
    }
    readBigSmart() {
        if (this.getByte(this.offset) < 0) {
            return this.readInt() & 0x7fffffff;
        } else {
            const v = this.readUnsignedShort();
            if (v === 32767) {
                return -1;
            }
            return v;
        }
    }
    readUnsignedSmart() {
        if (this.getUnsignedByte(this.offset) < 128) {
            return this.readUnsignedByte();
        } else {
            return this.readUnsignedShort() - 0x8000;
        }
    }
    readUnsignedSmartMin1() {
        if (this.getUnsignedByte(this.offset) < 128) {
            return this.readUnsignedByte() - 1;
        } else {
            return this.readUnsignedShort() - 0x8001;
        }
    }
    readSmart2() {
        if (this.getByte(this.offset) >= 0) {
            return this.readUnsignedByte() - 64;
        } else {
            return this.readUnsignedShort() - 49152;
        }
    }
    readSmart3() {
        let i = 0;
        let i_33_ = this.readUnsignedSmart();
        while (i_33_ === 32767) {
            i_33_ = this.readUnsignedSmart();
            i += 32767;
        }
        i += i_33_;
        return i;
    }
    readUnsignedShortSmart() {
        const peek = this.getUnsignedByte(this.offset);
        if (peek < 128) {
            return this.readUnsignedByte();
        }
        return this.readUnsignedShort() - 0x8000;
    }
    readUnsignedShortSmartMinusOne() {
        const peek = this.getUnsignedByte(this.offset);
        if (peek < 128) {
            return this.readUnsignedByte() - 1;
        }
        return this.readUnsignedShort() - 0x8001;
    }
    readVarInt() {
        let value = 0;
        while (true) {
            const b = this.readUnsignedByte();
            if (b & 0x80) {
                value = (value | (b & 0x7f)) << 7;
            } else {
                return value | b;
            }
        }
    }
    readVarInt2() {
        let value = 0;
        let shift = 0;
        while (true) {
            const b = this.readUnsignedByte();
            value |= (b & 0x7f) << shift;
            if (b <= 0x7f) {
                break;
            }
            shift += 7;
        }
        return value;
    }
    readString(endValue = 0) {
        let str = "";
        while (this.getByte(this.offset) !== endValue) {
            str += String.fromCharCode(this.readUnsignedByte());
        }
        this.readByte();
        return str;
    }
    peek(offsetDelta = 0) {
        return this.getUnsignedByte(this.offset + offsetDelta);
    }
    readNullString() {
        if (this.getByte(this.offset) === 0) {
            this.offset++;
            return undefined;
        } else {
            return this.readString();
        }
    }
    readVerString() {
        if (this.readByte() !== 0) {
            return undefined;
        }
        return this.readString();
    }
    getByte(offset) {
        return this._data[offset];
    }
    getUnsignedByte(offset) {
        return this.getByte(offset) & 0xff;
    }
    getShort(offset) {
        return (this.getUnsignedByte(offset) << 8) | this.getUnsignedByte(offset + 1);
    }
    getUnsignedShort(offset) {
        return this.getShort(offset) & 0xffff;
    }
    getInt(offset) {
        return (
            (this.getUnsignedByte(offset) << 24) |
            (this.getUnsignedByte(offset + 1) << 16) |
            (this.getUnsignedByte(offset + 2) << 8) |
            this.getUnsignedByte(offset + 3)
        );
    }
    readBytes(amount) {
        const bytes = this._data.subarray(this.offset, this.offset + amount);
        this.offset += amount;
        return bytes;
    }
    readUnsignedBytes(amount) {
        const bytes = new Uint8Array(this._data.buffer, this._data.byteOffset, this._data.byteLength).subarray(this.offset, this.offset + amount);
        this.offset += amount;
        return bytes;
    }
    writeBytes(bytes) {
        this._data.set(bytes, this.offset);
        this.offset += bytes.length;
    }
    writeInt(v) {
        this._data[this.offset++] = v >> 24;
        this._data[this.offset++] = v >> 16;
        this._data[this.offset++] = v >> 8;
        this._data[this.offset++] = v;
    }
    setInt(offset, v) {
        this._data[offset++] = v >> 24;
        this._data[offset++] = v >> 16;
        this._data[offset++] = v >> 8;
        this._data[offset++] = v;
    }
    get length() {
        return this._data.length;
    }
    get remaining() {
        return this.length - this.offset;
    }
    get data() {
        return this._data;
    }
}
exports.ByteBuffer = ByteBuffer;
