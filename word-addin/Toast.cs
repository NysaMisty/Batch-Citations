// SPDX-License-Identifier: MIT
using System;
using System.Drawing;
using System.Windows.Forms;

namespace ZoteroBatchCitations {
    internal sealed class Toast : Form {
        readonly Timer dismiss = new Timer { Interval = 4500 };
        protected override bool ShowWithoutActivation { get { return true; } }
        protected override CreateParams CreateParams {
            get { var p = base.CreateParams; p.ExStyle |= 0x08000000 | 0x80; return p; }
        }
        sealed class OwnerWindow : IWin32Window {
            public IntPtr Handle { get; private set; }
            public OwnerWindow(IntPtr handle) { Handle = handle; }
        }
        public Toast(IntPtr owner, string text, bool error) {
            FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            BackColor = SystemColors.Window; ForeColor = SystemColors.WindowText;
            Font = SystemFonts.MessageBoxFont; Padding = new Padding(16, 11, 16, 11);
            var label = new Label { Text = text, AutoSize = true, MaximumSize = new Size(580, 0), BackColor = Color.Transparent };
            Controls.Add(label); label.Location = new Point(16, 11);
            ClientSize = new Size(Math.Max(280, label.PreferredSize.Width + 32), label.PreferredSize.Height + 23);
            Paint += delegate(object sender, PaintEventArgs e) {
                using (var pen = new Pen(SystemColors.ControlDark)) e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
                using (var brush = new SolidBrush(error ? Color.Firebrick : SystemColors.Highlight)) e.Graphics.FillRectangle(brush, 0, 0, 3, Height);
            };
            var bounds = Screen.FromHandle(owner).WorkingArea;
            NativeRect rect;
            if (GetWindowRect(owner, out rect)) bounds = Rectangle.FromLTRB(rect.Left, rect.Top, rect.Right, rect.Bottom);
            Location = new Point(bounds.Left + Math.Max(0, (bounds.Width - Width) / 2), bounds.Top + 140);
            dismiss.Tick += delegate { dismiss.Stop(); Close(); };
            Show(new OwnerWindow(owner)); dismiss.Start();
        }
        [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
        struct NativeRect { public int Left, Top, Right, Bottom; }
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern bool GetWindowRect(IntPtr hwnd, out NativeRect rect);
        protected override void Dispose(bool disposing) { if (disposing) dismiss.Dispose(); base.Dispose(disposing); }
    }
}
