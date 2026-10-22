-- 뉴스 다이제스트 구독 설정
CREATE TYPE "DigestFrequency" AS ENUM ('DAILY', 'WEEKLY');

ALTER TABLE "User"
ADD COLUMN "newsletterSubscribed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "digestFrequency" "DigestFrequency" NOT NULL DEFAULT 'DAILY';

CREATE INDEX "User_newsletterSubscribed_digestFrequency_idx"
ON "User"("newsletterSubscribed", "digestFrequency");
