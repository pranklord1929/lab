import Foundation

/// Rotating JSONL journal of the plumbing only: state transitions, tmux exit
/// codes and durations. Prompt and answer text is never written — the providers
/// already keep the conversation, and a diagnostic file should stay safe to read
/// and share.
public final class Diagnostics: @unchecked Sendable {
    public static let shared = Diagnostics()

    private let queue = DispatchQueue(label: "paneshift.diagnostics", qos: .utility)
    private let fileURL: URL
    private let maximumBytes = 2 * 1024 * 1024
    private var enabled = true

    public init(fileURL: URL? = nil) {
        let directory = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent(".local/state/paneshift", isDirectory: true)
        self.fileURL = fileURL ?? directory.appendingPathComponent("paneshift.jsonl")
        try? FileManager.default.createDirectory(
            at: self.fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true)
    }

    public var path: String { fileURL.path }

    public func setEnabled(_ value: Bool) {
        queue.async { self.enabled = value }
    }

    public func record(_ event: String, _ fields: [String: String] = [:]) {
        queue.async {
            guard self.enabled else { return }
            var payload: [String: String] = [
                "ts": TranscriptDate.string(from: Date()),
                "event": event
            ]
            payload.merge(fields) { _, new in new }
            guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
                  var line = String(data: data, encoding: .utf8) else { return }
            line += "\n"
            self.append(line)
        }
    }

    private func append(_ line: String) {
        let manager = FileManager.default
        if let size = (try? manager.attributesOfItem(atPath: fileURL.path)[.size]) as? Int, size > maximumBytes {
            let previous = fileURL.deletingPathExtension().appendingPathExtension("1.jsonl")
            try? manager.removeItem(at: previous)
            try? manager.moveItem(at: fileURL, to: previous)
        }
        guard let data = line.data(using: .utf8) else { return }
        if let handle = try? FileHandle(forWritingTo: fileURL) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
        } else {
            try? data.write(to: fileURL)
        }
    }
}

public extension TurnState {
    /// Stable, low-cardinality name for the journal and the status line.
    var diagnosticName: String {
        switch self {
        case .submitting: return "submitting"
        case .running: return "running"
        case .completed: return "completed"
        case .blocked: return "blocked"
        case .failed: return "failed"
        case .cancelled: return "cancelled"
        }
    }
}
