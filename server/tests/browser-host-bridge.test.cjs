// Run after `yarn build`: node --test tests/browser-host-bridge.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");

const { EventEmitter } = require("node:events");
const { BROWSER_HOST_BRIDGE_HTML, BrowserHostHttpChannel, BrowserHostHttpBridge } = require("../dist/net/BrowserHostHttpBridge");

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs the bridge page's script against a fake port and a server that always has a frame to poll.
 * `failing` makes that many poll and send fetches reject as a dropped connection does.
 * `sendDelay` lets batching exercise responses slower than the former 50ms assertion delay.
 */
function startBridge({ failing = 0, sendDelay = 1, streaming = false, htmlPolls = 0, htmlSends = 0 } = {}) {
  const script = /<script>([\s\S]*)<\/script>/.exec(BROWSER_HOST_BRIDGE_HTML)[1];
  const posted = [];
  const urls = [];
  const sends = [];
  const messages = new EventEmitter();
  const port = {
    postMessage: (message) => { posted.push(message); messages.emit("posted"); },
    start: () => {},
    onmessage: null,
  };
  let polls = 0;
  let connect;
  let stream;
  class PageWebSocket {
    readyState = 0;
    sent = [];
    constructor(url) {
      this.multiplex = url.pathname === "/browser-host/stream";
      stream = this;
      queueMicrotask(() => { this.readyState = 1; this.onopen(); });
    }
    send(data) {
      if (!this.multiplex) { this.sent.push(data); return; }
      if (typeof data === "string") {
        const message = JSON.parse(data);
        if (message.type === "attach") { this.id = message.id; queueMicrotask(() => this.onmessage({ data: JSON.stringify({ type: "open", id: message.id }) })); }
        else if (message.type === "data") this.sent.push(message.data);
      } else this.sent.push(new Uint8Array(data.buffer, data.byteOffset + 4, data.byteLength - 4).slice());
    }
    close() { this.readyState = 3; this.onclose({ code: 1006 }); }
    receive(data) {
      if (this.multiplex) {
        if (typeof data === "string") data = JSON.stringify({ type: "data", id: this.id, data });
        else { const frame = new Uint8Array(data.byteLength + 4); new DataView(frame.buffer).setUint32(0, this.id); frame.set(new Uint8Array(data), 4); data = frame.buffer; }
      }
      this.onmessage({ data });
    }
  }
  const fetch = async (url, init = {}) => {
    await tick(url.includes("/send?") ? sendDelay : 1);
    if (url === "/browser-host/session" && init.method === "POST") {
      return { ok: true, status: 200, text: async () => "session" };
    }
    urls.push(url);
    if (url.includes("/send?")) sends.push(Buffer.from(init.body));
    if (failing > 0 && /\/(poll|send)\?/.test(url)) {
      failing--;
      throw new TypeError("Failed to fetch");
    }
    if (url.includes("/poll?")) {
      if (htmlPolls-- > 0) return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(100) };
      polls++;
      return {
        ok: true,
        status: 200,
        headers: { get: name => name === "Content-Type" ? "application/octet-stream" : String(polls) },
        arrayBuffer: async () => new ArrayBuffer(1),
      };
    }
    if (url.includes("/send?") && htmlSends-- > 0) return { ok: true, status: 200 };
    return { ok: true, status: 204 };
  };
  vm.runInNewContext(script, {
    addEventListener: (_type, listener) => { connect = listener; },
    removeEventListener: () => {},
    parent: { postMessage: () => {} },
    fetch,
    AbortSignal,
    TypeError,
    ArrayBuffer,
    DataView,
    Uint8Array,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    URL,
    location: { href: "https://preview.local/" },
    ...(streaming ? { WebSocket: PageWebSocket } : {}),
  });
  connect({ data: "browser-host-connect", ports: [port] });
  return {
    polls: () => polls,
    posted,
    urls,
    sends,
    stream: () => stream,
    // Wait for the public port acknowledgement, not a particular event-loop speed.
    // The timeout only bounds a broken bridge; it never marks a send complete.
    waitForMessage(type, count = 1) {
      const received = () => posted.filter((message) => message.type === type).length >= count;
      if (received()) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timeout); messages.off("posted", check); };
        const check = () => { if (received()) { cleanup(); resolve(); } };
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error(`Timed out waiting for ${count} ${type} message(s)`));
        }, 5000);
        messages.on("posted", check);
      });
    },
    dropNext: () => { failing = 1; },
    send: (type, data) => port.onmessage({ data: { type, data } }),
  };
}

test("the host pauses and resumes polling", async (t) => {
  const bridge = startBridge();
  t.after(() => bridge.send("close"));
  await tick();
  assert.ok(bridge.polls() > 0, "polls once the session opens");

  bridge.send("pause");
  await tick();
  const paused = bridge.polls();
  await tick(50);
  assert.equal(bridge.polls(), paused, "no polls while paused");

  bridge.send("resume");
  await tick();
  assert.ok(bridge.polls() > paused, "polls again after resume");
});

test("a dropped poll or send is retried, not the end of the session (#559)", async (t) => {
  const bridge = startBridge({ failing: 1 });
  t.after(() => bridge.send("close"));
  await tick(400);
  assert.deepEqual(bridge.posted.filter((m) => m.type === "error"), []);
  assert.equal(bridge.urls[0], "/browser-host/session/session/poll?ack=0");
  assert.equal(bridge.urls[1], "/browser-host/session/session/poll?ack=0", "retries with the same ack");
  assert.equal(bridge.urls[2], "/browser-host/session/session/poll?ack=1", "acks the batch it got");

  bridge.send("pause");
  await tick();
  bridge.dropNext();
  bridge.send("message", new ArrayBuffer(2));
  await tick(400);
  assert.deepEqual(bridge.urls.filter((url) => url.includes("/send?")), [
    "/browser-host/session/session/send?seq=1",
    "/browser-host/session/session/send?seq=1",
  ]);
  assert.ok(bridge.posted.some((m) => m.type === "sent" && m.bytes === 2));
});

test("proxy HTML responses are retried without entering gameplay or acknowledging an unsent batch", async t => {
  const bridge = startBridge({ htmlPolls: 1, htmlSends: 1 });
  t.after(() => bridge.send("close"));
  await bridge.waitForMessage("message");
  bridge.send("pause");
  assert.ok(bridge.posted.filter(m => m.type === "message").every(m => m.data.byteLength === 1));
  assert.deepEqual(bridge.urls.filter(url => url.includes("/poll?")).slice(0,2), [
    "/browser-host/session/session/poll?ack=0", "/browser-host/session/session/poll?ack=0",
  ]);
  bridge.send("message", new ArrayBuffer(2));
  await bridge.waitForMessage("sent");
  assert.deepEqual(bridge.urls.filter(url => url.includes("/send?")), [
    "/browser-host/session/session/send?seq=1", "/browser-host/session/session/send?seq=1",
  ]);
  assert.deepEqual(bridge.posted.filter(m => m.type === "error"), []);
});

for (const sendDelay of [1, 80]) {
  test(`frames sent while a send is in flight share the next send, up to a message each (${sendDelay}ms responses)`, async (t) => {
    const bridge = startBridge({ sendDelay });
    t.after(() => bridge.send("close"));
    await bridge.waitForMessage("open");
    bridge.send("pause");
    const frame = (byte, length = 1) => new Uint8Array(length).fill(byte).buffer;

    bridge.send("message", frame(1));
    for (const byte of [2, 3, 4]) bridge.send("message", frame(byte));
    await bridge.waitForMessage("sent", 2);
    assert.deepEqual(bridge.sends.map((body) => [...body]), [[1], [2, 3, 4]], "one request for the three that waited");

    bridge.send("message", frame(5));
    bridge.send("message", frame(6, 40_000));
    bridge.send("message", frame(7, 40_000));
    await bridge.waitForMessage("sent", 5);
    assert.deepEqual(bridge.sends.slice(2).map((body) => body.length), [1, 40_000, 40_000], "a batch stays within 64 KiB");
    assert.deepEqual(bridge.urls.filter((url) => url.includes("/send?")).map((url) => url.split("seq=")[1]), ["1", "2", "3", "4", "5"]);
    const sent = bridge.posted.filter((m) => m.type === "sent").reduce((total, m) => total + m.bytes, 0);
    assert.equal(sent, 4 + 1 + 80_000, "the host is told every byte left");
  });
}

function fakeResponse() {
  const response = new EventEmitter();
  response.headers = {};
  response.writableEnded = false;
  response.setHeader = (name, value) => { response.headers[name] = value; };
  response.end = (body) => { response.writableEnded = true; response.body = body; };
  return response;
}

test("the server repeats a batch until it is acked and drops repeated sends", () => {
  const channel = new BrowserHostHttpChannel();
  const received = [];
  channel.onData((data) => received.push(data.toString()));
  channel.send(Buffer.from("a"));

  const first = fakeResponse();
  channel.attachPoll(first, 0);
  assert.equal(first.body.toString(), "a");
  assert.equal(first.headers["X-Seq"], 1);

  channel.send(Buffer.from("b"));
  const lost = fakeResponse();
  channel.attachPoll(lost, 0);
  assert.equal(lost.body.toString(), "a", "a poll that never saw batch 1 gets it again");

  const next = fakeResponse();
  channel.attachPoll(next, 1);
  assert.equal(next.body.toString(), "b");
  assert.equal(next.headers["X-Seq"], 2);

  channel.receive(Buffer.from("x"), 1);
  channel.receive(Buffer.from("x"), 1);
  channel.receive(Buffer.from("y"), 2);
  assert.deepEqual(received, ["x", "y"]);
  channel.close();
});

test("an aborted poll leaves the session open for the page to retry", () => {
  const channel = new BrowserHostHttpChannel();
  const poll = fakeResponse();
  channel.attachPoll(poll, 0);
  poll.emit("close");
  assert.ok(channel.isOpen());
  channel.attachPoll(fakeResponse(), 0);
  assert.ok(channel.isOpen());
  channel.close();
});

test("a session nobody polls closes with a reason the next poll passes on", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const channel = new BrowserHostHttpChannel();
  const reasons = [];
  channel.onClose((_code, reason) => reasons.push(reason));
  const poll = fakeResponse();
  channel.attachPoll(poll, 0);
  poll.emit("close");
  t.mock.timers.tick(120_000);
  assert.deepEqual(reasons, ["no poll for 120s"]);
  const late = fakeResponse();
  channel.attachPoll(late, 0);
  assert.equal(late.statusCode, 410);
  assert.equal(late.headers["X-Close-Reason"], "no poll for 120s");
});

class StreamSocket extends EventEmitter {
  readyState = 1;
  sent = [];
  send(data) { this.sent.push(data); }
  close(code, reason) { this.readyState = 3; this.emit("close", code, reason); }
  terminate() { this.close(1006); }
}

function streamFrame(seq, bytes) {
  const frame = Buffer.alloc(4 + bytes.length);
  frame.writeUInt32BE(seq);
  frame.set(bytes, 4);
  return frame;
}

test("the stream holds one outbound batch until acknowledged and drains before closing", () => {
  const channel = new BrowserHostHttpChannel();
  const socket = new StreamSocket();
  channel.attachStream(socket);
  channel.send(Buffer.from("a"));
  channel.send(Buffer.from("b"));
  assert.deepEqual(socket.sent, [streamFrame(1, Buffer.from("a"))]);
  assert.equal(channel.bufferedAmount, 1, "unacknowledged data applies backpressure");
  socket.emit("message", Buffer.from("1"), false);
  assert.deepEqual(socket.sent, [streamFrame(1, Buffer.from("a")), streamFrame(2, Buffer.from("b"))]);
  channel.close(1000, "logout");
  assert.equal(socket.readyState, 1, "logout waits for the final batch");
  socket.emit("message", Buffer.from("2"), false);
  assert.equal(socket.readyState, 3);
  assert.ok(channel.isDrained());
});

test("a lost stream replays unacknowledged output and deduplicates input repeated over HTTP", () => {
  const channel = new BrowserHostHttpChannel();
  const socket = new StreamSocket();
  const received = [];
  channel.onData(data => received.push(data.toString()));
  channel.attachStream(socket);
  socket.emit("message", streamFrame(1, Buffer.from("input")), true);
  channel.send(Buffer.from("output"));
  socket.close(1006);
  assert.ok(channel.isOpen());
  channel.receive(Buffer.from("input"), 1);
  assert.deepEqual(received, ["input"]);
  const poll = fakeResponse();
  channel.attachPoll(poll, 0);
  assert.equal(poll.body.toString(), "output");
  assert.equal(poll.headers["X-Seq"], 1);
  channel.close();
});

test("the page pauses stream delivery and retries a lost send over HTTP with its original sequence", async t => {
  const bridge = startBridge({ streaming: true });
  t.after(() => bridge.send("close"));
  await bridge.waitForMessage("open");
  const socket = bridge.stream();
  assert.equal(bridge.polls(), 0, "streaming does not poll");
  bridge.send("pause");
  const frame = streamFrame(1, Buffer.from([42]));
  socket.receive(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
  assert.equal(bridge.posted.filter(m => m.type === "message").length, 0);
  bridge.send("resume");
  assert.deepEqual(socket.sent, ["1"], "delivery acknowledges the batch only after resume");
  assert.deepEqual([...new Uint8Array(bridge.posted.find(m => m.type === "message").data)], [42]);
  bridge.send("message", new Uint8Array([7]).buffer);
  assert.deepEqual([...socket.sent[1]], [...streamFrame(1, Buffer.from([7]))]);
  socket.close();
  await bridge.waitForMessage("sent");
  assert.ok(bridge.urls.includes("/browser-host/session/session/send?seq=1"));
  assert.ok(bridge.urls.includes("/browser-host/session/session/poll?ack=1"));
});

test("invalid stream frames never reach the game decoder", () => {
  const channel = new BrowserHostHttpChannel();
  const socket = new StreamSocket();
  const received = [];
  channel.onData(data => received.push(data));
  channel.attachStream(socket);
  socket.emit("message", Buffer.alloc(3), true);
  assert.equal(socket.readyState, 3);
  assert.deepEqual(received, []);
  channel.close();
});

test("an open stream that stops acknowledging input falls back to HTTP without losing the batch", async t => {
  const bridge = startBridge({ streaming: true });
  t.after(() => bridge.send("close"));
  await bridge.waitForMessage("open");
  bridge.send("message", new Uint8Array([9]).buffer);
  await bridge.waitForMessage("sent");
  assert.equal(bridge.stream().readyState, 3);
  assert.deepEqual(bridge.urls.filter(url => url.includes("/send?")), ["/browser-host/session/session/send?seq=1"]);
  assert.deepEqual([...bridge.sends[0]], [9]);
  assert.deepEqual(bridge.posted.filter(m => m.type === "error"), []);
});

test("shared streams keep player queues, acknowledgements and closes separate", () => {
  const channels = [];
  const bridge = new BrowserHostHttpBridge(channel => channels.push(channel));
  const sessions = [fakeResponse(), fakeResponse()];
  for (const response of sessions) bridge.handle({ method: "POST", url: "/browser-host/session" }, response);
  const socket = new StreamSocket();
  bridge.attachStream(socket, { url: "/browser-host/stream" });
  const control = message => socket.emit("message", Buffer.from(JSON.stringify(message)), false);
  sessions.forEach((response, i) => control({ type: "attach", id: i + 1, sessionId: response.body }));
  const output = () => socket.sent.filter(Buffer.isBuffer);
  channels[0].send(Buffer.from("paused"));
  channels[0].send(Buffer.from("waiting"));
  channels[1].send(Buffer.from("other"));
  control({ type: "data", id: 2, data: "1" });
  channels[1].send(Buffer.from("still moving"));
  assert.deepEqual(output().map(frame => [frame.readUInt32BE(0), frame.subarray(8).toString()]), [
    [1, "paused"], [2, "other"], [2, "still moving"],
  ]);
  const received = [];
  channels.forEach((channel, i) => channel.onData(data => received.push([i, data.toString()])));
  const input = streamFrame(2, streamFrame(1, Buffer.from("only player two")));
  socket.emit("message", input, true);
  assert.deepEqual(received, [[1, "only player two"]]);
  control({ type: "detach", id: 1 });
  assert.equal(socket.readyState, 1, "disconnecting one logical stream keeps the shared connection open");
  assert.ok(channels[1].isOpen());
  socket.close(1006);
  const fallback = sessions.map(() => fakeResponse());
  channels[0].attachPoll(fallback[0], 0);
  channels[1].attachPoll(fallback[1], 1);
  assert.equal(fallback[0].body.toString(), "paused");
  assert.equal(fallback[1].body.toString(), "still moving");
  assert.ok(channels.every(channel => channel.isOpen()), "physical socket loss retains both HTTP sessions");
  channels.forEach(channel => channel.close());
  socket.close();
});
