export class Fault extends Error {
  constructor(public code: string, public recoverable = false, public global = false) { super(code); }
}
export type Variable = { key: string; value: string };
export type JsonConfig = { configuracoes_gerais: { variaveis: { identificador_fluxo: string; nome_bot: string; variaveis_de_configuracao: Variable[] }; fluxo: object | null } };
export const createJsonConfig = (): JsonConfig => ({ configuracoes_gerais: { variaveis: { identificador_fluxo: '', nome_bot: '', variaveis_de_configuracao: [] }, fluxo: null } });
export type Candidate = { nome_bot: string; source_url: string; builder_url: string };
export type FileRecord = { path: string; sha256: string; bytes: number };
export type Bot = Candidate & { safe: string; status: string; etapa: string; tentativas_por_etapa: Record<string, number>; arquivos: Record<string, FileRecord>; avisos: string[]; erro: string | null; iniciado_em?: string; finalizado_em?: string };
export type Manifest = { schema_version: number; run_id: string; router: string; iniciado_em: string; finalizado_em: string | null; fuso_apresentacao: string; status: string; descoberta: { completa: boolean; evidencia_fim: string | null; total_informado_portal: number | null; total_unicos: number }; bots: Bot[]; erro?: string };
export function validateConfig(value: unknown, bot?: string): asserts value is JsonConfig {
  const c = value as JsonConfig;
  const v = c?.configuracoes_gerais?.variaveis;
  if (!v || typeof v.nome_bot !== 'string' || !v.nome_bot.trim() || (bot !== undefined && v.nome_bot !== bot) || typeof v.identificador_fluxo !== 'string' || !v.identificador_fluxo.trim() || !Array.isArray(v.variaveis_de_configuracao) || v.variaveis_de_configuracao.some(x => typeof x.key !== 'string' || !x.key.trim() || typeof x.value !== 'string') || c.configuracoes_gerais.fluxo === null || typeof c.configuracoes_gerais.fluxo !== 'object') throw new Fault('CONTRATO_INVALIDO');
}
