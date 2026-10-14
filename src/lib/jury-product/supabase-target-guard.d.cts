export type SupabaseTargetCode =
  | 'SUPABASE_TARGET_SKIPPED'
  | 'SUPABASE_TARGET_OK'
  | 'SUPABASE_TARGET_OK_KEY_REF_UNVERIFIABLE'
  | 'SUPABASE_TARGET_CONFIG'
  | 'BLOCKED_SUPABASE_PRODUCTION'
  | 'BLOCKED_SUPABASE_URL_MISSING'
  | 'BLOCKED_SUPABASE_UNVERIFIED'
  | 'BLOCKED_SUPABASE_KEY_MISSING'
  | 'BLOCKED_SUPABASE_KEY_MISMATCH'
  | 'BLOCKED_SUPABASE_KEY_UNDECODABLE';
export type SupabaseTargetEnv = { readonly [key: string]: string | undefined };
export type SupabaseTargetOptions = {
  checkAnonKey?: boolean;
  requireServiceKey?: boolean;
  checkServiceKeyIfPresent?: boolean;
};
export type SupabaseTargetResult = { ok: boolean; code: SupabaseTargetCode; keyRef?: 'verified' | 'unverifiable' };
export declare function isPreviewScope(env: SupabaseTargetEnv): boolean;
export declare function checkSupabaseTarget(env: SupabaseTargetEnv, opts?: SupabaseTargetOptions): SupabaseTargetResult;
export declare function requireSupabaseTarget(env: SupabaseTargetEnv, opts?: SupabaseTargetOptions): SupabaseTargetResult;
