#!/usr/bin/env node
import {
  PublisherProfileCliError, cancelPendingPublisherProfileOperation, exportPublisherProfile, getPendingPublisherProfileOperation,
  importPublisherChangePlan, preflightPublisherChangePlan, validatePublisherChangePlan, validatePublisherDocument,
} from '../lib/publisher-profile-cli.js'

// Four rows × 100 destinations × bounded schema fields can legitimately exceed 1 MiB.
// Keep local-file/stdin plans bounded at 2 MiB; Dashboard HTTP remains independently capped at 32 KiB.
const MAX_INPUT_BYTES = 2 * 1024 * 1024
function usage() {
  console.error('Usage: prismflow-dsh-profile <export|validate|preflight|import|pending|reconcile|cancel-pending> --profile <name>')
  process.exit(2)
}
function argumentsFor(argv) {
  const command = argv[0]
  if (!['export', 'validate', 'preflight', 'import', 'pending', 'reconcile', 'cancel-pending'].includes(command) || argv.length !== 3 || argv[1] !== '--profile') usage()
  return { command, profile: argv[2] }
}
async function readInput() {
  const chunks = []; let bytes = 0
  for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > MAX_INPUT_BYTES) throw new PublisherProfileCliError('Typed input exceeds 2 MiB'); chunks.push(chunk) }
  const text = Buffer.concat(chunks).toString('utf8')
  if (/^\s*(?:---|%YAML|[-A-Za-z0-9_]+\s*:)/u.test(text) && !/^\s*\{/u.test(text)) throw new PublisherProfileCliError('Raw YAML input is not accepted')
  try { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value }
  catch { throw new PublisherProfileCliError('Input must be one typed JSON object') }
}

try {
  const { command, profile } = argumentsFor(process.argv.slice(2))
  if (command === 'export') console.log(JSON.stringify(exportPublisherProfile(profile), null, 2))
  else if (command === 'pending' || command === 'reconcile') {
    console.log(JSON.stringify({ operation: getPendingPublisherProfileOperation(profile) ?? null }, null, 2))
  } else if (command === 'cancel-pending') {
    console.log(JSON.stringify({ operation: cancelPendingPublisherProfileOperation(profile) ?? null }, null, 2))
  } else {
    const input = await readInput()
    if (command === 'validate') {
      const value = ['PrismFlowPublisherProfileDocument/v1', 'PrismFlowPublisherProfileDocument/v2'].includes(input.kind)
        ? validatePublisherDocument(input) : validatePublisherChangePlan(input, exportPublisherProfile(profile))
      console.log(JSON.stringify({ valid: true, kind: value.kind }))
    } else if (command === 'preflight') console.log(JSON.stringify(preflightPublisherChangePlan(input, exportPublisherProfile(profile)), null, 2))
    else console.log(JSON.stringify(importPublisherChangePlan(profile, input), null, 2))
  }
} catch (error) {
  const message = error instanceof PublisherProfileCliError || error?.name === 'PublisherProfileValidationError'
    ? error.message : 'Publisher Profile operation failed'
  console.error(`PrismFlow publisher Profile: ${message}`)
  process.exit(1)
}
