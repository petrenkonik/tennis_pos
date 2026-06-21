import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes with conflict resolution.
 * Combines `clsx` (conditional class names) and `tailwind-merge`
 * (deduplicates conflicting Tailwind utilities, last-wins).
 *
 * @example cn('px-2', condition && 'px-4') → 'px-4'
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
