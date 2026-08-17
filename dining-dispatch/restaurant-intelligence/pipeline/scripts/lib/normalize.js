// Normalisations utilisées par l'entity resolution.
// Tout doit être pur (pas d'I/O) → facile à tester.

// Strip accents, lowercase, collapse spaces, retire "el/la/los/las" en début.
export function normalizeName(s) {
  if (!s) return ''
  const prefixPatterns = [
    'restaurante',
    'restaurant',
    'cos',
    'antojitos yucatecos',
    'antojitos',
    'fonda',
    'cafeteria',
    'taqueria',
    'bar',
    'cantina',
    'cocina economica',
    'loncheria',
    'bia',
  ]
  const suffixPatterns = [
    'restaurante',
    'restaurant',
    'cerveceria',
    'cdmx',
    'polanco',
    'roma',
    'centro',
    'historico',
  ]

  let value = s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  let previous = null
  while (value && value !== previous) {
    previous = value
    for (const prefix of prefixPatterns) {
      value = value.replace(new RegExp(`^${prefix}\\s+`, 'i'), ' ')
    }
    for (const suffix of suffixPatterns) {
      value = value.replace(new RegExp(`\\s+${suffix}$`, 'i'), ' ')
    }
    value = value.replace(/\b(el|la|los|las|the|le|du|de|del)\b/g, ' ')
    value = value.replace(/\s+/g, ' ').trim()
  }

  return value
}

// Normalise une URL : lowercase host, strip www, strip trailing slash, hash, default port.
export function normalizeUrl(u) {
  if (!u) return null
  try {
    const url = new URL(u.startsWith('http') ? u : 'http://' + u)
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    url.hash = ''
    if ((url.protocol === 'http:' && url.port === '80') ||
        (url.protocol === 'https:' && url.port === '443')) url.port = ''
    let s = url.toString()
    if (s.endsWith('/') && url.pathname === '/') s = s.slice(0, -1)
    return s
  } catch { return u }
}

export function hostFromUrl(u) {
  if (!u) return null
  try { return new URL(u.startsWith('http') ? u : 'http://' + u).hostname.replace(/^www\./, '').toLowerCase() }
  catch { return null }
}

// Normalise un téléphone MX : retire tout sauf chiffres, ajoute +52 si manquant.
export function normalizePhoneMx(p) {
  if (!p) return null
  let d = p.replace(/\D/g, '')
  if (d.length === 10) d = '52' + d
  if (d.startsWith('521') && d.length === 13) d = '52' + d.slice(3)  // +521 → +52 (mobile MX)
  return d.length >= 11 ? '+' + d : null
}

// Distance approximative en mètres entre deux points GPS (Haversine simplifiée).
// Bonne précision sub-100m, suffisant pour matcher des restos.
export function distanceMeters(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(x => x == null)) return Infinity
  const R = 6371000
  const toRad = x => x * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Levenshtein-ish similarity 0..1. Utilisé en fallback pour fuzzy name match.
export function nameSimilarity(a, b) {
  a = normalizeName(a); b = normalizeName(b)
  if (!a || !b) return 0
  if (a === b) return 1
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i-1] === b[j-1] ? 0 : 1
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost)
    }
  }
  return 1 - dp[m][n] / Math.max(m, n)
}
