import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/core/db'
import { TaskRepository } from '../../src/core/tasks'
import { SettingsRepository } from '../../src/core/settings'
import {
  decide,
  FilterError,
  NotificationFilterRepository
} from '../../src/core/notification-filters'
import { NotificationLogRepository } from '../../src/core/notification-log'
import { Deduplicator, parseBusLine } from '../../src/core/notification-monitor'
import { NotificationSource, taskTitle } from '../../src/core/notification-source'
import { SETTING_NOTIFICATION_DEFAULT_ACTION } from '../../src/shared/notifications'

const NOTIFY_LINE =
  '{"type":"method_call","sender":":1.422","destination":":1.55","path":"/org/freedesktop/Notifications","interface":"org.freedesktop.Notifications","member":"Notify","payload":{"type":"susssasa{sv}i","data":["Slack",0,"","#general","<b>alice</b>: deploy &amp; verify",[],{"urgency":{"type":"y","data":1}},-1]}}'

const GTK_LINE =
  '{"type":"method_call","interface":"org.gtk.Notifications","member":"AddNotification","payload":{"type":"ssa{sv}","data":["com.slack.Slack","n1",{"title":{"type":"s","data":"DM"},"body":{"type":"s","data":"hello"}}]}}'

function setup() {
  const db = openDatabase(':memory:')
  const tasks = new TaskRepository(db)
  const settings = new SettingsRepository(db)
  const filters = new NotificationFilterRepository(db)
  const log = new NotificationLogRepository(db)
  const source = new NotificationSource(filters, log, settings, tasks)
  return { tasks, settings, filters, log, source }
}

describe('parseBusLine', () => {
  it('reads a freedesktop Notify call and strips markup', () => {
    const n = parseBusLine(NOTIFY_LINE, '2026-10-17T00:00:00.000Z')
    expect(n).toEqual({
      app: 'Slack',
      title: '#general',
      body: 'alice: deploy & verify',
      receivedAt: '2026-10-17T00:00:00.000Z'
    })
  })

  it('reads a GNOME AddNotification call', () => {
    const n = parseBusLine(GTK_LINE)
    expect(n).toMatchObject({ app: 'com.slack.Slack', title: 'DM', body: 'hello' })
  })

  it('ignores replies, other members and garbage', () => {
    expect(parseBusLine('not json')).toBeNull()
    expect(parseBusLine('{"type":"method_return"}')).toBeNull()
    expect(
      parseBusLine('{"type":"method_call","interface":"org.freedesktop.Notifications","member":"CloseNotification","payload":{"data":[1]}}')
    ).toBeNull()
  })
})

describe('Deduplicator', () => {
  it('drops an identical notification inside the window only', () => {
    const d = new Deduplicator(1000)
    const n = { app: 'a', title: 't', body: 'b', receivedAt: '' }
    expect(d.isDuplicate(n, 0)).toBe(false)
    expect(d.isDuplicate(n, 500)).toBe(true)
    expect(d.isDuplicate({ ...n, body: 'c' }, 500)).toBe(false)
    expect(d.isDuplicate(n, 2000)).toBe(false)
  })
})

describe('NotificationFilterRepository', () => {
  it('validates names, actions and patterns', () => {
    const { filters } = setup()
    expect(() => filters.add({ name: ' ', action: 'accept' })).toThrow(FilterError)
    // @ts-expect-error — deliberately invalid
    expect(() => filters.add({ name: 'x', action: 'drop' })).toThrow(FilterError)
    expect(() => filters.add({ name: 'x', action: 'accept', titlePattern: '(' })).toThrow(/要約/)
  })

  it('orders rules and reorders them', () => {
    const { filters } = setup()
    const a = filters.add({ name: 'a', action: 'ignore' })
    const b = filters.add({ name: 'b', action: 'accept' })
    const c = filters.add({ name: 'c', action: 'accept' })
    expect(filters.list().map((f) => f.name)).toEqual(['a', 'b', 'c'])
    filters.reorder([c.id, a.id])
    expect(filters.list().map((f) => f.name)).toEqual(['c', 'a', 'b'])
    filters.setEnabled(b.id, false)
    expect(filters.get(b.id)?.enabled).toBe(false)
    filters.remove(b.id)
    expect(filters.list()).toHaveLength(2)
    expect(() => filters.remove(b.id)).toThrow(FilterError)
  })
})

describe('decide', () => {
  it('takes the first enabled matching rule, else the default', () => {
    const { filters } = setup()
    filters.add({ name: 'mute bob', action: 'ignore', bodyPattern: '^bob:', enabled: false })
    filters.add({ name: 'slack general', action: 'accept', appPattern: '^slack$', titlePattern: 'general', workdir: '/w' })
    const n = { app: 'Slack', title: '#general', body: 'bob: hi', receivedAt: '' }
    const hit = decide(filters.list(), n, 'ignore')
    expect(hit.action).toBe('accept')
    expect(hit.filter?.name).toBe('slack general')
    const miss = decide(filters.list(), { ...n, app: 'Thunderbird' }, 'ignore')
    expect(miss).toEqual({ action: 'ignore', filter: null })
  })
})

describe('NotificationSource', () => {
  it('logs everything and creates tasks only for accepted notifications', () => {
    const { tasks, filters, log, source } = setup()
    filters.add({ name: 'slack', action: 'accept', appPattern: 'slack', workdir: '/w' })
    source.handle({ app: 'Slack', title: '#dev', body: 'fix the build', receivedAt: 'now' })
    source.handle({ app: 'Thunderbird', title: 'mail', body: 'newsletter', receivedAt: 'now' })
    source.handle({ app: 'Slack', title: '', body: '', receivedAt: 'now' })
    const created = tasks.list()
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      source: 'notification',
      sourceApp: 'Slack',
      title: '#dev: fix the build',
      workdir: '/w'
    })
    const entries = log.list()
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ app: 'Thunderbird', result: 'ignored', taskId: null })
    expect(entries[1]).toMatchObject({ app: 'Slack', result: 'accepted', taskId: created[0].id })
  })

  it('titles a task from the summary and the first body line', () => {
    expect(taskTitle({ app: '', title: '#dev', body: 'line one\nline two', receivedAt: '' })).toBe('#dev: line one')
    expect(taskTitle({ app: '', title: '', body: 'only body', receivedAt: '' })).toBe('only body')
    expect(taskTitle({ app: '', title: 'only summary', body: '  ', receivedAt: '' })).toBe('only summary')
    expect(taskTitle({ app: '', title: 't', body: 'x'.repeat(200), receivedAt: '' })).toHaveLength(120)
  })

  it('honours the default-action setting', () => {
    const { tasks, settings, source } = setup()
    settings.set(SETTING_NOTIFICATION_DEFAULT_ACTION, 'accept')
    source.handle({ app: 'X', title: 'hello', body: '', receivedAt: 'now' })
    expect(tasks.list()).toHaveLength(1)
  })

  it('prunes the log by age and count', () => {
    const { log } = setup()
    const old = new Date(Date.now() - 40 * 86400_000).toISOString()
    log.add({ app: 'a', title: 'old', body: '', receivedAt: old }, { result: 'ignored', matchedFilterId: null, taskId: null })
    for (let i = 0; i < 5; i++) {
      log.add({ app: 'a', title: `n${i}`, body: '', receivedAt: new Date().toISOString() }, { result: 'ignored', matchedFilterId: null, taskId: null })
    }
    expect(log.prune({ keepDays: 30, keepCount: 3 })).toBe(3)
    expect(log.list().map((e) => e.title)).toEqual(['n4', 'n3', 'n2'])
  })
})
