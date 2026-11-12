// SPDX-License-Identifier: MIT
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
namespace ZoteroBatchCitations {
    internal static class RibbonImages {
        static readonly Dictionary<string,object> images=new Dictionary<string,object>();
        [StructLayout(LayoutKind.Sequential)]
        sealed class PictureDescriptor {
            public int size=Marshal.SizeOf(typeof(PictureDescriptor));
            public int type=3; // PICTYPE_ICON keeps the native transparency mask.
            public IntPtr icon;
            public IntPtr reserved;
        }
        [DllImport("oleaut32.dll",PreserveSig=false)]
        static extern void OleCreatePictureIndirect([In] PictureDescriptor descriptor,ref Guid iid,[MarshalAs(UnmanagedType.Bool)] bool own,[MarshalAs(UnmanagedType.Interface)] out object picture);
        [DllImport("user32.dll")]
        static extern bool DestroyIcon(IntPtr icon);
        static object Picture(Bitmap bitmap) {
            var descriptor=new PictureDescriptor { icon=bitmap.GetHicon() };
            var iid=new Guid("7BF80981-BF32-101A-8BBB-00AA00300CAB");
            try {
                object picture; OleCreatePictureIndirect(descriptor,ref iid,true,out picture);
                return picture; // OLE owns and releases this icon with the cached picture.
            } catch { DestroyIcon(descriptor.icon); throw; }
        }
        static void Artwork(Graphics g,string id) {
            // Retain the generated transparent originals as embedded resources.
            // Fixed alpha bounds avoid scanning large bitmaps on Word's UI thread.
            var bounds=id=="batch"?new Rectangle(289,324,708,615):new Rectangle(338,282,554,686);
            using(var stream=typeof(RibbonImages).Assembly.GetManifestResourceStream("ZoteroBatchCitations.Icons."+id)) {
                if(stream==null)throw new InvalidOperationException("Ribbon icon resource is missing: "+id);
                using(var source=new Bitmap(stream)) {
                    float scale=28f/Math.Max(bounds.Width,bounds.Height);
                    float width=bounds.Width*scale,height=bounds.Height*scale;
                    g.InterpolationMode=InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode=PixelOffsetMode.HighQuality;
                    g.DrawImage(source,new RectangleF((32-width)/2,(32-height)/2,width,height),bounds,GraphicsUnit.Pixel);
                }
            }
        }
        public static object Get(string id) {
            if(images.ContainsKey(id))return images[id];
            int size=id=="inline"||id=="superscript"?16:32;
            using(var bitmap=new Bitmap(size,size))using(var g=Graphics.FromImage(bitmap)) {
                g.Clear(Color.Transparent);g.SmoothingMode=SmoothingMode.AntiAlias;
                g.TextRenderingHint=System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                using(var ink=new SolidBrush(Color.FromArgb(55,90,175))) {
                    if(size==16) {
                        // Draw menu glyphs at their native size, rather than shrinking
                        // a 32px image into text too small to read on a 16px menu.
                        using(var menuFont=new Font("Segoe UI",12,FontStyle.Regular,GraphicsUnit.Pixel)) {
                            if(id=="inline")g.DrawString("X2",menuFont,ink,0,1,StringFormat.GenericTypographic);
                            else {
                                g.DrawString("X",menuFont,ink,0,4,StringFormat.GenericTypographic);
                                using(var number=new Font("Segoe UI",8,FontStyle.Regular,GraphicsUnit.Pixel))g.DrawString("2",number,ink,8,0,StringFormat.GenericTypographic);
                            }
                        }
                    } else Artwork(g,id);
                }

                images[id]=Picture(bitmap);
            }
            return images[id];
        }
    }
}
