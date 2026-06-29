/**
 * SmoothGPT — content script
 *
 * Applies `content-visibility: auto` to off-screen ChatGPT message turns so the
 * browser skips layout/paint for nodes outside the viewport, removing lag in long
 * conversations.
 *
 * Technique: CSS containment (content-visibility: auto + contain-intrinsic-size).
 * The browser keeps all nodes in the DOM — Ctrl+F, text selection, React
 * reconciliation, and code-block copy buttons all continue to work normally.
 *
 * Hot-loop budget: during streaming the MutationObserver fires every frame, so
 * the per-frame work is kept minimal — a WeakSet skips already-contained turns,
 * a fast-path early-exits when only the last turn changed, and the matched turn
 * selector is cached. See `refresh()`.
 *
 * The toolbar popup queries this script (runtime message `getStats`) for live
 * counts, and flips the `enabled` flag through `storage.local`.
 */

// ── Configuration ─────────────────────────────────────────────────────────────

/** Only engage virtualisation once a thread reaches this many turns. */
const ENGAGE_THRESHOLD = 30

/**
 * Fallback height for `contain-intrinsic-size` when the browser has not yet
 * measured a turn. 200 px is a conservative estimate; the `auto` prefix tells
 * the browser to use the last-measured size for turns already scrolled past,
 * which prevents layout thrash on re-entry.
 */
const INTRINSIC_SIZE = "auto 200px"

// ── Selectors (ChatGPT's DOM changes frequently — update as needed) ───────────

/**
 * Ordered list of selectors for individual message-turn containers.
 * The first selector that returns nodes wins.
 */
const TURN_SELECTORS = [
  // Current ChatGPT (2024–2026)
  'article[data-testid^="conversation-turn"]',
  // Fallback: role-annotated message wrappers
  "[data-message-author-role]",
  // Tailwind group class (older ChatGPT)
  ".group\\/conversation-turn",
]

/**
 * Selectors for the scroll container wrapping all turns.
 * Used as the root of the MutationObserver to avoid observing the entire page.
 */
const CONTAINER_SELECTORS = [
  // Newer ChatGPT (react-scroll-to-bottom library)
  "[class*='react-scroll-to-bottom']",
  // Thread container
  "#thread > div",
  // Fallback
  "main",
]

// ── Live state ───────────────────────────────────────────────────────────────

/** Whether containment is active. Mirrors `storage.local.enabled` (default on). */
let enabled = true

/** Latest snapshot, returned verbatim to the popup on `getStats`. */
let stats = {
  total: 0,
  contained: 0,
  rendered: 0,
  engaged: false,
  enabled: true,
}

/**
 * Turns we have already contained. A WeakSet (not a WeakMap) because we only
 * need membership — there is no per-turn value to store. Entries are released
 * automatically when ChatGPT removes a turn node, so this never leaks.
 */
const contained = new WeakSet()

// Last structural snapshot, so pure-streaming frames (same count, same last
// turn) can early-out without re-scanning every turn.
let lastTurnEl = null
let lastTotal = 0

// The turn selector that currently matches — avoids retrying the others each frame.
let activeTurnSelector = null

// ── DOM helpers ────────────────────────────────────────────────────────────────

const queryTurns = () => {
  if (activeTurnSelector) {
    const nodes = [...document.querySelectorAll(activeTurnSelector)]
    if (nodes.length > 0) return nodes
    activeTurnSelector = null // selector stopped matching — re-detect below
  }
  for (const sel of TURN_SELECTORS) {
    const nodes = [...document.querySelectorAll(sel)]
    if (nodes.length > 0) {
      activeTurnSelector = sel
      return nodes
    }
  }
  return []
}

const findContainer = () => {
  for (const sel of CONTAINER_SELECTORS) {
    const el = document.querySelector(sel)
    if (el) return el
  }
  return document.body
}

// ── Containment ────────────────────────────────────────────────────────────────

const applyContainment = (turn) => {
  if (contained.has(turn)) return
  turn.style.contentVisibility = "auto"
  turn.style.containIntrinsicSize = INTRINSIC_SIZE
  contained.add(turn)
}

const removeContainment = (turn) => {
  if (!contained.has(turn)) return
  turn.style.contentVisibility = ""
  turn.style.containIntrinsicSize = ""
  contained.delete(turn)
}

// ── Core refresh loop ──────────────────────────────────────────────────────────

const refresh = () => {
  const turns = queryTurns()
  const total = turns.length
  const last = total > 0 ? turns[total - 1] : null

  // Disabled, or thread too short — unwind any containment and report idle.
  if (!enabled || total < ENGAGE_THRESHOLD) {
    turns.forEach(removeContainment)
    lastTurnEl = last
    lastTotal = total
    stats = { total, contained: 0, rendered: total, engaged: false, enabled }
    return
  }

  // Fast path: nothing structural changed since the last pass — the assistant is
  // only streaming tokens into the (already-exempt) last turn. Skip the scan.
  if (total === lastTotal && last === lastTurnEl) {
    stats = { total, contained: total - 1, rendered: 1, engaged: true, enabled }
    return
  }

  // Structural change (a new turn arrived, or the chat was switched): contain
  // every turn except the last. The last turn is always left live — it is where
  // streaming happens and where ChatGPT auto-scrolls, so no separate streaming
  // check is needed. applyContainment skips turns already in the WeakSet, so the
  // steady-state cost is the few newly-added turns, not the whole thread.
  for (const turn of turns) {
    if (turn === last) removeContainment(turn)
    else applyContainment(turn)
  }

  lastTurnEl = last
  lastTotal = total
  stats = { total, contained: total - 1, rendered: 1, engaged: true, enabled }
}

// Debounce via rAF: coalesce rapid DOM mutations into a single pass per frame
let rafId = null
const scheduleRefresh = () => {
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    refresh()
  })
}

// ── Mutation observer ──────────────────────────────────────────────────────────

let conversationObserver = null

const startObserving = () => {
  conversationObserver?.disconnect()
  // Force a full structural pass — the conversation (and its turns) may have changed.
  lastTurnEl = null
  lastTotal = 0
  const container = findContainer()
  conversationObserver = new MutationObserver(scheduleRefresh)
  conversationObserver.observe(container, { childList: true, subtree: true })
  refresh()
}

// ── SPA navigation (ChatGPT uses pushState without full page reloads) ──────────

const onChatSwitch = () => {
  // Give React a moment to unmount the old conversation and mount the new one
  setTimeout(startObserving, 400)
}

const hookNavigation = () => {
  window.addEventListener("popstate", onChatSwitch)

  // Patch pushState/replaceState — React Router uses these for SPA navigation
  const wrap = (original) =>
    function (...args) {
      original.apply(this, args)
      onChatSwitch()
    }

  history.pushState = wrap(history.pushState)
  history.replaceState = wrap(history.replaceState)
}

// ── Popup messaging + toggle ────────────────────────────────────────────────────

// The popup asks for the latest snapshot whenever it is open.
browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "getStats") {
    refresh()
    return Promise.resolve(stats)
  }
})

// Safety net: re-observe every 3s in case ChatGPT remounted the container
// and the MutationObserver is now watching a detached node.
setInterval(startObserving, 3000)

// The popup flips `enabled` via storage; react immediately. Reset the structural
// snapshot so the next pass re-applies (or unwinds) containment in full.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.enabled) return
  enabled = changes.enabled.newValue !== false
  lastTurnEl = null
  lastTotal = 0
  scheduleRefresh()
})

// ── Initialisation ─────────────────────────────────────────────────────────────

const init = () => {
  const container = findContainer()

  if (container && container !== document.body) {
    startObserving()
    hookNavigation()
    return
  }

  // Conversation container not in DOM yet — ChatGPT loads asynchronously
  setTimeout(init, 500)
}

const boot = async () => {
  // Load the persisted toggle (default on) before the first containment pass.
  try {
    const stored = await browser.storage.local.get("enabled")
    enabled = stored.enabled !== false
  } catch {
    enabled = true
  }
  init()
}

// Graceful degradation: do nothing on browsers without `content-visibility`
// (the whole technique is a no-op there). strict_min_version already gates
// installation, but this keeps the script harmless if loaded anywhere older.
if (CSS.supports("content-visibility", "auto")) boot()
