// Cifrado AES-GCM de los tokens de renovación de Microsoft. La clave (32 bytes en base64) es un secreto
// de las funciones de servidor (TOKEN_ENCRYPTION_KEY) y nunca se guarda en la base de datos.

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(base64Key: string): Promise<CryptoKey> {
  const raw = unb64(base64Key);
  if (raw.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY debe tener 32 bytes en base64.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptToken(plain: string, base64Key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(base64Key), new TextEncoder().encode(plain)));
  return `v1.${b64(iv)}.${b64(data)}`;
}

export async function decryptToken(enc: string, base64Key: string): Promise<string> {
  const [v, iv, data] = enc.split('.');
  if (v !== 'v1' || !iv || !data) throw new Error('Formato de token cifrado desconocido.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(base64Key), unb64(data));
  return new TextDecoder().decode(plain);
}
