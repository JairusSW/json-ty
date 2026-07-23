// Fast u32 -> UTF-8 serialization with a digit-pair width ladder. V8 lowers
// division by these constants to multiply/shift sequences,
// while independent digit-pair lookups can be scheduled in parallel.

const DIGIT_PAIRS: usize = memory.data(100 * 2);
let pairsInitialized: bool = false;

function initializePairs(): void {
  for (let value: u32 = 0; value < 100; value++) {
    const tens = 0x30 + value / 10;
    const units = 0x30 + (value % 10);
    store<u16>(DIGIT_PAIRS + ((<usize>value) << 1), <u16>(tens | (units << 8)));
  }
  pairsInitialized = true;
}


@inline
function pair(value: u32): u16 {
  return load<u16>(DIGIT_PAIRS + ((<usize>value) << 1));
}

export function writeU32(pointer: usize, value: u32): u32 {
  if (!pairsInitialized) initializePairs();
  if (value < 10) {
    store<u8>(pointer, <u8>(value + 0x30));
    return 1;
  }
  if (value < 100) {
    store<u16>(pointer, pair(value));
    return 2;
  }
  if (value < 1_000_000) {
    if (value < 10_000) {
      const high = value / 100;
      const low = value - high * 100;
      if (value < 1_000) {
        store<u8>(pointer, <u8>(high + 0x30));
        store<u16>(pointer + 1, pair(low));
        return 3;
      }
      store<u16>(pointer, pair(high));
      store<u16>(pointer + 2, pair(low));
      return 4;
    }
    const high = value / 10_000;
    const rest = value - high * 10_000;
    const middle = rest / 100;
    const low = rest - middle * 100;
    if (value < 100_000) {
      store<u8>(pointer, <u8>(high + 0x30));
      store<u16>(pointer + 1, pair(middle));
      store<u16>(pointer + 3, pair(low));
      return 5;
    }
    store<u16>(pointer, pair(high));
    store<u16>(pointer + 2, pair(middle));
    store<u16>(pointer + 4, pair(low));
    return 6;
  }
  if (value < 100_000_000) {
    const top = value / 1_000_000;
    let rest = value - top * 1_000_000;
    const a = rest / 10_000;
    rest -= a * 10_000;
    const b = rest / 100;
    const low = rest - b * 100;
    if (value < 10_000_000) {
      store<u8>(pointer, <u8>(top + 0x30));
      store<u16>(pointer + 1, pair(a));
      store<u16>(pointer + 3, pair(b));
      store<u16>(pointer + 5, pair(low));
      return 7;
    }
    store<u16>(pointer, pair(top));
    store<u16>(pointer + 2, pair(a));
    store<u16>(pointer + 4, pair(b));
    store<u16>(pointer + 6, pair(low));
    return 8;
  }

  const top = value / 100_000_000;
  let rest = value - top * 100_000_000;
  const a = rest / 1_000_000;
  rest -= a * 1_000_000;
  const b = rest / 10_000;
  rest -= b * 10_000;
  const c = rest / 100;
  const low = rest - c * 100;
  if (value < 1_000_000_000) {
    store<u8>(pointer, <u8>(top + 0x30));
    store<u16>(pointer + 1, pair(a));
    store<u16>(pointer + 3, pair(b));
    store<u16>(pointer + 5, pair(c));
    store<u16>(pointer + 7, pair(low));
    return 9;
  }
  store<u16>(pointer, pair(top));
  store<u16>(pointer + 2, pair(a));
  store<u16>(pointer + 4, pair(b));
  store<u16>(pointer + 6, pair(c));
  store<u16>(pointer + 8, pair(low));
  return 10;
}
