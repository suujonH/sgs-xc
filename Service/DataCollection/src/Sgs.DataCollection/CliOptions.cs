using System.Globalization;

namespace Sgs.DataCollection;

public sealed class CliOptions
{
    public const string EntryUrl = "https://web.sanguosha.com/220/h5_2/index_210000.php";
    private const int DefaultProcessCount = 16;

    public string RepoDir { get; init; } = Directory.GetCurrentDirectory();
    public int TimeoutSeconds { get; init; } = 60;
    public int ProcessCount { get; init; } = DefaultProcessCount;

    public static CliOptions Parse(string[] args)
    {
        var supportedKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "repo-dir",
            "timeout-seconds",
            "process-count"
        };
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        for (var i = 0; i < args.Length; i++)
        {
            var arg = args[i];
            if (!arg.StartsWith("--", StringComparison.Ordinal))
            {
                throw new ArgumentException($"Unexpected argument {arg}");
            }

            var key = arg[2..];
            if (!supportedKeys.Contains(key))
            {
                throw new ArgumentException($"Unknown option --{key}");
            }

            if (i + 1 >= args.Length)
            {
                throw new ArgumentException($"Missing value for --{key}");
            }

            values[key] = args[++i];
        }

        string Get(string key, string fallback) => values.TryGetValue(key, out var value) ? value : fallback;

        int GetInt(string key, int fallback)
        {
            var text = Get(key, fallback.ToString(CultureInfo.InvariantCulture));
            return int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) ? value : fallback;
        }

        return new CliOptions
        {
            RepoDir = Path.GetFullPath(Get("repo-dir", Directory.GetCurrentDirectory())),
            TimeoutSeconds = GetInt("timeout-seconds", 60),
            ProcessCount = Math.Max(1, GetInt("process-count", DefaultProcessCount))
        };
    }
}
