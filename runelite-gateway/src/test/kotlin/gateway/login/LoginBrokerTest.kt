package gateway.login

import gateway.tsps.*
import io.netty.bootstrap.ServerBootstrap
import io.netty.buffer.Unpooled
import io.netty.channel.*
import io.netty.channel.nio.NioEventLoopGroup
import io.netty.channel.socket.SocketChannel
import io.netty.channel.socket.nio.NioServerSocketChannel
import io.netty.handler.codec.http.*
import io.netty.handler.codec.http.websocketx.*
import java.net.*
import java.net.http.*
import java.util.Base64
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class LoginBrokerTest {
    /** With [hold], login replies wait for [release] so the broker's workers stay busy. */
    private class Backend(private val hold: Boolean = false) : AutoCloseable {
        val packets = LinkedBlockingQueue<TspsReader>()
        val flags = LinkedBlockingQueue<Int>()
        private val held = ArrayList<Pair<ChannelHandlerContext, ByteArray>>()
        private var released = false
        val forgets = LinkedBlockingQueue<Pair<String, String>>()
        val group = NioEventLoopGroup(1)
        val channel =
            ServerBootstrap()
                .group(group)
                .channel(NioServerSocketChannel::class.java)
                .childHandler(
                    object : ChannelInitializer<SocketChannel>() {
                        override fun initChannel(channel: SocketChannel) {
                            channel
                                .pipeline()
                                .addLast(
                                    HttpServerCodec(),
                                    HttpObjectAggregator(8192),
                                    WebSocketServerProtocolHandler("/"),
                                    object : SimpleChannelInboundHandler<BinaryWebSocketFrame>() {
                                        override fun channelRead0(
                                            ctx: ChannelHandlerContext,
                                            frame: BinaryWebSocketFrame,
                                        ) {
                                            val bytes = ByteArray(frame.content().readableBytes())
                                            frame.content().readBytes(bytes)
                                            // LOGIN is var-short; the normal gateway sends it
                                            // without entering the world.
                                            val reader = TspsReader(bytes)
                                            if (reader.u8() == TspsClientPacket.LOGIN_FORGET) {
                                                reader.u8()
                                                forgets.add(reader.string() to reader.string())
                                                return
                                            }
                                            reader.u16()
                                            val name = reader.string()
                                            val secret = reader.string()
                                            reader.i32()
                                            flags.add(reader.u8())
                                            val ok = secret != "wrong"
                                            val response =
                                                TspsWriter()
                                                    .u8(if (ok) 1 else 0)
                                                    .i32(if (ok) -1 else 3)
                                                    .string("")
                                                    .string(name)
                                                    .string(if (ok) "a".repeat(43) else "")
                                                    .varByte(TspsServerPacket.LOGIN_RESPONSE)
                                            synchronized(held) {
                                                if (hold && !released) {
                                                    held.add(ctx to response)
                                                    return
                                                }
                                            }
                                            ctx.writeAndFlush(
                                                BinaryWebSocketFrame(
                                                    Unpooled.wrappedBuffer(response)
                                                )
                                            )
                                        }
                                    },
                                )
                        }
                    }
                )
                .bind("127.0.0.1", 0)
                .syncUninterruptibly()
                .channel()
        val port
            get() = (channel.localAddress() as InetSocketAddress).port

        fun release() {
            val replies =
                synchronized(held) {
                    released = true
                    held.toList().also { held.clear() }
                }
            for ((ctx, response) in replies)
                ctx.writeAndFlush(BinaryWebSocketFrame(Unpooled.wrappedBuffer(response)))
        }

        override fun close() {
            channel.close().syncUninterruptibly()
            group.shutdownGracefully().syncUninterruptibly()
        }
    }

    private fun freePort() = java.net.ServerSocket(0).use { it.localPort }

    private fun request(
        port: Int,
        kind: String = "password",
        secret: String = "test-password",
        origin: Boolean = false,
        ip: String = "127.0.0.1",
    ): List<String> {
        val encoder = Base64.getEncoder()
        val body =
            kind +
                "\n" +
                encoder.encodeToString("Tester".toByteArray()) +
                "\n" +
                encoder.encodeToString(secret.toByteArray()) +
                "\n"
        val request =
            java.net.http.HttpRequest.newBuilder(
                    URI.create("http://127.0.0.1:$port/login-utilities/v1/session")
                )
                .header("X-Real-IP", ip)
                .POST(java.net.http.HttpRequest.BodyPublishers.ofString(body))
        if (origin) request.header("Origin", "https://untrusted.invalid")
        return HttpClient.newHttpClient()
            .send(request.build(), java.net.http.HttpResponse.BodyHandlers.ofString())
            .body()
            .trimEnd()
            .split('\n')
    }

    @Test
    fun `password login issues a one-use name and address bound native ticket`() {
        Backend().use { backend ->
            val port = freePort()
            LoginBroker("ws://127.0.0.1:${backend.port}/", 242, port).use { broker ->
                val reply = request(port)
                assertEquals("OK", reply[0])
                assertEquals(4, reply.size)
                assertEquals(1, backend.flags.poll(5, TimeUnit.SECONDS))
                val ticket = String(Base64.getDecoder().decode(reply[3]))
                assertNull(broker.redeem(ticket, "Tester", "192.0.2.1"))
                assertNull(broker.redeem(ticket, "Other", "127.0.0.1"))
                val pending = broker.redeem(ticket, "tester", "127.0.0.1")!!
                assertNull(broker.redeem(ticket, "Tester", "127.0.0.1"))
                assertEquals("Tester", pending.username)
                val listener =
                    object : TspsSocket.Listener {
                        override fun onPackets(packets: List<TspsPacket>) {}

                        override fun onClosed(reason: String) {}
                    }
                assertTrue(pending.attach(listener))
                assertFalse(pending.attach(listener))
                pending.close()
            }
        }
    }

    @Test
    fun `remembered login uses token flag without a second backend login`() {
        Backend().use { backend ->
            val port = freePort()
            LoginBroker("ws://127.0.0.1:${backend.port}/", 242, port).use { broker ->
                val reply = request(port, "token", "b".repeat(43))
                assertEquals("OK", reply[0])
                assertEquals(2, backend.flags.poll(5, TimeUnit.SECONDS))
                val ticket = String(Base64.getDecoder().decode(reply[3]))
                broker.redeem(ticket, "Tester", "127.0.0.1")!!.close()
                assertNull(backend.flags.poll(100, TimeUnit.MILLISECONDS))
            }
        }
    }

    @Test
    fun `forget account revokes the remembered token on tsps`() {
        Backend().use { backend ->
            val port = freePort()
            LoginBroker("ws://127.0.0.1:${backend.port}/", 242, port).use {
                assertEquals(listOf("OK"), request(port, "forget", "c".repeat(43)))
                assertEquals("Tester" to "c".repeat(43), backend.forgets.poll(5, TimeUnit.SECONDS))
                assertNull(backend.flags.poll(100, TimeUnit.MILLISECONDS))
                // Only a well-formed token is passed on.
                assertEquals(listOf("ERROR", "8"), request(port, "forget", "short"))
                assertNull(backend.forgets.poll(100, TimeUnit.MILLISECONDS))
            }
        }
    }

    @Test
    fun `bad credentials and browser origin cannot mint a ticket`() {
        Backend().use { backend ->
            val port = freePort()
            LoginBroker("ws://127.0.0.1:${backend.port}/", 242, port).use {
                assertEquals(listOf("ERROR", "3"), request(port, secret = "wrong"))
                assertEquals(1, backend.flags.poll(5, TimeUnit.SECONDS))
                assertEquals(listOf("ERROR", "8"), request(port, origin = true))
                assertNull(backend.flags.poll(100, TimeUnit.MILLISECONDS))
            }
        }
    }

    @Test
    fun `requests beyond the worker queue get a busy reply instead of a dropped connection`() {
        Backend(hold = true).use { backend ->
            val port = freePort()
            LoginBroker("ws://127.0.0.1:${backend.port}/", 242, port).use { broker ->
                val pool = java.util.concurrent.Executors.newFixedThreadPool(48)
                try {
                    // Distinct addresses so the per-address limit is not what refuses them.
                    val replies =
                        (0 until 48).map { i ->
                            pool.submit<Result<List<String>>> {
                                runCatching { request(port, ip = "192.0.2.${i + 1}") }
                            }
                        }
                    // 4 workers and 32 queue slots can hold at most 36 logins.
                    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15)
                    while (replies.count { it.isDone } < 12 && System.nanoTime() < deadline)
                        Thread.sleep(20)
                    backend.release()
                    val results = replies.map { it.get(30, TimeUnit.SECONDS) }
                    results.forEach { assertTrue(it.isSuccess, "Dropped: ${it.exceptionOrNull()}") }
                    val bodies = results.map { it.getOrThrow() }
                    assertTrue(bodies.count { it == listOf("ERROR", "8") } >= 12)
                    assertTrue(bodies.count { it.firstOrNull() == "OK" } >= 4)
                    assertTrue(bodies.all { it.firstOrNull() == "OK" || it == listOf("ERROR", "8") })
                } finally {
                    pool.shutdownNow()
                }
            }
        }
    }

    @Test
    fun `requests beyond the overflow queue are closed at once, not held open`() {
        Backend(hold = true).use { backend ->
            val port = freePort()
            LoginBroker("ws://127.0.0.1:${backend.port}/", 242, port).use {
                val pool = java.util.concurrent.Executors.newFixedThreadPool(37)
                val stalled = ArrayList<java.net.Socket>()
                try {
                    // 4 running and 32 queued logins fill the workers.
                    val held =
                        (0 until 36).map { i ->
                            pool.submit<Result<List<String>>> {
                                runCatching { request(port, ip = "192.0.2.${i + 1}") }
                            }
                        }
                    repeat(4) { assertNotNull(backend.flags.poll(5, TimeUnit.SECONDS)) }
                    Thread.sleep(300)
                    // Unfinished headers keep the overflow thread reading, then fill its 64 slots.
                    repeat(65) {
                        stalled +=
                            java.net.Socket("127.0.0.1", port).apply {
                                getOutputStream().write("POST /login-utilities/v1/session HTTP/1.1\r\n".toByteArray())
                                getOutputStream().flush()
                            }
                        if (it == 0) Thread.sleep(200)
                    }
                    Thread.sleep(300)
                    val started = System.nanoTime()
                    val extra = pool.submit<Result<List<String>>> { runCatching { request(port, ip = "198.51.100.9") } }
                    val result = extra.get(30, TimeUnit.SECONDS)
                    val waited = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)
                    assertTrue(result.isFailure, "Nothing can answer it: $result")
                    assertTrue(waited < 3_000, "Held open $waited ms instead of closed at once")
                    backend.release()
                    held.forEach { it.get(30, TimeUnit.SECONDS) }
                } finally {
                    stalled.forEach { runCatching { it.close() } }
                    pool.shutdownNow()
                }
            }
        }
    }

    @Test
    fun `a full rate table admits a new address and still limits the busy one`() {
        Backend().use { backend ->
            val port = freePort()
            var now = 1_000L
            LoginBroker("ws://127.0.0.1:${backend.port}/", 242, port, { now++ }).use {
                val client = HttpClient.newHttpClient()
                fun attempt(ip: String): List<String> =
                    client
                        .send(
                            java.net.http.HttpRequest.newBuilder(
                                    URI.create(
                                        "http://127.0.0.1:$port/login-utilities/v1/session"
                                    )
                                )
                                .header("X-Real-IP", ip)
                                .POST(java.net.http.HttpRequest.BodyPublishers.ofString("x\n"))
                                .build(),
                            java.net.http.HttpResponse.BodyHandlers.ofString(),
                        )
                        .body()
                        .trimEnd()
                        .split('\n')
                // 2047 one-off addresses plus one at its 20-a-minute limit fill the table.
                for (i in 0 until 2047) attempt("2001:db8::${Integer.toHexString(i + 1)}")
                repeat(20) { attempt("198.51.100.1") }
                assertEquals("OK", request(port, ip = "198.51.100.2")[0])
                assertEquals(listOf("ERROR", "8"), request(port, ip = "198.51.100.1"))
            }
        }
    }

    @Test
    fun `concurrent new addresses at a full rate table keep it at its cap`() {
        Backend().use { backend ->
            val port = freePort()
            // A fixed clock: on a slow machine the 2048 requests that fill the table can take over
            // a minute, and the real clock would expire the first of them before the asserts.
            LoginBroker("ws://127.0.0.1:${backend.port}/", 242, port, { 1_000L }).use { broker ->
                val client = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build()
                fun attempt(ip: String) =
                    runCatching {
                        client.send(
                            java.net.http.HttpRequest.newBuilder(
                                    URI.create("http://127.0.0.1:$port/login-utilities/v1/session")
                                )
                                .header("X-Real-IP", ip)
                                .POST(java.net.http.HttpRequest.BodyPublishers.ofString("x"))
                                .build(),
                            java.net.http.HttpResponse.BodyHandlers.discarding(),
                        )
                    }
                for (i in 0 until 2048) attempt("2001:db8::${Integer.toHexString(i + 1)}")
                assertEquals(2048, broker.rateTableSize())
                val pool = java.util.concurrent.Executors.newFixedThreadPool(16)
                try {
                    (0 until 16)
                        .map { t ->
                            pool.submit {
                                for (i in 0 until 150)
                                    attempt("2001:db8:1:${Integer.toHexString(t)}::${Integer.toHexString(i + 1)}")
                            }
                        }
                        .forEach { it.get(60, TimeUnit.SECONDS) }
                } finally {
                    pool.shutdownNow()
                }
                assertEquals(2048, broker.rateTableSize())
            }
        }
    }

    @Test
    fun `an unredeemed native ticket expires and releases the pending login`() {
        Backend().use { backend ->
            val port = freePort()
            var now = 1_000L
            LoginBroker("ws://127.0.0.1:${backend.port}/", 242, port, { now }).use { broker ->
                val reply = request(port)
                assertEquals("OK", reply[0])
                val ticket = String(Base64.getDecoder().decode(reply[3]))
                now += 46_000
                assertNull(broker.redeem(ticket, "Tester", "127.0.0.1"))
            }
        }
    }

    @Test
    fun `an explicitly trusted loopback forwarder can redeem but another public address cannot`() {
        Backend().use { backend ->
            val port = freePort()
            LoginBroker("ws://127.0.0.1:${backend.port}/", 242, port, allowLoopbackProxy = true)
                .use { broker ->
                    val reply = request(port)
                    assertEquals("OK", reply[0])
                    val ticket = String(Base64.getDecoder().decode(reply[3]))
                    assertNull(broker.redeem(ticket, "Tester", "192.0.2.1"))
                    assertNull(broker.redeem(ticket, "Other", "::1"))
                    broker.redeem(ticket, "Tester", "::1")!!.close()
                    assertNull(broker.redeem(ticket, "Tester", "::1"))
                }
        }
    }

    @Test
    fun `equivalent numeric IPv4 mapped addresses keep ticket binding`() {
        Backend().use { backend ->
            val port = freePort()
            LoginBroker("ws://127.0.0.1:${backend.port}/", 242, port).use { broker ->
                val reply = request(port)
                assertEquals("OK", reply[0])
                val ticket = String(Base64.getDecoder().decode(reply[3]))
                assertNull(broker.redeem(ticket, "Tester", "localhost"))
                broker.redeem(ticket, "Tester", "::ffff:127.0.0.1")!!.close()
            }
        }
    }

    @Test
    fun `real server password login and rotating remembered token enter the native world`() {
        val config = gateway.headless.TestCache.config
        org.junit.jupiter.api.Assumptions.assumeTrue(
            runCatching {
                    java.net.Socket("127.0.0.1", config.websocketPort).close()
                    true
                }
                .getOrDefault(false),
            "Start this worktree's test server",
        )
        val httpPort = freePort()
        gateway.Gateway.start(config.copy(gatewayPort = freePort(), loginUtilitiesPort = httpPort))
            .useGateway { active ->
                val name = "lut" + (System.nanoTime() % 1000000).toString()
                fun authenticate(kind: String, secret: String): List<String> {
                    val body =
                        kind +
                            "\n" +
                            Base64.getEncoder().encodeToString(name.toByteArray()) +
                            "\n" +
                            Base64.getEncoder().encodeToString(secret.toByteArray()) +
                            "\n"
                    val request =
                        java.net.http.HttpRequest.newBuilder(
                                URI.create("http://127.0.0.1:$httpPort/login-utilities/v1/session")
                            )
                            .header("X-Real-IP", "127.0.0.1")
                            .POST(java.net.http.HttpRequest.BodyPublishers.ofString(body))
                            .build()
                    val reply =
                        HttpClient.newHttpClient()
                            .send(request, java.net.http.HttpResponse.BodyHandlers.ofString())
                            .body()
                            .trimEnd()
                            .split('\n')
                    assertEquals("OK", reply[0])
                    return reply
                }
                val first = authenticate("password", "disposable-login-test")
                val token = String(Base64.getDecoder().decode(first[2]))
                val ticket = String(Base64.getDecoder().decode(first[3]))
                val client = gateway.headless.HeadlessClient("127.0.0.1", active.config.gatewayPort)
                val joined = client.login(name, ticket, active.rsa.modulus, true)
                assertEquals(2, joined.code)
                joined.game!!.use {
                    it.expect<net.rsprox.protocol.game.outgoing.model.map.RebuildLoginV2>()
                }
                Thread.sleep(2500)
                val second = authenticate("token", token)
                assertNotEquals(first[2], second[2], "Remembered token must rotate")
                val nextTicket = String(Base64.getDecoder().decode(second[3]))
                val again = client.login(name, nextTicket, active.rsa.modulus, true)
                assertEquals(2, again.code)
                again.game!!.use {
                    it.expect<net.rsprox.protocol.game.outgoing.model.map.RebuildLoginV2>()
                }
                assertEquals(3, client.login(name, nextTicket, active.rsa.modulus, true).code)
            }
    }

    private fun <T> gateway.Gateway.useGateway(block: (gateway.Gateway) -> T): T =
        try {
            block(this)
        } finally {
            stop()
        }
}
