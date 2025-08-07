import { JSON } from "./index.js";

@json
class Vec3 {
  x: float = 1.23;
  y: int = 4.56;
  z: number = 7.89;
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
  age: 18,
  lastActive: [8, 30, 2025],
  pos: JSON.from(Vec3, {
    x: 1.23,
    y: 4.56,
    z: 7.89
  }),
  isVerified: true
});

console.log("p1: " + JSON.stringify(p1))