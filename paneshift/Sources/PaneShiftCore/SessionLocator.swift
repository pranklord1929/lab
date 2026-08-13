import Foundation

// Every agent owns a dedicated worktree, and all three CLIs key their session
// storage on the working directory. That makes the agent's directory a reliable
// join key between a tmux pane and the provider's structured transcript — no
// PID tracking, no `lsof`, no `rg`.

public struct TranscriptLocation: Equatable, Sendable {
    public let primary: URL
    public let companion: URL?

    public init(primary: URL, companion: URL? = nil) {
        self.primary = primary
        self.companion = companion
    }
}

public struct SessionLocator: Sendable {
    private let home: URL

    public init(home: URL = URL(fileURLWithPath: NSHomeDirectory())) {
        self.home = home
    }

    /// `FileManager` is not `Sendable`; its query methods are documented as safe
    /// to call from several threads, so each use takes the shared instance.
    private var fileManager: FileManager { .default }

    public func locate(provider: Provider, workingDirectory: String) -> TranscriptLocation? {
        switch provider {
        case .anthropic: return locateClaude(workingDirectory)
        case .openai: return locateCodex(workingDirectory)
        case .grok: return locateGrok(workingDirectory)
        }
    }

    // MARK: Claude

    /// `/Users/x/Desktop/02_DEV/app` → `-Users-x-Desktop-02-DEV-app`
    static func claudeProjectName(_ path: String) -> String {
        String(path.map { character in
            character.isLetter || character.isNumber || character == "-" ? character : "-"
        })
    }

    private func locateClaude(_ workingDirectory: String) -> TranscriptLocation? {
        let root = home.appendingPathComponent(".claude/projects", isDirectory: true)
        let expected = Self.claudeProjectName(workingDirectory)
        var directory = root.appendingPathComponent(expected, isDirectory: true)
        if !fileManager.fileExists(atPath: directory.path) {
            // Mangling rules drift between Claude Code versions. Fall back to a
            // case-insensitive match so a rename does not silently blank CHAT.
            guard let candidates = try? fileManager.contentsOfDirectory(
                at: root, includingPropertiesForKeys: nil),
                let match = candidates.first(where: {
                    $0.lastPathComponent.compare(expected, options: .caseInsensitive) == .orderedSame
                })
            else { return nil }
            directory = match
        }
        guard let newest = newestFile(in: directory, extension: "jsonl") else { return nil }
        return TranscriptLocation(primary: newest)
    }

    // MARK: Codex

    private func locateCodex(_ workingDirectory: String) -> TranscriptLocation? {
        let root = home.appendingPathComponent(".codex/sessions", isDirectory: true)
        guard let enumerator = fileManager.enumerator(
            at: root,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]) else { return nil }

        var candidates: [(url: URL, modified: Date)] = []
        for case let url as URL in enumerator where url.pathExtension == "jsonl" {
            let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate ?? .distantPast
            candidates.append((url, modified))
        }
        // Rollouts accumulate for months. Prefer newest first, but scan far
        // enough that an idle worktree session is not buried under unrelated
        // home-directory rollouts (audit: 83 files, top-40 missed codex-2).
        let standardized = (workingDirectory as NSString).standardizingPath
        for candidate in candidates.sorted(by: { $0.modified > $1.modified }).prefix(250) {
            guard let cwd = Self.codexSessionDirectory(of: candidate.url) else { continue }
            let candidatePath = (cwd as NSString).standardizingPath
            if cwd == workingDirectory || candidatePath == standardized {
                return TranscriptLocation(primary: candidate.url)
            }
        }
        return nil
    }

    /// Reads only the `session_meta` header instead of the whole rollout.
    static func codexSessionDirectory(of url: URL) -> String? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        guard let data = try? handle.read(upToCount: 64 * 1024), let text = String(data: data, encoding: .utf8)
        else { return nil }
        for line in text.split(separator: "\n").prefix(4) {
            guard let object = JSONLine.object(line),
                  (object["type"] as? String) == "session_meta",
                  let payload = object["payload"] as? [String: Any] else { continue }
            return payload["cwd"] as? String
        }
        return nil
    }

    // MARK: Grok

    /// Grok percent-encodes the working directory as a single path component.
    static func grokDirectoryKey(_ path: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return path.addingPercentEncoding(withAllowedCharacters: allowed) ?? path
    }

    private func locateGrok(_ workingDirectory: String) -> TranscriptLocation? {
        let root = home
            .appendingPathComponent(".grok/sessions", isDirectory: true)
            .appendingPathComponent(Self.grokDirectoryKey(workingDirectory), isDirectory: true)
        guard let sessions = try? fileManager.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.contentModificationDateKey, .isDirectoryKey]) else { return nil }

        let newest = sessions
            .filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true }
            .map { url -> (URL, Date) in
                let history = url.appendingPathComponent("chat_history.jsonl")
                let modified = (try? history.resourceValues(forKeys: [.contentModificationDateKey]))?
                    .contentModificationDate ?? .distantPast
                return (url, modified)
            }
            .filter { $0.1 > .distantPast }
            .max(by: { $0.1 < $1.1 })?.0

        guard let newest else { return nil }
        return TranscriptLocation(
            primary: newest.appendingPathComponent("chat_history.jsonl"),
            companion: newest.appendingPathComponent("events.jsonl"))
    }

    // MARK: Shared

    private func newestFile(in directory: URL, extension pathExtension: String) -> URL? {
        guard let contents = try? fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey]) else { return nil }
        return contents
            .filter { $0.pathExtension == pathExtension }
            .max(by: { lhs, rhs in
                let left = (try? lhs.resourceValues(forKeys: [.contentModificationDateKey]))?
                    .contentModificationDate ?? .distantPast
                let right = (try? rhs.resourceValues(forKeys: [.contentModificationDateKey]))?
                    .contentModificationDate ?? .distantPast
                return left < right
            })
    }
}

// MARK: - Incremental tailer

/// Reads only the bytes appended since the previous poll, so a multi-megabyte
/// rollout costs nothing to follow. Detects rotation (a new session file, or a
/// file truncated beneath the recorded offset) and reloads from the start.
public final class TranscriptTailer: @unchecked Sendable {
    private var url: URL?
    private var offset: UInt64 = 0
    private var carry = ""

    public init() {}

    public var currentURL: URL? { url }

    public func reset() {
        url = nil
        offset = 0
        carry = ""
    }

    /// - Returns: newly appended text, or nil when nothing changed.
    public func poll(_ target: URL?) -> String? {
        guard let target else { reset(); return nil }
        if url != target {
            url = target
            offset = 0
            carry = ""
        }
        guard let handle = try? FileHandle(forReadingFrom: target) else { return nil }
        defer { try? handle.close() }

        let size = (try? handle.seekToEnd()) ?? 0
        if size < offset {
            offset = 0
            carry = ""
        }
        guard size > offset else { return nil }
        try? handle.seek(toOffset: offset)
        guard let data = try? handle.readToEnd(), !data.isEmpty else { return nil }
        offset = size

        // A poll can land mid-line. Keep the tail until its newline arrives so a
        // split JSON object is never dropped.
        let text = carry + (String(data: data, encoding: .utf8) ?? "")
        guard let lastNewline = text.lastIndex(of: "\n") else {
            carry = text
            return nil
        }
        carry = String(text[text.index(after: lastNewline)...])
        return String(text[..<lastNewline])
    }
}
