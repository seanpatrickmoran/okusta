import {validate as widgetValidate, describe as widgetDescription, stable} from "./record.js";
import {FORMAT, isCollectionFormat, validateRecord} from "./collection.mjs";
import {collectionDescription} from "./collection-player.js";
export {stable};
export const validate = r => isCollectionFormat(r?.format) ? validateRecord(r) : widgetValidate(r);
export const describe = r => isCollectionFormat(r.format) ? collectionDescription(r) : widgetDescription(r);

// Compare the recorded submission across the name change without altering its provenance.
export function sameReplay(a, b) {
  function signature(record) {
    let format = record.format;
    if (isCollectionFormat(format)) format = FORMAT;
    else if (format === "zerkalo-replay/1") format = "okusta-replay/1";
    return JSON.stringify(stable({...record, format}));
  }
  return signature(a) === signature(b);
}
