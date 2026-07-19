import { JSON, json } from "json-ty";

namespace Left {
  @json
  export class Duplicate {
    left = 1;
  }
}

namespace Right {
  @json
  export class Duplicate {
    right = 2;
  }
}

JSON.parse<Left.Duplicate>("{}");
JSON.parse<Right.Duplicate>("{}");

