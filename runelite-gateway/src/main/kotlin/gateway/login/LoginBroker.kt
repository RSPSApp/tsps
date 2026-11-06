package gateway.login

import com.sun.net.httpserver.HttpServer
import gateway.down.TspsLoginResult
import gateway.tsps.*
import io.netty.util.NetUtil
import java.net.InetAddress
import java.net.InetSocketAddress
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.*

/**
 * Bridges a TLS-protected launcher request to a single native game login. The already-authenticated
 * TSPS socket is transferred, never authenticated twice. No password or persistent token is
 * retained in the ticket registry or logged.
 */
class LoginBroker(
    private val tspsUrl: String,
    private val revision: Int,
    port: Int,
    private val clock: () -> Long = { System.currentTimeMillis() },
    private val allowLoopbackProxy: Boolean = false,
) : AutoCloseable {
    private val tickets = ConcurrentHashMap<String, Pending>()
    private val random = SecureRandom()
    private val workers =
        ThreadPoolExecutor(
            4,
            4,
            0L,
            TimeUnit.MILLISECONDS,
            ArrayBlockingQueue(32),
            { runnable -> Thread(runnable, "login-utilities-http").apply { isDaemon = true } },
            ThreadPoolExecutor.AbortPolicy(),
        )
    private val timer =
        Executors.newSingleThreadScheduledExecutor {
            Thread(it, "login-utilities-expiry").apply { isDaemon = true }
        }
    private val attempts = ConcurrentHashMap<String, Pair<Long, Int>>()
    private val server = run {
        if (System.getProperty("sun.net.httpserver.maxReqTime") == null)
            System.setProperty("sun.net.httpserver.maxReqTime", "10")
        if (System.getProperty("sun.net.httpserver.maxRspTime") == null)
            System.setProperty("sun.net.httpserver.maxRspTime", "25")
        HttpServer.create(InetSocketAddress("127.0.0.1", port), 16)
    }

    class Pending(
        val username: String,
        val ip: String,
        val socket: TspsSocket,
        private val bridge: Bridge,
        val expires: Long,
    ) {
        fun attach(listener: TspsSocket.Listener) = bridge.attach(listener)

        fun close() = socket.close()
    }

    class Bridge : TspsSocket.Listener {
        private var result: CompletableFuture<TspsLoginResult>? = CompletableFuture()

        @Synchronized fun resultFuture(): CompletableFuture<TspsLoginResult> = checkNotNull(result)

        private var delegate: TspsSocket.Listener? = null
        private val buffered = ArrayList<TspsPacket>()
        private var closed: String? = null

        @Synchronized
        override fun onPackets(packets: List<TspsPacket>) {
            for (packet in packets) {
                if (result != null && packet.opcode == TspsServerPacket.LOGIN_RESPONSE) {
                    val decoded = TspsLoginResult.decode(packet)
                    val future = result!!
                    result = null
                    future.complete(decoded)
                } else if (delegate != null) delegate!!.onPackets(listOf(packet))
                else {
                    require(buffered.size < 128)
                    buffered.add(packet)
                }
            }
        }

        @Synchronized
        override fun onClosed(reason: String) {
            closed = "Login connection closed"
            result?.completeExceptionally(IllegalStateException("Login connection closed"))
            result = null
            delegate?.onClosed("Login connection closed")
        }

        @Synchronized
        fun attach(listener: TspsSocket.Listener): Boolean {
            if (delegate != null || closed != null) return false
            delegate = listener
            if (buffered.isNotEmpty()) listener.onPackets(buffered.toList())
            buffered.clear()
            return true
        }
    }

    init {
        server.executor = workers
        server.createContext("/login-utilities/v1/session") { exchange ->
            var socket: TspsSocket? = null
            var retained = false
            try {
                exchange.responseHeaders.set("Cache-Control", "no-store")
                exchange.responseHeaders.set("Content-Type", "text/plain; charset=utf-8")
                // Only Caddy may reach this loopback listener. It replaces this header.
                val ip =
                    normalizeIp(exchange.requestHeaders.getFirst("X-Real-IP") ?: "")
                        ?: throw IllegalArgumentException()
                require(
                    exchange.requestMethod == "POST" &&
                        exchange.requestURI.path == "/login-utilities/v1/session"
                )
                require(exchange.requestHeaders.getFirst("Origin") == null)
                val now = clock()
                attempts.entries.removeIf { now - it.value.first > 60_000 }
                require(attempts.size < 2048 || attempts.containsKey(ip))
                val rate =
                    attempts.compute(ip) { _, old ->
                        if (old == null || now - old.first > 60_000) now to 1
                        else old.first to old.second + 1
                    }!!
                require(rate.second <= 20 && tickets.size < 64)
                val data = exchange.requestBody.readNBytes(4097)
                require(data.size <= 4096)
                val fields = String(data, Charsets.UTF_8).trimEnd('\n', '\r').split('\n')
                require(fields.size == 3 && fields[0] in listOf("password", "token"))
                val username = String(Base64.getDecoder().decode(fields[1]), Charsets.UTF_8)
                val secret = String(Base64.getDecoder().decode(fields[2]), Charsets.UTF_8)
                require(
                    username.matches(Regex("[A-Za-z0-9 _-]{1,12}")) &&
                        secret.length in 1..64 &&
                        '\u0000' !in secret
                )
                val bridge = Bridge()
                val loginResult = bridge.resultFuture()
                val connection = TspsSocket.connect(tspsUrl, ip, bridge)
                socket =
                    try {
                        connection.get(8, TimeUnit.SECONDS)
                    } catch (error: Exception) {
                        connection.whenComplete { late, _ -> late?.close() }
                        throw error
                    }
                socket.send(
                    TspsClientPacket.login(
                        username,
                        secret,
                        revision,
                        if (fields[0] == "token") 2 else 1,
                    )
                )
                val result = loginResult.get(12, TimeUnit.SECONDS)
                if (!result.ok) {
                    reply(exchange, 200, "ERROR\n${result.code}\n")
                } else {
                    require(result.token.matches(Regex("[A-Za-z0-9_-]{43}")))
                    val ticket =
                        Base64.getUrlEncoder()
                            .withoutPadding()
                            .encodeToString(ByteArray(32).also(random::nextBytes))
                    val pending =
                        Pending(
                            result.displayName.ifEmpty { username },
                            ip,
                            socket,
                            bridge,
                            clock() + 45_000,
                        )
                    tickets[ticket] = pending
                    retained = true
                    try {
                        reply(
                            exchange,
                            200,
                            "OK\n${encode(pending.username)}\n${encode(result.token)}\n${encode(ticket)}\n",
                        )
                    } catch (error: Exception) {
                        tickets.remove(ticket)?.close()
                        throw error
                    }
                }
            } catch (error: Exception) {
                // Deliberately omit exception bodies: credentials and tokens must never enter HTTP
                // logs.
                try {
                    reply(exchange, 503, "ERROR\n8\n")
                } catch (_: Exception) {}
            } finally {
                if (!retained) socket?.close()
                exchange.close()
            }
        }
        timer.scheduleAtFixedRate(
            {
                val now = clock()
                tickets.entries.removeIf {
                    if (it.value.expires < now) {
                        it.value.close()
                        true
                    } else false
                }
            },
            1,
            1,
            TimeUnit.SECONDS,
        )
        server.start()
    }

    /** A wrong address/name must not consume another player's one-time ticket. */
    @Synchronized
    fun redeem(ticket: String, username: String, ip: String): Pending? {
        val address = normalizeIp(ip) ?: return null
        val pending = tickets[ticket] ?: return null
        if (pending.expires < clock()) {
            tickets.remove(ticket)?.close()
            return null
        }
        val trustedForwarder =
            allowLoopbackProxy && address in setOf("127.0.0.1", "::1", "0:0:0:0:0:0:0:1")
        if ((pending.ip != address && !trustedForwarder) || key(pending.username) != key(username))
            return null
        return tickets.remove(ticket)
    }

    override fun close() {
        server.stop(0)
        timer.shutdownNow()
        workers.shutdownNow()
        tickets.values.forEach { it.close() }
        tickets.clear()
    }

    companion object {
        private fun normalizeIp(value: String): String? {
            if (value.length > 64) return null
            val bytes = NetUtil.createByteArrayFromIpAddressString(value) ?: return null
            return InetAddress.getByAddress(bytes).hostAddress
        }

        private fun key(value: String) = value.lowercase().replace('_', ' ').replace('-', ' ')

        private fun encode(value: String) =
            Base64.getEncoder().encodeToString(value.toByteArray(Charsets.UTF_8))

        private fun reply(
            exchange: com.sun.net.httpserver.HttpExchange,
            status: Int,
            value: String,
        ) {
            val bytes = value.toByteArray(Charsets.UTF_8)
            exchange.sendResponseHeaders(status, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
    }
}
