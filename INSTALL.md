# 安装 Codex Quota

支持 Windows 和 macOS（Apple Silicon 或 Intel）。需要 Node.js 22.12 或更新版本、npm，以及支持 `codex plugin` 的 Codex CLI。可以优先使用 Codex 自带的现代 Node 运行时。

1. 下载或克隆仓库。已安装的用户请先从托盘或菜单栏退出用量助手。
2. 在仓库根目录运行 `node install.cjs`。安装成功后会启动用量助手并检查额度。
3. 如果提示未登录，请运行 `codex login` 并登录自己的 ChatGPT 账户，然后再次运行安装命令。遇到系统授权提示时，由本人操作。

## 安装后使用

- **Windows**从桌面或开始菜单打开 **Codex（用量助手）**。在任务栏或托盘查看额度。
- **macOS**在 Finder 中打开 `~/Applications/Codex Quota.app`。在顶部菜单栏查看额度。

要显示 Codex 左栏，等当前任务完成并正常退出 Codex，再从上述入口打开。可在用量助手设置中开启编辑框额度或桌面悬浮框。
