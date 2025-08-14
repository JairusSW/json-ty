<h1 align="center"><pre> ╦╔═╗╔═╗╔╗╔ ╔╦╗╦ ╦
 ║╚═╗║ ║║║║══║ ╚╦╝
╚╝╚═╝╚═╝╝╚╝  ╩  ╩ </pre></h1>

<div align="center">
</pre>JSON for TypeScript the way it should be. Type-safe, strict, and performant—significantly outpacing the built-in JSON implementation while upholding the robust type safety of TypeScript.
</div>

## 🧠 Why

**It’s Fucking TypeScript**: Why waste TypeScript’s type system? Class definitions ensure type-safety, so you don’t get screwed by runtime errors in production.

**Gnarly Performance**: Tuned for V8 and JavaScriptCore with CPU cache optimizations, inferred integers, and branch prediction, hitting up to **2x-3x faster** than `JSON.stringify`/`JSON.parse`.

**Lightweight and dependency-free**: No runtime dependencies post-compilation. Custom-generated code strips bloat for lean, mean performance.

**Production oriented**: A massive majority of vulnarabilities occur through unsafe deserialization. This library mitigates it.

## 📚 Contents

- [Installation](#-installation)
- [Usage](#-usage)
- [Examples](#-examples)
  - [Omitting Fields](#️-omitting-fields)
  - [Using Raw JSON Strings](#️-using-raw-json-strings)
  - [Custom Serializers](#️-using-custom-serializers-or-deserializers)
- [Performance](#-performance)
- [Debugging](#-debugging)
- [License](#-license)
- [Contact](#-contact)

## 💾 Installation

```bash
npm install json-ty
```

Add the `transform` to your `tsc` command (e.g. in package.json)

```bash
--transform json-ty/transform
```


### Prerequesites

`json-ty` is a TypeScript transformer, requiring [ts-patch](https://github.com/nonara/ts-patch) for custom transformer support.

1. Install [ts-patch](https://npmjs.com/package/ts-patch) and [typescript](https://npmjs.com/package/typescript)

```bash
npm install --save-dev ts-patch typescript
```

2. Patch the TypeScript Compiler

```bash
npx ts-patch install
```

3. Add the transform to your `tsconfig.json`

```json
{
  "compilerOptions": {
    "plugins": [{ "transform": "json-ty/transform" }]
    ...
  }
}
```

4. Ensure [ts-patch](https://npmjs.com/package/ts-patch) persists

```json
{
  "scripts": {
    "prepare": "ts-patch install -s"
  }
}
```

For more information, please read the documentation [Here](https://docs.jairus.dev/json-ty/using-ts-patch) or the [ts-patch](https://github.com/nonara/ts-patch) documentation [Here](https://github.com/nonara/ts-patch/blob/master/README.md)

## 🪄 Usage

```typescript
import { JSON } from "json-ty";

// Look mom, no ugly JSON Schemas!
@json
class Vec3 {
  x: number = 0.0;
  y: number = 0.0;
  z: number = 0.0;
}

@json
class Player {
  @alias("first name")
  firstName!: string;
  lastName!: string;
  lastActive!: number[];
  // Drop in a code block, function, or expression that evaluates to a boolean
  @omitif((self: Player) => self.age < 18)
  age!: number;
  @omitnull()
  pos!: Vec3 | null;
  isVerified!: boolean;
}

const player: Player = {
  firstName: "Jairus",
  lastName: "Tanaka",
  lastActive: [3, 9, 2025],
  age: 18,
  pos: {
    x: 3.4,
    y: 1.2,
    z: 8.3,
  },
  isVerified: true,
};

const serialized = JSON.stringify<Player>(player);
// Deserialize data back into a type-safe Player instance
const deserialized = JSON.parse<Player>(serialized);

console.log("Serialized    " + serialized);
console.log("Deserialized  " + JSON.stringify(deserialized));
```

## 🔍 Examples

### 🏷️ Omitting Fields

This library allows selective omission of fields during serialization by either using the `private` or `protected` keyword or following decorators:

**private/protected**

```js
@json
class Example {
  name!: string;
  private SSN!: string = "123-45-6789"; // protected works here too
}

const obj = new Example();
obj.name = "Jairus";

console.log(JSON.stringify(obj)); // { "name": "Jairus" }
```

**@omit**

This decorator excludes a field from serialization entirely.

```typescript
@json
class Example {
  name!: string;
  @omit
  SSN!: string;
}

const obj = new Example();
obj.name = "Jairus";
obj.SSN = "123-45-6789";

console.log(JSON.stringify(obj)); // { "name": "Jairus" }
```

**@omitnull**

This decorator omits a field only if its value is `null`.

```typescript
@json
class Example {
  name!: string;
  @omitnull()
  optionalField!: string | null;
}

const obj = new Example();
obj.name = "Jairus";
obj.optionalField = null;

console.log(JSON.stringify(obj)); // { "name": "Jairus" }
```

**@omitif((self: this) => condition)**

This decorator omits a field based on a custom predicate function.

```typescript
@json
class Example {
  name!: string;
  @omitif((self: Example) => self.age <= 18)
  age!: number;
}

const obj = new Example();
obj.name = "Jairus";
obj.age = 18;

console.log(JSON.stringify(obj)); // { "name": "Jairus" }

obj.age = 99;

console.log(JSON.stringify(obj)); // { "name": "Jairus", "age": 99 }
```

If age were higher than 18, it would be included in the serialization.

### 🏗️ Using Raw JSON strings

Sometimes its necessary to simply copy a string instead of serializing it.

For example, the following data would typically be serialized as:

```typescript
const map = new Map<string, string>();
map.set("pos", '{"x":1.0,"y":2.0,"z":3.0}');

console.log(JSON.stringify(map));
// {"pos":"{\"x\":1.0,\"y\":2.0,\"z\":3.0}"}
// pos's value (Vec3) is contained within a string... ideally, it should be left alone
```

If, instead, one wanted to insert Raw JSON into an existing schema/data structure, they could make use of the JSON.Raw type to do so:

```typescript
const map = new Map<string, JSON.Raw>();
map.set("pos", new JSON.Raw('{"x":1.0,"y":2.0,"z":3.0}'));

console.log(JSON.stringify(map));
// {"pos":{"x":1.0,"y":2.0,"z":3.0}}
// Now its properly formatted JSON where pos's value is of type Vec3 not string!
```

### ⚒️ Using custom serializers or deserializers

This library supports custom serialization and deserialization methods, which can be defined using the `@serializer` and `@deserializer` decorators.

Here's an example of creating a custom data type called `Point` which serializes to `(x,y)`

```typescript
import { bytes } from "json-ty/util";

@json
class Point {
  x: number = 0.0;
  y: number = 0.0;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  @serializer
  serializer(self: Point): string {
    return `(${self.x},${self.y})`;
  }

  @deserializer
  deserializer(data: string): Point {
    if (data.length < 2) throw new Error("Could not deserialize provided data as type Point");

    const c = data.indexOf(",");
    const x = data.slice(1, c);
    const y = data.slice(c + 1, data.length - 1);

    return new Point(parseFloat(x), parseFloat(y));
  }
}

const obj = new Point(3.5, -9.2);

const serialized = JSON.stringify<Point>(obj);
const deserialized = JSON.parse<Point>(serialized);

console.log("Serialized    " + serialized);
console.log("Deserialized  " + JSON.stringify(deserialized));
```

The serializer function converts a `Point` instance into a string format `(x,y)`.

The deserializer function parses the string `(x,y)` back into a `Point` instance.

These functions are then wrapped before being consumed by the json-ty library:

```typescript
@inline __SERIALIZE_CUSTOM(): void {
  const data = this.serializer(this);
  const dataSize = data.length << 1;
  memory.copy(bs.offset, changetype<usize>(data), dataSize);
  bs.offset += dataSize;
}

@inline __DESERIALIZE_CUSTOM(data: string): Point {
  return this.deserializer(data);
}
```

This allows custom serialization while maintaining a generic interface for the library to access.

## 📃 License

This project is distributed under an open source license. You can view the full license using the following link: [License](./LICENSE)

## 📫 Contact

Please send all issues to [GitHub Issues](https://github.com/JairusSW/json-ty/issues) and to converse, please send me an email at [me@jairus.dev](mailto:me@jairus.dev)

- **Email:** Send me inquiries, questions, or requests at [me@jairus.dev](mailto:me@jairus.dev)
- **GitHub:** Visit the official GitHub repository [Here](https://github.com/JairusSW/json-ty)
- **Website:** Visit my official website at [jairus.dev](https://jairus.dev/)
- **Discord:** Contact me at [My Discord](https://discord.com/users/600700584038760448)
