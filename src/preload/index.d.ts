import type { SokkingApi } from './index'

declare global {
  interface Window {
    sokking: SokkingApi
  }
}

export {}
