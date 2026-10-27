/** I-079: deleted connections only under the '삭제된 연결' filter. */
export function filterConnectionRows<T extends { connectionStatus: string }>(rows: readonly T[], showDeleted: boolean): T[] {
  return rows.filter((row) => (row.connectionStatus === 'DISCONNECTED') === showDeleted);
}

