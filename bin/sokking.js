#!/usr/bin/env node
// Command-line client for a running sokking instance.
//
//   sokking add <title> [--body <text> | --body -] [--workdir <dir>]
//               [--source <manual|notification|github|schedule>] [--ref <url>] [--app <name>]
//   sokking list [--status <inbox|running|review|done|archived>] [--json]
//   sokking ping
//
// Talks to the app over its control socket (JSON lines on a Unix socket).
// The socket lives in the app's config dir; --dev targets a `npm run dev`
// instance, SOKKING_CONTROL_SOCKET overrides the path entirely.
'use strict'

const net = require('net')
const os = require('os')
const path = require('path')

function socketPath(dev) {
  if (process.env.SOKKING_CONTROL_SOCKET) return process.env.SOKKING_CONTROL_SOCKET
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(configHome, dev ? 'sokking-dev' : 'sokking', 'control.sock')
}

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json' || arg === '--dev') {
      flags[arg.slice(2)] = true
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const value = argv[i + 1]
      if (value === undefined) throw new Error(`--${key} に値がありません`)
      flags[key] = value
      i++
    } else {
      positional.push(arg)
    }
  }
  return { positional, flags }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (data += chunk))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

function request(sock, req) {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(sock)
    let buf = ''
    conn.setEncoding('utf8')
    conn.on('connect', () => conn.write(JSON.stringify(req) + '\n'))
    conn.on('data', (chunk) => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl === -1) return
      conn.end()
      try {
        resolve(JSON.parse(buf.slice(0, nl)))
      } catch (e) {
        reject(e)
      }
    })
    conn.on('error', (err) => {
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
        reject(new Error(`sokking が起動していません (${sock})`))
      } else {
        reject(err)
      }
    })
  })
}

function usage() {
  console.error(
    [
      '使い方:',
      '  sokking add <title> [--body <text>|-] [--workdir <dir>] [--source <src>] [--ref <url>] [--app <name>]',
      '  sokking list [--status <status>] [--json]',
      '  sokking ping',
      'オプション: --dev (開発インスタンスに接続)'
    ].join('\n')
  )
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2))
  const [command, ...rest] = positional
  const sock = socketPath(Boolean(flags.dev))

  if (command === 'add') {
    const title = rest.join(' ').trim()
    if (!title) throw new Error('タイトルを指定してください')
    let body = flags.body || ''
    if (body === '-') body = await readStdin()
    const res = await request(sock, {
      op: 'task.add',
      title,
      body,
      workdir: flags.workdir || null,
      source: flags.source || 'manual',
      sourceRef: flags.ref || null,
      sourceApp: flags.app || null
    })
    if (!res.ok) throw new Error(res.error)
    if (flags.json) console.log(JSON.stringify(res.task))
    else console.log(`#${res.task.id} ${res.task.title}`)
    return
  }

  if (command === 'list') {
    const res = await request(sock, { op: 'task.list', status: flags.status || null })
    if (!res.ok) throw new Error(res.error)
    if (flags.json) {
      console.log(JSON.stringify(res.tasks, null, 2))
      return
    }
    for (const t of res.tasks) {
      const dir = t.workdir ? `  ${t.workdir}` : ''
      console.log(`#${t.id}\t${t.status}\t${t.source}\t${t.title}${dir}`)
    }
    return
  }

  if (command === 'ping') {
    const res = await request(sock, { op: 'ping' })
    if (!res.ok) throw new Error(res.error)
    console.log(`ok (${sock})`)
    return
  }

  usage()
  process.exit(command ? 2 : 0)
}

main().catch((err) => {
  console.error(`error: ${err.message}`)
  process.exit(1)
})
