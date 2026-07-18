import { isIP } from "node:net";

/** Canonicalizes equivalent client IP spellings so one client has one rate-limit bucket. */
export function normalizeClientIp(raw: string | undefined): string {
  if (!raw) return "unknown";
  let address = raw.trim();
  if (address.startsWith("[") && address.endsWith("]")) {
    address = address.slice(1, -1);
  }
  address = address.split("%")[0] ?? address;

  if (isIP(address) === 4) return address;
  if (isIP(address) !== 6) return "unknown";

  try {
    const canonical = new URL(`http://[${address}]/`).hostname
      .slice(1, -1)
      .toLowerCase();
    const dotted = canonical.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (dotted) return dotted[1] ?? "unknown";
    const mapped = canonical.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) {
      const high = Number.parseInt(mapped[1] ?? "", 16);
      const low = Number.parseInt(mapped[2] ?? "", 16);
      return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    }
    return canonical;
  } catch {
    return "unknown";
  }
}
