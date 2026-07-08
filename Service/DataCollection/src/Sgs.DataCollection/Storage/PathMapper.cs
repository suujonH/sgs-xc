using System.Runtime.InteropServices;

namespace Sgs.DataCollection.Storage;

public sealed class PathMapper
{
    private readonly string _repoDir;

    public PathMapper(string repoDir)
    {
        _repoDir = repoDir;
    }

    public string Map(Uri uri)
    {
        var basePath = Sgs.DataCollection.Discovery.UrlIdentity.BasePath(uri);
        var baseSegment = ContainsInvalidFileNameChars(basePath) ? EscapeSegment(basePath) : basePath;
        var segments = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Select(Uri.UnescapeDataString)
            .ToArray();

        if (segments.Length == 0)
        {
            segments = ["index"];
        }

        var escapeAll = segments.Any(ContainsInvalidFileNameChars);
        var safeSegments = escapeAll ? segments.Select(EscapeSegment).ToArray() : segments;
        var root = Path.Combine(_repoDir, "data", baseSegment);
        var mapped = Path.GetFullPath(Path.Combine([root, .. safeSegments]));
        var fullRoot = Path.GetFullPath(root);
        var rootWithSeparator = fullRoot.EndsWith(Path.DirectorySeparatorChar)
            ? fullRoot
            : fullRoot + Path.DirectorySeparatorChar;

        if (!mapped.StartsWith(rootWithSeparator, StringComparison.OrdinalIgnoreCase)
            && !string.Equals(mapped, fullRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new IOException($"Mapped URL path escapes base output directory: {uri.AbsolutePath}");
        }

        return mapped;
    }

    public static string[] SplitPortablePath(string portablePath)
    {
        return portablePath.Split(['/', '\\'], StringSplitOptions.RemoveEmptyEntries);
    }

    internal static bool ContainsInvalidFileNameChars(string segment)
    {
        if (string.IsNullOrEmpty(segment))
        {
            return true;
        }

        if (segment is "." or "..")
        {
            return true;
        }

        if (segment.IndexOf('\0') >= 0 || segment.IndexOf('/') >= 0 || segment.IndexOf('\\') >= 0)
        {
            return true;
        }

        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return false;
        }

        if (segment.IndexOfAny(['<', '>', ':', '"', '/', '\\', '|', '?', '*']) >= 0)
        {
            return true;
        }

        if (segment[^1] == ' ' || segment[^1] == '.')
        {
            return true;
        }

        foreach (var ch in segment)
        {
            if (char.IsControl(ch))
            {
                return true;
            }
        }

        var name = segment;
        var dot = name.IndexOf('.');
        if (dot >= 0)
        {
            name = name[..dot];
        }

        return name.Equals("CON", StringComparison.OrdinalIgnoreCase)
            || name.Equals("PRN", StringComparison.OrdinalIgnoreCase)
            || name.Equals("AUX", StringComparison.OrdinalIgnoreCase)
            || name.Equals("NUL", StringComparison.OrdinalIgnoreCase)
            || IsDeviceName(name, "COM")
            || IsDeviceName(name, "LPT");
    }

    private static bool IsDeviceName(string value, string prefix)
    {
        return value.Length == 4
            && value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
            && value[3] is >= '1' and <= '9';
    }

    internal static string EscapeSegment(string value)
    {
        return string.Concat(System.Text.Encoding.UTF8.GetBytes(value).Select(b => "%" + b.ToString("X2")));
    }
}
