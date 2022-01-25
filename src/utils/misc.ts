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
