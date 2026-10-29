/** Traduce los errores de Supabase/PostgreSQL a mensajes claros para el usuario. */
export function errorMessage(err: unknown): string {
  const e = err as { message?: string; code?: string; details?: string } | null;
  const msg = e?.message ?? String(err ?? 'Error desconocido');
  const code = e?.code ?? '';
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'Su rol no tiene permiso para realizar esta operación.';
  }
  if (/duplicate key/i.test(msg)) {
    if (/pads_code/.test(msg)) return 'Ya existe un PAD con ese código.';
    if (/wells_code/.test(msg)) return 'Ya existe un pozo con ese código.';
    return 'Ya existe un registro con esos datos.';
  }
  if (code === '23503' || /foreign key/i.test(msg)) {
    return 'No se puede eliminar: tiene registros asociados. Desactívelo en su lugar.';
  }
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'No se pudo conectar con el servidor. Verifique la conexión.';
  if (/Invalid login credentials/i.test(msg)) return 'Correo o contraseña incorrectos.';
  if (/Email not confirmed/i.test(msg)) return 'Confirme su correo con el enlace que le enviamos antes de ingresar.';
  if (/User already registered/i.test(msg)) return 'Ya existe un usuario con ese correo.';
  if (/Password should be at least/i.test(msg)) return 'La contraseña es demasiado corta.';
  // Los mensajes de las reglas de negocio ya están en español (supabase/migrations).
  return msg;
}
