namespace Sgs.DataCollection.Collector;

public enum ResourceProcessStatus
{
    Success,
    CacheHit,
    Skipped,
    ResourceFailed,
    FatalFailed
}

public sealed record ResourceOutput(string RelativePath, byte[] Bytes);

public sealed record ResourceProcessResult(
    ResourceProcessStatus Status,
    IReadOnlyList<ResourceOutput> Outputs,
    int Created,
    int Updated,
    int Deleted)
{
    public bool IsSuccessLike => Status is ResourceProcessStatus.Success or ResourceProcessStatus.CacheHit;

    public static ResourceProcessResult Success(IReadOnlyList<ResourceOutput> outputs, int created, int updated, int deleted) =>
        new(ResourceProcessStatus.Success, outputs, created, updated, deleted);

    public static ResourceProcessResult CacheHit(IReadOnlyList<ResourceOutput> outputs) =>
        new(ResourceProcessStatus.CacheHit, outputs, 0, 0, 0);

    public static ResourceProcessResult Skipped { get; } =
        new(ResourceProcessStatus.Skipped, [], 0, 0, 0);

    public static ResourceProcessResult ResourceFailed { get; } =
        new(ResourceProcessStatus.ResourceFailed, [], 0, 0, 0);

    public static ResourceProcessResult FatalFailed { get; } =
        new(ResourceProcessStatus.FatalFailed, [], 0, 0, 0);
}
