import initialize from './software-raster.wasm?init';

type DrawBatch = (width: number, height: number, pixels: number, depths: number, vertices: number,
  indices: number, colours: number, intersections: number, faces: number,
  side: number, bias: number, smooth: number) => number;
type ProjectBatch = (coords: number, vertices: number, matrix: number, tints: number, count: number,
  halfWidth: number, halfHeight: number, near: number, painted: number) => void;

// Scratch space is shared by successive mesh draws. Larger meshes use the scalar path.
const MAX_VERTICES = 32768, MAX_FACES = 65536, PIXELS = 65536;

export class SoftwareRaster {
  vertices!: Float32Array;
  vertexBits!: Uint32Array;
  clipCoordinates!: Float32Array;
  private matrix!: Float32Array;
  private tints!: Uint32Array;
  private indices!: Uint32Array;
  private colours!: Uint32Array;
  private intersections!: Uint32Array;
  private width = 0;
  private height = 0;
  private depthOffset = 0;

  constructor(private readonly memory: WebAssembly.Memory, private readonly drawBatch: DrawBatch,
    private readonly projectBatch: ProjectBatch) {}

  static async create(): Promise<SoftwareRaster | undefined> {
    try {
      const memory = new WebAssembly.Memory({ initial: 1 });
      const instance = await initialize({ env: { memory } });
      return new SoftwareRaster(memory, instance.exports.drawBatch as DrawBatch, instance.exports.projectBatch as ProjectBatch);
    } catch {
      // Browsers without WASM SIMD continue with the scalar renderer.
      return undefined;
    }
  }

  resize(width: number, height: number): { colour: Uint8ClampedArray<ArrayBuffer>; depth: Float32Array } {
    this.width = width; this.height = height;
    const count = width * height;
    this.depthOffset = PIXELS + count * 4;
    const vertexOffset = this.depthOffset + count * 4;
    const indexOffset = vertexOffset + MAX_VERTICES * 20;
    const colourOffset = indexOffset + MAX_FACES * 12;
    const clipOffset = colourOffset + MAX_FACES * 4;
    const coordOffset = clipOffset + MAX_FACES * 4;
    const tintOffset = coordOffset + MAX_VERTICES * 12, matrixOffset = tintOffset + MAX_VERTICES * 4;
    const pages = Math.ceil((matrixOffset + 64 - this.memory.buffer.byteLength) / 65536);
    if (pages > 0) this.memory.grow(pages);
    const bytes = this.memory.buffer;
    this.vertices = new Float32Array(bytes, vertexOffset, MAX_VERTICES * 5);
    this.vertexBits = new Uint32Array(bytes, vertexOffset, MAX_VERTICES * 5);
    this.indices = new Uint32Array(bytes, indexOffset, MAX_FACES * 3);
    this.colours = new Uint32Array(bytes, colourOffset, MAX_FACES);
    this.intersections = new Uint32Array(bytes, clipOffset, MAX_FACES);
    this.clipCoordinates = new Float32Array(bytes, coordOffset, MAX_VERTICES * 3);
    this.tints = new Uint32Array(bytes, tintOffset, MAX_VERTICES);
    this.matrix = new Float32Array(bytes, matrixOffset, 16);
    return {
      colour: new Uint8ClampedArray(bytes, PIXELS, count * 4),
      depth: new Float32Array(bytes, this.depthOffset, count),
    };
  }

  accepts(vertices: number, faces: number): boolean { return vertices <= MAX_VERTICES && faces <= MAX_FACES; }

  project(positions: Float32Array, matrix: readonly number[], near: number, tints?: Uint32Array): void {
    this.clipCoordinates.set(positions);
    this.matrix.set(matrix);
    if (tints) this.tints.set(tints);
    this.projectBatch(this.clipCoordinates.byteOffset, this.vertices.byteOffset, this.matrix.byteOffset,
      this.tints.byteOffset, positions.length / 3, this.width * .5, this.height * .5, near, Number(!!tints));
  }

  draw(indices: Uint32Array, colours: Uint32Array | undefined, side: number, bias: number): Uint32Array {
    this.indices.set(indices);
    if (colours) this.colours.set(colours);
    const count = this.drawBatch(this.width, this.height, PIXELS, this.depthOffset,
      this.vertices.byteOffset, this.indices.byteOffset, this.colours.byteOffset, this.intersections.byteOffset,
      indices.length / 3, side, bias, Number(!colours));
    return this.intersections.subarray(0, count);
  }
}
