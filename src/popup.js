/**
 * SmoothGPT — popup
 *
 * Polls the active tab's content script for live containment stats and renders
 * them. The Enabled toggle is persisted in `storage.local`; the content script
 * reacts to the change directly (no message round-trip needed).
 */

const ENGAGE_THRESHOLD = 30

const els = {
  status: document.getElementById("status"),
  total: document.getElementById("total"),
  contained: document.getElementById("contained"),
  rendered: document.getElementById("rendered"),
  toggle: document.getElementById("toggle"),
  hint: document.getElementById("hint"),
}

const setStatus = (label, kind) => {
  els.status.textContent = label
  els.status.dataset.kind = kind
}

const showInactive = (hint) => {
  setStatus("inactive", "off")
  els.total.textContent = "—"
  els.contained.textContent = "—"
  els.rendered.textContent = "—"
  els.hint.textContent = hint
}

const render = (stats) => {
  if (!stats) return showInactive("Open a ChatGPT tab to see live stats.")

  els.total.textContent = stats.total
  els.contained.textContent = stats.contained
  els.rendered.textContent = stats.rendered
  els.toggle.checked = stats.enabled

  if (!stats.enabled) {
    setStatus("off", "off")
    els.hint.textContent = "Containment disabled."
  } else if (stats.engaged) {
    setStatus("active", "on")
    els.hint.textContent = ""
  } else {
    setStatus("idle", "idle")
    els.hint.textContent = `Engages past ${ENGAGE_THRESHOLD} turns.`
  }
}

const activeTab = async () =>
  (await browser.tabs.query({ active: true, currentWindow: true }))[0]

const poll = async () => {
  const tab = await activeTab()
  if (!tab) return showInactive("No active tab.")
  try {
    render(await browser.tabs.sendMessage(tab.id, { type: "getStats" }))
  } catch {
    showInactive("Open a ChatGPT tab to see live stats.")
  }
}

els.toggle.addEventListener("change", (event) => {
  browser.storage.local.set({ enabled: event.target.checked })
})

const init = async () => {
  const stored = await browser.storage.local.get("enabled")
  els.toggle.checked = stored.enabled !== false
  poll()
}

init()
setInterval(poll, 1000)
