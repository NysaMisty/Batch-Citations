# 编号批量引用 · Batch Citations 1.0.0

在 Windows 桌面 Word 当前文档中，把人工确认的 [1]、[2]、[1,3]、[1–3] 批量转为 Zotero 动态引用。直接编辑打开的文档，无需关闭重开，不生成副本，不自动保存。

本版由 **Zotero XPI + 配套 Word 加载项**组成。Word 负责范围定位与插入；Zotero 负责文献选择、稳定关联和官方引用排版。当前提供单独的“编号批量引用”标签，官方 Zotero 标签继续使用。尚未合并两个标签，原因见 [Word 架构说明](docs/WORD-INTEGRATION.md)。

## 安装

1. 解压 zotero-batch-citations-1.0.0-bundle.zip。
2. Zotero → 工具 → 插件 → 齿轮 → 从文件安装，选择 zotero-batch-citations-1.0.0.xpi，可替换 0.2.0。
3. 保存并关闭 Word。解压其中的 zotero-batch-citations-1.0.0-word.zip，双击 Install.cmd。
4. 保持 Zotero 运行，正常打开 Word 和文档，确认出现“编号批量引用”标签。首次安装需重启 Word，日常操作不需重开文档。

也可运行：

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
~~~

脚本仅对该进程设置执行方式，不修改系统执行策略。使用当前用户注册和 %LOCALAPPDATA%\ZoteroBatchCitations\word\1.0.0 版本目录，不修改 Normal.dotm、Zotero.dotm 或宏安全设置。没有自动更新服务器，后续版本手动安装。

支持 Windows 桌面 Word、.NET Framework 4.x 和可用的 Zotero 官方 Word 集成。实测 Word 16.0.20527、Zotero 7.0.32 / 10.0.7。WPS、Word 网页版、macOS 和移动版不支持本版原位工作流。

## 批量插入

1. 在 Word 正文保留原编号，新建但尚未保存的文档也可使用。
2. 点击“编号批量引用 → 批量匹配编号”，在 Zotero 映射窗口为每个编号选择文献。
3. 连续编号可“按序批量选择文献”，在同一个窗口依次加入并应用全部映射；不连续编号仍可逐项选择。
4. 勾选确实属于引用的位置，默认不勾选，避免误转数学或数组编号。
5. 新文档选择引用格式和语言；已有引用的文档沿用原设置，更换格式用“文档引用格式”或官方 Document Preferences。
6. 点击“插入并刷新当前文档”，等待完成后回到 Word 查看并保存。

不同原编号不能分配同一条目；同一编号可以反复出现。“导入/导出映射”沿用稳定条目 URI。插件不会根据编号猜论文。

原编号只用于匹配，最终编号由 CSL 按文献出现顺序生成。例如原文先 [2] 后 [1]，可变成 [1]、[2]。已有域不会重复转换，可以继续添加手写编号后再次批量插入。

扫描后若正文、格式或 Zotero 设置变化，提交会停止；关闭映射窗口并重新发起。切换窗口不会将计划写入另一文档。

## 文献表、刷新和编号显示

| 按钮 | 行为 |
|---|---|
| 插入 / 编辑引用 | 调用官方引用对话框，管理光标处的引用 |
| 插入 / 更新参考文献表 | 无文献表时在折叠光标处插入；已有时刷新，不重复插入 |
| 刷新引用和文献表 | 官方引擎重新编号，更新元数据和文献表 |
| 文档引用格式 | 调用官方文档首选项 |
| 上标编号 / 正文编号 | 一次调整已有数字型引用的显示，偏好随文档保存 |

可以继续使用官方 Zotero 标签中的 Add/Edit Citation、Add/Edit Bibliography 和 Refresh。引用保存唯一 citationID、稳定 URI 和 CSL itemData，文档保存标准 Zotero 设置；重开后继续管理，不依赖内存映射。

本加载项自己的刷新会重新应用显示偏好。**官方按钮单独刷新可能按照 CSL 重置字体覆盖**，此时再点一次显示按钮，或选择本身符合要求的 CSL 样式。作者年份引用不适用编号切换。

插件不删除手写文献表，请先处理旧列表，再把光标放在指定位置插入动态文献表。实时模式不需要 {{ZOTERO_BIBLIOGRAPHY}} 标记。

## 数据保护和范围

- 扫描主文档正文和表格；编号可跨文字格式片段。已有域、超链接、内容控件及“参考文献 / References / Bibliography”标题后的编号受保护。
- 页眉页脚、脚注尾注、文本框、批注不批量转换。只读、保护、修订开启或尚存修订时停止写入。
- 每次最多 2000 个候选、正文最多 5 Mi 字符；单个范围跨度最多 100，单簇最多 200 个编号。
- 写入前校验完整计划，再按倒序替换；插入异常自动撤销本批修改并恢复原 Zotero 设置。
- 批量写域、官方刷新、显示切换分别属于 Word 的撤销步骤。
- 若域已插入但刷新失败，会明确报错并保留关联，可重试刷新或撤销，不宣称排版成功。

建议只运行一个 Zotero 实例。多实例下若原生接口无法确认带本次随机值的文档，会停止。自动化方式启动的 Word 不能替代正常启动的功能区验收。

## 文件兼容模式

Zotero → 工具 → 编号批量引用仍能读取已保存 DOCX，预览后导出新副本。这是保留的旧工作流，详见 [0.2.0 使用说明](docs/history/README-0.2.0.md)。

## 开发与测试

[测试说明](docs/TESTING.md)列出自动测试、真实 Word、隔离库与未执行项。只使用合成资料，未修改项目根目录 test.docx 或真实资料库。

~~~powershell
npm ci --ignore-scripts
npm test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File word-addin\build.ps1
npm run build
~~~

开发需要 Node.js 20+、Python 3、Windows .NET 编译器和 Office 接口元数据。成品无需 Node.js、Python、API 密钥或互联网服务；无需另装 VSTO / PIA。dist 生成 XPI、Word ZIP、bundle ZIP、源码 ZIP 和 SHA-256。

## 卸载

保存并关闭 Word，运行 Uninstall.cmd，仅移除本项目的用户注册，保留安装文件和文档。Zotero 端在插件管理器移除。标准引用域仍可由官方插件管理；Unlink Citations 会断开动态关联，请仅在确需断开时使用。

## 许可

本项目 MIT；fflate 的 MIT 许可随包保留。本项目不是 Zotero 官方插件，未复制 Zotero 或第三方插件源代码进成品。技术依据见 [架构说明](docs/WORD-INTEGRATION.md)。
