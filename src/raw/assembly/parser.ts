// Compatibility barrel for artifacts generated before the type-kernel layout.
// New generated modules import deserialize/scanner and the type modules.
export {
  ERROR_INVALID_ESCAPE,
  ERROR_INVALID_NUMBER,
  ERROR_TRAILING_DATA,
  ERROR_UNEXPECTED_TOKEN,
  ERROR_UNTERMINATED_STRING,
  align8,
  countArrayElements,
  countObjectMembers,
  isWhitespace,
  lastStringHadEscape,
  parseNumber,
  scanStringContent,
  skipValue,
  skipWhitespace,
} from "./deserialize/scanner";
