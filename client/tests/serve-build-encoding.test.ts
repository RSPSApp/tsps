import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import zlib from "node:zlib";

const DEADLINE_MS = 3_000;
const OUTPUT_LIMIT = 65_536;
const BODY_LIMIT = 32_768;

function bounded<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label}: timeout`)), ms);
        }),
    ]).finally(() => clearTimeout(timer));
}

function start(script: string, cwd: string, args: string[], port: number, signal: AbortSignal) {
    const child = spawn(process.execPath, [script, ...args], {
        cwd,
        env: { HOST: "127.0.0.1", PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
        signal,
    });
    let output = "";
    const streams = { stdout: "", stderr: "" };
    let fault: Error | undefined;
    let readyResolve: () => void;
    let readyReject: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
    });
    // Install handlers before examining readiness; keep the close promise for teardown.
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.once("error", (error) => {
            fault = error;
            readyReject(error);
        });
        child.once("exit", () => readyReject(new Error(`server exited before readiness: ${output}`)));
        child.once("close", (code, signal) => {
            console.log(JSON.stringify({ observation: "child-close", pid: child.pid, args, code, signal, streams }));
            resolve({ code, signal });
        });
    });
    // Precompress has no readiness consumer, but its errors are still checked below.
    void ready.catch(() => {});
    const marker = `[serve-build] serving ${path.resolve(cwd, "build")} on http://127.0.0.1:${port}`;
    const collect = (stream: "stdout" | "stderr", chunk: Buffer) => {
        if (fault) return;
        if (Buffer.byteLength(output) + chunk.length > OUTPUT_LIMIT) {
            fault = new Error("child output limit exceeded");
            readyReject(fault);
            child.kill("SIGTERM");
            return;
        }
        output += chunk.toString("utf8");
        streams[stream] += chunk.toString("utf8");
        if (stream === "stdout" && streams.stdout.split(/\r?\n/).includes(marker)) {
            console.log(JSON.stringify({ observation: "own-listen", pid: child.pid, address: `127.0.0.1:${port}`, root: cwd }));
            readyResolve();
        }
    };
    child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
    return { child, closed, ready, output: () => output, fault: () => fault };
}

async function stop(run: ReturnType<typeof start>) {
    const child: ChildProcess = run.child;
    if (child.pid && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    try {
        return await bounded(run.closed, 3_000, "child close");
    } catch {
        if (child.pid && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        return await bounded(run.closed, 3_000, "child close after SIGKILL");
    }
}

async function reservePort(signal: AbortSignal): Promise<number> {
    const lease = net.createServer();
    let cancelled = false;
    const closed = new Promise<void>((resolve) => lease.once("close", resolve));
    const listening = new Promise<void>((resolve, reject) => {
        lease.once("error", reject);
        lease.once("listening", () => {
            if (cancelled) lease.close();
            resolve();
        });
    });
    try {
        lease.listen({ port: 0, host: "127.0.0.1", signal });
        await bounded(listening, DEADLINE_MS, "port lease");
        const address = lease.address();
        assert.ok(address && typeof address !== "string" && address.port > 0);
        return address.port;
    } finally {
        cancelled = true;
        // Close even if listen is pending; the listening handler also guards that race.
        lease.close();
        await bounded(closed, DEADLINE_MS, "port lease close");
        console.log(JSON.stringify({ observation: "port-lease-closed", listening: lease.listening }));
        assert.equal(lease.listening, false);
    }
}

async function request(port: number, method: "GET" | "HEAD", encoding: string, signal: AbortSignal) {
    const req = http.request({
            hostname: "127.0.0.1", port, method, path: "/asset.txt", agent: false,
            headers: { "Accept-Encoding": encoding, Connection: "close" },
            signal,
        });
    const requestClosed = new Promise<void>((resolve) => req.once("close", resolve));
    let socketClosed = Promise.resolve();
    req.once("socket", (socket) => {
        socketClosed = new Promise<void>((resolve) => socket.once("close", resolve));
    });
    let responseClosed = Promise.resolve();
    let response: http.IncomingMessage | undefined;
    let primary: unknown;
    try {
        return await new Promise<{ status: number | undefined; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
        const timer = setTimeout(() => req.destroy(new Error("request deadline")), DEADLINE_MS);
        const fail = (error: Error) => {
            clearTimeout(timer);
            req.destroy();
            reject(error);
        };
        req.once("error", fail);
        req.once("response", (res) => {
            response = res;
            responseClosed = new Promise<void>((resolve) => res.once("close", resolve));
            const chunks: Buffer[] = [];
            let size = 0;
            res.once("error", fail);
            res.once("aborted", () => fail(new Error("response aborted")));
            res.once("close", () => {
                if (!res.complete) fail(new Error("response closed before completion"));
            });
            res.on("data", (chunk: Buffer) => {
                size += chunk.length;
                if (size > BODY_LIMIT) {
                    res.destroy(new Error("response body limit exceeded"));
                    fail(new Error("response body limit exceeded"));
                } else chunks.push(chunk);
            });
            res.once("end", () => {
                clearTimeout(timer);
                resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
            });
        });
        req.end();
        });
    } catch (error) {
        primary = error;
        throw error;
    } finally {
        response?.destroy();
        req.destroy();
        try {
            await bounded(Promise.all([requestClosed, responseClosed, socketClosed]), DEADLINE_MS, "request/response/socket close");
        } catch (error) {
            throw new AggregateError(primary ? [primary, error] : [error], "request closure failed");
        }
    }
}

test("production static server negotiates optional compressed representations", { timeout: 120_000 }, async (t) => {
    // Resolve from this test, not the invoking shell's cwd. Do not import the entrypoint.
    const source = fs.readFileSync(path.resolve(__dirname, "../scripts/serve-build.mjs"));
    const fixtureParent = process.env.TSPS_STATIC_FIXTURE_ROOT ?? os.tmpdir();
    assert.ok(path.isAbsolute(fixtureParent), "fixture parent must be an absolute owned path");
    const parentStat = fs.lstatSync(fixtureParent);
    assert.ok(parentStat.isDirectory() && !parentStat.isSymbolicLink(), "fixture parent must be a regular owned directory");
    const temporary = fs.mkdtempSync(path.join(fixtureParent, "serve-build-encoding-"));
    console.log(JSON.stringify({ observation: "fixture-root-created", parent: fixtureParent, root: temporary }));
    const client = path.join(temporary, "client");
    const script = path.join(client, "scripts/serve-build.mjs");
    const build = path.join(client, "build");
    const original = Buffer.from("static representation negotiation control\n".repeat(64));
    let producer: ReturnType<typeof start> | undefined;
    let server: ReturnType<typeof start> | undefined;
    let primary: unknown;
    let generatedBefore: unknown;
    const generatedManifest = () => {
        assert.deepEqual(fs.readdirSync(client).sort(), ["build", "scripts"]);
        assert.deepEqual(fs.readdirSync(path.join(client, "scripts")), ["serve-build.mjs"]);
        assert.deepEqual(fs.readdirSync(build).sort(), ["asset.txt", "asset.txt.br", "asset.txt.gz"]);
        return ["scripts/serve-build.mjs", "build/asset.txt", "build/asset.txt.gz", "build/asset.txt.br"].map((file) => {
        const full = path.join(client, file);
        const stat = fs.lstatSync(full);
        assert.ok(stat.isFile() && !stat.isSymbolicLink());
        const bytes = fs.readFileSync(full);
        return { file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
        });
    };
    try {
        fs.mkdirSync(path.dirname(script), { recursive: true });
        fs.mkdirSync(build);
        fs.writeFileSync(script, source);
        assert.deepEqual(fs.readFileSync(script), source, "whole entrypoint copy must be unchanged");
        assert.ok(original.length >= 1024 && original.length < BODY_LIMIT);
        fs.writeFileSync(path.join(build, "asset.txt"), original);
        assert.equal(fs.existsSync(path.join(temporary, "server/caches")), false);
        producer = start(script, client, ["--precompress"], 1, t.signal); // producer exits before PORT is read
        const produced = await bounded(producer.closed, DEADLINE_MS, "precompress producer");
        assert.equal(producer.fault(), undefined);
        assert.equal(produced.signal, null, producer.output());
        assert.equal(produced.code, 0, producer.output());
        const gzip = fs.readFileSync(path.join(build, "asset.txt.gz"));
        const br = fs.readFileSync(path.join(build, "asset.txt.br"));
        assert.ok(gzip.length > 0 && br.length > 0);
        assert.deepEqual(zlib.gunzipSync(gzip), original);
        assert.deepEqual(zlib.brotliDecompressSync(br), original);
        generatedBefore = generatedManifest();
        console.log(JSON.stringify({ observation: "generated-pre-seal", files: generatedBefore }));
        console.log(JSON.stringify({ observation: "producer-controls", original: original.length, gzip: gzip.length, br: br.length, decompressionEqual: true }));
        const port = await reservePort(t.signal);
        server = start(script, client, [], port, t.signal);
        await bounded(server.ready, DEADLINE_MS, "own server readiness");

        const cases: [string, "gzip" | "br" | undefined][] = [
            ["gzip", "gzip"], ["br", "br"], ["identity", undefined],
            ["gzip;q=0.5", "gzip"],
            ["gzip;q=0", undefined], ["br;q=0", undefined],
            ["gzip;q=0.000", undefined], ["GZip;Q=0", undefined],
            ["gzip ; q=0", undefined],
            ["gzip;q=0, br;q=1", "br"], ["br;q=0, gzip;q=1", "gzip"],
            ["*;q=1, br;q=0, gzip;q=0", undefined],
            ["GZip;Q=1", "gzip"], ["gzip ; q=0.500", "gzip"],
            ["br;q=0.1, gzip;q=0.9", "gzip"], ["br;q=0.9, gzip;q=0.1", "br"],
            ["gzip, br", "br"], ["*;q=1", "br"],
            ["*;q=1, br;q=0", "gzip"], ["*;q=0, gzip;q=1", "gzip"],
        ];
        // Await every independent subtest: a target red must not suppress later cases.
        for (const [accepts, expected] of cases) {
            for (const method of ["GET", "HEAD"] as const) {
                t.signal.throwIfAborted();
                await t.test(`${method} Accept-Encoding: ${accepts}`, async () => {
                    const response = await request(port, method, accepts, t.signal);
                    console.log(JSON.stringify({ observation: "response", method, accepts, status: response.status, headers: response.headers, bodyLength: response.body.length, bodySHA256: createHash("sha256").update(response.body).digest("hex"), ownRequestAndResponseClosed: true }));
                    assert.equal(response.status, 200);
                    assert.equal(response.headers["content-type"], "text/plain; charset=utf-8");
                    assert.ok(response.headers.vary?.split(/,\s*/).includes("Accept-Encoding"));
                    assert.equal(response.headers["content-encoding"], expected, "must not select an unacceptable content coding");
                    const selected = expected === "gzip" ? gzip : expected === "br" ? br : original;
                    assert.equal(response.headers["content-length"], String(selected.length));
                    assert.deepEqual(response.body, method === "HEAD" ? Buffer.alloc(0) : selected);
                    if (method === "GET" && expected) {
                        assert.deepEqual(expected === "gzip" ? zlib.gunzipSync(response.body) : zlib.brotliDecompressSync(response.body), original);
                    }
                });
            }
        }
        assert.equal(server.fault(), undefined, server.output());
        assert.equal(server.child.exitCode, null, "server must stay live through all requests");
        assert.equal(server.child.signalCode, null);
    } catch (error) {
        primary = error;
        throw error;
    } finally {
        // Owned handles only. Failure to close prevents a passing parent test.
        const failures: unknown[] = [];
        for (const owned of [server, producer]) {
            if (owned) {
                try { await stop(owned); } catch (error) { failures.push(error); }
            }
        }
        try {
            assert.equal(path.dirname(temporary), fixtureParent);
            assert.ok(path.basename(temporary).startsWith("serve-build-encoding-"));
            if (generatedBefore) {
                const after = generatedManifest();
                console.log(JSON.stringify({ observation: "generated-post-seal", parentCallbackError: !!primary, files: after }));
                assert.deepEqual(after, generatedBefore, "private script and representation bytes must stay unchanged");
            } else console.log(JSON.stringify({ observation: "generated-post-seal", status: "UNAVAILABLE", reason: "producer pre-seal not reached" }));
            if (!failures.length) {
                fs.rmSync(temporary, { recursive: true, force: false });
                assert.equal(fs.existsSync(temporary), false, "own fixture root removal must complete");
                console.log(JSON.stringify({ observation: "fixture-root-removed", parent: fixtureParent, root: temporary, exists: false }));
            }
        } catch (error) { failures.push(error); }
        if (failures.length) {
            console.log(JSON.stringify({ observation: "fixture-root-cleanup-failed", root: temporary, qualification: "UNKNOWN", retained: true }));
            throw new AggregateError(primary ? [primary, ...failures] : failures, "owned fixture cleanup failed; temp retained");
        }
    }
});
