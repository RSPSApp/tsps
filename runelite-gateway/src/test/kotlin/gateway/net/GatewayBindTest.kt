package gateway.net

import gateway.Gateway
import gateway.config.GatewayConfig
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import java.io.IOException
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket

/** The game listener's address (GATEWAY_BIND_HOST): loopback unless set, reachable from other machines when it is. */
class GatewayBindTest {
    private val config = GatewayConfig.load(GatewayConfig.load().root)

    @Test
    fun `by default the listener only takes local connections`() {
        val address = nonLoopbackAddress()
        withGateway(GatewayConfig.DEFAULT_BIND_HOST) { port ->
            connect(InetAddress.getLoopbackAddress(), port)
            assertThrows(IOException::class.java) { connect(address, port) }
        }
    }

    @Test
    fun `bound to every interface it takes connections through this machine's own address`() {
        val address = nonLoopbackAddress()
        withGateway(ALL_INTERFACES) { port -> connect(address, port) }
    }

    @Test
    fun `a gateway that cannot take its game port releases the login broker's port`() {
        val brokerPort = ServerSocket(0).use { it.localPort }
        ServerSocket(0, 50, InetAddress.getLoopbackAddress()).use { taken ->
            assertThrows(Exception::class.java) {
                Gateway.start(config.copy(gatewayPort = taken.localPort, loginUtilitiesPort = brokerPort)).stop()
            }
        }
        ServerSocket(brokerPort, 50, InetAddress.getLoopbackAddress()).close()
    }

    @Test
    fun `a gateway that cannot take its game port leaves none of its network threads running`() {
        val before = Thread.getAllStackTraces().keys
        ServerSocket(0, 50, InetAddress.getLoopbackAddress()).use { taken ->
            assertThrows(Exception::class.java) {
                Gateway.start(config.copy(gatewayPort = taken.localPort, loginUtilitiesPort = 0)).stop()
            }
        }
        val deadline = System.nanoTime() + THREAD_EXIT_TIMEOUT_NS
        var left = startedSince(before)
        while (left.isNotEmpty() && System.nanoTime() < deadline) {
            Thread.sleep(50)
            left = startedSince(before)
        }
        assertEquals(emptyList<String>(), left.map { it.name }.sorted())
    }

    /** Threads alive now that were not before, leaving out the JVM's shared common pool (rsprot's shutdown runs on it). */
    private fun startedSince(before: Set<Thread>): List<Thread> =
        Thread.getAllStackTraces().keys.filter { it !in before && it.isAlive && !it.name.startsWith("ForkJoinPool.commonPool") }

    private fun withGateway(bindHost: String, test: (Int) -> Unit) {
        val port = ServerSocket(0).use { it.localPort }
        val gateway = Gateway.start(config.copy(gatewayPort = port, bindHost = bindHost))
        try {
            test(port)
        } finally {
            gateway.stop()
        }
    }

    /** An address other machines would use for this one; the test skips on a machine without one. */
    private fun nonLoopbackAddress(): InetAddress {
        val address =
            NetworkInterface.getNetworkInterfaces().asSequence()
                .filter { it.isUp && !it.isLoopback }
                .flatMap { it.inetAddresses.asSequence() }
                .firstOrNull { it is Inet4Address && !it.isLoopbackAddress && !it.isLinkLocalAddress }
        assumeTrue(address != null, "no non-loopback IPv4 address to connect through")
        return address!!
    }

    private fun connect(address: InetAddress, port: Int) {
        Socket().use { it.connect(InetSocketAddress(address, port), CONNECT_TIMEOUT_MS) }
    }

    private companion object {
        const val ALL_INTERFACES = "0.0.0.0"
        const val CONNECT_TIMEOUT_MS = 2_000
        const val THREAD_EXIT_TIMEOUT_NS = 5_000_000_000L
    }
}
