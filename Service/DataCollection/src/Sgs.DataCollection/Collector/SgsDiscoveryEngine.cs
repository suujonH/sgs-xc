using System.Diagnostics;
using System.Security.Cryptography;
using Sgs.DataCollection.Discovery;

namespace Sgs.DataCollection.Collector;

public sealed class SgsDiscoveryEngine
{
    private readonly StaticResourceParser _parser;
    private readonly ResourceQueue _queue;
    private readonly HashSet<string> _parsedTextHashes = new(StringComparer.Ordinal);

    public SgsDiscoveryEngine(StaticResourceParser parser, ResourceQueue queue)
    {
        _parser = parser;
        _queue = queue;
    }

    public DiscoveryResult Discover(ResourceCandidate candidate, IReadOnlyList<ResourceOutput> outputs)
    {
        foreach (var output in outputs)
        {
            TryParseOutput(candidate, output.RelativePath, output.Bytes);
        }

        return new DiscoveryResult(true);
    }

    private void TryParseOutput(ResourceCandidate candidate, string relativePath, byte[] bytes)
    {
        if (!_parser.TryDecodeText(bytes, out var text))
        {
            return;
        }

        var hash = Sha256Hex(bytes);
        if (!_parsedTextHashes.Add(hash + ":" + relativePath))
        {
            return;
        }

        var enqueuedBefore = _queue.EnqueuedCount;
        var outputStopwatch = Stopwatch.StartNew();
        try
        {
            ParseTextOutput(candidate, relativePath, text);
        }
        finally
        {
            LogAddedFiles(enqueuedBefore, outputStopwatch);
        }
    }

    private void ParseTextOutput(ResourceCandidate candidate, string relativePath, string text)
    {
        var uri = candidate.Uri;
        if (candidate.AbsolutePath.EndsWith("/index_210000.php", StringComparison.OrdinalIgnoreCase))
        {
            var snapshot = _parser.ParseEntry(text, uri);
            foreach (var script in snapshot.EffectiveScripts)
            {
                _queue.Enqueue(ResourceCandidate.Create(script, "entry-script", uri));
            }

            EnqueueExact("libs/min/aesresc", "entry-aesresc", uri, priority: true);
        }

        if (candidate.AbsolutePath.EndsWith("/versionConf.js", StringComparison.OrdinalIgnoreCase))
        {
            EnqueueExact("version.json", "version-conf", uri);
        }

        if (candidate.AbsolutePath.EndsWith("/version.json", StringComparison.OrdinalIgnoreCase))
        {
            foreach (var path in _parser.ParseVersionJson(text))
            {
                if (StaticResourceParser.ContainsTemplatePlaceholder(path) || SgsPathRules.IsDirectConfigJsonPath(path))
                {
                    continue;
                }

                EnqueueExact(path, "version-json", uri);
            }
        }

        if (candidate.AbsolutePath.EndsWith("/default.res.json", StringComparison.OrdinalIgnoreCase))
        {
            foreach (var item in _parser.ParseDefaultResJson(text))
            {
                if (SgsPathRules.IsDirectConfigJsonPath(item))
                {
                    continue;
                }

                EnqueueRelative(item, "default-res", uri);
            }
        }

        if (candidate.AbsolutePath.EndsWith("/after.js", StringComparison.OrdinalIgnoreCase))
        {
            EnqueueExact("libs/min/laya_a.sgs", "after-js", uri);
            EnqueueExact("libs/min/laya.sgs", "after-js-fallback", uri);
            EnqueueExact("sgsGame_a.sgs", "after-js", uri);
            EnqueueExact("sgsGame.sgs", "after-js-fallback", uri);
        }

        if (relativePath.EndsWith("laya.core.min.js", StringComparison.OrdinalIgnoreCase))
        {
            EnqueueExact("libs/min/aesresc", "laya-core", uri);
        }

        if (!SgsPathRules.ShouldScanTextForResources(candidate, relativePath))
        {
            return;
        }

        foreach (var resourcePath in _parser.ScanStaticResourcePaths(text))
        {
            EnqueueRelative(resourcePath, "static-text-scan", uri);
        }
    }

    private void EnqueueRelative(string value, string source, Uri referer)
    {
        if (!_parser.TryCreateResourceUri(value, referer, out var uri))
        {
            return;
        }

        if (source == "static-text-scan" && SgsPathRules.IsApiLikePath(uri))
        {
            _queue.SkipByScope(ResourceCandidate.Create(uri, source, referer));
            return;
        }

        if (source == "static-text-scan"
            && !string.Equals(uri.Host, new Uri(CliOptions.EntryUrl).Host, StringComparison.OrdinalIgnoreCase))
        {
            var ext = Path.GetExtension(uri.AbsolutePath);
            if (string.IsNullOrEmpty(ext)
                || ext.Equals(".html", StringComparison.OrdinalIgnoreCase)
                || ext.Equals(".php", StringComparison.OrdinalIgnoreCase))
            {
                _queue.SkipByScope(ResourceCandidate.Create(uri, source, referer));
                return;
            }
        }

        var relative = _parser.ToH5RelativePath(uri);
        if (relative is not null && SgsPathRules.IsDirectConfigJsonPath(relative))
        {
            return;
        }

        if (source == "static-text-scan" && relative is not null && SgsPathRules.IsConfigPackagePath(relative))
        {
            return;
        }

        _queue.Enqueue(ResourceCandidate.Create(uri, source, referer));
    }

    private void EnqueueExact(string relativePath, string source, Uri referer, bool priority = false)
    {
        var uri = new Uri(new Uri(CliOptions.EntryUrl), relativePath);
        _queue.Enqueue(ResourceCandidate.Create(uri, source, referer), priority);
    }

    private static string Sha256Hex(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    private void LogAddedFiles(int enqueuedBefore, Stopwatch stopwatch)
    {
        var added = _queue.EnqueuedCount - enqueuedBefore;
        if (added > 0)
        {
            Console.WriteLine($"ADD {added} FILES TO DOWNLOAD LIST {ElapsedMs(stopwatch)}ms");
        }
    }

    private static long ElapsedMs(Stopwatch stopwatch) => stopwatch.ElapsedMilliseconds;
}

public sealed record DiscoveryResult(bool Complete);
