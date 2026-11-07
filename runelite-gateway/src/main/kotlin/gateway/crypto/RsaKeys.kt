package gateway.crypto

import net.rsprot.crypto.rsa.RsaKeyPair
import java.math.BigInteger
import java.nio.file.Files
import java.nio.file.Path
import java.security.KeyPairGenerator
import java.security.interfaces.RSAPrivateKey

/**
 * The gateway's login key. Generated on first start and kept in `runelite-gateway/keys/` (gitignored), so
 * each checkout has its own; the modulus goes into the RSProx target.
 */
object RsaKeys {
    private const val BITS = 1024

    fun loadOrCreate(file: Path): RsaKeyPair {
        if (Files.exists(file)) {
            val values =
                Files.readAllLines(file)
                    .filter { '=' in it }
                    .associate { it.substringBefore('=') to BigInteger(it.substringAfter('='), 16) }
            return RsaKeyPair(requireNotNull(values["exponent"]), requireNotNull(values["modulus"]))
        }
        val generator = KeyPairGenerator.getInstance("RSA").apply { initialize(BITS) }
        val private = generator.generateKeyPair().private as RSAPrivateKey
        Files.createDirectories(file.parent)
        Files.writeString(file, "exponent=${private.privateExponent.toString(16)}\nmodulus=${private.modulus.toString(16)}\n")
        return RsaKeyPair(private.privateExponent, private.modulus)
    }
}
