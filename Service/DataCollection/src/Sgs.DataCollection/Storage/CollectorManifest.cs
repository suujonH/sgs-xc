using System.Text.Json;
namespace Sgs.DataCollection.Storage;

public sealed class CollectorManifest
{
    private readonly Dictionary<string, ManifestResource> _resources = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<ManifestResource> _removedOwners = new();

    public IReadOnlyDictionary<string, ManifestResource> Resources => _resources;
    public IReadOnlyList<ManifestResource> RemovedOwners => _removedOwners;
    public bool HasChanges { get; private set; }

    public CollectorManifestSnapshot CaptureSnapshot()
    {
        return new CollectorManifestSnapshot(
            _resources.ToDictionary(static x => x.Key, static x => x.Value, StringComparer.OrdinalIgnoreCase),
            _removedOwners.ToList(),
            HasChanges);
    }

    public void RestoreSnapshot(CollectorManifestSnapshot snapshot)
    {
        _resources.Clear();
        foreach (var item in snapshot.Resources)
        {
            _resources[item.Key] = item.Value;
        }

        _removedOwners.Clear();
        _removedOwners.AddRange(snapshot.RemovedOwners);
        HasChanges = snapshot.HasChanges;
    }

    public static CollectorManifest Load(string path)
    {
        var manifest = new CollectorManifest();
        if (!File.Exists(path))
        {
            return manifest;
        }

        var model = JsonSerializer.Deserialize<ManifestFile>(File.ReadAllText(path), JsonOptions());
        if (model?.Resources is null)
        {
            return manifest;
        }

        foreach (var resource in model.Resources.OrderBy(static x => x.ExecDatetime))
        {
            if (!string.IsNullOrWhiteSpace(resource.RequestKey))
            {
                manifest.UpsertCore(resource, trackChanges: false, keepRemovedOwners: true);
            }
        }

        return manifest;
    }

    public ManifestResource? TryGet(string requestKey)
    {
        return _resources.TryGetValue(requestKey, out var resource) ? resource : null;
    }

    public IReadOnlyList<ManifestResource> FindSameOutputOwners(ManifestResource resource)
    {
        ValidateManifestResource(resource);
        var outputPaths = resource.Outputs.Select(static x => x.Path).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return _resources.Values
            .Where(existing => !string.Equals(existing.RequestKey, resource.RequestKey, StringComparison.OrdinalIgnoreCase)
                && IsSameOutputOwner(existing, resource, outputPaths))
            .ToArray();
    }

    public void Upsert(ManifestResource resource)
    {
        UpsertCore(resource, trackChanges: true, keepRemovedOwners: false);
    }

    public void Remove(IReadOnlyCollection<string> requestKeys)
    {
        var removed = false;
        foreach (var requestKey in requestKeys)
        {
            removed |= _resources.Remove(requestKey);
        }

        if (removed)
        {
            HasChanges = true;
        }
    }

    private void UpsertCore(ManifestResource resource, bool trackChanges, bool keepRemovedOwners)
    {
        ValidateManifestResource(resource);
        var outputPaths = resource.Outputs.Select(static x => x.Path).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var staleKeys = _resources
            .Where(existing => !string.Equals(existing.Key, resource.RequestKey, StringComparison.OrdinalIgnoreCase)
                && IsSameOutputOwner(existing.Value, resource, outputPaths))
            .Select(static existing => existing.Key)
            .ToArray();
        var replacingExisting = _resources.ContainsKey(resource.RequestKey);
        foreach (var key in staleKeys)
        {
            if (keepRemovedOwners && _resources.TryGetValue(key, out var removed))
            {
                _removedOwners.Add(removed);
            }

            _resources.Remove(key);
        }

        if (trackChanges || staleKeys.Length > 0 || replacingExisting)
        {
            HasChanges = true;
        }

        _resources[resource.RequestKey] = resource;
    }

    public bool OutputsExist(string repoDir, string requestKey)
    {
        if (!_resources.TryGetValue(requestKey, out var resource) || resource.Outputs.Count == 0)
        {
            return false;
        }

        foreach (var output in resource.Outputs)
        {
            var absolute = ResolveRepositoryPath(repoDir, output.Path);
            if (!File.Exists(absolute))
            {
                return false;
            }
        }

        return true;
    }

    public void Save(string repoDir)
    {
        var collectorDir = Path.Combine(repoDir, "data", ".collector");
        var path = Path.Combine(collectorDir, "outputs.json");
        Directory.CreateDirectory(collectorDir);

        var model = new ManifestFile
        {
            Version = 1,
            Resources = _resources.Values.OrderBy(x => x.RequestKey, StringComparer.OrdinalIgnoreCase).ToList()
        };
        WriteTextIfChanged(path, JsonSerializer.Serialize(model, JsonOptions()));
        _removedOwners.Clear();
        HasChanges = false;
    }

    private static void WriteTextIfChanged(string path, string content)
    {
        if (File.Exists(path) && string.Equals(File.ReadAllText(path), content, StringComparison.Ordinal))
        {
            return;
        }

        var temp = path + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            File.WriteAllText(temp, content);
            if (File.Exists(path))
            {
                File.Replace(temp, path, null);
            }
            else
            {
                File.Move(temp, path);
            }
        }
        finally
        {
            if (File.Exists(temp))
            {
                File.Delete(temp);
            }
        }
    }

    private static JsonSerializerOptions JsonOptions()
    {
        return new JsonSerializerOptions
        {
            WriteIndented = true
        };
    }

    public static bool EquivalentIgnoringExecutionTime(ManifestResource? previous, ManifestResource next)
    {
        if (previous is null)
        {
            return false;
        }

        return string.Equals(previous.AbsolutePath, next.AbsolutePath, StringComparison.OrdinalIgnoreCase)
            && string.Equals(previous.QueryParameter, next.QueryParameter, StringComparison.Ordinal)
            && string.Equals(previous.OutputRoot, next.OutputRoot, StringComparison.OrdinalIgnoreCase)
            && string.Equals(previous.Etag, next.Etag, StringComparison.Ordinal)
            && previous.LastModified == next.LastModified
            && previous.ContentLength == next.ContentLength
            && SetEqual(previous.Sources, next.Sources)
            && OutputsEqual(previous.Outputs, next.Outputs);
    }

    private static bool OutputsEqual(IReadOnlyList<ManifestOutput> left, IReadOnlyList<ManifestOutput> right)
    {
        if (left.Count != right.Count)
        {
            return false;
        }

        var orderedLeft = left.OrderBy(x => x.Path, StringComparer.OrdinalIgnoreCase).ToArray();
        var orderedRight = right.OrderBy(x => x.Path, StringComparer.OrdinalIgnoreCase).ToArray();
        for (var i = 0; i < orderedLeft.Length; i++)
        {
            if (!string.Equals(orderedLeft[i].Path, orderedRight[i].Path, StringComparison.OrdinalIgnoreCase)
                || !string.Equals(orderedLeft[i].Sha256, orderedRight[i].Sha256, StringComparison.Ordinal)
                || orderedLeft[i].Length != orderedRight[i].Length
                || !string.Equals(orderedLeft[i].Kind, orderedRight[i].Kind, StringComparison.Ordinal))
            {
                return false;
            }
        }

        return true;
    }

    private static bool SetEqual(string[] left, string[] right)
    {
        return left.OrderBy(x => x, StringComparer.OrdinalIgnoreCase)
            .SequenceEqual(right.OrderBy(x => x, StringComparer.OrdinalIgnoreCase), StringComparer.OrdinalIgnoreCase);
    }

    private static bool IsSameOutputOwner(ManifestResource existing, ManifestResource next, HashSet<string> nextOutputPaths)
    {
        return string.Equals(existing.AbsolutePath, next.AbsolutePath, StringComparison.OrdinalIgnoreCase)
            || string.Equals(existing.OutputRoot, next.OutputRoot, StringComparison.OrdinalIgnoreCase)
            || existing.Outputs.Any(output => nextOutputPaths.Contains(output.Path));
    }

    private static void ValidateManifestResource(ManifestResource resource)
    {
        ValidateManifestRelativePath(resource.OutputRoot);
        foreach (var output in resource.Outputs)
        {
            ValidateManifestRelativePath(output.Path);
        }
    }

    public static string ResolveRepositoryPath(string repoDir, string relativePath)
    {
        ValidateManifestRelativePath(relativePath);
        var fullRepo = Path.GetFullPath(repoDir);
        var fullPath = Path.GetFullPath(Path.Combine(fullRepo, relativePath));
        var repoWithSeparator = fullRepo.EndsWith(Path.DirectorySeparatorChar)
            ? fullRepo
            : fullRepo + Path.DirectorySeparatorChar;

        if (!fullPath.StartsWith(repoWithSeparator, StringComparison.OrdinalIgnoreCase)
            && !string.Equals(fullPath, fullRepo, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException($"Manifest path escapes repository: {relativePath}");
        }

        return fullPath;
    }

    private static void ValidateManifestRelativePath(string relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath)
            || Path.IsPathRooted(relativePath)
            || relativePath.Contains('\0'))
        {
            throw new InvalidDataException($"Invalid manifest path: {relativePath}");
        }

        var normalized = relativePath.Replace('\\', '/');
        var segments = normalized.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0 || !segments[0].Equals("data", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException($"Manifest path must stay under data/: {relativePath}");
        }

        if (segments.Any(segment => segment is "." or ".."))
        {
            throw new InvalidDataException($"Manifest path contains traversal segment: {relativePath}");
        }
    }
}

public sealed class ManifestFile
{
    public int Version { get; set; }
    public List<ManifestResource> Resources { get; set; } = new();
}

public sealed record CollectorManifestSnapshot(
    Dictionary<string, ManifestResource> Resources,
    List<ManifestResource> RemovedOwners,
    bool HasChanges);

public sealed class ManifestResource
{
    public string RequestKey { get; set; } = "";
    public string AbsolutePath { get; set; } = "";
    public string QueryParameter { get; set; } = "";
    public string[] Sources { get; set; } = [];
    public string OutputRoot { get; set; } = "";
    public string? Etag { get; set; }
    public DateTimeOffset? LastModified { get; set; }
    public long? ContentLength { get; set; }
    public DateTimeOffset ExecDatetime { get; set; }
    public List<ManifestOutput> Outputs { get; set; } = new();
}

public sealed record ManifestOutput(string Path, string Sha256, long Length, string Kind);
