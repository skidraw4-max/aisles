export type StanceChoice = 'AGREE' | 'DISAGREE';

export type StanceStore = {
  upsert: (
    userId: string,
    postId: string,
    choice: StanceChoice,
  ) => Promise<StanceChoice>;
};

export async function upsertStance(
  store: StanceStore,
  userId: string,
  postId: string,
  choice: StanceChoice,
): Promise<StanceChoice> {
  if (choice !== 'AGREE' && choice !== 'DISAGREE') {
    throw new Error('invalid stance');
  }
  return store.upsert(userId, postId, choice);
}
