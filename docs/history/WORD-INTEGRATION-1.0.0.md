# Word 实时集成架构与接口

日期：2026-11-03；版本：1.0.0。

## 方案

Word 端是 .NET Framework COM 加载项；Zotero 端仍为本项目 XPI。Word 的范围查找、域插入、保护检查和撤销全部在 Word UI 线程执行。后台线程仅向 Zotero 自带的 loopback HTTP 服务传输 JSON，不处理磁盘上的 DOCX，不调用外部转换程序。

复用 0.2.0 的 `core.js`、`mapping.js`、`picker.js`、`zotero-adapter.js` 和映射窗口；离线导出作为兼容模式保留。没有重写 CSL 排版引擎、条目身份协议或 Zotero 的文献表管理。

## 模块

| 模块 | 责任 |
|---|---|
| `word-addin/Connect.cs` | COM 生命周期、Ribbon、后台请求、UI 调度、任务状态 |
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

摘要只覆盖主文档结构、格式和 Zotero 设置；排除 Word 每次导出都会变化的 rsid 和拼写检查标记。它不试图锁定文档或检测其他故事区域的所有变化。提交前还会再次拒绝修订、只读和保护状态。

## 持久化

每个引用保存唯一 citationID、文献 URI 和 CSL itemData；文档保存标准 Zotero 设置。重开后不依赖本机编号映射表或内存会话。编号由 CSL 按文献出现顺序生成。同一文献在后续批次重用原 URI，不产生新的书目身份。

上标/正文偏好另存为 `ZBC_DISPLAY`，只修改数字型引用的结果字体。本加载项自己的刷新、文献表和引用操作结束后重新应用。官方按钮单独刷新可能重置这层字体覆盖；此时再次点击编号显示按钮，或使用所需显示方式的 CSL 样式。当前没有修改官方刷新函数，也未创建自定义 CSL 派生样式。

## 安装和本地通信

安装脚本只注册本项目的当前用户 COM 类和 Word Addins 键，并部署版本目录；不修改 Normal.dotm、Zotero.dotm 或宏安全设置。32/64 位注册均写入，程序集为 AnyCPU。Office 接口元数据嵌入程序集，无需另装 VSTO 或 PIA；开发构建需要 Office 提供的接口元数据。

发现文件为 `%LOCALAPPDATA%\ZoteroBatchCitations\connection.json`，包含随机令牌及本地端口。Zotero 的独立测试 profile 将其重定向到各自测试目录。Word 只允许 `127.0.0.1`，禁用代理和重定向。端点只接受带令牌的 POST JSON，拒绝浏览器 Origin / Sec-Fetch 请求，不提供网页跨域访问。该令牌不是对同一 Windows 用户下恶意进程的隔离边界。

## 功能区合并调研

官方 `Zotero.dotm` 使用 `id="ZoteroTab"`，没有共享命名空间。微软的跨加载项共享标签机制要求双方采用共同的 `idQ`。所以本版在单独的“编号批量引用”标签提供入口，保留官方标签；没有为了同标签外观修改官方模板。

核查过的第三方项目中，Zotero Citation 复用官方引用 API，而 ZoteroCiteLinker 明确使用独立 Ribbon 标签；不能将这些例子宣称为已经证明“原标签直接合并”。

- [Zotero 官方 Windows 集成](https://github.com/zotero/zotero-word-for-windows-integration)：模板、C++ 和 OLE 架构。
- [Zotero 官方 HTTP 协议](https://www.zotero.org/support/dev/client_coding/http_integration_protocol)：事务与文档持久化职责。
- [Word Fields.Add](https://learn.microsoft.com/en-us/office/vba/api/word.fields.add)、[UndoRecord](https://learn.microsoft.com/en-us/office/vba/api/word.undorecord)。
- [微软 Ribbon 标识与共享机制](https://learn.microsoft.com/en-us/previous-versions/office/developer/office-2007/aa338202%28v%3Doffice.12%29)。
- [Zotero Citation](https://github.com/MuiseDestiny/zotero-citation)，核读 `src/hooks.ts` 和 `src/modules/cite.ts`；没有复制其代码进入本项目。
- [ZoteroCiteLinker](https://github.com/sBaydin/ZoteroCiteLinker)；[ZoteroLinkCitation](https://github.com/altairwei/ZoteroLinkCitation)。

## 内部 API 的边界

Zotero 的 WinWord 集成仍是内部接口。测试范围限于 7.0.32 和 10.0.7；未来版本可能需要调整。此方案面向 Windows 桌面 Word，不适用于 Word 网页版、macOS、WPS 或 LibreOffice 的原位编辑。文件兼容模式不改变这些平台限制。
