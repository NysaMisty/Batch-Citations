// SPDX-License-Identifier: MIT
using System;
using System.IO;
using System.Diagnostics;
using System.Text;

namespace ZoteroBatchCitations {
    internal static class Diagnostics {
        static readonly object gate = new object();
        internal static void Write(string stage, string status, long elapsed, int characters, int candidates, int fields, Exception error = null) {
            // Counts and code locations only: never document text, citation data,
            // document paths, bridge payloads or authentication tokens.
            string line = DateTime.UtcNow.ToString("o") + " stage=" + stage + " status=" + status + " elapsedMs=" + elapsed +
                " characters=" + characters + " candidates=" + candidates + " fields=" + fields;
            if (error != null) line += " errorType=" + error.GetType().FullName + " hresult=" + error.HResult.ToString("X8") + " stack=" + (error.StackTrace ?? "").Replace("\r", " ").Replace("\n", " ");
            Trace.WriteLine("[Batch Citations] " + line);
            try { lock (gate) {
                string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ZoteroBatchCitations", "logs");
                Directory.CreateDirectory(root);
                string file = Path.Combine(root, "word.log");
                if (File.Exists(file) && new FileInfo(file).Length > 512 * 1024) { string previous = file + ".previous"; if (File.Exists(previous)) File.Delete(previous); File.Move(file, previous); }
                File.AppendAllText(file, line + Environment.NewLine, new UTF8Encoding(false));
            } } catch { /* Diagnostics must not interrupt or change a document. */ }
        }
    }
}
