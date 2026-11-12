# Word 实时集成架构与接口

更新日期：2026-11-05；当前版本：1.1.9。最新修复与验收见 [1.1.9 实现说明](DEVELOPMENT-1.1.9.md)，引用事务设计见 [1.1.4 实现说明](DEVELOPMENT-1.1.4.md)。

## 文献选择与映射草稿

所有入口只调用 `adapter.chooseReferences(numbers,mapping,locked,{focusNumber})`。`ZBPicker.open` 在主窗口 `#zbc-reference-workspace` 显示唯一完整队列；`ZBLibrary.mount` 直接初始化 Zotero 原生 CollectionTree、ItemTree / CollectionViewItemTree 和 quick-search-textbox，没有 `openDialog` 或独立选择子窗口。浏览视图按主窗口复用，退出本次选择保留原生视图，父窗口卸载时注销。Zotero 7 的选择完成监听与 Zotero 10 的集合行接口分别适配。

已移除 `chooseItem`、`chooseItemsInOrder`、single/batch 模式及定点受限 UI。行入口只设初始编号，不限制其他未锁定行。所有实际编号（包括不连续编号）在完整队列中选择；选入后自动转到下一个未完成编号，已写入正文的编号仍锁定。每父窗口同一时间一份草稿，再次进入仅定位并复用。应用或取消在原主窗口完成，取消不关闭主窗口。

队列保留初始映射的浅副本；`changes()` 只返回实际变化的编号，显式删除用 null 表示。应用只重新解析本次有文献的变更项，避免未选空槽或无关旧条目阻断部分保存。主窗口先验证保护边界，再原子应用补丁，重算选择有效性、统计和预览。取消不传回补丁；应用失败保留窗口及具体错误。

`duplicateNumbers` 按全部规范化 URI 查找其他原编号，仅缺少 URI 时才用本地 ID 辅助；选择及导入调用同一 `confirmDuplicateBindings`。确认使用原生 confirmEx，默认按钮为取消，说明原编号与最终编号可能合并。解析器因资料库合并返回新别名、产生新重复关系时，也先确认再原子更新。重新选择原编号自己的同篇文献不重复提示。确认后保留每个原编号；Word 和 DOCX 引用组按全部 URI 及传递别名去重，编号预览保持一致，最终数字仍由 Zotero 的样式处理器生成。

`labelAllocator` 优先保留同身份的原编号或未被占用的新原编号，不能因文献相同就丢弃另一原编号。原编号已被不同历史文献占用且用户确认采用当前显示编号时，才转用目标文献的历史编号或分配未占用编号，保护原绑定。自动分配预留同批所有选中原编号，避免占用尚未处理的映射；结果始终在 1～99999 内，没有空位时明确失败。后续核验、最终化及重开均保留这些独立标签。

拖拽由队列计算唯一插入边界，移除源行后换算目标编号；原位置也接受 move。单个指示元素显示该边界，行的 data-drop 仅保存规范化目标，不再生成多条伪元素线。拖拽与箭头都调用 `OrderedSession.move`，锁定屏障和草稿隔离保持一致。原生表格异步加载或高度变化时重新同步队列行高。

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
| `addon/content/selection.js` | 按位置检查全部编号绑定，统一全选、选择失效后的取消与提交前核验 |
| `addon/bootstrap.js` | 注册端点、生成发现文件、生命周期清理 |
| `addon/content/dialog.*` | 同一映射界面的 Word 实时模式和文件兼容模式 |

## 事务

`hello → start → pending → ready → committed → running → verifying → finalizing → done / needs-recovery / error`（协议 3）。两端必须确认完整能力清单，旧协议拒绝写入。关闭尚未提交的窗口得到 `cancelled`；任务 15 分钟过期。已提交操作不能再次插入；客户端中断后登记 `abandon`，释放旧会话并保留文档中的恢复日志。重新打开后必须通过引用图核验再恢复。

1. Word 捕获文档对象、选择范围和主文档 XML 摘要。首次扫描使用原生 Find 获取坐标；同一文档内容签名未变化时复用候选坐标，重新捕获选择范围和写入摘要。
2. Zotero 分开显示原生引用和候选标记，不默认勾选。按 URI 校验身份，允许重复引用；当前编号与历史标签有歧义时要求明确选择。使用无路径的新 `Zotero.Style` 实例生成独立 CSL 预览，不使用 Word 会话的缓存处理器。
3. Word 比较文档键、摘要和全部原始范围，重新检查保护状态；文档或格式变化则停止，不部分写入。
4. Word 激活捕获的文档再开始 UndoRecord，按倒序插入引用。按照官方 `insertFieldRaw` 先创建 QUOTE 域，再写入 ADDIN 代码；直接创建 ADDIN 在当前 Word 会产生空结果范围。
5. C# 先写压缩、带摘要的操作前/预期引用图日志与暂存账本，回读后才写域和标准 `ZOTERO_PREF_n` 设置，并增加一次性 `prefs.zbcTransaction`。正式账本保留待核验标识，成功最终化前不能被旧客户端作为正常绑定继续使用。HTTP 提交响应返回后，Zotero 才开始访问 Word。
6. Zotero 原生接口获取文档后必须读到完全一致的文档设置和事务随机值，否则只清理句柄，不执行引用命令。已保存和未保存文档统一使用非路径标识走原生活动文档路径，避开保存/重开后旧 ROT 定位；该路径必须通过完全一致的事务随机值检查。
7. 使用官方 `getSession` 和 `Integration.Interface` 执行刷新、引用对话框及文献表操作。异常传回 Word；标准域仍保留，可重试刷新。初始域写入的异常会自动撤销本批修改并恢复原 Zotero 设置。

8. 官方调用完成后，Word 重读最终数字引用并释放当前目标、事件观察和超时。异步发送 `completed` 确认；Zotero 只关闭与该任务关联的窗口。确认延迟时允许新批次，旧确认不能关闭新窗口。所有异步回调带操作代数，已取消或完成的旧请求不能改写新状态。

9. 官方调用返回后重读结构化引用域并发送 `verify`；逐位置比较文献身份、条目数量、顺序、稳定项属性及引用组外正文骨架。核验失败进入 `needs-recovery`。验证通过后由只写元数据的 `Finalize` 核对文档键、摘要、事务号、日志和暂存记录，再提升核验后的正式账本；该阶段不插入引用域。`done` 只在 `finalized` 回执后出现。Word 没有覆盖官方异步刷新及文档属性的跨进程数据库事务；本地写入异常可撤销并核验还原，原生阶段失败则保留现场与日志，停止自动覆盖。

外部 COM 调用可能来自 RPC 线程。`ExecuteCommand`、文档检查和诊断通过 Word UI 控件调度，避免跨线程文档 RCW 身份差异导致重开后的自动检查失效。每个新批次重绑观察事件，结束时释放观察目标。

摘要覆盖主文档结构、格式、Zotero 设置和原编号绑定；排除 Word 每次导出都会变化的 rsid 和拼写检查标记。事件防抖检查先比较正文及域、保护边界等内容签名，未变化时不导出 XML。它不锁定文档或检测其他故事区域的所有变化。提交前仍完整校验并再次拒绝修订、只读和保护状态。

## 持久化

原生域保留 citationID、文献 URI 和完整 CSL itemData。`ZBC_BINDINGS_n` 的版本 2 账本含 entries、references、occurrences、revision，版本 1 可读。URI 全部别名经索引关联，不以裸 item.id、标题或显示编号确定身份。重排只改变 CSL 显示与当前引用图，不把历史标签原地换键。载体 ID 改变而 URI 仍存活时保留原标签；单个重复位置删除不会释放整个绑定。经 Zotero URI 与合并关系证明的别名可以归并，缺少证明的替换需要明确确认。

没有历史标签的正常原生字段可直接保留并注册，不补造原编号。显式确认的冲突修复仅更新元数据；日志恢复先比较实际引用图是否等于操作前或预期结果，两者都不匹配时停止。恢复计划不会重复插入引用。

上标/正文偏好另存为 `ZBC_DISPLAY`，只修改数字型引用的结果字体。本加载项自己的刷新、文献表和引用操作结束后重新应用。官方按钮单独刷新可能重置这层字体覆盖；此时再次点击编号显示按钮，或使用所需显示方式的 CSL 样式。当前没有修改官方刷新函数，也未创建自定义 CSL 派生样式。

## 引用身份与相邻合并

`addon/content/citation-state.js` 把文档拆成四层：文献引用（reference，按 URI 识别）、引用条目（item，保留 locator/prefix/suffix/suppress-author）、出现位置（occurrence，带原生 citationID）和显示标签（当前编号与只读历史别名）。恢复时先按 URI 建索引，再参考 citationID：旧 ID 消失但 URI 仍在视为载体变化，保留标签并记录别名；ID 仍在但文献被换掉视为显式替换冲突；两者都找不到才视为未引用。无法唯一判断时返回阻塞问题，不写文档。

`mergeAdjacent` 只合并间隔为横向空白及允许的逗号、分号、顿号的连续引用，不跨段落和句末标点。使用明确的外部字段范围，保留最左 citationID，复制所有来源项及其稳定属性；custom、dontUpdate 或手动改结果的域停止合并。Word 预先解析对象，按所有字段/标记/间隔的统一倒序删除，最后改保留域的代码。本地中途失败也检查实际正文变化并回滚，不能只依赖成功返回后的 changed 标记。`ZBC_TRANSACTION_NEXT_n`/`ZBC_TRANSACTION_n` 两份压缩日志保证替换期间保留恢复证据。

状态区集中展示数字检查、绑定恢复和提交后验证问题；`#message` 只保留短反馈，不再以固定浮层覆盖顶部控件。

## 安装和本地通信

安装脚本注册本项目的当前用户 COM 类和 Word Addins 键，并部署版本目录。关闭 Word 后，对实际使用的 Zotero.dotm 完整备份，再只适配功能区标签标识，不改原按钮或 VBA；不修改 Normal.dotm 或宏安全设置。32/64 位注册均写入，程序集为 AnyCPU。Office 接口元数据嵌入程序集，无需另装 VSTO 或 PIA；开发构建需要 Office 提供的接口元数据。

发现文件为 `%LOCALAPPDATA%\ZoteroBatchCitations\connection.json`，包含随机令牌、本地端口、1.1.4 组件版本及 Zotero processID。Word 在 start 前发 hello，并核对协议 3 和所有所需能力；服务也核对客户端能力。测试 profile 将发现文件重定向到测试目录。Word 只允许 `127.0.0.1`，禁用代理和重定向。端点拒绝缺少令牌或带浏览器来源头的请求。令牌不隔离同一 Windows 用户下的恶意进程。

Word 仅授予 Zotero 激活界面的前台权限；批量窗口使用官方同类 window watcher 无父窗口创建，再定向 `Utilities.Internal.activate(window)`。不恢复、置前或隐藏 Zotero 主窗口，也不占用官方 currentWindow。关闭窗口的任务取消可重入；即使取消消息延迟或丢失，再次点击也会核对终态并释放旧操作。

## 同一 Zotero 标签

官方模板使用未限定的 `id="ZoteroTab"`。1.1.0 安装器备份整份模板后，将该标识替换为共享 `idQ`，并声明 `urn:zotero-batch-citations:shared-ribbon` 命名空间。COM 加载项使用相同命名空间和 `ZoteroTab`；本项目只贡献“批量匹配编号”和“编号显示”两个入口。原生引用、文献表、刷新和首选项按钮全部来自原模板。

仅重写 `customUI/customUI.xml` 或 `customUI/customUI14.xml` 的标签标识；其余 ZIP 条目尤其 VBA 字节保持一致。替换前校验完整备份并保存原件/适配件 SHA-256；通过同目录临时文件原子替换。重复安装不重复修改。卸载仅在当前模板摘要仍匹配适配件时恢复原始字节，避免覆盖之后安装的新 Zotero 模板。Zotero 官方升级覆盖模板后，重新运行安装器进行适配。

1.1.0 的 Word 可访问性记录已确认共享标签合并。1.1.3 在正常启动的 Word 中加载最终程序集和两版官方模板的隔离副本，检查共享 XML、两个入口、Batch Citations 分组及原按钮保留；图标另经真实 OLE 图片回读、透明像素和基线检查。本版没有新增 Word 功能区整窗截图验收。开发测试恢复原模板会话和注册，用户原模板文件摘要保持一致。

## 自动检查与通知

1.1.7 在批量窗口生命周期内订阅 Zotero `item` 通知；绑定清空、条目删除或失效时，重新评估整个引用位置，组合标记不能部分选中。已有引用域提供的有效内嵌文献不强求当前库中存在对应条目。全选及提交前重新解析所需 URI，确认窗口返回后再核验；通知观察者随窗口关闭释放。此层不改变正文范围、已有引用域、编号计划或 Word 事务协议。

打开与再次激活时，Word 在发送 `start` / `focus` 请求前调用 `AllowSetForegroundWindow`。Zotero 复用任务窗口，仅对最小化窗口调用恢复，保留最大化；原生激活后读取该窗口自己的 `nsIBaseWindow.nativeHandle`，确认句柄进程归属，再请求 `SetForegroundWindow`，首次绘制后重试一次。各回退独立处理，不让原生帮助函数的异常阻止常规 focus；不使用永久置顶或持续抢焦点。Windows 在其他应用收到用户输入等情况下仍可拒绝请求，验收区分 Gecko activeWindow 与真实 OS 前台句柄。

Word 没有通用正文 TextChanged 事件。加载项监听 WindowSelectionChange、WindowActivate/Deactivate、DocumentChange、DocumentBeforeSave，以及当前 Word 进程的 EVENT_OBJECT_VALUECHANGE、EVENT_OBJECT_TEXTSELECTIONCHANGED、当前 Word 进程的 EVENT_SYSTEM_FOREGROUND。事件只启动一次 650 ms 防抖；空闲时不扫描。读取、Find、摘要与写域继续限定在 Word UI 线程，后台线程只发送 JSON。

待处理文档有稳定 documentKey。内容签名变化后，通过 `snapshot` 更新服务快照；界面使用订阅即时更新，并撤销变化位置的勾选。成功批次在完成确认中检查最终数字引用，随后关闭对应窗口；重开时复用适用候选并更新本次选择范围及完整写入摘要。协议仍保留 `checked` 端点。服务在文档快照实际更新时计算连续性结果，导入及统一文献选择后的界面更新复用该结果。

Windows 消息只作唤醒，不能携带文献数据或写入计划。Zotero 发出 JobChanged 后 Word 才读取一次认证端点；协议保留 `poll` 名称以兼容内部方法，但没有定时状态轮询。另一条单次消息从 Zotero 工具菜单打开当前 Word 文档。15 分钟计时器只处理任务超时，不执行扫描。Zotero 窗口、文献选择器也不使用持续轮询；只允许文献选择器加载阶段的有界就绪等待。

窗口点击时只向发现文件中的确切 Zotero PID 授予前台权限，不请求前置进程主窗口；随后使用与官方集成相同的无父窗口创建和定向激活机制显示批量界面。编号显示操作不切到 Zotero。原生调用对照及限制见 [1.1.3 实现说明](DEVELOPMENT-1.1.3.md)。

界面直接加载 `chrome://zotero-platform/content/zotero.css` 和宿主自定义控件，通过 `UIProperties.registerRoot` 沿用字体及密度偏好。文献选择直接挂载原生资料库树、文献树和快速搜索组件，没有复制 Zotero 浏览实现，也不再打开 selectItemsDialog。

界面订阅、Word 事件、WinEvent hook、消息窗口与 Toast 超时在对应生命周期结束时清理。所有插件操作反馈使用顶部 Toast；编号检查结果保留在界面。该事件组合覆盖已实测的键入、等长替换、删除和域结果修改，不承诺捕获每种第三方宏的无事件修改；提交时仍执行完整摘要校验。

- [Zotero 官方 Windows 集成](https://github.com/zotero/zotero-word-for-windows-integration)：模板、C++ 和 OLE 架构。
- [Zotero 官方 HTTP 协议](https://www.zotero.org/support/dev/client_coding/http_integration_protocol)：事务与文档持久化职责。
- [Word Fields.Add](https://learn.microsoft.com/en-us/office/vba/api/word.fields.add)、[UndoRecord](https://learn.microsoft.com/en-us/office/vba/api/word.undorecord)。
- [微软 Ribbon 标识与共享机制](https://learn.microsoft.com/en-us/previous-versions/office/developer/office-2007/aa338202%28v%3Doffice.12%29)。
- [Zotero Citation](https://github.com/MuiseDestiny/zotero-citation)，核读 `src/hooks.ts` 和 `src/modules/cite.ts`；没有复制其代码进入本项目。
- [ZoteroCiteLinker](https://github.com/sBaydin/ZoteroCiteLinker)；[ZoteroLinkCitation](https://github.com/altairwei/ZoteroLinkCitation)。

## 内部 API 的边界

Zotero 的 WinWord 集成仍是内部接口。测试范围限于 7.0.32 和 10.0.7；未来版本可能需要调整。此方案面向 Windows 桌面 Word，不适用于 Word 网页版、macOS、WPS 或 LibreOffice 的原位编辑。文件兼容模式不改变这些平台限制。

## 原生文献表与重新打开（1.1.2）

旧入口在 Integration.currentDoc 为真时直接拒绝请求。原生文献表窗口关闭后，cleanup/complete 仍可能执行，导致用户点击入口只前置 Zotero，而批量窗口没有创建。

现在 start 在该阶段立即返回 waitingForNative，不占用 HTTP 请求等待，也不创建绑定旧快照的任务。服务订阅 currentCommandPromise，同一 Promise 只注册一次完成通知。完成后通过已有 Windows 消息唤醒 Word；C# 保留目标文档，重新 Capture 后发起 start。没有计时轮询。取消、超时或卸载后，旧通知不能创建新操作。

测试通过真实官方 execCommand 路径运行参考文献表，测试运行器只将 native complete 延迟两秒以稳定复现该时间差。旧路径可复现 400“Zotero 正在处理其他引用操作”，新路径等待结束后自动打开。另以新建、保存和包含 21 处混合引用的文档交叉验证。

为兼容 Zotero 7，Service 对原生 execCommand 返回 Promise 做透明观察，保留原调用和返回值，关闭插件时有条件恢复原函数。优先使用实际原生命令返回值，避免读取上一次批量命令遗留的已完成 Promise。
