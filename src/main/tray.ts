import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'

/**
 * The resident face of the app: closing the window hides it, the tray
 * icon brings it back (left click or 表示) and is the one place to really
 * quit. Background work — notifications, rules, jobs — keeps running
 * while the window is hidden.
 */
export class AppTray {
  private tray: Tray | null = null
  /** Set once the user chose 終了 (or the OS asked the app to quit). */
  quitting = false

  constructor(
    private iconPath: string,
    private getWindow: () => BrowserWindow | null,
    private createWindow: () => void
  ) {}

  start(): void {
    const icon = nativeImage.createFromPath(this.iconPath).resize({ width: 22, height: 22 })
    this.tray = new Tray(icon)
    this.tray.setToolTip('sokking')
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '表示', click: () => this.show() },
        { type: 'separator' },
        {
          label: '終了',
          click: () => {
            this.quitting = true
            app.quit()
          }
        }
      ])
    )
    this.tray.on('click', () => this.toggle())
    app.on('before-quit', () => {
      this.quitting = true
    })
  }

  /** Hide instead of close unless the app is quitting. Returns true when hidden. */
  interceptClose(win: BrowserWindow): boolean {
    if (this.quitting) return false
    win.hide()
    return true
  }

  show(): void {
    const win = this.getWindow()
    if (!win) {
      this.createWindow()
      return
    }
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  toggle(): void {
    const win = this.getWindow()
    if (win && win.isVisible() && win.isFocused()) win.hide()
    else this.show()
  }

  stop(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
