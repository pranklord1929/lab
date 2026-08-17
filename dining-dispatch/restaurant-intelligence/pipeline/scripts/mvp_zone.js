export const MVP_ZONE = {
  name: 'Roma Norte + Condesa + Roma Sur',
  alcaldia: 'CUAUHTEMOC',
  colonias: [
    'ROMA NORTE',
    'ROMA SUR',
    'COLONIA ROMA SUR',
    'CONDESA',
    'HIPODROMO',
    'HIPODROMO CONDESA',
    'HIPODROMO DE LA CONDES',
    'CONDESA VMC',
  ],
}

export function normalizeText(value) {
  return String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isMvpZoneRestaurant(restaurant) {
  const alcaldia = normalizeText(restaurant.alcaldia)
  const colonia = normalizeText(restaurant.colonia)

  if (!alcaldia.includes(MVP_ZONE.alcaldia)) return false
  return MVP_ZONE.colonias.some(target => colonia === normalizeText(target))
}
