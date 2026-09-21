/**
 * Harness adapter: Kiro (AWS) — the agentic IDE built on VS Code.
 *
 * Everything that knows the shape of Kiro's own files lives in this one module, exactly like
 * `claude-code.mjs` and `codex.mjs`. `server/scan.mjs` never reaches past the adapter interface.
 * The contract is written down in `server/harnesses/README.md`.
 *
 * Read-only, without exception, and no subprocess anywhere. Kiro tracks a session `status` of
 * its own that only Kiro can set, so archiving here is recorded in the colony alone — see the
 * note on archiving in `server/harnesses/README.md`.
 *
 * One store, so nothing to merge:
 *   - `~/.kiro/sessions/<workspaceId>/sess_<uuid>/session.json` — one record per thread
 *     (title, agentMode, workspacePaths, timestamps, model, status, description).
 *   - the sibling `messages.jsonl` is the transcript: its byte size is how tall a building
 *     grows, its first user record is the preview, and its tail says whose turn it is.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { exists, jsonLines, listDirs, listFiles, num, readHead, readTail } from '../lib/fsutil.mjs'

const HOME = os.homedir()
/** Kiro keeps everything under a dot-directory in the home folder, on every OS. */
const KIRO_HOME = process.env.KIRO_HOME || path.join(HOME, '.kiro')
const SESSIONS_DIR = path.join(KIRO_HOME, 'sessions')

const HEAD_BYTES = 128 * 1024
const TAIL_BYTES = 64 * 1024
/**
 * Kiro writes nothing special when it is killed mid-turn, so a session left `in_progress`
 * needs a time bound before it is believed to be working right now.
 */
const ACTIVE_WINDOW_MS = 30 * 60 * 1000

/** Prefixed, per the contract in `server/harnesses/README.md`. `sess_<uuid>` is already unique. */
const ID = (raw) => `kiro:${raw}`
const SESS = /^sess_[0-9a-f-]{36}$/i

const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim()

/** Kiro stamps are ISO strings; the transcript's are the same. Epoch ms or 0. */
const toMs = (v) => {
  if (typeof v === 'number') return num(v)
  const t = Date.parse(v || '')
  return Number.isNaN(t) ? 0 : t
}

/** Pull text out of a message payload, whatever shape Kiro wrote it in. */
function payloadText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === 'string' ? p : p?.text || p?.content || ''))
      .filter(Boolean)
      .join('\n')
  }
  if (content && typeof content === 'object') return content.text || ''
  return ''
}

/** The first real user prompt in a transcript head — the card's preview. Skips tool noise. */
function firstPrompt(records) {
  for (const r of records) {
    const p = r?.payload
    if (p?.type === 'user') {
      const text = clean(payloadText(p.content))
      if (text && !text.startsWith('<')) return text
    }
  }
  return ''
}

/**
 * Whether the transcript ends with the turn handed back to you.
 *
 * A last `user` record (or a tool result) means the model speaks next — it is mid-turn, not
 * waiting. A last assistant record with the turn closed out means the reply is yours. Only
 * sessions that could plausibly be running pay for this, so it costs one small tail read each.
 */
async function awaitingReply(file) {
  let records
  try {
    records = jsonLines(await readTail(file, TAIL_BYTES))
  } catch {
    return false
  }
  for (let i = records.length - 1; i >= 0; i--) {
    const p = records[i]?.payload
    if (!p) continue
    if (p.type === 'user' || p.type === 'tool_result') return false
    if (p.type === 'tool_call') return p.status === 'completed' || p.status === 'cancelled'
    if (p.type === 'assistant' || p.type === 'assistant_response') return true
  }
  return false
}

/** Transcript facts are kept against mtime + size, so an unchanged file is parsed once. */
const cache = new Map()
async function transcriptFacts(entry) {
  const cached = cache.get(entry.id)
  if (cached && cached.mtime === entry.mtime && cached.size === entry.size) return cached.facts
  let facts = { preview: '' }
  try {
    facts = { preview: firstPrompt(jsonLines(await readHead(entry.file, HEAD_BYTES))) }
  } catch {
    /* mid-write, or gone — a blank preview is survivable */
  }
  cache.set(entry.id, { mtime: entry.mtime, size: entry.size, facts })
  return facts
}

function projectOf(paths) {
  const dir = Array.isArray(paths) ? paths.find((p) => typeof p === 'string' && p) : ''
  const abs = typeof dir === 'string' ? dir : ''
  return { projectPath: abs, project: abs ? path.basename(abs) || abs : 'unknown' }
}

/**
 * The display name shown on a zone's plate — just the session title, cleaned and trimmed.
 * No folder prefix and no id code: the colony groups on `project` (a separate unique key,
 * see `zoneKey`), so the label is free to be human-readable and can even repeat.
 */
function zoneLabel(title) {
  return clean(title).replace(/\s+/g, ' ').slice(0, 40).trim() || 'Untitled'
}

/**
 * The grouping key for a session's zone. Must be UNIQUE per session — the colony keys layout
 * and archive on it, and two sessions can share a title (several "New Session"s), so the
 * session id carries the uniqueness. This never appears on screen.
 */
function zoneKey(id) {
  return `kiro:${id}`
}

/**
 * Read one `session.json` and pair it with its `messages.jsonl`, if the transcript is there.
 * Everything the colony draws comes from these two files and nothing else.
 */
async function readSession(dir) {
  let record
  try {
    record = JSON.parse(await fsp.readFile(path.join(dir, 'session.json'), 'utf8'))
  } catch {
    return null // mid-write or not a session folder — skip this pass
  }
  const id = typeof record.id === 'string' ? record.id : path.basename(dir)

  let entry = null
  const transcript = path.join(dir, 'messages.jsonl')
  try {
    const st = await fsp.stat(transcript)
    entry = { id, file: transcript, size: st.size, mtime: st.mtimeMs }
  } catch {
    /* a brand new session may have no transcript yet */
  }
  const facts = entry ? await transcriptFacts(entry) : { preview: '' }

  const { projectPath, project: folderName } = projectOf(record.workspacePaths || record.rootPaths)
  const createdAt = toMs(record.createdAt)
  const modified = toMs(record.lastModifiedAt)
  const lastActivityAt = Math.max(modified, entry?.mtime || 0, createdAt)
  const status = clean(record.status)
  const title = clean(record.title) || facts.preview || 'Untitled thread'
  // One zone per session: the folder-per-zone model would collapse a whole Kiro workspace
  // into a single crowded plot, so each conversation gets its own ground. `project` is a
  // unique key (never shown); `projectLabel` is the clean title shown on the plate.
  const project = zoneKey(id)
  const projectLabel = zoneLabel(title)

  return {
    id, dir, title,
    preview: facts.preview,
    project, projectLabel, projectPath,
    folder: folderName === 'unknown' ? '' : folderName,
    cwd: projectPath,
    createdAt, lastActivityAt, status,
    model: clean(record.modelId),
    mode: clean(record.agentMode),
    transcriptFile: entry?.file || '',
    sizeBytes: entry?.size || 0,
    hasTranscript: Boolean(entry),
  }
}

async function scanThreads() {
  const now = Date.now()
  const out = []

  // One level down is the workspace bucket; the session folders live under that.
  for (const workspace of await listDirs(SESSIONS_DIR)) {
    for (const sessionDir of await listDirs(workspace)) {
      if (!SESS.test(path.basename(sessionDir))) continue
      const s = await readSession(sessionDir)
      if (!s) continue

      const fresh = now - s.lastActivityAt < ACTIVE_WINDOW_MS
      const inProgress = s.status === 'in_progress'
      const waiting =
        inProgress && fresh && s.transcriptFile ? await awaitingReply(s.transcriptFile) : false

      out.push({
        id: ID(s.id),
        title: s.title.slice(0, 120),
        preview: s.preview.slice(0, 240),
        project: s.project,
        // Clean title shown on the zone plate (distinct from the unique `project` key).
        projectLabel: s.projectLabel,
        // The workspace folder these sessions belong to — used to name the central hub.
        folder: s.folder,
        projectPath: s.projectPath,
        // Kiro has no worktree concept of its own; inventing one would put a branch on a
        // thread that never had one.
        worktree: '',
        cwd: s.cwd,
        gitBranch: '',
        model: s.model,
        effort: s.mode,
        createdAt: s.createdAt,
        lastActivityAt: s.lastActivityAt,
        // Kiro records no separate focus history, so "have you looked at this" is unknowable.
        lastFocusedAt: 0,
        // A session waiting on you stops and holds a `?`. Kiro's own `waiting_on_user` status
        // says so outright; otherwise the transcript tail is asked.
        unread: waiting || s.status === 'waiting_on_user',
        running: inProgress && fresh && !waiting,
        hasError: s.status === 'error' || s.status === 'failed',
        starred: false,
        routine: '',
        prState: '',
        // Kiro has no archive flag of its own that this adapter reads; the colony owns it.
        archived: false,
        // Bytes, like every other harness — the field is a shared log scale across the map.
        sizeBytes: s.sizeBytes,
        source: s.mode || 'kiro',
        // Kiro registers no OS-level deep link scheme, so a thread cannot be reopened from here.
        // The UI greys the Open button out and says why rather than pretending the click worked.
        canOpen: false,
        ref: { sessionId: s.id, dir: s.dir },
      })
    }
  }
  return out
}

/** Kiro registers no `kiro://` deep link, so there is nothing to hand the OS opener. */
function openThread() {
  return { ok: false, error: 'Kiro has no deep link to reopen a session from outside the IDE' }
}

/** Same reason — a new Kiro session is started inside the IDE, not through a URL. */
function newSession() {
  return { ok: false, error: 'Kiro sessions are started from inside the IDE, not via a link' }
}

export default {
  id: 'kiro',
  name: 'Kiro',
  /** Only claim this machine if Kiro's session store is actually there. */
  detect: async () => exists(SESSIONS_DIR),
  scanThreads,
  openThread,
  newSession,
  paths: { KIRO_HOME, SESSIONS_DIR },
}
