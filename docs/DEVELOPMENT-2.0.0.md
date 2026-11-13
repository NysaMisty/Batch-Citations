# 2.0.0 测试报告

本版统一 Zotero 插件、Word 加载项与安装器版本，保留插件 ID，更新 GitHub 下载与 Zotero 更新地址。功能和此前修正见 [变更记录](../CHANGELOG.md)。

| 验证 | Zotero 7.0.32 | Zotero 10.0.7 |
|---|---:|---:|
| 原生资料库、编号匹配、DOCX 和界面布局 | 105 | 105 |
| Word 引用插入、原生刷新与保存重开 | 53 | 53 |
| 窗口打开、复用、最小化恢复与连续批次 | 63 | 63 |

Node 自动回归 206 项通过。独立 Word 检查分别通过 15 项写入安全、8 项引用完整性、8 项事务管线检查。两版使用 Windows 桌面 Word 16.0.20527、独立 Zotero 资料库和测试文档。两次窗口测试均采样到实际前台窗口，且无 Windows API 错误。临时 COM 注册和模板均恢复。

发布核验已将受测 XPI 逐项与成品源码对照，并核对 DLL 的 SHA-256。插件声明兼容 Zotero 7.0–10.0.x，本轮实测 7.0.32 和 10.0.7。测试覆盖了这一台 Windows 电脑和上述 Word 版本。

- [安装包与 SHA-256 校验值](https://github.com/NysaMisty/Batch-Citations/releases/tag/v2.0.0)
