using System.Diagnostics;

namespace Sgs.DataCollection.Git;

public sealed class GitRepository
{
    private const string RemoteUrl = "git@github.com:suujonH/sgs-resource.git";

    private readonly string _repoDir;

    public GitRepository(string repoDir)
    {
        _repoDir = repoDir;
    }

    public void EnsureInitialized()
    {
        EnsureRepositoryExists();
        var gitMetadataPath = Path.Combine(_repoDir, ".git");
        if ((!Directory.Exists(gitMetadataPath) && !File.Exists(gitMetadataPath)) || !IsValidRepository())
        {
            throw new InvalidOperationException($"{_repoDir} contains .git but is not a valid Git repository.");
        }

        EnsureOrigin();
        PullLatest();
    }

    private void EnsureRepositoryExists()
    {
        var gitMetadataPath = Path.Combine(_repoDir, ".git");
        if (Directory.Exists(gitMetadataPath) || File.Exists(gitMetadataPath))
        {
            return;
        }

        if (Directory.Exists(_repoDir) && Directory.EnumerateFileSystemEntries(_repoDir).Any())
        {
            throw new InvalidOperationException($"{_repoDir} is not empty and is not a Git repository.");
        }

        var fullRepoDir = Path.GetFullPath(_repoDir);
        var parent = Path.GetDirectoryName(fullRepoDir)
            ?? throw new InvalidOperationException($"Invalid repository path: {_repoDir}");
        Directory.CreateDirectory(parent);
        Run("git", "clone " + QuoteArg(RemoteUrl) + " " + QuoteArg(fullRepoDir), parent);
    }

    private void EnsureOrigin()
    {
        var remote = Run("git", "remote", allowFailure: true).StdOut;
        if (!remote.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries).Contains("origin"))
        {
            throw new InvalidOperationException($"Git origin must be {RemoteUrl}, but origin is missing.");
        }

        var current = Run("git", "remote get-url origin", allowFailure: true).StdOut.Trim();
        if (!string.Equals(current, RemoteUrl, StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"Git origin must be {RemoteUrl}, but current origin is {current}.");
        }
    }

    private void PullLatest()
    {
        var branch = Run("git", "rev-parse --abbrev-ref HEAD").StdOut.Trim();
        if (string.Equals(branch, "HEAD", StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"{_repoDir} is in detached HEAD state.");
        }

        Run("git", "fetch origin");
        Run("git", "pull --ff-only origin " + QuoteArg(branch));
    }

    private bool IsValidRepository()
    {
        var result = Run("git", "rev-parse --is-inside-work-tree", allowFailure: true);
        return result.ExitCode == 0 && result.StdOut.Trim().Equals("true", StringComparison.OrdinalIgnoreCase);
    }

    public string? CommitAllIfChanged(string message)
    {
        try
        {
            Run("git", "add -A");

            var diff = Run("git", "diff --cached --quiet", allowFailure: true);
            if (diff.ExitCode == 0)
            {
                return null;
            }

            if (diff.ExitCode != 1)
            {
                throw new InvalidOperationException($"git diff --cached failed with {diff.ExitCode}: {diff.StdErr}");
            }

            Run("git", "commit --quiet " + CommitMessageArgs(message));
            return Run("git", "rev-parse HEAD").StdOut.Trim();
        }
        catch (Exception ex)
        {
            var reset = Run("git", "reset", allowFailure: true);
            if (reset.ExitCode != 0)
            {
                throw new InvalidOperationException($"git reset failed with {reset.ExitCode}: {reset.StdErr}", ex);
            }

            throw;
        }
    }

    private GitCommandResult Run(string fileName, string arguments, bool allowFailure = false)
    {
        return Run(fileName, arguments, _repoDir, allowFailure);
    }

    private static GitCommandResult Run(string fileName, string arguments, string workingDirectory, bool allowFailure = false)
    {
        var startInfo = new ProcessStartInfo(fileName, arguments)
        {
            WorkingDirectory = workingDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException($"Failed to start {fileName}");
        var stdout = process.StandardOutput.ReadToEnd();
        var stderr = process.StandardError.ReadToEnd();
        process.WaitForExit();
        if (!allowFailure && process.ExitCode != 0)
        {
            throw new InvalidOperationException($"{fileName} {arguments} failed with {process.ExitCode}: {stderr}");
        }

        return new GitCommandResult(process.ExitCode, stdout, stderr);
    }

    private static string CommitMessageArgs(string message)
    {
        var normalized = message.Replace("\r\n", "\n").Replace('\r', '\n').TrimEnd();
        var parts = normalized.Split(new[] { "\n\n" }, 2, StringSplitOptions.None);
        var args = "-m " + QuoteArg(parts[0]);
        if (parts.Length > 1 && !string.IsNullOrWhiteSpace(parts[1]))
        {
            args += " -m " + QuoteArg(parts[1]);
        }

        return args;
    }

    private static string QuoteArg(string value)
    {
        return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }
}

public sealed record GitCommandResult(int ExitCode, string StdOut, string StdErr);
