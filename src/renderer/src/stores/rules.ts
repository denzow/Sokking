import { create } from 'zustand'
import type { Rule, RuleInput } from '../../../shared/rules'

/** Renderer mirror of the GitHub rules; main owns them. */
interface RulesState {
  rules: Rule[]
  loaded: boolean
  error: string | null
  /** Rule ids whose manual check is in progress. */
  checking: number[]
  refresh: () => Promise<void>
  add: (input: RuleInput) => Promise<Rule | null>
  update: (id: number, input: RuleInput) => Promise<Rule | null>
  remove: (id: number) => Promise<boolean>
  /** Runs the search now; resolves to a one-line summary for the UI. */
  check: (id: number) => Promise<string>
  clearError: () => void
}

export const useRulesStore = create<RulesState>((set, get) => ({
  rules: [],
  loaded: false,
  error: null,
  checking: [],

  refresh: async () => {
    set({ rules: await window.sokking.ruleList(), loaded: true })
  },

  add: async (input) => {
    const r = await window.sokking.ruleAdd(input)
    if (!r.ok) {
      set({ error: r.error })
      return null
    }
    set({ error: null })
    await get().refresh()
    return r.rule
  },

  update: async (id, input) => {
    const r = await window.sokking.ruleUpdate(id, input)
    if (!r.ok) {
      set({ error: r.error })
      return null
    }
    set({ error: null })
    await get().refresh()
    return r.rule
  },

  remove: async (id) => {
    const r = await window.sokking.ruleRemove(id)
    if (!r.ok) {
      set({ error: r.error })
      return false
    }
    await get().refresh()
    return true
  },

  check: async (id) => {
    set((s) => ({ checking: [...s.checking, id] }))
    try {
      const r = await window.sokking.ruleCheck(id)
      await get().refresh()
      if (!r.ok) return `失敗: ${r.error}`
      return `${r.found} 件中 ${r.imported} 件を取り込みました`
    } finally {
      set((s) => ({ checking: s.checking.filter((x) => x !== id) }))
    }
  },

  clearError: () => set({ error: null })
}))
