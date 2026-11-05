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
    private class Backend : AutoCloseable {
        val packets = LinkedBlockingQueue<TspsReader>()
        val flags = LinkedBlockingQueue<Int>()
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
                                            reader.u8()
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
                .header("X-Real-IP", "127.0.0.1")
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
            LoginBroker("ws://127.0.0.1:${backend.port}/", 241, port).use { broker ->
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
            LoginBroker("ws://127.0.0.1:${backend.port}/", 241, port).use { broker ->
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
    fun `bad credentials and browser origin cannot mint a ticket`() {
        Backend().use { backend ->
            val port = freePort()
            LoginBroker("ws://127.0.0.1:${backend.port}/", 241, port).use {
                assertEquals(listOf("ERROR", "3"), request(port, secret = "wrong"))
                assertEquals(1, backend.flags.poll(5, TimeUnit.SECONDS))
                assertEquals(listOf("ERROR", "8"), request(port, origin = true))
                assertNull(backend.flags.poll(100, TimeUnit.MILLISECONDS))
            }
        }
    }

    @Test
    fun `an unredeemed native ticket expires and releases the pending login`() {
        Backend().use { backend ->
            val port = freePort()
            var now = 1_000L
            LoginBroker("ws://127.0.0.1:${backend.port}/", 241, port, { now }).use { broker ->
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
            LoginBroker("ws://127.0.0.1:${backend.port}/", 241, port, allowLoopbackProxy = true)
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
            LoginBroker("ws://127.0.0.1:${backend.port}/", 241, port).use { broker ->
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
