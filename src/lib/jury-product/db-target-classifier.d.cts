export type ConnectionClass = 'allowed' | 'production' | 'rejected';
export type DbTargetClass = 'ok' | 'production' | 'config' | 'unverified';
export type RefConfig = { previewRef: string; productionRefs: readonly string[] };
export type DbTargetEnv = { readonly [key: string]: string | undefined };

export declare function validRefConfig(refs: RefConfig | null | undefined): refs is RefConfig;
export declare function readRefConfig(env: DbTargetEnv): RefConfig | null;
export declare function readProductionRefs(env: DbTargetEnv): string[];
export declare function parsePostgresUrl(value: string): URL | null;
export declare function classifyConnectionUrl(value: string, refs: RefConfig | null | undefined): ConnectionClass;
export declare function classifyDbTarget(env: DbTargetEnv): DbTargetClass;

export type DiagnosticVar = 'DATABASE_URL' | 'DIRECT_URL';
export type DiagnosticReason =
  | 'OK' | 'URL_MISSING' | 'URL_PARSE_INVALID' | 'BAD_SCHEME' | 'HOST_OTHER' | 'PORT_6543' | 'PORT_MISSING'
  | 'PORT_OTHER' | 'USER_REF_MISSING' | 'SSL_PARAM' | 'PRODUCTION_REF' | 'UNVERIFIED_OTHER' | 'DIAGNOSTIC_UNAVAILABLE';
export type UrlDiagnostic = {
  var: DiagnosticVar;
  present: boolean;
  parse: 'ok' | 'invalid' | 'bad_scheme' | 'unavailable';
  hostClass: 'direct_preview' | 'shared_pooler' | 'other' | 'unavailable';
  portClass: '5432' | '6543' | 'none' | 'other' | 'unavailable';
  userRefMatch: boolean | 'unavailable';
  prodRefMention: boolean | 'unavailable';
  sslPolicy: 'pass' | 'fail' | 'unavailable';
  reason: DiagnosticReason;
};
export declare function diagnoseUrl(name: DiagnosticVar, env: DbTargetEnv): UrlDiagnostic;
export declare function diagnoseDbTarget(env: DbTargetEnv): UrlDiagnostic[];
