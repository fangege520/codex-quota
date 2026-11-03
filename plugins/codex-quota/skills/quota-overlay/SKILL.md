---
name: quota-overlay
description: Install, launch, show, hide, stop, or troubleshoot the Codex Quota desktop overlay on macOS and Windows. Use for this plugin's quota widget; not general billing questions.
---

Manage the local Codex Quota overlay. It is a community plugin, not an OpenAI-built product. The plugin directory is two levels above this file's directory and contains `package.json`, `desktop/`, and `scripts/`.

## Install or launch

1. Resolve the absolute plugin directory from this skill's location. Use an available Node.js 22.12+ runtime and npm. Prefer an already installed modern runtime; if the PATH runtime is too old, check the Codex bundled workspace dependency runtime before proposing a system installation.
2. If dependencies are missing, run `npm ci` in the plugin directory. This installs only Electron and its small helper dependencies; build tools live outside the plugin. The first launch downloads the pinned Electron runtime for the current OS and architecture; it needs network access. Use the modern Node runtime for npm and its child processes. No compiler or Xcode is needed for the source launcher.
3. Run `node scripts/manage.cjs check` in that directory to verify account quota. This reads through the official local Codex app-server and never starts an inference turn. Do not print or copy credential files. `CHATGPT_LOGIN_REQUIRED` means the discovered CLI lacks a ChatGPT login; ask the user to complete the official `codex login` flow with the same account they use in the desktop app. Do not request an API key for subscription quota.
4. Run `node scripts/manage.cjs start`. This launches the overlay as a detached process and returns. It remains running after the chat ends. Tell the user about the tray menu and Ctrl/Command+Shift+Q shortcut. The launcher confirming a process was spawned does not prove the window is visible; distinguish that from a successful quota check.

## Controls

Use `node scripts/manage.cjs show|hide|toggle|stop` for the requested action. Closing or hiding the widget keeps it in the Windows tray or macOS menu bar. `stop` quits it. The native menu controls pinning, collapse, opacity, polling interval, language, CLI path and position. Launch at login is available in packaged builds; the source launcher leaves startup settings unchanged.

## Troubleshoot

- `CODEX_NOT_FOUND`: install the official Codex CLI or select an installed native Codex executable. `CODEX_QUOTA_CODEX_BIN` can specify the absolute native executable path. A packaged app launched outside this chat may not inherit the chat's environment; use the widget's executable picker to save its path.
- Desktop and CLI can use different accounts or `CODEX_HOME` directories. Check the selected CLI and ask the user to verify its login when displayed limits differ. Never silently change accounts.
- Network errors keep the last successful reading with an explicit cached-data warning. Missing quota is shown as unavailable, never as 100%. Do not infer new allowance when a reset timestamp passes.
- Windows and macOS are supported in source and packaging; a platform must pass its own checks before claiming it was tested.

## Remove

If asked to uninstall, stop the overlay and use Codex's plugin uninstall flow. Source installs need the runtime dependencies inside their plugin folder. Packaged desktop applications have their own uninstall flow. Preserve user settings unless their removal is explicitly requested.
