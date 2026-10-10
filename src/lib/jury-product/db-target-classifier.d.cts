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