import { alias as wireName, json, optional as maybe } from "json-ty";

export interface Identified {
  id: number;
}

export interface Named extends Identified {
  name: string;
}

export interface Timestamped {
  createdAt: string;
}

export interface Entity extends Named, Timestamped {
  note?: string;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export class UndecoratedBase {
  inherited = "base";
  protected internal = 1;
  private secret = "hidden";

  constructor(public constructorField = 5) {}
}

@json
export class GenericBase<T> extends UndecoratedBase {
  @wireName("base_value")
  value!: T;

  @maybe
  inheritedOptional?: number;
}

@json
export class Middle extends GenericBase<number> {
  middle = true;
  override inherited = "middle";
}
