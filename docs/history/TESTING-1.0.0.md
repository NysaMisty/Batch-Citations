# 1.0.0 测试记录与验收

日期：2026-11-03。全部宿主测试使用独立 Zotero profile、关闭同步的合成资料库和新建 Word 文档。项目根目录 test.docx 未参与写入。

## 结果

| 层次 | 环境 | 结果 |
|---|---|---|
| Node 自动测试 | Node.js 24.16.0 | 39 项通过 |
| Word 完整流程 | Zotero 7.0.32 + Word 16.0.20527 | 15 项通过 |
| Word 完整流程 | Zotero 10.0.7 + 同一 Word | 15 项通过 |
| Word 安全边界 | 最终 C# 程序集 + 真实 Word | 12 项通过 |

结果见 docs/test-results 中含 1.0.0 的 TAP 和 JSON。两次完整流程均通过实际注册的 COM 加载项运行；不是最终以手动实例化 Connect 类替代安装验收。结果保存测试包内容摘要和 Word 程序集摘要，发布脚本核对与成品一致。

## 完整流程的 15 项检查

1. 正常启动 Word 后，COM 加载项实际连接。
2. 未保存的当前文档转换四处引用。
3. 不生成文档副本，原窗口保持打开。
4. 原编号 2、1 等按出现顺序重排。
5. 相邻粗体和斜体正文保留。
6. 连续两次刷新不增加域。
7. 光标位置插入文献表，位置在 TAIL 哨兵前。
8. 再点击文献表按钮只更新，不重复插入。
9. 已有编号切换上标。
10. 本加载项刷新后保留上标偏好。
11. 已有编号切换正文。
12. 修改合成库文献标题后，文献表更新。
13. 删除引用后，剩余编号重新排列。
14. 保存、关闭、重新打开同一文档后仍能刷新。
15. 在已有引用和文献表的文档中新增手写编号，再次批量插入成功。

映射由隔离测试入口在真实插件窗口中填写，并点击真实提交按钮；文献表和刷新调用真实 Zotero WinWord 接口。它没有把所有鼠标交互、文件选择和官方引用对话框的人工验收替代掉。

## 12 项安全检查

稳定快照；格式变化拒绝；文本变化拒绝；开启修订拒绝；已有域保护；超链接保护；内容控件保护；插入后故障报告；故障完整回滚；原 Zotero 设置恢复；切换文档不重定向写入；一条 Word Undo 撤销整批范围替换。

故障测试在字段写入后人为令文档设置无效，确认两处字段全部回滚。跨文档测试先捕获目标，再打开另一份合成文档，确认只写原目标，撤销也归属于原目标。

## 发现并修复的问题

- Word 每次输出 WordOpenXML 会重建包属性及 rsid，导致无修改也误判。摘要改为主文档结构和设置，排除这些标记及拼写检查标记。
- Word 直接创建 ADDIN 域会产生空结果范围。按官方 insertFieldRaw 实现，先创建 QUOTE，再写入 ADDIN 代码。
- Zotero Windows 包装器不接受空 documentName。未保存文档使用活动回退标识，并强制验证本次随机事务值。
- 从域结果中继续 Find 会重复命中同一个域。查找保证前进，并跨过完整保护边界。
- 切换文档后开启应用撤销记录会归属错误窗口。开始事务前先激活捕获的原文档。
- 自动化启动 Word 的实例未枚举新注册加载项。最终使用正常启动并打开合成文件的 Word 验证安装；早期 ManagedHarness 结果不作为成品安装证据。

## 复现

~~~powershell
npm test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File word-addin\build.ps1
python scripts/prepare-runtime.py acceptance10 --live-test
~~~

使用已按项目脚本处理的隔离运行时启动新 profile。先确认 live-status.json 为 ready，然后安装 Word 加载项，正常启动 Word 并打开该测试目录下的合成 seed.docx，再执行：

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\word-live.ps1 -ExistingWord -TestDirectory D:\zotero-plugin\work\test-acceptance10
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\word-safety.ps1
~~~

seed.docx 可复制 examples/placeholder-demo.docx，使用新测试名称，避免覆盖已有结果。不可把真实资料库交给 prepare-runtime 或 live-runtime。停止隔离实例时，在其测试目录写 live-control.json，内容为 {"action":"stop"}。完整收集和发布使用 scripts/release.py。

## 尚未完成的人工验收和限制

- 官方 Add/Edit Citation、Document Preferences 对话框的完整逐按钮人工验收未执行；本版按钮已调用官方实现，不能据此宣称所有交互都测过。
- IEEE / en-US 的完整流程已执行；GB/T 7714、其他语言及其他 CSL 未逐一实测。
- 已读取实际 Word 的可访问性树，确认官方 Zotero 和“编号批量引用”两个标签同时存在。桌面工具点击新标签返回 coordinate input geometry is unavailable；便携 Zotero 窗口捕获还出现窗口归属错误，因此不宣称全鼠标界面测试通过。
- 官方标签单独 Refresh 可能重置字体覆盖；本加载项自己的 Refresh 会恢复保存的上标/正文偏好。
- 页眉页脚、脚注尾注、批注和文本框不批量转换。只读、受保护及修订文档拒绝写入。
- macOS、WPS、Word 网页版、移动版，以及其他 Zotero / Word 小版本未测试。
- 此实现依赖 Zotero 内部集成接口，未来版本需要回归，不作无限兼容承诺。

0.2.0 历史记录保存在 [历史测试说明](history/TESTING-0.2.0.md)，对应早期结果不混作 1.0.0 的验收。
