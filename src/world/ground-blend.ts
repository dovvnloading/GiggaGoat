/** A periodic control field in material UV space. Red and green choose the
 * four interior finishes. Blue breaks up the narrow shoulder into the turf. */
export const blendSize = 256;
export const blendPeriod = 8;

function ramp(value: number, low: number, high: number) {
  const x = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return Math.round(255 * x * x * (3 - 2 * x));
}

function buildField() {
  const data = new Uint8Array(blendSize * blendSize * 4);
  for (let y = 0; y < blendSize; y++) for (let x = 0; x < blendSize; x++) {
    const u = (x + .5) * 2 * Math.PI / blendSize, v = (y + .5) * 2 * Math.PI / blendSize;
    const s = Math.sin(u + v + .64 * Math.sin(2 * v - u)) + .36 * Math.cos(3 * u - v);
    const t = Math.cos(u - v + .71 * Math.cos(2 * u + v)) + .31 * Math.sin(u + 3 * v);
    const i = (y * blendSize + x) * 4;
    data[i] = ramp(s, -.48, .48);
    data[i + 1] = ramp(t, -.49, .49);
    data[i + 2] = ramp(Math.cos(4 * u + 3 * v) * .6 + Math.sin(5 * v - 2 * u) * .4, -1, 1);
    data[i + 3] = 255;
  }
  return data;
}

export const groundBlendField = buildField();

export function blendFieldIndex(u: number, v: number) {
  const x = Math.floor(u * (blendSize / blendPeriod)) & (blendSize - 1);
  const y = Math.floor(v * (blendSize / blendPeriod)) & (blendSize - 1);
  return (y * blendSize + x) * 4;
}
