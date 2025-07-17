"use strict";
var __decorate =
  (this && this.__decorate) ||
  function (decorators, target, key, desc) {
    var c = arguments.length,
      r = c < 3 ? target : desc === null ? (desc = Object.getOwnPropertyDescriptor(target, key)) : desc,
      d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if ((d = decorators[i])) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return (c > 3 && r && Object.defineProperty(target, key, r), r);
  };
Object.defineProperty(exports, "__esModule", { value: true });
const _1 = require(".");
let Vec3 = class Vec3 {
  x = 0.0;
  y = 0.0;
  z = 0.0;
};
Vec3 = __decorate([json], Vec3);
const vec = {
  x: 3.4,
  y: 1.2,
  z: 5.8,
};
const serialized = _1.JSON.stringify(vec);
console.log("Serialized -> " + serialized);
const desrialized = _1.JSON.parse(serialized);
console.log("Deserialized -> " + _1.JSON.stringify(desrialized));
