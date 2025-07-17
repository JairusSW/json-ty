import { JSON } from ".";


@json
class Vec3 {
  x: number = 0.0;
  y: number = 0.0;
  z: number = 0.0;
}

const vec: Vec3 = {
  x: 3.4,
  y: 1.2,
  z: 5.8,
};

const serialized = JSON.stringify(vec);
console.log("Serialized -> " + serialized);

const desrialized = JSON.parse<Vec3>(serialized);
console.log("Deserialized -> " + JSON.stringify(desrialized));
