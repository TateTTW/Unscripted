export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Anchor extends Point {
  id: string;
  label: string;
}

export interface Fixture extends Point {
  id: string;
  displayName: string;
  inspectText: string | null;
}

export interface TilesetInfo {
  name: string;
  /** Last path segment of the tileset's image path, e.g. `interiors.png`. */
  imageFile: string;
  firstgid: number;
  columns: number;
  tilecount: number;
  tileWidth: number;
  tileHeight: number;
  imageWidth: number;
  imageHeight: number;
}

export interface ParsedMap {
  /** Width/height in tiles. */
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  /** Tile layer names in draw order (bottom to top). */
  tileLayers: string[];
  anchors: Anchor[];
  fixtures: Fixture[];
  playerStart: Point;
  /** Row-major `width * height` grid; true when any tile layer has a colliding tile there. */
  collides: boolean[];
  tilesets: TilesetInfo[];
}
