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

// ── DOM helpers ────────────────────────────────────────────────────────────────

const queryTurns = () => {
  for (const sel of TURN_SELECTORS) {
    const nodes = [...document.querySelectorAll(sel)]
    if (nodes.length > 0) return nodes
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

/**
 * Returns true if the turn is currently streaming (i.e. the assistant is still
 * generating tokens into it). ChatGPT has used different signals across versions;
 * we check all known ones.
 */
const isStreaming = (turn) =>
  turn.querySelector(
    '.result-streaming, [data-state="streaming"], [class*="result-streaming"]',
  ) !== null

// ── Containment ────────────────────────────────────────────────────────────────

const applyContainment = (turn) => {
  if (turn.dataset.smoothgpt === "1") return
  turn.style.contentVisibility = "auto"
  turn.style.containIntrinsicSize = INTRINSIC_SIZE
  turn.dataset.smoothgpt = "1"
}

const removeContainment = (turn) => {
  if (!turn.dataset.smoothgpt) return
  turn.style.contentVisibility = ""
  turn.style.containIntrinsicSize = ""
  delete turn.dataset.smoothgpt
}

// ── Core refresh loop ──────────────────────────────────────────────────────────

const refresh = () => {
  const turns = queryTurns()

  if (turns.length < ENGAGE_THRESHOLD) {
    // Short thread — undo any containment left over from a previously longer chat
    turns.forEach(removeContainment)
    return
  }

  const lastTurn = turns[turns.length - 1]

  turns.forEach((turn) => {
    // Always keep the last turn fully rendered:
    //   • it may be actively streaming
    //   • ChatGPT auto-scrolls to it, so it must be in the normal layout flow
    // Also exempt any turn explicitly detected as streaming.
    if (turn === lastTurn || isStreaming(turn)) {
      removeContainment(turn)
    } else {
      applyContainment(turn)
    }
  })
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

init()
