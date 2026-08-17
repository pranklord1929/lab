// Extrait le texte brut des documents de menu decouverts.
// Supporte HTML et PDF. Les images restent a traiter plus tard avec OCR.

import { createClient } from '@supabase/supabase-js'
import pdf from 'pdf-parse'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const args = new Set(process.argv.slice(2))
const write = args.has('--write')
const limit = Number(getArg('limit', 25))
const timeoutMs = Number(getArg('timeout', 20000))

function getArg(name, fallback) {
  const raw = process.argv.find(arg => arg.startsWith(`--${name}=`))
  return raw ? raw.split('=').slice(1).join('=') : fallback
}

function cleanText(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function fetchBuffer(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/pdf,text/html,*/*;q=0.8',
        'User-Agent': 'cdmx-restaurants-menu-extraction/1.0',
      },
      signal: controller.signal,
      redirect: 'follow',
    })

    const contentType = res.headers.get('content-type') || ''
    const contentLength = Number(res.headers.get('content-length') || 0) || null
    const buffer = Buffer.from(await res.arrayBuffer())

    return {
      ok: res.ok,
      status: res.status,
      contentType,
      contentLength,
      buffer,
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function loadDocuments() {
  const { data, error } = await supabase
    .from('menu_documents')
    .select('id, restaurant_id, source_url, document_type, restaurants(nombre)')
    .in('status', ['discovered', 'fetched', 'failed'])
    .in('document_type', ['pdf', 'html'])
    .order('created_at')
    .limit(limit)

  if (error) throw new Error(`Supabase menu_documents: ${error.message}`)
  return data || []
}

async function updateDocument(id, patch) {
  const { error } = await supabase
    .from('menu_documents')
    .update({
      ...patch,
      last_checked_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw new Error(`Supabase update: ${error.message}`)
}

async function extractText(document, response) {
  const type = document.document_type
  const contentType = response.contentType.toLowerCase()

  if (type === 'pdf' || contentType.includes('application/pdf')) {
    const parsed = await pdf(response.buffer)
    return cleanText(parsed.text)
  }

  if (type === 'html' || contentType.includes('text/html')) {
    return cleanText(response.buffer.toString('utf8'))
  }

  return ''
}

async function main() {
  console.log(`Mode: ${write ? 'ecriture Supabase' : 'dry-run'}`)
  console.log(`Limite documents: ${limit}`)

  const documents = await loadDocuments()
  let extracted = 0
  let failed = 0

  for (const document of documents) {
    const name = document.restaurants?.nombre || document.restaurant_id

    try {
      const response = await fetchBuffer(document.source_url)
      if (!response.ok) {
        failed++
        console.log(`[fail] ${name} | HTTP ${response.status} | ${document.source_url}`)
        if (write) {
          await updateDocument(document.id, {
            status: 'failed',
            http_status: response.status,
            content_type: response.contentType,
            content_length: response.contentLength,
            error_message: `HTTP ${response.status}`,
          })
        }
        continue
      }

      const text = await extractText(document, response)
      const useful = text.length >= 80

      console.log(`[${useful ? 'text' : 'thin'}] ${name} | ${text.length} chars | ${document.source_url}`)
      if (text) console.log(`  ${text.slice(0, 180).replace(/\n/g, ' ')}${text.length > 180 ? '...' : ''}`)

      if (write) {
        await updateDocument(document.id, {
          status: useful ? 'extracted' : 'fetched',
          http_status: response.status,
          content_type: response.contentType,
          content_length: response.contentLength,
          raw_text: text || null,
          extracted_at: useful ? new Date().toISOString() : null,
          error_message: useful ? null : 'Texte trop court ou non exploitable',
        })
      }

      if (useful) extracted++
    } catch (error) {
      failed++
      console.log(`[error] ${name} | ${error.message} | ${document.source_url}`)
      if (write) {
        await updateDocument(document.id, {
          status: 'failed',
          error_message: error.message,
        })
      }
    }
  }

  console.log('\nTermine.')
  console.log(`Documents lus: ${documents.length}`)
  console.log(`Textes exploitables: ${extracted}`)
  console.log(`Erreurs: ${failed}`)
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
