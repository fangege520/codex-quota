# 给 Codex 的安装说明

本仓库包含一个社区插件与本地桌面程序，支持 Windows、macOS Intel 和 Apple Silicon。执行安装请求时，先阅读本文件，再按当前系统执行。源代码启动不需要 C++ 编译器或 Xcode。

1. 记录仓库绝对路径，并确认 Node.js ≥22.12、npm 和官方 Codex CLI 可用。可优先使用 Codex 提供的现代 Node 运行时；不要为了此插件改动用户的全局 Node 版本。
2. 在仓库根目录运行 `node install.cjs`。脚本添加本仓库的插件源、安装 `codex-quota@codex-quota-marketplace`、在 Codex 返回的 `installedPath` 中下载运行依赖、验证真实额度并启动。现有插件源由 Codex CLI 自行合并，不手动覆盖用户的 `marketplace.json` 或 `config.toml`。如只需安装和额度检查，可用 `node install.cjs --no-start`。
3. 如果账户未登录，引导用户通过官方 `codex login` 登录自己的 ChatGPT 账户，然后在脚本输出的实际安装目录中运行 `node scripts/manage.cjs check` 和 `node scripts/manage.cjs start`。不要读取、展示或上传认证文件。后续管理优先读取已安装插件的 skill，使用其绝对路径。
4. 告知用户插件可能需要重启 Codex 并在新聊天使用。个人/本地来源的显示位置取决于客户端版本。托盘菜单可以隐藏、折叠、退出；快捷键是 Ctrl/⌘+Shift+Q。

安装脚本只注册本仓库并安装本插件，不发布仓库、不打开开机自启、不替换用户现有账户。不要添加定时 AI 任务来刷新额度。

有官方 Codex CLI 但无法自动定位时：设置 `CODEX_QUOTA_CODEX_BIN` 为原生可执行文件的绝对路径。Windows 使用 `codex.exe`，不传入 `.cmd` 包装脚本。macOS 可以使用 PATH 上的 `codex` 可执行脚本。
