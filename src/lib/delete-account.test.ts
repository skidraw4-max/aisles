import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteUserJuryRecords } from './jury-account-deletion';

test('deletes account-owned Jury links in foreign-key-safe order', async () => {
  const calls: Array<{ table: string; where: Record<string, string> }> = [];
  const tx = {
    organizationInvitation: {
      deleteMany: async ({ where }: { where: Record<string, string> }) => {
        calls.push({ table: 'organizationInvitation', where });
      },
    },
    juryServiceMember: {
      deleteMany: async ({ where }: { where: Record<string, string> }) => {
        calls.push({ table: 'juryServiceMember', where });
      },
    },
    juryMembership: {
      deleteMany: async ({ where }: { where: Record<string, string> }) => {
        calls.push({ table: 'juryMembership', where });
      },
    },
  };

  await deleteUserJuryRecords(tx as never, 'user-123');

  assert.deepEqual(calls, [
    { table: 'organizationInvitation', where: { invitedBy: 'user-123' } },
    { table: 'juryServiceMember', where: { userId: 'user-123' } },
    { table: 'juryMembership', where: { userId: 'user-123' } },
  ]);
});
