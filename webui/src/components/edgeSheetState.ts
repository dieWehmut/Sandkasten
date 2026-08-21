let bodyLockCount = 0;
let bodyOverflowBeforeLock = '';

export function lockBodyScroll(): void {
  if (typeof document === 'undefined') return;
  if (bodyLockCount === 0) bodyOverflowBeforeLock = document.body.style.overflow;
  bodyLockCount += 1;
  document.body.style.overflow = 'hidden';
}

export function unlockBodyScroll(): void {
  if (typeof document === 'undefined' || bodyLockCount === 0) return;
  bodyLockCount -= 1;
  if (bodyLockCount === 0) document.body.style.overflow = bodyOverflowBeforeLock;
}
