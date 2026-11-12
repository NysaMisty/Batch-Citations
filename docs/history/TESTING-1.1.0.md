# 1.1.0 测试记录与验收

日期：2026-11-03。测试只使用项目内的独立 Zotero profile、关闭同步的合成资料库和新建 Word 文档。项目根目录 test.docx、真实 Zotero 资料库及用户原 Zotero.dotm 未作写入。所有测试使用最终 XPI 内容和最终 Word 程序集摘要校验。

## 验证范围

| 层次 | 环境 | 检查项 |
|---|---|---|
| Node 自动测试 | Node.js 24.16.0 | 44 项 |
| 原有 Word 完整流程 | Zotero 7.0.32 / 10.0.7 + Word 16.0.20527 | 各 15 项 |
| 新增 Word 自动检查和交互 | 同上，两版 Zotero | 各 29 项 |
| Zotero 原生窗口与 DOCX 兼容导出 | 两版 Zotero | 各 44 项 |
| Word 保护、回滚和撤销 | 最终程序集 + 真实 Word | 12 项 |
| 共享标签与模板恢复 | 两版官方 Zotero 模板的隔离副本 | 各 7 项 |
| 真实功能区 | Word 实际可访问性树 | 一个 Zotero 标签，原生组及两个新入口共存 |

对应证据保存在 docs/test-results 中名称包含 1.1.0 的 TAP 和 JSON。发布脚本在打包前检查每项成功状态、项目数量、最终 Word DLL 和 XPI 内容摘要；不把早期版本结果作为本版验收。

## 自动检查的 29 项

包含实际 COM 注册、共享标签 XML、重复按钮移除、Zotero 单次唤醒打开未保存的当前 Word 文档、打开即检查、输入新增引用、等长编号替换、删除与重新加入、移动位置撤销勾选、保留适用文献、切换 Word 文档不重定向、空闲期间不扫描、批量完成后检查已有域结果、域结果修改后自动更新、编号显示及 Toast。

其中 12 项在真实 Zotero 窗口内操作文献对应关系和导入导出：没有文档选择或手动检查按钮；原生样式资源与菜单；选择和清空文献后自动计算；旧 JSON 稳定 URI；冲突导入原子性；按序选择完成重查；文献列表导出；Toast 顶部定位与自动消失；布局不重叠。文件选择器由测试路径替换，另由 44 项宿主测试验证真实原生文献选择窗口。

## 原有功能和数据保护

原有 15 项继续验证：未保存文档原位插入、不生成副本、按出现顺序编号、相邻粗斜体保留、重复刷新不增域、光标位置文献表、重复文献表保护、上标/正文切换和偏好、资料库变更刷新、删除重排、保存重开与已有引用的增量批次。

12 项安全检查覆盖稳定摘要、格式和文本变化拒绝旧计划、修订拒绝、普通域/超链接/内容控件保护、插入后故障报告、完整回滚、原设置恢复、切换文档不重定向和整批撤销。

## 同一 Zotero 标签

模板测试确认：除功能区 XML 外所有 ZIP 条目（特别是 VBA）字节一致；共享命名空间正确；原按钮及回调保留；重复安装无重复修改；卸载恢复原始字节；官方更新后的模板不会被旧备份覆盖；重新适配可以备份和恢复新模板。

真实 Word 会话临时卸载原模板并加载项目内的适配副本；可访问性树确认只有一个 Zotero 标签，其内同时存在编号工具、Add/Edit Citation、Add/Edit Bibliography、Document Preferences、Refresh 等原按钮，并确认编号显示菜单有上标/正文两项。随后恢复原模板会话，校验原文件摘要未变。测试前的 COM 注册在结束后恢复，未把测试版本留作用户安装。

## 复现

~~~powershell
npm test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File word-addin\build.ps1
python scripts/prepare-runtime.py acceptance10 --live-test --hold-batch
~~~

使用项目内已经处理过的隔离运行时启动对应 profile；只在 live-status.json 为 ready 后运行 Word 测试。正常启动 Word 并打开合成 seed.docx，安装测试程序集后，以项目内的 Zotero 模板副本运行 `tests/ribbon-integration.ps1`、`tests/word-template-host.ps1`；再运行 `tests/word-auto-check.ps1 -TestDirectory <测试目录> -LeaveOpen` 和 `tests/word-live.ps1 -ExistingWord -LeaveOpen -TestDirectory <测试目录>`。

结束后先通过 word-template-host.ps1 恢复模板会话，保存并关闭本次测试文档，再通过 temporary-registration.ps1 恢复原注册。停止隔离 Zotero 时，在该测试目录写 live-control.json，内容为 {"action":"stop"}。原生选择器回归使用不带 --live-test 的全新测试 profile。测试名称和输出目录必须新建，避免覆盖旧结果。

## 限制和未执行项

- 测试使用 IEEE / en-US 完整 Word 流程；GB/T 7714、其他语言和全部 CSL 未逐一实测。
- 官方引用编辑、文档首选项对话框未逐按钮人工验收；原生功能区按钮未被本项目替换。
- 桌面截图工具对便携 Zotero 报窗口归属错误，Word 截图也出现与窗口不符的画面；本版依据真实宿主控件布局、菜单展开与 Word 可访问性树验收，不宣称完整截图视觉验收。
- Word 无通用正文修改事件；已验证键入、删除、等长替换和域结果编辑。第三方宏静默修改的所有路径未验证，提交前仍有完整摘要校验。
- 官方单独 Refresh 可能重置上标字体覆盖；请再次选择编号显示，或使用相应 CSL 样式。
- 受保护及修订文档、非正文故事区、其他 Word / Zotero 版本以及 macOS、WPS、Word 网页版未获本版新增验证。

历史说明分别保存在 [1.0.0](history/TESTING-1.0.0.md) 和 [0.2.0](history/TESTING-0.2.0.md)。
