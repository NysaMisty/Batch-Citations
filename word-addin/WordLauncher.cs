// SPDX-License-Identifier: MIT
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace ZoteroBatchCitations {
    // A single Windows message opens the current-document workflow from Zotero.
    // No document data or write command is accepted through this window.
    internal sealed class WordLauncher : NativeWindow, IDisposable {
        readonly Action open, changed;
        readonly uint message, stateMessage;
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterWindowMessage(string name);
        public WordLauncher(Action action, Action stateChanged) {
            open = action; changed = stateChanged;
            message = RegisterWindowMessage("ZoteroBatchCitations.OpenCurrentDocument");
            stateMessage = RegisterWindowMessage("ZoteroBatchCitations.JobChanged");
            CreateHandle(new CreateParams { Caption = "ZoteroBatchCitations.Bridge", Parent = new IntPtr(-3) });
        }
        protected override void WndProc(ref Message m) {
            if ((uint)m.Msg == message) { open(); m.Result = new IntPtr(1); return; }
            if ((uint)m.Msg == stateMessage) { changed(); m.Result = new IntPtr(1); return; }
            base.WndProc(ref m);
        }
        public void Dispose() { DestroyHandle(); }
    }
}
