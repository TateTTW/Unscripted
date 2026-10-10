import { imageFileName } from "./parseMap";

export interface TextureSlice {
  /** Phaser texture key and tileset name used for this slice. */
  key: string;
  imageFile: string;
  sourceY: number;
  width: number;
  height: number;
}

export interface SplitResult {
  mapJson: Record<string, unknown>;
  slices: TextureSlice[];
}

type Json = Record<string, unknown>;

/**
 * Splits tileset images taller than `maxHeight` into several tilesets that cover consecutive
 * row bands of the same image. Tile GIDs stay unchanged because the slices keep contiguous
 * `firstgid` ranges. The first slice keeps the tileset's original name.
 */
export function splitTallTilesets(mapJson: Json, maxHeight: number): SplitResult {
  const slices: TextureSlice[] = [];
  const tilesets: Json[] = [];
  for (const raw of (mapJson.tilesets as Json[] | undefined) ?? []) {
    const ts = raw;
    const name = String(ts.name);
    const imageFile = imageFileName(String(ts.image));
    const tileHeight = Number(ts.tileheight);
    const columns = Number(ts.columns);
    const imageWidth = Number(ts.imagewidth);
    const imageHeight = Number(ts.imageheight);
    const tilecount = Number(ts.tilecount);
    const rows = Math.ceil(tilecount / columns);
    const rowsPerSlice = Math.max(1, Math.floor(maxHeight / tileHeight));

    if (imageHeight <= maxHeight) {
      slices.push({ key: name, imageFile, sourceY: 0, width: imageWidth, height: imageHeight });
      tilesets.push(ts);
      continue;
    }

    const tiles = Array.isArray(ts.tiles) ? (ts.tiles as Json[]) : [];
    for (let part = 0, startRow = 0; startRow < rows; part++, startRow += rowsPerSlice) {
      const sliceRows = Math.min(rowsPerSlice, rows - startRow);
      const firstLocal = startRow * columns;
      const count = Math.min(sliceRows * columns, tilecount - firstLocal);
      const key = part === 0 ? name : `${name}__part${part + 1}`;
      const height = sliceRows * tileHeight;
      slices.push({ key, imageFile, sourceY: startRow * tileHeight, width: imageWidth, height });
      tilesets.push({
        ...ts,
        name: key,
        firstgid: Number(ts.firstgid) + firstLocal,
        tilecount: count,
        imageheight: height,
        tiles: tiles
          .filter((t) => Number(t.id) >= firstLocal && Number(t.id) < firstLocal + count)
          .map((t) => ({ ...t, id: Number(t.id) - firstLocal })),
      });
    }
  }
  return { mapJson: { ...mapJson, tilesets }, slices };
}
