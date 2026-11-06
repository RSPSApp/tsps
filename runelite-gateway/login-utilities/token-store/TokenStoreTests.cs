using System;
using System.IO;
using System.Text;

static class TokenStoreTests {
    static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    static void Reject(Action action, string message) {
        bool rejected = false; try { action(); } catch { rejected = true; }
        Check(rejected, message);
    }
    static int Main() {
        string root = Path.Combine(Path.GetTempPath(), "LoginUtilities-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try {
            string first = new string('a', 64), second = new string('b', 64), secret = new string('x', 43);
            var account = new TokenStore.Account("Disposable", secret);
            TokenStore.Store(root, first, account);
            var loaded = TokenStore.Read(root, first);
            Check(loaded.Username == "Disposable" && loaded.Token == secret, "Token round trip failed");
            Check(TokenStore.Read(root, second) == null, "Server namespaces were mixed");
            string file = TokenStore.FileName(root, first);
            byte[] bytes = File.ReadAllBytes(file);
            Check(!Encoding.UTF8.GetString(bytes).Contains(secret), "Plaintext token appeared on disk");
            Directory.CreateDirectory(Path.GetDirectoryName(TokenStore.FileName(root, second)));
            File.Copy(file, TokenStore.FileName(root, second));
            Reject(() => TokenStore.Read(root, second), "Copied credential decrypted for another server");
            bytes[bytes.Length / 2] ^= 1; File.WriteAllBytes(file, bytes);
            Reject(() => TokenStore.Read(root, first), "Modified ciphertext was accepted");
            Reject(() => TokenStore.Store(root, first, new TokenStore.Account("Disposable", "not-a-token")), "Malformed token accepted");
            Reject(() => TokenStore.Read(root, "../escape"), "Scope path traversal accepted");
            var output = new StringWriter();
            int code = TokenStore.Command("--login-token-forget", first, root, new StringReader(""), output);
            Check(code == 0 && output.ToString().Trim() == "OK" && TokenStore.Read(root, first) == null, "Forget failed");
            output = new StringWriter();
            code = TokenStore.Command("--unknown", first, root, new StringReader(""), output);
            Check(code != 0 && output.ToString().Trim() == "ERROR", "Unknown command accepted");
            Console.WriteLine("PASS: DPAPI round trip, server isolation, ciphertext protection, validation, forgetting and command rejection");
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
