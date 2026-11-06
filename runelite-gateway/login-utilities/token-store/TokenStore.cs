using System;
using System.IO;
using System.Text;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

// A pipe-only Windows CurrentUser DPAPI helper. No token/password is accepted as an argument.
static class TokenStore {
    internal sealed class Account {
        internal readonly string Username, Token;
        internal Account(string username, string token) { Username = username; Token = token; }
    }
    static readonly Encoding Utf8 = new UTF8Encoding(false, true);
    static byte[] Entropy(string scope) { return Utf8.GetBytes("TSPS Login Utilities token v1\n" + scope); }
    static void ValidateScope(string scope) {
        if (scope == null || !Regex.IsMatch(scope, @"\A[a-f0-9]{64}\z")) throw new IOException();
    }
    static void Validate(Account account) {
        if (account == null || !Regex.IsMatch(account.Username ?? "", @"\A[A-Za-z0-9 _-]{1,12}\z")
            || !Regex.IsMatch(account.Token ?? "", @"\A[A-Za-z0-9_-]{43}\z")) throw new IOException();
    }
    internal static string FileName(string root, string scope) {
        ValidateScope(scope);
        return Path.Combine(root, scope, "login-token.bin");
    }
    static string Encode(string value) { return Convert.ToBase64String(Utf8.GetBytes(value)); }
    static string Decode(string value) { return Utf8.GetString(Convert.FromBase64String(value)); }
    internal static void Store(string root, string scope, Account account) {
        Validate(account);
        string destination = FileName(root, scope);
        byte[] clear = Utf8.GetBytes("1\n" + Encode(account.Username) + "\n" + Encode(account.Token));
        byte[] encrypted;
        try { encrypted = ProtectedData.Protect(clear, Entropy(scope), DataProtectionScope.CurrentUser); }
        finally { Array.Clear(clear, 0, clear.Length); }
        Directory.CreateDirectory(Path.GetDirectoryName(destination));
        string temporary = destination + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try {
            File.WriteAllBytes(temporary, encrypted);
            if (File.Exists(destination)) File.Replace(temporary, destination, null, true);
            else File.Move(temporary, destination);
        } finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    internal static Account Read(string root, string scope) {
        string file = FileName(root, scope);
        if (!File.Exists(file)) return null;
        if (new FileInfo(file).Length > 65536) throw new IOException();
        byte[] clear = ProtectedData.Unprotect(File.ReadAllBytes(file), Entropy(scope), DataProtectionScope.CurrentUser);
        try {
            string[] fields = Utf8.GetString(clear).Split('\n');
            if (fields.Length != 3 || fields[0] != "1") throw new IOException();
            Account account = new Account(Decode(fields[1]), Decode(fields[2]));
            Validate(account);
            return account;
        } finally { Array.Clear(clear, 0, clear.Length); }
    }
    internal static int Command(string command, string scope, string root, TextReader input, TextWriter output) {
        try {
            ValidateScope(scope);
            if (command == "--login-token-store") {
                StringBuilder text = new StringBuilder();
                char[] buffer = new char[512]; int count;
                while ((count = input.Read(buffer, 0, buffer.Length)) > 0) {
                    text.Append(buffer, 0, count);
                    if (text.Length > 4096) throw new IOException();
                }
                string[] fields = text.ToString().TrimEnd('\r', '\n').Split('\n');
                if (fields.Length != 2) throw new IOException();
                Store(root, scope, new Account(Decode(fields[0].TrimEnd('\r')), Decode(fields[1].TrimEnd('\r'))));
                output.WriteLine("OK");
            } else if (command == "--login-token-forget") {
                File.Delete(FileName(root, scope)); output.WriteLine("OK");
            } else if (command == "--login-token-read" || command == "--login-token-info") {
                Account account = Read(root, scope);
                if (account == null) output.WriteLine("NONE");
                else {
                    output.WriteLine("OK"); output.WriteLine(Encode(account.Username));
                    if (command == "--login-token-read") output.WriteLine(Encode(account.Token));
                }
            } else throw new IOException();
            output.Flush(); return 0;
        } catch { output.WriteLine("ERROR"); output.Flush(); return 1; }
    }
    [STAThread] static int Main(string[] args) {
        if (args.Length != 2 || Environment.OSVersion.Platform != PlatformID.Win32NT) return 1;
        string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TSPS", "LoginUtilities");
        using (var input = new StreamReader(Console.OpenStandardInput(), Utf8))
        using (var output = new StreamWriter(Console.OpenStandardOutput(), Utf8))
            return Command(args[0], args[1], root, input, output);
    }
}
