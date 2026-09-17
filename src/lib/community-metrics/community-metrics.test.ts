/**
 * Run: node --import tsx --test src/lib/community-metrics/*.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ACTIVE_USER_ACTIVITY_KINDS,
  countActiveUsersLast7d,
  type ActiveUsersDb,
} from './active-users';
import { countViewsLast7d, utcDayStart, type ViewsLast7dDb } from './views-last-7d';
import {
  shouldSendCommentNotify,
  buildCommentNotifyEmail,
} from './comment-notify';
import { upsertStance, type StanceChoice } from './post-stance';

describe('active users definition', () => {
  it('includes post, comment, like, bookmark, gameScore', () => {
    assert.deepEqual(ACTIVE_USER_ACTIVITY_KINDS, [
      'post',
      'comment',
      'like',
      'bookmark',
      'gameScore',
    ]);
  });

  it('counts distinct users across activity kinds in the window', async () => {
    const since = new Date('2026-09-10T00:00:00.000Z');
    const db: ActiveUsersDb = {
      post: {
        findMany: async () => [{ authorId: 'u1' }, { authorId: 'u2' }],
      },
      comment: {
        findMany: async () => [{ authorId: 'u2' }, { authorId: 'u3' }],
      },
      postLike: {
        findMany: async () => [{ userId: 'u4' }],
      },
      bookmark: {
        findMany: async () => [{ userId: 'u1' }],
      },
      gameScore: {
        findMany: async () => [{ userId: 'u5' }],
      },
    };

    const n = await countActiveUsersLast7d(db, since);
    assert.equal(n, 5);
  });
});

describe('viewsLast7d', () => {
  it('sums PostViewDaily counts for days in window', async () => {
    const sinceDay = utcDayStart(new Date('2026-09-10T12:00:00.000Z'));
    const db: ViewsLast7dDb = {
      postViewDaily: {
        aggregate: async (args) => {
          assert.ok(args.where?.day?.gte);
          assert.equal(
            (args.where.day.gte as Date).toISOString().slice(0, 10),
            '2026-09-10',
          );
          return { _sum: { count: 42 } };
        },
      },
    };
    assert.equal(await countViewsLast7d(db, sinceDay), 42);
  });

  it('returns 0 when sum is null', async () => {
    const db: ViewsLast7dDb = {
      postViewDaily: {
        aggregate: async () => ({ _sum: { count: null } }),
      },
    };
    assert.equal(await countViewsLast7d(db, utcDayStart(new Date())), 0);
  });
});

describe('comment notify', () => {
  it('skips when commenter is post author', () => {
    assert.equal(
      shouldSendCommentNotify({
        postAuthorId: 'a',
        commenterId: 'a',
        postAuthorEmail: 'a@example.com',
        lastSentAt: null,
        now: new Date('2026-09-17T12:00:00.000Z'),
      }),
      false,
    );
  });

  it('skips when no email', () => {
    assert.equal(
      shouldSendCommentNotify({
        postAuthorId: 'a',
        commenterId: 'b',
        postAuthorEmail: null,
        lastSentAt: null,
        now: new Date('2026-09-17T12:00:00.000Z'),
      }),
      false,
    );
  });

  it('skips when throttled within 10 minutes', () => {
    const now = new Date('2026-09-17T12:00:00.000Z');
    assert.equal(
      shouldSendCommentNotify({
        postAuthorId: 'a',
        commenterId: 'b',
        postAuthorEmail: 'a@example.com',
        lastSentAt: new Date('2026-09-17T11:55:00.000Z'),
        now,
      }),
      false,
    );
  });

  it('allows when outside throttle window', () => {
    const now = new Date('2026-09-17T12:00:00.000Z');
    assert.equal(
      shouldSendCommentNotify({
        postAuthorId: 'a',
        commenterId: 'b',
        postAuthorEmail: 'a@example.com',
        lastSentAt: new Date('2026-09-17T11:49:00.000Z'),
        now,
      }),
      true,
    );
  });

  it('builds email with post title and deep link', () => {
    const mail = buildCommentNotifyEmail({
      postTitle: 'Hello',
      postId: 'p1',
      commenterUsername: 'bob',
      commentExcerpt: 'nice post',
      siteOrigin: 'https://aisles.hub',
    });
    assert.match(mail.subject, /댓글/);
    assert.match(mail.text, /bob/);
    assert.match(mail.html, /\/post\/p1/);
  });
});

describe('post stance', () => {
  it('upserts agree/disagree for a user', async () => {
    const store = new Map<string, StanceChoice>();
    const db = {
      async upsert(userId: string, postId: string, choice: StanceChoice) {
        store.set(`${postId}:${userId}`, choice);
        return choice;
      },
      async counts(postId: string) {
        let agree = 0;
        let disagree = 0;
        for (const [k, v] of store) {
          if (!k.startsWith(`${postId}:`)) continue;
          if (v === 'AGREE') agree += 1;
          else disagree += 1;
        }
        return { agree, disagree };
      },
    };
    await upsertStance(db, 'u1', 'p1', 'AGREE');
    await upsertStance(db, 'u2', 'p1', 'DISAGREE');
    await upsertStance(db, 'u1', 'p1', 'DISAGREE');
    assert.deepEqual(await db.counts('p1'), { agree: 0, disagree: 2 });
  });
});
