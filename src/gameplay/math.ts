export function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}
export function nonNegative(value: number, label: string): void {
  assertFinite(value, label);
  if (value < 0) throw new RangeError(`${label} must be non-negative`);
}
export function integer(value: number, label: string): void {
  nonNegative(value, label);
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a non-negative safe integer`);
}
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}
export function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number') throw new TypeError(`${label} must be a number`);
  assertFinite(value, label);
  return value;
}
export function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`);
  return value;
}
export function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  return value;
}
/** Deep copy JSON-shaped snapshot data; never expose internal mutable arrays. */
export function copyJSON<T>(state: T): T {
  return JSON.parse(JSON.stringify(state)) as T;
}
