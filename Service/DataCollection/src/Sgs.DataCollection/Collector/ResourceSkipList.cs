using Sgs.DataCollection.Discovery;

namespace Sgs.DataCollection.Collector;

public sealed class ResourceSkipList
{
    private readonly HashSet<string> _items;

    private ResourceSkipList(HashSet<string> items)
    {
        _items = items;
    }

    public static ResourceSkipList Load(string repoDir)
    {
        var items = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var path in new[]
        {
            Path.Combine(repoDir, "config", "resource-skip.txt"),
            Path.Combine(repoDir, "data", ".collector", "resource-skip.txt")
        })
        {
            if (!File.Exists(path))
            {
                continue;
            }

            foreach (var rawLine in File.ReadLines(path))
            {
                var line = rawLine.Trim();
                if (line.Length == 0 || line.StartsWith("#", StringComparison.Ordinal))
                {
                    continue;
                }

                items.Add(line);
            }
        }

        return new ResourceSkipList(items);
    }

    public bool Contains(ResourceCandidate candidate)
    {
        return _items.Contains(candidate.Uri.AbsoluteUri)
            || _items.Contains(candidate.RequestKey)
            || _items.Contains(candidate.AbsolutePath)
            || _items.Contains(candidate.Uri.AbsolutePath);
    }
}
