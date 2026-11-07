package gateway.it

import gateway.Gateway
import gateway.headless.HeadlessClient
import gateway.headless.TestCache
import org.junit.jupiter.api.Assumptions.assumeTrue
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket

/**
 * A gateway started in-process on a free port, in front of this checkout's running tsps
 * (`yarn start`). Integration tests are skipped when tsps isn't up.
 */
object LiveGateway {
    val gateway: Gateway by lazy {
        val config = TestCache.config
        assumeTrue(isListening(config.websocketPort), "tsps isn't running on ${config.websocketPort}; start it with `yarn start`")
        val port = ServerSocket(0).use { it.localPort }
        Gateway.start(config.copy(gatewayPort = port)).also { Runtime.getRuntime().addShutdownHook(Thread(it::stop)) }
    }

    /**
     * The developer account the tests play: the last of tsps's `DEV_USERNAME` (comma-separated),
     * so with `gwdev,gwtest` someone can play `gwdev` while the tests run.
     */
    val developerName: String? = System.getenv("DEV_USERNAME")?.split(',')?.map { it.trim() }?.lastOrNull { it.isNotEmpty() }

    fun client() = HeadlessClient("127.0.0.1", gateway.config.gatewayPort)

    /**
     * Logs [name] in, waiting out "already online" while tsps releases a session a previous
     * test just closed. Still online after that means someone is playing it: the test skips.
     */
    fun login(name: String, password: String = PASSWORD): HeadlessClient.Game {
        repeat(RELOGIN_ATTEMPTS) {
            val result = client().login(name, password, gateway.rsa.modulus)
            if (result.code == OK) return result.game!!
            if (result.code != DUPLICATE) error("login of $name refused with ${result.code}")
            Thread.sleep(RELOGIN_WAIT_MS)
        }
        assumeTrue(false, "$name is already online (someone is playing it)")
        error("unreachable")
    }

    /** A fresh account name; tsps creates unknown accounts on first login. */
    fun newAccount(prefix: String): String = prefix + (System.nanoTime() % 1_000_000).toString().padStart(6, '0')

    const val PASSWORD = "gateway-test"
    private const val OK = 2
    private const val DUPLICATE = 5
    private const val RELOGIN_ATTEMPTS = 10
    private const val RELOGIN_WAIT_MS = 1_000L

    private fun isListening(port: Int) =
        runCatching { Socket().use { it.connect(InetSocketAddress("127.0.0.1", port), 500) } }.isSuccess
}
