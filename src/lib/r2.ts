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
 * - 퍼블릭 베이스: `R2_PUBLIC_BASE_URL` 또는 `NEXT_PUBLIC_R2_PUBLIC_URL`(둘 다 서버에서 읽힘)
 * - 공통: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
 */
export function getR2Config(): R2Config | null {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET_NAME?.trim();

  const publicBaseRaw =
    process.env.R2_PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL?.trim();
  const publicBase = publicBaseRaw?.replace(/\/$/, '') ?? '';

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

  return { error: MEDIA_STORAGE_NOT_CONFIGURED };
}
