using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

internal static class TrayHelper
{
    private static string signalPath;

    private static void Send(string action)
    {
        // Publish atomically: the app must never read half a command.
        string temporary = signalPath + ".tmp";
        File.WriteAllText(temporary, action);
        if (File.Exists(signalPath)) File.Delete(signalPath);
        File.Move(temporary, signalPath);
    }

    private static void OnMouseClick(MouseButtons button)
    {
        if (button == MouseButtons.Left) Send("show");
    }

    private static int SelfTest()
    {
        signalPath = Path.Combine(Path.GetTempPath(), "timering-tray-test-" + Guid.NewGuid() + ".signal");
        try
        {
            OnMouseClick(MouseButtons.Right);
            if (File.Exists(signalPath)) return 1;
            OnMouseClick(MouseButtons.Left);
            if (File.ReadAllText(signalPath) != "show") return 2;
            Send("today");
            if (File.ReadAllText(signalPath) != "today") return 3;
            Send("quit");
            return File.ReadAllText(signalPath) == "quit" ? 0 : 4;
        }
        finally
        {
            if (File.Exists(signalPath)) File.Delete(signalPath);
            if (File.Exists(signalPath + ".tmp")) File.Delete(signalPath + ".tmp");
        }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--self-test") return SelfTest();
        if (args.Length != 3) return 1;
        signalPath = args[1];
        try
        {
            using (Process parent = Process.GetProcessById(int.Parse(args[0])))
            using (Bitmap bitmap = new Bitmap(args[2]))
            using (Icon temporaryIcon = Icon.FromHandle(bitmap.GetHicon()))
            using (Icon icon = (Icon)temporaryIcon.Clone())
            using (NotifyIcon tray = new NotifyIcon())
            using (ContextMenuStrip menu = new ContextMenuStrip())
            using (Timer timer = new Timer())
            {
                // GetHicon owns an unmanaged handle; the cloned icon owns its copy.
                DestroyIcon(temporaryIcon.Handle);
                menu.Items.Add("显示时环", null, delegate { Send("show"); });
                menu.Items.Add("记录今天", null, delegate { Send("today"); });
                menu.Items.Add(new ToolStripSeparator());
                menu.Items.Add("退出", null, delegate { Send("quit"); });
                tray.Text = "时环 · 单击打开";
                tray.Icon = icon;
                tray.ContextMenuStrip = menu;
                tray.MouseClick += delegate(object sender, MouseEventArgs e) { OnMouseClick(e.Button); };
                timer.Interval = 400;
                timer.Tick += delegate { if (parent.HasExited) Application.ExitThread(); };
                timer.Start();
                tray.Visible = true;
                try { Application.Run(); }
                finally { tray.Visible = false; }
            }
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr icon);
}
