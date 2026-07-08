namespace Sgs.DataCollection.Discovery;

public sealed class ResourceCandidate
{
    private ResourceCandidate(Uri uri, string source, Uri? referer)
    {
        Uri = uri;
        Referer = referer;
        AbsolutePath = uri.GetLeftPart(UriPartial.Path);
        QueryParameter = uri.Query.Length > 0 ? uri.Query[1..] : "";
        RequestKey = AbsolutePath + "?" + QueryParameter;
        Sources.Add(source);
    }

    public Uri Uri { get; }
    public Uri? Referer { get; }
    public string AbsolutePath { get; }
    public string QueryParameter { get; }
    public string RequestKey { get; }
    public List<string> Sources { get; } = new();

    public static ResourceCandidate Create(Uri uri, string source, Uri? referer)
    {
        var builder = new UriBuilder(uri)
        {
            Fragment = ""
        };
        return new ResourceCandidate(builder.Uri, source, referer);
    }

    public void MergeSources(IEnumerable<string> sources)
    {
        foreach (var source in sources)
        {
            if (!Sources.Contains(source, StringComparer.OrdinalIgnoreCase))
            {
                Sources.Add(source);
            }
        }
    }
}

public static class UrlIdentity
{
    public static string BasePath(Uri uri)
    {
        var isDefaultPort = (uri.Scheme == Uri.UriSchemeHttps && uri.Port == 443)
            || (uri.Scheme == Uri.UriSchemeHttp && uri.Port == 80)
            || uri.IsDefaultPort;
        return isDefaultPort ? uri.Host : uri.Host + ":" + uri.Port.ToString();
    }
}
