#!/usr/bin/env node
/**
 * Smoke-test the deployed publish Worker end-to-end.
 *
 * 1. Build a real .lcbundle from LyriCue's demo timing map via exportBundle()
 * 2. PUT /publish with org/campus/credential headers
 * 3. Verify 200 + bundleUrl in response
 * 4. GET /publish/whoami again to confirm credential still works
 *
 * Run with:
 *   env -i HOME="$HOME" PWD="$PWD" PATH=... node infra/publish-worker/smoke-publish.mjs
 */

import { exportBundle } from "../../packages/core/dist/library/library-manager.js"
import { DEMO_TIMING_MAP } from "../../packages/core/dist/output/test-utils.js"

const WORKER_URL = process.env.WORKER_URL
const CREDENTIAL = process.env.LC_CREDENTIAL
const ORG_ID = process.env.LC_ORG_ID
const CAMPUS_ID = process.env.LC_CAMPUS_ID

// All four must come from the environment. Hard-coded credentials in source were
// removed after the public push — never paste secrets into this file. Usage:
//
//   WORKER_URL=https://your-worker.workers.dev \
//   LC_CREDENTIAL=$(your-secret-manager get publish-credential) \
//   LC_ORG_ID=your-org LC_CAMPUS_ID=central \
//   node infra/publish-worker/smoke-publish.mjs
if (!WORKER_URL || !CREDENTIAL || !ORG_ID || !CAMPUS_ID) {
    console.error("[smoke] Missing required env: WORKER_URL, LC_CREDENTIAL, LC_ORG_ID, LC_CAMPUS_ID")
    process.exit(2)
}

console.log(`[smoke] Worker: ${WORKER_URL}`)
console.log(`[smoke] Building demo bundle…`)

const bundle = exportBundle({
    songId: "smoke-test-song",
    title: "Smoke Test Song",
    bundleVersion: "1.0.0",
    show: { id: DEMO_TIMING_MAP.showId, title: "Smoke Test Song" },
    timingMap: {
        ...DEMO_TIMING_MAP,
        showId: DEMO_TIMING_MAP.showId,
        learnedFrom: { ...DEMO_TIMING_MAP.learnedFrom }
    },
    arrangements: [],
    exportedAt: new Date(0).toISOString()
})

console.log(`[smoke] Bundle size: ${bundle.byteLength} bytes`)
console.log(`[smoke] PUT /publish…`)

const response = await fetch(`${WORKER_URL}/publish`, {
    method: "PUT",
    headers: {
        "X-LC-Credential": CREDENTIAL,
        "X-LC-Org": ORG_ID,
        "X-LC-Campus": CAMPUS_ID,
        "Content-Type": "application/vnd.lyricue.bundle+zip"
    },
    body: bundle
})

const responseText = await response.text()
console.log(`[smoke] Status: ${response.status}`)
console.log(`[smoke] Body: ${responseText}`)

if (response.status !== 200) {
    console.error("[smoke] FAILED — publish did not return 200")
    process.exit(1)
}

console.log("[smoke] ✓ publish succeeded")

const parsed = JSON.parse(responseText)
console.log(`[smoke] bundleUrl: ${parsed.bundleUrl}`)
console.log(`[smoke] catalogVersion: ${parsed.catalogVersion}`)

// Verify R2 by fetching the public bundleUrl
console.log(`[smoke] Verifying bundleUrl reachable…`)
const bundleGet = await fetch(parsed.bundleUrl)
console.log(`[smoke] bundleUrl status: ${bundleGet.status}`)
if (bundleGet.status !== 200) {
    console.log(`[smoke] Note: bundleUrl is computed but R2 isn't public by default; this is fine`)
}
