import { isValidElement, type ReactElement } from 'react';

const MAX_DEPTH = 5;

/**
 * Value equality for props, bounded in depth. Functions are ignored (memoScreen hands the screen stable ones
 * that call the newest closure); React elements compare by type, key and props; anything that is not a plain
 * object or array (Map, Set, class instances, DOM nodes) compares by reference.
 */
export function propValuesEqual(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === 'function' && typeof b === 'function') return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (depth >= MAX_DEPTH) return false;
  if (isValidElement(a) || isValidElement(b)) {
    if (!isValidElement(a) || !isValidElement(b)) return false;
    const left = a as ReactElement<Record<string, unknown>>;
    const right = b as ReactElement<Record<string, unknown>>;
    return left.type === right.type && left.key === right.key && propValuesEqual(left.props, right.props, depth + 1);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) if (!propValuesEqual(a[index], b[index], depth + 1)) return false;
    return true;
  }
  const prototype = Object.getPrototypeOf(a);
  if (prototype !== Object.getPrototypeOf(b) || (prototype !== Object.prototype && prototype !== null)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!(key in right) || !propValuesEqual(left[key], right[key], depth + 1)) return false;
  }
  return true;
}
