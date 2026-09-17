#!/usr/bin/env node
// Xcode Cloud through the App Store Connect API: list, trigger and follow builds.
//
// A push to the release branch triggers the workflow; this script is for knowing
// whether a build ran and how it ended, and for re-running one without an empty
// push. No dependencies: node:crypto signs a short-lived ES256 JWT.
//
// Usage:
//   node scripts/xcode-cloud-build.mjs --list                  # products and workflows
//   node scripts/xcode-cloud-build.mjs --status                # latest runs of the workflow
//   node scripts/xcode-cloud-build.mjs --status <runId>        # one run
//   node scripts/xcode-cloud-build.mjs --branch release        # start a build on a branch
//   node scripts/xcode-cloud-build.mjs --branch release --wait # and wait for it
//   options: --workflow <name|id> (default: the only one, or the one matching /release|prod/i)
//            --timeout <min> (default 60, with --wait)
//
// One JSON line per event.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSign } from 'node:crypto'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://api.appstoreconnect.apple.com/v1'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const opt = (name, def) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def
}

// ── credential ───────────────────────────────────────────────────────────────
// The App Store Connect key comes from the environment (same three variables the
// EAS scripts use); only the app id is read from eas.json. The key is never printed.
function loadCreds() {
  const eas = JSON.parse(readFileSync(resolve(ROOT, 'eas.json'), 'utf8'))
  const keyPath = process.env.EXPO_ASC_API_KEY_PATH || process.env.ASC_KEY_PATH
  const keyId = process.env.EXPO_ASC_KEY_ID || process.env.ASC_KEY_ID
  const issuerId = process.env.EXPO_ASC_ISSUER_ID || process.env.ASC_ISSUER_ID
  const appId = process.env.ASC_APP_ID || eas?.submit?.production?.ios?.ascAppId
  if (!keyPath || !keyId || !issuerId || !appId) {
    throw new Error('Set EXPO_ASC_API_KEY_PATH, EXPO_ASC_KEY_ID and EXPO_ASC_ISSUER_ID (ascAppId comes from eas.json)')
  }
  const pem = readFileSync(resolve(ROOT, keyPath), 'utf8')
  return { pem, keyId, issuerId, appId }
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

// JWT ES256 de 15 min. `ieee-p1363` porque a ASC quer r||s cru, não DER.
function mintJwt({ pem, keyId, issuerId }) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ iss: issuerId, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' }))
  const signer = createSign('SHA256')
  signer.update(`${header}.${payload}`)
  const sig = signer.sign({ key: pem, dsaEncoding: 'ieee-p1363' })
  return `${header}.${payload}.${b64url(sig)}`
}

// ── API ──────────────────────────────────────────────────────────────────────
let TOKEN = null
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* corpo não-JSON */ }
  if (!res.ok) {
    const detail = json?.errors?.map((e) => `${e.status} ${e.title}: ${e.detail}`).join(' | ') || text.slice(0, 300)
    throw new Error(`${method} ${path} → ${res.status} ${detail}`)
  }
  return json
}

const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')

async function product(appId) {
  const r = await api(`/apps/${appId}/ciProduct`)
  if (!r?.data) throw new Error('app sem ciProduct — o Xcode Cloud está ligado a este app?')
  return r.data
}

async function workflows(productId) {
  const r = await api(`/ciProducts/${productId}/workflows?limit=50`)
  return (r?.data || []).map((w) => ({ id: w.id, name: w.attributes?.name, enabled: w.attributes?.isEnabled, branchStart: w.attributes?.branchStartCondition?.source?.patterns?.map((p) => p.pattern) }))
}

function pickWorkflow(list, want) {
  if (want) {
    const hit = list.find((w) => w.id === want || w.name?.toLowerCase() === want.toLowerCase())
    if (!hit) throw new Error(`workflow "${want}" não encontrado; --list mostra os disponíveis`)
    return hit
  }
  if (list.length === 1) return list[0]
  const guess = list.find((w) => /release|prod/i.test(w.name || ''))
  if (guess) return guess
  throw new Error(`${list.length} workflows — escolha com --workflow <nome>`)
}

async function gitRef(workflowId, branch) {
  const repo = await api(`/ciWorkflows/${workflowId}/repository`)
  const repoId = repo?.data?.id
  if (!repoId) throw new Error('workflow sem repositório')
  // A ASC não filtra por nome no endpoint público de forma confiável; pagina e casa.
  let url = `/scmRepositories/${repoId}/gitReferences?limit=200`
  while (url) {
    const page = await api(url)
    const hit = (page?.data || []).find((g) => g.attributes?.kind === 'BRANCH' && g.attributes?.name === branch)
    if (hit) return hit.id
    url = page?.links?.next || null
  }
  throw new Error(`branch "${branch}" não encontrada no repositório do Xcode Cloud`)
}

const summarizeRun = (r) => ({
  id: r.id,
  number: r.attributes?.number,
  branch: r.attributes?.sourceBranchOrTag?.name ?? null,
  commit: r.attributes?.sourceCommit?.commitSha?.slice(0, 7) ?? null,
  progress: r.attributes?.executionProgress,
  status: r.attributes?.completionStatus,
  started: r.attributes?.startedDate,
  finished: r.attributes?.finishedDate,
})

async function runs(workflowId, limit = 5) {
  const r = await api(`/ciWorkflows/${workflowId}/buildRuns?limit=${limit}&sort=-number`)
  return (r?.data || []).map(summarizeRun)
}

async function run(runId) {
  const r = await api(`/ciBuildRuns/${runId}`)
  return summarizeRun(r.data)
}

async function trigger(workflowId, refId) {
  const r = await api('/ciBuildRuns', {
    method: 'POST',
    body: { data: { type: 'ciBuildRuns', relationships: {
      workflow: { data: { type: 'ciWorkflows', id: workflowId } },
      sourceBranchOrTag: { data: { type: 'scmGitReferences', id: refId } },
    } } },
  })
  return summarizeRun(r.data)
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

async function waitFor(runId, timeoutMin) {
  const deadline = Date.now() + timeoutMin * 60_000
  let last = null
  while (Date.now() < deadline) {
    const r = await run(runId)
    if (r.progress !== last) { out({ event: 'progress', ...r }); last = r.progress }
    if (r.progress === 'COMPLETE') return r
    await sleep(30_000)
  }
  throw new Error(`timeout de ${timeoutMin} min esperando o run ${runId}`)
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const creds = loadCreds()
  TOKEN = mintJwt(creds)
  const prod = await product(creds.appId)
  const wfs = await workflows(prod.id)

  if (flag('--list')) {
    out({ product: { id: prod.id, name: prod.attributes?.name }, workflows: wfs })
    return
  }
  const wf = pickWorkflow(wfs, opt('--workflow'))

  if (flag('--status')) {
    const id = opt('--status')
    if (id) out({ run: await run(id) })
    else out({ workflow: wf.name, runs: await runs(wf.id) })
    return
  }

  const branch = opt('--branch')
  if (!branch) {
    out({ workflow: wf.name, runs: await runs(wf.id, 3), hint: 'use --branch <nome> para disparar, --list, ou --status' })
    return
  }
  const refId = await gitRef(wf.id, branch)
  const started = await trigger(wf.id, refId)
  out({ event: 'triggered', workflow: wf.name, ...started })
  if (flag('--wait')) {
    const done = await waitFor(started.id, Number(opt('--timeout', 60)))
    out({ event: 'done', ...done })
    if (done.status !== 'SUCCEEDED') process.exitCode = 2
  }
}

main().catch((err) => {
  out({ error: err.message })
  process.exitCode = 1
})
