# Batch Citations 1.1.10 开发与交付报告

日期：2026-11-06。唯一维护源码为 `D:\zotero-plugin\work\zotero-batch-citations`，基于本轮开始时的正式 1.1.9 修改；沿用 [交付规范](RELEASING.md)，仅作本地正式交付。

## 基线检查

主界面由 `dialog.xhtml/js/css` 组织文献列表、引用位置、编号映射、状态与配置；没有另一个自定义前端框架。1.1.9 的“选择文献”按钮调用 `chooseReferences()`，展开嵌入的原生 CollectionTree 与 ItemTree，并等待一次性选择 Promise；应用或取消后隐藏浏览区、恢复映射表。行入口带 focusNumber，使用同一组件。`library.js` 缓存原生视图，`picker.js` 和 `mapping.js` 的 OrderedSession 管理编号草稿、锁定和排序，adapter 负责资料库解析及校验。

原导入/导出是编号与条目关联的备份，不是文献文件打包：CSV/TSV 字段为 number、uri、title，number 和 uri 必填；旧 JSON 为 `{format:"zotero-batch-citations/v1",mapping:{编号:{uri,title}}}`。导入限 2 MiB、2000 条，编号范围 1—99999，保留表头、重复编号、URI 与当前资料库检查。界面不再引导用户手写 URI。

原编号队列在原生浏览下方，数量和操作说明分行，队列高度限制为 96px。此次复用原生树、OrderedSession、文献解析和引用管线，主要修改布局、入口和会话生命周期。

## 最终行为

打开主窗口即显示原生浏览与完整编号队列，不再有独立“选择文献”总入口。每个父窗口只挂载一套原生视图和一份草稿；应用只提交实际修改，取消原位恢复已应用映射。文档无编号时仍可浏览。编号详情默认收起，行入口仍可定位相应编号。

工具栏提供 **布局：上下 / 左右**。上下为待选文献在上、编号在下；左右为待选文献在左、编号在右。布局仅改变 CSS grid，原生节点、搜索、资料库筛选、排序、草稿、当前编号与两个滚动位置继续复用。控件是可键盘操作的文字按钮，aria-pressed 标识用户选择。

首次默认上下，通过 `Zotero.Prefs` 保存 `extensions.zotero.batchCitations.pickerLayout`。该设置属于界面偏好，不进入列表导出或 Word 数据。左右布局的基础最小尺寸为浏览 280px、编号 330px、间隙 10px，并按实际数量/当前编号、帮助及跳过按钮的必要宽度增大编号区；空间不足提示并暂用上下，保留左右偏好，恢复宽度后自动回到左右。标题或编号改变也重新测量。

数量和当前编号保持较高优先级，简短操作说明与跳过按钮同一行；不足时折叠次要说明，提示可聚焦查看。队列行高 28—30px，按钮至少 24×24px，单行省略、完整标题提示、细分隔线和浅色当前背景。浏览与队列独立滚动，极短窗口及展开额外详情时主内容可补充滚动，底部主操作固定可见。

**导入/出文献列表** 位于原工具栏次级菜单。导出包含已应用映射，未应用草稿不包含在内；不打包文献文件，不承诺跨库自动迁移。导入、导出格式及兼容性检查继续使用原有实现。存在未应用草稿时禁用导入和最终引用写入，避免覆盖；导出已应用列表仍可用。

双击加入、标题替换、拖拽、上移、下移、清空、跳过、稀疏编号推进和部分应用均保留。已提交绑定仍锁定。异步验证成功、失败及确认框返回都检查草稿 revision；首次与后续 Word 快照原位重置草稿，使旧异步结果失效。编号来源确认同步主表与队列，有未应用草稿时先要求应用或取消。原生同集合重选也发出完成通知，避免资料库删除事务一直等待。

## 文件范围

| 文件 | 改动 |
|---|---|
| addon/content/dialog.xhtml、dialog.js、dialog.css | 直接显示文献工作区、备份菜单、编号详情、主操作与快照同步、紧凑配置 |
| addon/content/picker.js、picker.css | 常驻草稿、原位应用取消、单行提示、紧凑行、独立滚动及迟到结果保护 |
| addon/content/picker-layout.js | 手动布局、实际最小宽度、偏好、回退恢复与滚动保持 |
| addon/content/library.js、mapping.js | 原生集合选择完成契约、常驻空队列支持 |
| package.json、package-lock.json、addon/manifest.json、bootstrap.js、live-service.js | 同步 1.1.10 版本与握手 |
| word-addin/BridgeClient.cs、Connect.cs、install.ps1 | 同步 Word 客户端、程序集与安装版本；引用实现沿用 |
| tests/*runtime.js、word-iteration-host.ps1、verify-delivery.py | 原生交互、布局保持、首次 live 队列、真实 Word 与精确包身份验收 |
| tests/picker-window.test.cjs、picker-layout.test.cjs、dialog-snapshot.test.cjs、library.test.cjs | 生命周期、偏好、异步/快照、来源同步与原生完成事件回归 |
| scripts/build.py、release.py、tests/release* | 只在 dist 暂存，正式目录解压 Word加载项、逐字节核验和失败回退 |
| AGENTS.md、README.md、CHANGELOG.md、RELEASING.md、TESTING.md | 使用方式、正式交付规则及当前证据；work/README.md 同步项目入口规则 |

## 验证和边界

最终输入、测试目录及计数见 [发布输入](test-results/release-inputs-1.1.10.json) 和 [发布核验](test-results/release-proof-1.1.10.json)；具体结果集中在 [TESTING](TESTING.md)。失败或最终 addon 冻结前的开发轮次只留诊断，不计为正式通过。

纯逻辑检查覆盖会话生命周期、空编号、取消、部分修改、偏好、异步成功/拒绝/模态确认期间快照失效、来源同步、版本/包篡改和发布回退。原生应用测试使用实际 Zotero 7.0.32 / 10.0.7 的原生树、搜索、排序、确认框及 DragEvent；65 条真实合成库条目、60 条长标题队列，1000×680、760×600、640×560 两种布局和明暗主题，以及 828/840/1000px 下 2000 个编号与五位当前编号。关闭重开通过新的主窗口验证偏好。切换保持原生视图实例、搜索、筛选行、排序、当前编号、未应用映射及两列表滚动位置。

本机 DPR=1，1000×680 下编号队列实际可同时显示上下 4 行、左右 10 行；旧代码将队列限制为 96px。这里的旧尺寸来自代码检查，未另跑旧版相同数据的完整 A/B 宿主比较。

真实 Word 回归使用问题文档副本完成 35 个唯一范围、17 编号的插入与原生刷新，并验证 60 篇实际选入、按钮/拖拽排序、应用、URI 对应、插入、刷新、保存重开；另含部分应用、重复标签、来源/绑定、导入导出、编号预览与文献表。Word 独立保护、引用完整性和身份管线继续执行。每轮使用隔离库、模板副本和临时注册，核对恢复结果及原问题文档哈希。

未进行物理鼠标全程拖拽、屏幕阅读器、全部键盘路径或多 DPI 的人工验收；不穷尽 Office、Windows 和 CSL 组合。实际 Windows 前台授权结果在原始激活证据单独报告，不能用内部 focus 或截图替代。没有安装到用户正式 Zotero/Word 环境，也没有推送远程。

## 正式交付

只交付 `outputs/当前版本/1.1.10`；内部构建暂存于忽略的 dist/releases，旧正式 1.1.9 原样移入历史，不覆盖旧版或标签。正式目录含 XPI、Word ZIP、已解压 **Word加载项**、bundle、源码 ZIP、说明、测试记录和校验值；解压目录所有文件逐字节对应同版 Word ZIP。保存并关闭 Word 后，可直接运行其中的 Install.cmd。

独立审查发现的首次快照同步、编号来源同步和大编号临界宽度问题均在本轮修复并补充回归；没有为此增加另一套选择组件或布局框架。
