using System.Security.Cryptography;
using Sgs.DataCollection.Decode;
using Sgs.DataCollection.Discovery;
using Sgs.DataCollection.Http;

namespace Sgs.DataCollection.Storage;

public sealed class FileStager
{
    private readonly string _repoDir;
    private readonly CollectorManifest _manifest;

    public FileStager(string repoDir, CollectorManifest manifest)
    {
        _repoDir = repoDir;
        _manifest = manifest;
    }

    public FileStageResult Apply(
        ResourceCandidate candidate,
        string outputRoot,
        DecodedResource decoded,
        HttpHeaderSnapshot header,
        DateTimeOffset execDatetime)
    {
        var stagingRoot = Path.Combine(_repoDir, "data", ".collector", "staging", Guid.NewGuid().ToString("N"));
        var changed = false;
        var currentRelativePaths = new List<string>();
        var outputs = new List<ManifestOutput>();
        var stagedOutputs = new List<StagedOutput>();
        var seenOutputPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var rollbackEntries = new List<FileRollbackEntry>();
        var touchedPaths = new List<string>();
        var manifestSnapshot = _manifest.CaptureSnapshot();

        try
        {
            foreach (var output in decoded.Outputs)
            {
                EnsureNoPathCollision(output.AbsolutePath);
                var relative = NormalizeRelative(Path.GetRelativePath(_repoDir, output.AbsolutePath));
                if (!seenOutputPaths.Add(relative))
                {
                    throw new IOException($"Duplicate decoded output path: {relative}");
                }

                var stagedPath = Path.Combine(stagingRoot, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(stagedPath)!);
                File.WriteAllBytes(stagedPath, output.Bytes);

                currentRelativePaths.Add(relative);
                outputs.Add(new ManifestOutput(relative, Sha256Hex(output.Bytes), output.Bytes.LongLength, OutputKind(output.AbsolutePath)));
                stagedOutputs.Add(new StagedOutput(output.AbsolutePath, stagedPath, relative));
            }

            var relativeRoot = NormalizeRelative(Path.GetRelativePath(_repoDir, outputRoot));
            var next = new ManifestResource
            {
                RequestKey = candidate.RequestKey,
                AbsolutePath = candidate.AbsolutePath,
                QueryParameter = candidate.QueryParameter,
                Sources = candidate.Sources.ToArray(),
                OutputRoot = relativeRoot,
                Etag = header.Etag,
                LastModified = header.LastModified,
                ContentLength = header.ContentLength,
                ExecDatetime = execDatetime,
                Outputs = outputs
            };

            var previous = _manifest.TryGet(candidate.RequestKey);
            var staleOwners = new List<ManifestResource>();
            if (previous is not null)
            {
                staleOwners.Add(previous);
            }

            staleOwners.AddRange(_manifest.FindSameOutputOwners(next));
            var staleOutputPaths = GetStaleOutputPaths(staleOwners, currentRelativePaths);
            var finalChanges = ApplyFinalChanges(stagedOutputs, staleOutputPaths, rollbackEntries, stagingRoot);
            changed |= finalChanges.Changed;
            touchedPaths.AddRange(finalChanges.RelativePaths);

            var equivalent = CollectorManifest.EquivalentIgnoringExecutionTime(previous, next);
            if (!equivalent)
            {
                _manifest.Upsert(next);
                _manifest.Save(_repoDir);
                changed = true;
                touchedPaths.AddRange(CollectorMetadataPaths());
            }

            var touched = touchedPaths.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            return new FileStageResult(changed, relativeRoot, currentRelativePaths, touched, finalChanges.Created, finalChanges.Updated, finalChanges.Deleted);
        }
        catch (Exception ex)
        {
            _manifest.RestoreSnapshot(manifestSnapshot);
            var rollbackFailures = new List<Exception>();
            try
            {
                _manifest.Save(_repoDir);
            }
            catch (Exception rollbackManifestEx)
            {
                rollbackFailures.Add(rollbackManifestEx);
            }

            if (rollbackEntries.Count > 0)
            {
                try
                {
                    RollbackFinalChanges(rollbackEntries);
                }
                catch (Exception rollbackFilesEx)
                {
                    rollbackFailures.Add(rollbackFilesEx);
                }
            }

            if (rollbackFailures.Count > 0)
            {
                throw new IOException("Failed to apply staged files and rollback also failed.", new AggregateException(new[] { ex }.Concat(rollbackFailures)));
            }

            throw;
        }
        finally
        {
            if (Directory.Exists(stagingRoot))
            {
                Directory.Delete(stagingRoot, recursive: true);
            }
        }
    }

    public FileCleanupResult DeleteStaleOutputs(
        IReadOnlyList<ManifestResource> staleOwners,
        IReadOnlyList<string> currentRelativePaths,
        Action saveMetadata)
    {
        var staleOutputPaths = GetStaleOutputPaths(staleOwners, currentRelativePaths);
        var stagingRoot = Path.Combine(_repoDir, "data", ".collector", "staging", Guid.NewGuid().ToString("N"));
        var rollbackEntries = new List<FileRollbackEntry>();
        var metadataBackup = CaptureMetadataFiles();
        try
        {
            var finalChanges = ApplyFinalChanges([], staleOutputPaths, rollbackEntries, stagingRoot);
            saveMetadata();
            var commitPaths = finalChanges.RelativePaths
                .Concat(CollectorMetadataPaths())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();

            return new FileCleanupResult(finalChanges.Changed || commitPaths.Length > 0, commitPaths, 0, finalChanges.Deleted);
        }
        catch (Exception ex)
        {
            var rollbackFailures = new List<Exception>();
            try
            {
                RestoreMetadataFiles(metadataBackup);
            }
            catch (Exception rollbackMetadataEx)
            {
                rollbackFailures.Add(rollbackMetadataEx);
            }

            if (rollbackEntries.Count > 0)
            {
                try
                {
                    RollbackFinalChanges(rollbackEntries);
                }
                catch (Exception rollbackFilesEx)
                {
                    rollbackFailures.Add(rollbackFilesEx);
                }
            }

            if (rollbackFailures.Count > 0)
            {
                throw new IOException("Failed to delete stale files and rollback also failed.", new AggregateException(new[] { ex }.Concat(rollbackFailures)));
            }

            throw;
        }
        finally
        {
            if (Directory.Exists(stagingRoot))
            {
                Directory.Delete(stagingRoot, recursive: true);
            }
        }
    }

    public FileCleanupResult RemoveUnseenResources(IReadOnlySet<string> liveRequestKeys)
    {
        var staleOwners = _manifest.Resources.Values
            .Where(resource => !liveRequestKeys.Contains(resource.RequestKey))
            .ToArray();
        if (staleOwners.Length == 0)
        {
            return new FileCleanupResult(false, [], 0, 0);
        }

        var liveOutputPaths = _manifest.Resources.Values
            .Where(resource => liveRequestKeys.Contains(resource.RequestKey))
            .SelectMany(static resource => resource.Outputs)
            .Select(static output => output.Path)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var staleOutputPaths = GetStaleOutputPaths(staleOwners, liveOutputPaths);
        var stagingRoot = Path.Combine(_repoDir, "data", ".collector", "staging", Guid.NewGuid().ToString("N"));
        var rollbackEntries = new List<FileRollbackEntry>();
        var manifestSnapshot = _manifest.CaptureSnapshot();

        try
        {
            var finalChanges = ApplyFinalChanges([], staleOutputPaths, rollbackEntries, stagingRoot);
            _manifest.Remove(staleOwners.Select(static resource => resource.RequestKey).ToArray());
            _manifest.Save(_repoDir);
            var commitPaths = finalChanges.RelativePaths
                .Concat(CollectorMetadataPaths())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();

            return new FileCleanupResult(finalChanges.Changed || staleOwners.Length > 0, commitPaths, staleOwners.Length, finalChanges.Deleted);
        }
        catch (Exception ex) when (rollbackEntries.Count > 0)
        {
            _manifest.RestoreSnapshot(manifestSnapshot);
            var rollbackFailures = new List<Exception>();
            try
            {
                _manifest.Save(_repoDir);
            }
            catch (Exception rollbackManifestEx)
            {
                rollbackFailures.Add(rollbackManifestEx);
            }

            try
            {
                RollbackFinalChanges(rollbackEntries);
            }
            catch (Exception rollbackFilesEx)
            {
                rollbackFailures.Add(rollbackFilesEx);
            }

            if (rollbackFailures.Count > 0)
            {
                throw new IOException("Failed to remove stale manifest resources and rollback also failed.", new AggregateException(new[] { ex }.Concat(rollbackFailures)));
            }

            throw;
        }
        catch
        {
            _manifest.RestoreSnapshot(manifestSnapshot);
            _manifest.Save(_repoDir);
            throw;
        }
        finally
        {
            if (Directory.Exists(stagingRoot))
            {
                Directory.Delete(stagingRoot, recursive: true);
            }
        }
    }

    public static IReadOnlyList<string> CollectorMetadataPaths() =>
    [
        NormalizeRelative(Path.Combine("data", ".collector", "outputs.json"))
    ];

    private Dictionary<string, string?> CaptureMetadataFiles()
    {
        return CollectorMetadataPaths()
            .ToDictionary(
                static path => path,
                path =>
                {
                    var absolute = CollectorManifest.ResolveRepositoryPath(_repoDir, path);
                    return File.Exists(absolute) ? File.ReadAllText(absolute) : null;
                },
                StringComparer.OrdinalIgnoreCase);
    }

    private void RestoreMetadataFiles(IReadOnlyDictionary<string, string?> backup)
    {
        foreach (var item in backup)
        {
            var absolute = CollectorManifest.ResolveRepositoryPath(_repoDir, item.Key);
            if (item.Value is null)
            {
                if (File.Exists(absolute))
                {
                    File.Delete(absolute);
                }

                continue;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(absolute)!);
            WriteTextIfChanged(absolute, item.Value);
        }
    }

    private static IReadOnlyList<string> GetStaleOutputPaths(IReadOnlyList<ManifestResource> staleOwners, IReadOnlyList<string> currentRelativePaths)
    {
        if (staleOwners.Count == 0)
        {
            return [];
        }

        var current = currentRelativePaths.ToHashSet(StringComparer.OrdinalIgnoreCase);
        return staleOwners
            .SelectMany(static owner => owner.Outputs)
            .Select(static output => output.Path)
            .Where(path => !current.Contains(path))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private FinalApplyResult ApplyFinalChanges(
        IReadOnlyList<StagedOutput> stagedOutputs,
        IReadOnlyList<string> staleOutputPaths,
        List<FileRollbackEntry> rollbackEntries,
        string stagingRoot)
    {
        var changed = false;
        var touchedPaths = new List<string>();
        var backupRoot = Path.Combine(stagingRoot, "rollback");
        var backupIndex = 0;
        var created = 0;
        var updated = 0;
        var deleted = 0;

        foreach (var staged in stagedOutputs)
        {
            var bytes = File.ReadAllBytes(staged.StagedPath);
            var existed = File.Exists(staged.FinalPath);
            if (FileEquals(staged.FinalPath, bytes))
            {
                continue;
            }

            PrepareRollback(staged.FinalPath, backupRoot, rollbackEntries, ref backupIndex);
            Directory.CreateDirectory(Path.GetDirectoryName(staged.FinalPath)!);
            WriteIfChanged(staged.FinalPath, bytes);
            changed = true;
            touchedPaths.Add(staged.RelativePath);
            if (existed)
            {
                updated++;
            }
            else
            {
                created++;
            }
        }

        foreach (var relativePath in staleOutputPaths)
        {
            var absolute = CollectorManifest.ResolveRepositoryPath(_repoDir, relativePath);
            if (!File.Exists(absolute))
            {
                continue;
            }

            PrepareRollback(absolute, backupRoot, rollbackEntries, ref backupIndex);
            File.Delete(absolute);
            changed = true;
            touchedPaths.Add(relativePath);
            deleted++;
        }

        return new FinalApplyResult(changed, touchedPaths, created, updated, deleted);
    }

    private static void PrepareRollback(string path, string backupRoot, List<FileRollbackEntry> rollbackEntries, ref int backupIndex)
    {
        if (Directory.Exists(path))
        {
            throw new IOException($"Output path is a directory: {path}");
        }

        if (!File.Exists(path))
        {
            rollbackEntries.Add(new FileRollbackEntry(path, null, HadOriginal: false));
            return;
        }

        Directory.CreateDirectory(backupRoot);
        var backupPath = Path.Combine(backupRoot, (++backupIndex).ToString("D8") + ".bak");
        File.Copy(path, backupPath);
        rollbackEntries.Add(new FileRollbackEntry(path, backupPath, HadOriginal: true));
    }

    private static void RollbackFinalChanges(IReadOnlyList<FileRollbackEntry> rollbackEntries)
    {
        foreach (var entry in rollbackEntries.Reverse())
        {
            if (entry.HadOriginal)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(entry.Path)!);
                File.Copy(entry.BackupPath!, entry.Path, overwrite: true);
            }
            else if (File.Exists(entry.Path))
            {
                File.Delete(entry.Path);
            }
        }
    }

    private static bool FileEquals(string path, byte[] bytes)
    {
        if (!File.Exists(path))
        {
            return false;
        }

        var existing = File.ReadAllBytes(path);
        return existing.AsSpan().SequenceEqual(bytes);
    }

    private static bool WriteIfChanged(string path, byte[] bytes)
    {
        if (File.Exists(path))
        {
            var existing = File.ReadAllBytes(path);
            if (existing.AsSpan().SequenceEqual(bytes))
            {
                return false;
            }
        }
        else if (Directory.Exists(path))
        {
            throw new IOException($"Output path is a directory: {path}");
        }

        var temp = path + ".tmp-" + Guid.NewGuid().ToString("N");
        File.WriteAllBytes(temp, bytes);
        if (File.Exists(path))
        {
            File.Replace(temp, path, null);
        }
        else
        {
            File.Move(temp, path);
        }

        return true;
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

    private static void EnsureNoPathCollision(string path)
    {
        var parent = Path.GetDirectoryName(path);
        var name = Path.GetFileName(path);
        if (parent is null || !Directory.Exists(parent))
        {
            return;
        }

        foreach (var entry in Directory.EnumerateFileSystemEntries(parent))
        {
            if (string.Equals(Path.GetFileName(entry), name, StringComparison.Ordinal)
                && !string.Equals(entry, path, StringComparison.Ordinal))
            {
                throw new IOException($"Path collision: {path} conflicts with {entry}");
            }
        }
    }

    private static string OutputKind(string path)
    {
        var ext = Path.GetExtension(path).ToLowerInvariant();
        return ext switch
        {
            ".json" => "json",
            ".js" => "js",
            ".proto" => "proto",
            ".txt" => "text",
            _ => "binary"
        };
    }

    private static string Sha256Hex(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    private static string NormalizeRelative(string path) => path.Replace('\\', '/');
}

public sealed record FileStageResult(bool Changed, string RelativeRoot, IReadOnlyList<string> RelativePaths, IReadOnlyList<string> TouchedPaths, int Created, int Updated, int Deleted);
public sealed record FileCleanupResult(bool Changed, IReadOnlyList<string> RelativePaths, int RemovedResources, int Deleted);

internal sealed record FinalApplyResult(bool Changed, IReadOnlyList<string> RelativePaths, int Created, int Updated, int Deleted);
internal sealed record StagedOutput(string FinalPath, string StagedPath, string RelativePath);
internal sealed record FileRollbackEntry(string Path, string? BackupPath, bool HadOriginal);
