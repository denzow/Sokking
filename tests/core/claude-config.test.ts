import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensureFolderTrusted } from '../../src/core/claude-config'

describe('ensureFolderTrusted', () => {
  it('adds the trust flag without disturbing the rest of the config', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sokking-cc-'))
    const file = path.join(dir, 'claude.json')
    fs.writeFileSync(
      file,
      JSON.stringify({ theme: 'dark', projects: { '/a': { allowedTools: ['Bash'], hasTrustDialogAccepted: true } } })
    )
    expect(ensureFolderTrusted('/b', file)).toBe(true)
    expect(ensureFolderTrusted('/b', file)).toBe(false)
    expect(ensureFolderTrusted('/a', file)).toBe(false)
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(saved.theme).toBe('dark')
    expect(saved.projects['/a']).toEqual({ allowedTools: ['Bash'], hasTrustDialogAccepted: true })
    expect(saved.projects['/b']).toEqual({ hasTrustDialogAccepted: true })
    expect(fs.readdirSync(dir)).toEqual(['claude.json'])
  })

  it('creates the file when there is none', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sokking-cc-'))
    const file = path.join(dir, 'claude.json')
    expect(ensureFolderTrusted('/x', file)).toBe(true)
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).projects['/x'].hasTrustDialogAccepted).toBe(true)
  })
})
