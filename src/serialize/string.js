const ESCAPE_TABLE = ["\\u0000", "\\u0001", "\\u0002", "\\u0003", "\\u0004", "\\u0005", "\\u0006", "\\u0007", "\\b", "\\t", "\\n", "\\u000b", "\\f", "\\r", "\\u000e", "\\u000f", "\\u0010", "\\u0011", "\\u0012", "\\u0013", "\\u0014", "\\u0015", "\\u0016", "\\u0017", "\\u0018", "\\u0019", "\\u001a", "\\u001b", "\\u001c", "\\u001d", "\\u001e", "\\u001f", " ", "!", '\\"', "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "\\\\"];

export function serializeString(data) {
  const len = data.length;
  let result = "\"";
  let last = 0 | 0;
  let ch = 0 | 0;

  for (let i = 0 | 0; i < len; i++) {
    ch = data.charCodeAt(i);

    if (ch <= 34 || ch === 92) {
      result += data.slice(last, i) + ESCAPE_TABLE[ch];
      last = i + 1;
    } else if ((ch & 0xF800) === 0xD800) {
      if (ch >= 0xD800 && ch <= 0xDBFF) {
        const next = data.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          i++;
        } else {
          result += data.slice(last, i) + "\\u" + ch.toString(16).padStart(4, "0");
          last = i + 1;
        }
      } else {
        result += data.slice(last, i) + "\\u" + ch.toString(16).padStart(4, "0");
        last = i + 1;
      }
    }
  }

  return (last === 0 && data + '"') || (result + data.slice(last) + '"');
}