// SPDX-License-Identifier: MIT
using System;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Reflection;

[assembly:AssemblyVersion("2.0.0.0")]
[assembly:AssemblyFileVersion("2.0.0.0")]
[assembly:ComVisible(false)]
namespace ZoteroBatchCitations {
    [ComVisible(true), Guid("59B8DFA8-9039-4855-B4CD-DBF701CE7A81"), ProgId("ZoteroBatchCitations.Connect"), ClassInterface(ClassInterfaceType.AutoDual)]
    public sealed class Connect : Extensibility.IDTExtensibility2, Microsoft.Office.Core.IRibbonExtensibility {
        dynamic app;
        Control ui;
        Timer timer;
        Timer debounce;
        DocumentEvents events;
        Toast toast;
        WordLauncher launcher;
        WordDocument target;
        WordDocument observed;
        WordDocument cached;
        string observedID, currentCommand, requestedCommand;
        bool pendingCheck, checking, observedFinished, pendingPoll;
        bool network, committed, waitingForNative, verificationSent, finalizationSent;
        string jobID;
        DateTime started;
        int generation, documentEventCount, entryRequest;
        public bool Interactive { get; set; }
        public string ConnectionFile { get; set; }
        public string Status { get; private set; }
        public string LastError { get; private set; }
        public string LastErrorDetail { get; private set; }
        public string LastToast { get; private set; }
        public int AutomaticCheckCount { get; private set; }
        public int SnapshotUpdateCount { get; private set; }
        public string SnapshotMetrics { get {
            if(ui != null && !ui.IsDisposed && ui.InvokeRequired)return (string)ui.Invoke((Func<string>)(()=>SnapshotMetrics));
            var document = target ?? cached;
            return BridgeClient.Json.Serialize(new { scans = document == null ? 0 : document.FullScanCount, hits = document == null ? 0 : document.SnapshotCacheHits, captureMs = document == null ? 0 : document.LastCaptureMilliseconds });
        } }
        public string AutomaticCheckStatus { get {
            if(ui != null && !ui.IsDisposed && ui.InvokeRequired)return (string)ui.Invoke((Func<string>)(()=>AutomaticCheckStatus));
            return BridgeClient.Json.Serialize(new { state = Status, watching = observed != null, active = observed != null && observed.IsActive, pendingCheck = pendingCheck, checking = checking, network = network, committed = committed, generation = generation, events = documentEventCount, checks = AutomaticCheckCount, updates = SnapshotUpdateCount });
        } }
        public string InspectCurrentDocument() {
            if(ui != null && !ui.IsDisposed && ui.InvokeRequired)return (string)ui.Invoke((Func<string>)InspectCurrentDocument);
            var fields = new List<object>();
            dynamic document = app.ActiveDocument;
            foreach (dynamic field in document.Fields) fields.Add(new { code = (string)field.Code.Text, text = (string)field.Result.Text, superscript = (int)field.Result.Font.Superscript });
            return BridgeClient.Json.Serialize(new { text = (string)document.Content.Text, fields = fields, bindingData = new WordDocument((object)app).BindingData() });
        }
        public Connect() { Interactive = true; ConnectionFile = BridgeClient.ConnectionPath; Status = "idle"; LastError = ""; }
        public void OnConnection(object application, int mode, object addInInst, ref Array custom) {
            app = application;
            ui = new Control(); ui.CreateControl(); var handle = ui.Handle;
            timer = new Timer { Interval = 15 * 60 * 1000 };
            timer.Tick += delegate { timer.Stop(); Finish(new InvalidOperationException("引用操作已超时，请重新打开批量匹配编号。")); };
            debounce = new Timer { Interval = 650 };
            debounce.Tick += delegate { debounce.Stop(); CheckDocument(); };
            events = new DocumentEvents(application, QueueCheck);
            launcher = new WordLauncher(delegate { ExecuteCommand("batch"); }, delegate {
                if (ui != null && !ui.IsDisposed) ui.BeginInvoke((Action)Poll);
            });
            if (addInInst != null) { dynamic addin = addInInst; addin.Object = this; }
        }
        void Extensibility.IDTExtensibility2.OnConnection(object application, Extensibility.ext_ConnectMode mode, object addInInst, ref Array custom) { OnConnection(application, (int)mode, addInInst, ref custom); }
        void Extensibility.IDTExtensibility2.OnDisconnection(Extensibility.ext_DisconnectMode mode, ref Array custom) { OnDisconnection((int)mode, ref custom); }
        public void OnDisconnection(int mode, ref Array custom) {
            generation++;
            if (events != null) { events.Dispose(); events = null; }
            if (launcher != null) { launcher.Dispose(); launcher = null; }
            if (debounce != null) { debounce.Stop(); debounce.Dispose(); debounce = null; }
            if (toast != null) { toast.Close(); toast = null; }
            if (timer != null) { timer.Stop(); timer.Dispose(); }
            if (ui != null) ui.Dispose(); target = null; observed = null; cached = null; app = null;
        }
        public void OnAddInsUpdate(ref Array custom) { }
        public void OnStartupComplete(ref Array custom) { }
        public void OnBeginShutdown(ref Array custom) { OnDisconnection(0, ref custom); }
        public string GetCustomUI(string ribbonID) {
            return "<customUI xmlns='http://schemas.microsoft.com/office/2009/07/customui' xmlns:zotero='urn:zotero-batch-citations:shared-ribbon'><ribbon><tabs>" +
                "<tab idQ='zotero:ZoteroTab' label='Zotero'><group id='ZBCReferences' label='Batch Citations'>" +
                "<button id='batch' label='批量匹配编号' size='large' getImage='GetImage' onAction='OnAction' screentip='扫描当前打开的文档，在 Zotero 中确认编号与文献后原位插入。'/>" +
                "<menu id='display' label='编号显示' size='large' getImage='GetImage'>" +
                "<button id='superscript' label='上标编号' getImage='GetImage' onAction='OnAction'/>" +
                "<button id='inline' label='正文编号' getImage='GetImage' onAction='OnAction'/>" +
                "</menu></group></tab></tabs></ribbon></customUI>";
        }
        public void OnAction(Microsoft.Office.Core.IRibbonControl control) { ExecuteCommand(control.Id); }
        public object GetImage(Microsoft.Office.Core.IRibbonControl control) { return RibbonImages.Get(control.Id); }
        public void ExecuteCommand(string command) {
            if(ui == null || ui.IsDisposed)return;
            if(ui.InvokeRequired) {
                // COM callers can arrive on an RPC thread. Keep document RCWs,
                // event subscriptions, selection and writes on Word's UI thread.
                if(target == null)Status = "starting";
                ui.BeginInvoke((Action)delegate { ExecuteCommand(command); }); return;
            }
            if(command!="superscript"&&command!="inline")BridgeClient.AllowForeground(ConnectionFile);
            if (target != null) {
                int focusRequest = ++entryRequest;
                if (jobID != null && !network) Post("focus", new { id = jobID }, delegate(Dictionary<string, object> result) {
                    string state = (string)result["state"];
                    // Closing the window and clicking again can precede its posted
                    // cancellation notification. Reconcile the terminal job, then reopen.
                    if (!committed && (state == "cancelled" || state == "error")) { Finish(null); ExecuteCommand(command); }
                    else { if(focusRequest == entryRequest)requestedCommand = null; pendingPoll = true; }
                });
                else { if(!committed && command == "batch" && currentCommand == "batch")requestedCommand = command; pendingPoll = true; }
                return;
            }
            try {
                generation++; committed = false; waitingForNative = false; requestedCommand = null;
                verificationSent = false; finalizationSent = false;
                checking = false; pendingCheck = false;
                if (command == "batch") {
                    // Rebind each new window's observation after Zotero's native COM work.
                    // Dispose the previous sink and native hooks before installing new ones.
                    if (events != null) events.Dispose();
                    events = new DocumentEvents((object)app, QueueCheck);
                }
                currentCommand = command;
                Diagnostics.Write("entry-" + command, "start", 0, 0, 0, 0);
                LastError = ""; Status = "starting";
                target = new WordDocument(app, cached);
                if (command == "superscript" || command == "inline") {
                    int count = target.SetDisplay(command, true);
                    if (count == 0) throw new InvalidOperationException("当前正文没有数字型 Zotero 引用。请先插入引用，并选择数字型文献格式。");
                    Finish(null); QueueCheck(); return;
                }
                if (command == "batch") { observed = target; observedID = null; observedFinished = false; }
                started = DateTime.UtcNow; committed = false;
                StartCurrent();
            } catch (Exception e) { Finish(e); }
        }
        void StartCurrent() {
            // Recapture after native bibliography completion, since it changes
            // field ranges, document settings and the document fingerprint.
            var snapshot = target.Capture(currentCommand == "batch");
            Diagnostics.Write("bridge-start", "start", target.LastCaptureMilliseconds, 0, 0, 0);
            if (currentCommand == "bibliography" && Convert.ToInt32(snapshot["selectionStart"]) != Convert.ToInt32(snapshot["selectionEnd"]))
                throw new InvalidOperationException("请先单击参考文献表的插入位置，取消文字选区后再插入。");
            Post("start", new { protocol = 3, clientVersion = "2.0.0", capabilities = BridgeClient.RequiredCapabilities, command = currentCommand, snapshot = snapshot }, delegate(Dictionary<string, object> result) {
                    if (result.ContainsKey("waitingForNative")) {
                        waitingForNative = true; Status = "waiting-native"; timer.Start(); return;
                    }
                    waitingForNative = false;
                    if (!result.ContainsKey("protocol") || Convert.ToInt32(result["protocol"]) != 3) throw new InvalidOperationException("Zotero 服务没有确认安全协议，未修改文档。");
                    jobID = (string)result["id"];
                    Diagnostics.Write("dialog-open", "ok", (long)(DateTime.UtcNow-started).TotalMilliseconds, 0, 0, 0);
                    if (currentCommand == "batch") observedID = jobID;
                    Status = "waiting"; timer.Start(); Poll();
                });
        }
        void Post(string action, object payload, Action<Dictionary<string, object>> completed) {
            network = true;
            int requestGeneration = generation;
            string file = ConnectionFile;
            Task.Factory.StartNew(() => BridgeClient.Send(action, payload, file)).ContinueWith(task => {
                if (ui == null || ui.IsDisposed) return;
                try { ui.BeginInvoke((Action)delegate {
                    if (requestGeneration != generation) return;
                    network = false;
                    if (target == null) return;
                    if (task.IsFaulted) { Finish(task.Exception.GetBaseException()); return; }
                    try { completed(task.Result); } catch (Exception e) { Finish(e); }
                    if (pendingCheck) QueueCheck();
                    if (pendingPoll) { pendingPoll = false; Poll(); }
                }); } catch (InvalidOperationException) { }
            });
        }
        void QueueCheck() {
            System.Threading.Interlocked.Increment(ref documentEventCount);
            if (ui == null || ui.IsDisposed || observed == null) return;
            try { ui.BeginInvoke((Action)delegate {
                if (debounce == null || observed == null) return;
                pendingCheck = true; debounce.Stop(); debounce.Start();
            }); } catch (InvalidOperationException) { }
        }
        void CheckDocument() {
            if (observed == null || observedID == null || !observed.IsActive) { pendingCheck = false; return; }
            if (network || checking || (target != null && committed)) { pendingCheck = true; return; }
            pendingCheck = false; checking = true;
            var watch = observed; string id = observedID, file = ConnectionFile; int checkGeneration = generation;
            string action = observedFinished ? "checked" : "snapshot";
            object payload;
            try {
                AutomaticCheckCount++;
                if (!watch.HasContentChanged()) { checking = false; return; }
                payload = new { id = id, snapshot = watch.Capture(true) };
            } catch (Exception e) {
                action = "check-error"; payload = new { id = id, message = e.Message };
            }
            string requestAction = action;
            Task.Factory.StartNew(() => BridgeClient.Send(requestAction, payload, file)).ContinueWith(task => {
                if (ui == null || ui.IsDisposed) return;
                try { ui.BeginInvoke((Action)delegate {
                    if (checkGeneration != generation) return;
                    checking = false;
                    if (observed != watch || observedID != id) return;
                    if (!task.IsFaulted) {
                        SnapshotUpdateCount++;
                        if (task.Result.ContainsKey("watching") && !(bool)task.Result["watching"]) { observed = null; observedID = null; }
                    }
                    // A failed delivery must not make the local fingerprint look synchronized.
                    if (task.IsFaulted) watch.InvalidateSnapshot();
                    if (pendingCheck) QueueCheck();
                }); } catch (InvalidOperationException) { }
            });
        }
        void Notify(string text, bool error) {
            LastToast = text;
            if (!Interactive || app == null) return;
            try { if (toast != null) toast.Close(); toast = new Toast(new IntPtr((int)app.Hwnd), text, error); } catch { }
        }
        void Poll() {
            if (target == null) return;
            if (network) { pendingPoll = true; return; }
            if (waitingForNative) { waitingForNative = false; try { StartCurrent(); } catch(Exception e) { Finish(e); } return; }
            if (jobID == null) return;
            if ((DateTime.UtcNow - started).TotalMinutes > 15) { Finish(new InvalidOperationException("引用操作已超时。请关闭 Zotero 中的选择窗口后重试。")); return; }
            Post("poll", new { id = jobID }, delegate(Dictionary<string, object> result) {
                string state = (string)result["state"]; Status = state;
                if (!committed && requestedCommand != null && (state == "error" || state == "cancelled")) {
                    string retry = requestedCommand; Finish(null); ExecuteCommand(retry); return;
                }
                if (state == "error") { Finish(new InvalidOperationException((string)result["message"])); return; }
                if (state == "cancelled") { Finish(new InvalidOperationException("已取消引用操作，未继续刷新。")); return; }
                if (state == "pending" && requestedCommand != null) {
                    string focus = requestedCommand; requestedCommand = null; ExecuteCommand(focus);
                } else if (state == "ready") {
                    if (committed) throw new InvalidOperationException("Word 已提交该批引用。为避免重复插入，请点击刷新重试。");
                    var ack = target.Commit((Dictionary<string, object>)result["plan"]);
                    committed = true; Status = "refreshing";
                    Post("committed", new { id = jobID, snapshot = ack }, delegate(Dictionary<string, object> ignored) { });
                } else if (state == "verifying") {
                    if (!verificationSent) {
                        verificationSent = true; Status = "verifying";
                        var after = target.Capture(true);
                        Post("verify", new { id = jobID, snapshot = after }, delegate(Dictionary<string, object> verified) {
                            string next = (string)verified["state"]; Status = next;
                            if (next == "needs-recovery") { Finish(new InvalidOperationException(IssueMessage(verified))); return; }
                            Poll();
                        });
                    }
                } else if (state == "finalizing") {
                    if (!finalizationSent && result.ContainsKey("finalization")) {
                        finalizationSent = true; Status = "finalizing";
                        var finalization = (Dictionary<string, object>)result["finalization"];
                        try { target.Finalize(finalization); }
                        catch (Exception e) { Finish(e); return; }
                        Post("finalized", new { id = jobID, documentKey = (string)finalization["documentKey"], transactionId = (string)finalization["transactionId"] }, delegate(Dictionary<string, object> ignored) { Poll(); });
                    }
                } else if (state == "needs-recovery") {
                    Finish(new InvalidOperationException(IssueMessage(result)));
                } else if (state == "done") {
                    target.ReapplyDisplay();
                    if (result.ContainsKey("keepOpen") && Convert.ToBoolean(result["keepOpen"])) {
                        var updated = target.Capture(true); committed = false; verificationSent = false; finalizationSent = false; started = DateTime.UtcNow;
                        Post("completed", new { id = jobID, snapshot = updated }, delegate(Dictionary<string, object> ignored) { Status = "waiting"; });
                        return;
                    }
                    string completedID = jobID;
                    var finalSnapshot = currentCommand == "batch" ? target.Capture(true) : null;
                    // Release Word's operation before the matching window disappears.
                    // A click immediately after closing must be able to start a new batch.
                    Finish(null);
                    AcknowledgeCompletion(completedID, finalSnapshot);
                }
            });
        }
        void AcknowledgeCompletion(string id, Dictionary<string, object> snapshot) {
            int completedGeneration = generation;
            string file = ConnectionFile;
            Task.Factory.StartNew(() => BridgeClient.Send("completed", new { id = id, snapshot = snapshot }, file)).ContinueWith(task => {
                if (!task.IsFaulted || ui == null || ui.IsDisposed) return;
                try { ui.BeginInvoke((Action)delegate {
                    if (completedGeneration != generation || target != null) return;
                    Notify("引用已完成，但未能关闭 Zotero 窗口，请手动关闭。" + task.Exception.GetBaseException().Message, true);
                }); } catch (InvalidOperationException) { }
            });
        }
        static string IssueMessage(Dictionary<string, object> result) {
            if (result.ContainsKey("issues") && result["issues"] is System.Collections.IEnumerable) {
                foreach (var raw in (System.Collections.IEnumerable)result["issues"]) {
                    var issue = raw as Dictionary<string, object>;
                    if (issue == null) continue;
                    bool blocking = issue.ContainsKey("blocking") && Convert.ToBoolean(issue["blocking"]);
                    if (!blocking) continue;
                    return Convert.ToString(issue["message"]) + " " + Convert.ToString(issue["action"]);
                }
            }
            if (result.ContainsKey("message") && !string.IsNullOrWhiteSpace(Convert.ToString(result["message"])))
                return Convert.ToString(result["message"]) + " 已保留事务记录，请重新打开批量匹配窗口核验恢复。";
            return "提交后验证未通过，引用域需要人工核对。已保留原绑定记录，请勿重复插入。";
        }
        void Finish(Exception error) {
            generation++;
            if (timer != null) timer.Stop();
            if (debounce != null) debounce.Stop();
            checking = false; pendingCheck = false;
            verificationSent = false; finalizationSent = false;
            if (error != null && jobID != null) {
                string cancelledID = jobID, file = ConnectionFile, action = committed ? "abandon" : "cancel";
                Task.Factory.StartNew(delegate { try { BridgeClient.Send(action, new { id = cancelledID, message = error.Message }, file); } catch { } });
            }
            Status = error == null ? "done" : "error";
            LastError = error == null ? "" : error.Message;
            LastErrorDetail = error == null ? "" : error.ToString();
            Diagnostics.Write("entry-" + currentCommand, error == null ? "complete" : "error", started == default(DateTime) ? 0 : (long)(DateTime.UtcNow-started).TotalMilliseconds, 0, 0, 0, error);
            if (observed != null && currentCommand == "batch") {
                observed = null; observedID = null; pendingCheck = false;
            }
            if (target != null && currentCommand == "batch" && target.Snapshot != null) cached = target;
            target = null; jobID = null; network = false; pendingPoll = false; waitingForNative = false; requestedCommand = null;
            Notify(error != null ? error.Message + (committed ? "\n引用域已保留，可使用 Zotero 刷新或在 Word 中撤销。" : "") : "已完成" + (currentCommand == "superscript" ? "上标编号设置。" : currentCommand == "inline" ? "正文编号设置。" : "引用操作。"), error != null);
        }
    }
}
