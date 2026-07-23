import { JSON, alias, eager, json, lazy, omitnull, omitif, optional } from "json-ty";

function observed(_value: object, _key: string | symbol): void {}


@json
export class Position {
  x = 0;
  y = 0;
}

@json
export class CompositeDefaults {
  samples: number[] = [1, 2];
  position: Position = { x: 3, y: 4 };
  matrix: number[][] = [[5], [6, 7]];
}

@json({ lazy: "auto" })
export class LazyAuto {
  id = 0;
  name = "";
  position!: Position;
  samples!: number[];
  @eager forced = "";
}

@json({ lazy: "all" })
export class LazyAll {
  id = 0;
  @eager name = "";
}

@json({ lazy: "none" })
export class LazyNone {
  @lazy position!: Position;
  count = 0;
  wrapped!: JSON.Lazy<number>;
  nullableWrapped!: JSON.Lazy<Position> | null;
}

const auto = true;

@lazy({ auto })
@json
export class LazyConvenience {
  id = 0;
  values!: number[];
}

@lazy("all")
@json
export class LazyConvenienceAll {
  id = 0;
}

@lazy({ none: true })
@json
export class LazyConvenienceNone {
  values!: number[];
}


@json
export class Player {

  @alias("display name")
  name!: string;


  @optional
  score?: number;


  @omitnull
  position: Position | null = null;

  samples!: number[];

  matrix!: number[][];


  @observed
  active = true;


  @omitif((self: Player) => self.age < 18)
  age = 18;

  tuple!: [number, string, boolean];
}

export const player = JSON.parse<Player>("{}");
// Deliberately collides with the preferred generated direct-import spelling;
// the transformer must allocate a hygienic local identifier.
export const __jsonTy_p0 = "user binding";
export const encoded = JSON.stringify<Player>(player);
export const players = JSON.parse<Player[]>("[]");
export const encodedPlayers = JSON.stringify<Player[]>(players);
export const numbers = JSON.parse<number[]>("[1,2]");
export const numberFacade = JSON.parse<JSON.Array<number>>("[1,2]");
export const stringValue = JSON.parse<string>('""');
export const encodedString = JSON.stringify<string>("");
export const numberValue = JSON.parse<number>("42");
export const encodedNumber = JSON.stringify<number>(42);
export const booleanValue = JSON.parse<boolean>("true");
export const encodedBoolean = JSON.stringify<boolean>(true);
export const nullValue = JSON.parse<null>("null");
export const encodedNull = JSON.stringify<null>(null);
export const dynamicObject = JSON.parse<JSON.Obj>("{}");
export const encodedDynamic = JSON.stringify<JSON.Obj>(dynamicObject);
export const lazyAuto = JSON.parse<LazyAuto>("{}");
export const lazyAll = JSON.parse<LazyAll>("{}");
export const lazyNone = JSON.parse<LazyNone>("{}");
export const lazyConvenience = JSON.parse<LazyConvenience>("{}");
export const lazyConvenienceAll = JSON.parse<LazyConvenienceAll>("{}");
export const lazyConvenienceNone = JSON.parse<LazyConvenienceNone>("{}");
export const compositeDefaults = JSON.parse<CompositeDefaults>("{}");
export const encodedCompositeDefaults = JSON.stringify<CompositeDefaults>(compositeDefaults);

export enum Role {
  User,
  Admin,
}
export enum State {
  On = "on",
  Off = "off",
}

@json
export class Box<T> {
  value!: T;
}


@json
export class Config {
  role: Role = Role.User;
  defaultRole: Role = Role.Admin;
  state!: State;
  mode!: "fast" | "safe";
  box!: Box<number>;
  pet!: Cat | Dog;
  @omitif("this.role === 0") hidden = 1;
}

export interface Cat {
  kind: "cat";
  lives: number;
}
export interface Dog {
  kind: "dog";
  good: boolean;
}

JSON.schema<Cat>();
JSON.schema<Dog>();
