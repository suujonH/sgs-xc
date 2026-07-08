using Sgs.DataCollection.Discovery;

namespace Sgs.DataCollection.Collector;

internal static class SgsPathRules
{
    public static bool IsAesResc(ResourceCandidate candidate) =>
        candidate.AbsolutePath.EndsWith("/libs/min/aesresc", StringComparison.OrdinalIgnoreCase);

    public static bool IsDiscoverySource(ResourceCandidate candidate) =>
        candidate.AbsolutePath.EndsWith("/index_210000.php", StringComparison.OrdinalIgnoreCase)
        || candidate.AbsolutePath.EndsWith("/startup.php", StringComparison.OrdinalIgnoreCase)
        || candidate.AbsolutePath.EndsWith("/before.min.js", StringComparison.OrdinalIgnoreCase)
        || candidate.AbsolutePath.EndsWith("/after.js", StringComparison.OrdinalIgnoreCase)
        || candidate.AbsolutePath.EndsWith("/versionConf.js", StringComparison.OrdinalIgnoreCase)
        || candidate.AbsolutePath.EndsWith("/version.json", StringComparison.OrdinalIgnoreCase)
        || candidate.AbsolutePath.EndsWith("/default.res.json", StringComparison.OrdinalIgnoreCase)
        || candidate.AbsolutePath.EndsWith("/laya_a.sgs", StringComparison.OrdinalIgnoreCase)
        || candidate.AbsolutePath.EndsWith("/laya.sgs", StringComparison.OrdinalIgnoreCase)
        || candidate.AbsolutePath.EndsWith("/Proto_w.sgs", StringComparison.OrdinalIgnoreCase)
        || candidate.AbsolutePath.EndsWith("/Proto.sgs", StringComparison.OrdinalIgnoreCase)
        || candidate.AbsolutePath.Contains("sgsGame", StringComparison.OrdinalIgnoreCase)
        || IsConfigPackagePath(candidate.AbsolutePath)
        || IsH5GlobalConfigPath(candidate.AbsolutePath);

    public static bool IsConfigPackagePath(string relativePath) =>
        relativePath.EndsWith("Config_w.sgs", StringComparison.OrdinalIgnoreCase)
        || relativePath.EndsWith("Config.sgs", StringComparison.OrdinalIgnoreCase);

    public static bool IsH5GlobalConfigPath(string relativePath) =>
        relativePath.EndsWith("h5_global_conf_w.sgs", StringComparison.OrdinalIgnoreCase)
        || relativePath.EndsWith("h5_global_conf.sgs", StringComparison.OrdinalIgnoreCase);

    public static bool IsDirectConfigJsonPath(string path)
    {
        var normalized = path.Replace('\\', '/').TrimStart('/');
        if (normalized.StartsWith("220/h5_2/", StringComparison.OrdinalIgnoreCase))
        {
            normalized = normalized["220/h5_2/".Length..];
        }

        return (normalized.StartsWith("res/config/", StringComparison.OrdinalIgnoreCase)
                || normalized.StartsWith("config/", StringComparison.OrdinalIgnoreCase))
            && normalized.EndsWith(".json", StringComparison.OrdinalIgnoreCase);
    }

    public static bool IsApiLikePath(Uri uri)
    {
        var extension = Path.GetExtension(uri.AbsolutePath);
        return extension.Equals(".php", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".html", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".htm", StringComparison.OrdinalIgnoreCase);
    }

    public static bool ShouldScanTextForResources(ResourceCandidate candidate, string relativePath)
    {
        var normalized = relativePath.Replace('\\', '/');
        return (candidate.Sources.Any(source => source.Equals("entry-script", StringComparison.OrdinalIgnoreCase))
                && candidate.AbsolutePath.EndsWith("/before.min.js", StringComparison.OrdinalIgnoreCase))
            || candidate.AbsolutePath.Contains("sgsGame", StringComparison.OrdinalIgnoreCase)
            || normalized.Contains("/sgsGame", StringComparison.OrdinalIgnoreCase)
            || normalized.Contains("/res/config/", StringComparison.OrdinalIgnoreCase)
            || normalized.Contains("/res/proto/", StringComparison.OrdinalIgnoreCase);
    }
}
