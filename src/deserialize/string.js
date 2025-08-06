const ESCAPE_TABLE = [
  "", "", "", "", "", "", "", "",
  "", "", "", "", "", "", "", "",
  "", "", "", "", "", "", "", "",
  "", "", "", "", "", "", "", "",
  "", "", "\"", "", "", "", "", "",
  "", "", "", "", "", "", "", "",
  "", "", "", "", "", "", "", "",
  "", "", "", "", "", "", "", "\\",
  "", "", "", "", "", "", "", "\b",
  "", "", "\n", "", "", "\r", "", "",
  "", "", "", "", "", "", "", "",
  "", "", "", "", "", "", "", "",
  "", "", "", "", "", "", "", "\f",
  "", "", "", "", "", "", "", "",
  "", "", "\r", "", "", "\t", "", "",
  "", "", "", "", "", "", "", "",
];

export function deserializeString(str) {
  const len = str.length - 1;
  let dst = "";
  let last = 1;
  let ch = 0;
  for (let i = 1; i < len; i++) {
    ch = str.charCodeAt(i);
    if (ch === 92) {
      ch = str.charCodeAt(i + 1);
      if (ch === 117) {
        const hi = parseInt(str.substr(i + 2, 4), 16);
        if ((hi & 0xfc00) === 0xd800 &&  // high surrogate
          str.charCodeAt(i + 6) === 92 &&
          str.charCodeAt(i + 7) === 117) {
          const lo = parseInt(str.substr(i + 8, 4), 16);
          if ((lo & 0xfc00) === 0xdc00) { // low surrogate
            out += String.fromCodePoint(((hi - 0xd800) << 10) + (lo - 0xdc00) + 0x10000);
            i += 10;
            last = i + 1;
            continue;
          }
        }
        out += String.fromCharCode(hi);
        i += 5;
        last = i + 1;
      } else {
        dst += str.slice(last, i) + ESCAPE_TABLE[ch];
        last = i + 2;
        // Using i++ here, even though it is correct, will cause a cache miss on Zen4 architecture unfortunately
      }
    }
  }
  return (last === 1 && str.slice(1, -1)) || dst + str.slice(last, len);
}
