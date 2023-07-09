//import { Tlsh } from 'tlsh_ts';

// TLSH - Trend Micro Locality Sensitive Hash - is a fuzzy matching algorithm. Given a byte stream with a minimum length
// of 50 bytes TLSH generates a hash value which can be used for similarity comparisons.
// Read more about TLSH at https://tlsh.org/
import { Tlsh } from '../utilities/index.js';

export function tlsHash(text: string) {
  const hasher = new Tlsh();
  hasher.finale(text);
  return `T1${hasher.hash().toString()}`;
}
