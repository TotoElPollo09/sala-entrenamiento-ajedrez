// Formato de la base grande, compartido por la web y por tools/construir-base.mjs.
export const SHARD_BITS = 12 // 4096 trozos de posiciones
export const CHUNK = 1000 // partidas por archivo de cabeceras y de jugadas

// Dos hashes de 32 bits (FNV-1a y uno tipo murmur) de la posición, sin contadores de jugadas.
export function positionHash(key) {
  let a = 2166136261, b = 0x9747b28c
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i)
    a ^= c; a = Math.imul(a, 16777619)
    b = Math.imul(b ^ c, 0x5bd1e995); b ^= b >>> 15
  }
  return [a >>> 0, b >>> 0]
}

export const shardOf = (h1) => h1 >>> (32 - SHARD_BITS)

// Tres primeras letras del nombre, sin tildes ni signos ("Ñúñez, J." -> "nun").
export function normName(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}
export const playerPrefix = (name) => (normName(name) + '___').slice(0, 3)
