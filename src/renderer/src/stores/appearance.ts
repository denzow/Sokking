import { create } from 'zustand'
import type { ITheme } from '@xterm/xterm'

// Terminal + app-chrome appearance: color scheme and font, persisted to
// localStorage and applied live to every terminal and the UI's CSS variables.

export interface UiPalette {
  bg: string
  bgAlt: string
  bgHover: string
  border: string
  text: string
  textDim: string
  accent: string
  red: string
  green: string
  yellow: string
}

export interface Theme {
  key: string
  name: string
  ui: UiPalette
  terminal: ITheme
}

export const THEMES: Theme[] = [
  {
    key: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    ui: {
      bg: '#1e1e2e',
      bgAlt: '#181825',
      bgHover: '#313244',
      border: '#45475a',
      text: '#cdd6f4',
      textDim: '#7f849c',
      accent: '#89b4fa',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af'
    },
    terminal: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      selectionBackground: '#585b70',
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#f5c2e7',
      cyan: '#94e2d5',
      white: '#bac2de',
      brightBlack: '#585b70',
      brightRed: '#f38ba8',
      brightGreen: '#a6e3a1',
      brightYellow: '#f9e2af',
      brightBlue: '#89b4fa',
      brightMagenta: '#f5c2e7',
      brightCyan: '#94e2d5',
      brightWhite: '#a6adc8'
    }
  },
  {
    key: 'dracula',
    name: 'Dracula',
    ui: {
      bg: '#282a36',
      bgAlt: '#21222c',
      bgHover: '#44475a',
      border: '#44475a',
      text: '#f8f8f2',
      textDim: '#6272a4',
      accent: '#bd93f9',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c'
    },
    terminal: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      selectionBackground: '#44475a',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff'
    }
  },
  {
    key: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    ui: {
      bg: '#282828',
      bgAlt: '#1d2021',
      bgHover: '#3c3836',
      border: '#504945',
      text: '#ebdbb2',
      textDim: '#a89984',
      accent: '#fabd2f',
      red: '#fb4934',
      green: '#b8bb26',
      yellow: '#d79921'
    },
    terminal: {
      background: '#282828',
      foreground: '#ebdbb2',
      cursor: '#ebdbb2',
      selectionBackground: '#504945',
      black: '#282828',
      red: '#cc241d',
      green: '#98971a',
      yellow: '#d79921',
      blue: '#458588',
      magenta: '#b16286',
      cyan: '#689d6a',
      white: '#a89984',
      brightBlack: '#928374',
      brightRed: '#fb4934',
      brightGreen: '#b8bb26',
      brightYellow: '#fabd2f',
      brightBlue: '#83a598',
      brightMagenta: '#d3869b',
      brightCyan: '#8ec07c',
      brightWhite: '#ebdbb2'
    }
  },
  {
    key: 'solarized-light',
    name: 'Solarized Light',
    ui: {
      bg: '#fdf6e3',
      bgAlt: '#eee8d5',
      bgHover: '#e4dcc4',
      border: '#d8cfb0',
      text: '#586e75',
      textDim: '#93a1a1',
      accent: '#268bd2',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900'
    },
    terminal: {
      background: '#fdf6e3',
      foreground: '#657b83',
      cursor: '#586e75',
      selectionBackground: '#eee8d5',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#002b36',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3'
    }
  }
]

export const FONT_FAMILIES: string[] = [
  'monospace',
  'DejaVu Sans Mono',
  'Ubuntu Mono',
  'Liberation Mono',
  'Fira Code',
  'JetBrains Mono',
  'Cascadia Code',
  'Source Code Pro'
]

export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 32

const DEFAULT_THEME_KEY = 'catppuccin-mocha'
const STORAGE_KEY = 'sokking.appearance'

interface Persisted {
  themeKey: string
  fontFamily: string
  fontSize: number
}

function load(): Persisted {
  const fallback: Persisted = { themeKey: DEFAULT_THEME_KEY, fontFamily: 'monospace', fontSize: 14 }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const p = JSON.parse(raw) as Partial<Persisted>
    return {
      themeKey: THEMES.some((t) => t.key === p.themeKey) ? (p.themeKey as string) : fallback.themeKey,
      fontFamily: typeof p.fontFamily === 'string' ? p.fontFamily : fallback.fontFamily,
      fontSize: clampFontSize(typeof p.fontSize === 'number' ? p.fontSize : fallback.fontSize)
    }
  } catch {
    return fallback
  }
}

function persist(p: Persisted): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    // storage unavailable — keep in-memory values
  }
}

export function clampFontSize(n: number): number {
  if (Number.isNaN(n)) return 14
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(n)))
}

export function themeByKey(key: string): Theme {
  return THEMES.find((t) => t.key === key) ?? THEMES[0]
}

/** The full font-family string handed to xterm (with a generic fallback). */
export function resolveFontFamily(fontFamily: string): string {
  return fontFamily === 'monospace' ? 'monospace' : `"${fontFamily}", monospace`
}

/** Push a theme's UI palette into the document's CSS variables. */
export function applyUiPalette(palette: UiPalette): void {
  const root = document.documentElement
  root.style.setProperty('--bg', palette.bg)
  root.style.setProperty('--bg-alt', palette.bgAlt)
  root.style.setProperty('--bg-hover', palette.bgHover)
  root.style.setProperty('--border', palette.border)
  root.style.setProperty('--text', palette.text)
  root.style.setProperty('--text-dim', palette.textDim)
  root.style.setProperty('--accent', palette.accent)
  root.style.setProperty('--red', palette.red)
  root.style.setProperty('--green', palette.green)
  root.style.setProperty('--yellow', palette.yellow)
}

/** Push the terminal font into the UI's CSS variable — the app chrome shares
    the terminal's monospace identity. */
export function applyUiFont(fontFamily: string): void {
  document.documentElement.style.setProperty('--font-mono', resolveFontFamily(fontFamily))
}

interface AppearanceState extends Persisted {
  setTheme: (key: string) => void
  setFontFamily: (fontFamily: string) => void
  setFontSize: (size: number) => void
  currentTheme: () => Theme
}

const initial = load()
// Apply the persisted palette immediately so the UI doesn't flash the default.
applyUiPalette(themeByKey(initial.themeKey).ui)
applyUiFont(initial.fontFamily)

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  ...initial,

  setTheme: (key) => {
    const themeKey = themeByKey(key).key
    applyUiPalette(themeByKey(themeKey).ui)
    set((s) => {
      persist({ themeKey, fontFamily: s.fontFamily, fontSize: s.fontSize })
      return { themeKey }
    })
  },

  setFontFamily: (fontFamily) => {
    applyUiFont(fontFamily)
    set((s) => {
      persist({ themeKey: s.themeKey, fontFamily, fontSize: s.fontSize })
      return { fontFamily }
    })
  },

  setFontSize: (size) => {
    const fontSize = clampFontSize(size)
    set((s) => {
      persist({ themeKey: s.themeKey, fontFamily: s.fontFamily, fontSize })
      return { fontSize }
    })
  },

  currentTheme: () => themeByKey(get().themeKey)
}))
