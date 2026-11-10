const terminal = {
  JOB_STATUS_SUCCEEDED: '已完成',
  JOB_STATUS_COMPILE_FAILED: '编译失败',
  JOB_STATUS_RUNTIME_FAILED: '运行失败',
  JOB_STATUS_TIME_LIMIT_EXCEEDED: '超时',
  JOB_STATUS_MEMORY_LIMIT_EXCEEDED: '内存超限',
  JOB_STATUS_OUTPUT_LIMIT_EXCEEDED: '输出超限',
  JOB_STATUS_CANCELED: '已停止',
  JOB_STATUS_SYSTEM_ERROR: '系统错误',
};
export function isTerminal(status: string): boolean { return status in terminal; }
export function runState(status: string): string {
  return terminal[status as keyof typeof terminal] ?? ({ JOB_STATUS_QUEUED: '排队中', JOB_STATUS_RUNNING: '运行中', JOB_STATUS_COMPILING: '编译中', JOB_STATUS_PENDING: '等待中' } as Record<string, string>)[status] ?? status;
}
export function stateCategory(status: string): string {
  return status === 'JOB_STATUS_SUCCEEDED' ? 'completed' : status === 'JOB_STATUS_CANCELED' ? 'cancelled' : isTerminal(status) ? 'failed' : 'running';
}
