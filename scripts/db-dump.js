#!/usr/bin/env node
// Read-only peek at a sokking database from the terminal.
//
//   scripts/db-dump.js [--dev] [table]        # rows of one table (default: run)
'use strict'

const os = require('os')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const args = process.argv.slice(2)
const dev = args.includes('--dev')
const table = args.find((a) => !a.startsWith('--')) || 'run'
const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
const file = path.join(configHome, dev ? 'sokking-dev' : 'sokking', 'sokking.db')
const db = new DatabaseSync(file, { readOnly: true })
if (!/^[a-z_]+$/.test(table)) throw new Error('bad table name')
console.log(JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), null, 2))
