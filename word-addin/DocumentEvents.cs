// SPDX-License-Identifier: MIT
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Word = Microsoft.Office.Interop.Word;

namespace ZoteroBatchCitations {
    // Word has no general TextChanged event. Selection/activation and process-local
    // accessibility value/selection events invalidate the pending snapshot.
    internal sealed class DocumentEvents : IDisposable {
        readonly Word.ApplicationEvents4_Event source;
        readonly Action changed;
        readonly WinEvent callback;
        IntPtr valueHook, selectionHook, foregroundHook;
        delegate void WinEvent(IntPtr hook, uint evt, IntPtr hwnd, int objectID, int childID, uint thread, uint time);
        [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEvent handler, uint process, uint thread, uint flags);
        [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
        public DocumentEvents(object application, Action invalidate) {
            changed = invalidate; source = (Word.ApplicationEvents4_Event)application;
            source.WindowSelectionChange += Selection;
            source.WindowActivate += Activate; source.WindowDeactivate += Activate;
            source.DocumentChange += Change; source.DocumentBeforeSave += Save;
            callback = delegate { changed(); };
            uint process = (uint)Process.GetCurrentProcess().Id;
            valueHook = SetWinEventHook(0x800E, 0x800E, IntPtr.Zero, callback, process, 0, 0);
            selectionHook = SetWinEventHook(0x8014, 0x8014, IntPtr.Zero, callback, process, 0, 0);
            // Word's WindowActivate event tracks document windows, not every
            // return from another application. Check once when Word gains focus.
            foregroundHook = SetWinEventHook(0x0003, 0x0003, IntPtr.Zero, callback, process, 0, 0);
        }
        void Selection(Word.Selection selection) { changed(); }
        void Activate(Word.Document document, Word.Window window) { changed(); }
        void Change() { changed(); }
        void Save(Word.Document document, ref bool saveAsUI, ref bool cancel) { changed(); }
        public void Dispose() {
            if (valueHook != IntPtr.Zero) { UnhookWinEvent(valueHook); valueHook = IntPtr.Zero; }
            if (selectionHook != IntPtr.Zero) { UnhookWinEvent(selectionHook); selectionHook = IntPtr.Zero; }
            if (foregroundHook != IntPtr.Zero) { UnhookWinEvent(foregroundHook); foregroundHook = IntPtr.Zero; }
            try {
                source.WindowSelectionChange -= Selection;
                source.WindowActivate -= Activate; source.WindowDeactivate -= Activate;
                source.DocumentChange -= Change; source.DocumentBeforeSave -= Save;
            } catch (COMException) { }
        }
    }
}
