/**
 * OFFLINE / DEMO DATA
 * -------------------
 * This module replaces the live machine scan for the offline build of Bot Crossing.
 *
 * The real app fetches `/api/threads` (backed by the harness scanners in server/harnesses/*),
 * which returns `{ threads, scannedAt, warnings }`. Here we hand back a fixed, fabricated set
 * of threads so the colony renders the same way with no machine access.
 *
 * Badge mapping (see src/game/colony.js `statusFor`, first match wins):
 *   hasError:true          -> "!"  (blocked, red)
 *   running:true           -> hammer (working, green)
 *   prState:'MERGED'       -> "✓"  (celebrating / shipped)
 *   unread:true            -> "?"  (waiting on you, blue)
 *   stale (30d+)           -> sleeping (no badge)
 *   otherwise              -> idle (no badge)
 *
 * Each tool (harness) is stamped exactly as the server would: harness = id, harnessName = name.
 *   claude-code / Claude Code, codex / Codex, cursor / Cursor, kiro / Kiro
 *
 * Attention bots (4 total, as requested):
 *   1 x "!"  (blocked)  — Kiro
 *   3 x "?"  (waiting)  — Claude Code, Cursor, Codex
 * Plus a handful of working / shipped / idle bots so the colony feels alive.
 */

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// Anchor everything to "now" so freshness-based logic behaves the same each load.
const now = Date.now()

/**
 * Small helper so every fabricated thread has all the fields the frontend may read,
 * without repeating boilerplate. Override anything via `over`.
 */
function bot(over) {
  return {
    id: over.id,
    title: over.title || 'Untitled session',
    preview: over.preview || '',
    project: over.project || over.id, // unique grouping key (one zone per session)
    projectLabel: over.projectLabel || over.title || 'Session',
    folder: over.folder || 'workspace',
    projectPath: over.projectPath || `C:\\Users\\Frantisek\\${over.folder || 'workspace'}`,
    worktree: '',
    cwd: over.cwd || over.projectPath || `C:\\Users\\Frantisek\\${over.folder || 'workspace'}`,
    gitBranch: over.gitBranch || '',
    model: over.model || '',
    effort: over.effort || '',
    createdAt: over.createdAt ?? now - 3 * DAY,
    lastActivityAt: over.lastActivityAt ?? now - 5 * MIN,
    lastFocusedAt: 0,
    unread: over.unread ?? false,
    running: over.running ?? false,
    hasError: over.hasError ?? false,
    starred: false,
    routine: '',
    prState: over.prState || '',
    archived: false,
    sizeBytes: over.sizeBytes ?? 40_000,
    source: over.source || over.harness,
    harness: over.harness,
    harnessName: over.harnessName,
    // Open is intentionally always allowed in the offline build so the locked message shows.
    canOpen: true,
    ref: { demo: true, id: over.id },
  }
}

export const OFFLINE_THREADS = [
  // ---- 4 ATTENTION BOTS ---------------------------------------------------

  // 1) "!"  blocked / errored (mirrors the current live state)
  bot({
    id: 'kiro:atlas-scoring',
    harness: 'kiro',
    harnessName: 'Kiro',
    title: 'Atlas scoring pipeline — layer 4 refactor',
    projectLabel: 'Atlas · scoring',
    preview: 'Redshift error: invalid exponent while casting composite score…',
    folder: 'Atlas',
    model: 'auto',
    effort: 'autopilot',
    hasError: true,
    lastActivityAt: now - 12 * MIN,
    sizeBytes: 210_000,
  }),

  // 2) "?"  waiting on you
  bot({
    id: 'claude-code:forecast-tool',
    harness: 'claude-code',
    harnessName: 'Claude Code',
    title: 'AR forecast tool — persistence wiring',
    projectLabel: 'Forecast · persistence',
    preview: 'I drafted the save/load flow. Which folder should it write to?',
    folder: 'Forecast_Receivables',
    model: 'claude-sonnet',
    unread: true,
    lastActivityAt: now - 26 * MIN,
    sizeBytes: 156_000,
  }),

  // 3) "?"  waiting on you
  bot({
    id: 'cursor:recon-dashboard',
    harness: 'cursor',
    harnessName: 'Cursor',
    title: 'Reconciliation dashboard — chart review',
    projectLabel: 'Recon · dashboard',
    preview: 'Two layout options ready — want the donut or the stacked bars?',
    folder: 'Reconciliation',
    unread: true,
    lastActivityAt: now - 41 * MIN,
    sizeBytes: 98_000,
  }),

  // 4) "?"  waiting on you
  bot({
    id: 'codex:credit-memo',
    harness: 'codex',
    harnessName: 'Codex',
    title: 'Credit memo classifier — edge cases',
    projectLabel: 'ACM · classifier',
    preview: 'Found 3 ambiguous offsets. Confirm the write-off threshold?',
    folder: 'ACM',
    model: 'gpt-5',
    effort: 'high',
    unread: true,
    lastActivityAt: now - 8 * MIN,
    sizeBytes: 74_000,
  }),

  // ---- BACKGROUND BOTS (alive colony, no attention needed) ----------------

  // hammer — working now
  bot({
    id: 'kiro:datalake-poc',
    harness: 'kiro',
    harnessName: 'Kiro',
    title: 'Data lake POC — stage 4 ingestion',
    projectLabel: 'Datalake · ingest',
    preview: 'Writing partitioned parquet to the eu-north-1 bucket…',
    folder: 'Datalake',
    model: 'auto',
    running: true,
    lastActivityAt: now - 1 * MIN,
    sizeBytes: 320_000,
  }),

  // hammer — working now
  bot({
    id: 'claude-code:resume-site',
    harness: 'claude-code',
    harnessName: 'Claude Code',
    title: 'Resume site — CloudFront deploy',
    projectLabel: 'Resume · deploy',
    preview: 'Syncing 8 files to S3 and invalidating the distribution…',
    folder: 'Resume',
    model: 'claude-sonnet',
    running: true,
    lastActivityAt: now - 2 * MIN,
    sizeBytes: 132_000,
  }),

  // ✓ — shipped / PR merged
  bot({
    id: 'cursor:work-tracker',
    harness: 'cursor',
    harnessName: 'Cursor',
    title: 'Work tracker — Excel export feature',
    projectLabel: 'Tracker · export',
    preview: 'PR merged: added SheetJS export + weekly summary view.',
    folder: 'Tracking Tool',
    prState: 'MERGED',
    lastActivityAt: now - 3 * HOUR,
    sizeBytes: 88_000,
  }),

  // idle — recent but nothing pending
  bot({
    id: 'codex:token-roi',
    harness: 'codex',
    harnessName: 'Codex',
    title: 'Token counter ROI — cost model',
    projectLabel: 'Token ROI · model',
    preview: 'Break-even analysis drafted; awaiting pricing tiers.',
    folder: 'Token_Counter_ROI',
    model: 'gpt-5',
    effort: 'medium',
    lastActivityAt: now - 6 * HOUR,
    sizeBytes: 51_000,
  }),

  // idle
  bot({
    id: 'kiro:power-automate',
    harness: 'kiro',
    harnessName: 'Kiro',
    title: 'Power Automate — HTTP save flow',
    projectLabel: 'Power Automate · flow',
    preview: 'Documented the SAVE flow; LOAD flow pending CORS check.',
    folder: 'Project_Power_Automate',
    model: 'auto',
    lastActivityAt: now - 9 * HOUR,
    sizeBytes: 47_000,
  }),
]

/** Mimics the exact envelope returned by GET /api/threads. */
export function offlineThreadsResponse() {
  return {
    threads: OFFLINE_THREADS.map((t) => ({ ...t })),
    scannedAt: Date.now(),
    warnings: [],
  }
}
