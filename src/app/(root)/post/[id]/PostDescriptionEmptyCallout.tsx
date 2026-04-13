import type { Category } from '@prisma/client';
import { MIN_POST_DESCRIPTION_LENGTH } from '@/lib/post-description-policy';
import styles from './post.module.css';

const PROMPT_TIP =
  '이 프롬프트에 대한 팁이나 생성 의도를 공유해주세요. 설명을 채우면 독자와 검색엔진이 글의 맥락을 이해하는 데 도움이 됩니다.';

const GENERAL_TIP =
  '이 글에 대한 설명이나 작성 배경을 공유해 주세요. 독자와 검색엔진이 맥락을 파악하는 데 도움이 됩니다.';

type Props = { category: Category };

export function PostDescriptionEmptyCallout({ category }: Props) {
  const promptish = category === 'RECIPE' || category === 'GALLERY';
  return (
    <section
      className={styles.descriptionEmptyCallout}
      aria-label="설명 안내"
      role="note"
    >
      <p className={styles.descriptionEmptyCalloutMain}>{promptish ? PROMPT_TIP : GENERAL_TIP}</p>
      <p className={styles.descriptionEmptyCalloutMeta}>
        새로 작성 시 LOUNGE를 제외한 복도는 설명을 <strong>{MIN_POST_DESCRIPTION_LENGTH}자 이상</strong> 입력해야
        게시할 수 있습니다.
      </p>
    </section>
  );
}
