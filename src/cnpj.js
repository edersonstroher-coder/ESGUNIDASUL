export const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');

// Excel costuma remover zeros à esquerda: completa quando faltam 1 ou 2 dígitos.
export function normCnpj(v) {
  let d = onlyDigits(v);
  if (d.length === 12 || d.length === 13) d = d.padStart(14, '0');
  return d;
}

export function isValidCnpj(v) {
  const d = onlyDigits(v);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = (len) => {
    let sum = 0, pos = len - 7;
    for (let i = len; i >= 1; i--) {
      sum += Number(d[len - i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}
