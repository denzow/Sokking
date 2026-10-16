import { execFile, execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface AppCandidate {
  /** Human-readable application name (localized when available). */
  name: string
  /** Absolute path to the .desktop file, usable with `gio launch`. */
  desktopFile: string
  /** Absolute path to a PNG icon Electron can render in a menu, or null. */
  icon: string | null
}

/** Directories searched for .desktop files, in priority order. */
const APP_DIRS = [
  path.join(os.homedir(), '.local/share/applications'),
  '/usr/local/share/applications',
  '/usr/share/applications',
  '/var/lib/snapd/desktop/applications',
  '/var/lib/flatpak/exports/share/applications',
  path.join(os.homedir(), '.local/share/flatpak/exports/share/applications')
]

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 3000 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

function findDesktopFile(desktopId: string): string | null {
  for (const dir of APP_DIRS) {
    const p = path.join(dir, desktopId)
    try {
      fs.accessSync(p, fs.constants.R_OK)
      return p
    } catch {
      // keep looking
    }
  }
  return null
}

interface DesktopEntry {
  /** Localized when available, plain Name otherwise. */
  name: string | null
  type: string | null
  /** Icon= value: an absolute path or a freedesktop icon-theme name. */
  icon: string | null
  /** NoDisplay or Hidden — not meant to be shown in app lists. */
  hidden: boolean
}

/** Minimal [Desktop Entry] parser (Name/Name[lang]/Type/Icon/NoDisplay/Hidden). */
function parseDesktopEntry(desktopFile: string, locale: string): DesktopEntry | null {
  let text: string
  try {
    text = fs.readFileSync(desktopFile, 'utf8')
  } catch {
    return null
  }
  const lang = locale.split(/[-_.@]/)[0]
  let inEntry = false
  let name: string | null = null
  let localized: string | null = null
  let type: string | null = null
  let icon: string | null = null
  let hidden = false
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[')) {
      inEntry = trimmed === '[Desktop Entry]'
      continue
    }
    if (!inEntry) continue
    if (trimmed.startsWith(`Name[${lang}]=`)) localized = trimmed.slice(`Name[${lang}]=`.length)
    else if (trimmed.startsWith('Name=')) name = trimmed.slice('Name='.length)
    else if (trimmed.startsWith('Type=')) type = trimmed.slice('Type='.length)
    else if (trimmed.startsWith('Icon=')) icon = trimmed.slice('Icon='.length)
    else if (trimmed === 'NoDisplay=true' || trimmed === 'Hidden=true') hidden = true
  }
  return { name: localized ?? name, type, icon, hidden }
}

/** Icon theme search order: the user's current theme, then Ubuntu/GNOME defaults. */
let iconThemesCache: string[] | null = null
function iconThemes(): string[] {
  if (!iconThemesCache) {
    let current = ''
    try {
      current = execFileSync('gsettings', ['get', 'org.gnome.desktop.interface', 'icon-theme'], {
        timeout: 2000
      })
        .toString()
        .trim()
        .replace(/^'|'$/g, '')
    } catch {
      // non-GNOME session — fall back to the defaults below
    }
    iconThemesCache = [...new Set([current, 'Yaru', 'hicolor'].filter(Boolean))]
  }
  return iconThemesCache
}

const ICON_ROOTS = [path.join(os.homedir(), '.local/share/icons'), '/usr/share/icons']
/** Menu icons are tiny; prefer sizes that downscale well. */
const ICON_SIZES = ['48x48', '64x64', '32x32', '128x128', '96x96', '256x256', '24x24', '16x16', '512x512', '256x256@2x', '48x48@2x', '32x32@2x']
/** Theme subdirectories worth checking (some Icon= names are not apps/). */
const ICON_CONTEXTS = ['apps', 'categories', 'legacy', 'devices']

/**
 * Resolve an Icon= value to a PNG file (Electron menus can't render SVG).
 * Simplified freedesktop icon lookup: absolute paths as-is, otherwise the
 * theme dirs and pixmaps.
 */
function findIconPng(icon: string | null): string | null {
  if (!icon) return null
  if (path.isAbsolute(icon)) {
    return icon.endsWith('.png') && fs.existsSync(icon) ? icon : null
  }
  const name = icon.replace(/\.(png|svg|xpm)$/, '')
  for (const root of ICON_ROOTS) {
    for (const theme of iconThemes()) {
      for (const context of ICON_CONTEXTS) {
        for (const size of ICON_SIZES) {
          const p = path.join(root, theme, size, context, `${name}.png`)
          if (fs.existsSync(p)) return p
        }
      }
    }
  }
  const pixmap = `/usr/share/pixmaps/${name}.png`
  return fs.existsSync(pixmap) ? pixmap : null
}

/** Directories holding the shared-mime-info subclass maps. */
const MIME_DIRS = [path.join(os.homedir(), '.local/share/mime'), '/usr/share/mime']

/**
 * The MIME type plus its ancestors from shared-mime-info's `subclasses`
 * files (e.g. application/json → application/json5 → text/javascript), so
 * handlers of more generic types are offered too — this is GIO's fallback
 * behavior. Any text/* ultimately falls back to text/plain.
 */
function mimeChain(mime: string): string[] {
  const parents = new Map<string, string[]>()
  for (const dir of MIME_DIRS) {
    let text: string
    try {
      text = fs.readFileSync(path.join(dir, 'subclasses'), 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      const [child, parent] = line.trim().split(/\s+/)
      if (!child || !parent) continue
      const list = parents.get(child) ?? []
      if (!list.includes(parent)) list.push(parent)
      parents.set(child, list)
    }
  }
  const chain = [mime]
  const seen = new Set(chain)
  for (let i = 0; i < chain.length; i++) {
    for (const parent of parents.get(chain[i]) ?? []) {
      if (!seen.has(parent)) {
        seen.add(parent)
        chain.push(parent)
      }
    }
  }
  if (chain.some((m) => m.startsWith('text/')) && !seen.has('text/plain')) {
    chain.push('text/plain')
  }
  return chain
}

/**
 * Every MIME type known to shared-mime-info (each `<type>/<subtype>.xml`
 * under the mime dirs), plus a `<type>/*` wildcard per media type, sorted.
 * Feeds the settings UI's pattern completion.
 */
export function listMimeTypes(): string[] {
  const types = new Set<string>()
  for (const dir of MIME_DIRS) {
    let mediaTypes: fs.Dirent[]
    try {
      mediaTypes = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const media of mediaTypes) {
      // Real media types are directories; `packages` holds definition
      // sources, not types.
      if (!media.isDirectory() || media.name === 'packages') continue
      let files: string[]
      try {
        files = fs.readdirSync(path.join(dir, media.name))
      } catch {
        continue
      }
      for (const file of files) {
        if (!file.endsWith('.xml')) continue
        types.add(`${media.name}/${file.slice(0, -4)}`)
        types.add(`${media.name}/*`)
      }
    }
  }
  // "*" sorts before letters, so each media type's wildcard leads its group.
  return [...types].sort()
}

/**
 * The target's MIME type plus its ancestors, most specific first; [] when
 * xdg-mime can't identify the file.
 */
export async function mimeTypesFor(target: string): Promise<string[]> {
  const mime = (await run('xdg-mime', ['query', 'filetype', target])).trim()
  return mime ? mimeChain(mime) : []
}

/**
 * Applications registered for the target's MIME type or one of its ancestor
 * types (the exact type's handlers come first). Uses xdg-mime + gio, which
 * sokking can rely on (the app targets Linux desktops).
 */
export async function listAppsFor(target: string, locale: string): Promise<AppCandidate[]> {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const m of await mimeTypesFor(target)) {
    let out: string
    try {
      out = await run('gio', ['mime', m])
    } catch {
      continue // no handlers for this type
    }
    // `gio mime` output is localized; the .desktop ids are the stable part.
    for (const line of out.split('\n')) {
      const token = line.trim().split(/[\s:]+/).pop() ?? ''
      if (token.endsWith('.desktop') && !seen.has(token)) {
        seen.add(token)
        ids.push(token)
      }
    }
  }
  const apps: AppCandidate[] = []
  for (const id of ids) {
    const desktopFile = findDesktopFile(id)
    if (!desktopFile) continue
    const entry = parseDesktopEntry(desktopFile, locale)
    apps.push({
      name: entry?.name ?? id.replace(/\.desktop$/, ''),
      desktopFile,
      icon: findIconPng(entry?.icon ?? null)
    })
  }
  return apps
}

/**
 * Every launchable installed application (Type=Application, not
 * NoDisplay/Hidden), name-sorted — the "all applications" escape hatch for
 * apps that don't register the file's MIME type (e.g. VS Code for text).
 */
export function listAllApps(locale: string): AppCandidate[] {
  const seen = new Set<string>()
  const apps: AppCandidate[] = []
  for (const dir of APP_DIRS) {
    let names: string[]
    try {
      names = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const file of names) {
      if (!file.endsWith('.desktop') || seen.has(file)) continue
      seen.add(file) // earlier dirs take priority, matching findDesktopFile
      const desktopFile = path.join(dir, file)
      const entry = parseDesktopEntry(desktopFile, locale)
      if (!entry || entry.type !== 'Application' || entry.hidden || !entry.name) continue
      apps.push({ name: entry.name, desktopFile, icon: findIconPng(entry.icon) })
    }
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name, locale))
}

/** Open the target with the given application, detached from sokking. */
export function launchWith(desktopFile: string, target: string): void {
  const child = spawn('gio', ['launch', desktopFile, target], {
    detached: true,
    stdio: 'ignore'
  })
  child.on('error', () => {
    // gio missing — nothing sensible to do beyond not crashing
  })
  child.unref()
}
