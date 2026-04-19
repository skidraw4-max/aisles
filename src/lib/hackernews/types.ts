/** https://github.com/HackerNews/API — item JSON */
export type HackerNewsItem = {
  id: number;
  type?: string;
  title?: string;
  url?: string;
  score?: number;
  by?: string;
  time?: number;
  descendants?: number;
  kids?: number[];
  text?: string;
};
