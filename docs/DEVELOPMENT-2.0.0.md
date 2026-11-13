# 2.0.0 发布准备与测试

本版统一 Zotero XPI、Word 加载项和安装包的版本，保留现有插件 ID，补齐 GitHub 发布和更新信息。此前开发记录已归并到 [变更记录](../CHANGELOG.md)。

| 本地验证 | 结果 |
|---|---|
| Node 自动回归及发布工具 | 206 项通过 |
| Zotero 7.0.32 隔离宿主 | 105 项通过 |
| Zotero 10.0.7 隔离宿主 | 105 项通过 |
| Word DLL 及 ZIP | 构建成功，ZIP 内 DLL 与构建结果逐字节一致 |
| Word 实机联动 | 执行环境拒绝写入临时 COM 注册 |
| Word 独立安全检查 | 执行环境拒绝创建 Word COM 对象 |
| Word 窗口激活、独立完整性及事务管线 | 待运行 |

两版 Zotero 宿主使用独立资料库及合成文献。被测 XPI 与本地 2.0.0 构建包内容一致，Word DLL 的 SHA-256 为 `8cc966e058711c32976459a3d7818f3814cf28087596e7f6231a3562143afbc9`。插件兼容范围声明为 Zotero 7.0–10.0.x，本轮宿主测试覆盖 7.0.32 和 10.0.7。

本分支用于准备 2.0.0。完成 Word 实机验证后再发布 2.0.0 安装包。现有正式包见 [GitHub 发行版](https://github.com/NysaMisty/Batch-Citations/releases)。
