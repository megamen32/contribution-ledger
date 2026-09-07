import AppKit
import CoreGraphics
import Darwin

// Owns the bundled Screenpipe process. No service, network listener or automatic capture.
@MainActor final class ScreenpipeController {
    enum State { case idle, starting, recording, stopping, failed }
    private(set) var state: State = .idle
    private(set) var frames = 0
    private(set) var lastError: String?
    private(set) var sessionDirectory: URL?
    var onChange: (() -> Void)?
    var onStopped: (() -> Void)?
    private var process: Process?
    private var input: Pipe?
    private var output: Pipe?
    private var errorLog: FileHandle?
    private var buffer = Data()
    var isActive: Bool { process != nil }
    var canStart: Bool { !isActive }
    var status: String {
        switch state {
        case .idle: return frames == 0 ? "Запись выключена" : "Запись сохранена: \(frames) кадров"
        case .starting: return "Запускается Screenpipe…"
        case .recording: return "Идёт запись · \(frames) кадров"
        case .stopping: return "Останавливается запись…"
        case .failed: return lastError ?? "Не удалось начать запись"
        }
    }
    static var helper: URL { Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/screenpipe-vklad") }
    static var recordings: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Vklad/ScreenpipeSessions", isDirectory: true)
    }
    static func check() -> [String: Any] {
        ["bundled_screenpipe": FileManager.default.isExecutableFile(atPath: helper.path),
         "screen_recording_allowed": CGPreflightScreenCaptureAccess(),
         "recording_started": false, "local_only": true]
    }
    static func arguments(directory: URL, parent: Int32) -> [String] {
        ["record", "--data-dir", directory.path, "--parent-pid", String(parent), "--interval", "30"]
    }
    static func selfTest() {
        let dir = URL(fileURLWithPath: "/tmp/Vklad test/session")
        let args = arguments(directory: dir, parent: 123)
        precondition(args.contains(dir.path))
        precondition(args.contains("--parent-pid") && args.contains("123"))
        precondition(!args.contains("--audio") && !args.contains("--port"))
        precondition(helper.path.hasSuffix("Vklad.app/Contents/MacOS/screenpipe-vklad"))
        print("PASS: bundled Screenpipe path, explicit session, parent ownership, local-only arguments")
    }
    func start() throws {
        guard process == nil else { return }
        guard FileManager.default.isExecutableFile(atPath: Self.helper.path) else {
            throw NSError(domain: "Vklad", code: 1, userInfo: [NSLocalizedDescriptionKey: "В сборке отсутствует Screenpipe. Установите полный клиент."])
        }
        guard CGPreflightScreenCaptureAccess() else {
            // This method is called only from the user's recording button.
            _ = CGRequestScreenCaptureAccess()
            throw NSError(domain: "Vklad", code: 2, userInfo: [NSLocalizedDescriptionKey: "Разрешите запись экрана для Vklad в настройках macOS. Затем снова нажмите «Начать запись»."])
        }
        let directory = Self.recordings.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: Self.recordings.path)
        let logURL = directory.appendingPathComponent("screenpipe.log")
        guard FileManager.default.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600]) else {
            throw NSError(domain: "Vklad", code: 3, userInfo: [NSLocalizedDescriptionKey: "Не удалось создать папку записи."])
        }
        let child = Process(), input = Pipe(), output = Pipe()
        child.executableURL = Self.helper
        child.arguments = Self.arguments(directory: directory, parent: getpid())
        child.standardInput = input
        child.standardOutput = output
        let log = try FileHandle(forWritingTo: logURL)
        child.standardError = log
        child.environment = ["HOME": NSHomeDirectory(), "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "RUST_LOG": "error"]
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil; return }
            Task { @MainActor in self?.consume(data) }
        }
        child.terminationHandler = { [weak self] finished in
            Task { @MainActor in self?.didStop(finished) }
        }
        self.process = child; self.input = input; self.output = output; errorLog = log
        sessionDirectory = directory; frames = 0; lastError = nil; buffer.removeAll(); state = .starting
        do { try child.run() }
        catch {
            output.fileHandleForReading.readabilityHandler = nil
            try? log.close(); process = nil; self.input = nil; self.output = nil; errorLog = nil
            state = .failed; lastError = error.localizedDescription; onChange?(); throw error
        }
        onChange?()
    }
    private func consume(_ data: Data) {
        guard process != nil else { return }
        buffer.append(data)
        if buffer.count > 1_048_576 { buffer.removeAll(); return }
        while let newline = buffer.firstIndex(of: 10) {
            let line = buffer[..<newline]; buffer.removeSubrange(...newline)
            guard let event = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                  let kind = event["event"] as? String else { continue }
            switch kind {
            case "ready": if state != .stopping { state = .recording }
            case "frame": if state != .stopping { frames += 1 }
            case "error": lastError = event["message"] as? String ?? "Ошибка Screenpipe"
            case "stopped": if let n = event["frames"] as? Int { frames = n }
            default: break
            }
        }
        onChange?()
    }
    func stop() {
        guard let child = process else { onStopped?(); return }
        if state == .stopping { return }
        state = .stopping; onChange?()
        try? input?.fileHandleForWriting.close()
        if child.isRunning { child.terminate() }
        Task { @MainActor [weak self, weak child] in
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            guard let self, let child, self.process === child, child.isRunning else { return }
            // Stop only the owned helper, never a user's independently running Screenpipe.
            kill(child.processIdentifier, SIGKILL)
        }
    }
    private func didStop(_ child: Process) {
        guard process === child else { return }
        output?.fileHandleForReading.readabilityHandler = nil
        try? input?.fileHandleForWriting.close(); try? errorLog?.close()
        process = nil; input = nil; output = nil; errorLog = nil
        if let directory = sessionDirectory {
            let metadata: [String: Any] = ["helper_exited": true, "exit_status": child.terminationStatus,
                "stopped_at": ISO8601DateFormatter().string(from: Date()), "frames": frames, "uploaded": false]
            if let data = try? JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys]) {
                try? data.write(to: directory.appendingPathComponent("client-stop.json"), options: .atomic)
                try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: directory.appendingPathComponent("client-stop.json").path)
            }
        }
        state = lastError == nil ? .idle : .failed
        if child.terminationStatus != 0 && lastError == nil {
            lastError = "Screenpipe завершился с ошибкой. Запись остановлена."; state = .failed
        }
        onChange?(); onStopped?()
    }
}
