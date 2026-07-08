using Sgs.DataCollection.Discovery;
using Sgs.DataCollection.Git;
using Sgs.DataCollection.Storage;

namespace Sgs.DataCollection.Collector;

public sealed class CollectorRunner
{
    private readonly DateTimeOffset _execDatetime;
    private readonly ResourceQueue _queue;
    private readonly ResourceProcessor _processor;
    private readonly SgsDiscoveryEngine _discovery;
    private readonly FileStager _storage;
    private readonly GitRepository _git;
    private readonly int _processCount;

    public CollectorRunner(
        DateTimeOffset execDatetime,
        ResourceQueue queue,
        ResourceProcessor processor,
        SgsDiscoveryEngine discovery,
        FileStager storage,
        GitRepository git,
        int processCount)
    {
        _execDatetime = execDatetime;
        _queue = queue;
        _processor = processor;
        _discovery = discovery;
        _storage = storage;
        _git = git;
        _processCount = Math.Max(1, processCount);
    }

    public async Task<CollectorRunResult> RunAsync()
    {
        _queue.Enqueue(ResourceCandidate.Create(new Uri(CliOptions.EntryUrl), "entry", null));

        var processed = 0;
        var succeeded = 0;
        var resourceFailures = 0;
        var fatalFailures = 0;
        var cacheHits = 0;
        var skippedByResourceSkip = 0;
        var discoveryComplete = true;
        var created = 0;
        var updated = 0;
        var deleted = 0;
        var failedUrls = new List<string>();

        ResourceCandidate? pendingSerialCandidate = null;
        while (true)
        {
            ResourceCandidate? candidate;
            if (pendingSerialCandidate is not null)
            {
                candidate = pendingSerialCandidate;
                pendingSerialCandidate = null;
            }
            else if (!_queue.TryDequeue(out candidate))
            {
                break;
            }

            if (candidate is null)
            {
                continue;
            }

            if (_processCount <= 1 || RequiresSerialProcessing(candidate))
            {
                ApplyProcessResult(await ProcessOneAsync(candidate));
                continue;
            }

            var batch = new List<ResourceCandidate> { candidate };
            while (batch.Count < _processCount && _queue.TryDequeue(out var next))
            {
                if (next is null)
                {
                    continue;
                }

                if (RequiresSerialProcessing(next))
                {
                    pendingSerialCandidate = next;
                    break;
                }

                batch.Add(next);
            }

            var batchResults = await Task.WhenAll(batch.Select(ProcessOneAsync));
            foreach (var result in batchResults)
            {
                ApplyProcessResult(result);
            }
        }

        var removedStaleResources = 0;
        if (fatalFailures == 0 && resourceFailures == 0 && discoveryComplete)
        {
            try
            {
                var cleanup = _storage.RemoveUnseenResources(_queue.KnownRequestKeys);
                removedStaleResources = cleanup.RemovedResources;
                deleted += cleanup.Deleted;
            }
            catch (Exception)
            {
                fatalFailures++;
                failedUrls.Add("cleanup");
            }
        }

        var finalResult = CreateResult();
        try
        {
            _git.CommitAllIfChanged(finalResult.ToSummaryText());
        }
        catch (Exception)
        {
            fatalFailures++;
            failedUrls.Add("git-commit");
            finalResult = CreateResult();
        }

        return finalResult;

        async Task<CandidateProcessResult> ProcessOneAsync(ResourceCandidate candidate)
        {
            try
            {
                return new CandidateProcessResult(candidate, await _processor.ProcessAsync(candidate, _execDatetime), null);
            }
            catch (Exception ex)
            {
                return new CandidateProcessResult(candidate, ResourceProcessResult.FatalFailed, ex);
            }
        }

        void ApplyProcessResult(CandidateProcessResult processResult)
        {
            processed++;
            var candidate = processResult.Candidate;
            var result = processResult.Result;
            created += result.Created;
            updated += result.Updated;
            deleted += result.Deleted;

            if (processResult.Exception is not null)
            {
                fatalFailures++;
                discoveryComplete = false;
                failedUrls.Add(candidate.Uri.AbsoluteUri);
                return;
            }

            if (result.IsSuccessLike)
            {
                succeeded++;
                if (result.Status == ResourceProcessStatus.CacheHit)
                {
                    cacheHits++;
                }

                var discoveryResult = _discovery.Discover(candidate, result.Outputs);
                if (!discoveryResult.Complete)
                {
                    discoveryComplete = false;
                    failedUrls.Add("discovery-incomplete");
                }

                return;
            }

            if (result.Status == ResourceProcessStatus.Skipped)
            {
                skippedByResourceSkip++;
                if (SgsPathRules.IsDiscoverySource(candidate))
                {
                    discoveryComplete = false;
                    failedUrls.Add("discovery-incomplete");
                }

                return;
            }

            if (result.Status == ResourceProcessStatus.FatalFailed)
            {
                fatalFailures++;
            }
            else
            {
                resourceFailures++;
            }

            failedUrls.Add(candidate.Uri.AbsoluteUri);
            if (SgsPathRules.IsDiscoverySource(candidate))
            {
                discoveryComplete = false;
            }
        }

        CollectorRunResult CreateResult() =>
            new(
                processed,
                succeeded,
                resourceFailures,
                fatalFailures,
                cacheHits,
                _queue.EnqueuedCount,
                _queue.SkippedByScopeCount,
                skippedByResourceSkip,
                removedStaleResources,
                discoveryComplete,
                created,
                updated,
                deleted,
                failedUrls.Distinct(StringComparer.OrdinalIgnoreCase).ToArray());
    }

    private static bool RequiresSerialProcessing(ResourceCandidate candidate) =>
        SgsPathRules.IsAesResc(candidate) || SgsPathRules.IsDiscoverySource(candidate);
}

internal sealed record CandidateProcessResult(ResourceCandidate Candidate, ResourceProcessResult Result, Exception? Exception);
