#!/usr/bin/env node
// Drive the running dev app's renderer over the Chrome DevTools Protocol —
// a stand-in for a mouse while verifying UI changes from a terminal
// (no xdotool on a bare GNOME box).
//
// Start the app with a debugging port first:
//   npx electron-vite dev -- --no-sandbox --remote-debugging-port=9222
//
// Then:
//   scripts/ui-probe.js shot out.png          # screenshot of the renderer
//   scripts/ui-probe.js click '.sidebar-nav-item'
//   scripts/ui-probe.js type '.task-form-title' 'text'   # focus + set value (React-aware)
//   scripts/ui-probe.js eval 'document.title'
//   scripts/ui-probe.js key Enter             # key press on the focused element
//
// Only the first page target (the app window) is used.
'use strict'

const fs = require('fs')

const PORT = process.env.SOKKING_CDP_PORT || '9222'

async function pageTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  const targets = await res.json()
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) throw new Error('page target not found')
  return page
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    })
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve)
      ws.addEventListener('error', reject)
    })
    return new Cdp(ws)
  }

  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    }
    return r.result.value
  }

  close() {
    this.ws.close()
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const [command, ...args] = process.argv.slice(2)
  const page = await pageTarget()
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl)
  try {
    switch (command) {
      case 'shot': {
        const file = args[0] || 'shot.png'
        const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'))
        console.log(file)
        break
      }
      case 'click': {
        const selector = args[0]
        const ok = await cdp.evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          el.scrollIntoView({ block: 'nearest' });
          el.click();
          return true;
        })()`)
        if (!ok) throw new Error(`not found: ${selector}`)
        await sleep(150)
        console.log('clicked', selector)
        break
      }
      case 'type': {
        const [selector, text] = args
        // React tracks the value through the native setter; dispatching an
        // input event afterwards is what makes a controlled input notice.
        const ok = await cdp.evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          el.focus();
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(text)});
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`)
        if (!ok) throw new Error(`not found: ${selector}`)
        await sleep(100)
        console.log('typed into', selector)
        break
      }
      case 'key': {
        const key = args[0]
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : 0 })
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : 0 })
        await sleep(100)
        console.log('key', key)
        break
      }
      case 'eval': {
        const value = await cdp.evaluate(args[0])
        console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
        break
      }
      default:
        console.error('usage: ui-probe.js shot|click|type|key|eval ...')
        process.exit(2)
    }
  } finally {
    cdp.close()
  }
}

main().then(
  // The CDP socket's close handshake can stall while the renderer is busy
  // — don't let it hold the process open.
  () => process.exit(0),
  (err) => {
    console.error(`error: ${err.message}`)
    process.exit(1)
  }
)
