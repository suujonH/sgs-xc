namespace Sgs.DataCollection.Collector;

public sealed record CollectorRunResult(
    int Processed,
    int Succeeded,
    int ResourceFailures,
    int FatalFailures,
    int CacheHits,
    int Enqueued,
    int SkippedByScope,
    int SkippedByResourceSkip,
    int RemovedStaleResources,
    bool DiscoveryComplete,
    int Created,
    int Updated,
    int Deleted,
    IReadOnlyList<string> FailedUrls)
{
    public string ToSummaryText()
    {
        var failed = FailedUrls.Count;
        var summary = failed == 0
            ? $"Success completed. {Created} created, {Updated} updated, {Deleted} deteled."
            : $"Success completed. {Created} created, {Updated} updated, {Deleted} deteled, {failed} failed.";
        if (failed == 0)
        {
            return summary;
        }

        return summary + Environment.NewLine + Environment.NewLine + "Failed list:" + Environment.NewLine + string.Join(Environment.NewLine, FailedUrls);
    }
}
