package gateway.tsps

import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.WebSocket
import java.nio.ByteBuffer
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletionStage
import java.util.concurrent.atomic.AtomicBoolean

/**
 * One player's tsps WebSocket, opened the way the browser client opens it.
 *
 * `X-Real-IP` carries the official client's address; tsps trusts it from loopback, so IP bans
 * and mutes apply per player rather than to the gateway.
 */
class TspsSocket private constructor(
    private val socket: WebSocket,
) {
    private val closed = AtomicBoolean()

    fun send(packet: ByteArray) {
        if (closed.get()) return
        synchronized(socket) { socket.sendBinary(ByteBuffer.wrap(packet), true).join() }
    }

    fun close() {
        if (closed.compareAndSet(false, true)) socket.sendClose(WebSocket.NORMAL_CLOSURE, "gateway").exceptionally { null }
    }

    interface Listener {
        fun onPackets(packets: List<TspsPacket>)

        fun onClosed(reason: String)
    }

    companion object {
        private val client: HttpClient = HttpClient.newHttpClient()

        fun connect(url: String, realIp: String, listener: Listener): CompletableFuture<TspsSocket> =
            client
                .newWebSocketBuilder()
                .header("X-Real-IP", realIp)
                .buildAsync(URI.create(url), Receiver(listener))
                .thenApply(::TspsSocket)
    }

    private class Receiver(private val listener: Listener) : WebSocket.Listener {
        private val partial = ByteArrayOutputStream()

        override fun onBinary(webSocket: WebSocket, data: ByteBuffer, last: Boolean): CompletionStage<*>? {
            val bytes = ByteArray(data.remaining()).also(data::get)
            partial.writeBytes(bytes)
            try {
                if (last) {
                    val message = partial.toByteArray()
                    partial.reset()
                    listener.onPackets(TspsCodec.split(message))
                }
            } catch (e: RuntimeException) {
                // A frame the gateway can't split leaves it out of step with tsps for good.
                listener.onClosed("unreadable tsps frame: ${e.message}")
                webSocket.abort()
                return null
            }
            // Java's WebSocket delivers nothing more until asked.
            webSocket.request(1)
            return null
        }

        override fun onClose(webSocket: WebSocket, statusCode: Int, reason: String): CompletionStage<*>? {
            listener.onClosed("tsps closed the connection ($statusCode${if (reason.isEmpty()) "" else " $reason"})")
            return null
        }

        override fun onError(webSocket: WebSocket, error: Throwable) {
            listener.onClosed("tsps connection failed: ${error.message}")
        }
    }
}
