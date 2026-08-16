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
  // The accent goes on the fill, never in the text. As a text colour the
  // orange measures 3.48:1 on the background and the old "off" grey 3.19:1 —
  // both below AA, and the two states were separated by hue alone. As a badge
  // they differ by fill and border, which survives greyscale.
  els.status.classList.toggle("badge-accent", kind === "on")
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

// No receiver resolves undefined, which render() already treats as "not a ChatGPT tab".
const poll = async () =>
  render(await webext.sendToActiveTab({ type: "getStats" }))

els.toggle.addEventListener("change", (event) => {
  settings.set({ enabled: event.target.checked })
})

const init = async () => {
  els.toggle.checked = (await settings.get()).enabled
  poll()
}

init()
setInterval(poll, 1000)
