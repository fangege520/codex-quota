# Codex Quota · 用量助手

在 Windows 和 macOS 上查看 Codex 的 5 小时和每周剩余额度。

## 界面

- **任务栏和菜单栏**显示剩余额度。Windows 在任务栏有空位时显示，macOS 在顶部菜单栏显示。
- **Codex 左栏**显示额度、重置时间、点数和重置卡。把鼠标移到会话上可查看会话 Token；每轮用时旁可查看本轮 Token 和推理强度。
- **用量助手设置**提供今日、本周、本月的 Token 图表，可分别开启左栏、编辑框额度、系统栏和桌面悬浮框。

![用量助手设置（演示数据）](docs/settings-preview.png)

## 使用

| 平台 | 启动入口 | 查看额度 |
| --- | --- | --- |
| Windows | 桌面或开始菜单的 **Codex（用量助手）** | 任务栏额度或托盘图标 |
| macOS | Finder 中的 `~/Applications/Codex Quota.app` | 顶部菜单栏 |

要显示 Codex 左栏，请等当前任务完成，正常退出 Codex，再从对应入口打开。点击左栏齿轮或右键点击系统栏组件可打开设置。按 `Ctrl+Shift+Q`（Windows）或 `⌘+Shift+Q`（macOS）可切换桌面悬浮框。

![桌面悬浮框（演示数据）](docs/compact.png)

## 安装

在 Windows 或 macOS 的 Codex 桌面端发送这一句：

```text
请下载 https://github.com/fangege520/codex-quota，读取 INSTALL.md，按当前系统安装并启动 Codex 用量助手，创建启动入口并验证额度显示。
```

手动安装请见 [安装说明](INSTALL.md)。首次安装需要联网，ChatGPT 登录和系统授权由本人操作。
