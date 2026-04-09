import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

type R2Config = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBase: string;
};

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

export async function uploadPublicObject(
  key: string,
  body: Buffer,
  contentType: string
): Promise<{ publicUrl: string } | { error: string }> {
  const cfg = getR2Config();
  if (!cfg) return { error: 'R2 is not configured' };

  const client = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });

  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  const publicUrl = `${cfg.publicBase}/${key}`;
  return { publicUrl };
}
