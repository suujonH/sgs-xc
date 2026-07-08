using System.Diagnostics;
using System.Globalization;
using System.Net;
using Sgs.DataCollection.Decode;
using Sgs.DataCollection.Discovery;
using Sgs.DataCollection.Http;
using Sgs.DataCollection.Storage;

namespace Sgs.DataCollection.Collector;

public sealed class ResourceProcessor : IDisposable
{
    private readonly CliOptions _options;
    private readonly HttpResourceClient _http;
    private readonly ResourceDecoder _decoder;
    private readonly PathMapper _pathMapper;
    private readonly FileStager _storage;
    private readonly CollectorManifest _manifest;
    private readonly ResourceSkipList _skipList;
    private readonly object _stateLock = new();
    private SgsPayloadDecoder? _payloadDecoder;
    private byte[]? _aesRescBytes;

    public ResourceProcessor(
        CliOptions options,
        HttpResourceClient http,
        ResourceDecoder decoder,
        PathMapper pathMapper,
        FileStager storage,
        CollectorManifest manifest,
        ResourceSkipList skipList)
    {
        _options = options;
        _http = http;
        _decoder = decoder;
        _pathMapper = pathMapper;
        _storage = storage;
        _manifest = manifest;
        _skipList = skipList;
    }

    public async Task<ResourceProcessResult> ProcessAsync(ResourceCandidate candidate, DateTimeOffset execDatetime)
    {
        var fetchStopwatch = Stopwatch.StartNew();
        if (_skipList.Contains(candidate))
        {
            Console.WriteLine($"SKIP {candidate.Uri.AbsoluteUri} {ElapsedMs(fetchStopwatch)}ms");
            return ResourceProcessResult.Skipped;
        }

        var outputRoot = _pathMapper.Map(candidate.Uri);
        HttpHeaderSnapshot header;
        try
        {
            header = await _http.ProbeHeadersAsync(candidate.Uri, candidate.Referer);
        }
        catch (Exception)
        {
            LogFetchError(candidate, fetchStopwatch);
            return ResourceProcessResult.FatalFailed;
        }

        if (!IsSuccessfulStatus(header.StatusCode))
        {
            LogFetch(candidate, header, hit: false, fetchStopwatch);
            return IsHandledMissingStatus(header.StatusCode)
                ? ResourceProcessResult.ResourceFailed
                : ResourceProcessResult.FatalFailed;
        }

        var cacheHit = false;
        lock (_stateLock)
        {
            cacheHit = IsCacheHit(candidate, header, outputRoot);
        }

        if (cacheHit)
        {
            try
            {
                var outputs = await ReadExistingOutputsAsync(candidate);
                LogFetch(candidate, header, hit: true, fetchStopwatch);
                return ResourceProcessResult.CacheHit(outputs);
            }
            catch (Exception)
            {
                LogFetch(candidate, header, hit: true, fetchStopwatch);
                return ResourceProcessResult.FatalFailed;
            }
        }

        HttpBodyResponse body;
        try
        {
            body = await _http.GetBodyAsync(candidate.Uri, candidate.Referer);
            if (!IsSuccessfulStatus(body.StatusCode))
            {
                LogFetch(candidate, header with { StatusCode = body.StatusCode }, hit: false, fetchStopwatch);
                return IsHandledMissingStatus(body.StatusCode)
                    ? ResourceProcessResult.ResourceFailed
                    : ResourceProcessResult.FatalFailed;
            }
        }
        catch (Exception)
        {
            LogFetchError(candidate, fetchStopwatch);
            return ResourceProcessResult.FatalFailed;
        }

        DecodedResource decoded;
        var decodeStopwatch = Stopwatch.StartNew();
        try
        {
            if (SgsPathRules.IsAesResc(candidate))
            {
                SetAesRescBytes(body.Body);
            }

            decoded = _decoder.Decode(candidate, body.Body, outputRoot, GetPayloadDecoder);
            Console.WriteLine($"DECODE {candidate.Uri.AbsoluteUri} {decoded.Outputs.Count} FILES {ElapsedMs(decodeStopwatch)}ms");
        }
        catch (Exception)
        {
            Console.WriteLine($"DECODE {candidate.Uri.AbsoluteUri} FAILED {ElapsedMs(decodeStopwatch)}ms");
            LogFetch(candidate, header with { StatusCode = body.StatusCode }, hit: false, fetchStopwatch);
            return ResourceProcessResult.FatalFailed;
        }

        FileStageResult stageResult;
        try
        {
            lock (_stateLock)
            {
                stageResult = _storage.Apply(candidate, outputRoot, decoded, header, execDatetime);
            }
        }
        catch (Exception)
        {
            LogFetch(candidate, header with { StatusCode = body.StatusCode }, hit: false, fetchStopwatch);
            return ResourceProcessResult.FatalFailed;
        }

        var successOutputs = CreateOutputs(decoded);
        LogFetch(candidate, header with { StatusCode = body.StatusCode }, hit: false, fetchStopwatch);
        return ResourceProcessResult.Success(
            successOutputs,
            stageResult.Created,
            stageResult.Updated,
            stageResult.Deleted);
    }

    private bool IsCacheHit(ResourceCandidate candidate, HttpHeaderSnapshot header, string outputRoot)
    {
        if (header.Etag is null || header.LastModified is null || header.ContentLength is null)
        {
            return false;
        }

        var previous = _manifest.TryGet(candidate.RequestKey);
        if (previous is null)
        {
            return false;
        }

        var relativeRoot = NormalizeRelative(Path.GetRelativePath(_options.RepoDir, outputRoot));
        if (!string.Equals(previous.OutputRoot, relativeRoot, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (previous.Etag != header.Etag)
        {
            return false;
        }

        if (previous.LastModified?.ToUniversalTime() != header.LastModified.Value.ToUniversalTime())
        {
            return false;
        }

        if (previous.ContentLength != header.ContentLength)
        {
            return false;
        }

        return _manifest.OutputsExist(_options.RepoDir, candidate.RequestKey);
    }

    private async Task<IReadOnlyList<ResourceOutput>> ReadExistingOutputsAsync(ResourceCandidate candidate)
    {
        ManifestOutput[] manifestOutputs;
        lock (_stateLock)
        {
            var manifestItem = _manifest.TryGet(candidate.RequestKey);
            if (manifestItem is null)
            {
                return [];
            }

            manifestOutputs = manifestItem.Outputs.ToArray();
        }

        var outputs = new List<ResourceOutput>();
        foreach (var output in manifestOutputs)
        {
            var absolute = CollectorManifest.ResolveRepositoryPath(_options.RepoDir, output.Path);
            if (!File.Exists(absolute))
            {
                continue;
            }

            var bytes = await File.ReadAllBytesAsync(absolute);
            if (SgsPathRules.IsAesResc(candidate))
            {
                SetAesRescBytes(bytes);
            }

            outputs.Add(new ResourceOutput(output.Path, bytes));
        }

        return outputs;
    }

    private IReadOnlyList<ResourceOutput> CreateOutputs(DecodedResource decoded)
    {
        return decoded.Outputs
            .Select(output => new ResourceOutput(NormalizeRelative(Path.GetRelativePath(_options.RepoDir, output.AbsolutePath)), output.Bytes))
            .ToArray();
    }

    private SgsPayloadDecoder GetPayloadDecoder()
    {
        lock (_stateLock)
        {
            if (_payloadDecoder is not null)
            {
                return _payloadDecoder;
            }

            if (_aesRescBytes is null)
            {
                throw new InvalidOperationException("aesresc is not available. It must be processed before encrypted SGS resources.");
            }

            _payloadDecoder = new SgsPayloadDecoder(_aesRescBytes);
            return _payloadDecoder;
        }
    }

    private void SetAesRescBytes(byte[] bytes)
    {
        lock (_stateLock)
        {
            _aesRescBytes = bytes;
            _payloadDecoder?.Dispose();
            _payloadDecoder = null;
        }
    }

    public void Dispose()
    {
        lock (_stateLock)
        {
            _payloadDecoder?.Dispose();
        }
    }

    private static bool IsSuccessfulStatus(HttpStatusCode statusCode) => (int)statusCode is >= 200 and <= 299;

    private static bool IsHandledMissingStatus(HttpStatusCode statusCode) =>
        statusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone;

    private static string NormalizeRelative(string path) => path.Replace('\\', '/');

    private static void LogFetch(ResourceCandidate candidate, HttpHeaderSnapshot header, bool hit, Stopwatch stopwatch)
    {
        var suffix = hit ? " HIT" : "";
        Console.WriteLine(
            $"FETCH {candidate.Uri.AbsoluteUri} status={(int)header.StatusCode} etag={FormatEtag(header.Etag)} lastModified={FormatLastModified(header.LastModified)} contentLength={FormatContentLength(header.ContentLength)}{suffix} {ElapsedMs(stopwatch)}ms");
    }

    private static void LogFetchError(ResourceCandidate candidate, Stopwatch stopwatch)
    {
        Console.WriteLine($"FETCH {candidate.Uri.AbsoluteUri} status=ERROR etag= lastModified= contentLength= {ElapsedMs(stopwatch)}ms");
    }

    private static string FormatEtag(string? etag)
    {
        if (string.IsNullOrEmpty(etag))
        {
            return "";
        }

        return etag.StartsWith("\"", StringComparison.Ordinal) && etag.EndsWith("\"", StringComparison.Ordinal) && etag.Length >= 2
            ? etag[1..^1]
            : etag;
    }

    private static string FormatLastModified(DateTimeOffset? value) =>
        value is null ? "" : value.Value.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss'Z'", CultureInfo.InvariantCulture);

    private static string FormatContentLength(long? value) =>
        value?.ToString(CultureInfo.InvariantCulture) ?? "";

    private static long ElapsedMs(Stopwatch stopwatch) => stopwatch.ElapsedMilliseconds;
}
