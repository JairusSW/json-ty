import { JSON } from "json-ty";
import {
  type Entity,
  type Page,
  Middle,
} from "./inheritance-base.js";

export interface AuditedEntity extends Entity {
  note: string;
  updatedAt: string;
}

export const entity = JSON.parse<AuditedEntity>(
  '{"id":1,"name":"Ada","createdAt":"now","note":"required override","updatedAt":"later"}',
);

export const page = JSON.parse<Page<AuditedEntity>>(
  '{"items":[],"total":0}',
);

export class Leaf extends Middle {
  leaf = "yes";
}

export const leaf = JSON.parse<Leaf>(
  '{"inherited":"middle","base_value":2,"middle":true,"leaf":"yes"}',
);
