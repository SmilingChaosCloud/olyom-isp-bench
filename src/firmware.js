// Identifies what the user loaded and returns the PEN-F main block when it has the layout the research mapped.
import { walk, readBlock } from '../vendor/om-emu/olyfw.mjs';
import { sha256 } from './sha256.js';
export const PENF = { len: 21364672, sha: 'a2eb1d1f1afe47cce148e9aae0a04dfb82547d9de9437d342e012341140913f4', base: 0x60021020 };

// file: a Blob, or anything with size and slice(a, b).arrayBuffer()
export async function identify(file) {
  const read = async (o, n) => new Uint8Array(await file.slice(o, o + n).arrayBuffer());
  const { blocks } = await walk(read, file.size);
  let main = null, source = 'decoded main block', model = null, checksum = null;
  if (blocks.length) {
    const b = blocks.find((x) => x.typ === 'OE' && x.flags === 0x0100);
    if (!b) return { status: 'unsupported', detail: 'This container has no main code block (flags 0x0100).' };
    model = b.model; source = '.BIN container';
    const r = await readBlock(read, b);
    main = r.data; checksum = r.cksum_ok;
  } else {
    main = await read(0, file.size);
    if (main.length !== PENF.len) return { status: 'unsupported', detail: `This file (${file.size.toLocaleString('en')} bytes) is neither an Olympus .BIN nor a PEN-F 3.1 main block.` };
  }
  if (main.length !== PENF.len) return { status: 'unsupported', model, detail: `Model code ${model}. The research maps ISP builders for PEN-F firmware 3.1 only, so this firmware cannot drive the stages.` };
  const sha = sha256(main);
  const stock = sha === PENF.sha;
  return { status: stock ? 'stock' : 'modified', main: new Uint8Array(main), sha, source, model, checksum,
    detail: stock ? 'PEN-F firmware 3.1, stock' : 'PEN-F 3.1 layout, modified: hash differs from stock' };
}
