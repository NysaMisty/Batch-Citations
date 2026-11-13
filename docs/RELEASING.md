# 版本、构建与交付规范

## 唯一源码与目录职责

当前仓库是唯一维护的源码，维护目录使用 `work/zotero-batch-citations`。每次迭代都在这个仓库内修改。

| 位置 | 职责 |
|---|---|
| 本目录的 `addon`、`word-addin`、`tests`、`scripts`、`docs` | 当前有效实现、测试、工具和文档 |
| 本目录的 `.git` | 本地开发历史；正式交付以 `vX.Y.Z` 标签追溯 |
| 本目录的 `dist`、`word-addin/bin` | 可重建构建；内部发布暂存为 dist/releases/X.Y.Z，不作为候选交付 |
| `outputs/当前版本/X.Y.Z` | 完成全部检查后的唯一当前正式交付 |
| `outputs/历史版本/X.Y.Z` | 保留旧正式包及回退资料，不覆盖原文件 |
| `outputs/开发资料` | 历史开发资料和当前源码快照索引，不再复制当前工程 |
| `work/test-runs/active/test-*` | 每轮新建的隔离测试；名称包含版本和唯一后缀 |
| `work/test-runs/history`、`work/archives` | 历史测试、原暂存区、整理及迁移记录 |

源码 ZIP 是不可变的发布快照，解压审查或重建时不应被误认为当前维护目录。旧 1.1.6 仅是候选；标签 `baseline/1.1.6-candidate` 表示迭代前基线，不代表正式发布。

2026-11-05 建立基线前的 Git index、原暂存内容、工作内容差异及文件摘要保存在 `work/archives/release-management-20261105`。旧测试和构建目录的移动清单为该目录下的 `directory-moves.json`。历史日志中的绝对路径代表当时环境；查找迁移后的原始证据时按此清单定位，不改写历史记录，也不直接复用旧 profile。

旧平铺目录整理脚本 `scripts/output_layout.py` 已从当前工具中退役，避免绕过正式交付核验或改写新入口；原实现保存在 Git 基线中。后续只用本规范的 `release.py` 管理正式交付。

仅交付正式版本，不建立候选版本交付目录。正式目录必须包含已解压的 Word加载项，完整文件集逐字节核对 Word ZIP，可直接运行其中的 Install.cmd。

## 一次版本迭代

以下命令均从唯一源码目录执行。版本以 `X.Y.Z` 为例，不手动分散改版本文字。

```powershell
npm ci
npm run version:update -- X.Y.Z
npm run version:check
powershell.exe -NoProfile -ExecutionPolicy Bypass -File word-addin/build.ps1
npm test
npm run build
```

版本命令同步 package、lockfile、Zotero manifest、后台连接/握手、窗口初始版本、Word 客户端、程序集版本、安装目录和注册版本，也核对 README 的安装包、下载地址和报告版本。`updates.json` 的版本、XPI 下载地址和兼容范围随版本同步。已发布的报告和历史证据保留原内容。

Word 构建同时生成 `word-addin/bin/build-info.json`，记录实际程序集版本、DLL SHA-256、全部 C# 源码、图标和构建脚本摘要。源码或 DLL 在构建后变化，打包会拒绝继续；需要重建。`npm test` 包含无需 Office 的隔离发布流程测试；真实 Word 回归另行执行。

## 本版测试与证据

公开仓库可用 `npm test` 运行单元测试，并可用 `examples/placeholder-demo.docx` 在 Word 和 Zotero 中试用。下面的宿主回归命令用于维护工作区，依赖配套的隔离 Zotero 运行时、Word 宿主脚本和测试文档。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/validate-117-hosts.ps1 -Phase UI -Majors 7 -Suffix unique-name
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/validate-117-hosts.ps1 -Phase Word -Majors 7 -Suffix unique-name
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/validate-117-hosts.ps1 -Phase Activation -Majors 7 -Suffix unique-name
```

Zotero 10 对应 `-Majors 10`；独立 Word 保护、完整性及管线测试使用 `-Phase Independent`。每轮必须使用新后缀，不覆盖结果。Word 问题文档基准为 `work/test-fixtures/large-document.docx`；其来源和 SHA-256 见同目录 README，测试仅使用副本。Office 测试必须由 `powershell.exe`（Windows PowerShell）执行；PowerShell 7 不提供本测试使用的 Office COM 获取接口，入口会在更改注册前拒绝。宿主脚本暂存并恢复注册和官方模板的测试副本；已有 Word 会话时拒绝启动，以免涉及用户文档。使用测试接口和后台文档完成验证，不要求桌面点击。

版本后续变化时，按新需求调整这一套测试入口及检查，而不是复制一套源码。`validate-117-hosts.ps1` 保留既有入口文件名，实际测试目录的版本数字自动读取 package.json。原生窗口测试和 Word 宿主测试应顺序执行，避免多个宿主争用窗口焦点。将实际成功轮次路径写入 `docs/test-results/release-inputs-X.Y.Z.json`；失败和初始化中断轮次保留，但不计作通过。

测试宿主记录自己启动的进程对象，仅核对该进程正常退出，不再枚举其他 Zotero 进程。新隔离 profile 关闭 Windows 窗口遮挡绘制暂停，以便后台几何与截图检查继续运行；这只改变测试 profile，不写入成品或用户配置，也不构成实际 Windows 前台激活成功的证明。

最终自动测试输出保存为 TAP：

```powershell
cmd.exe /c "node --test --test-reporter=tap tests/*.test.cjs > docs/test-results/unit-tests-X.Y.Z.tap"
python tests/verify-delivery.py docs/test-results/release-inputs-X.Y.Z.json
```

核验器要求两版 Zotero 的布局与绑定、真实 Word 插入、窗口复用/最小化恢复、临时环境恢复，以及独立 Word 安全、完整性和管线记录。各测试 XPI 的文件内容必须与当前 addon 逐项相同；测试安装 DLL 必须与当前 DLL 摘要一致。汇总记录实际 OS 前台结果，不能把 Gecko 内部聚焦当作 Windows 前台成功。

输入 JSON 中的 `sourceFixture` 可以填写相对于工作区的路径，例如 `test-fixtures/large-document.docx`，也可以填写绝对路径。工作区是源码仓库的上一级目录。核验器按 `addon/manifest.json` 的插件 ID 查找测试用 XPI。

使用 UTF-8 保存 JSON、Markdown 和 TAP；Windows PowerShell 5 中含中文路径的新增脚本使用 UTF-8 BOM。测试报告写明实际应用版本、尺寸、缩放、通过项和未覆盖条件。

## 正式交付顺序

先完成 CHANGELOG、README、当前开发报告和 TESTING，核对测试证据；随后审查并本地提交全部源码和文档。工作区未提交或含未跟踪源码时，准备交付会拒绝继续。提交不推送远程。

```powershell
python scripts/release.py prepare
python scripts/release.py verify
python scripts/release.py promote
```

`prepare` 从当前干净提交在忽略的 dist/releases 中生成内部暂存包，校验源码 ZIP 与当前源码逐文件一致、XPI 与被测内容一致、Word ZIP 与被测 DLL 一致、bundle 中组件一致。`RELEASE.json` 保存提交、版本标签、完整源码摘要及证据摘要，`SHA256SUMS.txt` 覆盖所有交付文件。

`verify` 重新检查整个内部暂存包及证据，任何源码、测试记录、包、文件清单或版本变化都会使验证失败；即使重新计算包的校验值，也不能绕过与被测内容的对照。`promote` 再次验证，把旧正式目录原样移入历史，把同一已核验暂存目录移入当前正式目录，创建本地 `vX.Y.Z` 标签并更新统一入口。移动或入口写入失败时恢复旧包、暂存包、索引和本次新建标签。相同版本、标签和已有历史目标均不覆盖。

正式包生成后不可就地重构建。发现问题时发布新的补丁版本；保留旧版 Git 标签和安装包。源码、测试或文档在准备后有调整时，需要重新提交，保留诊断并在 dist 中重新暂存核验，不能直接改正式包。

## 每次明确交付的文件

全部核心文件放在 `outputs/当前版本/X.Y.Z`，源码不再另放一套可编辑工程。

| 文件 | 用途 |
|---|---|
| `zotero-batch-citations-X.Y.Z.xpi` | Zotero 插件安装包 |
| `zotero-batch-citations-X.Y.Z-word.zip` | 同版 Word DLL、安装/卸载脚本及说明 |
| `Word加载项/` | 已解压同版文件集；可直接运行 Install.cmd，逐字节核对 Word ZIP |
| `zotero-batch-citations-X.Y.Z-bundle.zip` | 合并下载包，包含同一 XPI 和 Word ZIP |
| `zotero-batch-citations-X.Y.Z-source.zip` | 与发布清单一致的完整源码，排除 Git、依赖、测试 profile 和构建输出 |
| `CHANGELOG.md`、`README.md`、`LICENSE` | 变更、安装使用和许可 |
| `TEST-REPORT.md`、`docs/DEVELOPMENT-X.Y.Z.md` | 简要交付报告、具体实现和测试范围 |
| `docs/test-results` | 必要测试记录与发布核验记录；历史证据按版本保留 |
| `RELEASE.json`、`SHA256SUMS.txt` | 提交、版本、源码及交付文件的对应关系和校验值 |

GitHub 正式发行版使用同一版本标签，单独上传 XPI、Word ZIP 和完整安装包，附上校验值与发布说明。将发行版标为最新正式版，核对 `updates.json` 的 XPI 地址可直接下载。

交付报告必须列实际文件、路径、测试结果和遗留限制。生成正式本地交付不等于自动安装到用户 Zotero/Word，更不等于远程发布。
