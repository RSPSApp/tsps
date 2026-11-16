package gateway.tsps

import java.io.IOException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

/**
 * Reads a tsps content resource (`/api/<name>`, next to the game socket): its body, "" when tsps
 * doesn't serve it (404), null when tsps can't be reached or fails.
 */
class TspsContent(private val url: String) : () -> String? {
    // HTTP/1.1: the default HTTP/2 asks to upgrade the connection, and tsps hands upgrades to its game socket.
    // Built on the first read: a client starts its selector thread, which a gateway that never started mustn't leave.
    private val client: HttpClient by lazy { HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(CONNECT_TIMEOUT).build() }

    override fun invoke(): String? =
        try {
            val response = client.send(HttpRequest.newBuilder(URI.create(url)).timeout(REQUEST_TIMEOUT).GET().build(), HttpResponse.BodyHandlers.ofString())
            when (response.statusCode()) {
                OK -> response.body()
                NOT_FOUND -> ""
                else -> null
            }
        } catch (e: IOException) {
            null
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            null
        }

    private companion object {
        val CONNECT_TIMEOUT: Duration = Duration.ofSeconds(2)
        val REQUEST_TIMEOUT: Duration = Duration.ofSeconds(10)
        const val OK = 200
        const val NOT_FOUND = 404
    }
}
