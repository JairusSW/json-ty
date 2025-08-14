import { JSON } from "./index.js";

interface CacheEntry {
  version: number;
  string: string;
}

const cache = new WeakMap<object, CacheEntry>();
const JSON_VERSION = Symbol("__JSON_META_VERSION");

@json
class Vec3 {
  private __JSON_x: float = 1.23;
  private __JSON_y: int = 4.56;
  private __JSON_z: number = 7.89;

  set x(value: float) {
    (this as any)[JSON_VERSION]++;
    this.__JSON_x = value;
  }
  get x(): float {
    return this.__JSON_x;
  }
  set y(value: int) {
    (this as any)[JSON_VERSION]++;
    this.__JSON_y = value;
  }
  get y(): int {
    return this.__JSON_y;
  }
  set z(value: number) {
    (this as any)[JSON_VERSION]++;
    this.__JSON_z = value;
  }
  get z(): number {
    return this.__JSON_z;
  }
}

@json
class Player {
  @alias("first_name")
  firstName!: string;
  lastName!: string;
  lastActive!: number[];
  @omitif((self: Player) => self.age < 18)
  age!: number;
  pos!: Vec3 | null;
  isVerified!: boolean;
}

const v1 = JSON.from(Vec3, {
  x: 1.23,
  y: 4.56,
  z: 7.89
});

console.log("v1: " + JSON.stringify(v1));

const p1 = JSON.from(Player, {
  firstName: "Jairus",
  lastName: "Tanaka",
  age: 17,
  lastActive: [8, 30, 2025],
  pos: {
    x: 1.23,
    y: 4.56,
    z: 7.89
  } as Vec3,
  isVerified: true
});

console.log("p1: " + JSON.stringify(p1))