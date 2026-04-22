/** MIT OpenCourseWare — LAB(RECIPE) (@mitocw) */
export const YOUTUBE_MIT_OCW_CHANNEL_ID = 'UCEBb1b_L6zDS3xTUrIALZOw';

/** Google DeepMind — AI 트렌드 LOUNGE (@googledeepmind) */
export const YOUTUBE_DEEPMIND_CHANNEL_ID = 'UCP7jMXSY2xbc3KCAE0MHQ-A';

export const YOUTUBE_CHANNEL_FEED = (channelId: string) =>
  `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;

export const YOUTUBE_WATCH_URL = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

export const YOUTUBE_THUMBNAIL_HQ = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

/** 채널당 한 번의 동기화에서 시도할 최신 영상 수 (스캔만) */
export const YOUTUBE_FEED_SCAN_PER_CHANNEL = 5;

/** 채널당 실제로 새 글로 등록할 최대 건수 (성공 시 중단) */
export const YOUTUBE_MAX_NEW_PER_CHANNEL_PER_RUN = 1;
