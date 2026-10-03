// RAR 5 « stocké » (sans compression) : format ouvert en écriture, lisible par WinRAR, 7-Zip et unrar.
// La décompression RAR propriétaire n'est pas disponible hors ligne ; seule la lecture des archives stockées l'est.

import { concatBytes, crc32, dec, enc, u32le } from "../core/bytes.js";
import { cleanEntryName } from "./tar.js";

const SIGNATURE = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00];

export function vint(value) {
  let n = BigInt(value);
  const out = [];
  do {
    let b = Number(n & 127n);
    n >>= 7n;
    if (n) b |= 128;
    out.push(b);
  } while (n);
  return new Uint8Array(out);
}

export function readVint(u, pos) {
  let n = 0n;
  let shift = 0n;
  for (let i = 0; i < 10 && pos < u.length; i++, pos++) {
    const b = u[pos];
    n |= BigInt(b & 127) << shift;
    if (!(b & 128)) return { value: Number(n), next: pos + 1 };
    shift += 7n;
  }
  throw new Error("Entier RAR invalide.");
}

function block(body) {
  const checked = concatBytes(vint(body.length), body);
  return concatBytes(u32le(crc32(checked)), checked);
}

/** @param {{name: string, data: Uint8Array}[]} entries */
export function rarWrite(entries) {
  const parts = [new Uint8Array(SIGNATURE), block(new Uint8Array([1, 0, 0]))];
  for (const entry of entries) {
    const data = entry.data;
    const name = enc.encode(cleanEntryName(entry.name) || "fichier");
    const body = concatBytes(
      vint(2), // type : fichier
      vint(2), // drapeaux : zone de données présente
      vint(data.length),
      vint(4), // drapeaux fichier : CRC32 présent
      vint(data.length),
      vint(0o100644), // attributs Unix
      u32le(crc32(data)),
      vint(0), // compression : stockage
      vint(1), // système hôte : Unix
      vint(name.length),
      name,
    );
    parts.push(block(body), data);
  }
  parts.push(block(new Uint8Array([5, 0, 0])));
  return new Blob(parts, { type: "application/vnd.rar" });
}

export function rarReadStored(input) {
  const u = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!SIGNATURE.every((b, i) => u[i] === b)) {
    const rar4 = SIGNATURE.slice(0, 6).every((b, i) => u[i] === b);
    throw new Error(
      rar4
        ? "Archive RAR 4 : ce format ancien n'est pas lisible hors ligne. Seules les archives RAR 5 stockées le sont."
        : "Seules les archives RAR 5 non chiffrées et stockées sans compression sont lisibles hors ligne.",
    );
  }
  const out = [];
  let o = SIGNATURE.length;
  while (o < u.length) {
    if (o + 5 > u.length) throw new Error("Archive RAR tronquée.");
    const expected = new DataView(u.buffer, u.byteOffset + o, 4).getUint32(0, true);
    o += 4;
    const headerSize = readVint(u, o);
    const headerStart = o;
    o = headerSize.next;
    const headerEnd = o + headerSize.value;
    if (headerEnd > u.length || crc32(u.subarray(headerStart, headerEnd)) !== expected)
      throw new Error("En-tête RAR invalide ou archive endommagée.");
    const type = readVint(u, o);
    o = type.next;
    const flags = readVint(u, o);
    o = flags.next;
    let dataSize = 0;
    if (flags.value & 1) o = readVint(u, o).next;
    if (flags.value & 2) {
      const d = readVint(u, o);
      dataSize = d.value;
      o = d.next;
    }
    if (type.value === 4) throw new Error("Archive RAR chiffrée : impossible de la lire sans mot de passe.");
    if (type.value === 2) {
      const fileFlags = readVint(u, o);
      o = fileFlags.next;
      const unpacked = readVint(u, o);
      o = unpacked.next;
      o = readVint(u, o).next; // attributs
      if (fileFlags.value & 2) o += 4;
      if (fileFlags.value & 4) o += 4;
      const compression = readVint(u, o);
      o = compression.next;
      o = readVint(u, o).next; // système hôte
      const nameLength = readVint(u, o);
      o = nameLength.next;
      const name = dec.decode(u.subarray(o, o + nameLength.value));
      const isDirectory = fileFlags.value & 1;
      if (!isDirectory) {
        if ((compression.value >> 7) & 7)
          throw new Error(
            "Ce RAR utilise la compression propriétaire RAR, non disponible hors ligne. Seuls les RAR « stockés » sont lisibles.",
          );
        if (dataSize !== unpacked.value || headerEnd + dataSize > u.length)
          throw new Error("Entrée RAR stockée invalide.");
        out.push({ name: cleanEntryName(name) || "fichier", data: u.slice(headerEnd, headerEnd + dataSize) });
      }
      o = headerEnd + dataSize;
      continue;
    }
    if (type.value === 5) break;
    o = headerEnd + dataSize;
  }
  return out;
}
