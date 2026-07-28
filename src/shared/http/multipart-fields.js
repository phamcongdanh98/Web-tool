"use strict";

export function getFieldValue(fields, name, fallback = "") {
  const value = fields?.[name]?.value;
  return value === undefined || value === null || value === "" ? fallback : value;
}
