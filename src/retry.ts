import { setTimeout } from 'node:timers/promises';
import { errors } from 'playwright';
import { Fault } from './model.js';
export function errorCode(e: unknown) {
  if (e instanceof Fault) return e.code;
  if (e instanceof errors.TimeoutError) return 'TIMEOUT';
  const code = (e as NodeJS.ErrnoException)?.code;
  if (code === 'ERR_USE_AFTER_CLOSE') return 'TERMINAL_ENTRADA_FECHADA';
  if (code === 'ABORT_ERR' || (e as Error)?.name === 'AbortError') return 'CANCELADA';
  const message = e instanceof Error ? e.message : '';
  if (/strict mode violation/i.test(message)) return 'SELETOR_AMBIGUO';
  if (/Target page, context or browser has been closed|Target closed/i.test(message)) return 'NAVEGADOR_OU_ABA_FECHADO';
  if (/net::ERR_ABORTED|interrupted by another navigation/i.test(message)) return 'NAVEGACAO_INTERROMPIDA';
  if (/net::ERR_/i.test(message)) return 'FALHA_DE_REDE_NO_NAVEGADOR';
  return ['ENOSPC','EACCES','EPERM','EIO'].includes(code ?? '') ? `DISCO_${code}` : 'ERRO_NAO_CLASSIFICADO';
}
export function globalError(e: unknown) { return e instanceof Fault && e.global || errorCode(e).startsWith('DISCO_'); }
export async function withRetry<T>(operation: (attempt: number) => Promise<T>, maxRetries: number, delay: number, failure: (e: unknown, attempt: number) => Promise<void>, signal?: AbortSignal) {
  for (let n = 1; ; n++) {
    signal?.throwIfAborted();
    try { return await operation(n); } catch (e) {
      await failure(e, n);
      const recoverable = e instanceof Fault ? e.recoverable : e instanceof errors.TimeoutError;
      if (!recoverable || globalError(e) || n > maxRetries) throw e;
      await setTimeout(delay, undefined, { signal });
    }
  }
}
