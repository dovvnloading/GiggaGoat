import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(repoRoot, 'src');
const publicRoot = join(repoRoot, 'public');
const assetLiteral = /^assets\/.+\.(?:glb|gltf|png|webp|jpg|mp3|ogg|json)$/i;

type GltfReference = { uri?: string };
type Gltf = { buffers?: GltfReference[]; images?: GltfReference[] };

function* typescriptFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* typescriptFiles(path);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) yield path;
  }
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

it('resolves all literal asset paths and their glTF resources under public/', () => {
  const problems: string[] = [];
  const gltfs = new Set<string>();

  for (const filename of typescriptFiles(sourceRoot)) {
    const source = ts.createSourceFile(
      filename,
      readFileSync(filename, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const asset = node.text;
        if (assetLiteral.test(asset)) {
          const target = resolve(publicRoot, asset);
          if (!isFile(target)) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
            problems.push(relative(repoRoot, filename) + ':' + (line + 1) + ': missing public/' + asset);
          } else if (asset.toLowerCase().endsWith('.gltf')) {
            gltfs.add(target);
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  for (const gltfPath of [...gltfs].sort()) {
    const label = relative(repoRoot, gltfPath);
    let gltf: Gltf;
    try {
      gltf = JSON.parse(readFileSync(gltfPath, 'utf8')) as Gltf;
    } catch {
      problems.push(label + ': invalid glTF JSON');
      continue;
    }

    for (const reference of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) {
      const uri = reference.uri;
      if (!uri || /^(?:data:|https?:\/\/|\/\/)/i.test(uri)) continue;

      let decoded: string;
      try {
        decoded = decodeURIComponent(uri.split(/[?#]/, 1)[0] ?? '');
      } catch {
        problems.push(label + ': invalid resource URI ' + uri);
        continue;
      }

      const target = resolve(dirname(gltfPath), decoded);
      const withinPublic = relative(publicRoot, target);
      if (
        withinPublic === '..' ||
        withinPublic.startsWith('..' + sep) ||
        isAbsolute(withinPublic) ||
        !isFile(target)
      ) {
        problems.push(label + ': missing resource ' + uri);
      }
    }
  }

  if (problems.length) {
    throw new Error(
      'Invalid public asset references (' + problems.length + '):\n' +
        problems.sort().map((problem) => '  - ' + problem).join('\n'),
    );
  }
});
