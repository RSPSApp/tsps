// Start the client and open it in Chrome with --remote-debugging-port=9333.
// Run: node tests/cache-worker-memory.browser.cjs [client URL]
const assert = require("node:assert/strict");
const WebSocket = require("ws");

async function main() {
    const url = process.argv[2] ?? "http://localhost:3000/";
    for (const [query, policy] of [
        ["", "same-origin"],
        ["?browser-host-client=1", "same-origin-allow-popups"],
        ["?browser-host-origin=http%3A%2F%2Flocalhost%3A4000", "same-origin-allow-popups"],
    ]) {
        const response = await fetch(new URL(query || ".", url));
        assert.equal(response.headers.get("Cross-Origin-Opener-Policy"), policy);
        assert.equal(response.headers.get("Cross-Origin-Embedder-Policy"), "require-corp");
    }

    const tabs = await (await fetch("http://localhost:9333/json/list")).json();
    const tab = tabs.find((tab) => tab.type === "page" && tab.url === url);
    assert.ok(tab, `Open ${url} in Chrome on debugging port 9333`);
    const socket = new WebSocket(tab.webSocketDebuggerUrl);
    try {
        await new Promise((resolve, reject) => {
            socket.once("open", resolve);
            socket.once("error", reject);
        });
        const result = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Memory check timed out")), 10000);
            socket.once("message", (raw) => {
                clearTimeout(timer);
                const response = JSON.parse(raw);
                if (response.error || response.result?.exceptionDetails) {
                    reject(new Error(JSON.stringify(response)));
                } else {
                    resolve(response.result.result.value);
                }
            });
            socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: {
                returnByValue: true,
                expression: `(() => {
                    const client = window.osrsClient;
                    const buffer = client.loadedCache.files.files.get("main_file_cache.dat2");
                    return {
                        isolated: crossOriginIsolated,
                        shared: typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer,
                        workers: client.workerPool.size,
                        cacheBytes: buffer.byteLength,
                    };
                })()`,
            } }));
        });
        assert.ok(result.cacheBytes > 0, "Wait for the cache to load");
        if (result.isolated && !/[?&]browser-host/.test(url)) {
            assert.equal(result.shared, true, "Normal play must share the cache with workers");
        }
        assert.ok(result.workers > 0);
        if (!result.shared) {
            assert.equal(result.workers, 1, "Private cache copies must be limited to one worker");
        }
        console.log("Cache worker memory regression passed:", result);
    } finally {
        socket.close();
    }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
