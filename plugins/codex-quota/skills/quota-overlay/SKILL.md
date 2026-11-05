---
name: quota-overlay
description: Install or manage Codex Quota in the Windows taskbar, macOS menu bar, desktop overlay and experimental composer strip. Use for this plugin's quota widget; not general billing questions.
---

Manage the local Codex Quota overlay. It is a community plugin, not an OpenAI-built product. The plugin directory is two levels above this file's directory and contains `package.json`, `desktop/`, and `scripts/`.

Before upgrading/reinstalling this plugin, stop the existing companion and wait for it to exit. On Windows its Electron executable locks the plugin cache; replacing that cache while it runs can fail. If an interrupted cache upgrade removed the old management script's dependencies, a source checkout with dependencies can run `node scripts/manage.cjs stop` to signal the same single-instance app. Stopping the companion does not stop Codex tasks.

## Install or launch

1. Resolve the absolute plugin directory from this skill's location. Use an available Node.js 22.12+ runtime and npm. Prefer an already installed modern runtime; if the PATH runtime is too old, check the Codex bundled workspace dependency runtime before proposing a system installation.
2. If dependencies are missing, run `npm ci` in the plugin directory. This installs only Electron and its small helper dependencies; build tools live outside the plugin. The first launch downloads the pinned Electron runtime for the current OS and architecture; it needs network access. Use the modern Node runtime for npm and its child processes. No compiler or Xcode is needed for the source launcher.
3. Run `node scripts/manage.cjs check` in that directory to verify account quota. This reads through the official local Codex app-server and never starts an inference turn. Do not print or copy credential files. `CHATGPT_LOGIN_REQUIRED` means the discovered CLI lacks a ChatGPT login; ask the user to complete the official `codex login` flow with the same account they use in the desktop app. Do not request an API key for subscription quota.
4. Run `node scripts/manage.cjs start`. This stages application files and Electron into the persistent `codex-quota/runtime/<version>` application-data directory, then launches the overlay detached. Codex can rebuild its plugin cache at startup; never create a durable shortcut pointing to Electron inside that cache. Use the staged runtime for shortcuts. If that version has already been staged, the manager works even when cached `node_modules` is missing. It remains running after the chat ends. Tell the user about the tray menu and Ctrl/Command+Shift+Q shortcut. The launcher confirming a process was spawned does not prove the window is visible; distinguish that from a successful quota check.

## Controls

Use `node scripts/manage.cjs show|hide|toggle|stop` for the requested action. Closing or hiding the widget keeps it in the Windows tray or macOS menu bar. `stop` quits it. The native menu controls pinning, collapse, opacity, polling interval, language, CLI path and position. Launch at login is available in packaged builds; the source launcher leaves startup settings unchanged.

The system bar is enabled by default. Windows shows remaining quotas in a separate window positioned in an unoccupied horizontal taskbar area; macOS shows both quotas in the menu bar title. Use `system-bar-on|system-bar-off` to change this. Left-click opens the redesigned detail panel; right-click opens settings. Windows also supports hover details. Appearance supports system, light and dark. No safe taskbar space, hidden taskbars, fullscreen windows or unavailable system metadata hides the Windows strip rather than covering native icons; the tray remains available.

`composer-status` includes a `systemBar` section with enabled/visible/reason. For local visual diagnosis, `snapshot` saves only the companion's own panel and taskbar PNGs plus bounds metadata in the `codex-quota/previews` application-data directory; it does not capture other apps. Do not commit real account screenshots to a public repository. Use demo smoke-test images for documentation. A real Mac desktop must be checked before claiming native menu bar layout verified; CI validates the API title and fixture panel only.

## Troubleshoot

- `CODEX_NOT_FOUND`: install the official Codex CLI or select an installed native Codex executable. `CODEX_QUOTA_CODEX_BIN` can specify the absolute native executable path. A packaged app launched outside this chat may not inherit the chat's environment; use the widget's executable picker to save its path.
- Desktop and CLI can use different accounts or `CODEX_HOME` directories. Check the selected CLI and ask the user to verify its login when displayed limits differ. Never silently change accounts.
- Network errors keep the last successful reading with an explicit cached-data warning. Missing quota is shown as unavailable, never as 100%. Do not infer new allowance when a reset timestamp passes.
- Windows and macOS are supported in source and packaging; a platform must pass its own checks before claiming it was tested.

## Sidebar, launcher and settings

Use `node scripts/manage.cjs settings` to open centered configuration. On Windows, `create-launcher` creates the Codex with Quota desktop and Start menu shortcuts. After fully quitting ordinary Codex, use this entry; on macOS use the tray launch command or `launch-codex`. This launches both the companion and Codex with a local CDP connection. The stock app icon does not enable the connection. Do not force-quit Codex.

Inspect `composer-status`: `sidebarVisible` is separate from the optional composer strip. Only claim native sidebar visibility when it is confirmed in the actual client. Fixture checks do not prove attachment to an already-running ordinary instance.

The rail shows both allowances, plan, credit balance and saved resets with hover details. The fixed official links navigate only; purchases and redemption remain manual. Per-chat hover shows locally recorded tokens or a labeled read-only account estimate if available. Charts summarize local token events in the system time zone. No credentials or conversation contents are sent to the widgets.

The gear is on the rail, not in the composer. Settings has display switches for composer, system bar and floating panel. `composer-off` only hides the optional strip; the left rail remains. When rail space is insufficient, use tray settings. Stopping the companion removes its widgets; fully quit Codex and launch normally to close the debugging port.

## Remove

If asked to uninstall, stop the overlay and use Codex's plugin uninstall flow. Source installs need the runtime dependencies inside their plugin folder. Packaged desktop applications have their own uninstall flow. Preserve user settings unless their removal is explicitly requested.
