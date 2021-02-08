import * as t from "io-ts";
import { tag } from "@pagopa/ts-commons/lib/types";

interface ISessionTokenTag {
  readonly kind: "SessionToken";
}
export const SessionToken = tag<ISessionTokenTag>()(t.string);
export type SessionToken = t.TypeOf<typeof SessionToken>;

interface IWalletTokenTag {
  readonly kind: "WalletToken";
}
export const WalletToken = tag<IWalletTokenTag>()(t.string);
export type WalletToken = t.TypeOf<typeof WalletToken>;

interface IMyPortalTokenTag {
  readonly kind: "MyPortalToken";
}
export const MyPortalToken = tag<IMyPortalTokenTag>()(t.string);
export type MyPortalToken = t.TypeOf<typeof MyPortalToken>;

interface IBPDTokenTag {
  readonly kind: "BPDToken";
}
export const BPDToken = tag<IBPDTokenTag>()(t.string);
export type BPDToken = t.TypeOf<typeof BPDToken>;
