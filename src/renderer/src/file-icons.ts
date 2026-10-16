import manifest from 'material-icon-theme/dist/material-icons.json'

/**
 * Resolves a directory entry to a material-icon-theme SVG URL, the way the
 * VS Code extension does: exact file name → longest matching (multi-dot)
 * extension → generic file; folders by name → generic folder.
 */

// The manifest's maps are huge object literals — index them as plain records.
const fileNames = manifest.fileNames as Record<string, string | undefined>
const fileExtensions = manifest.fileExtensions as Record<string, string | undefined>
const folderNames = manifest.folderNames as Record<string, string | undefined>
const folderNamesExpanded = manifest.folderNamesExpanded as Record<string, string | undefined>

// Bundle every icon and key it by name; eager so lookups stay synchronous.
const iconUrls = import.meta.glob('../../../node_modules/material-icon-theme/icons/*.svg', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

const urlByIconName = new Map<string, string>()
for (const [path, url] of Object.entries(iconUrls)) {
  urlByIconName.set(path.slice(path.lastIndexOf('/') + 1, -'.svg'.length), url)
}

export function fileIconUrl(name: string, isDir: boolean, expanded = false): string {
  const lower = name.toLowerCase()
  let icon: string | undefined
  let fallback: string
  if (isDir) {
    icon = expanded ? folderNamesExpanded[lower] : folderNames[lower]
    fallback = expanded ? manifest.folderExpanded : manifest.folder
  } else {
    icon = fileNames[lower]
    // "spec.ts" beats "ts": try the longest dotted suffix first.
    const parts = lower.split('.')
    for (let i = 1; icon === undefined && i < parts.length; i++) {
      icon = fileExtensions[parts.slice(i).join('.')]
    }
    fallback = manifest.file
  }
  return (
    urlByIconName.get(icon ?? fallback) ??
    urlByIconName.get(fallback) ??
    urlByIconName.get(manifest.file)!
  )
}
