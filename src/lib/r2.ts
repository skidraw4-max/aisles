import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

type R2Config = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBase: string;
};

type SupabaseStorageConfig = {
  url: string;
  serviceKey: string;
  bucket: string;
};

/** R2 미설정·업로드 실패 후 Supabase Storage 폴백도 없을 때 */
export const MEDIA_STORAGE_NOT_CONFIGURED = 'MEDIA_STORAGE_NOT_CONFIGURED';

/**
 * R2 설정 (서버 전용 — API Route / Server Actions 에서만 사용)
 *
 * 지원하는 환경 변수 조합:
 * - 엔드포인트: `R2_ENDPOINT`(전체 URL) 또는 `R2_ACCOUNT_ID`(서브도메인만으로 `https://{id}.r2.cloudflarestorage.com` 구성)
 * - 퍼블릭 베이스: `R2_PUBLIC_BASE_URL` 또는 `NEXT_PUBLIC_R2_PUBLIC_URL` 또는 `R2_PUBLIC_DOMAIN`(별칭, 끝 `/` 없이 전체 URL)
 * - 공통: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
 */
export function getR2Config(): R2Config | null {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET_NAME?.trim();

  const publicBaseRaw =
    process.env.R2_PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL?.trim() ||
    process.env.R2_PUBLIC_DOMAIN?.trim();
  let publicBase = publicBaseRaw?.replace(/\/$/, '') ?? '';
  if (publicBase && !/^https?:\/\//i.test(publicBase)) {
    publicBase = `https://${publicBase}`;
  }

  const endpointFromEnv = process.env.R2_ENDPOINT?.trim();
  const accountId = process.env.R2_ACCOUNT_ID?.trim();

  let endpoint = '';
  if (endpointFromEnv) {
    endpoint = endpointFromEnv.replace(/\/$/, '');
    if (!/^https?:\/\//i.test(endpoint)) {
      endpoint = `https://${endpoint}`;
    }
  } else if (accountId) {
    endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  }

  if (!accessKeyId || !secretAccessKey || !bucket || !publicBase || !endpoint) {
    return null;
  }

  return { endpoint, accessKeyId, secretAccessKey, bucket, publicBase };
}

/**
 * R2 대안: Supabase Storage (서버에서만 service role 사용).
 * Dashboard → Storage 에 공개 버킷 생성 후 `SUPABASE_SERVICE_ROLE_KEY` 설정.
 */
export function getSupabaseStorageUploadConfig(): SupabaseStorageConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'uploads';
  if (!url || !serviceKey) return null;
  return { url, serviceKey, bucket };
}

async function uploadViaSupabaseStorage(
  key: string,
  body: Buffer,
  contentType: string,
  cfg: SupabaseStorageConfig
): Promise<{ publicUrl: string } | { error: string }> {
  const supabase = createClient(cfg.url, cfg.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await supabase.storage.from(cfg.bucket).upload(key, body, {
    contentType,
    upsert: false,
  });

  if (error) {
    console.error('[supabase storage upload]', error.message);
    return { error: error.message || 'Supabase Storage 업로드에 실패했습니다.' };
  }

  const { data } = supabase.storage.from(cfg.bucket).getPublicUrl(key);
  return { publicUrl: data.publicUrl };
}

/**
 * 공개 URL로 서빙되는 객체 업로드. R2가 있으면 R2, 없으면 Supabase Storage(service role).
 */
export async function uploadPublicObject(
  key: string,
  body: Buffer,
  contentType: string
): Promise<{ publicUrl: string } | { error: string }> {
  const r2 = getR2Config();
  if (r2) {
    try {
      const client = new S3Client({
        region: 'auto',
        endpoint: r2.endpoint,
        credentials: {
          accessKeyId: r2.accessKeyId,
          secretAccessKey: r2.secretAccessKey,
        },
      });

      await client.send(
        new PutObjectCommand({
          Bucket: r2.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        })
      );

      const publicUrl = `${r2.publicBase}/${key}`;
      return { publicUrl };
    } catch (e) {
      console.error('[r2 upload]', e);
      const sup = getSupabaseStorageUploadConfig();
      if (sup) {
        return uploadViaSupabaseStorage(key, body, contentType, sup);
      }
      return { error: e instanceof Error ? e.message : 'R2 업로드에 실패했습니다.' };
    }
  }

  const sup = getSupabaseStorageUploadConfig();
  if (sup) {
    return uploadViaSupabaseStorage(key, body, contentType, sup);
  }

  logMediaStorageMisconfig();
  return { error: MEDIA_STORAGE_NOT_CONFIGURED };
}

/** Vercel/로컬 서버 로그용 — 값은 출력하지 않고 이름만 */
function logMediaStorageMisconfig() {
  const r2Missing: string[] = [];
  if (!process.env.R2_ACCESS_KEY_ID?.trim()) r2Missing.push('R2_ACCESS_KEY_ID');
  if (!process.env.R2_SECRET_ACCESS_KEY?.trim()) r2Missing.push('R2_SECRET_ACCESS_KEY');
  if (!process.env.R2_BUCKET_NAME?.trim()) r2Missing.push('R2_BUCKET_NAME');
  const pub =
    process.env.R2_PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL?.trim() ||
    process.env.R2_PUBLIC_DOMAIN?.trim();
  if (!pub)
    r2Missing.push('R2_PUBLIC_BASE_URL, NEXT_PUBLIC_R2_PUBLIC_URL 또는 R2_PUBLIC_DOMAIN');
  const hasEndpoint = !!process.env.R2_ENDPOINT?.trim();
  const hasAccount = !!process.env.R2_ACCOUNT_ID?.trim();
  if (!hasEndpoint && !hasAccount) r2Missing.push('R2_ENDPOINT 또는 R2_ACCOUNT_ID');

  const supMissing: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) supMissing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) supMissing.push('SUPABASE_SERVICE_ROLE_KEY');

  console.warn(
    '[media-storage] 업로드 불가. R2를 쓰려면 모두 필요 →',
    r2Missing.join(', ') || '(없음 — 변수명 오타·Vercel 환경 스코프 확인)',
    '| Supabase Storage 폴백 →',
    supMissing.join(', ') || '(없음)',
    '| 버킷: R2_BUCKET_NAME / SUPABASE_STORAGE_BUCKET(미설정 시 uploads)'
  );
}
