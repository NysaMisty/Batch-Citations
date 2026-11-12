// SPDX-License-Identifier: MIT
using System;
using System.IO;
using System.Net;
using System.Text;
using System.Collections.Generic;
using System.Web.Script.Serialization;

namespace ZoteroBatchCitations {
    public sealed class BridgeClient {
        [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(uint processID);
        public static void AllowForeground(string path) {
            try {
                var data=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(path,Encoding.UTF8));
                if(!data.ContainsKey("processID"))return;
                uint id=Convert.ToUInt32(data["processID"]);
                // The native integration grants foreground permission to the process,
                // then Zotero activates its actual dialog. Never restore the library window.
                AllowSetForegroundWindow(id);
            } catch { }
        }
        internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
        public static string ConnectionPath {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ZoteroBatchCitations", "connection.json"); }
        }
        public static Dictionary<string, object> Send(string action, object payload, string connectionPath) {
            if (action == "start") {
                var hello = Send("hello", new { }, connectionPath);
                if (!hello.ContainsKey("protocol") || Convert.ToInt32(hello["protocol"]) != 3 || !hello.ContainsKey("capabilities")) throw new InvalidOperationException("Zotero 服务未确认安全协议，请同时更新两端组件。");
                var capabilities = new System.Collections.Generic.HashSet<string>();
                foreach (object capability in (System.Collections.IEnumerable)hello["capabilities"]) capabilities.Add(Convert.ToString(capability));
                foreach (string required in RequiredCapabilities) if (!capabilities.Contains(required)) throw new InvalidOperationException("Zotero 服务缺少 " + required + " 能力，未修改文档。");
            }
            if (!File.Exists(connectionPath)) throw new InvalidOperationException("请先启动 Zotero 并安装 1.1.4 或更新版编号批量引用插件。");
            var settings = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(connectionPath, Encoding.UTF8));
            // Scanning/handshake work can outlive the permission granted by the
            // Ribbon click. Renew it immediately before the request opens/raises
            // the Zotero dialog. Windows still enforces foreground input rules.
            if (action == "start" || action == "focus") AllowForeground(connectionPath);
            if (!settings.ContainsKey("version") || new Version(Convert.ToString(settings["version"])) < new Version("1.1.4")) throw new InvalidOperationException("请将 Zotero 端编号批量引用插件同步更新至 1.1.4 或更新版。");
            // Never accept an arbitrary endpoint from a discovery file.
            int port = Convert.ToInt32(settings["port"]);
            if (port < 1 || port > 65535) throw new InvalidOperationException("Zotero 本地服务端口无效。");
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/batch-citations/live");
            request.Method = "POST"; request.ContentType = "application/json"; request.Proxy = null;
            request.AllowAutoRedirect = false; request.Timeout = 5000; request.ReadWriteTimeout = 5000;
            request.Headers["Authorization"] = "Bearer " + (string)settings["token"];
            byte[] bytes = Encoding.UTF8.GetBytes(Json.Serialize(new { action = action, payload = payload, protocol = 3, clientVersion = "1.1.13" }));
            request.ContentLength = bytes.Length;
            using (var stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
            try {
                using (var response = request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8)) {
                    var result = Json.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
                    if (result.ContainsKey("error")) throw new InvalidOperationException(Convert.ToString(result["error"]));
                    return result;
                }
            } catch (WebException e) {
                if (e.Response != null) {
                    using (var reader = new StreamReader(e.Response.GetResponseStream(), Encoding.UTF8)) {
                        var result = Json.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
                        if (result.ContainsKey("error")) throw new InvalidOperationException(Convert.ToString(result["error"]), e);
                    }
                }
                throw new InvalidOperationException("无法连接 Zotero。请确认 Zotero 已启动，且编号批量引用插件已启用。", e);
            }
        }
        internal static readonly string[] RequiredCapabilities = new[] { "structuredFields", "mergeAdjacent", "postCommitVerification", "stagedLedger", "finalize", "v2Ledger", "verifiedGraph", "recoverTransaction", "handshake" };
    }
}
