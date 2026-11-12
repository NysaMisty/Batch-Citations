# Zotero 编号批量引用可行性核查

核查日期：2026 年 11 月 2 日。

## 结论与最小版本

采用安装在 Zotero 内的插件管理编号映射，读取已保存 DOCX，以 OOXML 写入正式引用域及文档设置，另存新副本。引用域保存条目 URI 和完整 CSL 数据，参考文献域独立存在。初始结果使用 Zotero 内置 CSL 引擎的文字输出；Word 的官方 Zotero Refresh 负责最终富文本排版与后续更新。

这是依据官方集成实现作出的兼容格式方案，引用域格式属于内部接口，需要按具体版本验证。无需请求在线 Zotero Web API，也不直接写 Zotero 数据库。

已在 Zotero 7.0.32、10.0.7 与 Windows 桌面 Word 16.0.20527.20112 的实际集成中验证：Word 识别 4 处引用和 1 处参考文献表；官方 Refresh 正常处理这些域；修改测试库中的条目标题并再次 Refresh 后，参考文献表和引用内嵌元数据同步更新。具体检查与尚未执行的界面验收见 [测试记录](TESTING-0.2.0.md)。

## 插件与版本接口

用户提供的[中文开发指南](https://zotero-chinese.com/plugin-dev-guide/)明确其内容面向 Zotero 7；[清单说明](https://zotero-chinese.com/plugin-dev-guide/reference/manifest)介绍最小和最大兼容版本，[引导脚本说明](https://zotero-chinese.com/plugin-dev-guide/reference/bootstrap)介绍 startup、shutdown 与窗口生命周期。它没有承诺所有后续大版本的内部 API 一直相同。

官方 [Zotero 7 开发文档](https://www.zotero.org/support/dev/zotero_7_for_developers)也要求使用 manifest.json + bootstrap.js，并建议把最大兼容版本设为已测试的版本范围。因此，本项目区分安装范围、源码核对和运行测试。

宿主试验还发现：Zotero 7.0.32 的清单读取器要求 `applications.zotero.update_url`；缺失时会拒绝整个 XPI。初版已修正，使用保留的 `.invalid` 域名表示没有实际更新服务，只支持手动安装后续版本。不能仅据指南字段说明省略此项。

## Word 集成能做什么

官方 [Word 插件说明](https://www.zotero.org/support/word_processor_plugin_usage)确认，Refresh 会更新文档引用与参考文献表，Add/Edit Citation 管理域中的文献。Windows 官方集成仓库的 [README](https://github.com/zotero/zotero-word-for-windows-integration)说明其采用 C++、OLE Automation 和 JavaScript 包装器连接 Microsoft Word。

官方 [HTTP Citing Protocol](https://www.zotero.org/support/dev/client_coding/http_integration_protocol)包含 addEditCitation、refresh、getFields、insertField 等事务式接口。该协议要求文档处理器实现一组双向命令；它不是一次 POST 编号映射就能让任意 DOCX 自动转换的服务。接口中的 placeholder 指 Zotero 特定超链接标记，不能直接等同于任意手写 `[1]`。

基于这些接口定义，本项目没有把“扫描正文并定位所有人工占位符”视为现成的稳定批量 API。第一版选择离线 DOCX 转换，将原生 Word 集成留给 Refresh；直接接管正在编辑的 Word 窗口作为后续独立功能。

## 已核对的存储协议

Zotero 7 核心源码审计固定到提交 [`188c54c186fbbaa6889145986d43ba64160a44fa`](https://github.com/zotero/zotero/blob/188c54c186fbbaa6889145986d43ba64160a44fa/chrome/content/zotero/xpcom/integration.js)，对应 7.0.32 分支末端。另读取本机 Zotero 10.0.7 自带的集成源码进行对照。没有把前一个聊天里提及的第三方插件能力作为实现依据。

| 核查点 | 官方实现 | 本项目行为 |
|---|---|---|
| 引用代码 | CitationField / Citation.toJSON() | `ADDIN ZOTERO_ITEM CSL_CITATION` 后附 JSON |
| 条目标识 | URIMap、Citation.loadItemData() | 保存当前库的稳定 URI；导入映射时重新解析 URI |
| 嵌入数据 | citationItems[].itemData | 保存由 Zotero.Cite.System 取得的 CSL 数据 |
| 唯一出现位置 | citationID | 每处引用独立生成标识，同一文献重复引用也不共用 |
| 参考文献表代码 | BibliographyField / Bibliography | `ADDIN ZOTERO_BIBL … CSL_BIBLIOGRAPHY` |
| 文档设置 | DocumentData.serialize / unserialize | JSON，dataVersion 4，Field、noteType 0、样式及语言 |
| Word 属性分段 | Windows [document.cpp](https://github.com/zotero/zotero-word-for-windows-integration/blob/main/build/zoteroWinWordIntegration/document.cpp) 的 getProperty / setProperty | 依次写入 `ZOTERO_PREF_1` 等属性，每段不超过 255 个 UTF-16 单元 |
| Word 域前缀 | Windows [field.cpp](https://github.com/zotero/zotero-word-for-windows-integration/blob/main/build/zoteroWinWordIntegration/field.cpp) 的 FIELD_PREFIXES | 使用 ` ADDIN ZOTERO_` 前缀 |

OOXML 复杂域使用 begin、指令、separate、显示结果、end 顺序，符合 Microsoft 的 [FieldChar 文档](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.fieldchar)。引用 JSON 由 XML 文本节点序列化，避免文献标题中的 `&`、`<` 等字符破坏文件。

## 最小版本的取舍

只处理主文档的普通正文和表格，不把多个文档 story 的位置顺序、脚注编号和脚注型样式带入第一版。候选位置必须由用户明确勾选，因为仅凭 `[1]` 字面形式无法可靠地区分引用、数组和数学记号。

只输出新路径，拒绝覆盖已有文件；导出前重新检查源文件字节，避免扫描后编辑造成错位。已有 Zotero 域和文档设置、修订、宏和签名文档会被拒绝。未修改的 ZIP 条目在重新打包后保留相同的解压字节，压缩容器本身会变化。

## 0.2.0 按序选择的接口核查

核对两版宿主的 `selectItemsDialog.js`：条目激活通过 `dialog.acceptDialog()` 进入确认流程，返回值来自 `itemsView.getSelectedItems(true)`。该接口未承诺返回点击的先后顺序，因此本版逐次加入有序草稿，再自动前进到下一编号。

插件调用原生 `selectItemsDialog.xhtml`，在自己打开的实例中添加队列，并捕获 `dialogaccept` 执行校验和加入。Zotero 7 与 10 的条目树实现不同，分别使用 `singleSelection` 和 `multiSelect` 配置，本版同时传入适用值，并启用 `onlyRegularItems`。条目树、资料库导航及搜索仍由宿主实现。

编号唯一性在界面、导入合并、URI 重新解析后和导出前检查。稳定 URI 的不同别名最终解析到同一当前条目时，也会被拒绝分配给不同编号。批量草稿只有确认应用时才提交给主窗口。

## Word、WPS 与平台

官方[文档处理器集成列表](https://www.zotero.org/support/word_processor_integration)列出 Word、LibreOffice 和 Google Docs，没有列出 WPS。由此只能认定官方没有在该列表中提供 WPS 集成，不能断言任何第三方 WPS 方案都不存在。

本插件没有实现 WPS 适配层，且尚未在 WPS 验证域代码保留与刷新。WPS 生成的 DOCX 作为普通输入文件另行通过预检；生成后的动态更新以 Microsoft Word 为目标。macOS Word、Word 网页版和移动版也不能用 Windows 桌面试验结果替代验收。
