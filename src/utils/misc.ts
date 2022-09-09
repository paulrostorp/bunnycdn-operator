import { hasOwnPropertyOfType } from "typechecking-toolkit";
import http from "http";

// eslint-disable-next-line @typescript-eslint/ban-types
const hasOwnProperty = <X extends {}, Y extends PropertyKey>(obj: X, prop: Y): obj is X & Record<Y, unknown> => {
  return Object.prototype.hasOwnProperty.call(obj, prop);
};

export const isNestedHttpResponse = (error: unknown): error is { response: http.IncomingMessage } => {
  if (typeof error == "object" && error && hasOwnProperty(error, "response")) {
    return error.response instanceof http.IncomingMessage;
  }
  return false;
};

// util
interface IBunnyAPIErrorPayload {
  ErrorKey: string;
  Field: string;
  Message: string;
}

export const isBunnyAPIErrorPayload = (err: unknown): err is IBunnyAPIErrorPayload => {
  return (
    hasOwnPropertyOfType(err, "ErrorKey", "string") &&
    hasOwnPropertyOfType(err, "Field", "string") &&
    hasOwnPropertyOfType(err, "Message", "string")
  );
};

export class PullZoneNotReadyError extends Error {}
export class StorageZoneNotReadyError extends Error {}
export class EdgeRuleNotReadyError extends Error {}
