#!/usr/bin/env node
// Emit a fake Claude Code hook event into a running sokking instance, for
// exercising the tab status / run lifecycle without a real session.
//
//   scripts/hook-emit.js <tabId> <hookEventName> [--type permission_prompt|idle_prompt]
//                        [--message text] [--session id] [--dev]
//
// The socket is per instance (hook-<pid>.sock under the config dir); the
// newest one is used unless SOKKING_SOCKET names it.
'use strict'

const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')

function parse(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dev') flags.dev = true
    else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i]
    else positional.push(a)
  }
  return { positional, flags }
}

function socketPath(dev) {
  if (process.env.SOKKING_SOCKET) return process.env.SOKKING_SOCKET
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  const dir = path.join(configHome, dev ? 'sokking-dev' : 'sokking')
  const socks = fs
    .readdirSync(dir)
    .filter((n) => /^hook-\d+\.sock$/.test(n))
    .map((n) => ({ n, m: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
  if (!socks.length) throw new Error(`hook socket not found in ${dir}`)
  return path.join(dir, socks[0].n)
}

const { positional, flags } = parse(process.argv.slice(2))
const [tabId, hookEventName] = positional
if (!tabId || !hookEventName) {
  console.error('usage: hook-emit.js <tabId> <hookEventName> [--type t] [--message m] [--session s] [--dev]')
  process.exit(2)
}
const payload = {
  tabId,
  hookEventName,
  notificationType: flags.type || '',
  message: flags.message || '',
  sessionId: flags.session || ''
}
const sock = socketPath(Boolean(flags.dev))
const conn = net.createConnection(sock, () => {
  conn.end(JSON.stringify(payload) + '\n')
})
conn.on('error', (e) => {
  console.error(`error: ${e.message}`)
  process.exit(1)
})
conn.on('close', () => {
  console.log(`sent ${hookEventName} to ${tabId} via ${sock}`)
})
