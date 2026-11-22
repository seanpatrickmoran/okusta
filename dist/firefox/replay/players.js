import {isCollectionFormat} from "./collection.mjs";
import {collectionPlayer} from "./collection-player.js";
import {player as widgetPlayer} from "./player.js";
export const player = (r,open) => isCollectionFormat(r.format) ? collectionPlayer(r,open) : widgetPlayer(r,open);
