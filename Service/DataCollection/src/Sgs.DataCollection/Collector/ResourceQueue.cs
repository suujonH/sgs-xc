using Sgs.DataCollection.Discovery;

namespace Sgs.DataCollection.Collector;

public sealed class ResourceQueue
{
    private readonly DownloadScope _scope;
    private readonly Queue<ResourceCandidate> _queue = new();
    private readonly Dictionary<string, ResourceCandidate> _known = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _skippedByScope = new(StringComparer.OrdinalIgnoreCase);

    public ResourceQueue(DownloadScope scope)
    {
        _scope = scope;
    }

    public int EnqueuedCount => _known.Count;
    public int SkippedByScopeCount => _skippedByScope.Count;
    public IReadOnlySet<string> KnownRequestKeys => _known.Keys.ToHashSet(StringComparer.OrdinalIgnoreCase);

    public void Enqueue(ResourceCandidate candidate, bool priority = false)
    {
        if (!_scope.Contains(candidate))
        {
            SkipByScope(candidate);
            return;
        }

        if (_known.TryGetValue(candidate.RequestKey, out var existing))
        {
            existing.MergeSources(candidate.Sources);
            return;
        }

        _known[candidate.RequestKey] = candidate;
        if (!priority)
        {
            _queue.Enqueue(candidate);
            return;
        }

        var pending = _queue.ToArray();
        _queue.Clear();
        _queue.Enqueue(candidate);
        foreach (var item in pending)
        {
            _queue.Enqueue(item);
        }
    }

    public void SkipByScope(ResourceCandidate candidate)
    {
        _skippedByScope.Add(candidate.RequestKey);
    }

    public bool TryDequeue(out ResourceCandidate? candidate)
    {
        if (_queue.Count == 0)
        {
            candidate = null;
            return false;
        }

        candidate = _queue.Dequeue();
        return true;
    }
}
