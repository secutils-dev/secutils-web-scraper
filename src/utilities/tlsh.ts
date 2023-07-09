/*
 * TLSH is provided for use under two licenses: Apache OR BSD.
 * Users may opt to use either license depending on the license
 * restrictions of the systems with which they plan to integrate
 * the TLSH code.
 */

/* ==============
 * Apache License
 * ==============
 * Copyright 2013 Trend Micro Incorporated
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* ===========
 * BSD License
 * ===========
 * Copyright (c) 2013, Trend Micro Incorporated
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.

 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
 * IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
 * INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
 * BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE
 * OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED
 * OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/*
 * Port of C++ implementation tlsh to javascript.
 *
 * Construct Tlsh object with methods:
 *   update
 *   finale
 *   fromTlshStr
 *   reset
 *   hash
 *   totalDiff
 *
 * See tlsh.html for example use.
 */

const TLSH_CHECKSUM_LEN = 1;
const MIN_DATA_LENGTH = 50;
const SLIDING_WND_SIZE = 5;
const RNG_SIZE = SLIDING_WND_SIZE;
const BUCKETS = 256;
// 128 * 2 bits = 32 bytes
const CODE_SIZE = 32;
const EFF_BUCKETS = 128;

const V_TABLE = new Uint8Array([
  1, 87, 49, 12, 176, 178, 102, 166, 121, 193, 6, 84, 249, 230, 44, 163, 14, 197, 213, 181, 161, 85, 218, 80, 64, 239,
  24, 226, 236, 142, 38, 200, 110, 177, 104, 103, 141, 253, 255, 50, 77, 101, 81, 18, 45, 96, 31, 222, 25, 107, 190, 70,
  86, 237, 240, 34, 72, 242, 20, 214, 244, 227, 149, 235, 97, 234, 57, 22, 60, 250, 82, 175, 208, 5, 127, 199, 111, 62,
  135, 248, 174, 169, 211, 58, 66, 154, 106, 195, 245, 171, 17, 187, 182, 179, 0, 243, 132, 56, 148, 75, 128, 133, 158,
  100, 130, 126, 91, 13, 153, 246, 216, 219, 119, 68, 223, 78, 83, 88, 201, 99, 122, 11, 92, 32, 136, 114, 52, 10, 138,
  30, 48, 183, 156, 35, 61, 26, 143, 74, 251, 94, 129, 162, 63, 152, 170, 7, 115, 167, 241, 206, 3, 150, 55, 59, 151,
  220, 90, 53, 23, 131, 125, 173, 15, 238, 79, 95, 89, 16, 105, 137, 225, 224, 217, 160, 37, 123, 118, 73, 2, 157, 46,
  116, 9, 145, 134, 228, 207, 212, 202, 215, 69, 229, 27, 188, 67, 124, 168, 252, 42, 4, 29, 108, 21, 247, 19, 205, 39,
  203, 233, 40, 186, 147, 198, 192, 155, 33, 164, 191, 98, 204, 165, 180, 117, 76, 140, 36, 210, 172, 41, 54, 159, 8,
  185, 232, 113, 196, 231, 47, 146, 120, 51, 65, 28, 144, 254, 221, 93, 189, 194, 139, 112, 43, 71, 109, 184, 209,
]);

function b_mapping(salt: number, i: number, j: number, k: number) {
  let h = 0;

  h = V_TABLE[h ^ salt];
  h = V_TABLE[h ^ i];
  h = V_TABLE[h ^ j];
  h = V_TABLE[h ^ k];

  return h;
}

const LOG_1_5 = 0.4054651;
const LOG_1_3 = 0.26236426;
const LOG_1_1 = 0.09531018;

function l_capturing(len: number) {
  let i;
  if (len <= 656) {
    i = Math.floor(Math.log(len) / LOG_1_5);
  } else if (len <= 3199) {
    i = Math.floor(Math.log(len) / LOG_1_3 - 8.72777);
  } else {
    i = Math.floor(Math.log(len) / LOG_1_1 - 62.5472);
  }

  return i & 0xff;
}

function setQLo(Q: number, x: number) {
  return (Q & 0xf0) | (x & 0x0f);
}

function setQHi(Q: number, x: number) {
  return (Q & 0x0f) | ((x & 0x0f) << 4);
}

function partition(buf: Buffer, left: number, right: number) {
  if (left === right) {
    return left;
  }

  if (left + 1 == right) {
    if (buf.bucket_copy[left] > buf.bucket_copy[right]) {
      SWAP_UINT(buf, left, right);
    }
    return left;
  }

  let ret = left;
  const pivot = (left + right) >> 1;

  const val = buf.bucket_copy[pivot];

  buf.bucket_copy[pivot] = buf.bucket_copy[right];
  buf.bucket_copy[right] = val;

  for (let i = left; i < right; i++) {
    if (buf.bucket_copy[i] < val) {
      SWAP_UINT(buf, ret, i);
      ret++;
    }
  }
  buf.bucket_copy[right] = buf.bucket_copy[ret];
  buf.bucket_copy[ret] = val;

  return ret;
}

function swap_byte(i: number) {
  return (((i & 0xf0) >> 4) & 0x0f) | (((i & 0x0f) << 4) & 0xf0);
}

function to_hex(data: Uint8Array, len: number) {
  // Use TLSH.java implementation for to_hex
  let s = '';
  for (let i = 0; i < len; i++) {
    if (data[i] < 16) {
      s = s.concat('0');
    }
    s = s.concat(data[i].toString(16).toUpperCase());
  }

  return s;
}

function SWAP_UINT(buf: Buffer, left: number, right: number) {
  const int_tmp = buf.bucket_copy[left];
  buf.bucket_copy[left] = buf.bucket_copy[right];
  buf.bucket_copy[right] = int_tmp;
}

function RNG_IDX(i: number) {
  return (i + RNG_SIZE) % RNG_SIZE;
}

interface Quartiles {
  q1: number;
  q2: number;
  q3: number;
}

interface Buffer {
  bucket_copy: Uint32Array;
}

interface TempHash {
  checksum: Uint8Array;
  Lvalue: number;
  Q: number;
  tmp_code: Uint8Array;
}

///////////////////////////////////////////////////////////////////////////////////
// Definition of tlsh object
export class Tlsh {
  checksum = new Uint8Array(TLSH_CHECKSUM_LEN); // unsigned char array
  slide_window = new Uint8Array(SLIDING_WND_SIZE);
  a_bucket = new Uint32Array(BUCKETS); // unsigned int array
  data_len = 0;
  tmp_code = new Uint8Array(CODE_SIZE);
  Lvalue = 0;
  Q = 0;
  lsh_code = '';
  lsh_code_valid = false;

  // Allow caller to pass in length in case there are embedded null characters, as there
  // are in strings str_1 and str_2 (see simple_test.cpp)
  //
  // length parameter defaults to str.length

  update(str: string, length?: number) {
    length = typeof length !== 'undefined' ? length : str.length;

    const data = [];
    for (let i = 0; i < length; i++) {
      const code = str.charCodeAt(i);
      if (code > 255) {
        throw new Error(`Unexpected ${str[i]} has value ${code} which is too large`);
      }

      // Since charCodeAt returns between 0~65536, simply save every character as 2-bytes
      // data.push(code & 0xff00, code & 0xff);
      data.push(code & 0xff);
    }

    if (length != data.length) {
      throw new Error(`Unexpected string length: ${length} is not equal to value unsigned char length: ${data.length}`);
    }

    let j = this.data_len % RNG_SIZE;
    let fed_len = this.data_len;

    for (let i = 0; i < length; i++, fed_len++, j = RNG_IDX(j + 1)) {
      this.slide_window[j] = data[i];

      if (fed_len >= 4) {
        //only calculate when input >= 5 bytes
        const j_1 = RNG_IDX(j - 1);
        const j_2 = RNG_IDX(j - 2);
        const j_3 = RNG_IDX(j - 3);
        const j_4 = RNG_IDX(j - 4);

        for (let k = 0; k < TLSH_CHECKSUM_LEN; k++) {
          if (k == 0) {
            this.checksum[k] = b_mapping(0, this.slide_window[j], this.slide_window[j_1], this.checksum[k]);
          } else {
            // use calculated 1 byte checksums to expand the total checksum to 3 bytes
            this.checksum[k] = b_mapping(
              this.checksum[k - 1],
              this.slide_window[j],
              this.slide_window[j_1],
              this.checksum[k],
            );
          }
        }

        let r = b_mapping(2, this.slide_window[j], this.slide_window[j_1], this.slide_window[j_2]);
        r = b_mapping(2, this.slide_window[j], this.slide_window[j_1], this.slide_window[j_2]);
        r = b_mapping(2, this.slide_window[j], this.slide_window[j_1], this.slide_window[j_2]);

        this.a_bucket[r]++;
        r = b_mapping(3, this.slide_window[j], this.slide_window[j_1], this.slide_window[j_3]);
        this.a_bucket[r]++;
        r = b_mapping(5, this.slide_window[j], this.slide_window[j_2], this.slide_window[j_3]);
        this.a_bucket[r]++;
        r = b_mapping(7, this.slide_window[j], this.slide_window[j_2], this.slide_window[j_4]);
        this.a_bucket[r]++;
        r = b_mapping(11, this.slide_window[j], this.slide_window[j_1], this.slide_window[j_4]);
        this.a_bucket[r]++;
        r = b_mapping(13, this.slide_window[j], this.slide_window[j_3], this.slide_window[j_4]);
        this.a_bucket[r]++;
      }
    }
    this.data_len += length;
  }

  // final is a reserved word
  finale(str: string, length?: number) {
    if (typeof str !== 'undefined') {
      this.update(str, length);
    }

    if (this.data_len < MIN_DATA_LENGTH) {
      throw new Error(`ERROR: length too small - ${this.data_len}`);
    }

    const quartiles: Quartiles = { q1: 0, q2: 0, q3: 0 };
    this.find_quartile(quartiles);

    // buckets must be more than 50% non-zero
    let nonzero = 0;
    for (let i = 0; i < CODE_SIZE; i++) {
      for (let j = 0; j < 4; j++) {
        if (this.a_bucket[4 * i + j] > 0) {
          nonzero++;
        }
      }
    }
    if (nonzero <= (4 * CODE_SIZE) / 2) {
      throw new Error(`ERROR: not enough variation in input - ${nonzero} < ${(4 * CODE_SIZE) / 2}`);
    }

    for (let i = 0; i < CODE_SIZE; i++) {
      let h = 0;
      for (let j = 0; j < 4; j++) {
        const k = this.a_bucket[4 * i + j];
        if (quartiles.q3 < k) {
          h += 3 << (j * 2); // leave the optimization j*2 = j<<1 or j*2 = j+j for compiler
        } else if (quartiles.q2 < k) {
          h += 2 << (j * 2);
        } else if (quartiles.q1 < k) {
          h += 1 << (j * 2);
        }
      }
      this.tmp_code[i] = h;
    }

    this.Lvalue = l_capturing(this.data_len);
    this.Q = setQLo(this.Q, ((quartiles.q1 * 100) / quartiles.q3) % 16);
    this.Q = setQHi(this.Q, ((quartiles.q2 * 100) / quartiles.q3) % 16);
    this.lsh_code_valid = true;
  }

  find_quartile(quartiles: Quartiles) {
    const buf: Buffer = {
      bucket_copy: new Uint32Array(EFF_BUCKETS),
    };

    const short_cut_left = new Uint32Array(EFF_BUCKETS);
    const short_cut_right = new Uint32Array(EFF_BUCKETS);
    let spl = 0;
    let spr = 0;
    const p1 = EFF_BUCKETS / 4 - 1;
    const p2 = EFF_BUCKETS / 2 - 1;
    const p3 = EFF_BUCKETS - EFF_BUCKETS / 4 - 1;
    const end = EFF_BUCKETS - 1;

    for (let i = 0; i <= end; i++) {
      buf.bucket_copy[i] = this.a_bucket[i];
    }

    for (let l = 0, r = end; ; ) {
      const ret = partition(buf, l, r);
      if (ret > p2) {
        r = ret - 1;
        short_cut_right[spr] = ret;
        spr++;
      } else if (ret < p2) {
        l = ret + 1;
        short_cut_left[spl] = ret;
        spl++;
      } else {
        quartiles.q2 = buf.bucket_copy[p2];
        break;
      }
    }

    short_cut_left[spl] = p2 - 1;
    short_cut_right[spr] = p2 + 1;

    for (let i = 0, l = 0; i <= spl; i++) {
      let r = short_cut_left[i];
      if (r > p1) {
        for (;;) {
          const ret = partition(buf, l, r);
          if (ret > p1) {
            r = ret - 1;
          } else if (ret < p1) {
            l = ret + 1;
          } else {
            quartiles.q1 = buf.bucket_copy[p1];
            break;
          }
        }
        break;
      } else if (r < p1) {
        l = r;
      } else {
        quartiles.q1 = buf.bucket_copy[p1];
        break;
      }
    }

    for (let i = 0, r = end; i <= spr; i++) {
      let l = short_cut_right[i];
      if (l < p3) {
        for (;;) {
          const ret = partition(buf, l, r);
          if (ret > p3) {
            r = ret - 1;
          } else if (ret < p3) {
            l = ret + 1;
          } else {
            quartiles.q3 = buf.bucket_copy[p3];
            break;
          }
        }
        break;
      } else if (l > p3) {
        r = l;
      } else {
        quartiles.q3 = buf.bucket_copy[p3];
        break;
      }
    }
  }

  hash() {
    if (!this.lsh_code_valid) {
      throw new Error('ERROR IN PROCESSING');
    }

    const tmp: TempHash = {
      checksum: new Uint8Array(TLSH_CHECKSUM_LEN),
      Lvalue: 0,
      Q: 0,
      tmp_code: new Uint8Array(CODE_SIZE),
    };

    for (let k = 0; k < TLSH_CHECKSUM_LEN; k++) {
      tmp.checksum[k] = swap_byte(this.checksum[k]);
    }
    tmp.Lvalue = swap_byte(this.Lvalue);
    tmp.Q = swap_byte(this.Q);

    for (let i = 0; i < CODE_SIZE; i++) {
      tmp.tmp_code[i] = this.tmp_code[CODE_SIZE - 1 - i];
    }

    this.lsh_code = to_hex(tmp.checksum, TLSH_CHECKSUM_LEN);

    const tmpArray = new Uint8Array(1);
    tmpArray[0] = tmp.Lvalue;
    this.lsh_code = this.lsh_code.concat(to_hex(tmpArray, 1));

    tmpArray[0] = tmp.Q;
    this.lsh_code = this.lsh_code.concat(to_hex(tmpArray, 1));
    this.lsh_code = this.lsh_code.concat(to_hex(tmp.tmp_code, CODE_SIZE));
    return this.lsh_code;
  }
}
