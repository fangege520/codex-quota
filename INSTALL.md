# 给 Codex 的安装说明

本仓库包含一个社区插件与本地桌面程序，支持 Windows、macOS Intel 和 Apple Silicon。执行安装请求时，先阅读本文件，再按当前系统执行。源代码启动不需要 C++ 编译器或 Xcode。

如果是更新已安装的版本，**先通过额度助手的托盘菜单退出它**，或使用旧版管理脚本的 `stop` 命令，等进程退出再操作插件缓存。Windows 会锁定运行中的 Electron 文件，直接替换缓存可能失败。这里只退出额度助手，不需要退出 Codex。

1. 下载或克隆仓库，保留仓库目录以便后续升级。确认 Node.js ≥22.12、npm 和支持 `codex plugin` 的官方 Codex CLI 可用。优先使用 Codex 提供的现代 Node 运行时。
2. 在仓库根目录运行 `node install.cjs`。脚本添加本仓库的插件源、安装 `codex-quota@codex-quota-marketplace`、在 Codex 返回的 `installedPath` 中下载运行依赖，然后创建助手入口和启动联动、验证真实额度并启动助手。现有插件源由 Codex CLI 自行合并。如需跳过本次立即启动，使用 `node install.cjs --no-start`，之后打开 ChatGPT 仍会拉起助手。
3. 如果账户未登录，引导用户通过官方 `codex login` 登录自己的 ChatGPT 账户，然后在脚本输出的实际安装目录中运行 `node scripts/manage.cjs check` 和 `node scripts/manage.cjs start`。不要读取、展示或上传认证文件。后续管理优先读取已安装插件的 skill，使用其绝对路径。
4. 安装后先看 Windows 任务栏或 macOS 菜单栏的额度。要显示 Codex 左栏，等当前任务完成，正常退出 Codex，再从专用入口打开。Windows 使用桌面或开始菜单的 **Codex（用量助手）**，macOS 使用 Finder 的 `~/Applications/Codex Quota.app`。如需输入框额度条或桌面悬浮框，在用量助手设置中开启对应开关。

Windows 使用当前用户的客户端启动事件，macOS 使用当前用户的 LaunchAgent 监听客户端启动。卸载插件前，在实际安装目录运行 `node scripts/manage.cjs stop`，等助手退出后运行 `node scripts/manage.cjs remove-launcher` 清理入口和联动。

有官方 Codex CLI 但无法自动定位时：设置 `CODEX_QUOTA_CODEX_BIN` 为原生可执行文件的绝对路径。Windows 使用 `codex.exe`，不传入 `.cmd` 包装脚本。macOS 可以使用 PATH 上的 `codex` 可执行脚本。
