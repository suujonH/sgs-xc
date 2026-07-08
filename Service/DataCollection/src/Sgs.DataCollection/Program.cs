using Sgs.DataCollection;
using Sgs.DataCollection.Collector;
using Sgs.DataCollection.Decode;
using Sgs.DataCollection.Discovery;
using Sgs.DataCollection.Git;
using Sgs.DataCollection.Http;
using Sgs.DataCollection.Storage;

var options = CliOptions.Parse(args);
var execDatetime = DateTimeOffset.UtcNow;

Directory.CreateDirectory(options.RepoDir);

var git = new GitRepository(options.RepoDir);
git.EnsureInitialized();

var manifest = CollectorManifest.Load(Path.Combine(options.RepoDir, "data", ".collector", "outputs.json"));
var pathMapper = new PathMapper(options.RepoDir);
var storage = new FileStager(options.RepoDir, manifest);
if (manifest.HasChanges)
{
    var currentManifestOutputs = manifest.Resources.Values
        .SelectMany(static resource => resource.Outputs)
        .Select(static output => output.Path)
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToArray();
    storage.DeleteStaleOutputs(
        manifest.RemovedOwners,
        currentManifestOutputs,
        () => manifest.Save(options.RepoDir));
}

var http = new HttpResourceClient(options.TimeoutSeconds);
var parser = new StaticResourceParser(CliOptions.EntryUrl);
var decoder = new ResourceDecoder();
var queue = new ResourceQueue(new DownloadScope(CliOptions.EntryUrl));
var skipList = ResourceSkipList.Load(options.RepoDir);
using var processor = new ResourceProcessor(
    options,
    http,
    decoder,
    pathMapper,
    storage,
    manifest,
    skipList);
var discovery = new SgsDiscoveryEngine(parser, queue);
var collector = new CollectorRunner(
    execDatetime,
    queue,
    processor,
    discovery,
    storage,
    git,
    options.ProcessCount);

var result = await collector.RunAsync();
Console.WriteLine(result.ToSummaryText());

return result.FatalFailures == 0 && result.ResourceFailures == 0 && result.DiscoveryComplete ? 0 : 2;
