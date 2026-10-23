// Run after `yarn build`: node --test tests/browser-host-bridge.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");

const { EventEmitter } = require("node:events");
const { BROWSER_HOST_BRIDGE_HTML, BrowserHostHttpChannel } = require("../dist/net/BrowserHostHttpBridge");

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs the bridge page's script against a fake port and a server that always has a frame to poll.
 * `failing` makes that many poll and send fetches reject as a dropped connection does.
 */
function startBridge({ failing = 0 } = {}) {
  const script = /<script>([\s\S]*)<\/script>/.exec(BROWSER_HOST_BRIDGE_HTML)[1];
  const posted = [];
  const urls = [];
  const sends = [];
  const port = { postMessage: (message) => posted.push(message), start: () => {}, onmessage: null };
  let polls = 0;
  let connect;
  const fetch = async (url, init = {}) => {
    await tick(1);
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
      polls++;
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(polls) },
        arrayBuffer: async () => new ArrayBuffer(1),
      };
    }
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
    Uint8Array,
    setTimeout,
  });
  connect({ data: "browser-host-connect", ports: [port] });
  return {
    polls: () => polls,
    posted,
    urls,
    sends,
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

test("frames sent while a send is in flight share the next send, up to a message each", async (t) => {
  const bridge = startBridge();
  t.after(() => bridge.send("close"));
  await tick();
  bridge.send("pause");
  await tick();
  const frame = (byte, length = 1) => new Uint8Array(length).fill(byte).buffer;

  bridge.send("message", frame(1));
  for (const byte of [2, 3, 4]) bridge.send("message", frame(byte));
  await tick(50);
  assert.deepEqual(bridge.sends.map((body) => [...body]), [[1], [2, 3, 4]], "one request for the three that waited");

  bridge.send("message", frame(5));
  bridge.send("message", frame(6, 40_000));
  bridge.send("message", frame(7, 40_000));
  await tick(50);
  assert.deepEqual(bridge.sends.slice(2).map((body) => body.length), [1, 40_000, 40_000], "a batch stays within 64 KiB");
  assert.deepEqual(bridge.urls.filter((url) => url.includes("/send?")).map((url) => url.split("seq=")[1]), ["1", "2", "3", "4", "5"]);
  const sent = bridge.posted.filter((m) => m.type === "sent").reduce((total, m) => total + m.bytes, 0);
  assert.equal(sent, 4 + 1 + 80_000, "the host is told every byte left");
});

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
