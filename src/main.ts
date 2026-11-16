// Boot entry. Owned by integration passes only: wave-1 lanes (physics, world,
// gameplay) must NOT edit this file. A later integration task wires them in.
import { bootPlaceholder } from './core/boot';

bootPlaceholder(document.getElementById('app')!);
