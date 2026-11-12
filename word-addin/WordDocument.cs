// SPDX-License-Identifier: MIT
using System;
using System.Linq;
using System.Text;
using System.Collections;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Xml;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;

namespace ZoteroBatchCitations {
    // All methods must run on Word's UI thread, including validation and rollback.
    public sealed class WordDocument {
        readonly dynamic app;
        readonly dynamic doc;
        readonly dynamic selection;
        string snapshotSignature;
        bool hasCandidateScan;
        public int FullScanCount { get; private set; }
        public int SnapshotCacheHits { get; private set; }
        public long LastCaptureMilliseconds { get; private set; }
        public Dictionary<string, object> Snapshot { get; private set; }
        public bool IsActive { get { try { return object.ReferenceEquals((object)app.ActiveDocument, (object)doc); } catch { return false; } } }
        public void InvalidateSnapshot() { snapshotSignature = null; if (Snapshot != null) Snapshot["fingerprint"] = ""; }
        static readonly Regex Marker = new Regex(@"\[\s*\d[\d\s,，、;；\-–—]*\]", RegexOptions.Compiled);
        static readonly Regex NumberOnly = new Regex(@"^(?=.*[0-9])[\[\]0-9,;，、\s–—\-]+$", RegexOptions.Compiled);
        public WordDocument(object application) : this(application, null) { }
        public WordDocument(object application, WordDocument cached) {
            app = application; doc = app.ActiveDocument;
            selection = app.Selection.Range.Duplicate;
            AssertEditable();
            if (cached != null && object.ReferenceEquals((object)doc, (object)cached.doc)) {
                Snapshot = cached.Snapshot; snapshotSignature = cached.snapshotSignature; hasCandidateScan = cached.hasCandidateScan;
                FullScanCount = cached.FullScanCount; SnapshotCacheHits = cached.SnapshotCacheHits;
            }
        }
        void AssertEditable() {
            string name = doc.Name; // Throws if the original document was closed.
            if ((bool)doc.ReadOnly || (int)doc.ProtectionType != -1) throw new InvalidOperationException("当前文档只读或已受保护，未作修改。");
            if ((bool)doc.TrackRevisions || (int)doc.Revisions.Count != 0) throw new InvalidOperationException("请先关闭修订，并处理已有修订后重试。");
            if ((int)selection.StoryType != 1) throw new InvalidOperationException("请将光标放在文档正文中；此版本不在页眉、脚注或文本框插入。");
        }
        public static string Hash(string value) {
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", "").ToLowerInvariant();
        }
        public string Fingerprint() {
            return Hash(BodyFingerprint() + "\n" + DocumentData() + "\n" + BindingData());
        }
        string BodyFingerprint() {
            // Word regenerates package properties on every WordOpenXML call. Only the
            // main document XML carries the ranges and formatting being edited here.
            var xml = new XmlDocument(); xml.XmlResolver = null;
            xml.LoadXml((string)doc.Content.WordOpenXML);
            var main = xml.SelectSingleNode("//*[local-name()='part' and @*[local-name()='name']='/word/document.xml']/*[local-name()='xmlData']/*");
            if (main == null) throw new InvalidOperationException("Word 未返回正文结构，已停止操作。");
            foreach (XmlNode proof in main.SelectNodes(".//*[local-name()='proofErr']")) proof.ParentNode.RemoveChild(proof);
            foreach (XmlAttribute attribute in main.SelectNodes(".//@*[starts-with(local-name(),'rsid')]")) attribute.OwnerElement.RemoveAttributeNode(attribute);
            // Word regenerates these two inline-drawing editing identifiers on
            // each export in the problem document. Keep all drawing geometry,
            // positioning, relationships and formatting in the fingerprint.
            foreach (XmlAttribute attribute in main.SelectNodes(".//*[local-name()='inline' and namespace-uri()='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing']/@*[namespace-uri()='http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing' and (local-name()='anchorId' or local-name()='editId')]")) attribute.OwnerElement.RemoveAttributeNode(attribute);
            return Hash(main.OuterXml);
        }
        public string BindingData() {
            try { return ChunkedProperty("ZBC_BINDINGS_"); }
            catch (InvalidOperationException) { var journal = ReadJournal(); if (journal != null) return Convert.ToString(journal["beforeBindings"]); throw; }
        }
        string ChunkedProperty(string prefix) {
            var chunks = new SortedDictionary<int, string>();
            foreach (dynamic prop in doc.CustomDocumentProperties) {
                var match = Regex.Match((string)prop.Name, "^" + prefix + @"(\d+)$");
                if (match.Success) chunks.Add(int.Parse(match.Groups[1].Value), Convert.ToString(prop.Value));
            }
            if (chunks.Keys.Where((key, i) => key != i + 1).Any()) throw new InvalidOperationException("文档绑定数据分段缺失，请先恢复或核查文档。");
            return string.Concat(chunks.Values);
        }
        void SetBindingData(string value) {
            for (int i = (int)doc.CustomDocumentProperties.Count; i > 0; i--) {
                dynamic prop = doc.CustomDocumentProperties[i];
                if (Regex.IsMatch((string)prop.Name, @"^ZBC_BINDINGS_\d+$")) prop.Delete();
            }
            int part = 1;
            for (int offset = 0; offset < value.Length; ) {
                int length = Math.Min(255, value.Length - offset);
                if (offset + length < value.Length && char.IsHighSurrogate(value[offset + length - 1])) length--;
                PutProperty("ZBC_BINDINGS_" + part++, value.Substring(offset, length)); offset += length;
            }
        }
        string ContentSignature(string text) {
            var parts = new StringBuilder(text);
            foreach (dynamic field in doc.Fields) parts.Append('\n').Append((int)field.Code.Start).Append(':').Append((int)field.Result.End).Append(':').Append((string)field.Code.Text).Append(':').Append((string)field.Result.Text);
            foreach (dynamic link in doc.Hyperlinks) parts.Append("\nh:").Append((int)link.Range.Start).Append(':').Append((int)link.Range.End);
            foreach (dynamic control in doc.ContentControls) parts.Append("\nc:").Append((int)control.Range.Start).Append(':').Append((int)control.Range.End);
            return Hash(parts.ToString() + "\n" + DocumentData() + "\n" + BindingData());
        }
        public bool HasContentChanged() { AssertEditable(); return Snapshot == null || snapshotSignature != ContentSignature((string)doc.Content.Text); }
        public string DocumentData() {
            var chunks = new SortedDictionary<int, string>();
            foreach (dynamic prop in doc.CustomDocumentProperties) {
                var match = Regex.Match((string)prop.Name, @"^ZOTERO_PREF_(\d+)$");
                if (match.Success) chunks.Add(int.Parse(match.Groups[1].Value), Convert.ToString(prop.Value));
            }
            if (chunks.Keys.Where((key, i) => key != i + 1).Any()) throw new InvalidOperationException("Zotero 文档设置分段缺失，请先用官方插件检查。");
            return string.Concat(chunks.Values);
        }
        string Property(string name) {
            try { return Convert.ToString(doc.CustomDocumentProperties[name].Value); } catch { return ""; }
        }
        void PutProperty(string name, string value) {
            try { doc.CustomDocumentProperties[name].Value = value; }
            catch { doc.CustomDocumentProperties.Add(name, false, 4, value, Type.Missing); }
        }
        void SetDocumentData(string value) {
            for (int i = (int)doc.CustomDocumentProperties.Count; i > 0; i--) {
                dynamic prop = doc.CustomDocumentProperties[i];
                if (Regex.IsMatch((string)prop.Name, @"^ZOTERO_PREF_\d+$")) prop.Delete();
            }
            int part = 1;
            for (int offset = 0; offset < value.Length; ) {
                int length = Math.Min(255, value.Length - offset);
                if (offset + length < value.Length && char.IsHighSurrogate(value[offset + length - 1])) length--;
                PutProperty("ZOTERO_PREF_" + part++, value.Substring(offset, length)); offset += length;
            }
        }
        class Boundary { public int Start, End, ResultStart, ResultEnd; public string Reason; public bool IsField, IsControl; }
        List<Boundary> ProtectedRanges() {
            var ranges = new List<Boundary>();
            foreach (dynamic field in doc.Fields) ranges.Add(new Boundary { Start = (int)field.Code.Start - 1, End = (int)field.Result.End + 1, ResultStart = (int)field.Result.Start, ResultEnd = (int)field.Result.End, IsField = true, Reason = "已有域（包括 Zotero 引用及参考文献表）" });
            foreach (dynamic link in doc.Hyperlinks) {
                try { if ((int)link.Range.StoryType == 1) ranges.Add(new Boundary { Start = link.Range.Start, End = link.Range.End, Reason = "超链接" }); } catch { }
            }
            foreach (dynamic control in doc.ContentControls) if ((int)control.Range.StoryType == 1) ranges.Add(new Boundary { Start = control.Range.Start, End = control.Range.End, ResultStart = control.Range.Start, ResultEnd = control.Range.End, IsControl = true, Reason = "内容控件" });
            foreach (dynamic paragraph in doc.Paragraphs) {
                if (Regex.IsMatch(((string)paragraph.Range.Text).Trim(), @"^(参考文献|references|bibliography)\s*[:：]?$", RegexOptions.IgnoreCase)) {
                    ranges.Add(new Boundary { Start = paragraph.Range.End, End = doc.Content.End, Reason = "参考文献标题之后的位置（避免转换手写列表）" }); break;
                }
            }
            return ranges;
        }
        void ScanTextRange(int start, int stop, int contentEnd, List<Boundary> protectedRanges, List<object> candidates, List<object> warnings, bool protectedResult) {
            if (stop <= start) return;
            string text = doc.Range(start, stop).Text;
            int unresolved = 0;
            foreach (Match match in Marker.Matches(text)) {
                int left = start + match.Index, right = left + match.Length;
                // Word ranges count field codes even though Range.Text returns
                // their display. Scan field-free spans and verify every offset.
                if (right > stop || (string)doc.Range(left, right).Text != match.Value) { unresolved++; continue; }
                var boundary = protectedRanges.FirstOrDefault(b => b.Start < right && b.End > left);
                candidates.Add(new { start = left, end = right, raw = match.Value, eligible = boundary == null,
                    reason = boundary == null ? "" : boundary.Reason,
                    context = (string)doc.Range(Math.Max(0, left - 32), Math.Min(contentEnd, right + 32)).Text,
                    textAfter = (string)doc.Range(right, Math.Min(contentEnd, right + 32)).Text });
                if (candidates.Count > 2000) throw new InvalidOperationException("候选超过 2000 处，请拆分处理；未截断或提交任何编号。");
            }
            if (unresolved > 0) warnings.Add(new { code = "unresolved-marker-range", count = unresolved, blocking = !protectedResult });
        }
        List<object> ScanCandidates(List<Boundary> protectedRanges, List<object> warnings) {
            var candidates = new List<object>(); int contentEnd = doc.Content.End;
            var fields = protectedRanges.Where(b => b.IsField || b.IsControl).OrderBy(b => b.Start).ThenByDescending(b => b.End).ToList();
            foreach (dynamic paragraph in doc.Paragraphs) {
                dynamic range = paragraph.Range;
                int cursor = range.Start, end = range.End;
                // Find.Execute may return a previous match in a table cell even
                // after SetRange advances. Paragraph-local text avoids that loop.
                foreach (var field in fields) {
                    if (field.End <= cursor) continue;
                    if (field.Start >= end) break;
                    if (field.Start > cursor) ScanTextRange(cursor, Math.Min(field.Start, end), contentEnd, protectedRanges, candidates, warnings, false);
                    cursor = Math.Max(cursor, Math.Min(field.End, end));
                }
                if (cursor < end) ScanTextRange(cursor, end, contentEnd, protectedRanges, candidates, warnings, false);
            }
            int covered = -1;
            foreach (var field in fields) {
                if (field.Start < covered) continue;
                ScanTextRange(field.ResultStart, field.ResultEnd, contentEnd, protectedRanges, candidates, warnings, true);
                covered = field.End;
            }
            return candidates;
        }
        void AddBodyTextSegments(List<object> segments, int start, int end, SortedSet<int> markerBoundaries) {
            int cursor = start;
            // Math/embedded objects can make Word CP offsets differ from string
            // indices. Cut at verified marker endpoints so JS never slices a
            // mixed text/object range using an assumed one-to-one offset map.
            foreach (int boundary in markerBoundaries.GetViewBetween(start, end)) {
                if (boundary > cursor) segments.Add(new { kind = "text", start = cursor, end = boundary, text = (string)doc.Range(cursor, boundary).Text });
                cursor = boundary;
            }
            if (cursor < end) segments.Add(new { kind = "text", start = cursor, end = end, text = (string)doc.Range(cursor, end).Text });
        }
        public Dictionary<string, object> Capture(bool scan) {
            var clock = Stopwatch.StartNew();
            string stage = "document-read"; int characters = 0, candidateCount = 0, nativeFields = 0;
            Diagnostics.Write(stage, "start", 0, 0, 0, 0);
            try {
            AssertEditable();
            string text = doc.Content.Text;
            characters = text.Length;
            if (text.Length > 5 * 1024 * 1024) throw new InvalidOperationException("当前文档超过实时扫描的 5 Mi 字符限制，请拆分处理。");
            stage = "content-signature";
            string signature = ContentSignature(text);
            if (scan && hasCandidateScan && Snapshot != null && signature == snapshotSignature) {
                Snapshot = new Dictionary<string, object>(Snapshot);
                // The selection is captured anew for every invocation. Reuse candidate
                // ranges only, and refresh the full write fingerprint for formatting edits.
                Snapshot["fingerprint"] = Fingerprint(); Snapshot["name"] = (string)doc.Name;
                Snapshot["path"] = (string)doc.Path == "" ? "" : (string)doc.FullName;
                Snapshot["selectionStart"] = (int)selection.Start; Snapshot["selectionEnd"] = (int)selection.End;
                SnapshotCacheHits++; LastCaptureMilliseconds = clock.ElapsedMilliseconds;
                Diagnostics.Write("snapshot-cache", "ok", clock.ElapsedMilliseconds, characters, 0, 0);
                return Snapshot;
            }
            var candidates = new List<object>();
            var scanWarnings = new List<object>();
            stage = "protected-ranges";
            var protectedRanges = ProtectedRanges();
            if (scan) {
                stage = "candidate-scan";
                FullScanCount++;
                candidates = ScanCandidates(protectedRanges, scanWarnings); candidateCount = candidates.Count;
                Diagnostics.Write(stage, "ok", clock.ElapsedMilliseconds, characters, candidateCount, 0);
            }
            stage = "native-fields";
            int bibliographyCount = 0; var codes = new List<string>(); var citationTexts = new List<string>();
            var citationFields = new List<object>(); var bodyFields = new List<Dictionary<string, object>>(); int fieldIndex = 0; int contentEnd = (int)doc.Content.End;
            foreach (dynamic field in doc.Fields) {
                string code = ((string)field.Code.Text).Trim();
                int outerStart = (int)field.Code.Start - 1, outerEnd = (int)field.Result.End + 1;
                bodyFields.Add(new Dictionary<string, object> { {"kind", code.StartsWith("ADDIN ZOTERO_ITEM ") ? "citation" : code.StartsWith("ADDIN ZOTERO_BIBL ") ? "bibliography" : "field"},
                    {"start", outerStart}, {"end", outerEnd}, {"signature", Hash(code + "\n" + (string)field.Result.Text)} });
                if (code.StartsWith("ADDIN ZOTERO_BIBL ")) bibliographyCount++;
                if (code.StartsWith("ADDIN ZOTERO_ITEM ")) {
                    codes.Add(code); citationTexts.Add((string)field.Result.Text);
                    int codeStart = (int)field.Code.Start, codeEnd = (int)field.Code.End;
                    int resultStart = (int)field.Result.Start, resultEnd = (int)field.Result.End;
                    int afterEnd = Math.Min(contentEnd, outerEnd + 32);
                    citationFields.Add(new {
                        index = fieldIndex, start = codeStart, end = resultEnd, codeStart, codeEnd, resultStart, resultEnd,
                        fieldStart = outerStart, fieldEnd = outerEnd,
                        storyType = (int)field.Code.StoryType, code, codeHash = Hash(code),
                        text = (string)field.Result.Text,
                        textAfter = afterEnd > outerEnd ? (string)doc.Range(outerEnd, afterEnd).Text : "",
                        context = (string)doc.Range(Math.Max(0, outerStart - 24), Math.Min(contentEnd, outerEnd + 24)).Text,
                        citationID = CitationID(code)
                    });
                }
                fieldIndex++;
            }
            nativeFields = citationFields.Count;
            if (bibliographyCount > 1) throw new InvalidOperationException("文档存在多个 Zotero 参考文献表。请先用官方插件检查，避免重复更新。");
            var markerBoundaries = new SortedSet<int>();
            foreach (dynamic candidate in candidates) { markerBoundaries.Add((int)candidate.start); markerBoundaries.Add((int)candidate.end); }
            var bodySegments = new List<object>(); int bodyCursor = 0;
            foreach (var field in bodyFields.OrderBy(f => Convert.ToInt32(f["start"]))) {
                int start = Convert.ToInt32(field["start"]), end = Convert.ToInt32(field["end"]);
                if (start < bodyCursor) continue; // Nested fields are protected by the enclosing field.
                if (start > bodyCursor) AddBodyTextSegments(bodySegments, bodyCursor, start, markerBoundaries);
                bodySegments.Add(field); bodyCursor = end;
            }
            if (bodyCursor < contentEnd) AddBodyTextSegments(bodySegments, bodyCursor, contentEnd, markerBoundaries);
            stage = "snapshot-fingerprint";
            var journal = ReadJournal();
            bool hasZoteroBookmarks = false;
            foreach (dynamic bookmark in doc.Bookmarks) if (((string)bookmark.Name).StartsWith("ZOTERO_", StringComparison.OrdinalIgnoreCase)) { hasZoteroBookmarks = true; break; }
            Snapshot = new Dictionary<string, object> {
                {"documentKey", Snapshot == null ? Guid.NewGuid().ToString("N") : Snapshot["documentKey"]}, {"fingerprint", Fingerprint()},
                {"documentData", DocumentData()}, {"bindingData", BindingData()}, {"path", (string)doc.Path == "" ? "" : (string)doc.FullName},
                {"name", (string)doc.Name}, {"candidates", candidates}, {"scanWarnings", scanWarnings}, {"citationCodes", codes}, {"citationTexts", citationTexts},
                {"citationFields", citationFields}, {"rangeVersion", 2}, {"bodySegments", bodySegments},
                {"pendingTransaction", TransactionID()}, {"transaction", journal}, {"unsupportedCitationStories", OtherCitationStories()},
                {"bibliographyCount", bibliographyCount}, {"display", Property("ZBC_DISPLAY")},
                {"hasZoteroBookmarks", hasZoteroBookmarks},
                {"selectionStart", (int)selection.Start}, {"selectionEnd", (int)selection.End}
            };
            snapshotSignature = signature; hasCandidateScan = scan; LastCaptureMilliseconds = clock.ElapsedMilliseconds;
            Diagnostics.Write("capture", "ok", clock.ElapsedMilliseconds, characters, candidateCount, nativeFields);
            return Snapshot;
            } catch (Exception error) {
                LastCaptureMilliseconds = clock.ElapsedMilliseconds;
                Diagnostics.Write(stage, "error", clock.ElapsedMilliseconds, characters, candidateCount, nativeFields, error);
                string label = stage == "document-read" ? "正文读取" : stage == "content-signature" ? "文档检查" : stage == "protected-ranges" ? "保护范围读取" : stage == "candidate-scan" ? "编号定位" : stage == "native-fields" ? "已有引用读取" : "文档校验";
                throw new InvalidOperationException("无法读取当前文档（" + label + "）：" + error.Message + " 未提交转换，可重新打开批量匹配窗口重试。", error);
            }
        }
        static readonly Regex Gap = new Regex(@"^[\t \u00A0,，;；、]*$", RegexOptions.Compiled);
        static readonly Regex CitationIDPattern = new Regex("\"citationID\"\\s*:\\s*\"([^\"]+)\"", RegexOptions.Compiled);
        static string CitationID(string code) {
            var match = CitationIDPattern.Match(code ?? "");
            return match.Success ? match.Groups[1].Value : "";
        }
        List<int> OtherCitationStories() {
            var stories = new List<int>();
            foreach (dynamic first in doc.StoryRanges) {
                dynamic story = first;
                while (story != null) {
                    if ((int)story.StoryType != 1) foreach (dynamic field in story.Fields) {
                        if (((string)field.Code.Text).Trim().StartsWith("ADDIN ZOTERO_ITEM ") && !stories.Contains((int)story.StoryType)) stories.Add((int)story.StoryType);
                    }
                    story = story.NextStoryRange;
                }
            }
            return stories;
        }
        void DeleteChunks(string prefix) {
            for (int i = (int)doc.CustomDocumentProperties.Count; i > 0; i--) {
                dynamic prop = doc.CustomDocumentProperties[i];
                if (Regex.IsMatch((string)prop.Name, "^" + prefix + @"\d+$")) prop.Delete();
            }
        }
        void WriteChunks(string prefix, string value) {
            if (value.Length > 2 * 1024 * 1024) throw new InvalidOperationException("辅助记录超过 2 MiB 限制，已停止写入。");
            DeleteChunks(prefix); int part = 1;
            for (int offset = 0; offset < value.Length;) {
                int length = Math.Min(255, value.Length - offset);
                if (offset + length < value.Length && char.IsHighSurrogate(value[offset + length - 1])) length--;
                PutProperty(prefix + part++, value.Substring(offset, length)); offset += length;
            }
            if (ChunkedProperty(prefix) != value) throw new InvalidOperationException("辅助记录读回校验失败。");
        }
        Dictionary<string, object> ReadJournal() {
            Dictionary<string, object> best = null; int generation = -1;
            foreach (string prefix in new[] { "ZBC_TRANSACTION_", "ZBC_TRANSACTION_NEXT_" }) {
                try {
                    string raw = ChunkedProperty(prefix); if (string.IsNullOrEmpty(raw)) continue;
                    var envelope = BridgeClient.Json.Deserialize<Dictionary<string, object>>(raw);
                    string payload = Convert.ToString(envelope["payload"]);
                    if (Convert.ToString(envelope["hash"]) != Hash(payload)) continue;
                    if (envelope.ContainsKey("encoding") && Convert.ToString(envelope["encoding"]) == "gzip-base64") {
                        using (var source = new MemoryStream(Convert.FromBase64String(payload)))
                        using (var gzip = new GZipStream(source, CompressionMode.Decompress))
                        using (var output = new MemoryStream()) {
                            var buffer = new byte[8192]; int count;
                            while ((count = gzip.Read(buffer, 0, buffer.Length)) > 0) { if (output.Length + count > 2 * 1024 * 1024) throw new InvalidOperationException("恢复记录解压超过限制。"); output.Write(buffer, 0, count); }
                            payload = Encoding.UTF8.GetString(output.ToArray());
                        }
                    }
                    var data = BridgeClient.Json.Deserialize<Dictionary<string, object>>(payload);
                    int candidate = data.ContainsKey("generation") ? Convert.ToInt32(data["generation"]) : 0;
                    if (Convert.ToInt32(data["version"]) == 2 && !string.IsNullOrEmpty(Convert.ToString(data["id"])) && data.ContainsKey("beforeBindings") && data.ContainsKey("beforeGraph") && data.ContainsKey("expectedGraph") && candidate > generation) { best = data; generation = candidate; }
                } catch { }
            }
            return best;
        }
        void WriteJournal(Dictionary<string, object> data) {
            var previous = ReadJournal(); data["generation"] = previous != null && previous.ContainsKey("generation") ? Convert.ToInt32(previous["generation"]) + 1 : 1;
            string payload;
            using (var output = new MemoryStream()) {
                using (var gzip = new GZipStream(output, CompressionMode.Compress, true)) { var bytes = Encoding.UTF8.GetBytes(BridgeClient.Json.Serialize(data)); gzip.Write(bytes, 0, bytes.Length); }
                payload = Convert.ToBase64String(output.ToArray());
            }
            string envelope = BridgeClient.Json.Serialize(new { encoding = "gzip-base64", payload = payload, hash = Hash(payload) });
            // NEXT is retained throughout primary replacement. A crash cannot
            // erase the only valid copy of the old ledger and expected graph.
            WriteChunks("ZBC_TRANSACTION_NEXT_", envelope);
            WriteChunks("ZBC_TRANSACTION_", envelope);
            DeleteChunks("ZBC_TRANSACTION_NEXT_");
        }
        string TransactionID() {
            var journal = ReadJournal(); if (journal != null) return Convert.ToString(journal["id"]);
            if (!string.IsNullOrEmpty(Property("ZBC_TRANSACTION_1")) || !string.IsNullOrEmpty(Property("ZBC_TRANSACTION_NEXT_1")) || !string.IsNullOrEmpty(Property("ZBC_BINDINGS_STAGE_1"))) return "unreadable-transaction";
            try { var active = BridgeClient.Json.Deserialize<Dictionary<string, object>>(ChunkedProperty("ZBC_BINDINGS_")); if (active.ContainsKey("state") && Convert.ToString(active["state"]) == "pending") return "missing-transaction-journal"; } catch { }
            return "";
        }
        void ClearTransaction() {
            for (int i = (int)doc.CustomDocumentProperties.Count; i > 0; i--) {
                dynamic prop = doc.CustomDocumentProperties[i];
                if (Regex.IsMatch((string)prop.Name, @"^ZBC_(BINDINGS_STAGE|BINDINGS_VERIFIED|TRANSACTION|TRANSACTION_NEXT)_\d+$")) prop.Delete();
            }
        }
        void StageLedger(string transactionId, string value, Dictionary<string, object> plan) {
            if (!string.IsNullOrEmpty(TransactionID())) throw new InvalidOperationException("已有未完成事务，请先核验恢复。");
            var expected = (Dictionary<string, object>)plan["expected"];
            var labels = new List<object>();
            if (expected.ContainsKey("newNumbers")) foreach (var label in ((IEnumerable)expected["newNumbers"]).Cast<Dictionary<string, object>>()) {
                var reference = (Dictionary<string, object>)label["record"];
                labels.Add(new { number = Convert.ToInt32(label["number"]), uris = reference["uris"] });
            }
            var journal = new Dictionary<string, object> { {"version", 2}, {"id", transactionId}, {"phase", "prepared"},
                {"beforeBindings", BindingData()}, {"beforeData", DocumentData()}, {"beforeBodyHash", BodyFingerprint()},
                {"beforeGraph", expected["beforeGraph"]}, {"expectedGraph", expected["graph"]}, {"stagedHash", Hash(value)},
                {"labels", labels}, {"metadataOnly", plan.ContainsKey("syncOnly") && Convert.ToBoolean(plan["syncOnly"])} };
            // Serialize and size-check the journal before touching any property.
            if (BridgeClient.Json.Serialize(journal).Length + value.Length > 2 * 1024 * 1024) throw new InvalidOperationException("事务恢复数据过大，未修改文档。");
            WriteJournal(journal); WriteChunks("ZBC_BINDINGS_STAGE_", value);
            string previous = Convert.ToString(journal["beforeBindings"]);
            var active = string.IsNullOrEmpty(previous) ? new Dictionary<string, object>() : BridgeClient.Json.Deserialize<Dictionary<string, object>>(previous);
            if (!active.ContainsKey("entries")) active["entries"] = new Dictionary<string, object>();
            active["version"] = 2; active["transaction"] = transactionId; active["state"] = "pending";
            SetBindingData(BridgeClient.Json.Serialize(active));
        }
        dynamic FindField(int start, string code, string citationID) {
            foreach (dynamic field in doc.Fields) {
                if ((int)field.Code.Start != start) continue;
                string actual = ((string)field.Code.Text).Trim();
                if (!string.IsNullOrEmpty(code) && actual != code.Trim())
                    throw new InvalidOperationException("引用域在扫描后已变化，未修改文档。请重新扫描。");
                if (!string.IsNullOrEmpty(citationID) && CitationID(actual) != citationID)
                    throw new InvalidOperationException("引用域身份在扫描后已变化，未修改文档。请重新扫描。");
                return field;
            }
            throw new InvalidOperationException("计划中的原引用域已不存在，未修改文档。请重新扫描。");
        }
        void ValidateMerge(Dictionary<string, object> op, int start, int end, List<Boundary> protectedRanges) {
            var sources = ((IEnumerable)op["sourceFields"]).Cast<Dictionary<string, object>>()
                .OrderBy(source => Convert.ToInt32(source["start"])).ToArray();
            if (sources.Length == 0) throw new InvalidOperationException("相邻合并计划缺少原引用域，未修改文档。");
            var allowed = new List<Boundary>();
            var segments = new List<Boundary>(); var starts = new HashSet<int>();
            var output = ParseCitation(op["code"]);
            var outputItems = ((IEnumerable)output["citationItems"]).Cast<Dictionary<string, object>>().ToArray();
            foreach (var source in sources) {
                int sourceStart = Convert.ToInt32(source["start"]), sourceEnd = Convert.ToInt32(source["end"]);
                if (!starts.Add(sourceStart)) throw new InvalidOperationException("相邻合并包含重复来源域。");
                dynamic field = FindField(sourceStart, Convert.ToString(source["code"]), Convert.ToString(source["citationID"]));
                var boundary = new Boundary { Start = (int)field.Code.Start - 1, End = (int)field.Result.End + 1 };
                allowed.Add(boundary); segments.Add(boundary);
                if (sourceEnd != (int)field.Result.End) throw new InvalidOperationException("原引用域范围与计划不一致，未修改文档。");
                var original = ParseCitation(Convert.ToString(source["code"]));
                if (original.ContainsKey("properties")) {
                    var properties = original["properties"] as Dictionary<string, object>;
                    if (properties != null && ((properties.ContainsKey("dontUpdate") && Convert.ToBoolean(properties["dontUpdate"])) || (properties.ContainsKey("custom") && !string.IsNullOrEmpty(Convert.ToString(properties["custom"])))))
                        throw new InvalidOperationException("自定义或手工修改的引用域不能自动合并。");
                    if (properties != null && properties.ContainsKey("plainCitation") && !string.IsNullOrEmpty(Convert.ToString(properties["plainCitation"])) && Convert.ToString(properties["plainCitation"]).Trim() != ((string)field.Result.Text ?? "").Trim())
                        throw new InvalidOperationException("引用域显示经过手工编辑，不能自动合并。");
                }
                foreach (var item in ((IEnumerable)original["citationItems"]).Cast<Dictionary<string, object>>())
                    if (!outputItems.Any(candidate => SameCiteItem(item, candidate))) throw new InvalidOperationException("合并计划丢失了旧文献或定位属性，未修改文档。");
            }
            foreach (var marker in ((IEnumerable)op["markers"]).Cast<Dictionary<string, object>>()) {
                int markerStart = Convert.ToInt32(marker["start"]), markerEnd = Convert.ToInt32(marker["end"]);
                if (markerStart < start || markerEnd > end || markerEnd <= markerStart || !(marker["raw"] is string) || (string)doc.Range(markerStart, markerEnd).Text != (string)marker["raw"])
                    throw new InvalidOperationException("待合并的编号标记与计划不一致，未修改文档。");
                segments.Add(new Boundary { Start = markerStart, End = markerEnd });
            }
            segments = segments.OrderBy(segment => segment.Start).ToList();
            if (segments[0].Start != start || segments[segments.Count - 1].End != end) throw new InvalidOperationException("相邻合并范围与计划不一致，未修改文档。");
            for (int i = 1; i < segments.Count; i++) {
                if (segments[i].Start < segments[i - 1].End || segments[i].Start - segments[i - 1].End > 32 || !Gap.IsMatch((string)doc.Range(segments[i - 1].End, segments[i].Start).Text ?? ""))
                    throw new InvalidOperationException("相邻合并的间隔包含正文或段落内容，未修改文档。");
            }
            if (protectedRanges.Any(b => b.Start < end && b.End > start && !(b.Reason == "已有域（包括 Zotero 引用及参考文献表）" && allowed.Any(a => a.Start == b.Start && a.End == b.End))))
                throw new InvalidOperationException("相邻合并范围与超链接、内容控件或其他域重叠，未修改文档。");
        }
        static Dictionary<string, object> ParseCitation(object value) {
            string code = value as string;
            const string prefix = "ADDIN ZOTERO_ITEM CSL_CITATION ";
            if (code == null || !code.Trim().StartsWith(prefix)) throw new InvalidOperationException("引用域代码无效，未修改文档。");
            var citation = BridgeClient.Json.Deserialize<Dictionary<string, object>>(code.Trim().Substring(prefix.Length));
            if (!citation.ContainsKey("citationID") || !(citation["citationID"] is string) || string.IsNullOrEmpty((string)citation["citationID"]) || !citation.ContainsKey("citationItems")) throw new InvalidOperationException("引用域身份无效。");
            var sequence = citation["citationItems"] as IEnumerable;
            var items = sequence == null || sequence is string ? null : sequence.Cast<object>().ToArray();
            if (items == null || items.Length == 0) throw new InvalidOperationException("引用域没有有效文献项。");
            foreach (var item in items) {
                var record = item as Dictionary<string, object>;
                if (record == null || !record.ContainsKey("uris") || !(record["uris"] is IEnumerable) || record["uris"] is string || !((IEnumerable)record["uris"]).Cast<object>().Any() || !record.ContainsKey("itemData")) throw new InvalidOperationException("引用项缺少文献身份。");
            }
            return citation;
        }
        static string UriKey(object value) { return Regex.Replace(Convert.ToString(value).Trim().TrimEnd('/'), @"^https?://(?:www\.)?zotero\.org/", "zotero.org/", RegexOptions.IgnoreCase); }
        static string CiteAttributes(Dictionary<string, object> item) {
            var attributes = new SortedDictionary<string, object>();
            foreach (string key in new[] { "locator", "label", "prefix", "suffix", "suppress-author", "author-only", "ignoreRetraction" }) {
                object value = null;
                if (item.ContainsKey(key)) value = item[key];
                else if (key == "suppress-author" && item.ContainsKey("suppressAuthor")) value = item["suppressAuthor"];
                else if (key == "author-only" && item.ContainsKey("authorOnly")) value = item["authorOnly"];
                if (value != null && !string.IsNullOrEmpty(Convert.ToString(value)) && !(value is bool && !(bool)value)) attributes[key] = value;
            }
            return BridgeClient.Json.Serialize(attributes);
        }
        static bool SameCiteItem(Dictionary<string, object> a, Dictionary<string, object> b) {
            return ((IEnumerable)a["uris"]).Cast<object>().Select(UriKey).Intersect(((IEnumerable)b["uris"]).Cast<object>().Select(UriKey)).Any() && CiteAttributes(a) == CiteAttributes(b);
        }
        void ExecuteMerge(Dictionary<string, object> op) {
            var sources = ((IEnumerable)op["sourceFields"]).Cast<Dictionary<string, object>>()
                .OrderBy(source => Convert.ToInt32(source["start"])).ToArray();
            dynamic baseField = FindField(Convert.ToInt32(sources[0]["start"]), Convert.ToString(sources[0]["code"]), Convert.ToString(sources[0]["citationID"]));
            var removals = new List<Tuple<int, object, bool>>(); var segments = new List<Boundary>();
            var sourceFields = new List<dynamic>();
            foreach (var source in sources) sourceFields.Add(FindField(Convert.ToInt32(source["start"]), Convert.ToString(source["code"]), Convert.ToString(source["citationID"])));
            // Resolve every field before changing any field code. Replacing the base
            // field's code changes its length and shifts all later positions, which
            // would make a subsequent FindField(start) miss the original range.
            // Merge removes the punctuation gap between source fields as well as the
            // later fields themselves. Otherwise a comma or space would survive
            // between the reused field and the following paragraph text.
            foreach (dynamic field in sourceFields) segments.Add(new Boundary { Start = (int)field.Code.Start - 1, End = (int)field.Result.End + 1 });
            // Delete whole fields through the Field object; a raw Range from
            // Code.Start to Result.End can cut a field boundary and Word refuses
            // to edit it. Remove fields right-to-left so earlier positions stay valid.
            for (int index = 1; index < sourceFields.Count; index++) removals.Add(Tuple.Create((int)sourceFields[index].Code.Start - 1, (object)sourceFields[index], true));
            foreach (var marker in ((IEnumerable)op["markers"]).Cast<Dictionary<string, object>>()) {
                int start = Convert.ToInt32(marker["start"]), end = Convert.ToInt32(marker["end"]);
                removals.Add(Tuple.Create(start, (object)doc.Range(start, end), false)); segments.Add(new Boundary { Start = start, End = end });
            }
            segments = segments.OrderBy(segment => segment.Start).ToList();
            for (int i = 1; i < segments.Count; i++) if (segments[i].Start > segments[i - 1].End)
                removals.Add(Tuple.Create(segments[i - 1].End, (object)doc.Range(segments[i - 1].End, segments[i].Start), false));
            // Mix whole-field and plain-range deletions in one descending order.
            // Resolving all objects first prevents old integer offsets from being
            // reused after deleting a field's (potentially very long) code.
            foreach (var removal in removals.OrderByDescending(r => r.Item1)) {
                dynamic target = removal.Item2; target.Delete();
            }
            // Update the surviving field only after the other ranges are gone.
            baseField.Code.Text = " " + (string)op["code"] + " ";
        }
        public Dictionary<string, object> Commit(Dictionary<string, object> plan) {
            AssertEditable();
            if (OtherCitationStories().Count != 0) throw new InvalidOperationException("文档含正文以外的 Zotero 引用，请使用官方插件处理全文。");
            if ((string)plan["documentKey"] != (string)Snapshot["documentKey"] || (string)plan["fingerprint"] != Fingerprint())
                throw new InvalidOperationException("扫描后文档或格式发生变化，未插入引用。请重新扫描。");
            var operations = ((IEnumerable)plan["operations"]).Cast<Dictionary<string, object>>().OrderByDescending(o => Convert.ToInt32(o["start"])).ToArray();
            var protectedRanges = ProtectedRanges(); int previous = int.MaxValue;
            foreach (var op in operations) {
                int start = Convert.ToInt32(op["start"]), end = Convert.ToInt32(op["end"]);
                string kind = op.ContainsKey("kind") ? Convert.ToString(op["kind"]) : "insert";
                if (kind != "insert" && kind != "mergeAdjacent") throw new InvalidOperationException("未知引用操作，未修改文档。");
                ParseCitation(op["code"]);
                if (start < 0 || end <= start || end > (int)doc.Content.End - 1 || end > previous)
                    throw new InvalidOperationException("引用位置或域代码校验失败，未修改文档。");
                if (kind == "mergeAdjacent") ValidateMerge(op, start, end, protectedRanges);
                else if ((string)doc.Range(start, end).Text != (string)op["raw"] || protectedRanges.Any(b => b.Start < end && b.End > start) ||
                    !((string)op["code"]).StartsWith("ADDIN ZOTERO_ITEM CSL_CITATION "))
                    throw new InvalidOperationException("引用位置或域代码校验失败，未修改文档。");
                previous = start;
            }
            string oldData = DocumentData(), oldBindings = BindingData(), oldBody = BodyFingerprint(); bool changed = false, record = false;
            bool staged = plan.ContainsKey("staged") && Convert.ToBoolean(plan["staged"]);
            string transactionId = plan.ContainsKey("transactionId") ? Convert.ToString(plan["transactionId"]) : "";
            bool stageWritten = false;
            bool resume = plan.ContainsKey("resume") && Convert.ToBoolean(plan["resume"]);
            if (!resume && !string.IsNullOrEmpty(TransactionID())) throw new InvalidOperationException("已有未完成引用事务，请先核验恢复。");
            bool screen = app.ScreenUpdating;
            // UndoRecord belongs to the active Word document. Bind it to the
            // captured target before starting a transaction after a window switch.
            doc.Activate(); selection.Select();
            try {
                if (staged) {
                    if (string.IsNullOrEmpty(transactionId) || !plan.ContainsKey("bindingData")) throw new InvalidOperationException("计划缺少事务或账本，未修改引用。");
                    if (resume) { if (TransactionID() != transactionId || operations.Length != 0) throw new InvalidOperationException("恢复计划不得重新插入引用。"); }
                    else { stageWritten = true; StageLedger(transactionId, Convert.ToString(plan["bindingData"]), plan); }
                    stageWritten = true;
                }
                app.UndoRecord.StartCustomRecord("编号批量引用"); record = true; app.ScreenUpdating = false;
                foreach (var op in operations) {
                    if ((op.ContainsKey("kind") ? Convert.ToString(op["kind"]) : "insert") == "mergeAdjacent") {
                        ExecuteMerge(op); changed = true; continue;
                    }
                    dynamic range = doc.Range(Convert.ToInt32(op["start"]), Convert.ToInt32(op["end"]));
                    // Match Zotero's native insertFieldRaw: creating an ADDIN field
                    // directly gives broken result ranges in some Word builds.
                    dynamic field = doc.Fields.Add(range, 35, "\"" + (string)op["raw"] + "\"", true);
                    changed = true;
                    field.Code.Text = " " + (string)op["code"] + " ";
                    field.Result.Text = (string)op["text"];
                }
                SetDocumentData((string)plan["documentData"]);
                // A capable client keeps the ledger staged until the post-refresh
                // verification has succeeded; Finalize promotes it without touching
                // fields. Legacy clients still write the ledger immediately.
                if (!staged && plan.ContainsKey("bindingData")) SetBindingData((string)plan["bindingData"]);
                if (staged) { var journal = ReadJournal(); journal["phase"] = "committed"; WriteJournal(journal); }
                doc.Saved = false;
            } catch (Exception error) {
                if (record) { app.UndoRecord.EndCustomRecord(); record = false; }
                try {
                    // ExecuteMerge can throw after its first deletion, before it
                    // returns to set changed. Compare the actual body as well.
                    if (changed || BodyFingerprint() != oldBody) doc.Undo(1);
                    SetDocumentData(oldData); SetBindingData(oldBindings);
                    if (BodyFingerprint() != oldBody || DocumentData() != oldData || BindingData() != oldBindings) throw new InvalidOperationException("回滚后的文档与操作前不一致。");
                    if (!resume && (stageWritten || TransactionID() == transactionId)) ClearTransaction();
                } catch (Exception rollback) { throw new InvalidOperationException("引用操作失败，且回滚未能完整验证。请保留文档并核对备份。原错误：" + error.Message + "；回滚错误：" + rollback.Message, error); }
                throw;
            } finally {
                if (record) app.UndoRecord.EndCustomRecord();
                app.ScreenUpdating = screen;
                try { doc.Activate(); selection.Select(); } catch { }
            }
            return new Dictionary<string, object> { {"documentData", DocumentData()}, {"documentKey", Snapshot["documentKey"]}, {"fingerprint", Fingerprint()} };
        }
        public Dictionary<string, object> Finalize(Dictionary<string, object> finalization) {
            AssertEditable();
            string transactionId = Convert.ToString(finalization["transactionId"]);
            string bindingData = Convert.ToString(finalization["bindingData"]);
            if (!string.IsNullOrEmpty(transactionId) && Property("ZBC_LAST_TRANSACTION") == transactionId && Property("ZBC_LAST_BODY_HASH") == BodyFingerprint() && BindingData() == bindingData)
                return new Dictionary<string, object> { {"documentKey", Snapshot["documentKey"]}, {"fingerprint", Fingerprint()}, {"transactionId", transactionId} };
            if ((string)finalization["documentKey"] != (string)Snapshot["documentKey"] || (string)finalization["fingerprint"] != Fingerprint())
                throw new InvalidOperationException("验证后文档又发生变化，未写入最终绑定记录。请重新核对。");
            if (string.IsNullOrEmpty(transactionId) || TransactionID() != transactionId)
                throw new InvalidOperationException("绑定事务标记缺失或不匹配，未完成最终化。");
            var ledger = BridgeClient.Json.Deserialize<Dictionary<string, object>>(bindingData);
            if (Convert.ToInt32(ledger["version"]) != 2 || !ledger.ContainsKey("entries")) throw new InvalidOperationException("最终账本格式无效，未完成最终化。");
            var journal = ReadJournal();
            if (journal == null) throw new InvalidOperationException("事务恢复记录损坏，未完成最终化。");
            if (Convert.ToString(journal["phase"]) != "finalizing" && Hash(ChunkedProperty("ZBC_BINDINGS_STAGE_")) != Convert.ToString(journal["stagedHash"]))
                throw new InvalidOperationException("原计划暂存记录校验失败，未完成最终化。");
            // The verified graph can legitimately have different carrier IDs and
            // ordering. Stage this verified result under the same nonce/digest,
            // retaining the original journal until every write has read back.
            WriteChunks("ZBC_BINDINGS_VERIFIED_", bindingData);
            journal["phase"] = "finalizing"; journal["finalLedgerHash"] = Hash(bindingData); WriteJournal(journal);
            SetBindingData(bindingData);
            if (finalization.ContainsKey("documentData") && finalization["documentData"] != null)
                SetDocumentData(Convert.ToString(finalization["documentData"]));
            if (BindingData() != bindingData) throw new InvalidOperationException("最终绑定记录校验失败，请恢复文档备份。");
            PutProperty("ZBC_LAST_TRANSACTION", transactionId);
            PutProperty("ZBC_LAST_BODY_HASH", BodyFingerprint());
            ClearTransaction();
            doc.Saved = false;
            return new Dictionary<string, object> { {"documentKey", Snapshot["documentKey"]}, {"fingerprint", Fingerprint()}, {"transactionId", transactionId} };
        }
        public void ActivateSelection() { AssertEditable(); doc.Activate(); selection.Select(); }
        public int SetDisplay(string display, bool persist) {
            AssertEditable();
            if (display != "superscript" && display != "inline") return 0;
            int count = 0; bool record = false;
            try {
                app.UndoRecord.StartCustomRecord("引用编号显示"); record = true;
                foreach (dynamic field in doc.Fields) {
                    string code = ((string)field.Code.Text).Trim();
                    if (!code.StartsWith("ADDIN ZOTERO_ITEM CSL_CITATION ") || !NumberOnly.IsMatch((string)field.Result.Text)) continue;
                    field.Result.Font.Subscript = 0; field.Result.Font.Position = 0;
                    field.Result.Font.Superscript = display == "superscript" ? -1 : 0; count++;
                }
                if (persist && count > 0) PutProperty("ZBC_DISPLAY", display);
                if (count > 0) doc.Saved = false;
            } finally { if (record) app.UndoRecord.EndCustomRecord(); }
            return count;
        }
        public void ReapplyDisplay() { SetDisplay(Property("ZBC_DISPLAY"), false); }
    }
}
