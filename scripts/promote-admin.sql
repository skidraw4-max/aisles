-- 특정 이메일 계정을 ADMIN 으로 승격 (Supabase SQL Editor / psql 등에서 실행)
-- User 행이 없으면(아직 sync-profile 전이면) 먼저 사이트에 로그인해 프로필이 생성된 뒤 실행하세요.

UPDATE "User"
SET role = 'ADMIN'::"Role"
WHERE email = 'skidraw4@gmail.com';

-- 적용 행 수 확인
-- SELECT id, email, role FROM "User" WHERE email = 'skidraw4@gmail.com';
