using System.Net;

namespace Sgs.DataCollection.Http;

public sealed class HttpResourceClient
{
    private readonly HttpClient _probeClient;
    private readonly HttpClient _bodyClient;
    private readonly TimeSpan _timeout;

    public HttpResourceClient(int timeoutSeconds)
    {
        _timeout = TimeSpan.FromSeconds(timeoutSeconds);
        var probeHandler = new HttpClientHandler
        {
            AutomaticDecompression = DecompressionMethods.None,
            AllowAutoRedirect = true
        };
        _probeClient = new HttpClient(probeHandler)
        {
            Timeout = Timeout.InfiniteTimeSpan
        };

        var bodyHandler = new HttpClientHandler
        {
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate | DecompressionMethods.Brotli,
            AllowAutoRedirect = true
        };
        _bodyClient = new HttpClient(bodyHandler)
        {
            Timeout = Timeout.InfiniteTimeSpan
        };
    }

    public async Task<HttpHeaderSnapshot> ProbeHeadersAsync(Uri uri, Uri? referer)
    {
        using var cts = new CancellationTokenSource(_timeout);
        using var head = new HttpRequestMessage(HttpMethod.Head, uri);
        ApplyHeaders(head, referer);
        using var response = await _probeClient.SendAsync(head, HttpCompletionOption.ResponseHeadersRead, cts.Token);

        if (response.StatusCode is HttpStatusCode.MethodNotAllowed or HttpStatusCode.Forbidden or HttpStatusCode.NotImplemented)
        {
            using var get = new HttpRequestMessage(HttpMethod.Get, uri);
            ApplyHeaders(get, referer);
            using var getResponse = await _probeClient.SendAsync(get, HttpCompletionOption.ResponseHeadersRead, cts.Token);
            return HttpHeaderSnapshot.From(getResponse);
        }

        return HttpHeaderSnapshot.From(response);
    }

    public async Task<HttpBodyResponse> GetBodyAsync(Uri uri, Uri? referer)
    {
        using var cts = new CancellationTokenSource(_timeout);
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        ApplyHeaders(request, referer);
        using var response = await _bodyClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cts.Token);
        var bytes = await response.Content.ReadAsByteArrayAsync(cts.Token);
        return HttpBodyResponse.From(response, bytes);
    }

    private static void ApplyHeaders(HttpRequestMessage request, Uri? referer)
    {
        var kind = RequestKind.From(request.RequestUri!, referer);
        request.Headers.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36");
        request.Headers.AcceptLanguage.ParseAdd("zh-CN,zh;q=0.9");
        request.Headers.TryAddWithoutValidation("sec-ch-ua", "\"Google Chrome\";v=\"149\", \"Chromium\";v=\"149\", \"Not)A;Brand\";v=\"24\"");
        request.Headers.TryAddWithoutValidation("sec-ch-ua-mobile", "?0");
        request.Headers.TryAddWithoutValidation("sec-ch-ua-platform", "\"Windows\"");
        request.Headers.Accept.ParseAdd(kind.Accept);

        if (referer is null)
        {
            request.Headers.TryAddWithoutValidation("Upgrade-Insecure-Requests", "1");
            request.Headers.TryAddWithoutValidation("Sec-Fetch-Dest", kind.FetchDest);
            request.Headers.TryAddWithoutValidation("Sec-Fetch-Mode", kind.FetchMode);
            request.Headers.TryAddWithoutValidation("Sec-Fetch-Site", "none");
            request.Headers.TryAddWithoutValidation("Sec-Fetch-User", "?1");
        }
        else
        {
            request.Headers.Referrer = referer;
            request.Headers.TryAddWithoutValidation("Sec-Fetch-Dest", kind.FetchDest);
            request.Headers.TryAddWithoutValidation("Sec-Fetch-Mode", kind.FetchMode);
            request.Headers.TryAddWithoutValidation("Sec-Fetch-Site", SameOrigin(request.RequestUri!, referer) ? "same-origin" : "cross-site");
        }
    }

    private static bool SameOrigin(Uri a, Uri b) =>
        string.Equals(a.Scheme, b.Scheme, StringComparison.OrdinalIgnoreCase)
        && string.Equals(a.Host, b.Host, StringComparison.OrdinalIgnoreCase)
        && a.Port == b.Port;

}

internal sealed record RequestKind(string Accept, string FetchDest, string FetchMode)
{
    public static RequestKind From(Uri uri, Uri? referer)
    {
        if (referer is null)
        {
            return new RequestKind("text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7", "document", "navigate");
        }

        var extension = Path.GetExtension(uri.AbsolutePath).ToLowerInvariant();
        if (extension is ".js" or ".php")
        {
            return new RequestKind("*/*", "script", "no-cors");
        }

        if (extension is ".css")
        {
            return new RequestKind("text/css,*/*;q=0.1", "style", "no-cors");
        }

        if (extension is ".png" or ".jpg" or ".jpeg" or ".webp" or ".gif" or ".svg" or ".avif" or ".ico")
        {
            return new RequestKind("image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8", "image", "no-cors");
        }

        if (extension is ".woff" or ".woff2" or ".ttf" or ".otf")
        {
            return new RequestKind("*/*", "font", "cors");
        }

        return new RequestKind("*/*", "empty", "cors");
    }
}

public sealed record HttpHeaderSnapshot(
    HttpStatusCode StatusCode,
    string? Etag,
    DateTimeOffset? LastModified,
    long? ContentLength)
{
    public static HttpHeaderSnapshot From(HttpResponseMessage response)
    {
        return new HttpHeaderSnapshot(
            response.StatusCode,
            response.Headers.ETag?.Tag,
            response.Content.Headers.LastModified,
            response.Content.Headers.ContentLength);
    }
}

public sealed record HttpBodyResponse(
    HttpStatusCode StatusCode,
    byte[] Body)
{
    public static HttpBodyResponse From(HttpResponseMessage response, byte[] body)
    {
        return new HttpBodyResponse(
            response.StatusCode,
            body);
    }
}
