# Word 实时集成架构与接口

日期：2026-11-03；版本：1.1.1。

## 方案

Word 端是 .NET Framework COM 加载项；Zotero 端仍为本项目 XPI。Word 的范围查找、域插入、保护检查和撤销全部在 Word UI 线程执行。后台线程仅向 Zotero 自带的 loopback HTTP 服务传输 JSON，不处理磁盘上的 DOCX，不调用外部转换程序。

复用 0.2.0 的 `core.js`、`mapping.js`、`picker.js`、`zotero-adapter.js` 和映射窗口；离线导出作为兼容模式保留。没有重写 CSL 排版引擎、条目身份协议或 Zotero 的文献表管理。

## 模块

| 模块 | 责任 |
|---|---|
| `word-addin/Connect.cs` | COM 生命周期、共享 Ribbon、事件驱动任务状态和防抖扫描 |
| `word-addin/DocumentEvents.cs` | Word 编辑/选区/窗口事件与进程内可访问性通知，断开时清理 |
| `word-addin/WordLauncher.cs` | Windows 消息唤醒，只触发打开界面或读取经过认证的任务状态 |
| `word-addin/RibbonIntegration.ps1` | 原模板完整备份、共享标签适配、幂等安装与有条件恢复 |
| `word-addin/RibbonImages.cs` | 同一风格的透明 OLE 图标，正文 X2 保持相同基线 |
| `addon/content/literature.js` | CSV/TSV 编解码、格式校验和旧 JSON 兼容 |
| `word-addin/Toast.cs` | 不抢焦点且自动消失的顶部反馈 |
| `word-addin/WordDocument.cs` | Find 坐标、保护范围、快照摘要、原位写域、异常回滚、编号显示 |
| `word-addin/BridgeClient.cs` | 固定 loopback 地址、令牌认证、超时和错误传递 |
| `addon/content/live-core.js` | 校验 Word 快照；复用编号语法和引用 JSON；生成绑定文档的计划 |
| `addon/content/live-service.js` | 单任务状态机；初始化文档设置；官方 WinWord 引擎调用 |
| `addon/bootstrap.js` | 注册端点、生成发现文件、生命周期清理 |
| `addon/content/dialog.*` | 同一映射界面的 Word 实时模式和文件兼容模式 |

## 事务

`start → pending → ready → committed → running → done / error`。关闭尚未提交的映射窗口得到 `cancelled`；任务 15 分钟过期。插件关闭后拒绝新请求。已提交任务不能再次提交。客户端出错会尝试取消未提交任务。

1. Word 捕获文档对象、选择范围和主文档 XML 摘要，用原生 Find 获取坐标，避免中文、代理对和跨文字格式片段造成位置偏移。
2. Zotero 显示候选和映射；不默认勾选。提交时重新解析当前资料库 URI 并判重。
3. Word 比较文档键、摘要和全部原始范围，重新检查保护状态；文档或格式变化则停止，不部分写入。
4. Word 激活捕获的文档再开始 UndoRecord，按倒序插入引用。按照官方 `insertFieldRaw` 先创建 QUOTE 域，再写入 ADDIN 代码；直接创建 ADDIN 在当前 Word 会产生空结果范围。
5. C# 写入标准 `ZOTERO_PREF_n` 分段设置，并增加一次性 `prefs.zbcTransaction`。HTTP 提交响应返回后，Zotero 才开始访问 Word，避免相互等待。
6. Zotero 原生接口获取文档后必须读到完全一致的文档设置和事务随机值，否则只清理句柄，不执行引用命令。没有保存路径时使用非路径标识走官方活动文档回退；该回退也必须通过随机值检查。
7. 使用官方 `getSession` 和 `Integration.Interface` 执行刷新、引用对话框及文献表操作。异常传回 Word；标准域仍保留，可重试刷新。初始域写入的异常会自动撤销本批修改并恢复原 Zotero 设置。

8. 官方调用完成后，Word 重读最终数字引用并释放当前目标、事件观察和超时。异步发送 `completed` 确认；Zotero 只关闭与该任务关联的窗口。确认延迟时允许新批次，旧确认不能关闭新窗口。所有异步回调带操作代数，已取消或完成的旧请求不能改写新状态。

外部 COM 调用可能来自 RPC 线程。`ExecuteCommand`、文档检查和诊断通过 Word UI 控件调度，避免跨线程文档 RCW 身份差异导致重开后的自动检查失效。每个新批次重绑观察事件，结束时释放观察目标。

摘要只覆盖主文档结构、格式和 Zotero 设置；排除 Word 每次导出都会变化的 rsid 和拼写检查标记。它不试图锁定文档或检测其他故事区域的所有变化。提交前还会再次拒绝修订、只读和保护状态。

## 持久化

每个引用保存唯一 citationID、文献 URI 和 CSL itemData；文档保存标准 Zotero 设置。重开后不依赖本机编号映射表或内存会话。编号由 CSL 按文献出现顺序生成。同一文献在后续批次重用原 URI，不产生新的书目身份。

上标/正文偏好另存为 `ZBC_DISPLAY`，只修改数字型引用的结果字体。本加载项自己的刷新、文献表和引用操作结束后重新应用。官方按钮单独刷新可能重置这层字体覆盖；此时再次点击编号显示按钮，或使用所需显示方式的 CSL 样式。当前没有修改官方刷新函数，也未创建自定义 CSL 派生样式。

## 安装和本地通信

安装脚本注册本项目的当前用户 COM 类和 Word Addins 键，并部署版本目录。关闭 Word 后，对实际使用的 Zotero.dotm 完整备份，再只适配功能区标签标识，不改原按钮或 VBA；不修改 Normal.dotm 或宏安全设置。32/64 位注册均写入，程序集为 AnyCPU。Office 接口元数据嵌入程序集，无需另装 VSTO 或 PIA；开发构建需要 Office 提供的接口元数据。

发现文件为 `%LOCALAPPDATA%\ZoteroBatchCitations\connection.json`，包含随机令牌、本地端口、组件版本及 Zotero processID。Zotero 的独立测试 profile 将其重定向到各自测试目录。Word 只允许 `127.0.0.1`，禁用代理和重定向。端点只接受带令牌的 POST JSON，拒绝浏览器 Origin / Sec-Fetch 请求，不提供网页跨域访问。该令牌不是对同一 Windows 用户下恶意进程的隔离边界。

## 同一 Zotero 标签

官方模板使用未限定的 `id="ZoteroTab"`。1.1.0 安装器备份整份模板后，将该标识替换为共享 `idQ`，并声明 `urn:zotero-batch-citations:shared-ribbon` 命名空间。COM 加载项使用相同命名空间和 `ZoteroTab`；本项目只贡献“批量匹配编号”和“编号显示”两个入口。原生引用、文献表、刷新和首选项按钮全部来自原模板。

仅重写 `customUI/customUI.xml` 或 `customUI/customUI14.xml` 的标签标识；其余 ZIP 条目尤其 VBA 字节保持一致。替换前校验完整备份并保存原件/适配件 SHA-256；通过同目录临时文件原子替换。重复安装不重复修改。卸载仅在当前模板摘要仍匹配适配件时恢复原始字节，避免覆盖之后安装的新 Zotero 模板。Zotero 官方升级覆盖模板后，重新运行安装器进行适配。

1.1.0 的 Word 可访问性记录已确认共享标签合并。1.1.1 在正常启动的 Word 中加载最终程序集和两版官方模板的隔离副本，检查共享 XML、两个入口、Batch Citations 分组及原按钮保留；图标另经真实 OLE 图片回读、透明像素和基线检查。本版没有新增 Word 功能区整窗截图验收。开发测试恢复原模板会话和注册，用户原模板文件摘要保持一致。

## 自动检查与通知

Word 没有通用正文 TextChanged 事件。加载项监听 WindowSelectionChange、WindowActivate/Deactivate、DocumentChange、DocumentBeforeSave，以及当前 Word 进程的 EVENT_OBJECT_VALUECHANGE、EVENT_OBJECT_TEXTSELECTIONCHANGED、当前 Word 进程的 EVENT_SYSTEM_FOREGROUND。事件只启动一次 650 ms 防抖；空闲时不扫描。读取、Find、摘要与写域继续限定在 Word UI 线程，后台线程只发送 JSON。

待处理文档有稳定 documentKey。摘要变化后，通过 `snapshot` 更新服务快照；界面使用订阅即时更新，并撤销变化位置的勾选。成功批次在完成确认中检查最终数字引用，随后关闭对应窗口；重新打开后捕获当前文档的新快照。协议仍保留 `checked` 端点。映射窗口打开、导入、单条修改和按序选择完成都会立即运行连续性计算。

Windows 消息只作唤醒，不能携带文献数据或写入计划。Zotero 发出 JobChanged 后 Word 才读取一次认证端点；协议保留 `poll` 名称以兼容内部方法，但没有定时状态轮询。另一条单次消息从 Zotero 工具菜单打开当前 Word 文档。15 分钟计时器只处理任务超时，不执行扫描。Zotero 窗口、文献选择器也不使用持续轮询；只允许文献选择器加载阶段的有界就绪等待。

窗口点击时先用发现文件中的确切 Zotero PID 允许并请求前置对应进程，再在 Gecko 中恢复并聚焦目标窗口；编号显示操作不切到 Zotero。该方式参照 [Zotero 官方模板](https://github.com/zotero/zotero-word-for-windows-integration/blob/main/build/template/Zotero.dotm/word/vbaProject.bin/Zotero.bas) 的窗口激活调用。

界面直接加载 `chrome://zotero-platform/content/zotero.css` 和宿主自定义控件，通过 `UIProperties.registerRoot` 沿用字体及密度偏好。文献选择继续复用原生 selectItemsDialog，没有重做库导航或条目选择。

界面订阅、Word 事件、WinEvent hook、消息窗口与 Toast 超时在对应生命周期结束时清理。所有插件操作反馈使用顶部 Toast；编号检查结果保留在界面。该事件组合覆盖已实测的键入、等长替换、删除和域结果修改，不承诺捕获每种第三方宏的无事件修改；提交时仍执行完整摘要校验。

- [Zotero 官方 Windows 集成](https://github.com/zotero/zotero-word-for-windows-integration)：模板、C++ 和 OLE 架构。
- [Zotero 官方 HTTP 协议](https://www.zotero.org/support/dev/client_coding/http_integration_protocol)：事务与文档持久化职责。
- [Word Fields.Add](https://learn.microsoft.com/en-us/office/vba/api/word.fields.add)、[UndoRecord](https://learn.microsoft.com/en-us/office/vba/api/word.undorecord)。
- [微软 Ribbon 标识与共享机制](https://learn.microsoft.com/en-us/previous-versions/office/developer/office-2007/aa338202%28v%3Doffice.12%29)。
- [Zotero Citation](https://github.com/MuiseDestiny/zotero-citation)，核读 `src/hooks.ts` 和 `src/modules/cite.ts`；没有复制其代码进入本项目。
- [ZoteroCiteLinker](https://github.com/sBaydin/ZoteroCiteLinker)；[ZoteroLinkCitation](https://github.com/altairwei/ZoteroLinkCitation)。

## 内部 API 的边界

Zotero 的 WinWord 集成仍是内部接口。测试范围限于 7.0.32 和 10.0.7；未来版本可能需要调整。此方案面向 Windows 桌面 Word，不适用于 Word 网页版、macOS、WPS 或 LibreOffice 的原位编辑。文件兼容模式不改变这些平台限制。
