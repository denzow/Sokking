#!/usr/bin/env node
// Claude Code hook forwarder for sokking.
//
// Registered in ~/.claude/settings.json for the session-lifecycle hook events
// (SessionStart / SessionEnd / UserPromptSubmit / PreToolUse / Notification /
// Stop). Reads the hook payload from stdin and forwards a compact JSON line
// to the sokking Unix socket identified by $SOKKING_SOCKET, tagged with the
// originating tab via $SOKKING_TAB_ID.
//
// When Claude Code runs outside sokking these env vars are absent and the
// script exits 0 immediately, so it never interferes with other sessions.
'use strict'

const net = require('net')

const socketPath = process.env.SOKKING_SOCKET
const tabId = process.env.SOKKING_TAB_ID
if (!socketPath || !tabId) process.exit(0)

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  input += chunk
})
process.stdin.on('end', () => {
  let payload = {}
  try {
    payload = JSON.parse(input)
  } catch {
    // forward anyway with empty payload
  }
  const message = JSON.stringify({
    tabId,
    hookEventName: payload.hook_event_name || 'unknown',
    notificationType: payload.notification_type || '',
    message: payload.message || payload.last_assistant_message || '',
    sessionId: payload.session_id || ''
  })

  const conn = net.createConnection(socketPath, () => {
    conn.end(message + '\n')
  })
  conn.on('error', () => process.exit(0))
  conn.on('close', () => process.exit(0))
  // Never block Claude Code for long even if the socket hangs.
  setTimeout(() => process.exit(0), 1500)
})
