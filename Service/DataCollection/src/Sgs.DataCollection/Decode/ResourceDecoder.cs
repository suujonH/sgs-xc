using System.IO.Compression;
using System.Text;
using Sgs.DataCollection.Discovery;
using Sgs.DataCollection.Storage;

namespace Sgs.DataCollection.Decode;

public sealed class ResourceDecoder
{
    private readonly UTF8Encoding _strictUtf8 = new(false, true);

    public DecodedResource Decode(ResourceCandidate candidate, byte[] body, string outputRoot, Func<SgsPayloadDecoder> payloadDecoderFactory)
    {
        var outputs = new List<DecodedOutput>();
        DecodeNode(candidate, body, outputRoot, "", outputs, payloadDecoderFactory, IsEncryptedPackage(candidate));
        return new DecodedResource(outputs);
    }

    private void DecodeNode(
        ResourceCandidate candidate,
        byte[] bytes,
        string outputRoot,
        string memberPath,
        List<DecodedOutput> outputs,
        Func<SgsPayloadDecoder> payloadDecoderFactory,
        bool encryptedContext)
    {
        if (IsZip(bytes))
        {
            using var archive = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
            foreach (var entry in archive.Entries)
            {
                if (string.IsNullOrEmpty(entry.Name))
                {
                    continue;
                }

                using var stream = entry.Open();
                using var ms = new MemoryStream();
                stream.CopyTo(ms);
                var nextMember = CombineMember(memberPath, entry.FullName);
                var childEncrypted = encryptedContext || IsEncryptedZipMember(candidate, entry.FullName);
                DecodeNode(candidate, ms.ToArray(), outputRoot, nextMember, outputs, payloadDecoderFactory, childEncrypted);
            }
            return;
        }

        if (encryptedContext && !LooksLikeText(bytes) && !IsGzip(bytes))
        {
            bytes = payloadDecoderFactory().OfbDec(bytes);
        }

        if (IsGzip(bytes))
        {
            bytes = Gunzip(bytes);
        }

        var outputName = ResolveOutputName(candidate, memberPath, bytes);
        var absolutePath = string.IsNullOrEmpty(outputName)
            ? outputRoot
            : BuildSafeOutputPath(outputRoot, outputName);

        outputs.Add(new DecodedOutput(absolutePath, bytes));
    }

    private static bool IsEncryptedPackage(ResourceCandidate candidate)
    {
        var path = candidate.AbsolutePath;
        return path.Contains("/res/config/", StringComparison.OrdinalIgnoreCase)
            || path.Contains("/res/proto/", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsEncryptedZipMember(ResourceCandidate candidate, string memberPath)
    {
        if (!memberPath.EndsWith(".sgs", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return candidate.AbsolutePath.Contains("/res/config/", StringComparison.OrdinalIgnoreCase)
            || candidate.AbsolutePath.Contains("/res/proto/", StringComparison.OrdinalIgnoreCase);
    }

    private string ResolveOutputName(ResourceCandidate candidate, string memberPath, byte[] bytes)
    {
        if (string.IsNullOrEmpty(memberPath))
        {
            if (candidate.AbsolutePath.EndsWith(".sgs", StringComparison.OrdinalIgnoreCase) && IsEncryptedPackage(candidate))
            {
                var fileName = Path.GetFileName(new Uri(candidate.AbsolutePath).AbsolutePath);
                return Path.ChangeExtension(fileName, GuessExtension(bytes));
            }

            return "";
        }

        var extension = GuessExtension(bytes);
        if (memberPath.EndsWith(".sgs", StringComparison.OrdinalIgnoreCase)
            && (extension == ".json" || extension == ".proto" || extension == ".js" || extension == ".txt"))
        {
            return ChangePortableExtension(memberPath, extension);
        }

        return memberPath;
    }

    private string GuessExtension(byte[] bytes)
    {
        if (TryDecodeText(bytes, out var text))
        {
            var trimmed = text.TrimStart();
            if (trimmed.StartsWith("{", StringComparison.Ordinal) || trimmed.StartsWith("[", StringComparison.Ordinal))
            {
                return ".json";
            }

            if (trimmed.StartsWith("syntax = \"proto3\";", StringComparison.Ordinal))
            {
                return ".proto";
            }

            if (trimmed.StartsWith("window.", StringComparison.Ordinal)
                || trimmed.StartsWith("function", StringComparison.Ordinal)
                || trimmed.StartsWith("class", StringComparison.Ordinal)
                || trimmed.StartsWith("var ", StringComparison.Ordinal)
                || trimmed.StartsWith("let ", StringComparison.Ordinal)
                || trimmed.StartsWith("const ", StringComparison.Ordinal)
                || trimmed.Contains("=>", StringComparison.Ordinal))
            {
                return ".js";
            }

            return ".txt";
        }

        return ".bin";
    }

    private bool LooksLikeText(byte[] bytes) => TryDecodeText(bytes, out _);

    private bool TryDecodeText(byte[] bytes, out string text)
    {
        text = "";
        if (bytes.Length == 0)
        {
            return true;
        }

        var sampleLength = Math.Min(bytes.Length, 2048);
        for (var i = 0; i < sampleLength; i++)
        {
            var b = bytes[i];
            if (b == 0)
            {
                return false;
            }
        }

        try
        {
            text = _strictUtf8.GetString(bytes);
            return true;
        }
        catch (DecoderFallbackException)
        {
            return false;
        }
    }

    private static bool IsZip(byte[] bytes) => bytes.Length >= 4 && bytes[0] == 0x50 && bytes[1] == 0x4B && bytes[2] == 0x03 && bytes[3] == 0x04;
    private static bool IsGzip(byte[] bytes) => bytes.Length >= 2 && bytes[0] == 0x1F && bytes[1] == 0x8B;

    private static byte[] Gunzip(byte[] bytes)
    {
        using var source = new MemoryStream(bytes);
        using var gzip = new GZipStream(source, CompressionMode.Decompress);
        using var output = new MemoryStream();
        gzip.CopyTo(output);
        return output.ToArray();
    }

    private static string CombineMember(string prefix, string child)
    {
        if (Path.IsPathRooted(child) || child.StartsWith("/", StringComparison.Ordinal) || child.StartsWith("\\", StringComparison.Ordinal))
        {
            throw new InvalidDataException($"Invalid rooted package member path: {child}");
        }

        child = child.Replace('\\', '/');
        ValidatePortablePath(child);
        return string.IsNullOrEmpty(prefix) ? child : prefix.TrimEnd('/') + "/" + child;
    }

    private static string BuildSafeOutputPath(string outputRoot, string portablePath)
    {
        ValidatePortablePath(portablePath);
        var segments = PathMapper.SplitPortablePath(portablePath);
        var escapeAll = segments.Any(PathMapper.ContainsInvalidFileNameChars);
        var safeSegments = escapeAll ? segments.Select(PathMapper.EscapeSegment).ToArray() : segments;
        var absolutePath = Path.GetFullPath(Path.Combine([outputRoot, .. safeSegments]));
        var fullRoot = Path.GetFullPath(outputRoot);
        var rootWithSeparator = fullRoot.EndsWith(Path.DirectorySeparatorChar)
            ? fullRoot
            : fullRoot + Path.DirectorySeparatorChar;

        if (!absolutePath.StartsWith(rootWithSeparator, StringComparison.OrdinalIgnoreCase)
            && !string.Equals(absolutePath, fullRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException($"Package member path escapes output root: {portablePath}");
        }

        return absolutePath;
    }

    private static void ValidatePortablePath(string portablePath)
    {
        if (string.IsNullOrWhiteSpace(portablePath)
            || Path.IsPathRooted(portablePath)
            || portablePath.StartsWith("/", StringComparison.Ordinal)
            || portablePath.StartsWith("\\", StringComparison.Ordinal))
        {
            throw new InvalidDataException($"Invalid package member path: {portablePath}");
        }

        foreach (var segment in PathMapper.SplitPortablePath(portablePath))
        {
            if (segment is "." or "..")
            {
                throw new InvalidDataException($"Invalid package member path segment: {portablePath}");
            }
        }
    }

    private static string ChangePortableExtension(string path, string extension)
    {
        var slash = path.LastIndexOf('/');
        var dir = slash >= 0 ? path[..(slash + 1)] : "";
        var name = slash >= 0 ? path[(slash + 1)..] : path;
        var dot = name.LastIndexOf('.');
        if (dot >= 0)
        {
            name = name[..dot];
        }

        return dir + name + extension;
    }
}

public sealed record DecodedResource(IReadOnlyList<DecodedOutput> Outputs);
public sealed record DecodedOutput(string AbsolutePath, byte[] Bytes);
