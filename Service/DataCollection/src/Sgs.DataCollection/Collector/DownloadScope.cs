using Sgs.DataCollection.Discovery;

namespace Sgs.DataCollection.Collector;

public sealed class DownloadScope
{
    private readonly Uri _entryUri;
    private readonly Uri _h5RootUri;

    public DownloadScope(string entryUrl)
    {
        _entryUri = new Uri(entryUrl);
        _h5RootUri = new Uri(_entryUri, ".");
    }

    public bool Contains(ResourceCandidate candidate)
    {
        if (candidate.Uri.Scheme != Uri.UriSchemeHttps && candidate.Uri.Scheme != Uri.UriSchemeHttp)
        {
            return false;
        }

        if (!string.Equals(candidate.Uri.Host, _entryUri.Host, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var path = candidate.Uri.AbsolutePath.Replace('\\', '/');
        if (string.Equals(path, _entryUri.AbsolutePath, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (IsAllowedEntryScriptPage(candidate, path))
        {
            return true;
        }

        if (!path.StartsWith(_h5RootUri.AbsolutePath, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (SgsPathRules.IsApiLikePath(candidate.Uri) && !IsAllowedEntryScriptPage(candidate, path))
        {
            return false;
        }

        var marker = "/res/runtime/";
        var markerIndex = path.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (markerIndex < 0)
        {
            return true;
        }

        var platformStart = markerIndex + marker.Length;
        var platformEnd = path.IndexOf('/', platformStart);
        var platform = platformEnd < 0 ? path[platformStart..] : path[platformStart..platformEnd];
        return platform.Equals("pc", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsAllowedEntryScriptPage(ResourceCandidate candidate, string normalizedPath)
    {
        return normalizedPath.Equals("/sgsCensus/startup.php", StringComparison.OrdinalIgnoreCase)
            && candidate.Sources.Any(source => source.Equals("entry-script", StringComparison.OrdinalIgnoreCase));
    }
}
