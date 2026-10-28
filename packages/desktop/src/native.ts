// Thin wrappers over the Tauri plugins. Outside Tauri (tests and a plain browser)
// each one falls back to the web platform or does nothing.
import { isTauri } from '@tauri-apps/api/core'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { openUrl } from '@tauri-apps/plugin-opener'

export function isDesktop(): boolean {
  return isTauri()
}

export async function copyText(text: string): Promise<void> {
  if (isDesktop()) await writeText(text)
  else await navigator.clipboard.writeText(text)
}

/** Asks for permission the first time; without permission it does nothing. */
export async function notify(title: string, body: string): Promise<void> {
  if (!isDesktop()) return
  const granted = (await isPermissionGranted()) || (await requestPermission()) === 'granted'
  if (granted) sendNotification({ title, body })
}

export async function openExternal(url: string): Promise<void> {
  if (isDesktop()) await openUrl(url)
  else window.open(url, '_blank', 'noopener')
}

/**
 * Delivers the link that opened the app, then every link opened while it runs.
 * Returns a function that stops listening.
 */
export async function onDeepLink(cb: (url: string) => void): Promise<() => void> {
  if (!isDesktop()) return () => {}
  for (const url of (await getCurrent()) ?? []) cb(url)
  return onOpenUrl((urls) => {
    for (const url of urls) cb(url)
  })
}
