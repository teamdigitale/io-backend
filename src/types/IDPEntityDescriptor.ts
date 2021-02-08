import * as t from "io-ts";
import { createNonEmptyArrayFromArray } from "io-ts-types/lib/fp-ts/createNonEmptyArrayFromArray";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";

export const IDPEntityDescriptor = t.interface({
  cert: createNonEmptyArrayFromArray(NonEmptyString),

  entityID: t.string,

  entryPoint: t.string,

  logoutUrl: t.string
});

export type IDPEntityDescriptor = t.TypeOf<typeof IDPEntityDescriptor>;
